import { FLAG, storyProgress, VAR, type Goal } from './goals.ts'
import type { ScreenRead } from './jev.ts'
import { canAttack, ITEM_POTION, martStock, type Facts, type Mon, type Move } from './memory.ts'
import { MAPS, type Pos } from './nav.ts'
import { isLowHp, noteTalk, potionsToBuy, serviceGoal } from './services.ts'
import type { Session } from './session.ts'
import type { Action, Button, Dir, GameState, Press } from './schemas.ts'

// Decision rules. Memory gives facts, Jev reads the screen and judges moves; this file turns
// both into buttons. The user's rules (never run, Potion below 1/3 HP, heal and shop in each
// new town) live here and in services.ts.

// Real time between screen checks. Button holds and walking stay in game frames, but these
// gaps scale with emulator speed: at 400% speed, 0.25 s is 60 frames (1 s of game time).
const SCREEN_STEP_SECONDS = 0.25
const SLOW_STEP_SECONDS = 0.5 // cutscenes, battle intros, and moments Jev was unsure about

const framesFor = (s: GameState, seconds: number) => Math.max(1, Math.round(seconds * 60 * (s.speedPercent / 100)))

const press = (buttons: Button[], hold = 6, wait = 20): Press => ({ buttons, hold, wait })
const act = (reason: string, ...presses: Press[]): Action => ({ kind: 'press', presses, reason })
const wait = (reason: string, frames = 30): Action => act(reason, press([], 1, frames))

export const needsScreen = (s: GameState) => s.inBattle || s.controlsLocked || !s.overworld

// A menu whose cursor has to be found before pressing: the server asks Jev which of `options`
// is highlighted, then moves toward `want` (Up/Down, or Left/Right when `horizontal`) and
// presses `then`. When `want` is already highlighted and there is a `next`, that one is asked
// about in the same step (the bag: first the pocket tab, then the item).
export type Highlight = {
  kind: 'highlight'
  menu: string
  options: string[]
  want: string
  then: Press[]
  reason: string
  horizontal?: boolean
  next?: Highlight
}

// ---------- Battle: what memory says the game is waiting for ----------

// 2x2 menus (actions and moves): index bit 0 is the column, bit 1 the row.
function gridPresses(from: number, to: number): Press[] {
  const out: Press[] = []
  if ((from & 2) !== (to & 2)) out.push(press([to & 2 ? 'Down' : 'Up'], 4, 8))
  if ((from & 1) !== (to & 1)) out.push(press([to & 1 ? 'Right' : 'Left'], 4, 8))
  return out
}

const FIGHT = 0
const BAG = 1
const RUN = 3
const POKENAV_MODE_FORCE_CALL_READY = 1
const BATTLE_TYPE_TRAINER = 1 << 3

// The action menu (FIGHT / BAG / POKéMON / RUN). RUN only from a wild battle with no PP left in
// any attacking move (trainer battles can't be run from: there it fights on, with Struggle once
// every move is empty).
export function decideAction(s: GameState, f: Facts, session: Session): Action {
  const me = f.player
  if (me && !canAttack(me) && !(s.battleFlags & BATTLE_TYPE_TRAINER)) {
    return act('no PP left in any attacking move: RUN', ...gridPresses(f.actionCursor, RUN), press(['A'], 6, framesFor(s, SLOW_STEP_SECONDS)))
  }
  if (me && isLowHp(me.hp, me.maxHp) && f.potions > 0) {
    session.intent = 'battle-potion'
    session.intentStartHp = me.hp
    return act(`${me.name} is below 1/3 HP: open the BAG for a Potion`, ...gridPresses(f.actionCursor, BAG), press(['A'], 6, framesFor(s, SCREEN_STEP_SECONDS)))
  }
  return act('choose FIGHT', ...gridPresses(f.actionCursor, FIGHT), press(['A'], 6, framesFor(s, SCREEN_STEP_SECONDS)))
}

// The move menu, after Jev picked `moveName` from the moves memory says the Pokémon knows.
export function decideMove(s: GameState, f: Facts, moveName: string | null): Action {
  const moves = f.player?.moves ?? []
  const fallback = moves.findIndex((m) => m.pp > 0 && m.power > 0)
  const index = moveName ? moves.findIndex((m) => m.name === moveName) : -1
  if (index === -1) {
    // Jev wasn't clear: use the first damaging move with PP rather than stall the battle.
    const i = Math.max(0, fallback)
    return act(`Jev unsure; use ${moves[i]?.name ?? 'the first move'}`, ...gridPresses(f.moveCursor, i), press(['A'], 6, framesFor(s, SLOW_STEP_SECONDS)))
  }
  return act(`use ${moveName}`, ...gridPresses(f.moveCursor, index), press(['A'], 6, framesFor(s, SLOW_STEP_SECONDS)))
}

