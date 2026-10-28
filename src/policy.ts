import { goalFor, mapName } from './goals.ts'
import type { ScreenRead } from './jev.ts'
import { Navigator } from './nav.ts'
import type { Action, Button, GameState, Press } from './schemas.ts'

// Decision rules: memory state plus Jev's screen answers -> buttons.
// Memory decides whenever it can; Jev is only consulted when the player can't move freely.

const BATTLE_TYPE_TRAINER = 1 << 3
const BATTLE_TYPE_FIRST_BATTLE = 1 << 4

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

  if (r.yesNo === 'unclear') return wait('unsure whether a YES/NO box is open')
  if (r.yesNo === 'yes') {
    if (r.asksNickname === 'unclear') return wait('unsure whether this asks for a nickname')
    if (r.asksNickname === 'yes') return act('decline the nickname', press(['B']))
    if (r.cursorOnYes === 'unclear') return wait('unsure where the YES/NO arrow is')
    if (r.cursorOnYes === 'no') return act('move the arrow to YES', press(['Up'], 4, 10))
    return act('answer YES', press(['A'], 6, 30))
  }

  switch (r.kind) {
    case 'naming_keyboard':
      // Type "A", jump to OK with Start, confirm.
      return act('enter the name "A"', press(['A'], 4, 15), press(['Start'], 4, 15), press(['A'], 4, 40))
    case 'clock':
      return act('keep the clock time', press(['A'], 6, 30))
    case 'starter_bag':
      return act('pick the highlighted starter (Torchic)', press(['A'], 6, 30))
    case 'title_or_intro':
      return act('advance the title or intro', press(['A'], 6, 30))
    case 'other_menu':
      return act('accept the default menu option', press(['A'], 6, 30))
    case 'overworld':
      if (r.textBox === 'yes') return act('advance the dialogue', press(['A'], 6, 20))
      if (r.textBox === 'unclear') return wait('unsure whether text is showing')
      return wait('a cutscene is moving the player', 45)
    case 'battle':
      // Memory says we're not in battle yet: the battle is still starting.
      return wait('battle starting', 45)
    case 'unclear':
      return r.textBox === 'yes' ? act('advance the dialogue', press(['A'], 6, 20)) : wait('unsure what screen this is')
  }
}

function decideBattle(s: GameState, r: ScreenRead): Action {
  if (r.battleMoves === 'yes') return act('use the first move', press(['A'], 6, 40))
  if (r.battleMoves === 'unclear' || r.battleActions === 'unclear') return wait('unsure which battle menu is open')

  if (r.battleActions === 'yes') {
    const mustFight = (s.battleFlags & (BATTLE_TYPE_FIRST_BATTLE | BATTLE_TYPE_TRAINER)) !== 0
    if (mustFight) return act('choose FIGHT', press(['A'], 6, 20))
    // FIGHT is top-left; RUN is bottom-right.
    return act('run from the wild Pokémon', press(['Down'], 4, 8), press(['Right'], 4, 8), press(['A'], 6, 40))
  }

  return act('advance the battle text', press(['A'], 6, 20))
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
