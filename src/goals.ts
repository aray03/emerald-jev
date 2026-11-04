import type { Facts } from './memory.ts'
import { MAPS, type Navigator, type Pos } from './nav.ts'
import type { Dir } from './schemas.ts'

// Story goals for a male player (Brendan) from New Game to the third badge, as an ordered list.
// The first step that isn't done gives the goal. Coordinates are map tiles from pokeemerald's
// data/maps/*/map.json; flag and variable ids from include/constants/{flags,vars}.h.

// Walk to `to`, then either press `push` (through a door, exit mat or edge with no warp data)
// or turn to `face` and press A (talk to someone, use something). With neither, arriving is enough.
export type Goal = { name: string; to: Pos; push?: Dir; face?: Dir }

export const FLAG = {
  DEFEATED_RIVAL_ROUTE103: 0x82,
  RECEIVED_POTION_OLDALE: 0x84,
  ADVENTURE_STARTED: 0x74, // received the Pokédex
  MAUVILLE_GYM_BARRIERS_STATE: 0x63, // set while the gym's barriers are switched (reset on entering from the city)
  RECOVERED_DEVON_GOODS: 0x8f,
  RETURNED_DEVON_GOODS: 0x90,
  DOCK_REJECTED_DEVON_GOODS: 0x94, // Dock sends you to the museum, and the Aqua queue outside it leaves
  DELIVERED_DEVON_GOODS: 0x95,
  RECEIVED_POKENAV: 0xbc,
  DELIVERED_STEVEN_LETTER: 0xbd,
  DEFEATED_WALLY_MAUVILLE: 0xbe,
  HIDE_ROUTE_109_MR_BRINEY: 0x2e5, // set from New Game; cleared when his boat lands on Route 109
  SYS_POKEMON_GET: 0x860,
  SYS_POKEDEX_GET: 0x861,
  SYS_POKENAV_GET: 0x862,
  BADGE01_GET: 0x867,
  BADGE02_GET: 0x868,
  BADGE03_GET: 0x869,
  VISITED_DEWFORD_TOWN: 0x871,
  VISITED_SLATEPORT_CITY: 0x877,
} as const

export const VAR = {
  LITTLEROOT_TOWN_STATE: 0x4050, // 1 met rival, 2 saving Birch, 3 got Pokédex, 4 got Running Shoes
  PETALBURG_CITY_STATE: 0x4057,
  RUSTBORO_CITY_STATE: 0x405a, // 2 goods stolen, 4 recovered, 5 returned, 6 got PokéNav, 7 Match Call, 8 met rival
  ROUTE110_STATE: 0x4069, // 1 beat the rival
  BOARD_BRINEY_BOAT_STATE: 0x408e, // 1 while the boat to Dewford is about to leave
  BIRCH_LAB_STATE: 0x4084, // 3 got starter, 4 beat rival on Route 103, 5 got Pokédex
  PETALBURG_GYM_STATE: 0x4085, // 0 not met Norman, 1 met Norman, 2 Wally's tutorial done
  LITTLEROOT_INTRO_STATE: 0x4092, // 4 told to set clock, 6 clock set, 7 told to meet rival
  PETALBURG_WOODS_STATE: 0x4098, // 1 beat the Team Aqua grunt
} as const

const at = (map: string, x: number, y: number): Pos => ({ map, x, y })

// Levels to reach before each gym, and where to train for them, pacing between two tiles where
// wild Pokémon appear. The nearest Pokémon Center is used for healing along the way.
//   Roxanne (Lv 15 Nosepass): Rusturf Tunnel, just inside the west entrance, Whismur Lv 5-8.
//   Brawly (Lv 19 Makuhita): Granite Cave 1F by the entrance (Zubat, Makuhita, Geodude, Abra). Dewford's Center.
//   Wattson (Lv 24 Manectric): Route 110 tall grass south of Mauville, Lv 12-13. Mauville's Center.
export const ROXANNE_LEVEL = 16
export const BRAWLY_LEVEL = 21
export const WATTSON_LEVEL = 26

// `checkpoint` names the save state made the moment this step is done.
type Step = { done: (f: Facts) => boolean; goal: (f: Facts, pos: Pos, nav?: Navigator) => Goal; checkpoint?: string }

function train(level: number, place: string, spot: [Pos, Pos], checkpoint: string): Step {
  return {
    done: (f) => (f.party0?.level ?? 0) >= level,
    goal: (_f, pos) => {
      const [a, b] = spot
      const onA = pos.map === a.map && pos.x === a.x && pos.y === a.y
      return { name: `train to level ${level} in ${place}`, to: onA ? b : a }
    },
    checkpoint,
  }
}

