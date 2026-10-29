import { choice, noul } from '@typesafe-ai/sdk'
import { effectiveness, type Mon } from './memory.ts'

// All Jev question wording and thresholds live here.
// `screen` is a 2x-upscaled Game Boy Advance frame. Facts read from memory (the place, the
// Pokémon in battle, the items in the bag) go into the state next to it, so Jev judges with them.
// Jev says what is on screen and which choice is best; policy.ts decides which buttons to press.

// Noul thresholds: above YES counts as yes, below NO counts as no, between is unclear.
export const YES_THRESHOLD = 0.7
export const NO_THRESHOLD = 0.3

// Below this, the top answer of a choice is too uncertain to act on.
export const CHOICE_MIN_PROBABILITY = 0.5

// Asked whenever the player can't walk freely. State: `screen`, `place`.
export const screenQuestions = {
  screen_kind: choice('What is `screen` from Pokémon Emerald showing?', {
    title_or_intro: 'The title screen, the "press start" screen, or Professor Birch talking on a plain background',
    naming_keyboard: 'A keyboard grid of letters for typing a name',
    clock: 'A large wall clock face for setting the time',
    starter_bag: 'Three Poké Balls in an open bag, for choosing a first Pokémon',
    battle: 'A Pokémon battle, with Pokémon facing each other and HP bars',
    evolution: 'A Pokémon in the middle of the screen evolving, with a message like "What? TORCHIC is evolving!"',
    overworld: 'The player walking around a town, a route, or inside a building, seen from above',
    start_menu: 'A narrow menu on the right side listing entries such as POKéMON, BAG, SAVE, OPTION, and EXIT',
    bag: 'The bag screen: a picture of a bag on the left and a list of items on the right',
    item_action_menu: 'A small box of choices for one item, such as USE, GIVE, TOSS, and CANCEL',
    party_menu: 'The list of the player\'s Pokémon with HP bars, often with "Use on which POKéMON?"',
    move_forget: 'A Pokémon summary page listing its moves, with "Which move should be forgotten?"',
    mart_menu: 'A small shop menu with BUY, SELL, and QUIT',
    mart_list: 'A shop list of items for sale, with their prices',
    mart_quantity: 'A shop box for choosing how many to buy, showing a number like "x01" and a total price',
    other_menu: 'Any other menu or list, such as choosing BOY or GIRL',
  }),
  text_box_open: noul('Is a dialogue text box showing along the bottom of `screen`?', {
    true: 'A box with lines of text spans the bottom of the screen',
    false: 'The bottom of the screen shows the game world or a menu with no message',
  }),
  yes_no_open: noul('Is a small YES / NO choice box showing in `screen`?', {
    true: 'A small box lists the words YES and NO, one above the other',
    false: 'There is no box with the words YES and NO',
  }),
  cursor_on_yes: noul('In `screen`, is the selection arrow pointing at YES?', {
    true: 'The small triangle arrow sits to the left of the word YES',
    false: 'The arrow sits next to NO, or there is no YES / NO box',
  }),
  asks_nickname: noul('Does the text in `screen` ask whether to give a Pokémon a nickname?', {
    true: 'The message asks something like "Give a nickname to the TORCHIC?"',
    false: 'The message is about anything else, or there is no message',
  }),
  asks_switch_pokemon: noul('Does the text in `screen` ask whether the player will change Pokémon?', {
    true: 'The message asks something like "Will BRENDAN change POKéMON?"',
    false: 'The message is about anything else, or there is no message',
  }),
  asks_delete_move: noul('Does the text in `screen` ask whether to delete a move to make room for a new one?', {
    true: 'The message asks something like "Delete a move to make room for DOUBLE KICK?"',
    false: 'The message is about anything else, or there is no message',
  }),
}

// Asked when the game is waiting for a move choice. One option per move with PP left, named by
// the move itself. Each option states what code already knows from the game's data (type
// effectiveness against this foe, same-type bonus, hitting twice), so Jev weighs facts rather
// than recalling the type chart. State: `screen`, `my_pokemon`, `foe` (from memory).
export function bestMoveQuestion(me: Mon, foe: Mon) {
  const options = Object.fromEntries(
    me.moves.filter((m) => m.pp > 0).map((m) => [m.name, describeMove(m, me, foe)]),
  )
  return {
    best_move: choice("Which of `my_pokemon`'s moves will do the most damage to `foe` this turn?", options),
  }
}

function describeMove(m: Mon['moves'][number], me: Mon, foe: Mon): string {
  if (m.power === 0) return `A ${m.type}-type move that does no damage`
  const parts = [`A ${m.type}-type attack with power ${m.power}`]
  if (m.effect === 'DOUBLE_HIT') parts.push('it hits twice')
  const mult = effectiveness(m.type, foe.types)
  if (mult === 0) parts.push(`it has no effect on ${foe.name}`)
  else if (mult > 1) parts.push(`it is super effective on ${foe.name} (${mult}x damage)`)
  else if (mult < 1) parts.push(`it is not very effective on ${foe.name} (${mult}x damage)`)
  else parts.push(`normal effectiveness on ${foe.name}`)
  if (me.types.includes(m.type)) parts.push(`same type as ${me.name}, so 1.5x damage`)
  return parts.join('; ')
}

// Asked on menus to find the cursor. `options` are the real entries, read from memory where
// possible (bag items, known moves), named by what they say on screen. State: `screen`.
// Lists mark the cursor with a small ▶ triangle; long lists also show an orange ▼ at the bottom
// that only means "this list scrolls", which was being read as the cursor. Tab rows (the bag's
// pockets) have no ▶: the open tab is the one whose name is shown.
export function highlightedQuestion(menu: string, options: string[], tabs = false) {
  const instructions = tabs
    ? `In \`screen\`, which of the ${menu} is the one currently open?`
    : `In \`screen\`, which entry of the ${menu} has the cursor, the small ▶ triangle just to the left of its name?`
  const criteria = tabs
    ? Object.fromEntries(options.map((o) => [o, `The ${o} tab is open: its name is shown at the top`]))
    : Object.fromEntries(
        options.map((o) => [o, `The ▶ points at ${o}. Ignore the orange ▼ below the list, which only shows that the list scrolls`]),
      )
  return { highlighted: choice(instructions, criteria) }
}

// Readable place names for the state: PetalburgCity_PokemonCenter_1F -> "Petalburg City Pokémon Center 1F".
export function placeName(map: string | null): string {
  if (!map) return 'somewhere in the game'
  return map
    .replace(/PokemonCenter/g, 'Pokémon Center')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
}
