import type { Dir, GameState } from './schemas.ts'

// Story goals for a male player (Brendan), from pret/pokeemerald map data.
// Coordinates are map tiles, matching data/maps/*/map.json.

export type Tile = { x: number; y: number }

// Walk to `to`, then either press `push` (to go through a door or off the map edge)
// or turn to `face` and press A (to interact with something).
export type Goal = { name: string; to: Tile; push?: Dir; face?: Dir }

export const MAP = {
  truck: [25, 40],
  littleroot: [0, 9],
  oldale: [0, 10],
  route101: [0, 16],
  brendan1F: [1, 0],
  brendan2F: [1, 1],
  may1F: [1, 2],
  may2F: [1, 3],
  lab: [1, 4],
} as const satisfies Record<string, readonly [number, number]>

export type MapName = keyof typeof MAP

// Map sizes in tiles, for pathfinding bounds.
export const MAP_SIZE: Record<MapName, { w: number; h: number }> = {
  truck: { w: 5, h: 5 },
  littleroot: { w: 20, h: 20 },
  oldale: { w: 20, h: 20 },
  route101: { w: 20, h: 20 },
  brendan1F: { w: 11, h: 9 },
  brendan2F: { w: 9, h: 8 },
  may1F: { w: 11, h: 9 },
  may2F: { w: 9, h: 8 },
  lab: { w: 13, h: 13 },
}

// Doors and stairs (warp_events in each map.json). Stepping onto one changes the map, so
// pathfinding must never walk across one unless it's the goal.
export const WARPS: Record<MapName, Tile[]> = {
  truck: [{ x: 4, y: 1 }, { x: 4, y: 2 }, { x: 4, y: 3 }],
  littleroot: [{ x: 14, y: 8 }, { x: 5, y: 8 }, { x: 7, y: 16 }],
  oldale: [{ x: 5, y: 7 }, { x: 15, y: 16 }, { x: 6, y: 16 }, { x: 14, y: 6 }],
  route101: [],
  brendan1F: [{ x: 9, y: 8 }, { x: 8, y: 8 }, { x: 8, y: 2 }],
  brendan2F: [{ x: 7, y: 1 }],
  may1F: [{ x: 1, y: 8 }, { x: 2, y: 8 }, { x: 2, y: 2 }],
  may2F: [{ x: 1, y: 1 }],
  lab: [{ x: 6, y: 12 }, { x: 7, y: 12 }],
}

export function mapName(s: GameState): MapName | null {
  for (const [name, [g, n]] of Object.entries(MAP)) {
    if (s.mapGroup === g && s.mapNum === n) return name as MapName
  }
  return null
}

// VAR_LITTLEROOT_INTRO_STATE: 4 told to set clock, 6 clock set, 7 told to meet rival.
// VAR_LITTLEROOT_TOWN_STATE: 1 met rival, 2 saving Birch, 3 received Pokédex.
// VAR_BIRCH_LAB_STATE: 3 or more once Birch has given the starter and released the player.
export function goalFor(s: GameState): Goal | null {
  const { introState, townState, birchLabState } = s.vars
  const hasStarter = birchLabState >= 3

  switch (mapName(s)) {
    case 'truck':
      return { name: 'leave the truck', to: { x: 4, y: 2 }, push: 'Right' }
    case 'brendan1F':
      if (introState <= 5) return { name: 'go upstairs to set the clock', to: { x: 8, y: 2 } }
      return { name: 'leave the house', to: { x: 8, y: 8 }, push: 'Down' }
    case 'brendan2F':
      if (introState < 6) return { name: 'set the wall clock', to: { x: 5, y: 2 }, face: 'Up' }
      return { name: 'go downstairs', to: { x: 7, y: 1 } }
    case 'littleroot':
      if (townState === 0) return { name: "visit the rival's house", to: { x: 14, y: 9 }, push: 'Up' }
      // y=0 is the top row; pushing Up from there crosses onto Route 101. The walk passes (11,1),
      // where the girl's "go see what's happening" scene triggers.
      return { name: 'head north to Route 101', to: { x: 11, y: 0 }, push: 'Up' }
    case 'may1F':
      if (townState === 0) return { name: "go up to the rival's room", to: { x: 2, y: 2 } }
      return { name: "leave the rival's house", to: { x: 2, y: 8 }, push: 'Down' }
    case 'may2F':
      if (townState === 0) return { name: "check the rival's Poké Ball", to: { x: 5, y: 5 }, face: 'Up' }
      return { name: 'go downstairs', to: { x: 1, y: 1 } }
    case 'route101':
      if (!hasStarter) return { name: "open Birch's bag", to: { x: 7, y: 15 }, face: 'Up' }
      return { name: 'head north to Oldale Town', to: { x: 11, y: 0 }, push: 'Up' }
    case 'lab':
      return { name: 'leave the lab', to: { x: 6, y: 12 }, push: 'Down' }
    default:
      return null
  }
}