const TOWARD: Record<Dir, { x: number; y: number }> = { Up: { x: 0, y: -1 }, Down: { x: 0, y: 1 }, Left: { x: -1, y: 0 }, Right: { x: 1, y: 0 } }
const OPPOSITE: Record<Dir, Dir> = { Up: 'Down', Down: 'Up', Left: 'Right', Right: 'Left' }

// Talk to someone who walks around (Mr. Briney in his house): stand next to where memory says
// they are now, on the side the fewest steps away, and face them. Before reaching their map,
// head for where they start.
function talkTo(name: string, map: string, localId: number, start: Pos, f: Facts, pos: Pos, nav?: Navigator): Goal {
  const m = MAPS[map]
  const ids = m ? { group: m.group, num: m.num } : null
  const who = f.objects.find((o) => o.localId === localId && ids && o.mapGroup === ids.group && o.mapNum === ids.num)
  const there = who ? at(map, who.x, who.y) : start
  let best: Goal | null = null
  let bestSteps = Infinity
  for (const side of Object.keys(TOWARD) as Dir[]) {
    const to = at(map, there.x + TOWARD[side].x, there.y + TOWARD[side].y)
    if (m?.rows[to.y]?.[to.x] !== '.') continue
    if (f.objects.some((o) => o.mapGroup === m.group && o.mapNum === m.num && o.x === to.x && o.y === to.y)) continue
    const steps = nav ? nav.distance(pos, to) : 0
    if (steps !== null && steps < bestSteps) {
      best = { name, to, face: OPPOSITE[side] }
      bestSteps = steps
    }
  }
  return best ?? { name, to: at(map, there.x, there.y + 1), face: 'Up' }
}

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
  train(ROXANNE_LEVEL, 'Rusturf Tunnel', [at('RusturfTunnel', 4, 8), at('RusturfTunnel', 5, 8)], '06-level-16'),
  {
    done: (f) => f.flag(FLAG.BADGE01_GET),
    goal: () => ({ name: 'challenge Roxanne', to: at('RustboroCity_Gym', 5, 3), face: 'Up' }),
    checkpoint: '07-first-badge',
  },

  // ---------- Badge 1 to Dewford: the Devon Goods, then Mr. Briney's boat ----------
  {
    // Leaving the gym, any tile of column 23 starts the theft scene.
    done: (f) => f.variable(VAR.RUSTBORO_CITY_STATE) >= 2,
    goal: () => ({ name: 'see the Devon Goods stolen', to: at('RustboroCity', 23, 21) }),
  },
  {
    // The grunt waits at the far end of the tunnel's middle corridor, with Peeko.
    done: (f) => f.flag(FLAG.RECOVERED_DEVON_GOODS),
    goal: () => ({ name: 'beat the Team Aqua grunt in Rusturf Tunnel', to: at('RusturfTunnel', 13, 5), face: 'Right' }),
    checkpoint: '08-recovered-goods',
  },
  {
    // Back in Rustboro, the Devon employee's trigger tiles take the goods and warp you to Devon 3F.
    done: (f) => f.flag(FLAG.RETURNED_DEVON_GOODS),
    goal: () => ({ name: 'return the Devon Goods', to: at('RustboroCity', 31, 10) }),
  },
  {
    // A scene on arrival leads you to Mr. Stone; talk to him if it ever ends before the PokéNav.
    done: (f) => f.flag(FLAG.RECEIVED_POKENAV),
    goal: () => ({ name: 'get the PokéNav from Mr. Stone', to: at('RustboroCity_DevonCorp_3F', 14, 5), face: 'Right' }),
  },
  {
    // Stepping out of Devon Corp, a scientist adds Match Call and makes you open the PokéNav.
    done: (f) => f.variable(VAR.RUSTBORO_CITY_STATE) >= 7,
    goal: () => ({ name: 'leave Devon Corp', to: at('RustboroCity', 11, 16) }),
  },
  {
    // The rival waits across Rustboro's south exit; every tile of row 53 meets her.
    done: (f) => f.variable(VAR.RUSTBORO_CITY_STATE) >= 8,
    goal: () => ({ name: 'meet the rival at the south exit of Rustboro', to: at('RustboroCity', 15, 53) }),
  },
  {
    // Mr. Briney walks around his house. Once you say YES, you're warped onto Route 104 and the
    // boat leaves on its own.
    done: (f) => f.flag(FLAG.VISITED_DEWFORD_TOWN),
    goal: (f, pos, nav) =>
      pos.map === 'Route104' && f.variable(VAR.BOARD_BRINEY_BOAT_STATE) === 1
        ? { name: "board Mr. Briney's boat", to: pos }
        : talkTo('ask Mr. Briney to sail to Dewford', 'Route104_MrBrineysHouse', 1, at('Route104_MrBrineysHouse', 9, 3), f, pos, nav),
    checkpoint: '09-dewford',
  },

  // ---------- Dewford: Steven in Granite Cave, then Brawly ----------
  {
    done: (f) => f.flag(FLAG.DELIVERED_STEVEN_LETTER),
    goal: () => ({ name: 'give the letter to Steven in Granite Cave', to: at('GraniteCave_StevensRoom', 7, 7), face: 'Down' }),
    checkpoint: '10-steven-letter',
  },
  train(BRAWLY_LEVEL, 'Granite Cave', [at('GraniteCave_1F', 36, 11), at('GraniteCave_1F', 37, 11)], '11-level-21'),
  {
    done: (f) => f.flag(FLAG.BADGE02_GET),
    goal: () => ({ name: 'challenge Brawly', to: at('DewfordTown_Gym', 4, 4), face: 'Up' }),
    checkpoint: '12-second-badge',
  },

  // ---------- Slateport: the Devon Goods for Captain Stern ----------
  {
    // Briney stands by his boat; his menu is PETALBURG / SLATEPORT / EXIT (policy picks SLATEPORT).
    // (Not "Briney gone from Dewford": whiting out before visiting Dewford's Center sends him home.)
    done: (f) => !f.flag(FLAG.HIDE_ROUTE_109_MR_BRINEY) || f.flag(FLAG.VISITED_SLATEPORT_CITY),
    goal: () => ({ name: 'ask Mr. Briney to sail to Slateport', to: at('DewfordTown', 11, 9), face: 'Right' }),
  },
  {
    // The boat lands on Route 109's beach, just south of Slateport.
    done: (f) => f.flag(FLAG.VISITED_SLATEPORT_CITY),
    goal: () => ({ name: 'walk up the beach to Slateport', to: at('SlateportCity', 18, 58) }),
  },
  {
    // A queue of Team Aqua grunts blocks the museum until Dock in the shipyard sends you there.
    done: (f) => f.flag(FLAG.DOCK_REJECTED_DEVON_GOODS),
    goal: () => ({ name: "talk to Dock in Stern's Shipyard", to: at('SlateportCity_SternsShipyard_1F', 4, 5), face: 'Right' }),
  },
  {
    // The museum fee is ¥50 (YES). Captain Stern's scene has two grunt battles back to back.
    done: (f) => f.flag(FLAG.DELIVERED_DEVON_GOODS),
    goal: () => ({ name: 'give the Devon Goods to Captain Stern', to: at('SlateportCity_OceanicMuseum_2F', 12, 6), face: 'Right' }),
    checkpoint: '13-delivered-goods',
  },

  // ---------- Route 110 and Mauville: Wattson ----------
  {
    // The rival blocks Route 110's middle; tiles (33-35,56) start her battle.
    done: (f) => f.variable(VAR.ROUTE110_STATE) >= 1,
    goal: () => ({ name: 'battle the rival on Route 110', to: at('Route110', 34, 56) }),
  },
  {
    // Wally stands in front of the gym door and has to be beaten first (answer YES).
    done: (f) => f.flag(FLAG.DEFEATED_WALLY_MAUVILLE),
    goal: () => ({ name: 'battle Wally outside the Mauville Gym', to: at('MauvilleCity', 8, 7), face: 'Up' }),
  },
  train(WATTSON_LEVEL, 'the Route 110 grass', [at('Route110', 4, 33), at('Route110', 4, 34)], '14-level-26'),
  {
    // Switch 3 opens the barrier to Wattson. Mauville resets the switches whenever you come in
    // from the city, so this step comes back after leaving the gym.
    done: (f) => f.flag(FLAG.BADGE03_GET) || f.flag(FLAG.MAUVILLE_GYM_BARRIERS_STATE),
    goal: () => ({ name: 'step on the Mauville Gym switch', to: at('MauvilleCity_Gym', 3, 9) }),
  },
  {
    done: (f) => f.flag(FLAG.BADGE03_GET),
    goal: () => ({ name: 'challenge Wattson', to: at('MauvilleCity_Gym', 5, 3), face: 'Up' }),
    checkpoint: '15-third-badge',
  },
]

// How far through the story we are: the index of the first step not done (STEPS.length when
// the last badge is won) and that step's goal.
export function storyProgress(f: Facts, pos: Pos, nav?: Navigator): { index: number; goal: Goal | null } {
  const index = STEPS.findIndex((s) => !s.done(f))
  if (index === -1) return { index: STEPS.length, goal: null }
  return { index, goal: STEPS[index]!.goal(f, pos, nav) }
}

// Save-state names for the steps finished between two progress indexes.
export function checkpointsBetween(from: number, to: number): string[] {
  return STEPS.slice(Math.max(0, from), to).flatMap((s) => (s.checkpoint ? [s.checkpoint] : []))
}

export const storyComplete = (f: Facts) => STEPS.every((s) => s.done(f))