// ---------- Screens: menus, prompts, dialogue ----------

export function decideFromScreen(s: GameState, f: Facts | null, map: string | null, r: ScreenRead, session: Session): Action | Highlight {
  const step = framesFor(s, SCREEN_STEP_SECONDS)
  const slow = framesFor(s, SLOW_STEP_SECONDS)

  // An errand is finished once HP has gone up: back out of whatever menu is open.
  const mon = s.inBattle ? f?.player : f?.party0
  if (session.intent && mon && mon.hp > session.intentStartHp) session.intent = null

  // Prompts where the answer isn't simply YES. These come before the evolution rule because
  // a just-evolved Pokémon can ask to learn a move on the evolution screen.
  if (r.asksSwitch === 'yes') return act('keep the same Pokémon in battle', press(['B'], 6, step))
  if (r.asksDeleteMove === 'yes') {
    // Memory says which move is being learned: swap out a move that does no damage for a
    // damaging one, and turn down anything else.
    const learning = f?.moveToLearn
    // An outdated Lua script doesn't send the move: decline rather than wait forever.
    if (learning === undefined) return act("can't read the move on offer (outdated Lua script): skip it", press(['B'], 6, step))
    if (!learning || !f?.party0) return wait('reading which move is being learned', slow)
    return replaceableMove(f.party0, learning)
      ? act(`make room for ${learning.name}`, press(['A'], 6, step))
      : act(`skip learning ${learning.name}`, press(['B'], 6, step))
  }

  // Never press B on the evolution screen: holding B cancels evolving into Combusken.
  if (r.kind === 'evolution') return r.textBox === 'yes' ? act('advance the evolution text', press(['A'], 6, step)) : wait('evolving', slow)

  // The nickname question is the one YES/NO we answer NO, and it only comes up in Birch's lab.
  // Outside the lab, ignore Jev's nickname answer: confirming the player's own name ("So it's
  // MAY?") reads as name-related and can come back unclear.
  const inLab = map === 'LittlerootTown_ProfessorBirchsLab'
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
    // Outside Devon Corp the PokéNav opens in a tutorial that can't be left until Mr. Stone has
    // been called: B does nothing, and A does nothing on any button but MATCH CALL.
    case 'pokenav':
      if (f?.pokenavMode === POKENAV_MODE_FORCE_CALL_READY) return act('move on to MATCH CALL and try it', press(['Down'], 3, 8), press(['A'], 6, step))
      return act('close the PokéNav', press(['B'], 6, step))
    case 'pokenav_match_call':
      // A picks MR. STONE, then CALL (where the cursor starts), then moves the call along.
      if (f?.pokenavMode === POKENAV_MODE_FORCE_CALL_READY) return act('call MR. STONE', press(['A'], 6, step))
      return act('leave MATCH CALL', press(['B'], 6, step))
    case 'other_menu':
      // Mr. Briney in Dewford: PETALBURG / SLATEPORT / EXIT, with the cursor starting on EXIT.
      if (map === 'DewfordTown' && f?.flag(FLAG.DELIVERED_STEVEN_LETTER))
        return { kind: 'highlight', menu: "Mr. Briney's list of places to sail", options: ['PETALBURG', 'SLATEPORT', 'EXIT'], want: 'SLATEPORT', then: [press(['A'], 6, step)], reason: 'sail to SLATEPORT' }
      return act('advance or accept the default option', press(['A'], 6, step))
    case 'title_or_intro':
      return act('advance or accept the default option', press(['A'], 6, step))

    case 'start_menu':
      // Outside Devon Corp, the game opens a START menu that only closes once POKéNAV is chosen.
      if (session.intent !== 'potion' && map === 'RustboroCity' && f?.variable(VAR.RUSTBORO_CITY_STATE) === 6)
        return { kind: 'highlight', menu: 'START menu', options: startMenuOptions(f), want: 'POKéNAV', then: [press(['A'], 6, step)], reason: 'open the POKéNAV as asked' }
      if (session.intent !== 'potion') return act('close the START menu', press(['B'], 6, step))
      return { kind: 'highlight', menu: 'START menu', options: startMenuOptions(f), want: 'BAG', then: [press(['A'], 6, step)], reason: 'open the BAG' }

    case 'bag':
      if (!session.intent || !f) return act('close the bag', press(['B'], 6, step))
      if (!f.bag.some((i) => i.id === ITEM_POTION)) {
        session.intent = null
        return act('no Potions left: close the bag', press(['B'], 6, step))
      }
      // The bag reopens on whichever pocket was last used, so first make sure ITEMS is showing.
      return {
        kind: 'highlight',
        menu: 'pocket tabs at the top of the bag',
        options: ['ITEMS', 'POKé BALLS', 'TMs & HMs', 'BERRIES', 'KEY ITEMS'],
        want: 'ITEMS',
        then: [],
        reason: 'ITEMS pocket is open',
        horizontal: true,
        next: {
          kind: 'highlight',
          menu: 'ITEMS pocket of the bag',
          options: [...f.bag.map((i) => i.name), 'CLOSE BAG'],
          want: 'POTION',
          then: [press(['A'], 6, step)],
          reason: 'choose POTION',
        },
      }

    case 'item_action_menu':
      // USE is where the cursor starts.
      return session.intent ? act('USE the Potion', press(['A'], 6, step)) : act('cancel', press(['B'], 6, step))

    case 'party_menu':
      // Torchic is the first (and only) Pokémon.
      return session.intent ? act('give the Potion to the first Pokémon', press(['A'], 6, step)) : act('leave the party menu', press(['B'], 6, step))

    case 'move_forget':
      // Memory says when the real list of moves is open (decideForgetMove handles it without Jev),
      // so this is battle or evolution text that mentions moves, like "can't learn more than four
      // moves". A advances it; B does too, and is also safe if a list really is open (it declines).
      return r.textBox === 'yes' ? act('advance the text about moves', press(['A'], 6, step)) : act('back out', press(['B'], 6, step))

    case 'mart_menu':
      return f && potionsToBuy(f) > 0 && !session.boughtThisVisit
        ? act('BUY', press(['A'], 6, step))
        : act('QUIT the shop', press(['B'], 6, step))

    case 'mart_list':
    {
      if (!f || session.boughtThisVisit || potionsToBuy(f) === 0) return act('leave the shop list', press(['B'], 6, step))
      // The real stock for this Mart at this point in the story, in on-screen order.
      const stock = map ? martStock(map, f.flag) : null
      if (!stock?.includes('POTION')) return act('this shop has no Potions: leave the list', press(['B'], 6, step))
      return { kind: 'highlight', menu: 'shop list', options: [...stock, 'CANCEL'], want: 'POTION', then: [press(['A'], 6, step)], reason: 'choose POTION' }
    }

    case 'mart_quantity': {
      // The box starts at 1; each Up adds one.
      const n = f ? Math.max(1, potionsToBuy(f)) : 1
      session.boughtThisVisit = true
      const ups = Array.from({ length: n - 1 }, () => press(['Up'], 3, 4))
      return act(`buy ${n} Potion${n === 1 ? '' : 's'}`, ...ups, press(['A'], 6, step))
    }

    case 'battle':
    case 'overworld':
      // Memory knows whether the game is in its overworld; the intro's scenery can look like one.
      if (!s.overworld && !s.inBattle && r.kind === 'overworld') return act('advance the title or intro', press(['A'], 6, step))
      if (r.textBox === 'yes') return act('advance the text', press(['A'], 6, step))
      if (r.textBox === 'unclear') return wait('unsure whether text is showing', slow)
      return wait(s.inBattle ? 'battle animation' : 'a cutscene is moving the player', slow)

    case 'unclear':
      return r.textBox === 'yes' ? act('advance the text', press(['A'], 6, step)) : wait('unsure what screen this is', slow)
  }
}

