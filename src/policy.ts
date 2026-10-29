import { goalFor, mapName } from './goals.ts'
import type { ScreenRead } from './jev.ts'
import { Navigator } from './nav.ts'
import type { Action, Button, GameState, Press } from './schemas.ts'

// Decision rules: memory state plus Jev's screen answers -> buttons.
// Memory decides whenever it can; Jev is only consulted when the player can't move freely.

const BATTLE_TYPE_TRAINER = 1 << 3
const BATTLE_TYPE_FIRST_BATTLE = 1 << 4

// Real time between screen checks. Button holds and walking stay in game frames, but these
// gaps scale with emulator speed: at 400% speed, 0.25 s is 60 frames (1 s of game time).
const SCREEN_STEP_SECONDS = 0.25
const SLOW_STEP_SECONDS = 0.5 // cutscenes, battle intros, and moments Jev was unsure about

const framesFor = (s: GameState, seconds: number) => Math.max(1, Math.round(seconds * 60 * (s.speedPercent / 100)))

const press = (buttons: Button[], hold = 6, wait = 20): Press => ({ buttons, hold, wait })
const act = (reason: string, ...presses: Press[]): Action => ({ kind: 'press', presses, reason })
const wait = (reason: string, frames = 30): Action => act(reason, press([], 1, frames))

export const needsScreen = (s: GameState) => s.inBattle || s.controlsLocked || !s.overworld

export function isDone(s: GameState) {
  return mapName(s) === 'oldale' && !needsScreen(s)
}

// The player is in a menu, battle, or cutscene: act on what Jev sees.
export function decideFromScreen(s: GameState, r: ScreenRead): Action {
  if (s.inBattle) return decideBattle(s, r)

  const step = framesFor(s, SCREEN_STEP_SECONDS)
  const slow = framesFor(s, SLOW_STEP_SECONDS)

  // The nickname question is the one YES/NO we answer NO, and it only comes up in Birch's lab.
  // Outside the lab, ignore Jev's nickname answer: confirming the player's own name ("So it's
  // MAY?") reads as name-related and can come back unclear.
  // B is safe whether or not the box is up yet: it picks NO, or just advances the text.
  const inLab = mapName(s) === 'lab'
  if (inLab && r.asksNickname === 'yes') return act('decline the nickname', press(['B'], 6, step))

  if (r.yesNo === 'unclear') return wait('unsure whether a YES/NO box is open', slow)
  if (r.yesNo === 'yes') {
    if (inLab && r.asksNickname === 'unclear') return wait('unsure whether this asks for a nickname', slow)
    if (r.cursorOnYes === 'unclear') return wait('unsure where the YES/NO arrow is', slow)
    if (r.cursorOnYes === 'no') return act('move the arrow to YES', press(['Up'], 4, step))
    return act('answer YES', press(['A'], 6, step))
  }

  switch (r.kind) {
    case 'naming_keyboard':
      // Type "A", jump to OK with Start, confirm.
      return act('enter the name "A"', press(['A'], 4, 15), press(['Start'], 4, 15), press(['A'], 4, step))
    case 'clock':
      return act('keep the clock time', press(['A'], 6, step))
    case 'starter_bag':
      return act('pick the highlighted starter (Torchic)', press(['A'], 6, step))
    case 'title_or_intro':
      return act('advance the title or intro', press(['A'], 6, step))
    case 'other_menu':
      return act('accept the default menu option', press(['A'], 6, step))
    case 'overworld':
      // Memory knows whether the game is in its overworld; the intro's scenery can look like one.
      if (!s.overworld) return act('advance the title or intro', press(['A'], 6, step))
      if (r.textBox === 'yes') return act('advance the dialogue', press(['A'], 6, step))
      if (r.textBox === 'unclear') return wait('unsure whether text is showing', slow)
      return wait('a cutscene is moving the player', slow)
    case 'battle':
      // Memory says we're not in battle yet: the battle is still starting.
      return wait('battle starting', slow)
    case 'unclear':
      return r.textBox === 'yes'
        ? act('advance the dialogue', press(['A'], 6, step))
        : wait('unsure what screen this is', slow)
  }
}

function decideBattle(s: GameState, r: ScreenRead): Action {
  const step = framesFor(s, SCREEN_STEP_SECONDS)
  const slow = framesFor(s, SLOW_STEP_SECONDS)

  if (r.battleMoves === 'yes') return act('use the first move', press(['A'], 6, slow))
  if (r.battleMoves === 'unclear' || r.battleActions === 'unclear') return wait('unsure which battle menu is open', slow)

  if (r.battleActions === 'yes') {
    const mustFight = (s.battleFlags & (BATTLE_TYPE_FIRST_BATTLE | BATTLE_TYPE_TRAINER)) !== 0
    if (mustFight) return act('choose FIGHT', press(['A'], 6, step))
    // FIGHT is top-left; RUN is bottom-right.
    return act('run from the wild Pokémon', press(['Down'], 4, 8), press(['Right'], 4, 8), press(['A'], 6, slow))
  }

  return act('advance the battle text', press(['A'], 6, step))
}

// The player can walk: follow the story goal using memory alone.
export function decideOnFoot(s: GameState, nav: Navigator): Action {
  const map = mapName(s)
  const goal = goalFor(s)
  if (!map || !goal) return wait(`no goal for map ${s.mapGroup}/${s.mapNum}`, 60)

  const pos = { x: s.x, y: s.y }
  nav.observe(map, pos)
  const dir = nav.nextDir(map, pos, goal.to)

  if (dir) return act(`${goal.name}: step ${dir}`, press([dir], 16, 6))
  if (goal.face) return act(`${goal.name}: face ${goal.face} and press A`, press([goal.face], 3, 8), press(['A'], 6, 30))
  if (goal.push) return act(`${goal.name}: go ${goal.push}`, press([goal.push], 16, 30))
  return wait(`${goal.name}: arrived, waiting for the map to change`)
}
