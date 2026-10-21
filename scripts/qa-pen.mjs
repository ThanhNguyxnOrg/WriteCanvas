// Pen rendering QA over real CDP pointer input (app must be running with
// --remote-debugging-port=9222). Covers the two regressions found on the ink
// sample: translucent pens painting a grey ghost of the previous stroke, and
// calligraphy stamping only at raw pointer samples (gaps between points).
//   node scripts/qa-pen.mjs
import { setTimeout as sleep } from 'node:timers/promises'

const CDP = 'http://127.0.0.1:9222'
let seq = 1
const pending = new Map()
const failures = []
const pass = name => console.log('PASS', name)
const fail = (name, info) => { failures.push(`${name}: ${info}`); console.log('FAIL', name, ':', info) }
const ok = (name, cond, info = 'expected true') => cond ? pass(name) : fail(name, info)

const list = await (await fetch(`${CDP}/json`)).json()
const target = list.find(t => t.type === 'page' && /index\.html|WriteCanvas/i.test(t.title + t.url))
if (!target) throw new Error('app page not found — run app with --remote-debugging-port=9222')

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})
const jsErrors = []
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data)
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params && msg.params.exceptionDetails
    jsErrors.push((d && (d.exception?.description || d.text)) || 'unknown exception')
  }
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
  }
})

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = seq++
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
const evalJs = async (expr, { awaitPromise = false } = {}) => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text + ': ' + (res.exceptionDetails.exception?.description || ''))
  return res.result?.value
}
const click = async sel => {
  const got = await evalJs(`(() => { const el = ${sel}; if (!el) return false; el.click(); return true })()`)
  if (!got) throw new Error('click target missing: ' + sel)
  await sleep(70)
}

await send('Runtime.enable')
const originalId = await evalJs(`__wc.S.noteId`)
let note
let geo

const P = (x, y) => [geo.left + x * geo.zoom, geo.top + y * geo.zoom]
const mouse = (type, [x, y], extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...extra })
const sweep = async (pts, { hold = false } = {}) => {
  await mouse('mouseMoved', P(...pts[0]), { button: 'none' })
  await mouse('mousePressed', P(...pts[0]), { button: 'left', buttons: 1, clickCount: 1 })
  for (const p of pts.slice(1)) {
    await mouse('mouseMoved', P(...p), { buttons: 1 })
    await sleep(12)
  }
  if (!hold) {
    await mouse('mouseReleased', P(...pts.at(-1)), { button: 'left', buttons: 0, clickCount: 1 })
    await sleep(120)
  }
}
const setPen = (type, widthMM, color = '#000000') => evalJs(`(() => {
  const p = __wc.S.penSlots[__wc.S.penIndex]
  p.type = ${JSON.stringify(type)}
  p.widthMM = ${widthMM}
  p.color = ${JSON.stringify(color)}
  return p
})()`)
const alphaAt = (sel, x, y) => evalJs(`(() => {
  const c = document.getElementById(${JSON.stringify(sel)})
  return c.getContext('2d').getImageData(${x}, ${y}, 1, 1).data[3]
})()`)
const strokes = () => evalJs(`__wc.S.pages[__wc.S.currentPage].strokes.map(s => ({ type: s.type, width: s.width, color: s.color, pts: s.pts.length }))`)

try {
  note = await evalJs(`WriteCanvasHost.createNote('PenQA', 1)`, { awaitPromise: true })
  await sleep(500)
  await evalJs(`__wc.App.openNote(${note.id})`, { awaitPromise: true })
  await sleep(500)
  await evalJs(`(() => { const h = document.getElementById('canvasHost'); h.scrollTop = 0; h.scrollLeft = 0 })()`)
  geo = await evalJs(`(() => {
    const inner = document.getElementById('stackInner')
    const r = inner.getBoundingClientRect()
    return { left: r.left, top: r.top, zoom: r.width / inner.offsetWidth }
  })()`)
  ok('setup: scratch note open', !!geo && geo.zoom > 0.2, JSON.stringify(geo))

  // 1. opaque marker, then begin a highlighter elsewhere. The previous marker
  // must not be present on the live scratch layer under the highlighter.
  await setPen('marker', 4)
  await sweep([[150, 350], [500, 350], [850, 350], [1150, 350]])
  await setPen('highlighter', 3, '#FFE600')
  await sweep([[200, 650], [1000, 650]], { hold: true })
  const ghost = await alphaAt('liveC', 650, 350)
  const liveInk = await alphaAt('liveC', 600, 650)
  await mouse('mouseReleased', P(1000, 650), { button: 'left', buttons: 0, clickCount: 1 })
  await sleep(150)
  ok('ghost: previous stroke absent from live layer', ghost === 0, 'alpha=' + ghost)
  ok('highlighter: live stroke painted', liveInk > 0, 'alpha=' + liveInk)

  // 2. two-point calligraphy stroke. Raw pointer samples are 1500 doc px apart;
  // only interpolated nib stamps can cover the middle of the stroke.
  await setPen('calligraphy', 3)
  await sweep([[200, 900], [1700, 900]])
  const midInk = await alphaAt('inkC', 950, 900)
  ok('calligraphy: nib swept between sparse points', midInk > 0, 'alpha=' + midInk)
  const drawn = await strokes()
  ok('commit: marker + highlighter + calligraphy', drawn.length === 3 &&
    drawn[0].type === 'marker' && drawn[1].type === 'highlighter' && drawn[2].type === 'calligraphy', JSON.stringify(drawn))
  ok('highlighter: keeps its opacity/width', drawn[1]?.color === '#FFE600' && drawn[1]?.width > 0)

  // 3. save -> switch away -> reopen: flattened and vector paths must survive.
  const saved = await evalJs(`__wc.saveCurrentPage()`, { awaitPromise: true })
  ok('save: page persisted', saved === true || saved?.file !== undefined, JSON.stringify(saved))
  if (originalId) {
    await evalJs(`__wc.App.openNote(${originalId})`, { awaitPromise: true })
    await sleep(350)
  }
  await evalJs(`__wc.App.openNote(${note.id})`, { awaitPromise: true })
  await sleep(500)
  const reopened = await strokes()
  ok('reload: all strokes restored', reopened.length === 3 && reopened[2].type === 'calligraphy', JSON.stringify(reopened))
  ok('reload: calligraphy still renders', await alphaAt('inkC', 950, 900) > 0)
  ok('runtime: no JS exceptions', jsErrors.length === 0, jsErrors.join(' | '))
} finally {
  try {
    if (note?.id) {
      if (originalId) await evalJs(`__wc.App.openNote(${originalId})`, { awaitPromise: true })
      await sleep(300)
      await evalJs(`WriteCanvasHost.destroyItem(${note.id})`, { awaitPromise: true })
      await evalJs(`__wc.App.reloadLibrary()`)
      await sleep(150)
    }
  } catch (err) {
    console.log('cleanup:', err.message)
  }
  ws.close()
}

if (failures.length) {
  console.error(`\nPEN QA FAILED (${failures.length})`)
  for (const f of failures) console.error(' -', f)
  process.exit(1)
}
console.log('\nPEN QA OK')
process.exit(0)
