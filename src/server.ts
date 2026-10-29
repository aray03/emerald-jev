import { readFileSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import { checkpointsBetween, hasFirstBadge, storyProgress } from './goals.ts'
import { chooseMove, readHighlighted, readScreen, upscaleFrame, type JevCall } from './jev.ts'
import { logPath, logStep, RUNS_DIR, saveFrame } from './log.ts'
import { decodeFacts, type Facts } from './memory.ts'
import { mapNameFor } from './nav.ts'
import { decideAction, decideFromScreen, decideMove, decideOnFoot, needsScreen, pressesForHighlight } from './policy.ts'
import { placeName } from './questions.ts'
import { gameStateSchema, type Action, type GameState } from './schemas.ts'
import { Session } from './session.ts'
import { queueSave, takePendingSave } from './states.ts'

const PORT = Number(process.env.EMERALD_PORT ?? 3100)
const DRY_RUN = process.env.DRY_RUN === '1'
const EXPECTED_GAME_CODE = 'BPEE' // Pokémon Emerald (USA, Europe)

const app = express()
let session = new Session()
let step = 0

// Reply format read by lua/emerald-jev.lua: chunks joined by ";". Each chunk is
//   "<buttons joined by , or -> <hold frames> <wait frames>", "SAVE:<absolute path>", or "DONE".
// A queued save state goes first, so it captures the game before this step's presses.
function encode(action: Action): string {
  const save = takePendingSave()
  const body =
    action.kind === 'done'
      ? 'DONE'
      : action.presses.map((p) => `${p.buttons.join(',') || '-'} ${p.hold} ${p.wait}`).join(';')
  return save ? `SAVE:${save};${body}` : body
}

const waitReply = (frames: number) => encode({ kind: 'press', presses: [{ buttons: [], hold: 1, wait: frames }], reason: 'wait' })

// BizHawk's --url_get flag needs something to answer here; it also works as a health check.
app.get('/', (_req, res) => {
  res.type('text').send('emerald-jev ok')
})

// The Lua script asks where to save screenshots, so both sides agree on one absolute path.
// (BizHawk runs scripts from their own folder, so a relative path would land somewhere else.)
// It's also the first thing the script asks, so it marks the start of a new session (possibly
// from a loaded save state): forget anything learned about the previous one.
app.get('/screenshot-path', (_req, res) => {
  session = new Session()
  console.log('new session: BizHawk script connected')
  res.type('text').send(path.join(RUNS_DIR, 'frame.png'))
})

// Queue a save state; the script saves it on its next step. Used by `npm run save -- <name>`.
app.post('/save', (req, res) => {
  const file = queueSave(String(req.query.name ?? 'manual'))
  console.log(`queued save state ${file}`)
  res.type('text').send(file)
})

// comm.httpPost sends a form field called "payload".
app.post('/step', express.urlencoded({ extended: false, limit: '1mb' }), async (req, res) => {
  res.type('text')
  step++

  let state: GameState
  try {
    state = gameStateSchema.parse(JSON.parse(String(req.body?.payload ?? '')))
  } catch (err) {
    console.error(`[step ${step}] bad payload`, err)
    res.send(waitReply(60))
    return
  }

  if (state.gameCode !== EXPECTED_GAME_CODE) {
    console.error(`[step ${step}] wrong game "${state.gameCode}", expected ${EXPECTED_GAME_CODE}`)
    res.send('DONE')
    return
  }

  const facts = state.raw ? decodeFacts(state.raw, state.inBattle) : null
  const map = mapNameFor(state.mapGroup, state.mapNum)

  if (DRY_RUN) {
    // Watch memory while playing by hand; press nothing.
    // Keep the frames Jev would have been asked about, to test the questions offline later.
    console.log(
      `[dry ${step}] ${map ?? `map ${state.mapGroup}/${state.mapNum}`} (${state.x},${state.y})` +
        `${state.inBattle ? ' BATTLE' : ''}${state.controlsLocked ? ' locked' : ''}${state.overworld ? '' : ' menu'}`,
    )
    if (facts) console.log(`         ${describeFacts(facts)}`)
    let frame: string | undefined
    if (needsScreen(state)) {
      try {
        frame = saveFrame(step, state.screenshot)
      } catch (err) {
        console.error(`[dry ${step}] couldn't copy the screenshot`, err)
      }
    }
    logStep({ step, dryRun: true, state, frame, facts: loggable(facts) })
    res.send(waitReply(30))
    return
  }

  if (!facts) {
    console.error(`[step ${step}] no raw memory in the payload: update lua/emerald-jev.lua`)
    res.send(waitReply(120))
    return
  }

  // Story progress is only trusted on a known map in the overworld (before that, memory is junk).
  if (map && state.overworld) {
    if (hasFirstBadge(facts)) {
      const action: Action = { kind: 'done', reason: 'won the Stone Badge from Roxanne' }
      console.log(`[step ${step}] DONE: ${action.reason}`)
      queueSave('07-first-badge')
      logStep({ step, state, facts: loggable(facts), action })
      res.send(encode(action))
      return
    }
    const { index } = storyProgress(facts, { map, x: state.x, y: state.y })
    if (session.storyIndex !== -1 && index > session.storyIndex) {
      for (const name of checkpointsBetween(session.storyIndex, index)) {
        console.log(`[step ${step}] checkpoint: ${name}`)
        queueSave(name)
      }
    }
    session.storyIndex = index
  }

  try {
    const { action, calls, frame } = await decide(state, facts, map)
    console.log(`[step ${step}] ${map ?? `${state.mapGroup}/${state.mapNum}`} (${state.x},${state.y}) -> ${action.reason}`)
    logStep({ step, state, facts: loggable(facts), frame, jev: calls, action })
    res.send(encode(action))
  } catch (err) {
    // Never press anything on a failed call; wait and look again.
    console.error(`[step ${step}] Jev call failed`, err)
    logStep({ step, state, error: String(err) })
    res.send(waitReply(60))
  }
})

// Memory decides when it can; Jev is asked about the screen, moves, and menus otherwise.
async function decide(state: GameState, facts: Facts, map: string | null): Promise<{ action: Action; calls: JevCall[]; frame?: string }> {
  if (!needsScreen(state)) {
    if (!map) return { action: { kind: 'press', presses: [{ buttons: [], hold: 1, wait: 60 }], reason: `off the route's maps (${state.mapGroup}/${state.mapNum})` }, calls: [] }
    return { action: decideOnFoot(state, facts, { map, x: state.x, y: state.y }, session), calls: [] }
  }

  // The battle menus: memory knows exactly when the game is waiting for an action or a move.
  if (state.inBattle && facts.choosingAction) return { action: decideAction(state, facts, session), calls: [] }

  const frame = saveFrame(step, state.screenshot)
  const image = await upscaleFrame(readFileSync(frame))

  if (state.inBattle && facts.choosingMove && facts.player && facts.foe) {
    const { move, call } = await chooseMove(image, facts.player, facts.foe)
    console.log(`         Jev picks ${move ?? '(unsure)'} against ${facts.foe.name} (${facts.foe.types.join('/')})`)
    return { action: decideMove(state, facts, move), calls: [call], frame }
  }

  const { read, call } = await readScreen(image, placeName(map))
  const decision = decideFromScreen(state, facts, map, read, session)
  if (decision.kind !== 'highlight') return { action: decision, calls: [call], frame }

  const cursor = await readHighlighted(image, decision.menu, decision.options)
  return { action: pressesForHighlight(decision, cursor.highlighted, state), calls: [call, cursor.call], frame }
}

// Facts without the lookup functions, for the JSON log.
function loggable(f: Facts | null) {
  return f && { ...f, flag: undefined, variable: undefined }
}

// One line for a person watching a dry run: is memory being read right?
function describeFacts(f: Facts): string {
  const mon = (m: Facts['party0']) =>
    m ? `${m.name} Lv${m.level} ${m.hp}/${m.maxHp}HP [${m.moves.map((x) => `${x.name} ${x.pp}pp`).join(', ')}]` : 'none'
  const parts = [`party: ${mon(f.party0)}`, `potions: ${f.potions}`, `money: ¥${f.money}`]
  if (f.player || f.foe) {
    parts.push(`battle: ${mon(f.player)} vs ${f.foe ? `${f.foe.name} Lv${f.foe.level} ${f.foe.hp}/${f.foe.maxHp}HP (${f.foe.types.join('/')})` : '?'}`)
    parts.push(`choosing: ${f.choosingAction ? `action (cursor ${f.actionCursor})` : f.choosingMove ? `move (cursor ${f.moveCursor})` : 'no'}`)
  }
  return parts.join(' | ')
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`emerald-jev listening on http://127.0.0.1:${PORT}${DRY_RUN ? ' (dry run: no Jev, no buttons)' : ''}`)
  console.log(`logging to ${logPath}`)
})
