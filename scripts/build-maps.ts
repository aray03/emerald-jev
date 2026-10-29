// Builds src/maps.generated.json: a walkability grid for every map the bot visits, from the
// pret/pokeemerald decompilation (the same data the ROM is built from).
// Run with `npm run maps`. The output is committed, so the bot never needs the network for this.
//
// Each map is a list of rows, one character per tile:
//   .  walkable            #  blocked (wall, tree, furniture, water)
//   v ^ < >  a ledge you can only jump across in that direction (down, up, left, right)

import { writeFileSync } from 'node:fs'
import path from 'node:path'

const REPO = 'https://raw.githubusercontent.com/pret/pokeemerald/master'
const OUT = path.resolve(import.meta.dirname, '../src/maps.generated.json')

// Our map names -> pokeemerald layout ids.
const MAPS = {
  truck: 'LAYOUT_INSIDE_OF_TRUCK',
  littleroot: 'LAYOUT_LITTLEROOT_TOWN',
  oldale: 'LAYOUT_OLDALE_TOWN',
  route101: 'LAYOUT_ROUTE101',
  brendan1F: 'LAYOUT_LITTLEROOT_TOWN_BRENDANS_HOUSE_1F',
  brendan2F: 'LAYOUT_LITTLEROOT_TOWN_BRENDANS_HOUSE_2F',
  may1F: 'LAYOUT_LITTLEROOT_TOWN_MAYS_HOUSE_1F',
  may2F: 'LAYOUT_LITTLEROOT_TOWN_MAYS_HOUSE_2F',
  lab: 'LAYOUT_LITTLEROOT_TOWN_PROFESSOR_BIRCHS_LAB',
}

const NUM_METATILES_IN_PRIMARY = 512 // include/fieldmap.h
const METATILE_ID_MASK = 0x03ff // include/global.fieldmap.h
const COLLISION_MASK = 0x0c00

const JUMP: Record<string, string> = { MB_JUMP_SOUTH: 'v', MB_JUMP_NORTH: '^', MB_JUMP_WEST: '<', MB_JUMP_EAST: '>' }
const WATER = /^MB_.*WATER$/

async function get(file: string): Promise<Response> {
  const res = await fetch(`${REPO}/${file}`)
  if (!res.ok) throw new Error(`${res.status} fetching ${file}`)
  return res
}
const text = async (file: string) => (await get(file)).text()
const u16s = async (file: string) => new Uint16Array(await (await get(file)).arrayBuffer())

// gTileset_General -> data/tilesets/primary/general (secondary tilesets live under secondary/).
async function tilesetDir(symbol: string, primary: boolean): Promise<string> {
  const snake = symbol
    .replace(/^gTileset_/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
  return `data/tilesets/${primary ? 'primary' : 'secondary'}/${snake}`
}

// MB_* constants are a plain enum starting at 0.
async function behaviorNames(): Promise<string[]> {
  const src = await text('include/constants/metatile_behaviors.h')
  const body = src.slice(src.indexOf('enum {'), src.indexOf('};'))
  return [...body.matchAll(/^\s*(MB_\w+)\s*,/gm)].map((m) => m[1]!)
}

const layouts: { id: string; width: number; height: number; primary_tileset: string; secondary_tileset: string; blockdata_filepath: string }[] =
  JSON.parse(await text('data/layouts/layouts.json')).layouts

const behaviors = await behaviorNames()
const out: Record<string, { w: number; h: number; rows: string[] }> = {}

for (const [name, layoutId] of Object.entries(MAPS)) {
  const layout = layouts.find((l) => l.id === layoutId)
  if (!layout) throw new Error(`no layout ${layoutId}`)

  const grid = await u16s(layout.blockdata_filepath)
  const primary = await u16s(`${await tilesetDir(layout.primary_tileset, true)}/metatile_attributes.bin`)
  const secondary = await u16s(`${await tilesetDir(layout.secondary_tileset, false)}/metatile_attributes.bin`)

  const rows: string[] = []
  for (let y = 0; y < layout.height; y++) {
    let row = ''
    for (let x = 0; x < layout.width; x++) {
      const block = grid[y * layout.width + x]!
      const id = block & METATILE_ID_MASK
      const attr = id < NUM_METATILES_IN_PRIMARY ? primary[id] : secondary[id - NUM_METATILES_IN_PRIMARY]
      const behavior = behaviors[(attr ?? 0) & 0xff] ?? 'MB_NORMAL'
      if (JUMP[behavior]) row += JUMP[behavior]
      else if (block & COLLISION_MASK || WATER.test(behavior)) row += '#'
      else row += '.'
    }
    rows.push(row)
  }
  out[name] = { w: layout.width, h: layout.height, rows }
  console.log(`${name} (${layout.width}x${layout.height})\n${rows.join('\n')}\n`)
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
console.log(`wrote ${OUT}`)
