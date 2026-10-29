// List saved checkpoints: npm run states
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
const dir = path.resolve(import.meta.dirname, '../states')
const files = readdirSync(dir).filter((f) => f.endsWith('.State')).sort()
if (!files.length) console.log('no save states yet')
for (const f of files) console.log(`${statSync(path.join(dir, f)).mtime.toISOString().slice(0, 16)}  states/${f}`)
console.log('\nstart from one with: STATE=states/<name>.State ./play.sh')
