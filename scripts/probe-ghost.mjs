// Reproduce the legacy-raster bug without touching any user note.
//
// 1. create a scratch note, draw two strokes, save (writes sVec)
// 2. strip the sVec chunk from its PNG -> the file is now "legacy": ink only
//    in the raster, exactly like a note made by the original app
// 3. reload, reopen (raster fallback), draw one more dot, save, reload, reopen
// 4. report whether the old ink survived
//
// The library root is resolved through WriteCanvasHost.library().root, so the
// script works on any machine. Run: node scripts/probe-ghost.mjs
import { setTimeout as sleep } from 'node:timers/promises'
import fs from 'node:fs'
import path from 'node:path'

let wsSeq = 1
const pending = new Map()
const connect = wsUrl => new Promise((res, rej) => { const w = new WebSocket(wsUrl); w.addEventListener('open', () => res(w)); w.addEventListener('error', rej) })
const send = (ws, method, params = {}) => { const id = wsSeq++; return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) }) }
const evalJs = async (ws, expr, opts = {}) => {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!opts.awaitPromise })
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)
  return r.result?.value
}
async function connectPage() {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find(t => t.type === 'page' && /index\.html|WriteCanvas/i.test(t.title + t.url))
  const ws = await connect(page.webSocketDebuggerUrl)
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result) }
  })
  return ws
}
const state = (ws, expr) => evalJs(ws, expr)
const snapshot = ws => state(ws, `(() => { const p = __wc.S.pages[__wc.S.currentPage]; return { strokes: p.strokes.length, texts: (p.texts || []).length, raster: !!p.rasterBitmap, note: __wc.S.noteId, file: p.file } })()`)

function stripChunk(file, type) {
  const b = fs.readFileSync(file)
  const out = [b.subarray(0, 8)]
  let off = 8
  while (off + 12 <= b.length) {
    const len = b.readUInt32BE(off)
    const t = b.toString('latin1', off + 4, off + 8)
    const end = off + 12 + len
    if (t !== type) out.push(b.subarray(off, end))
    off = end
    if (t === 'IEND') break
  }
  fs.writeFileSync(file, Buffer.concat(out))
}

async function sweep(ws, geo, x0, y0, x1, y1, steps = 8) {
  const px = v => Math.round(geo.left + v * geo.zoom)
  const py = v => Math.round(geo.top + v * geo.zoom)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(x0), y: py(y0), button: 'none' })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px(x0), y: py(y0), button: 'left', buttons: 1, clickCount: 1 })
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(x0 + (x1 - x0) * t), y: py(y0 + (y1 - y0) * t), buttons: 1 })
    await sleep(14)
  }
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(x1), y: py(y1), button: 'left', buttons: 0, clickCount: 1 })
  await sleep(160)
}

let ws = await connectPage()
const lib = await evalJs(ws, `WriteCanvasHost.library()`, { awaitPromise: true })
const scribbleDir = path.join(lib.root, 'Scribble')
console.log('library root:', lib.root)

// clear leftovers from earlier runs
await evalJs(ws, `(async () => { const lib = await WriteCanvasHost.library(); const ids = (lib.items || []).filter(i => i.name === 'ZZGhost').map(i => i.id); for (const id of ids) await WriteCanvasHost.destroyItem(id); return ids })()`, { awaitPromise: true })

const note = await evalJs(ws, `WriteCanvasHost.createNote('ZZGhost', 1)`, { awaitPromise: true })
await evalJs(ws, `__wc.App.openNote(${note.id})`, { awaitPromise: true })
await sleep(500)
await evalJs(ws, `(() => { const h = document.getElementById('canvasHost'); h.scrollTop = 0; h.scrollLeft = 0; return true })()`)
await sleep(100)
const geo = await state(ws, `(() => { const i = document.getElementById('stackInner'); const r = i.getBoundingClientRect(); return { left: r.left, top: r.top, zoom: r.width / i.offsetWidth } })()`)

await sweep(ws, geo, 700, 600, 1200, 750)
await sweep(ws, geo, 700, 900, 1200, 1050)
await evalJs(ws, `__wc.saveCurrentPage()`, { awaitPromise: true })
await sleep(400)
let snap = await snapshot(ws)
console.log('fresh note after save:', snap)
if (!snap.file) { console.log('NO FILE — abort'); process.exit(1) }

const file = path.isAbsolute(snap.file) ? snap.file : path.join(scribbleDir, snap.file)
stripChunk(file, 'sVec')
console.log('stripped sVec -> legacy file, size', fs.statSync(file).size)

await evalJs(ws, `location.reload()`).catch(() => { })
await sleep(3500)
ws = await connectPage()
await evalJs(ws, `__wc.App.openNote(${note.id})`, { awaitPromise: true })
await sleep(2000)
console.log('reopened legacy (expect raster=true, strokes=0):', await snapshot(ws))

// one more dot on top of the legacy raster
const px = Math.round(geo.left + 900 * geo.zoom)
const py = Math.round(geo.top + 1200 * geo.zoom)
await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py, button: 'none' })
await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', buttons: 1, clickCount: 1 })
await sleep(60)
await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', buttons: 0, clickCount: 1 })
await sleep(300)
console.log('after new dot (expect strokes=1, raster=true):', await snapshot(ws))
await sleep(2200)
await evalJs(ws, `__wc.saveCurrentPage()`, { awaitPromise: true })
await sleep(400)
console.log('after save (expect raster=true, file small):', await snapshot(ws), 'disk', fs.statSync(file).size)

await evalJs(ws, `location.reload()`).catch(() => { })
await sleep(3500)
ws = await connectPage()
await evalJs(ws, `__wc.App.openNote(${note.id})`, { awaitPromise: true })
await sleep(2000)
const final = await snapshot(ws)
console.log('reopened after save (BUG if raster=false, strokes=1):', final)

try { await evalJs(ws, `WriteCanvasHost.destroyItem(${note.id})`, { awaitPromise: true }) } catch { }
try { ws.close() } catch { }
process.exit(final.raster ? 0 : 2)
