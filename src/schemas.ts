import { z } from 'zod'

// Raw memory blocks (hex) and words, decoded by src/memory.ts.
export const rawMemorySchema = z.object({
  party0: z.string(),
  battleMons: z.string(),
  actionCursor: z.number().int(),
  moveCursor: z.number().int(),
  controllerFunc: z.number().int(),
  encryptionKey: z.number().int(),
  money: z.number().int(),
  bagItems: z.string(),
  flags: z.string(),
  vars: z.string(),
  moveToLearn: z.number().int().optional(), // missing from scripts older than version 2
  forgetMoveCursor: z.number().int().optional(), // -1 unless choosing a move to forget; version 3+
  objects: z.string().optional(), // gObjectEvents (people and things on the map); version 3+
  pokenavMode: z.number().int().optional(), // -1 unless the PokéNav is open; version 3+
})
export type RawMemory = z.infer<typeof rawMemorySchema>

// What lua/emerald-jev.lua reads from memory and sends each step.
export const gameStateSchema = z.object({
  scriptVersion: z.number().int().default(1),
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
  raw: rawMemorySchema.optional(),
})
export type GameState = z.infer<typeof gameStateSchema>

export type Dir = 'Up' | 'Down' | 'Left' | 'Right'
export type Button = Dir | 'A' | 'B' | 'Start' | 'Select' | 'L' | 'R'

// One press: buttons held for `hold` frames, then released for `wait` frames.
export type Press = { buttons: Button[]; hold: number; wait: number }
export type Action = { kind: 'press'; presses: Press[]; reason: string } | { kind: 'done'; reason: string }
