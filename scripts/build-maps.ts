// Builds src/maps.generated.json: every map the bot visits on the way to the first gym, from the
// pret/pokeemerald decompilation (the same data the ROM is built from).
// Run with `npm run maps`. The output is committed, so the bot never needs the network for this.
//
// For each map: its game id (group/num), a walkability grid, warps (doors, stairs, exit mats)
// and edge connections to neighbouring maps. Grid rows use one character per tile:
//   .  walkable      g  tall grass (walkable, wild Pokémon)      #  blocked (walls, water, ...)
//   v ^ < >  a ledge you can only jump across in that direction (down, up, left, right)

import { writeFileSync } from 'node:fs'
import path from 'node:path'

const REPO = 'https://raw.githubusercontent.com/pret/pokeemerald/master'
const OUT = path.resolve(import.meta.dirname, '../src/maps.generated.json')

// pokeemerald map folder names (data/maps/<name>), in route order.
const MAPS = [
  'InsideOfTruck',
  'LittlerootTown',
  'LittlerootTown_BrendansHouse_1F',
  'LittlerootTown_BrendansHouse_2F',
  'LittlerootTown_MaysHouse_1F',
  'LittlerootTown_MaysHouse_2F',
  'LittlerootTown_ProfessorBirchsLab',
  'Route101',
  'OldaleTown',
  'OldaleTown_PokemonCenter_1F',
  'OldaleTown_Mart',
  'Route103',
  'Route102',
  'PetalburgCity',
  'PetalburgCity_Gym',
  'PetalburgCity_PokemonCenter_1F',
  'PetalburgCity_Mart',
  'Route104',
  'PetalburgWoods',
  'RustboroCity',
  'RustboroCity_Gym',
  'RustboroCity_PokemonCenter_1F',
  'RustboroCity_Mart',
]

const NUM_METATILES_IN_PRIMARY = 512 // include/fieldmap.h
const METATILE_ID_MASK = 0x03ff // include/global.fieldmap.h
const COLLISION_MASK = 0x0c00

const JUMP: Record<string, string> = { MB_JUMP_SOUTH: 'v', MB_JUMP_NORTH: '^', MB_JUMP_WEST: '<', MB_JUMP_EAST: '>' }
const WATER = /^MB_.*WATER$/
const GRASS = new Set(['MB_TALL_GRASS', 'MB_LONG_GRASS'])

async function get(file: string): Promise<Response> {
  const res = await fetch(`${REPO}/${file}`)
  if (!res.ok) throw new Error(`${res.status} fetching ${file}`)
  return res
}
const text = async (file: string) => (await get(file)).text()
const u16s = async (file: string) => new Uint16Array(await (await get(file)).arrayBuffer())

// gTileset_General -> data/tilesets/primary/general (secondary tilesets live under secondary/).
function tilesetDir(symbol: string, primary: boolean): string {
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

type Layout = { id: string; width: number; height: number; primary_tileset: string; secondary_tileset: string; blockdata_filepath: string }
type MapJson = {
  id: string
  layout: string
  connections?: { map: string; offset: number; direction: string }[] | null
  warp_events?: { x: number; y: number; dest_map: string; dest_warp_id: string | number }[]
}

const layouts: Layout[] = JSON.parse(await text('data/layouts/layouts.json')).layouts
const groups: Record<string, string[]> & { group_order: string[] } = JSON.parse(await text('data/maps/map_groups.json'))
const behaviors = await behaviorNames()

// Map folder name -> [group, num], numbered the way the game does.
const mapIds = new Map<string, [number, number]>()
groups.group_order.forEach((g, gi) => groups[g]!.forEach((m, mi) => mapIds.set(m, [gi, mi])))

const jsons = new Map<string, MapJson>()
for (const name of MAPS) jsons.set(name, JSON.parse(await text(`data/maps/${name}/map.json`)))
// MAP_ROUTE_101 style ids -> folder names, for warp and connection targets.
const byConstant = new Map([...jsons].map(([name, j]) => [j.id, name]))

const out: Record<string, unknown> = {}
for (const name of MAPS) {
  const json = jsons.get(name)!
  const layout = layouts.find((l) => l.id === json.layout)
  if (!layout) throw new Error(`no layout ${json.layout}`)

  const grid = await u16s(layout.blockdata_filepath)
  const primary = await u16s(`${tilesetDir(layout.primary_tileset, true)}/metatile_attributes.bin`)
  const secondary = await u16s(`${tilesetDir(layout.secondary_tileset, false)}/metatile_attributes.bin`)
  const behaviorAt = (x: number, y: number) => {
    const id = grid[y * layout.width + x]! & METATILE_ID_MASK
    const attr = id < NUM_METATILES_IN_PRIMARY ? primary[id] : secondary[id - NUM_METATILES_IN_PRIMARY]
    return behaviors[(attr ?? 0) & 0xff] ?? 'MB_NORMAL'
  }

  const rows: string[] = []
  for (let y = 0; y < layout.height; y++) {
    let row = ''
    for (let x = 0; x < layout.width; x++) {
      const behavior = behaviorAt(x, y)
      if (JUMP[behavior]) row += JUMP[behavior]
      else if (grid[y * layout.width + x]! & COLLISION_MASK || WATER.test(behavior)) row += '#'
      else row += GRASS.has(behavior) ? 'g' : '.'
    }
    rows.push(row)
  }

  // Warps to maps outside the route keep `to: null`, so the bot treats them as places to avoid.
  const warps = (json.warp_events ?? []).map((w) => ({
    x: w.x,
    y: w.y,
    to: byConstant.get(w.dest_map) ?? null,
    toWarp: Number(w.dest_warp_id),
    behavior: behaviorAt(w.x, w.y),
  }))
  const connections = (json.connections ?? [])
    .map((c) => ({ direction: c.direction, to: byConstant.get(c.map) ?? null, offset: c.offset }))
    .filter((c) => c.to)

  const [group, num] = mapIds.get(name)!
  out[name] = { group, num, w: layout.width, h: layout.height, rows, warps, connections }
  console.log(`${name} ${group}/${num} ${layout.width}x${layout.height}, ${warps.length} warps, ${connections.length} connections`)
}

writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n')
console.log(`wrote ${OUT}`)
