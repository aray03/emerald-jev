import { choice, noul } from '@typesafe-ai/sdk'

// All Jev question wording and thresholds live here.
// Every question is about `screen`, a 2x-upscaled Game Boy Advance frame.
// Jev only says what is on screen; policy.ts decides which buttons to press.

// Noul thresholds: above YES counts as yes, below NO counts as no, between is unclear.
export const YES_THRESHOLD = 0.7
export const NO_THRESHOLD = 0.3

// Below this, the top screen kind is too uncertain to act on.
export const SCREEN_KIND_MIN_PROBABILITY = 0.5

export const screenQuestions = {
  screen_kind: choice('What is `screen` from Pokémon Emerald showing?', {
    title_or_intro: 'The title screen, the "press start" screen, or Professor Birch talking on a plain background',
    naming_keyboard: 'A keyboard grid of letters for typing a name',
    clock: 'A large wall clock face for setting the time',
    starter_bag: "Three Poké Balls in an open bag, for choosing a first Pokémon",
    battle: 'A Pokémon battle, with Pokémon facing each other and HP bars',
    overworld: 'The player walking around a town, a route, or inside a building, seen from above',
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
  battle_actions_open: noul('Is the battle menu with FIGHT, BAG, POKéMON, and RUN showing in `screen`?', {
    true: 'A box in the bottom right lists FIGHT, BAG, POKéMON, and RUN',
    false: 'Those four options are not shown',
  }),
  battle_moves_open: noul("Is a list of the player's Pokémon's moves showing in `screen`?", {
    true: 'The bottom of the screen lists move names such as SCRATCH or POUND, with PP shown',
    false: 'No list of move names is shown',
  }),
}
