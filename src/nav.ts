import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Dir } from './schemas.ts'

// Pathfinding over every map on the route at once (src/maps.generated.json, built from
// pokeemerald by `npm run maps`). A position is (map, x, y); one press of a direction either
// walks a tile, jumps a ledge, or crosses a door, stairs, exit mat or map edge into another map.
// People and other things that move aren't in that data, so moves that fail at runtime are
// remembered as blocked for a while.

export type Tile = { x: number; y: number }
export type Pos = Tile & { map: string }

type Warp = { x: number; y: number; to: string | null; toWarp: number; behavior: string }
type Connection = { direction: 'up' | 'down' | 'left' | 'right'; to: string; offset: number }
type MapData = { group: number; num: number; w: number; h: number; rows: string[]; warps: Warp[]; connections: Connection[] }

export const MAPS: Record<string, MapData> = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, 'maps.generated.json'), 'utf8'),
)

export function mapNameFor(group: number, num: number): string | null {
  for (const [name, m] of Object.entries(MAPS)) if (m.group === group && m.num === num) return name
  return null
}

const STEP: Record<Dir, Tile> = { Up: { x: 0, y: -1 }, Down: { x: 0, y: 1 }, Left: { x: -1, y: 0 }, Right: { x: 1, y: 0 } }
const DIRS = Object.keys(STEP) as Dir[]
const EDGE: Record<Connection['direction'], Dir> = { up: 'Up', down: 'Down', left: 'Left', right: 'Right' }
const LEDGE: Record<string, Dir> = { v: 'Down', '^': 'Up', '<': 'Left', '>': 'Right' }

// Exit mats and similar: you stand on them and press the arrow's direction.
const ARROW: Record<string, Dir> = {
  MB_SOUTH_ARROW_WARP: 'Down',
  MB_NORTH_ARROW_WARP: 'Up',
  MB_EAST_ARROW_WARP: 'Right',
  MB_WEST_ARROW_WARP: 'Left',
  MB_DEEP_SOUTH_WARP: 'Down',
  MB_WATER_SOUTH_ARROW_WARP: 'Down',
}
// Doors: you walk up into them from the tile below; leaving, you appear one tile below.
const isDoor = (behavior: string) => /DOOR$/.test(behavior)

// A move must fail this many times before we treat it as blocked (the first try may only turn the player).
const FAILS_BEFORE_BLOCKED = 2
// Forget learned blocks after this many steps, since people move around.
const BLOCK_TTL_STEPS = 80

const key = (p: Pos) => `${p.map}:${p.x},${p.y}`
const same = (a: Pos, b: Pos) => a.map === b.map && a.x === b.x && a.y === b.y

export class Navigator {
  private blocked = new Map<string, number>() // edge key -> step it was learned
  private fails = new Map<string, number>()
  private last: { from: Pos; dir: Dir } | null = null
  private step = 0

  // Call once per overworld step, before choosing the next move.
  observe(pos: Pos) {
    this.step++
    for (const [k, learnedAt] of this.blocked) if (this.step - learnedAt > BLOCK_TTL_STEPS) this.blocked.delete(k)

    const last = this.last
    this.last = null
    if (!last) return
    const k = `${key(last.from)}:${last.dir}`
    if (same(last.from, pos)) {
      const n = (this.fails.get(k) ?? 0) + 1
      this.fails.set(k, n)
      if (n >= FAILS_BEFORE_BLOCKED) this.blocked.set(k, this.step)
    } else {
      this.fails.delete(k)
    }
  }

  // Next direction from `from` toward `to` (possibly on another map), or null if already there
  // or unreachable.
  nextDir(from: Pos, to: Pos): Dir | null {
    if (same(from, to)) return null
    let dir = this.search(from, to)
    if (!dir) {
      // Every route looks blocked; the learned blocks are stale, so forget them.
      this.blocked.clear()
      dir = this.search(from, to)
    }
    if (dir) this.last = { from, dir }
    return dir
  }

