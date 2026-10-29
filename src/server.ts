import { readFileSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import { readScreen, upscaleFrame } from './jev.ts'
import { logPath, logStep, RUNS_DIR, saveFrame } from './log.ts'
import { decodeFacts, type Facts } from './memory.ts'
import { Navigator } from './nav.ts'
import { decideFromScreen, decideOnFoot, isDone, needsScreen } from './policy.ts'
import { screenQuestions } from './questions.ts'
import { gameStateSchema, type Action } from './schemas.ts'
import { queueSave, takePendingSave } from './states.ts'

const PORT = Number(process.env.EMERALD_PORT ?? 3100)
const DRY_RUN = process.env.DRY_RUN === '1'
const EXPECTED_GAME_CODE = 'BPEE' // Pokémon Emerald (USA, Europe)

const app = express()
let nav = new Navigator()
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
  nav = new Navigator()
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

  let state
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

  if (DRY_RUN) {
    // Watch memory while playing by hand; press nothing.
    // Keep the frames Jev would have been asked about, to test the questions offline later.
    const facts = state.raw ? decodeFacts(state.raw, state.inBattle) : null
    console.log(
      `[dry ${step}] map ${state.mapGroup}/${state.mapNum} (${state.x},${state.y})` +
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
    logStep({ step, dryRun: true, state, frame, facts: facts && { ...facts, flag: undefined, variable: undefined } })
    res.send(waitReply(30))
    return
  }

  if (isDone(state)) {
    const action: Action = { kind: 'done', reason: 'reached Oldale Town' }
    console.log(`[step ${step}] DONE: reached Oldale Town`)
    logStep({ step, state, action })
    res.send(encode(action))
    return
  }

  if (!needsScreen(state)) {
    const action = decideOnFoot(state, nav)
    console.log(`[step ${step}] ${state.mapGroup}/${state.mapNum} (${state.x},${state.y}) ${action.reason}`)
    logStep({ step, state, action })
    res.send(encode(action))
    return
  }

  try {
    const frame = saveFrame(step, state.screenshot)
    const read = await readScreen(await upscaleFrame(readFileSync(frame)))
    const action = decideFromScreen(state, read)
    console.log(
      `[step ${step}] screen=${read.kind} (${read.kindProbability.toFixed(2)}) tokens=${read.inputTokens} -> ${action.reason}`,
    )
    logStep({ step, state, frame, questions: screenQuestions, answers: read.raw, read: { ...read, raw: undefined }, action })
    res.send(encode(action))
  } catch (err) {
    // Never press anything on a failed call; wait and look again.
    console.error(`[step ${step}] Jev call failed`, err)
    logStep({ step, state, error: String(err) })
    res.send(waitReply(60))
  }
})

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
