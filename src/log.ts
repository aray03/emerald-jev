import { appendFileSync, copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

// One JSON line per step in runs/<timestamp>.jsonl, plus a copy of each frame Jev saw,
// so any decision can be looked at and rerun later.

export const RUNS_DIR = path.resolve(import.meta.dirname, '../runs')
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const framesDir = path.join(RUNS_DIR, runId)
const logFile = path.join(RUNS_DIR, `${runId}.jsonl`)

mkdirSync(framesDir, { recursive: true })

export function saveFrame(step: number, screenshot: string): string {
  const dest = path.join(framesDir, `${String(step).padStart(5, '0')}.png`)
  copyFileSync(screenshot, dest)
  return dest
}

export function logStep(entry: Record<string, unknown>) {
  appendFileSync(logFile, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n')
}

export const logPath = logFile
