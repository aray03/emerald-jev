import { Navigator } from './nav.ts'

// What the bot remembers during one BizHawk session. It is reset when the Lua script
// (re)connects, for example after loading a save state.

// What a multi-screen errand is for, so each menu screen knows what to do:
//   potion        using a Potion from the START menu outside battle
//   battle-potion using a Potion from the battle BAG
export type Intent = 'potion' | 'battle-potion'

export type TownVisit = {
  talkedToNurse: boolean // pressed A at the nurse at least once
  healed: boolean
  talkedToClerk: boolean
  shopped: boolean
}

export class Session {
  nav = new Navigator()
  towns = new Map<string, TownVisit>()
  lastTown = 'OldaleTown' // where to go back to heal
  intent: Intent | null = null
  intentStartHp = 0 // HP when the errand started; a rise means the Potion worked
  boughtThisVisit = false // set at the quantity box so the shop list isn't reopened
  storyIndex = -1 // last seen story progress, for checkpoint saves

  town(name: string): TownVisit {
    let t = this.towns.get(name)
    if (!t) {
      t = { talkedToNurse: false, healed: false, talkedToClerk: false, shopped: false }
      this.towns.set(name, t)
    }
    return t
  }
}
