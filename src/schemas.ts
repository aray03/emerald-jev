import { z } from 'zod'

// What lua/emerald-jev.lua reads from memory and sends each step.
export const gameStateSchema = z.object({
  frame: z.number().int(),
  speedPercent: z.number().int().positive().default(100), // emulator speed set by the Lua script
  gameCode: z.string(),
  mapGroup: z.number().int(),
  mapNum: z.number().int(),
  x: z.number().int(),
  y: z.number().int(),
  inBattle: z.boolean(),
  controlsLocked: z.boolean(),
  overworld: z.boolean(),
  battleFlags: z.number().int(),
  battleOutcome: z.number().int(),
  vars: z.object({
    introState: z.number().int(),
    townState: z.number().int(),
    route101State: z.number().int(),
    birchLabState: z.number().int(),
  }),
  screenshot: z.string(),
})
export type GameState = z.infer<typeof gameStateSchema>

export type Dir = 'Up' | 'Down' | 'Left' | 'Right'
export type Button = Dir | 'A' | 'B' | 'Start' | 'Select' | 'L' | 'R'

// One press: buttons held for `hold` frames, then released for `wait` frames.
export type Press = { buttons: Button[]; hold: number; wait: number }
export type Action = { kind: 'press'; presses: Press[]; reason: string } | { kind: 'done'; reason: string }
