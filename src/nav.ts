import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { MapName, Tile } from './goals.ts'
import { WARPS } from './goals.ts'
import type { Dir } from './schemas.ts'

// Grid pathfinding over each map's real collision data (src/maps.generated.json, built from
// pokeemerald by `npm run maps`). People and other things that move aren't in that data, so
// moves that fail at runtime are also remembered as walls for a while.

const STEP: Record<Dir, Tile> = {
  Up: { x: 0, y: -1 },
  Down: { x: 0, y: 1 },
  Left: { x: -1, y: 0 },
  Right: { x: 1, y: 0 },
}
const DIRS = Object.keys(STEP) as Dir[]

// A ledge can only be jumped across in one direction, landing two tiles on.
const LEDGE: Record<string, Dir> = { v: 'Down', '^': 'Up', '<': 'Left', '>': 'Right' }

type Grid = { w: number; h: number; rows: string[] }
const GRIDS: Record<MapName, Grid> = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, 'maps.generated.json'), 'utf8'),
)

// A move must fail this many times before we treat it as blocked (the first try may only turn the player).
const FAILS_BEFORE_BLOCKED = 2
// Forget learned blocks after this many steps, since people move around.
const BLOCK_TTL_STEPS = 80

type LastMove = { map: MapName; from: Tile; dir: Dir }

export class Navigator {
  private blocked = new Map<string, number>() // edge key -> step it was learned
  private fails = new Map<string, number>()
  private last: LastMove | null = null
  private step = 0

  // Call once per overworld step, before choosing the next move.
  observe(map: MapName, pos: Tile) {
    this.step++
    for (const [key, learnedAt] of this.blocked) {
      if (this.step - learnedAt > BLOCK_TTL_STEPS) this.blocked.delete(key)
    }

    const last = this.last
    this.last = null
    if (!last || last.map !== map) return

    const key = edgeKey(map, last.from, last.dir)
    if (last.from.x === pos.x && last.from.y === pos.y) {
      const n = (this.fails.get(key) ?? 0) + 1
      this.fails.set(key, n)
      if (n >= FAILS_BEFORE_BLOCKED) this.blocked.set(key, this.step)
    } else {
      this.fails.delete(key)
    }
  }

  // Next direction from `pos` toward `to`, or null if already there.
  nextDir(map: MapName, pos: Tile, to: Tile): Dir | null {
    if (pos.x === to.x && pos.y === to.y) return null

    let dir = this.bfs(map, pos, to)
    if (!dir) {
      // Every route looks blocked; the learned blocks are stale, so forget them for this map.
      this.forget(map)
      dir = this.bfs(map, pos, to)
    }
    if (dir) this.last = { map, from: pos, dir }
    return dir
  }

  private forget(map: MapName) {
    for (const key of [...this.blocked.keys()]) if (key.startsWith(`${map}:`)) this.blocked.delete(key)
  }

  // Where a single press of `dir` from `cur` ends up, or null if it can't be done.
  private move(map: MapName, cur: Tile, dir: Dir, to: Tile): Tile | null {
    const grid = GRIDS[map]
    const tile = (t: Tile) => (t.x >= 0 && t.y >= 0 && t.x < grid.w && t.y < grid.h ? grid.rows[t.y]![t.x]! : null)
    const isTarget = (t: Tile) => t.x === to.x && t.y === to.y
    // Doors and stairs warp to another map, so only step onto one when it's the destination.
    const isWarp = (t: Tile) => WARPS[map].some((w) => w.x === t.x && w.y === t.y)

    if (this.blocked.has(edgeKey(map, cur, dir))) return null
    const next = { x: cur.x + STEP[dir].x, y: cur.y + STEP[dir].y }
    const t = tile(next)
    if (t === null || t === '#') return null

    const ledge = LEDGE[t]
    if (ledge) {
      if (ledge !== dir) return null
      const landing = { x: next.x + STEP[dir].x, y: next.y + STEP[dir].y }
      const l = tile(landing)
      return l === '.' && !isWarp(landing) ? landing : null
    }

    if (isWarp(next) && !isTarget(next)) return null
    return next
  }

  private bfs(map: MapName, from: Tile, to: Tile): Dir | null {
    const firstDir = new Map<string, Dir>()
    const seen = new Set([`${from.x},${from.y}`])
    const queue: Tile[] = [from]

    while (queue.length) {
      const cur = queue.shift()!
      for (const dir of DIRS) {
        const next = this.move(map, cur, dir, to)
        if (!next) continue
        const k = `${next.x},${next.y}`
        if (seen.has(k)) continue
        seen.add(k)
        const via = cur === from ? dir : firstDir.get(`${cur.x},${cur.y}`)!
        firstDir.set(k, via)
        if (next.x === to.x && next.y === to.y) return via
        queue.push(next)
      }
    }
    return null
  }
}

function edgeKey(map: MapName, from: Tile, dir: Dir) {
  return `${map}:${from.x},${from.y}:${dir}`
}
