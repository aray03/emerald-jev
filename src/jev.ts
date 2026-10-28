import { image, TypeSafeClient, type SystemOneResult } from '@typesafe-ai/sdk'
import sharp from 'sharp'
import { NO_THRESHOLD, SCREEN_KIND_MIN_PROBABILITY, screenQuestions, YES_THRESHOLD } from './questions.ts'

// Created on first use, so dry runs work without an API key.
let client: TypeSafeClient | null = null

export type ScreenKind = keyof (typeof screenQuestions)['screen_kind']['criteria']
export type Status = 'yes' | 'no' | 'unclear'

export type ScreenRead = {
  kind: ScreenKind | 'unclear'
  kindProbability: number
  textBox: Status
  yesNo: Status
  cursorOnYes: Status
  asksNickname: Status
  battleActions: Status
  battleMoves: Status
  raw: SystemOneResult<typeof screenQuestions>['answers']
  inputTokens: number | null
}

function statusFor(p: number): Status {
  if (p > YES_THRESHOLD) return 'yes'
  if (p < NO_THRESHOLD) return 'no'
  return 'unclear'
}

// TypeSafe needs each side to be 280–1568 px; a GBA frame is 240×160, so scale 2x with hard pixels.
export async function upscaleFrame(png: Buffer): Promise<Buffer> {
  const { width = 240, height = 160 } = await sharp(png).metadata()
  return sharp(png)
    .resize(width * 2, height * 2, { kernel: 'nearest' })
    .png()
    .toBuffer()
}

// Errors propagate: a failed call must never be read as an answer.
export async function readScreen(frame: Buffer): Promise<ScreenRead> {
  client ??= new TypeSafeClient()
  const { answers, usage } = await client.systemOne(
    { state: { screen: image(frame) }, questions: screenQuestions },
    { headers: { 'TypeSafe-Danger-Zone-Images': 'true' } },
  )

  const kind = answers.screen_kind.choice
  const kindProbability = answers.screen_kind.probabilities[kind]

  return {
    kind: kindProbability >= SCREEN_KIND_MIN_PROBABILITY ? kind : 'unclear',
    kindProbability,
    textBox: statusFor(answers.text_box_open.noul),
    yesNo: statusFor(answers.yes_no_open.noul),
    cursorOnYes: statusFor(answers.cursor_on_yes.noul),
    asksNickname: statusFor(answers.asks_nickname.noul),
    battleActions: statusFor(answers.battle_actions_open.noul),
    battleMoves: statusFor(answers.battle_moves_open.noul),
    raw: answers,
    inputTokens: usage.input_tokens,
  }
}