// The screen for choosing a move to forget, read from memory: a red box marks the cursor over
// the four known moves (0-3) and the new one (4). A forgets the boxed move; picking the new
// move turns it down.
export function decideForgetMove(s: GameState, f: Facts): Action {
  const cursor = f.forgetMoveCursor ?? 0
  const learning = f.moveToLearn
  const forget = f.party0 && learning ? replaceableMove(f.party0, learning) : null
  const index = forget ? f.party0!.moves.findIndex((m) => m.id === forget.id) : -1
  const target = index === -1 ? 4 : index
  const reason = forget && learning ? `forget ${forget.name} for ${learning.name}` : `keep the current moves${learning ? `, skip ${learning.name}` : ''}`
  // One press per step, rechecking the cursor in memory: presses are ignored while the screen
  // fades in, and an A after a dropped Down would forget the wrong move.
  if (cursor !== target) {
    const dir: Dir = target > cursor ? 'Down' : 'Up'
    return act(`${reason}: move the box ${dir}`, press([dir], 3, framesFor(s, SCREEN_STEP_SECONDS)))
  }
  return act(reason, press(['A'], 6, framesFor(s, SLOW_STEP_SECONDS)))
}

// When a move is offered with no free slot: the move to forget for it, or null to turn it down.
// Only damaging moves are worth learning, and only moves that do no damage get forgotten.
export function replaceableMove(mon: Mon, learning: Move): Move | null {
  if (learning.power === 0) return null
  return mon.moves.find((m) => m.power === 0) ?? null
}

