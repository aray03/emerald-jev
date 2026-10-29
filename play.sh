#!/usr/bin/env bash
# Launch BizHawk with Emerald and the emerald-jev Lua script.
# Start the bridge server first (npm run dev, or npm run dry) in another terminal.
set -euo pipefail

cd "$(dirname "$(realpath "$0")")"

BIZHAWK="${BIZHAWK:-$HOME/.local/share/bizhawk/EmuHawkMono.sh}"
ROM="${ROM:-$HOME/Downloads/Pokemon - Emerald Version (USA, Europe).zip}"

# STATE=states/<name>.State starts from a saved checkpoint instead of the title screen.
args=(--url_get=http://127.0.0.1:3100/ --lua="$PWD/lua/emerald-jev.lua")
if [[ -n "${STATE:-}" ]]; then
  args+=(--load-state="$(realpath "$STATE")")
fi

exec "$BIZHAWK" "${args[@]}" "$ROM"
