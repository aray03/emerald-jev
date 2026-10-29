import type { MapName, Tile } from './goals.ts'
import { MAP_SIZE, WARPS } from './goals.ts'
import type { Dir } from './schemas.ts'

// Grid pathfinding that learns walls by bumping into them.
// We don't read collision data from memory, so every tile starts out assumed walkable.

const STEP: Record<Dir, Tile> = {
  Up: { x: 0, y: -1 },
  Down: { x: 0, y: 1 },
  Left: { x: -1, y: 0 },
  Right: { x: 1, y: 0 },
}
const DIRS = Object.keys(STEP) as Dir[]

// A move must fail this many times before we treat it as a wall (the first try may only turn the player).
const FAILS_BEFORE_BLOCKED = 2
// Forget learned walls after this many steps, since NPCs move around.
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
      // Every route looks walled off; our guesses are stale, so start over for this map.
      this.forget(map)
      dir = this.bfs(map, pos, to)
    }
    if (dir) this.last = { map, from: pos, dir }
    return dir
  }

  learnedWalls(map: MapName): number {
    let n = 0
    for (const key of this.blocked.keys()) if (key.startsWith(`${map}:`)) n++
    return n
  }

  private forget(map: MapName) {
    for (const key of [...this.blocked.keys()]) if (key.startsWith(`${map}:`)) this.blocked.delete(key)
  }

  private bfs(map: MapName, from: Tile, to: Tile): Dir | null {
    const { w, h } = MAP_SIZE[map]
    const inBounds = (t: Tile) => t.x >= 0 && t.y >= 0 && t.x < w && t.y < h
    const firstDir = new Map<string, Dir>()
    const seen = new Set([`${from.x},${from.y}`])
    const queue: Tile[] = [from]
    // Doors and stairs warp to another map, so only step onto one when it's the destination.
    const isWarp = (t: Tile) => WARPS[map].some((w) => w.x === t.x && w.y === t.y)

    while (queue.length) {
      const cur = queue.shift()!
      for (const dir of DIRS) {
        if (this.blocked.has(edgeKey(map, cur, dir))) continue
        const next = { x: cur.x + STEP[dir].x, y: cur.y + STEP[dir].y }
        const k = `${next.x},${next.y}`
        if (!inBounds(next) || seen.has(k)) continue
        if (isWarp(next) && !(next.x === to.x && next.y === to.y)) continue
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
