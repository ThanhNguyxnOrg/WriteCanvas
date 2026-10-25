// QA for step 5b tools over real CDP input (no deps; app must run with
// --remote-debugging-port=9222). Covers: laser fade, ruler (snap/rotate/grip),
// eraser modes (stroke / segment S M L / sheet + undo), lasso
// selection (circle -> move/duplicate/delete), view pan, pull-below-last-page
// add page (short bounce + armed commit), tool shortcuts, and the save ->
// hard-reload ink persistence via the sVec vector chunk.
//   node scripts/qa-5b.mjs
import { setTimeout as sleep } from 'node:timers/promises'

const CDP = 'http://127.0.0.1:9222'
let wsSeq = 1
const pending = new Map()
const failures = []
const pass = name => console.log('PASS', name)
const fail = (name, info) => { failures.push(`${name}: ${info}`); console.log('FAIL', name, ':', info) }
const ok = (name, cond, info = 'expected true') => cond ? pass(name) : fail(name, info)
// loose geometry tolerance grows with zoom: screen px | doc px mix
const near = (a, b, tol) => Math.abs(a - b) <= tol

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', reject)
  })
}

function send(ws, method, params = {}, sessionId) {
  const id = wsSeq++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
  })
}

async function evalJs(ws, expr, { awaitPromise = false } = {}) {
  const res = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text + ': ' + (res.exceptionDetails.exception?.description || ''))
  return res.result?.value
}

async function sweep(ws, pts, geo, { upDelay = 60 } = {}) {
  const px = d => geo.left + d[0] * geo.zoom
  const py = d => geo.top + d[1] * geo.zoom
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(pts[0]), y: py(pts[0]), button: 'none' })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px(pts[0]), y: py(pts[0]), button: 'left', buttons: 1, clickCount: 1 })
  for (const p of pts.slice(1)) {
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(p), y: py(p), buttons: 1 })
    await sleep(10)
  }
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(pts.at(-1)), y: py(pts.at(-1)), button: 'left', buttons: 0, clickCount: 1 })
  await sleep(upDelay)
}

async function clickDoc(ws, xDoc, yDoc, geo) {
  const x = geo.left + xDoc * geo.zoom, y = geo.top + yDoc * geo.zoom
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(25)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(120)
}

