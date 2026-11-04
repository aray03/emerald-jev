# emerald-jev

A bot that plays Pokémon Emerald from **New Game** to beating **Wattson**, the third gym leader in Mauville, using
[TypeSafe's Jev](https://docs.typesafe.ai) to read the screen.

```
BizHawk + lua/emerald-jev.lua                bridge server (src/server.ts, :3100)
─────────────────────────────                ─────────────────────────────────────
read memory: map, x/y, battle, locks   ──►   POST /step
save a screenshot                            ├─ can walk? → goals.ts + nav.ts (memory only)
press the buttons it replies with      ◄──   └─ menu/battle/cutscene? → Jev reads the screen → policy.ts
```

- **Memory** gives exact facts: the map, the player's tile, the people on the map, battle and cutscene state, and story progress.
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

Restart the server between runs so it forgets what it learned about the last one. BizHawk loads the Lua script once at launch: after the script changes, reload it (Lua Console → Refresh) or restart `./play.sh`. The script is now version **3**, so reload it after updating. The server warns if the two are out of step. `states/` is gitignored.

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

- **Story order:** `src/goals.ts`, checked against story flags and variables in memory. After Roxanne: get the Devon Goods back from the grunt in Rusturf Tunnel → the PokéNav from Mr. Stone → the rival in Rustboro → Mr. Briney's boat to Dewford → Steven's letter in Granite Cave → train → Brawly → the boat to Slateport → Dock in Stern's Shipyard → Captain Stern in the museum → the rival on Route 110 → Wally → train → the Mauville Gym switch → Wattson.
- **Healing and shopping:** the first time in Oldale, Petalburg, Rustboro, Dewford, Slateport and Mauville, heal at the Pokémon Center, then buy Potions up to **6**. Dewford has no Mart, and Mauville's Mart sells no Potions, so both are skipped.
- **Potions:** below **1/3 HP**, use a Potion in battle or out. With none left, go to the **nearest** Center by walking distance.
- **Out of PP** in every attacking move: go to the nearest Center to restore it. In a wild battle it **runs**; a trainer battle can't be run from, so there it fights on.
- **Training:** before each gym, pace between two tiles until Torchic reaches the level set in `src/goals.ts`: **16** in **Rusturf Tunnel** (Whismur only, Lv 5–8) for Roxanne, **21** in **Granite Cave 1F** for Brawly, **26** in the **Route 110** grass for Wattson.
- **New moves:** with no free slot, a damaging move replaces one that does no damage (Double Kick replaces Growl, Peck replaces Focus Energy). Moves that do no damage are turned down. The move on offer (`gMoveToLearn`), the move-forget screen and its cursor are all read from memory, so Jev isn't asked. Battle text like "can't learn more than four moves" is no longer taken for the move list, which used to hang the bot.
- **People and things:** read from memory (`gObjectEvents`) and treated as walls. The bot also uses them to find Mr. Briney, who walks around his house, and stands next to him to talk.
- **Mauville Gym:** the switches are avoided except switch 3, the one on the way to Wattson. The barriers follow the gym's flag.
- **Special screens:** the forced POKéNAV menu outside Devon Corp picks POKéNAV, then the PokéNav tutorial calls Mr. Stone through MATCH CALL (its mode is read from memory); otherwise the PokéNav is closed with B. And Mr. Briney's PETALBURG / SLATEPORT / EXIT menu picks SLATEPORT.
- **Battles:** never run, except from a wild battle when out of PP.
- **Save states:** saved automatically as each story step is done (`states/01-got-starter.State`, and so on). After `07-first-badge` come `08-recovered-goods`, `09-dewford`, `10-steven-letter`, `11-level-21`, `12-second-badge`, `13-delivered-goods`, `14-level-26` and `15-third-badge`.

Walking uses `src/maps.generated.json` (`npm run maps`), which holds every map on the route with its walls, ledges, grass, doors, stairs and map edges. Move, species and item names come from `src/data.generated.json` (`npm run data`).

## Known gaps

- Walking learns walls by bumping into them. Ledges or tall grass on Route 101 can cause detours.
- The route after Roxanne uses coordinates from the decompilation and hasn't been run end to end yet.
- Only the first Pokémon in the party is managed: healed, trained and given new moves.
- The naming screen types the name **A**. The bot plays as a boy and picks Torchic.
- Image input is an experimental TypeSafe feature, which is why requests send `TypeSafe-Danger-Zone-Images: true`.
