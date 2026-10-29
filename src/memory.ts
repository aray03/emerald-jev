import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { RawMemory } from './schemas.ts'

// Decodes the raw memory blocks the Lua script sends (hex) into plain facts.
// Layouts are from pret/pokeemerald: include/pokemon.h, include/battle.h, include/global.h.

type Data = {
  moves: Record<string, { name: string; type: string; power: number; pp: number; effect: string }>
  species: Record<string, { name: string; types: string[] }>
  items: Record<string, { name: string; price: number }>
  types: Record<string, string>
  typeChart: [string, string, number][] // attacker type, defender type, multiplier
}
export const DATA: Data = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'data.generated.json'), 'utf8'))

export const ITEM_POTION = 13

// Battle controller functions (gBattlerControllerFuncs[0]), Thumb pointers so address + 1.
const HANDLE_INPUT_CHOOSE_ACTION = 0x08057589
const HANDLE_INPUT_CHOOSE_MOVE = 0x08057bfd

const bytes = (hex: string) => Buffer.from(hex, 'hex')

export type Move = { id: number; name: string; type: string; power: number; pp: number; effect: string }
export type Mon = { species: number; name: string; types: string[]; level: number; hp: number; maxHp: number; moves: Move[] }

function move(id: number, pp: number): Move {
  const m = DATA.moves[id]
  return { id, name: m?.name ?? `MOVE ${id}`, type: m?.type ?? 'unknown', power: m?.power ?? 0, pp, effect: m?.effect ?? 'HIT' }
}

// Type effectiveness of a move type against a defender's types, from the game's own chart.
export function effectiveness(moveType: string, defenderTypes: string[]): number {
  return defenderTypes.reduce(
    (mult, def) => mult * (DATA.typeChart.find(([a, d]) => a === moveType && d === def)?.[2] ?? 1),
    1,
  )
}

function speciesInfo(id: number) {
  const s = DATA.species[id]
  return { name: s?.name ?? `SPECIES ${id}`, types: s?.types ?? [] }
}

// Party slot: header and battle stats are plain; species and moves sit in four 12-byte
// substructs, XORed with personality ^ otId and shuffled by personality % 24.
// Each entry: the slot (0-3) holding [Growth, Attacks, EVs, Misc].
const SUBSTRUCT_ORDER = [
  '0123', '0132', '0213', '0312', '0231', '0321', '1023', '1032', '2013', '3012', '2031', '3021',
  '1203', '1302', '2103', '3102', '2301', '3201', '1230', '1320', '2130', '3120', '2310', '3210',
].map((s) => [...s].map(Number))

export function decodePartyMon(hex: string): Mon | null {
  const b = bytes(hex)
  if (b.length < 100) return null
  const personality = b.readUInt32LE(0x00)
  const otId = b.readUInt32LE(0x04)
  if (personality === 0 && otId === 0) return null // empty slot

  const key = (personality ^ otId) >>> 0
  const secure = Buffer.alloc(48)
  for (let i = 0; i < 48; i += 4) secure.writeUInt32LE((b.readUInt32LE(0x20 + i) ^ key) >>> 0, i)

  let sum = 0
  for (let i = 0; i < 48; i += 2) sum = (sum + secure.readUInt16LE(i)) & 0xffff
  if (sum !== b.readUInt16LE(0x1c)) return null // bad checksum: not a valid Pokémon (or mid-write)

  const [growth, attacks] = SUBSTRUCT_ORDER[personality % 24]!
  const g = growth! * 12
  const a = attacks! * 12
  const species = secure.readUInt16LE(g)
  const moves: Move[] = []
  for (let i = 0; i < 4; i++) {
    const id = secure.readUInt16LE(a + i * 2)
    if (id) moves.push(move(id, secure.readUInt8(a + 8 + i)))
  }
  return { species, ...speciesInfo(species), level: b.readUInt8(0x54), hp: b.readUInt16LE(0x56), maxHp: b.readUInt16LE(0x58), moves }
}

// gBattleMons[i] (struct BattlePokemon, 0x58 bytes): 0 = player, 1 = enemy in single battles.
export function decodeBattleMon(hex: string, index: number): Mon | null {
  const b = bytes(hex).subarray(index * 0x58, (index + 1) * 0x58)
  if (b.length < 0x58) return null
  const species = b.readUInt16LE(0x00)
  if (!species) return null
  const moves: Move[] = []
  for (let i = 0; i < 4; i++) {
    const id = b.readUInt16LE(0x0c + i * 2)
    if (id) moves.push(move(id, b.readUInt8(0x24 + i)))
  }
  const types = [...new Set([b.readUInt8(0x21), b.readUInt8(0x22)].map((t) => DATA.types[t] ?? `type ${t}`))]
  return { species, name: speciesInfo(species).name, types, level: b.readUInt8(0x2a), hp: b.readUInt16LE(0x28), maxHp: b.readUInt16LE(0x2c), moves }
}

export type BagItem = { id: number; name: string; quantity: number }

// Items pocket: 30 × {u16 itemId; u16 quantity ^ low 16 bits of the encryption key}.
export function decodeBagItems(hex: string, encryptionKey: number): BagItem[] {
  const b = bytes(hex)
  const out: BagItem[] = []
  for (let i = 0; i + 4 <= b.length; i += 4) {
    const id = b.readUInt16LE(i)
    if (!id) continue
    const quantity = (b.readUInt16LE(i + 2) ^ (encryptionKey & 0xffff)) & 0xffff
    out.push({ id, name: DATA.items[id]?.name ?? `ITEM ${id}`, quantity })
  }
  return out
}

export function decodeMoney(raw: number, encryptionKey: number): number {
  return (raw ^ encryptionKey) >>> 0
}

export type Facts = {
  party0: Mon | null
  player: Mon | null // in battle
  foe: Mon | null // in battle
  choosingAction: boolean
  choosingMove: boolean
  actionCursor: number
  moveCursor: number
  bag: BagItem[]
  potions: number
  money: number
  flag: (id: number) => boolean
  variable: (id: number) => number
}

export function decodeFacts(raw: RawMemory, inBattle: boolean): Facts {
  const flags = bytes(raw.flags)
  const vars = bytes(raw.vars)
  const bag = decodeBagItems(raw.bagItems, raw.encryptionKey)
  return {
    party0: decodePartyMon(raw.party0),
    player: inBattle ? decodeBattleMon(raw.battleMons, 0) : null,
    foe: inBattle ? decodeBattleMon(raw.battleMons, 1) : null,
    choosingAction: inBattle && raw.controllerFunc === HANDLE_INPUT_CHOOSE_ACTION,
    choosingMove: inBattle && raw.controllerFunc === HANDLE_INPUT_CHOOSE_MOVE,
    actionCursor: raw.actionCursor,
    moveCursor: raw.moveCursor,
    bag,
    potions: bag.filter((i) => i.id === ITEM_POTION).reduce((n, i) => n + i.quantity, 0),
    money: decodeMoney(raw.money, raw.encryptionKey),
    flag: (id) => ((flags[id >> 3] ?? 0) >> (id & 7)) & 1 ? true : false,
    variable: (id) => (2 * (id - 0x4000) + 1 < vars.length ? vars.readUInt16LE(2 * (id - 0x4000)) : 0),
  }
}
