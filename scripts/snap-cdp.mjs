// Capture the WriteCanvas window contents through CDP for visual parity checks.
//   node scripts/snap-cdp.mjs <out.png> [clickTargetId]
import fs from 'node:fs'

const out = process.argv[2] || 'ui-snap.png'
const clickId = process.argv[3]
let wsSeq = 1
const pending = new Map()

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', reject)
  })
}

function send(ws, method, params = {}) {
  const id = wsSeq++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const t = list.find(x => x.type === 'page')
if (!t) throw new Error('no page target — app not running?')
const ws = await connect(t.webSocketDebuggerUrl)
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
  }
})
await send(ws, 'Page.enable')
if (clickId) {
  await send(ws, 'Runtime.evaluate', { expression: `document.getElementById(${JSON.stringify(clickId)}).click()` })
  await new Promise(r => setTimeout(r, 300))
}
const shot = await send(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: false })
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log('saved', out, fs.statSync(out).size, 'bytes')
ws.close()
process.exit(0)
