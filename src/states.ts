import { mkdirSync } from 'node:fs'
import path from 'node:path'

// Save-state checkpoints. The server queues a save; the Lua script performs it on its next step
// with savestate.save(path). Start from one with STATE=states/<name>.State ./play.sh.

export const STATES_DIR = path.resolve(import.meta.dirname, '../states')
mkdirSync(STATES_DIR, { recursive: true })

let pending: string | null = null

// Names become file names, so keep them to letters, digits, dashes and underscores.
export function queueSave(name: string): string {
  const safe = name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'manual'
  pending = path.join(STATES_DIR, `${safe}.State`)
  return pending
}

export function takePendingSave(): string | null {
  const p = pending
  pending = null
  return p
}
