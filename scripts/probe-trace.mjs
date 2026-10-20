// Tracer: attach capture listeners on stack + track real-input pointer hits.
import { setTimeout as sleep } from 'node:timers/promises'

const CDP = 'http://127.0.0.1:9222'
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

async function evalJs(ws, expr) {
  const res = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true })
  if (res.exceptionDetails) throw new Error((res.exceptionDetails.exception?.description) || res.exceptionDetails.text)
  return res.result?.value
}

const list = await (await fetch(`${CDP}/json`)).json()
const page = list.find(t => t.type === 'page' && /index\.html|WriteCanvas/i.test(t.title + t.url))
const ws = await connect(page.webSocketDebuggerUrl)
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
  }
})

await evalJs(ws, `(() => {
  window.__trace = []
  for (const id of ['canvasHost', 'canvasStack', 'stackInner', 'inkC', 'paperC']) {
    const el = document.getElementById(id)
    if (!el) { window.__traceNote = 'missing:' + id; continue }
    el.addEventListener('pointerdown', e => window.__trace.push(['down', id, e.isTrusted, Math.round(e.clientX), Math.round(e.clientY)]), true)
    el.addEventListener('pointermove', e => { if (window.__trace.length < 40) window.__trace.push(['move', id]) }, true)
  }
  document.addEventListener('pointerdown', e => window.__trace.push(['doc-down', e.target.id || e.target.tagName]), true)
})()`)

const geo = JSON.parse(await evalJs(ws, `JSON.stringify({ left: document.getElementById('stackInner').getBoundingClientRect().left, top: document.getElementById('stackInner').getBoundingClientRect().top, zoom: document.getElementById('stackInner').getBoundingClientRect().width / document.getElementById('stackInner').offsetWidth })`))
console.log('geo:', JSON.stringify(geo))
const px = d => geo.left + d * geo.zoom
const py = d => geo.top + d * geo.zoom
console.log('dispatching at screen', px(500), py(1500))
await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(500), y: py(1500), button: 'none' })
await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px(500), y: py(1500), button: 'left', buttons: 1, clickCount: 1 })
for (let i = 1; i <= 4; i++) {
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(500 + i * 60), y: py(1500 + i * 10), buttons: 1 })
  await sleep(30)
}
await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(740), y: py(1540), button: 'left', buttons: 0, clickCount: 1 })
await sleep(200)

const trace = await evalJs(ws, `JSON.stringify(window.__trace)`)
console.log('trace:', trace)
console.log('strokes:', await evalJs(ws, `__wc.S.pages[0].strokes.length`))
console.log('tool:', await evalJs(ws, `__wc.S.tool`))
