-- emerald-jev: runs inside BizHawk with Pokémon Emerald (USA, Europe).
-- Each step: read memory, save a screenshot, ask the bridge server what to press, press it.
-- Launch BizHawk with --url_get=http://127.0.0.1:3100/ or comm.httpPost is disabled.

local SERVER = "http://127.0.0.1:3100"
local SETTLE_FRAMES = 10 -- let the game draw before reading the screen
local BUS = "System Bus"

-- Absolute paths, since BizHawk resolves relative paths against its own install folder.
local SCRIPT_DIR = debug.getinfo(1, "S").source:match("^@(.*)/lua/[^/]*$") or "."
local SCREENSHOT = SCRIPT_DIR .. "/runs/frame.png"

-- pret/pokeemerald symbols (USA/Europe).
local ADDR = {
  saveBlock1Ptr = 0x03005D8C, -- follow every read: the save block moves around
  mainCallback2 = 0x030022C4, -- gMain.callback2
  mainInBattle = 0x030026F9, -- gMain byte holding the inBattle bit (bit 1)
  lockFieldControls = 0x03000F2C, -- sLockFieldControls
  battleTypeFlags = 0x02022FEC,
  battleOutcome = 0x0202433A,
  gameCode = 0x080000AC, -- 4 ASCII bytes in the ROM header
}
local CB2_OVERWORLD = 0x08085E5C
local SB1_VARS = 0x139C -- u16 vars[] inside SaveBlock1, indexed by (id - 0x4000)
local VAR = {
  introState = 0x4092, -- VAR_LITTLEROOT_INTRO_STATE
  townState = 0x4050, -- VAR_LITTLEROOT_TOWN_STATE
  route101State = 0x4060, -- VAR_ROUTE101_STATE
  birchLabState = 0x4084, -- VAR_BIRCH_LAB_STATE
}

local function u8(a) return memory.read_u8(a, BUS) end
local function s8(a) return memory.read_s8(a, BUS) end
local function u16(a) return memory.read_u16_le(a, BUS) end
local function s16(a) return memory.read_s16_le(a, BUS) end
local function u32(a) return memory.read_u32_le(a, BUS) end

local function readGameCode()
  local s = ""
  for i = 0, 3 do s = s .. string.char(u8(ADDR.gameCode + i)) end
  return s
end

local function bool(b) return b and "true" or "false" end

local function readState()
  local sb1 = u32(ADDR.saveBlock1Ptr)
  local cb2 = u32(ADDR.mainCallback2)
  local function var(id) return u16(sb1 + SB1_VARS + 2 * (id - 0x4000)) end

  -- Only numbers and fixed strings, so a hand-built JSON string is safe.
  return string.format(
    '{"frame":%d,"gameCode":"%s","mapGroup":%d,"mapNum":%d,"x":%d,"y":%d,' ..
      '"inBattle":%s,"controlsLocked":%s,"overworld":%s,"battleFlags":%d,"battleOutcome":%d,' ..
      '"vars":{"introState":%d,"townState":%d,"route101State":%d,"birchLabState":%d},"screenshot":"%s"}',
    emu.framecount(),
    readGameCode(),
    s8(sb1 + 0x04),
    s8(sb1 + 0x05),
    s16(sb1 + 0x00),
    s16(sb1 + 0x02),
    bool((u8(ADDR.mainInBattle) >> 1) & 1 == 1),
    bool(u8(ADDR.lockFieldControls) ~= 0),
    bool((cb2 | 1) == (CB2_OVERWORLD | 1)),
    u32(ADDR.battleTypeFlags),
    u8(ADDR.battleOutcome),
    var(VAR.introState),
    var(VAR.townState),
    var(VAR.route101State),
    var(VAR.birchLabState),
    SCREENSHOT
  )
end

local function advance(frames)
  for _ = 1, frames do emu.frameadvance() end
end

-- joypad.set only lasts one frame, so set it again every frame while holding.
local function hold(buttons, frames)
  for _ = 1, frames do
    joypad.set(buttons)
    emu.frameadvance()
  end
end

-- Reply: presses joined by ";", each "<buttons joined by , or -> <hold> <wait>", or "DONE".
local function run(reply)
  for chunk in reply:gmatch("[^;]+") do
    local names, holdFrames, waitFrames = chunk:match("^%s*(%S+)%s+(%d+)%s+(%d+)%s*$")
    if not names then
      console.log("emerald-jev: bad reply chunk: " .. chunk)
      advance(30)
      return
    end
    local buttons = {}
    if names ~= "-" then
      for name in names:gmatch("[^,]+") do buttons[name] = true end
    end
    hold(buttons, tonumber(holdFrames))
    advance(tonumber(waitFrames))
  end
end

console.log("emerald-jev: talking to " .. SERVER .. ", screenshots at " .. SCREENSHOT)
if readGameCode() ~= "BPEE" then
  console.log("emerald-jev: warning, game code is " .. readGameCode() .. ", expected BPEE")
end

while true do
  advance(SETTLE_FRAMES)
  client.screenshot(SCREENSHOT)

  local reply = comm.httpPost(SERVER .. "/step", readState())
  if reply == nil or reply == "" then
    -- Server down or HTTP disabled: wait, and never press anything without an answer.
    console.log("emerald-jev: no reply from server, retrying")
    advance(120)
  elseif reply:match("^%s*DONE") then
    console.log("emerald-jev: done")
    break
  else
    run(reply)
  end
end

while true do emu.frameadvance() end
