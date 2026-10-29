# emerald-jev

A bot that plays Pokémon Emerald from **New Game** to beating **Roxanne**, the first gym leader, using
[TypeSafe's Jev](https://docs.typesafe.ai) to read the screen.

```
BizHawk + lua/emerald-jev.lua                bridge server (src/server.ts, :3100)
─────────────────────────────                ─────────────────────────────────────
read memory: map, x/y, battle, locks   ──►   POST /step
save a screenshot                            ├─ can walk? → goals.ts + nav.ts (memory only)
press the buttons it replies with      ◄──   └─ menu/battle/cutscene? → Jev reads the screen → policy.ts
```

- **Memory** gives exact facts: the map, the player's tile, battle and cutscene state, and story progress.
- **Jev** answers questions about the screenshot, such as "Is a YES/NO box open?" or "Is the arrow on YES?". The wording is in `src/questions.ts`.
- **Code** decides the buttons: `src/policy.ts` for menus and battles, `src/goals.ts` and `src/nav.ts` for walking.

Jev is only called when the player can't walk freely. Walking uses memory alone.

## Setup

1. **BizHawk 2.11.1 for Linux.** It runs on Mono.
   ```sh
   yay -S bizhawk-bin            # or unpack BizHawk-2.11.1-linux-x64.tar.gz from GitHub releases
   sudo pacman -S --needed mono lua54 openal
   cp -a /opt/bizhawk ~/.local/share/bizhawk   # BizHawk writes next to itself; /opt is read-only
   ```
2. **Install dependencies** and add your API key:
   ```sh
   npm install
   cp .env.example .env          # then fill in TYPESAFE_API_KEY
   ```
3. **ROM:** your own *Pokémon - Emerald Version (USA, Europe)*, game code `BPEE`. BizHawk opens the `.zip` directly.

## Run

1. Start the bridge server:
   ```sh
   npm run dev        # normal run: Jev reads the screen, the bot presses buttons
   npm run dry        # dry run: no Jev and no buttons; logs memory while you play by hand
   ```
2. In another terminal, run `./play.sh`. To use a different ROM or BizHawk, set `ROM=...` or `BIZHAWK=...`. It runs this command:
   ```sh
   ~/.local/share/bizhawk/EmuHawkMono.sh \
     --url_get=http://127.0.0.1:3100/ \
     --lua="$PWD/lua/emerald-jev.lua" \
     "$HOME/Downloads/Pokemon - Emerald Version (USA, Europe).zip"
   ```
   `--url_get` is required, because it is what turns on BizHawk's HTTP functions. Don't use the `/opt/bizhawk` install directly: it crashes with "Access to the path '/opt/bizhawk/GBA' is denied" because it can't save there.

Each run writes `runs/<time>.jsonl` with one line per step: memory state, the exact questions, Jev's answers and the chosen buttons. Every frame Jev looked at is saved in `runs/<time>/`.

## Save states

- `npm run save -- <name>` saves the game to `states/<name>.State` on the bot's next step. This works in dry runs too.
- `npm run states` lists your saves.
- `STATE=states/<name>.State ./play.sh` starts BizHawk from that save instead of the title screen.

Restart the server between runs so it forgets what it learned about the last one. `states/` is gitignored.

## First time: do a dry run

The memory addresses come from the pret/pokeemerald decompilation and haven't been checked on a real run yet. Run `npm run dry`, start a New Game by hand, and check that:

| Check | Expected |
|---|---|
| In the truck | map `25/40` |
| Walking | `x`/`y` change by 1 per tile |
| Talking to someone | `controlsLocked` becomes `true` |
| In a menu | `overworld` becomes `false` |
| After setting the clock | `vars.introState` goes 4 → 5 → 6 |

If any of these are wrong, fix the address in `lua/emerald-jev.lua` before a real run.

## What it does

Jev is asked about anything that needs judgment, and gets memory facts alongside the screenshot:

- **Screens:** which screen is showing (dialogue, YES/NO, bag, party, shop, evolution and so on) and which prompts are up. The place comes from memory.
- **Battles:** the best move. Jev is given Torchic's real moves (type, power, PP) and the foe's species, level and types.
- **Menus:** which entry the cursor is on, chosen among the real bag items, START menu entries or known moves.

Code applies the rules:

- **Story order:** `src/goals.ts`, checked against story flags and variables in memory.
- **Healing and shopping:** the first time in Oldale, Petalburg and Rustboro, heal at the Pokémon Center, then buy Potions up to **6**.
- **Potions:** below **1/3 HP**, use a Potion in battle or out. With none left, go to the **nearest** Center by walking distance.
- **Out of PP** in every attacking move: go to the nearest Center to restore it. In a wild battle it **runs**; a trainer battle can't be run from, so there it fights on.
- **Training:** train in **Rusturf Tunnel** (Whismur only, Lv 5–8, east of Rustboro along Route 116) until Torchic reaches **level 16**, then face Roxanne.
- **New moves:** with no free slot, a damaging move replaces one that does no damage (Double Kick replaces Growl, Peck replaces Focus Energy). Moves that do no damage are turned down. The move on offer is read from memory (`gMoveToLearn`).
- **Battles:** never run, except from a wild battle when out of PP.
- **Save states:** saved automatically as each story step is done (`states/01-got-starter.State`, and so on).

Walking uses `src/maps.generated.json` (`npm run maps`), which holds every map on the route with its walls, ledges, grass, doors, stairs and map edges. Move, species and item names come from `src/data.generated.json` (`npm run data`).

## Known gaps

- Walking learns walls by bumping into them. Ledges or tall grass on Route 101 can cause detours.
- The naming screen types the name **A**. The bot plays as a boy and picks Torchic.
- Image input is an experimental TypeSafe feature, which is why requests send `TypeSafe-Danger-Zone-Images: true`.