async function key(ws, keyName) {
  await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: '${keyName}', bubbles: true }))`)
  await sleep(60)
}

async function click(ws, sel) {
  const got = await evalJs(ws, `(() => { const el = ${sel}; if (!el) return false; el.click(); return true })()`)
  if (!got) throw new Error('click target missing: ' + sel)
  await sleep(60)
}

// Activate the pen without leaving its settings flyout over the drawing area.
async function selectPen(ws) {
  await click(ws, `document.getElementById('tbPenCurrent')`)
  if (!(await evalJs(ws, `document.getElementById('penFlyout').classList.contains('hidden')`))) {
    await click(ws, `document.getElementById('penDone')`)
  }
}

// pixel-sample a canvas: share of sampled pixels with alpha > 10
const inkShare = (sel) => `(() => {
  const c = ${sel}; if (!c || !c.width) return 0
  const ctx = c.getContext('2d')
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  let hit = 0, total = 0
  for (let i = 0; i < d.length; i += 4 * 997) { total++; if (d[i + 3] > 10) hit++ }
  return total ? hit / total : 0
})()`

async function main() {
  const list = await (await fetch(`${CDP}/json`)).json()
  const page = list.find(t => t.type === 'page' && /index\.html|WriteCanvas/i.test(t.title + t.url))
  if (!page) throw new Error('app page not found — run app with --remote-debugging-port=9222')
  const ws = await connect(page.webSocketDebuggerUrl)
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
  await send(ws, 'Runtime.enable')
  // the renderer boots asynchronously __wc is not defined after a fresh app start; poll
  for (let i = 0; i < 50; i++) {
    try { if (await evalJs(ws, `!!window.__wc`)) break } catch { }
    await sleep(300)
    try { await send(ws, 'Runtime.enable') } catch { }
  }
  if (!(await evalJs(ws, `!!window.__wc`))) throw new Error('app renderer did not expose __wc — is WriteCanvas running?')
  const openId = await evalJs(ws, `__wc.S.noteId`)

  // ---------- setup: a clean QA note ----------
  const note = await evalJs(ws, `WriteCanvasHost.createNote('QA5b', 1)`, { awaitPromise: true })
  await sleep(600)
  await evalJs(ws, `__wc.App.openNote(${note?.id})`, { awaitPromise: true })
  await sleep(400)
  let geo = await evalJs(ws, `(() => {
    const inner = document.getElementById('stackInner')
    const r = inner.getBoundingClientRect()
    return { left: r.left, top: r.top, zoom: r.width / inner.offsetWidth, w: inner.offsetWidth, h: inner.offsetHeight }
  })()`)
  ok('setup: note opened', !!geo && geo.w > 1000 && geo.zoom > 0.2, JSON.stringify(geo))
  // qa-5b must be runnable repeatedly inside one app process: reset the
  // session state earlier sections assume (pen tool, ruler off/straight)
  await selectPen(ws)
  await evalJs(ws, `__wc.S.rulerOn = false; __wc.ruler && (__wc.ruler.angle = 0); __wc.S.eraserMode = 'stroke'; __wc.S.selectMode = 'lasso'`)
  const strokesOf = () => evalJs(ws, `__wc.S.pages[0].strokes.length`)

  // ---------- 1. pen draws ----------
  await sweep(ws, [[600, 800], [900, 840], [1300, 800], [1600, 860]], geo)
  ok('pen: stroke committed', await strokesOf() === 1, 'strokes=' + await strokesOf())

  // ---------- 2. laser pointer fades, never commits ----------
  await click(ws, `document.getElementById('tbLaser')`)
  ok('laser: tool active', await evalJs(ws, `__wc.S.tool`) === 'laser')
  const before = await strokesOf()
  await sweep(ws, [[500, 400], [800, 500], [1200, 420], [1500, 560]], geo, { upDelay: 40 })
  await sleep(120)
  const paint1 = await evalJs(ws, inkShare(`document.getElementById('laserC')`))
  ok('laser: trail painted', paint1 > 0.001, 'share=' + paint1)
  ok('laser: nothing committed', await strokesOf() === before)
  await sleep(1800)
  const paint2 = await evalJs(ws, inkShare(`document.getElementById('laserC')`))
  ok('laser: trail faded after 1.8s', paint2 === 0, 'share=' + paint2)
  await selectPen(ws)

  // ---------- 3. ruler: snap, rotate, grip drag ----------
  // rulers keep their transform for the whole session: make this section
  // deterministic even when the script runs twice in one process
  await evalJs(ws, `__wc.ruler ? (__wc.ruler.angle = 0) : null; __wc.S.rulerOn = false`)
  await click(ws, `document.getElementById('tbRuler')`)
  ok('ruler: on', await evalJs(ws, `__wc.S.rulerOn`) === true)
  ok('ruler: layer painted', await evalJs(ws, inkShare(`document.getElementById('rulerC')`)) > 0.0005)
  ok('ruler: rotate ctl exists', await evalJs(ws, `!!document.getElementById('rulerCtl')`))
  // The app now brings the stencil into the viewport when it is toggled on,
  // so the default 0.55 position is no longer necessarily where the grip is.
  geo = await evalJs(ws, `(() => {
    const inner = document.getElementById('stackInner')
    const r = inner.getBoundingClientRect()
    return { left: r.left, top: r.top, zoom: r.width / inner.offsetWidth, w: inner.offsetWidth, h: inner.offsetHeight }
  })()`)
  // Read the actual stencil position instead of assuming the factory 0.55.
  const rulerInfo = await evalJs(ws, `(() => {
    const c = document.getElementById('rulerCtl')
    return { px: parseFloat(c.dataset.px), py: parseFloat(c.dataset.py), angle: parseFloat(c.dataset.angle) || 0 }
  })()`)
  const PY = rulerInfo.py
  ok('ruler: axle on screen', geo.top + PY * geo.zoom > 240 && geo.top + PY * geo.zoom < 980, 'screenY=' + (geo.top + PY * geo.zoom))
  await sweep(ws, [
    [500, PY - 60], [700, PY + 55], [900, PY - 50], [1100, PY + 60],
    [1300, PY - 45], [1500, PY + 55], [1700, PY - 40],
  ], geo)
  let stats = await evalJs(ws, `(() => {
    const s = __wc.S.pages[0].strokes[__wc.S.pages[0].strokes.length - 1]
    const bas = s.pts[0].y
    return { n: s.pts.length, maxDev: Math.max(...s.pts.map(p => Math.abs(p.y - bas))), y0: bas }
  })()`)
  ok('ruler: ink snapped flat', stats.maxDev < 4 && near(stats.y0, PY, 12), JSON.stringify(stats))
  const strokesAfterFlat = await strokesOf()
  await click(ws, `document.getElementById('rulCW')`)
  await click(ws, `document.getElementById('rulCW')`)
  await sweep(ws, [[600, PY - 40], [900, PY + 60], [1200, PY - 50], [1500, PY + 60]], geo)
  stats = await evalJs(ws, `(() => {
    const s = __wc.S.pages[0].strokes[__wc.S.pages[0].strokes.length - 1]
    const p0 = s.pts[0], p1 = s.pts[s.pts.length - 1]
    const slope = (p1.y - p0.y) / ((p1.x - p0.x) || 1)
    const dev = Math.max(...s.pts.map(p => Math.abs((p.y - p0.y) - slope * (p.x - p0.x))))
    return { slope, dev, n: s.pts.length }
  })()`)
  ok('ruler: +20 deg rotation slopes ink', near(stats.slope, Math.tan((rulerInfo.angle + 20) * Math.PI / 180), 0.03) && stats.dev < 4 && stats.n >= 3, JSON.stringify(stats))
  // grip drag: pointer down exactly on the current grip circle, drag down 120 screen px
  const grip = { x: geo.left + rulerInfo.px * geo.zoom, y: geo.top + rulerInfo.py * geo.zoom }
  const ctlBefore = await evalJs(ws, `parseFloat(document.getElementById('rulerCtl').style.top)`)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: grip.x, y: grip.y, button: 'none' })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: grip.x, y: grip.y, button: 'left', buttons: 1, clickCount: 1 })
  for (let i = 1; i <= 6; i++) {
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: grip.x + i * 10, y: grip.y + i * 20, buttons: 1 })
    await sleep(20)
  }
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: grip.x + 60, y: grip.y + 120, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(150)
  const ctlAfter = await evalJs(ws, `parseFloat(document.getElementById('rulerCtl').style.top)`)
  ok('ruler: grip drag moves stencil', ctlAfter - ctlBefore > 40, `ctl top ${ctlBefore} -> ${ctlAfter}`)
  ok('ruler: drag drew nothing', await strokesOf() === strokesAfterFlat + 1, 'strokes=' + await strokesOf())
  // restore scroll to top for the following blocks (their coords assume page top)
  await evalJs(ws, `(() => { const host = document.getElementById('canvasHost'); host.scrollTop = 0; host.scrollLeft = 0; return true })()`)
  await sleep(80)
  geo = await evalJs(ws, `(() => {
    const inner = document.getElementById('stackInner')
    const r = inner.getBoundingClientRect()
    return { left: r.left, top: r.top, zoom: r.width / inner.offsetWidth, w: inner.offsetWidth, h: inner.offsetHeight }
  })()`)
  await click(ws, `document.getElementById('tbRuler')`)
  ok('ruler: off clears layer', await evalJs(ws, inkShare(`document.getElementById('rulerC')`)) === 0)

  // ---------- 4. eraser modes ----------
  await selectPen(ws)
  // one clean horizontal line through (800..1800, 1100)
  await sweep(ws, [[800, 1100], [1000, 1100], [1300, 1100], [1600, 1100], [1800, 1100]], geo)
  const strokesNow = await strokesOf() // expected 5 (4 ruler strokes + 1 line)
  await click(ws, `document.getElementById('tbEraser')`)
  ok('eraser: tool active', await evalJs(ws, `__wc.S.tool`) === 'erase')
  ok('eraser: stroke mode default', await evalJs(ws, `__wc.S.eraserMode`) === 'stroke')
  // open the flyout through the caret hot-zone
  await evalJs(ws, `document.querySelector('#topbar .tb-modebtn[data-fly="eraserFlyout"]').click()`)
  await sleep(80)
  ok('eraser: flyout opens', await evalJs(ws, `!document.getElementById('eraserFlyout').classList.contains('hidden')`))
  ok('eraser: size row hidden for stroke', await evalJs(ws, `document.getElementById('erSizeRow').classList.contains('hidden')`))
  await click(ws, `document.getElementById('erSegment')`)
  ok('eraser: segment row shows chips', await evalJs(ws, `!document.getElementById('erSizeRow').classList.contains('hidden')`))
  await click(ws, `document.getElementById('erSizes').children[1]`) // M chip
  ok('eraser: M = 5mm state', await evalJs(ws, `__wc.S.eraserMM`) === 5)
  async function eraseAtScreen(xDoc, zOff) {
    const x = geo.left + xDoc * geo.zoom, y = geo.top + 1100 * geo.zoom + (zOff || 0)
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 4; i++) {
      await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y + i * 6, buttons: 1 })
      await sleep(14)
    }
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y - 6, buttons: 1 })
    await sleep(14)
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: y - 6, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(90)
  }

  // segment eraser cuts the middle of the line -> split entry
  const half1 = await strokesOf()
  await eraseAtScreen(1300)
  let afterSeg = await strokesOf()
  let undoTop = await evalJs(ws, `__wc.S.pages[0].undo.at(-1).t`)
  ok('eraser: segment splits stroke', afterSeg === half1 + 1 && undoTop === 'erase-split', `before=${half1} after=${afterSeg} undo=${undoTop}`)
  // ctrl+z back via dispatched KeyboardEvent with ctrlKey
  await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`)
  await sleep(60)
  ok('eraser: undo restores original stroke', await strokesOf() === half1, 'strokes=' + await strokesOf())
  // redo of a split must put both surviving fragments back (old bug: it only
  // removed the original and left the page without either fragment)
  await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }))`)
  await sleep(60)
  ok('eraser: redo splits again', await strokesOf() === afterSeg, 'strokes=' + await strokesOf())
  await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`)
  await sleep(60)
  // stroke eraser removes a whole piece
  await click(ws, `document.getElementById('erStroke')`)
  await eraseAtScreen(1300)
  ok('eraser: stroke mode removes whole', await strokesOf() === half1 - 1, 'strokes=' + await strokesOf())
  await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`)
  await sleep(60)
  // sheet eraser wipes page, undo brings it back
  await click(ws, `document.getElementById('erSheet')`)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: geo.left + 900 * geo.zoom, y: geo.top + 400 * geo.zoom, button: 'left', buttons: 1, clickCount: 1 })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: geo.left + 900 * geo.zoom, y: geo.top + 400 * geo.zoom, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(150)
  ok('eraser: sheet wipes page', await strokesOf() === 0)
  await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`)
  await sleep(60)
  ok('eraser: undo restores sheet wipe', await strokesOf() === half1, 'strokes=' + await strokesOf())
  await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

  // ---------- 5. lasso selection ----------
  // reset page state directly so lasso starts deterministic (eraser block covered wipe already)
  await evalJs(ws, `(() => { const p = __wc.S.pages[0]; p.strokes.length = 0; p.undo.length = 0; p.redo.length = 0; return true })()`)
  await selectPen(ws)
  await evalJs(ws, `document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 99, clientX: 5, clientY: 5, pointerType: 'mouse', button: 0 }))`)
  await sweep(ws, [[600, 700], [900, 740], [1200, 700], [1450, 760]], geo)
  await sweep(ws, [[600, 1300], [900, 1330], [1300, 1310], [1500, 1340]], geo)
  ok('lasso: two fresh strokes', await strokesOf() === 2)
  await click(ws, `document.getElementById('tbLasso')`)
  ok('lasso: tool active', await evalJs(ws, `__wc.S.tool`) === 'lasso')
  // circle stroke A only
  const circ = []
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI * 2
    circ.push([1025 + Math.cos(a) * 520, 730 + Math.sin(a) * 170])
  }
  await sweep(ws, circ, geo)
  const selState = await evalJs(ws, `JSON.stringify({ sel: !!__wc.S.selection, n: __wc.S.selection ? __wc.S.selection.strokes.length : 0, bar: !!document.getElementById('selBar') })`)
  const sel = JSON.parse(selState)
  ok('lasso: selects circled stroke', sel.sel && sel.n === 1, selState)
  ok('lasso: action bar visible', sel.bar)
  // drag inside bbox: +140 screen x, +80 screen y
  const bbox = await evalJs(ws, `JSON.stringify(__wc.S.selection?.bbox)`)
  const bb = JSON.parse(bbox)
  const cx = geo.left + (bb.x + bb.w / 2) * geo.zoom, cy = geo.top + (bb.y + bb.h / 2) * geo.zoom
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none' })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 })
  for (let i = 1; i <= 8; i++) {
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + i * 17.5, y: cy + i * 10, buttons: 1 })
    await sleep(14)
  }
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 140, y: cy + 80, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(130)
  const moved = await evalJs(ws, `JSON.stringify((() => {
    const st = __wc.S.pages[0].strokes.find(s => s.type !== 'shape' && Math.max(...s.pts.map(p => p.x)) < 2200 && Math.max(...s.pts.map(p => p.y)) < 1500)
    const undo = __wc.S.pages[0].undo.at(-1)
    return { dx: st.pts[0].x - Math.min(...st.pts.map(p => p.x)), px0: st.pts[0].x, t: undo.t }
  })())`)
  const mv = JSON.parse(moved)
  const Z = geo.zoom
  ok('lasso: move commits + undo entry', mv.t === 'move' && near(mv.px0, 600 + 140 / Z, 60 / Z + 20), JSON.stringify(mv))
  const stDup = await strokesOf()
  await click(ws, `document.getElementById('selDup')`)
  ok('lasso: duplicate adds stroke', await strokesOf() === stDup + 1, 'strokes=' + await strokesOf())
  await click(ws, `document.getElementById('selDel')`)
  ok('lasso: delete removes strokes', await strokesOf() === stDup, 'strokes=' + await strokesOf())
  ok('lasso: selection cleared after delete', await evalJs(ws, `!__wc.S.selection && !document.getElementById('selBar')`))

  // ---------- 5b. additive Select Click + Eraser Drag options ----------
  // Both are new choices: Lasso and Stroke keep their original click behavior.
  await evalJs(ws, `(() => { const p = __wc.S.pages[0]; p.strokes.length = 0; p.undo.length = 0; p.redo.length = 0; return true })()`)
  await selectPen(ws)
  await sweep(ws, [[600, 700], [900, 740], [1200, 700], [1450, 760]], geo)
  await sweep(ws, [[600, 1300], [900, 1330], [1300, 1310], [1500, 1340]], geo)
  ok('options: two fresh strokes', await strokesOf() === 2)
  const firstPt = JSON.parse(await evalJs(ws, `JSON.stringify(__wc.S.pages[0].strokes[0].pts[Math.floor(__wc.S.pages[0].strokes[0].pts.length / 2)])`))
  const secondPt = JSON.parse(await evalJs(ws, `JSON.stringify(__wc.S.pages[0].strokes[1].pts[Math.floor(__wc.S.pages[0].strokes[1].pts.length / 2)])`))
  await click(ws, `document.getElementById('tbLasso')`)
  await evalJs(ws, `document.querySelector('#topbar .tb-modebtn[data-fly="selectFlyout"]').click()`)
  await sleep(80)
  ok('select: flyout opens', await evalJs(ws, `!document.getElementById('selectFlyout').classList.contains('hidden')`))
  await click(ws, `document.getElementById('selClick')`)
  ok('select: Click option applies', await evalJs(ws, `__wc.S.selectMode`) === 'click')
  await click(ws, `document.getElementById('selectClose')`)
  await clickDoc(ws, firstPt.x, firstPt.y, geo)
  const clickSel = JSON.parse(await evalJs(ws, `JSON.stringify({ sel: !!__wc.S.selection, n: __wc.S.selection ? __wc.S.selection.strokes.length : 0, first: __wc.S.selection ? __wc.S.selection.strokes[0] === __wc.S.pages[0].strokes[0] : false, bar: !!document.getElementById('selBar') })`))
  ok('select: click selects one stroke', clickSel.sel && clickSel.n === 1 && clickSel.first && clickSel.bar, JSON.stringify(clickSel))
  await clickDoc(ws, 300, 250, geo)
  ok('select: click empty clears', await evalJs(ws, `!__wc.S.selection && !document.getElementById('selBar')`))
  const circ2 = []
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI * 2
    circ2.push([secondPt.x + Math.cos(a) * 520, secondPt.y + Math.sin(a) * 150])
  }
  await sweep(ws, circ2, geo)
  ok('select: drag lasso still works in Click mode', await evalJs(ws, `!!__wc.S.selection && __wc.S.selection.strokes.length === 1`))
  await clickDoc(ws, 300, 250, geo)
  await evalJs(ws, `document.querySelector('#topbar .tb-modebtn[data-fly="selectFlyout"]').click()`)
  await sleep(60)
  await click(ws, `document.getElementById('selLasso')`)
  await click(ws, `document.getElementById('selectClose')`)
  await clickDoc(ws, firstPt.x, firstPt.y, geo)
  ok('select: Lasso keeps click-no-op', await evalJs(ws, `!__wc.S.selection`))

  await click(ws, `document.getElementById('tbEraser')`)
  await evalJs(ws, `document.querySelector('#topbar .tb-modebtn[data-fly="eraserFlyout"]').click()`)
  await sleep(80)
  await click(ws, `document.getElementById('erDrag')`)
  ok('eraser: Drag option applies', await evalJs(ws, `__wc.S.eraserMode`) === 'drag')
  await click(ws, `document.getElementById('eraserClose')`)
  await clickDoc(ws, firstPt.x, firstPt.y, geo)
  ok('eraser: Drag click does not erase', await strokesOf() === 2)
  await sweep(ws, [[400, secondPt.y], [secondPt.x - 150, secondPt.y], [secondPt.x + 150, secondPt.y], [secondPt.x + 350, secondPt.y]], geo)
  ok('eraser: Drag sweep erases', await strokesOf() === 1)
  await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`)
  await sleep(60)
  ok('eraser: Drag undo restores', await strokesOf() === 2)
  await evalJs(ws, `document.querySelector('#topbar .tb-modebtn[data-fly="eraserFlyout"]').click()`)
  await sleep(60)
  await click(ws, `document.getElementById('erStroke')`)
  await click(ws, `document.getElementById('eraserClose')`)
  await clickDoc(ws, firstPt.x, firstPt.y, geo)
  ok('eraser: Stroke click still erases', await strokesOf() === 1)
  await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`)
  await sleep(60)
  ok('eraser: Stroke undo restores', await strokesOf() === 2)

  // ---------- 6. view mode pans ----------
  await selectPen(ws)
  await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await click(ws, `document.getElementById('tbEye')`)
  ok('view: tool active', await evalJs(ws, `__wc.S.tool`) === 'view')
  const scroll0 = await evalJs(ws, `JSON.stringify({ l: document.getElementById('canvasHost').scrollLeft, t: document.getElementById('canvasHost').scrollTop })`)
  const s0 = JSON.parse(scroll0)
  await sweep(ws, [[1400, 1400], [1200, 1300]] , geo, { upDelay: 80 })
  const scroll1 = JSON.parse(await evalJs(ws, `JSON.stringify({ l: document.getElementById('canvasHost').scrollLeft, t: document.getElementById('canvasHost').scrollTop })`))
  // doc drag (-200,-100) -> screen drag ~(-101,-51): scrollTop grows by the screen dy
  ok('view: drag pans scroll', Math.abs((scroll1.t - s0.t) - 100 * geo.zoom) < 22, JSON.stringify({ s0, scroll1 }))
  ok('view: no ink drawn', await strokesOf() === 2, 'strokes=' + await strokesOf())

  // ---------- 6.5 pull below the last page adds a page (Samsung-style) ----------
  await evalJs(ws, `(() => { const host = document.getElementById('canvasHost'); host.scrollTop = 1e9; host.scrollLeft = 0; return true })()`)
  await sleep(120)
  const pages0 = await evalJs(ws, `__wc.S.pages.length`)
  const view = JSON.parse(await evalJs(ws, `JSON.stringify({ iH: window.innerHeight, r: document.getElementById('canvasHost').getBoundingClientRect().toJSON() })`))
  const px0 = Math.round(view.r.left + view.r.width / 2)
  const py0 = Math.round(view.iH - 260)
  const press = (x, y) => send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  const move = (x, y) => send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1 })
  const release = (x, y) => send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  const hintState = () => evalJs(ws, `(() => { const b = document.getElementById('pullHint'); return b && !b.classList.contains('hidden') ? b.className : 'hidden' })()`)
  const peekState = id => evalJs(ws, `(() => { const el = document.getElementById('${id}'); return JSON.stringify({ on: el.classList.contains('on'), h: Math.round(el.getBoundingClientRect().height), label: el.querySelector('.peekLabel')?.textContent || '' }) })()`)
  // negative: short pull (drag UP past the end) bounces back, no page
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px0, y: py0, button: 'none' })
  await press(px0, py0)
  for (let i = 1; i <= 3; i++) { await move(px0, py0 - i * 14); await sleep(16) }
  const hintNeg = await hintState()
  await release(px0, py0 - 42)
  await sleep(320)
  ok('pull: short drag adds no page', await evalJs(ws, `__wc.S.pages.length`) === pages0)
  ok('pull: hint visible, not armed', /pullHint/.test(hintNeg) && !/armed/.test(hintNeg), hintNeg)
  ok('pull: short drag bounces pullPx to 0', await evalJs(ws, `__wc.S.pullPx`) === 0)
  // positive: pull well past the threshold -> page N+1
  await press(px0, py0)
  await sleep(50)
  await move(px0, py0 - 60)
  await sleep(30)
  const hintMid = await hintState()
  for (let i = 2; i <= 7; i++) { await move(px0, py0 - i * 60); await sleep(24) }
  const hintEnd = await hintState()
  const peekNew = JSON.parse(await peekState('peekNext'))
  ok('pull: hint shows while pulling', /pullHint/.test(hintMid) && !/armed/.test(hintMid), hintMid)
  ok('pull: armed past threshold', /armed/.test(hintEnd), hintEnd)
  ok('peek: new sheet slides in during pull', peekNew.on && peekNew.h > 8, JSON.stringify(peekNew))
  ok('peek: new sheet is labelled', /new page/i.test(peekNew.label), peekNew.label)
  await release(px0, py0 - 420)
  await sleep(420)
  ok('pull: page added on release', await evalJs(ws, `__wc.S.pages.length`) === pages0 + 1, 'pages=' + await evalJs(ws, `__wc.S.pages.length`))
  ok('pull: new page is current', await evalJs(ws, `__wc.S.currentPage`) === pages0)
  ok('pull: hint hidden after release', await evalJs(ws, `document.getElementById('pullHint').classList.contains('hidden')`))
  ok('peek: hidden after commit', JSON.parse(await peekState('peekNext')).h === 0)
  ok('pull: pullPx reset after commit', await evalJs(ws, `__wc.S.pullPx`) === 0)
  // A two-page note must not dead-end at the bottom of page 1: pulling there
  // reveals page 2 instead of doing nothing (and does not append page 3).
  await evalJs(ws, `document.querySelectorAll('#pagesBar .pageItem')[0].click()`)
  await sleep(180)
  await evalJs(ws, `(() => { const host = document.getElementById('canvasHost'); host.scrollTop = 1e9; host.scrollLeft = 0; return true })()`)
  await sleep(100)
  const pagesBeforeNext = await evalJs(ws, `__wc.S.pages.length`)
  await press(px0, py0)
  await sleep(40)
  for (let i = 1; i <= 7; i++) { await move(px0, py0 - i * 60); await sleep(24) }
  const hintNext = await evalJs(ws, `document.querySelector('#pullHint .pullText')?.textContent || ''`)
  const peekNext = JSON.parse(await peekState('peekNext'))
  await release(px0, py0 - 420)
  await sleep(420)
  ok('pull: page 1 reveals page 2', await evalJs(ws, `__wc.S.currentPage`) === 1, 'current=' + await evalJs(ws, `__wc.S.currentPage`))
  ok('pull: next page does not append', await evalJs(ws, `__wc.S.pages.length`) === pagesBeforeNext, 'pages=' + await evalJs(ws, `__wc.S.pages.length`))
  ok('pull: next-page hint names the next page', /next page/i.test(hintNext), hintNext)
  ok('peek: next sheet names page 2', peekNext.on && /page 2/i.test(peekNext.label), JSON.stringify(peekNext))
  ok('pull: next page starts at top', await evalJs(ws, `document.getElementById('canvasHost').scrollTop`) === 0)
  // Wheel at the bottom of page 1 follows the same rule.
  await evalJs(ws, `document.querySelectorAll('#pagesBar .pageItem')[0].click()`)
  await sleep(180)
  await evalJs(ws, `(() => { const host = document.getElementById('canvasHost'); host.scrollTop = 1e9; host.scrollLeft = 0; return true })()`)
  await sleep(100)
  const wheelPages = await evalJs(ws, `__wc.S.pages.length`)
  const wheelRect = JSON.parse(await evalJs(ws, `(() => { const r = document.getElementById('canvasHost').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }) })()`))
  for (let i = 0; i < 3; i++) {
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: wheelRect.x, y: wheelRect.y, deltaX: 0, deltaY: 160 })
    await sleep(80)
  }
  await sleep(300)
  ok('wheel: page 1 reveals page 2', await evalJs(ws, `__wc.S.currentPage`) === 1, 'current=' + await evalJs(ws, `__wc.S.currentPage`))
  ok('wheel: next page does not append', await evalJs(ws, `__wc.S.pages.length`) === wheelPages, 'pages=' + await evalJs(ws, `__wc.S.pages.length`))
  await evalJs(ws, `(() => { const host = document.getElementById('canvasHost'); host.scrollTop = 0; return true })()`)
  await sleep(80)

  // ---------- 6.6 symmetric boundary: pull/wheel UP reveals the previous page ----------
  // Page 2 is current. Pulling down at its top must settle into the bottom of
  // page 1, not dead-end and not append a page.
  const pagesBeforePrev = await evalJs(ws, `__wc.S.pages.length`)
  const pyTop = Math.round(view.r.top + 220)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px0, y: pyTop, button: 'none' })
  await press(px0, pyTop)
  await sleep(40)
  for (let i = 1; i <= 6; i++) { await move(px0, pyTop + i * 55); await sleep(24) }
  const hintPrev = await evalJs(ws, `document.querySelector('#pullHint .pullText')?.textContent || ''`)
  const hintPrevClass = await hintState()
  const peekPrev = JSON.parse(await peekState('peekPrev'))
  await release(px0, pyTop + 330)
  await sleep(420)
  ok('pull-up: hint names the previous page', /previous page/i.test(hintPrev), hintPrev)
  ok('pull-up: hint anchors to the top edge', /at-top/.test(hintPrevClass), hintPrevClass)
  ok('peek: previous sheet slides in during pull', peekPrev.on && peekPrev.h > 8, JSON.stringify(peekPrev))
  ok('peek: previous sheet names page 1', /page 1/i.test(peekPrev.label), peekPrev.label)
  ok('pull-up: page 2 reveals page 1', await evalJs(ws, `__wc.S.currentPage`) === 0, 'current=' + await evalJs(ws, `__wc.S.currentPage`))
  ok('pull-up: previous page does not append', await evalJs(ws, `__wc.S.pages.length`) === pagesBeforePrev, 'pages=' + await evalJs(ws, `__wc.S.pages.length`))
  ok('pull-up: lands at the bottom of page 1', await evalJs(ws, `document.getElementById('canvasHost').scrollTop`) > 0)
  ok('pull-up: pullPx reset after commit', await evalJs(ws, `__wc.S.pullPx`) === 0)

  // Wheel up at the top of page 2 follows the same rule.
  await evalJs(ws, `document.querySelectorAll('#pagesBar .pageItem')[1].click()`)
  await sleep(180)
  await evalJs(ws, `(() => { const host = document.getElementById('canvasHost'); host.scrollTop = 0; host.scrollLeft = 0; return true })()`)
  await sleep(100)
  const wheelPagesUp = await evalJs(ws, `__wc.S.pages.length`)
  for (let i = 0; i < 3; i++) {
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: wheelRect.x, y: wheelRect.y, deltaX: 0, deltaY: -160 })
    await sleep(80)
  }
  await sleep(300)
  ok('wheel-up: page 2 reveals page 1', await evalJs(ws, `__wc.S.currentPage`) === 0, 'current=' + await evalJs(ws, `__wc.S.currentPage`))
  ok('wheel-up: previous page does not append', await evalJs(ws, `__wc.S.pages.length`) === wheelPagesUp, 'pages=' + await evalJs(ws, `__wc.S.pages.length`))
  ok('wheel-up: lands at the bottom of page 1', await evalJs(ws, `document.getElementById('canvasHost').scrollTop`) > 0)

  // First page: pulling up must not wrap or show a dead hint.
  await evalJs(ws, `(() => { const host = document.getElementById('canvasHost'); host.scrollTop = 0; return true })()`)
  await sleep(80)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px0, y: pyTop, button: 'none' })
  await press(px0, pyTop)
  for (let i = 1; i <= 6; i++) { await move(px0, pyTop + i * 55); await sleep(20) }
  const hintFirst = await hintState()
  const peekFirst = JSON.parse(await peekState('peekPrev'))
  await release(px0, pyTop + 330)
  await sleep(320)
  ok('pull-up: first page does not wrap', await evalJs(ws, `__wc.S.currentPage`) === 0)
  ok('pull-up: first page shows no previous hint', hintFirst === 'hidden', hintFirst)
  ok('peek: first page shows no previous sheet', peekFirst.h === 0, JSON.stringify(peekFirst))
  await evalJs(ws, `(() => { const host = document.getElementById('canvasHost'); host.scrollTop = 0; return true })()`)
  await sleep(80)
  await selectPen(ws)

  // ---------- 7. tool shortcuts ----------
  await key(ws, 'v')
  ok('key V: laser', await evalJs(ws, `__wc.S.tool`) === 'laser')
  await key(ws, 'v')
  ok('key V x2: back to pen', await evalJs(ws, `__wc.S.tool`) === 'pen')
  await key(ws, 'e')
  ok('key E: erase', await evalJs(ws, `__wc.S.tool`) === 'erase')
  await key(ws, 'e')
  ok('key E x2: pen', await evalJs(ws, `__wc.S.tool`) === 'pen')
  await key(ws, 'r')
  ok('key R: ruler on', await evalJs(ws, `__wc.S.rulerOn`) === true)
  await key(ws, 'r')
  ok('key R x2: ruler off', await evalJs(ws, `__wc.S.rulerOn`) === false)
  await key(ws, 'g')
  ok('key G: shapes flyout opens', await evalJs(ws, `!document.getElementById('shapeFlyout').classList.contains('hidden')`))
  await key(ws, 'Escape')
  ok('key Esc: flyout closes', await evalJs(ws, `document.getElementById('shapeFlyout').classList.contains('hidden')`))
  await key(ws, 't')
  ok('key T: text tool', await evalJs(ws, `__wc.S.tool`) === 'text')
  await key(ws, 'v')

  // ---------- 8. persistence: save + hard reload keeps editable strokes ----------
  // reopen the QA note first so the current page is page 0 (openNote always
  // lands on page 0) — the pull block above left page 1 current
  await evalJs(ws, `__wc.App.openNote(${note?.id})`, { awaitPromise: true })
  await sleep(400)
  const beforeN = await strokesOf()
  await evalJs(ws, `__wc.saveCurrentPage()`, { awaitPromise: true })
  await sleep(500)
  await evalJs(ws, `location.reload()`)
  await sleep(1600)
  let backId = null
  for (let i = 0; i < 30 && !backId; i++) {
    await sleep(200)
    try { backId = await evalJs(ws, `window.__wc && __wc.S.noteId`) } catch { backId = null }
  }
  ok('persist: note reopened after reload', backId === note?.id, 'noteId=' + backId)
  const afterN = await evalJs(ws, `__wc.S.pages[0].strokes.length`)
  ok('persist: strokes editable after reopen', afterN === beforeN, `before=${beforeN} after=${afterN}`)
  ok('persist: vector restore used (no raster needed)', await evalJs(ws, `!__wc.S.pages[0].rasterBitmap`))

  // ---------- cleanup: remove only the scratch note created by this run ----------
  // Never sweep by name: the user's own notes may share these prefixes.
  if (openId) {
    await evalJs(ws, `__wc.App.openNote(${openId})`, { awaitPromise: true })
    await sleep(300)
  }
  if (note?.id) {
    await evalJs(ws, `WriteCanvasHost.destroyItem(${note.id})`, { awaitPromise: true })
    await evalJs(ws, `__wc.App.reloadLibrary()`)
    await sleep(150)
  }
  console.log('cleanup: destroyed scratch note', note?.id ?? '(none)', '; reopened note', openId)

  ok('no uncaught JS exceptions during QA', jsErrors.length === 0, jsErrors.slice(0, 4).join(' | '))
  if (jsErrors.length) console.log('JS ERRORS:', jsErrors.join('\n'))
  console.log(failures.length ? `\nQA5b FAILED (${failures.length})` : '\nQA5b ALL PASS')
  try { ws.close() } catch { }
  process.exit(failures.length ? 1 : 0)
}

main().catch(err => {
  console.error('QA CRASHED:', err.message)
  process.exit(1)
})
