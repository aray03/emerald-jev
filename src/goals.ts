import type { Facts } from './memory.ts'
import type { Pos } from './nav.ts'
import type { Dir } from './schemas.ts'

// Story goals for a male player (Brendan) from New Game to the first badge, as an ordered list.
// The first step that isn't done gives the goal. Coordinates are map tiles from pokeemerald's
// data/maps/*/map.json; flag and variable ids from include/constants/{flags,vars}.h.

// Walk to `to`, then either press `push` (through a door, exit mat or edge with no warp data)
// or turn to `face` and press A (talk to someone, use something). With neither, arriving is enough.
export type Goal = { name: string; to: Pos; push?: Dir; face?: Dir }

export const FLAG = {
  DEFEATED_RIVAL_ROUTE103: 0x82,
  RECEIVED_POTION_OLDALE: 0x84,
  ADVENTURE_STARTED: 0x74, // received the Pokédex
  SYS_POKEMON_GET: 0x860,
  SYS_POKEDEX_GET: 0x861,
  SYS_POKENAV_GET: 0x862,
  BADGE01_GET: 0x867,
} as const

export const VAR = {
  LITTLEROOT_TOWN_STATE: 0x4050, // 1 met rival, 2 saving Birch, 3 got Pokédex, 4 got Running Shoes
  PETALBURG_CITY_STATE: 0x4057,
  BIRCH_LAB_STATE: 0x4084, // 3 got starter, 4 beat rival on Route 103, 5 got Pokédex
  PETALBURG_GYM_STATE: 0x4085, // 0 not met Norman, 1 met Norman, 2 Wally's tutorial done
  LITTLEROOT_INTRO_STATE: 0x4092, // 4 told to set clock, 6 clock set, 7 told to meet rival
  PETALBURG_WOODS_STATE: 0x4098, // 1 beat the Team Aqua grunt
} as const

const at = (map: string, x: number, y: number): Pos => ({ map, x, y })

// Train in Rusturf Tunnel (east of Rustboro along Route 116), where every wild Pokémon is a
// Whismur (Lv 5-8). In caves they appear on any floor tile, so pace just inside the west
// entrance, before the rocks that need Rock Smash. Rustboro's Pokémon Center is the nearest.
export const TRAINING_LEVEL = 16
const TRAINING_SPOT: [Pos, Pos] = [at('RusturfTunnel', 4, 8), at('RusturfTunnel', 5, 8)]

// `checkpoint` names the save state made the moment this step is done.
type Step = { done: (f: Facts) => boolean; goal: (f: Facts, pos: Pos) => Goal; checkpoint?: string }

const STEPS: Step[] = [
  {
    done: (f) => f.variable(VAR.LITTLEROOT_INTRO_STATE) >= 3,
    goal: () => ({ name: 'leave the truck', to: at('InsideOfTruck', 4, 2), push: 'Right' }),
  },
  {
    done: (f) => f.variable(VAR.LITTLEROOT_INTRO_STATE) >= 6,
    goal: () => ({ name: 'set the wall clock', to: at('LittlerootTown_BrendansHouse_2F', 5, 2), face: 'Up' }),
  },
  {
    done: (f) => f.variable(VAR.LITTLEROOT_TOWN_STATE) >= 1,
    goal: () => ({ name: "check the rival's Poké Ball", to: at('LittlerootTown_MaysHouse_2F', 5, 5), face: 'Up' }),
  },
  {
    // The girl at the north exit sends you to help Birch when you step on (11,1).
    done: (f) => f.variable(VAR.LITTLEROOT_TOWN_STATE) >= 2,
    goal: () => ({ name: 'head for Route 101', to: at('LittlerootTown', 11, 1) }),
  },
  {
    done: (f) => f.variable(VAR.BIRCH_LAB_STATE) >= 3,
    goal: () => ({ name: "open Birch's bag", to: at('Route101', 7, 15), face: 'Up' }),
    checkpoint: '01-got-starter',
  },
  {
    done: (f) => f.flag(FLAG.RECEIVED_POTION_OLDALE),
    goal: () => ({ name: 'get the free Potion in Oldale', to: at('OldaleTown', 13, 15), face: 'Up' }),
  },
  {
    done: (f) => f.flag(FLAG.DEFEATED_RIVAL_ROUTE103) || f.variable(VAR.BIRCH_LAB_STATE) >= 4,
    goal: () => ({ name: 'battle the rival on Route 103', to: at('Route103', 10, 4), face: 'Up' }),
    checkpoint: '02-beat-rival',
  },
  {
    // Walking into the lab starts the Pokédex scene on its own.
    done: (f) => f.flag(FLAG.ADVENTURE_STARTED),
    goal: () => ({ name: 'get the Pokédex in the lab', to: at('LittlerootTown_ProfessorBirchsLab', 6, 11) }),
    checkpoint: '03-got-pokedex',
  },
  {
    done: (f) => f.variable(VAR.PETALBURG_GYM_STATE) >= 1,
    goal: () => ({ name: 'talk to Dad in the Petalburg Gym', to: at('PetalburgCity_Gym', 4, 108), face: 'Up' }),
  },
  {
    // Wally's catching lesson plays out as a cutscene after talking to Dad.
    done: (f) => f.variable(VAR.PETALBURG_GYM_STATE) >= 2,
    goal: () => ({ name: "watch Wally's catching lesson", to: at('PetalburgCity_Gym', 4, 108) }),
    checkpoint: '04-after-wally',
  },
  {
    // Stepping here starts the Team Aqua grunt battle, the only way through the woods.
    done: (f) => f.variable(VAR.PETALBURG_WOODS_STATE) >= 1,
    goal: () => ({ name: 'get through Petalburg Woods', to: at('PetalburgWoods', 26, 23) }),
    checkpoint: '05-beat-aqua-grunt',
  },
  {
    done: (f) => (f.party0?.level ?? 0) >= TRAINING_LEVEL,
    goal: (_f, pos) => ({
      name: `train to level ${TRAINING_LEVEL} in Rusturf Tunnel`,
      // Pace between two grass tiles.
      to: pos.map === TRAINING_SPOT[0].map && pos.x === TRAINING_SPOT[0].x && pos.y === TRAINING_SPOT[0].y ? TRAINING_SPOT[1] : TRAINING_SPOT[0],
    }),
    checkpoint: '06-level-16',
  },
  {
    done: (f) => f.flag(FLAG.BADGE01_GET),
    goal: () => ({ name: 'challenge Roxanne', to: at('RustboroCity_Gym', 5, 3), face: 'Up' }),
    checkpoint: '07-first-badge',
  },
]

// How far through the story we are: the index of the first step not done (STEPS.length when
// the badge is won) and that step's goal.
export function storyProgress(f: Facts, pos: Pos): { index: number; goal: Goal | null } {
  const index = STEPS.findIndex((s) => !s.done(f))
  if (index === -1) return { index: STEPS.length, goal: null }
  return { index, goal: STEPS[index]!.goal(f, pos) }
}

// Save-state names for the steps finished between two progress indexes.
export function checkpointsBetween(from: number, to: number): string[] {
  return STEPS.slice(Math.max(0, from), to).flatMap((s) => (s.checkpoint ? [s.checkpoint] : []))
}

export const hasFirstBadge = (f: Facts) => f.flag(FLAG.BADGE01_GET)
