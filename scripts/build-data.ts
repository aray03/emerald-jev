// Builds src/data.generated.json: names and stats for moves, species, items, and types, from the
// pret/pokeemerald decompilation, so memory values (ids) can be shown to Jev as words.
// Run with `npm run data`. The output is committed.

import { writeFileSync } from 'node:fs'
import path from 'node:path'

const REPO = 'https://raw.githubusercontent.com/pret/pokeemerald/master'
const OUT = path.resolve(import.meta.dirname, '../src/data.generated.json')

async function text(file: string): Promise<string> {
  const res = await fetch(`${REPO}/${file}`)
  if (!res.ok) throw new Error(`${res.status} fetching ${file}`)
  return res.text()
}

// `#define NAME 123` constants.
function defines(src: string, prefix: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of src.matchAll(new RegExp(`^#define (${prefix}\\w+)\\s+(\\d+)\\b`, 'gm'))) out.set(m[1]!, Number(m[2]))
  return out
}

// The first `enum { ... };` whose members start with `prefix`, numbered like C does.
function enumValues(src: string, prefix: string): Map<string, number> {
  const out = new Map<string, number>()
  const start = src.search(new RegExp(`enum\\s*\\{\\s*(//[^\\n]*\\s*)*${prefix}`))
  const body = src.slice(start, src.indexOf('};', start)).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  let next = 0
  for (const m of body.matchAll(new RegExp(`(${prefix}\\w+)\\s*(?:=\\s*([^,\\n]+))?\\s*,`, 'g'))) {
    if (m[2]) next = /^\d+$/.test(m[2].trim()) ? Number(m[2]) : out.get(m[2].trim()) ?? next
    out.set(m[1]!, next++)
  }
  return out
}

// `[KEY] = _("TEXT"),` tables.
function nameTable(src: string, prefix: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of src.matchAll(new RegExp(`\\[(${prefix}\\w+)\\]\\s*=\\s*_\\("([^"]*)"\\)`, 'g'))) out.set(m[1]!, m[2]!)
  return out
}

// `[KEY] = { ... }` struct blocks, by key.
function blocks(src: string, prefix: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = new RegExp(`\\[(${prefix}\\w+)\\]\\s*=\\s*\\{`, 'g')
  for (const m of src.matchAll(re)) {
    let depth = 1
    let i = m.index! + m[0].length
    while (depth && i < src.length) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    out.set(m[1]!, src.slice(m.index!, i))
  }
  return out
}

const field = (block: string, name: string) => block.match(new RegExp(`\\.${name}\\s*=\\s*([^,\\n]+)`))?.[1]?.trim()

const [movesH, speciesH, itemsH, pokemonH, moveNames, speciesNames, itemsData, battleMoves, speciesInfo, battleMain] =
  await Promise.all([
    text('include/constants/moves.h'),
    text('include/constants/species.h'),
    text('include/constants/items.h'),
    text('include/constants/pokemon.h'),
    text('src/data/text/move_names.h'),
    text('src/data/text/species_names.h'),
    text('src/data/items.h'),
    text('src/data/battle_moves.h'),
    text('src/data/pokemon/species_info.h'),
    text('src/battle_main.c'),
  ])

const typeIds = defines(pokemonH, 'TYPE_')
const typeName = (t?: string) => (t ? t.replace(/^TYPE_/, '').toLowerCase() : 'none')

const moveIds = defines(movesH, 'MOVE_')
const moveNameMap = nameTable(moveNames, 'MOVE_')
const moveBlocks = blocks(battleMoves, 'MOVE_')
const moves: Record<number, { name: string; type: string; power: number; pp: number; effect: string }> = {}
for (const [key, id] of moveIds) {
  const b = moveBlocks.get(key)
  const name = moveNameMap.get(key)
  if (!b || !name) continue
  moves[id] = {
    name,
    type: typeName(field(b, 'type')),
    power: Number(field(b, 'power') ?? 0),
    pp: Number(field(b, 'pp') ?? 0),
    effect: (field(b, 'effect') ?? 'EFFECT_HIT').replace(/^EFFECT_/, ''),
  }
}

const speciesIds = defines(speciesH, 'SPECIES_')
const speciesNameMap = nameTable(speciesNames, 'SPECIES_')
const speciesBlocks = blocks(speciesInfo, 'SPECIES_')
const species: Record<number, { name: string; types: string[] }> = {}
for (const [key, id] of speciesIds) {
  const b = speciesBlocks.get(key)
  const name = speciesNameMap.get(key)
  if (!b || !name) continue
  const types = [...(b.match(/\.types\s*=\s*\{([^}]*)\}/)?.[1] ?? '').matchAll(/TYPE_\w+/g)].map((t) => typeName(t[0]))
  species[id] = { name, types: [...new Set(types)] }
}