  // Remember a press made outside nextDir (pushing through a door), so failures are noticed.
  notePress(from: Pos, dir: Dir) {
    this.last = { from, dir }
  }

  // Where one press of `dir` from `cur` ends up, or null if it can't be done.
  move(cur: Pos, dir: Dir, target?: Pos): Pos | null {
    const map = MAPS[cur.map]
    if (!map || this.blocked.has(`${key(cur)}:${dir}`)) return null
    const tile = (x: number, y: number) => (x >= 0 && y >= 0 && x < map.w && y < map.h ? map.rows[y]![x]! : null)
    const warpAt = (x: number, y: number) => map.warps.find((w) => w.x === x && w.y === y)

    // Standing on an exit mat and pressing its direction.
    const here = warpAt(cur.x, cur.y)
    if (here && ARROW[here.behavior] === dir) return here.to ? arrive(here) : null

    const nx = cur.x + STEP[dir].x
    const ny = cur.y + STEP[dir].y
    const isTarget = target && target.map === cur.map && target.x === nx && target.y === ny

    // Off the edge of the map into a connected one.
    const t = tile(nx, ny)
    if (t === null) {
      const c = map.connections.find((c) => EDGE[c.direction] === dir)
      if (!c) return null
      const next = MAPS[c.to]!
      const dest =
        dir === 'Up' ? { x: nx - c.offset, y: next.h - 1 }
        : dir === 'Down' ? { x: nx - c.offset, y: 0 }
        : dir === 'Left' ? { x: next.w - 1, y: ny - c.offset }
        : { x: 0, y: ny - c.offset }
      const dt = next.rows[dest.y]?.[dest.x]
      return dt && dt !== '#' && !LEDGE[dt] ? { map: c.to, ...dest } : null
    }

    const warp = warpAt(nx, ny)
    if (warp) {
      // Walking up into a door enters it.
      if (isDoor(warp.behavior)) return dir === 'Up' && warp.to ? arrive(warp) : null
      // Exit mats are only entered by standing on them, so stepping onto one is a normal step.
      if (ARROW[warp.behavior]) return t === '#' ? null : { map: cur.map, x: nx, y: ny }
      // Stairs and the like warp as soon as you step on them; off-route ones are avoided
      // unless they are the target itself.
      if (warp.to) return arrive(warp)
      return isTarget ? { map: cur.map, x: nx, y: ny } : null
    }

    if (t === '#') return null
    const ledge = LEDGE[t]
    if (ledge) {
      if (ledge !== dir) return null
      const lx = nx + STEP[dir].x
      const ly = ny + STEP[dir].y
      const l = tile(lx, ly)
      return l === '.' || l === 'g' ? { map: cur.map, x: lx, y: ly } : null
    }
    return { map: cur.map, x: nx, y: ny }
  }

  private search(from: Pos, to: Pos): Dir | null {
    const firstDir = new Map<string, Dir>()
    const seen = new Set([key(from)])
    const queue: Pos[] = [from]
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i]!
      for (const dir of DIRS) {
        const next = this.move(cur, dir, to)
        if (!next) continue
        const k = key(next)
        if (seen.has(k)) continue
        seen.add(k)
        const via = i === 0 ? dir : firstDir.get(key(cur))!
        firstDir.set(k, via)
        if (same(next, to)) return via
        queue.push(next)
      }
    }
    return null
  }
}

// Where you appear after taking `warp`: its destination warp tile, or one tile below it for doors.
function arrive(warp: Warp): Pos | null {
  const dest = warp.to ? MAPS[warp.to]?.warps[warp.toWarp] : undefined
  if (!warp.to || !dest) return null
  return isDoor(dest.behavior) ? { map: warp.to, x: dest.x, y: dest.y + 1 } : { map: warp.to, x: dest.x, y: dest.y }
}
