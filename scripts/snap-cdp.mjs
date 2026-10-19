// Capture the WriteCanvas window contents through CDP for visual parity checks.
//   node scripts/snap-cdp.mjs <out.png>

import fs from 'node:fs'

const out = process.argv[2] || 'ui-snap.png'
const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const t = list.find(x => x.type === 'page')
if (!t) throw new Error('no page target — app not running?')
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
const seq = { n: 0, pend: new Map() }
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.id && seq.pend.has(m.id)) { seq.pend.get(m.id)(m); seq.pend.delete(m.id) }
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq.n
  seq.pend.set(id, r => (r.error ? reject(new Error(r.error.message)) : resolve(r.result)))
  ws.send(JSON.stringify({ id, method, params }))
})
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1550, height: 926, deviceScaleFactor: 1, mobile: false })
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log('saved', out, fs.statSync(out).size, 'bytes')
process.exit(0)
