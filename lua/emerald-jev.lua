-- emerald-jev: runs inside BizHawk with Pokémon Emerald (USA, Europe).
-- Each step: read memory, save a screenshot, ask the bridge server what to press, press it.
-- Launch BizHawk with --url_get=http://127.0.0.1:3100/ or comm.httpPost is disabled.

local SERVER = "http://127.0.0.1:3100"
local SETTLE_FRAMES = 10 -- let the game draw before reading the screen
local SPEED_PERCENT = 400 -- emulator speed; the server scales its waits so screen checks stay ~0.25 s apart
local BUS = "System Bus"

-- The server says where to save screenshots (an absolute path it can read), set at startup.
local SCREENSHOT = nil

-- pret/pokeemerald symbols (USA/Europe).
local ADDR = {
  saveBlock1Ptr = 0x03005D8C, -- follow every read: the save block moves around
  mainCallback2 = 0x030022C4, -- gMain.callback2
  mainInBattle = 0x030026F9, -- gMain byte holding the inBattle bit (bit 1)
  lockFieldControls = 0x03000F2C, -- sLockFieldControls
  battleTypeFlags = 0x02022FEC,
  battleOutcome = 0x0202433A,
  gameCode = 0x080000AC, -- 4 ASCII bytes in the ROM header
  saveBlock2Ptr = 0x03005D90,
  playerParty = 0x020244EC, -- party slot 0 (struct Pokemon, 100 bytes)
  battleMons = 0x02024084, -- gBattleMons[0..1] (struct BattlePokemon, 0x58 each)
  actionCursor = 0x020244AC, -- gActionSelectionCursor[0]
  moveCursor = 0x020244B0, -- gMoveSelectionCursor[0]
  controllerFunc = 0x03005D60, -- gBattlerControllerFuncs[0]
}
local CB2_OVERWORLD = 0x08085E5C
local SB1_VARS = 0x139C -- u16 vars[] inside SaveBlock1, indexed by (id - 0x4000)
-- Raw blocks sent as hex; src/memory.ts decodes them. Offsets inside SaveBlock1/2.
local SB1_MONEY = 0x490
local SB1_BAG_ITEMS, BAG_ITEMS_LEN = 0x560, 30 * 4
local SB1_FLAGS, FLAGS_LEN = 0x1270, 0x12C
local VARS_LEN = 0x200 -- vars 0x4000-0x40FF
local SB2_ENCRYPTION_KEY = 0xAC
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

local function hex(addr, len)
  local bytes = memory.read_bytes_as_array(addr, len, BUS)
  local out = {}
  for i = 1, #bytes do out[i] = string.format("%02x", bytes[i]) end
  return table.concat(out)
end

local function readState()
  local sb1 = u32(ADDR.saveBlock1Ptr)
  local sb2 = u32(ADDR.saveBlock2Ptr)
  local cb2 = u32(ADDR.mainCallback2)
  local function var(id) return u16(sb1 + SB1_VARS + 2 * (id - 0x4000)) end

  -- Only numbers and fixed strings, so a hand-built JSON string is safe.
  return string.format(
    '{"frame":%d,"speedPercent":%d,"gameCode":"%s","mapGroup":%d,"mapNum":%d,"x":%d,"y":%d,' ..
      '"inBattle":%s,"controlsLocked":%s,"overworld":%s,"battleFlags":%d,"battleOutcome":%d,' ..
      '"vars":{"introState":%d,"townState":%d,"route101State":%d,"birchLabState":%d},"screenshot":"%s",' ..
      '"raw":{"party0":"%s","battleMons":"%s","actionCursor":%d,"moveCursor":%d,"controllerFunc":%d,' ..
      '"encryptionKey":%d,"money":%d,"bagItems":"%s","flags":"%s","vars":"%s"}}',
    emu.framecount(),
    SPEED_PERCENT,
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
    SCREENSHOT,
    hex(ADDR.playerParty, 100),
    hex(ADDR.battleMons, 2 * 0x58),
    u8(ADDR.actionCursor),
    u8(ADDR.moveCursor),
    u32(ADDR.controllerFunc),
    u32(sb2 + SB2_ENCRYPTION_KEY),
    u32(sb1 + SB1_MONEY),
    hex(sb1 + SB1_BAG_ITEMS, BAG_ITEMS_LEN),
    hex(sb1 + SB1_FLAGS, FLAGS_LEN),
    hex(sb1 + SB1_VARS, VARS_LEN)
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

-- Reply: chunks joined by ";". Each is "<buttons joined by , or -> <hold> <wait>",
-- "SAVE:<absolute path>" (save a state there), or "DONE". Returns true on DONE.
local function run(reply)
  for chunk in reply:gmatch("[^;]+") do
    local savePath = chunk:match("^%s*SAVE:(.-)%s*$")
    if savePath then
      savestate.save(savePath)
      console.log("emerald-jev: saved state " .. savePath)
      goto continue
    end
    if chunk:match("^%s*DONE") then return true end
    local names, holdFrames, waitFrames = chunk:match("^%s*(%S+)%s+(%d+)%s+(%d+)%s*$")
    if not names then
      console.log("emerald-jev: bad reply chunk: " .. chunk)
      advance(30)
      return false
    end
    local buttons = {}
    if names ~= "-" then
      for name in names:gmatch("[^,]+") do buttons[name] = true end
    end
    hold(buttons, tonumber(holdFrames))
    advance(tonumber(waitFrames))
    ::continue::
  end
  return false
end

client.speedmode(SPEED_PERCENT)
console.log("emerald-jev: talking to " .. SERVER .. " at " .. SPEED_PERCENT .. "% speed")
if readGameCode() ~= "BPEE" then
  console.log("emerald-jev: warning, game code is " .. readGameCode() .. ", expected BPEE")
end

while SCREENSHOT == nil do
  -- httpGet throws (rather than returning nil) when the server isn't up yet.
  local ok, path = pcall(comm.httpGet, SERVER .. "/screenshot-path")
  if ok and type(path) == "string" and path:match("^/") then
    SCREENSHOT = path:gsub("%s+$", "")
    console.log("emerald-jev: saving screenshots to " .. SCREENSHOT)
  else
    console.log("emerald-jev: waiting for the server at " .. SERVER)
    advance(120)
  end
end

while true do
  advance(SETTLE_FRAMES)
  client.screenshot(SCREENSHOT)

  local reply = comm.httpPost(SERVER .. "/step", readState())
  if reply == nil or reply == "" then
    -- Server down or HTTP disabled: wait, and never press anything without an answer.
    console.log("emerald-jev: no reply from server, retrying")
    advance(120)
  elseif run(reply) then
    console.log("emerald-jev: done")
    break
  end
end

while true do emu.frameadvance() end
