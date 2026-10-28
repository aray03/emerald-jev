import { readFileSync } from 'node:fs'
import express from 'express'
import { readScreen, upscaleFrame } from './jev.ts'
import { logPath, logStep, saveFrame } from './log.ts'
import { Navigator } from './nav.ts'
import { decideFromScreen, decideOnFoot, isDone, needsScreen } from './policy.ts'
import { screenQuestions } from './questions.ts'
import { gameStateSchema, type Action } from './schemas.ts'

const PORT = Number(process.env.EMERALD_PORT ?? 3100)
const DRY_RUN = process.env.DRY_RUN === '1'
const EXPECTED_GAME_CODE = 'BPEE' // Pokémon Emerald (USA, Europe)

const app = express()
const nav = new Navigator()
let step = 0

// Reply format read by lua/emerald-jev.lua:
//   presses joined by ";", each "<buttons joined by , or -> <hold frames> <wait frames>", or "DONE".
function encode(action: Action): string {
  if (action.kind === 'done') return 'DONE'
  return action.presses.map((p) => `${p.buttons.join(',') || '-'} ${p.hold} ${p.wait}`).join(';')
}

const waitReply = (frames: number) => `- 1 ${frames}`

// BizHawk's --url_get flag needs something to answer here; it also works as a health check.
app.get('/', (_req, res) => {
  res.type('text').send('emerald-jev ok')
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
    console.log(`[dry ${step}]`, JSON.stringify({ ...state, screenshot: undefined }))
    logStep({ step, dryRun: true, state })
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

app.listen(PORT, '127.0.0.1', () => {
  console.log(`emerald-jev listening on http://127.0.0.1:${PORT}${DRY_RUN ? ' (dry run: no Jev, no buttons)' : ''}`)
  console.log(`logging to ${logPath}`)
})
