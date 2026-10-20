// Isolated ruler-sweep reproduction against the live app (CDP 9222).
//   node scripts/probe-ruler2.mjs
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
await sleep(500)
await evalJs(ws, `__wc.App.openNote(${note.id})`, { awaitPromise: true })
await sleep(500)

const geoOf = () => evalJs(ws, `(() => { const i = document.getElementById('stackInner'); const r = i.getBoundingClientRect(); return { left: r.left, top: r.top, zoom: r.width / i.offsetWidth, w: i.offsetWidth, h: i.offsetHeight } })()`)
let geo = await geoOf()

// instrument pointer hits
await evalJs(ws, `(() => { window.__hit = null; document.addEventListener('pointerdown', e => { window.__hit = { target: e.target.id || e.target.className, x: e.clientX, y: e.clientY } }, true); return true })()`)

// ruler on
await evalJs(ws, `document.getElementById('tbRuler').click()`)
await sleep(120)
// pre-scroll axle to center (same formula as qa-5b)
await evalJs(ws, `(() => { const h = document.getElementById('canvasHost'); const i = document.getElementById('stackInner'); const z = i.getBoundingClientRect().width / i.offsetWidth; h.scrollTop = 0.55 * i.offsetHeight * z - h.clientHeight / 2; h.scrollLeft = 0.5 * i.offsetWidth * z - h.clientWidth / 2; return true })()`)
await sleep(150)
geo = await geoOf()
const PY = geo.h * 0.55
console.log('geo', JSON.stringify(geo), 'PY', PY, 'axleScreenY', geo.top + PY * geo.zoom)

const px = d => geo.left + d[0] * geo.zoom
const py = d => geo.top + d[1] * geo.zoom
const sweepPts = [[500, PY - 60], [700, PY + 55], [900, PY - 50], [1100, PY]]
console.log('screen pts', sweepPts.map(p => [Math.round(px(p)), Math.round(py(p))]).map(p => p.join(',')).join(' | '))
const beforeN = await evalJs(ws, `__wc.S.pages[0].strokes.length`)

await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(sweepPts[0]), y: py(sweepPts[0]), button: 'none' })
await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px(sweepPts[0]), y: py(sweepPts[0]), button: 'left', buttons: 1, clickCount: 1 })
for (const p of sweepPts.slice(1)) { await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(p), y: py(p), buttons: 1 }); await sleep(12) }
await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(sweepPts.at(-1)), y: py(sweepPts.at(-1)), button: 'left', buttons: 0, clickCount: 1 })
await sleep(150)

const out = await evalJs(ws, `(() => { const p = __wc.S.pages[0]; const s = p.strokes[p.strokes.length - 1]; return { hit: window.__hit, n: p.strokes.length, last: s ? { pts: s.pts.length, y0: s.pts[0].y, x0: s.pts[0].x } : null, ruler: __wc.S.rulerOn, tool: __wc.S.tool } })()`)
console.log('beforeN', beforeN, 'after', JSON.stringify(out))
await evalJs(ws, `WriteCanvasHost.destroyItem(${note.id})`, { awaitPromise: true })
try { ws.close() } catch { }
process.exit(0)
