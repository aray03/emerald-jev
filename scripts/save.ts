// Queue a save state on the running server: npm run save -- <name>
const name = process.argv[2] ?? 'manual'
const port = process.env.EMERALD_PORT ?? '3100'
const res = await fetch(`http://127.0.0.1:${port}/save?name=${encodeURIComponent(name)}`, { method: 'POST' })
console.log(res.ok ? `queued: ${await res.text()} (saved on the bot's next step)` : `server said ${res.status}`)
