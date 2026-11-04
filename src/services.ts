import type { Goal } from './goals.ts'
import { canAttack, martStock, type Facts } from './memory.ts'
import type { Pos } from './nav.ts'
import type { Session } from './session.ts'

// The user's rules for looking after Torchic, which take priority over the story:
//   - the first time in each town, heal at the Pokémon Center, then buy Potions at the Mart
//   - keep at least MIN_POTIONS Potions when shopping
//   - below 1/3 HP outside battle: drink a Potion, or go to the nearest Pokémon Center if there are none
//   - out of PP in every attacking move: go to the nearest Pokémon Center

export const MIN_POTIONS = 6
export const POTION_PRICE = 300

// Each Center and Mart has the same layout: talk to the nurse from (7,4) facing up, and to the
// clerk from (3,3) facing left. Dewford has no Mart.
const TOWNS: Record<string, { center: string; mart?: string }> = {
  OldaleTown: { center: 'OldaleTown_PokemonCenter_1F', mart: 'OldaleTown_Mart' },
  PetalburgCity: { center: 'PetalburgCity_PokemonCenter_1F', mart: 'PetalburgCity_Mart' },
  RustboroCity: { center: 'RustboroCity_PokemonCenter_1F', mart: 'RustboroCity_Mart' },
  DewfordTown: { center: 'DewfordTown_PokemonCenter_1F' },
  SlateportCity: { center: 'SlateportCity_PokemonCenter_1F', mart: 'SlateportCity_Mart' },
  MauvilleCity: { center: 'MauvilleCity_PokemonCenter_1F', mart: 'MauvilleCity_Mart' },
}

export function townOf(map: string): string | null {
  for (const [town, { center, mart }] of Object.entries(TOWNS)) if (map === town || map === center || map === mart) return town
  return null
}

export const isLowHp = (hp: number, maxHp: number) => maxHp > 0 && hp * 3 < maxHp

const NURSE = { x: 7, y: 4 }
const nurseGoal = (town: string, why = 'heal'): Goal => ({ name: `${why} at the ${town} Pokémon Center`, to: { map: TOWNS[town]!.center, ...NURSE }, face: 'Up' })

// The Pokémon Center the fewest steps away, by the same pathfinding the bot walks with.
function nearestCenterTown(pos: Pos, session: Session): string {
  let best = session.lastTown
  let bestSteps = Infinity
  for (const [town, { center }] of Object.entries(TOWNS)) {
    const steps = session.nav.distance(pos, { map: center, ...NURSE })
    if (steps !== null && steps < bestSteps) {
      best = town
      bestSteps = steps
    }
  }
  return best
}
const clerkGoal = (town: string, mart: string): Goal => ({ name: `buy Potions at the ${town} Mart`, to: { map: mart, x: 3, y: 3 }, face: 'Left' })

// A goal that takes priority over the story, 'use-potion' to drink one now, or null.
export function serviceGoal(pos: Pos, f: Facts, session: Session): Goal | 'use-potion' | null {
  const mon = f.party0
  const town = townOf(pos.map)
  if (town) session.lastTown = town

  // Talking to the nurse or clerk finishes once the player can walk again in that building.
  if (town) {
    const visit = session.town(town)
    if (pos.map === TOWNS[town]!.center && visit.talkedToNurse && mon && mon.hp === mon.maxHp) visit.healed = true
    if (pos.map === TOWNS[town]!.mart && visit.talkedToClerk) {
      visit.shopped = true
      session.boughtThisVisit = false
    }
  }

  if (mon && isLowHp(mon.hp, mon.maxHp)) {
    if (f.potions > 0) return 'use-potion'
    return nurseGoal(nearestCenterTown(pos, session), 'heal (no Potions left)')
  }
  // The nurse restores PP too.
  if (mon && !canAttack(mon)) return nurseGoal(nearestCenterTown(pos, session), 'restore PP')

  if (town) {
    const visit = session.town(town)
    if (!visit.healed) return nurseGoal(town)
    if (!visit.shopped) {
      // Mauville's Mart sells no Potions, and Dewford has no Mart at all.
      const mart = TOWNS[town]!.mart
      if (!mart || !martStock(mart, f.flag)?.includes('POTION') || f.potions >= MIN_POTIONS || f.money < POTION_PRICE) visit.shopped = true
      else return clerkGoal(town, mart)
    }
  }
  return null
}

// Called when the bot presses A at a service goal, so the visit can be marked done afterwards.
export function noteTalk(goal: Goal, session: Session) {
  const town = townOf(goal.to.map)
  if (!town) return
  if (goal.to.map === TOWNS[town]!.center) session.town(town).talkedToNurse = true
  if (goal.to.map === TOWNS[town]!.mart) session.town(town).talkedToClerk = true
}

// How many Potions to buy at the quantity box: enough to reach MIN_POTIONS, as money allows.
export function potionsToBuy(f: Facts): number {
  return Math.max(0, Math.min(MIN_POTIONS - f.potions, Math.floor(f.money / POTION_PRICE)))
}
