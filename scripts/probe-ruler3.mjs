// Deep-probe ruler pointer path: counts listener hits + captures errors.
//   node scripts/probe-ruler3.mjs
import { setTimeout as sleep } from 'node:timers/promises'

let wsSeq = 1
const pending = new Map()
const connect = wsUrl => new Promise((res, rej) => { const w = new WebSocket(wsUrl); w.addEventListener('open', () => res(w)); w.addEventListener('error', rej) })
const send = (ws, method, params = {}) => { const id = wsSeq++; return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) }) }
const evalJs = async (ws, expr, opts = {}) => {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!opts.awaitPromise })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result?.value
}

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find(t => t.type === 'page' && /index\.html|WriteCanvas/i.test(t.title + t.url))
const ws = await connect(page.webSocketDebuggerUrl)
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result) } })

const note = await evalJs(ws, `WriteCanvasHost.createNote('ZZQAProbe', 1)`, { awaitPromise: true })
await sleep(400)
await evalJs(ws, `__wc.App.openNote(${note.id})`, { awaitPromise: true })
await sleep(400)

await evalJs(ws, `(() => {
  window.__t = { down: 0, move: 0, up: 0, errs: [], hits: [] }
  const inner = document.getElementById('stackInner')
  inner.addEventListener('pointerdown', e => { window.__t.down++; window.__t.hits.push((e.target.id || '?') + '@' + Math.round(e.clientX) + ',' + Math.round(e.clientY)) }, true)
  inner.addEventListener('pointermove', () => { window.__t.move++ }, true)
  inner.addEventListener('pointerup', () => { window.__t.up++ }, true)
  window.addEventListener('error', e => window.__t.errs.push(String(e.message)))
  window.addEventListener('unhandledrejection', e => window.__t.errs.push('rej:' + String(e.reason)))
  return true
})()`)

// ruler ON via toolbar (real click)
await evalJs(ws, `document.getElementById('tbRuler').click()`)
await sleep(100)
await evalJs(ws, `(() => { const h = document.getElementById('canvasHost'); h.scrollTop = 0; h.scrollLeft = 0; return true })()`)
await sleep(100)

const geo = await evalJs(ws, `(() => { const i = document.getElementById('stackInner'); const r = i.getBoundingClientRect(); return { left: r.left, top: r.top, zoom: r.width / i.offsetWidth } })()`)
const X = Math.round(geo.left + 800 * geo.zoom)
const Y = Math.round(geo.top + 800 * geo.zoom) // visible doc area
console.log('press at', X, Y)

await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: X, y: Y, button: 'none' })
await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: X, y: Y, button: 'left', buttons: 1, clickCount: 1 })
for (let i = 1; i <= 4; i++) { await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: X + i * 30, y: Y + (i % 2 ? 20 : -20), buttons: 1 }); await sleep(12) }
await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: X + 120, y: Y, button: 'left', buttons: 0, clickCount: 1 })
await sleep(140)

const out = await evalJs(ws, `(() => { const p = __wc.S.pages[0]; return { t: window.__t, n: p.strokes.length, last: p.strokes.length ? p.strokes[p.strokes.length - 1].pts.length : 0, tool: __wc.S.tool, ruler: __wc.S.rulerOn } })()`)
console.log(JSON.stringify(out, null, 1))
await evalJs(ws, `WriteCanvasHost.destroyItem(${note.id})`, { awaitPromise: true })
try { ws.close() } catch { }
process.exit(0)
