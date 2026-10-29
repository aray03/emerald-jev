import { image, TypeSafeClient, type Questions, type SystemOneResult } from '@typesafe-ai/sdk'
import sharp from 'sharp'
import type { Mon } from './memory.ts'
import {
  bestMoveQuestion,
  CHOICE_MIN_PROBABILITY,
  highlightedQuestion,
  NO_THRESHOLD,
  screenQuestions,
  YES_THRESHOLD,
} from './questions.ts'

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
  asksSwitch: Status
  asksDeleteMove: Status
  learningDoubleKick: Status
}

// Every call is logged with exactly what was sent and what came back.
export type JevCall = { questions: Questions; state: Record<string, unknown>; answers: unknown; inputTokens: number | null }

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
async function ask<Q extends Questions>(frame: Buffer, facts: Record<string, unknown>, questions: Q) {
  client ??= new TypeSafeClient()
  const state = { screen: image(frame), ...facts }
  const { answers, usage } = await client.systemOne(
    { state, questions },
    { headers: { 'TypeSafe-Danger-Zone-Images': 'true' } },
  )
  const call: JevCall = { questions, state: { ...facts, screen: '<frame>' }, answers, inputTokens: usage.input_tokens }
  return { answers: answers as SystemOneResult<Q>['answers'], call }
}

const topChoice = (a: { choice: string; probabilities: Record<string, number> }) => {
  const p = a.probabilities[a.choice] ?? 0
  return { choice: p >= CHOICE_MIN_PROBABILITY ? a.choice : null, probability: p }
}

// What's on screen. `place` is where memory says the player is.
export async function readScreen(frame: Buffer, place: string): Promise<{ read: ScreenRead; call: JevCall }> {
  const { answers, call } = await ask(frame, { place }, screenQuestions)
  const kind = topChoice(answers.screen_kind)
  return {
    read: {
      kind: (kind.choice as ScreenKind | null) ?? 'unclear',
      kindProbability: kind.probability,
      textBox: statusFor(answers.text_box_open.noul),
      yesNo: statusFor(answers.yes_no_open.noul),
      cursorOnYes: statusFor(answers.cursor_on_yes.noul),
      asksNickname: statusFor(answers.asks_nickname.noul),
      asksSwitch: statusFor(answers.asks_switch_pokemon.noul),
      asksDeleteMove: statusFor(answers.asks_delete_move.noul),
      learningDoubleKick: statusFor(answers.learning_double_kick.noul),
    },
    call,
  }
}

// Which move to use, judged by Jev from the real moves and the foe read from memory.
// Returns the chosen move's name, or null if Jev isn't clear.
export async function chooseMove(frame: Buffer, me: Mon, foe: Mon): Promise<{ move: string | null; call: JevCall }> {
  const facts = {
    my_pokemon: { species: me.name, level: me.level, types: me.types, hp: me.hp, max_hp: me.maxHp },
    foe: { species: foe.name, level: foe.level, types: foe.types, hp_percent: Math.round((100 * foe.hp) / Math.max(1, foe.maxHp)) },
  }
  const { answers, call } = await ask(frame, facts, bestMoveQuestion(me.moves))
  return { move: topChoice(answers.best_move).choice, call }
}

// Which entry of a menu the cursor is on, out of `options` (the real entries).
export async function readHighlighted(
  frame: Buffer,
  menu: string,
  options: string[],
): Promise<{ highlighted: string | null; call: JevCall }> {
  const { answers, call } = await ask(frame, {}, highlightedQuestion(menu, options))
  return { highlighted: topChoice(answers.highlighted).choice, call }
}