const itemIds = enumValues(itemsH, 'ITEM_')
const itemBlocks = blocks(itemsData, 'ITEM_')
const items: Record<number, { name: string; price: number }> = {}
for (const [key, id] of itemIds) {
  const b = itemBlocks.get(key)
  const name = b?.match(/\.name\s*=\s*_\("([^"]*)"\)/)?.[1]
  if (!b || !name) continue
  items[id] = { name, price: Number(field(b, 'price') ?? 0) }
}

const types: Record<number, string> = {}
for (const [key, id] of typeIds) if (id !== 255) types[id] = typeName(key)

// gTypeEffectiveness (src/battle_main.c): attacker type, defender type, multiplier x10.
// Pairs not listed are neutral. The TYPE_FORESIGHT marker only splits off the Ghost immunities,
// which apply normally, so it is skipped.
const MULTIPLIER: Record<string, number> = { TYPE_MUL_SUPER_EFFECTIVE: 2, TYPE_MUL_NOT_EFFECTIVE: 0.5, TYPE_MUL_NO_EFFECT: 0 }
const table = battleMain.slice(battleMain.indexOf('gTypeEffectiveness['), battleMain.indexOf('};', battleMain.indexOf('gTypeEffectiveness[')))
const typeChart: [string, string, number][] = []
for (const m of table.matchAll(/(TYPE_\w+),\s*(TYPE_\w+),\s*(TYPE_MUL_\w+)/g)) {
  if (m[1] === 'TYPE_FORESIGHT' || m[1] === 'TYPE_ENDTABLE') continue
  typeChart.push([typeName(m[1]), typeName(m[2]), MULTIPLIER[m[3]!] ?? 1])
}

// Poké Mart stock lists, in on-screen order, from each Mart's clerk script. Which list is shown
// can depend on a story flag (`goto_if_set FLAG, Label` / `goto_if_unset`), else the default.
const flagsH = await text('include/constants/flags.h')
const flagIds = new Map<string, number>()
for (const m of flagsH.matchAll(/^#define (FLAG_\w+)\s+(0x[0-9A-Fa-f]+|\d+)\b/gm)) flagIds.set(m[1]!, Number(m[2]))
type Stock = { default: string[] | null; rules: { flag: number; set: boolean; items: string[] }[] }
const marts: Record<string, Stock> = {}
for (const mart of ['OldaleTown_Mart', 'PetalburgCity_Mart', 'RustboroCity_Mart']) {
  const src = await text(`data/maps/${mart}/scripts.inc`)
  // Items of the `pokemart` list that follows a label (or the clerk script itself).
  const listAfter = (from: number) => {
    const name = src.slice(from).match(/pokemart (\w+)/)?.[1]
    if (!name) return null
    const body = src.slice(src.indexOf(`${name}:`), src.indexOf('pokemartlistend', src.indexOf(`${name}:`)))
    return [...body.matchAll(/\.2byte (ITEM_\w+)/g)].map((m) => items[itemIds.get(m[1]!)!]?.name ?? m[1]!)
  }
  const clerk = src.indexOf('EventScript_Clerk::')
  const clerkBody = src.slice(clerk, src.indexOf('::', src.indexOf('\n', clerk)))
  const rules = [...clerkBody.matchAll(/goto_if_(set|unset) (FLAG_\w+), (\w+)/g)].map((m) => ({
    flag: flagIds.get(m[2]!)!,
    set: m[1] === 'set',
    items: listAfter(src.indexOf(`${m[3]}::`))!,
  }))
  marts[mart] = { default: /pokemart /.test(clerkBody) ? listAfter(clerk) : null, rules }
}

writeFileSync(OUT, JSON.stringify({ moves, species, items, types, typeChart, marts }) + '\n')
console.log('marts:', JSON.stringify(marts))
console.log(`moves ${Object.keys(moves).length}, species ${Object.keys(species).length}, items ${Object.keys(items).length}, types ${Object.keys(types).length}`)
console.log('checks:', moves[52], moves[24], species[280], species[74], items[13], items[4], types[5], `typeChart ${typeChart.length} entries`)
console.log(`wrote ${OUT}`)
