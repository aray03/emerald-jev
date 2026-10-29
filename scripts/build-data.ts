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

const [movesH, speciesH, itemsH, pokemonH, moveNames, speciesNames, itemsData, battleMoves, speciesInfo] =
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
  ])

const typeIds = defines(pokemonH, 'TYPE_')
const typeName = (t?: string) => (t ? t.replace(/^TYPE_/, '').toLowerCase() : 'none')

const moveIds = defines(movesH, 'MOVE_')
const moveNameMap = nameTable(moveNames, 'MOVE_')
const moveBlocks = blocks(battleMoves, 'MOVE_')
const moves: Record<number, { name: string; type: string; power: number; pp: number }> = {}
for (const [key, id] of moveIds) {
  const b = moveBlocks.get(key)
  const name = moveNameMap.get(key)
  if (!b || !name) continue
  moves[id] = { name, type: typeName(field(b, 'type')), power: Number(field(b, 'power') ?? 0), pp: Number(field(b, 'pp') ?? 0) }
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

writeFileSync(OUT, JSON.stringify({ moves, species, items, types }) + '\n')
console.log(`moves ${Object.keys(moves).length}, species ${Object.keys(species).length}, items ${Object.keys(items).length}, types ${Object.keys(types).length}`)
console.log('checks:', moves[52], moves[24], species[280], species[74], species[299], items[13], items[4], types[5])
console.log(`wrote ${OUT}`)