// START menu entries in order (src/start_menu.c). Which ones exist depends on story flags.
function startMenuOptions(f: Facts | null): string[] {
  const out: string[] = []
  if (f?.flag(FLAG.SYS_POKEDEX_GET)) out.push('POKéDEX')
  if (f?.flag(FLAG.SYS_POKEMON_GET)) out.push('POKéMON')
  out.push('BAG')
  if (f?.flag(FLAG.SYS_POKENAV_GET)) out.push('POKéNAV')
  out.push("the player's name", 'SAVE', 'OPTION', 'EXIT')
  return out
}

// Presses to move a vertical list's cursor from `at` to `want`, then the follow-up presses.
export function pressesForHighlight(h: Highlight, at: string | null, s: GameState): Action {
  if (!at) return wait(`unsure where the cursor is in the ${h.menu}`, framesFor(s, SLOW_STEP_SECONDS))
  if (at === h.want) return act(h.reason, ...h.then)
  const from = h.options.indexOf(at)
  const to = h.options.indexOf(h.want)
  // Unknown positions (like "another item" in a shop list): step down one and look again.
  const forward = from === -1 || to === -1 || to > from
  const dir: Dir = h.horizontal ? (forward ? 'Right' : 'Left') : forward ? 'Down' : 'Up'
  const n = from === -1 || to === -1 ? 1 : Math.abs(to - from)
  return act(`move the cursor ${dir} toward ${h.want}`, ...Array.from({ length: n }, () => press([dir], 3, 6)), press([], 1, framesFor(s, SCREEN_STEP_SECONDS)))
}

// ---------- On foot: story goals and the user's rules, from memory alone ----------

// Whether `pos` is already beyond `to` in direction `dir` (same map only).
function isPast(pos: Pos, to: Pos, dir: Dir) {
  if (pos.map !== to.map) return false
  switch (dir) {
    case 'Up':
      return pos.y < to.y
    case 'Down':
      return pos.y > to.y
    case 'Left':
      return pos.x < to.x
    case 'Right':
      return pos.x > to.x
  }
}

export function decideOnFoot(s: GameState, f: Facts, pos: Pos, session: Session): Action {
  // People standing on this map are walls for pathfinding; story flags switch Mauville Gym's barriers.
  const m = MAPS[pos.map]
  session.nav.setWorld(pos.map, f.objects.filter((o) => m && o.mapGroup === m.group && o.mapNum === m.num), f.flag)

  const service = serviceGoal(pos, f, session)
  if (service === 'use-potion') {
    session.intent = 'potion'
    session.intentStartHp = f.party0?.hp ?? 0
    return act('Torchic is below 1/3 HP: open the START menu for a Potion', press(['Start'], 6, framesFor(s, SCREEN_STEP_SECONDS)))
  }
  session.intent = null

  const goal: Goal | null = service ?? storyProgress(f, pos, session.nav).goal
  if (!goal) return wait('no goal: the third badge is won', 60)
  return walkTo(goal, pos, session)
}

function walkTo(goal: Goal, pos: Pos, session: Session): Action {
  const nav = session.nav
  nav.observe(pos)

  // Once a push has carried us past the target (instead of through a door or off the map),
  // keep pushing rather than walking back, which would loop back and forth.
  if (goal.push && isPast(pos, goal.to, goal.push)) {
    nav.notePress(pos, goal.push)
    return act(`${goal.name}: keep going ${goal.push}`, press([goal.push], 16, 30))
  }

  const dir = nav.nextDir(pos, goal.to)
  if (dir) return act(`${goal.name}: step ${dir}`, press([dir], 16, 6))

  const here = pos.map === goal.to.map && pos.x === goal.to.x && pos.y === goal.to.y
  if (!here) return wait(`${goal.name}: no path from ${pos.map} (${pos.x},${pos.y}) yet`, 60)
  if (goal.face) {
    noteTalk(goal, session)
    return act(`${goal.name}: face ${goal.face} and press A`, press([goal.face], 3, 8), press(['A'], 6, 30))
  }
  if (goal.push) {
    nav.notePress(pos, goal.push)
    return act(`${goal.name}: go ${goal.push}`, press([goal.push], 16, 30))
  }
  return wait(`${goal.name}: arrived, waiting for the game`)
}
