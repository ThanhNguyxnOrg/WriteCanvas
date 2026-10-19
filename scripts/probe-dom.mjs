// Inspect live DOM metrics inside the running app (toolbar layout debugging)
//   node scripts/probe-dom.mjs "<js expression>"
// Expression runs in the page context via CDP; the returned value prints as JSON.
const expr = process.argv[2] || 'document.title'
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
if (!t) throw new Error('no page target')
const ws = await connect(t.webSocketDebuggerUrl)
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
  }
})
const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
if (r.exceptionDetails) console.error('EXCEPTION:', JSON.stringify(r.exceptionDetails, null, 2))
else console.log(JSON.stringify(r.result?.value, null, 2))
ws.close()
process.exit(0)
