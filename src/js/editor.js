// Editor: canvas stack, tools, undo/redo, pages, save/export, replay.

import { bridge } from './bridge.js'
import { SIZES, paperDocSize, renderPaper, docMM, hexToCss, templatePathFor, TEMPLATES } from './paper.js'
import { makeStroke, addPoint, drawStrokeAlpha, drawStrokeMask, strokeIntersectsCircle, PEN_TYPES, PEN_TYPE_ORDER, PEN_PALETTE, DEFAULT_PEN_SLOTS } from './pen.js'
import { Recorder, playReplay } from './replay.js'

const $ = id => document.getElementById(id)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

export const S = {
  lib: null,
  noteId: null, note: null,
  pages: [], currentPage: -1,
  tool: 'pen',
  // 10 factory pen slots (original app's pen stack); S.penIndex selects one
  penSlots: DEFAULT_PEN_SLOTS.map(s => ({ ...s })),
  penIndex: 0,
  eraserMM: 5,           // segment eraser factory sizes: S=2, M=5, L=10
  eraserMode: 'stroke',  // stroke eraser vs segment vs sheet (whole-page)
  rulerOn: false,
  selection: null,
  pullPx: 0,             // rubber-band offset (screen px) while pulling below the last page
  textBoxSize: 55,       // S/M/L = 38/55/86 doc px
  zoom: 1,
  spaceDown: false,
  flyoutOpenTool: null,   // id of the toolbar flyout currently open
  writingPane: true,
  editSeq: 0,             // increments on every page mutation; guards dirty-flag clearing
}

// scratch canvas for the live-stroke alpha compositing
const scratch = document.createElement('canvas')
const scratchCtx = scratch.getContext('2d')
const DEFAULT_PAPER = () => ({ size: 'letter', orientation: 'portrait', template: 'ruled', bg: '#FFFFFFFF', borderLines: true })
const newPage = paper => ({ paper: { ...paper }, strokes: [], texts: [], rasterBitmap: null, undo: [], redo: [], dirty: false, recorder: new Recorder(), inkGif: null })
let host = null // App context, set by init()

function layer(id) { return $(id) }
function ctxOf(id) { return $(id).getContext('2d') }

let el = {}

function current() { return S.pages[S.currentPage] || null }
function curPen() { return S.penSlots[S.penIndex] || S.penSlots[0] }
function docSize(page) { return paperDocSize(page.paper.size, page.paper.orientation) }

// sVec comes from a file on disk: accept only the shape we can render, so a
// malformed/partial vector chunk falls back to the raster instead of throwing
// inside the draw loop.
const validStroke = s => s && Array.isArray(s.pts) && s.pts.length > 0 &&
  s.pts.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
const validText = t => t && typeof t.txt === 'string' && t.txt.length > 0 &&
  Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.size)
let openSeq = 0

function disposePages() {
  for (const p of S.pages) {
    if (p.rasterBitmap && typeof p.rasterBitmap.close === 'function') {
      try { p.rasterBitmap.close() } catch { /* already closed */ }
    }
    p.rasterBitmap = null
  }
}

function drawStrokeItem(c, w, h, st) {
  if (st.type === 'shape') drawShapeItem(c, st)
  else drawStrokeAlpha(c, w, h, st)
}

// vector shapes (TextAndShape gallery) live as strokes so erase/undo/save keep
// working; filled variants close the path and fill it, outline ones stroke it
function drawShapeItem(c, st) {
  const pts = st.pts
  if (pts.length < 2) return
  const path = new Path2D()
  path.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y)
  if (st.shape && st.shape.fill) {
    path.closePath()
    c.fillStyle = st.color
    c.fill(path)
  } else {
    c.strokeStyle = st.color
    c.lineWidth = Math.max(2, st.width || 8)
    c.lineCap = 'round'; c.lineJoin = 'round'
    c.stroke(path)
  }
}

// CanvasTextBox objects render into the ink layer each frame (they are baked
// into the saved PNG like the original does, but stay editable in-session)
function drawTextObj(c, t) {
  c.save()
  c.fillStyle = t.color
  c.font = `${t.italic ? 'italic ' : ''}${t.bold ? '600 ' : ''}${t.size}px "Segoe UI", sans-serif`
  c.textBaseline = 'top'
  const lines = String(t.txt).split('\n')
  let y = t.y
  for (const ln of lines) {
    c.fillText(ln, t.x, y)
    if (t.underline) {
      const wpx = c.measureText(ln).width
      c.fillRect(t.x, y + t.size * 1.06, wpx, Math.max(2, t.size * 0.07))
    }
    y += t.size * 1.25
  }
  c.restore()
}

function redrawInk(page) {
  const c = ctxOf('inkC'); const { w, h } = docSize(page)
  c.clearRect(0, 0, w, h)
  for (const st of page.strokes) drawStrokeItem(c, w, h, st)
  if (page.texts) for (const t of page.texts) drawTextObj(c, t)
}

// ---------- flatten (paper + raster + strokes) ----------
function flattenToCanvas(page) {
  const { w, h } = docSize(page)
  const off = document.createElement('canvas')
  off.width = w; off.height = h
  const c = off.getContext('2d')
  renderPaper(c, page.paper)
  if (page.rasterBitmap) { c.save(); c.imageSmoothingEnabled = true; c.drawImage(page.rasterBitmap, 0, 0); c.restore() }
  for (const st of page.strokes) drawStrokeItem(c, w, h, st)
  if (page.texts) for (const t of page.texts) drawTextObj(c, t)
  return off
}

 async function flattenBytes(page, kind = 'image/png') {
  const off = flattenToCanvas(page)
  const blob = await new Promise(r => off.toBlob(r, kind, kind === 'image/jpeg' ? 0.92 : undefined))
  return new Uint8Array(await blob.arrayBuffer())
}

// ---------- transform / zoom ----------
function applyTransform() {
  const page = current(); if (!page) return
  const { w, h } = docSize(page)
  const inner = $('stackInner')
  inner.style.width = w + 'px'; inner.style.height = h + 'px'
  inner.style.transform = `translateY(${-(S.pullPx || 0)}px) scale(${S.zoom})`
  const stack = $('canvasStack')
  stack.style.width = (w * S.zoom) + 'px'
  stack.style.height = (h * S.zoom) + 'px'
  // HUD layers redraw so their counter-scaled chrome tracks the zoom
  if (S.rulerOn) drawRulerLayer(page)
  updateSelectionChrome(page)
}

// ---------- pull-to-add-page (last page only, Samsung-Notes parity) ----------
let bounceRAF = 0

function pullCommitLimit() {
  const host = $('canvasHost')
  return Math.max(96, host.clientHeight * 0.12)
}

function updatePullHint(over) {
  const bar = $('pullHint'); if (!bar) return
  if (!over || over <= 24) { bar.classList.add('hidden'); return }
  const commit = pullCommitLimit()
  bar.classList.remove('hidden')
  const armed = over >= commit
  bar.classList.toggle('armed', armed)
  const fill = bar.querySelector('.pullFill')
  if (fill) fill.style.width = (Math.min(1, over / commit) * 100).toFixed(0) + '%'
  const text = bar.querySelector('.pullText')
  if (text) text.textContent = armed ? 'Thả ra để tạo trang mới' : 'Kéo lên để tạo trang mới'
}

function hidePullHint() {
  const bar = $('pullHint'); if (bar) bar.classList.add('hidden')
}

function pullBounce(from) {
  if (bounceRAF) cancelAnimationFrame(bounceRAF)
  const t0 = performance.now()
  const step = now => {
    const k = Math.min(1, (now - t0) / 150)
    S.pullPx = from * (1 - k) * (1 - k)
    applyTransform()
    if (k < 1) bounceRAF = requestAnimationFrame(step)
    else { S.pullPx = 0; applyTransform(); bounceRAF = 0 }
  }
  bounceRAF = requestAnimationFrame(step)
}

function zoomAt(cx, cy, factor) {
  const host = $('canvasHost')
  const page = current(); if (!page) return
  const rect = $('canvasStack').getBoundingClientRect()
  const px = (cx - rect.left) / S.zoom
  const py = (cy - rect.top) / S.zoom
  const z2 = clamp(S.zoom * factor, 0.08, 8)
  if (z2 === S.zoom) return
  S.zoom = z2
  S.hadZoom = true
  applyTransform()
  const hRect = host.getBoundingClientRect()
  requestAnimationFrame(() => {
    host.scrollLeft = px * z2 - (cx - hRect.left)
    host.scrollTop = py * z2 - (cy - hRect.top)
  })
}

function zoomCenter(dir) {
  const host = $('canvasHost')
  const r = host.getBoundingClientRect()
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, dir > 0 ? 1.2 : 1 / 1.2)
}

function pageCoords(e) {
  const inner = $('stackInner')
  const rect = inner.getBoundingClientRect()
  const scale = rect.width / inner.offsetWidth // = zoom
  return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale }
}

// Fit-width zoom (with a little headroom), matching how the original always
// shows the full page width.
function fitZoom() {
  const page = current(); if (!page) return
  const host = $('canvasHost')
  const avail = host.clientWidth - 48
  S.zoom = clamp(avail / docSize(page).w, 0.08, 8)
  applyTransform()
}

// ---------- page lifecycle ----------
function sizeLayers(page) {
  const { w, h } = docSize(page)
  for (const id of ['paperC', 'rasterC', 'inkC', 'liveC', 'laserC', 'rulerC']) {
    const c = $(id)
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
  }
}

function renderPage(page) {
  sizeLayers(page)
  renderPaper(ctxOf('paperC'), page.paper)
  const rc = ctxOf('rasterC'); rc.clearRect(0, 0, docSize(page).w, docSize(page).h)
  if (page.rasterBitmap) rc.drawImage(page.rasterBitmap, 0, 0)
  redrawInk(page)
  const lc = ctxOf('liveC'); lc.clearRect(0, 0, docSize(page).w, docSize(page).h)
  ctxOf('laserC').clearRect(0, 0, docSize(page).w, docSize(page).h)
  drawRulerLayer(page)
}

export async function openNote(id) {
  // clicking the already-open note must not reload from disk and throw away
  // the in-memory page that is still inside the autosave debounce window
  if (S.noteId === id && S.note) return
  const seq = ++openSeq
  if (S.noteId && S.noteId !== id) {
    const ok = await flushCurrentPage()
    if (!ok) { setSaveState('err'); showHint('Save failed — note not switched'); return }
    if (seq !== openSeq) return
  }
  const res = await bridge.loadNote(id)
  if (seq !== openSeq) return
  if (!res || !res.pages || !res.pages.length) return
  disposePages()
  S.noteId = id
  S.note = { ...res.note }
  S.pages = res.pages.map((p) => {
    const meta = p.paperMeta
    const paper = meta
      ? { size: meta.size, orientation: meta.orientation, template: meta.template, bg: meta.bgColor || '#FFFFFFFF', borderLines: meta.borderLines !== false }
      : (S.note.paper ? { ...S.note.paper } : DEFAULT_PAPER())
    const page = newPage(paper)
    page.file = p.file
    if (p.paperMeta) page.importedChunks = true
    // vector restore: a page saved by us reopens fully editable (strokes +
    // texts); only legacy/imported-only pages fall back to a raster bitmap
    if (p.vecJson) {
      try {
        const v = JSON.parse(p.vecJson)
        if (v && Array.isArray(v.strokes)) {
          page.strokes = v.strokes.filter(validStroke)
          page.texts = Array.isArray(v.texts) ? v.texts.filter(validText) : []
        }
      } catch { /* malformed chunk → raster fallback */ }
    }
    return page
  })
  localStorage.setItem('wc:lastNote', String(id))
  if (host && host.selectNote) host.selectNote(id)
  S.hadZoom = false
  S.zoom = 1
  setPage(0)
  // decode rasters + capture replays (async, per page). Pages that restored
  // their vectors don't need the raster (and would double-ink under strokes).
  for (let i = 0; i < res.pages.length; i++) {
    // another note was opened while we were decoding: never write this note's
    // bitmap into the new note's page array
    if (seq !== openSeq || S.noteId !== id) return
    const p = res.pages[i]
    if (p.inkGif) S.pages[i].inkGif = p.inkGif
    if (!p.exists || !p.bytes) continue
    if (S.pages[i].strokes.length || S.pages[i].texts.length) { p.bytes = null; continue }
    try {
      const blob = new Blob([p.bytes], { type: 'image/png' })
      const bmp = await createImageBitmap(blob)
      if (seq !== openSeq || S.noteId !== id) { if (bmp.close) bmp.close(); return }
      S.pages[i].rasterBitmap = bmp
      p.bytes = null
      if (i === S.currentPage) renderPage(S.pages[i])
      refreshPages()
    } catch (err) { console.error('decode page failed', err) }
  }
}

function sanitizePage() {
  // persist outgoing page before switching
  const out = S.pages[S.currentPage]
  if (out && out.dirty) saveCurrentPage()
}

function setPage(i) {
  if (i < 0 || i >= S.pages.length) return
  if (S.currentPage !== i) sanitizePage()
  clearSelection()
  S.currentPage = i
  const page = current()
  renderPage(page)
  if (!S.hadZoom) fitZoom()
  applyTransform()
  refreshPages()
  updateTitle()
  syncUndoRedo()
}

function addPage() {
  const page = current()
  const paper = page ? { ...page.paper } : DEFAULT_PAPER()
  S.pages.push(newPage(paper))
  setPage(S.pages.length - 1)
}

// ---------- pages rail (left, like the original app) ----------
let thumbsQueued = null
function refreshPages() {
  const bar = $('pagesBar')
  bar.innerHTML = ''
  S.pages.forEach((_, i) => {
    const item = document.createElement('div')
    item.className = 'pageItem' + (i === S.currentPage ? ' cur' : '')
    const num = document.createElement('div')
    num.className = 'num'
    num.textContent = String(i + 1)
    const t = document.createElement('div')
    t.className = 'pageThumb'
    t.title = 'Page ' + (i + 1)
    item.append(num, t)
    item.onclick = () => setPage(i)
    bar.appendChild(item)
    drawThumb(t, i)
  })
}

function drawThumb(t, i) {
  const page = S.pages[i]
  // pages with no ink show the light-blue placeholder (06-save, page 2)
  if (!page.strokes.length) {
    t.style.backgroundImage = ''
    t.classList.add('placeholder')
    return
  }
  t.classList.remove('placeholder')
  const off = flattenToCanvas(page)
  const small = document.createElement('canvas')
  small.width = 176; small.height = Math.round(176 * off.height / off.width)
  small.getContext('2d').drawImage(off, 0, 0, small.width, small.height)
  t.style.backgroundImage = `url(${small.toDataURL()})`
}

function refreshCurrentThumb() {
  syncUndoRedo()
  const item = $('pagesBar').children[S.currentPage]
  if (item) drawThumb(item.querySelector('.pageThumb'), S.currentPage)
}

// toolbar Undo/Redo start disabled in markup; keep them in step with the
// current page's history (otherwise the buttons stay dead forever)
function syncUndoRedo() {
  const page = current()
  const u = $('btnUndo'), r = $('btnRedo')
  if (u) u.disabled = !page || !page.undo || page.undo.length === 0
  if (r) r.disabled = !page || !page.redo || page.redo.length === 0
}

// ---------- pointer drawing ----------
let live = null // {stroke, drawnIdx}
let pan = null
let erasePending = null

function onPointerDown(e) {
  const page = current(); if (!page) return
  // HUD chrome lives inside the canvas stack: clicking Duplicate/Delete/rotate
  // or the ruler controls must never start an ink stroke underneath it
  if (e.target.closest('button, input, textarea, select, a, [contenteditable="true"], #selBar, #rulerCtl, #textEditBar, #titleStrip')) return
  const stack = $('stackInner')
  try { stack.setPointerCapture(e.pointerId) } catch { /* synthetic/test pointers */ }
  if (bounceRAF) { cancelAnimationFrame(bounceRAF); bounceRAF = 0; S.pullPx = 0; applyTransform(); hidePullHint() }
  const isPan = S.tool === 'pan' || S.tool === 'view' || S.spaceDown || e.button === 1
  if (isPan) {
    const host = $('canvasHost')
    pan = { x: e.clientX, y: e.clientY, sl: host.scrollLeft, st: host.scrollTop }
    return
  }
  if (e.button !== 0 && e.pointerType === 'mouse') return
  let { x, y } = pageCoords(e)
  // dragging the ruler grip moves the stencil; drawing near it still snaps
  if (S.rulerOn && rulerHandleHit(page, x, y)) { rulerStartMove(x, y); return }
  if (S.rulerOn && S.tool === 'pen') ({ x, y } = rulerSnapPoint(x, y))
  const lc = ctxOf('liveC'); const { w, h } = docSize(page)
  lc.clearRect(0, 0, w, h)
  if (S.tool === 'pen') {
    live = { stroke: makeStroke(curPen(), docMM(curPen().widthMM)), drawnIdx: -1 }
    if (addPoint(live.stroke, x, y, e.pressure, docMM(0.8))) drawLiveSlice(page)
  } else if (S.tool === 'text') {
    placeTextBox(page, x, y)
  } else if (S.tool === 'erase') {
    if (S.eraserMode === 'sheet') { eraseSheet(page); return }
    erasePending = { whole: [], pairs: [] }
    eraseAt(page, x, y)
  } else if (S.tool === 'lasso') {
    const sel = S.selection
    if (sel && page === sel.page && x >= sel.bbox.x - 12 && x <= sel.bbox.x + sel.bbox.w + 12 && y >= sel.bbox.y - 12 && y <= sel.bbox.y + sel.bbox.h + 12) {
      dragSel = { lx: x, ly: y, dx: 0, dy: 0 }
      return
    }
    lassoBegin(page, x, y)
  } else if (S.tool === 'laser') {
    laserAddPoint(page, x, y, true)
  }
}

function drawLiveSlice(page) {
  if (!live) return
  const stroke = live.stroke
  const lc = ctxOf('liveC')
  const { w, h } = docSize(page)
  if (scratch.width !== w) scratch.width = w
  if (scratch.height !== h) scratch.height = h
  // stamp the full stroke (opaque coverage) on the shared scratch, then
  // composite exactly once at the pen's alpha — no within-stroke darkening
  drawStrokeMask(scratchCtx, w, h, stroke)
  lc.clearRect(0, 0, w, h)
  lc.globalAlpha = stroke.opacity != null ? clamp(stroke.opacity, 0.02, 1)
    : (PEN_TYPES[stroke.type] || PEN_TYPES.marker).alpha
  lc.drawImage(scratch, 0, 0)
  lc.globalAlpha = 1
}

// the factory eraser modes: 'stroke' removes touched strokes whole, 'segment'
// cuts the stroke where the eraser circle crosses (S/M/L via S.eraserMM)
function eraseCursorR() {
  return docMM(S.eraserMode === 'stroke' ? 4 : S.eraserMM)
}

function splitStrokeAroundCircle(st, x, y, r) {
  const pts = st.pts || []
  const pieces = []
  let run = null
  for (const p of pts) {
    const inside = (p.x - x) ** 2 + (p.y - y) ** 2 <= r * r
    if (inside) {
      if (run && run.length >= 2) pieces.push(run)
      run = null
    } else {
      (run || (run = [])).push(p)
    }
  }
  if (run && run.length >= 2) pieces.push(run)
  if (!pieces.length) return null
  // copy the points so later moves of a piece never corrupt the original on undo
  return pieces.map(seg => ({ ...st, pts: seg.map(p => ({ x: p.x, y: p.y })) }))
}

function eraseAt(page, x, y) {
  const r = eraseCursorR()
  const lc = ctxOf('liveC')
  const paintCursor = () => {
    lc.strokeStyle = '#f669'; lc.fillStyle = '#4d4d4d33'
    lc.beginPath(); lc.arc(x, y, r, 0, Math.PI * 2); lc.fill(); lc.stroke()
  }
  const kept = [], whole = [], pairs = []
  for (const st of page.strokes) {
    if (!strokeIntersectsCircle(st, x, y, r)) { kept.push(st); continue }
    if (S.eraserMode === 'segment') {
      const pieces = splitStrokeAroundCircle(st, x, y, r)
      if (pieces) { pairs.push([st, pieces]); kept.push(...pieces); continue }
    }
    whole.push(st)
  }
  if (!whole.length && !pairs.length) { lc.clearRect(0, 0, docSize(page).w, docSize(page).h); paintCursor(); return }
  firstCommitPreCapture(page)
  page.strokes = kept
  if (!erasePending) erasePending = { whole: [], pairs: [] }
  erasePending.whole.push(...whole)
  erasePending.pairs.push(...pairs)
  redrawInk(page)
  lc.clearRect(0, 0, docSize(page).w, docSize(page).h)
  paintCursor()
}

function onPointerMove(e) {
  const page = current(); if (!page) return
  if (pan) {
    const host = $('canvasHost')
    host.scrollLeft = Math.max(0, Math.min(pan.sl - (e.clientX - pan.x), host.scrollWidth - host.clientWidth))
    const maxTop = Math.max(0, host.scrollHeight - host.clientHeight)
    const top = pan.st - (e.clientY - pan.y)
    if (top > maxTop && S.pages.length && S.currentPage === S.pages.length - 1) {
      // pull below the last page: rubber-band + hint "drop to add a page"
      pan.over = top - maxTop
      S.pullPx = Math.min(230, pan.over * 0.35)
      applyTransform()
      updatePullHint(pan.over)
      return
    }
    host.scrollTop = Math.max(0, top)
    pan.over = 0 // pulled past the bottom then back up: releasing must not add a page
    if (S.pullPx) { S.pullPx = 0; applyTransform() }
    updatePullHint(0)
    return
  }
  let { x, y } = pageCoords(e)
  if (rulerGrip) { rulerMoveUpdate(page, x, y); return }
  if (S.rulerOn && live) { ({ x, y } = rulerSnapPoint(x, y)) }
  if (live) {
    if (addPoint(live.stroke, x, y, e.pressure, docMM(0.8))) drawLiveSlice(page)
  } else if (erasePending) {
    eraseAt(page, x, y)
  } else if (lasso) {
    lassoAddPoint(x, y)
  } else if (dragSel) {
    dragSel.dx += x - dragSel.lx; dragSel.dy += y - dragSel.ly
    dragSel.lx = x; dragSel.ly = y
    drawSelectionPreview(page)
  } else if (laserLive) {
    laserAddPoint(page, x, y, false)
  }
}

// Snapshot the pre-edit composite on the first edit after opening a page, so
// the replay GIF starts from the loaded state (imported base included).
function firstCommitPreCapture(page) {
  if (page.recorder && page.recorder.frames.length === 0 && !page.recorder.changed) {
    page.recorder.lastCapture = performance.now() - 600
    page.recorder.capture(flattenToCanvas(page))
  }
}

// ---------- laser pointer (temporary trail, never saved) (QA counters removed at ship) ----------
let laserLive = null // {pts, w, color}
let laserTrail = []  // {pts, w, color, born}
let laserRAF = 0

// one paint call per frame: live stroke paints fully, trails fade and drop out
function laserAddPoint(page, x, y, first) {
  if (first) laserLive = { pts: [{ x, y }], w: docMM(2.5), color: '#ff0000' }
  else if (laserLive) {
    const last = laserLive.pts[laserLive.pts.length - 1]
    if ((last.x - x) ** 2 + (last.y - y) ** 2 < 9) return
    laserLive.pts.push({ x, y })
  } else return
  laserTick()
}

function laserEnd() {
  if (laserLive && laserLive.pts.length) laserTrail.push({ ...laserLive, born: performance.now() })
  laserLive = null
}

function laserStop() {
  if (laserRAF) { cancelAnimationFrame(laserRAF); laserRAF = 0 }
  laserLive = null
  laserTrail = []
  const c = $('laserC'); if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height)
}

function laserTick() {
  paintLaser()
  if (!laserLive && !laserTrail.length) return
  if (!laserRAF) laserRAF = requestAnimationFrame(() => { laserRAF = 0; laserTick() })
}

function paintLaser() {
  const c = $('laserC'); if (!c) return
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  const now = performance.now()
  laserTrail = laserTrail.filter(t => now - t.born < 1300)
  const paint = (pts, w, color, alpha) => {
    if (!pts.length) return
    if (pts.length === 1) {
      ctx.globalAlpha = alpha; ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, w / 2, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = 1
      return
    }
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = w
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke(); ctx.globalAlpha = 1
  }
  // fresh trail portions glow, old ones fade like the laser dot light
  for (const t of laserTrail) {
    const age = now - t.born
    paint(t.pts, t.w, t.color, age < 700 ? 1 : 1 - (age - 700) / 600)
  }
  if (laserLive) paint(laserLive.pts, laserLive.w, laserLive.color, 1)
}

// ---------- lasso selection (move / duplicate / delete) ----------
let lasso = null        // {pts:[{x,y}]} while drawing the marching ants
let dragSel = null      // {lx,ly,dx,dy} while moving the selection

function setTool(t) {
  if (S.tool === 'laser') laserStop()
  if (S.tool === 'lasso') clearSelection()
  S.tool = t
  const page = current()
  if (page) { ctxOf('liveC').clearRect(0, 0, docSize(page).w, docSize(page).h) }
  syncToolButtons()
  renderPenStack()
  stackInnerClass()
  if (t === 'laser') showHint('Laser pointer — trail fades, never saved')
  else if (t === 'lasso') showHint('Circle strokes to select, drag inside to move')
  else if (t === 'view') showHint('View mode — drag anywhere to pan')
}

function anyPtInPoly(pts, poly) {
  // even-odd test on every 2nd point for speed
  for (let i = 0; i < pts.length; i += 2) {
    const { x, y } = pts[i]
    let inside = false
    for (let j = 0, k = poly.length - 1; j < poly.length; k = j++) {
      const xi = poly[j].x, yi = poly[j].y, xk = poly[k].x, yk = poly[k].y
      if (((yi > y) !== (yk > y)) && (x < (xk - xi) * (y - yi) / (yk - yi) + xi)) inside = !inside
    }
    if (inside) return true
  }
  return false
}

function strokeBBox(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const st of strokes) for (const p of st.pts) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y
  }
  if (x0 === Infinity) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function lassoBegin(page, x, y) {
  if (S.selection && S.selection.page !== page) clearSelection()
  lasso = { pts: [{ x, y }] }
}

function lassoAddPoint(x, y) {
  if (!lasso) return
  const last = lasso.pts[lasso.pts.length - 1]
  if ((last.x - x) ** 2 + (last.y - y) ** 2 < 16) return
  lasso.pts.push({ x, y })
  const page = current(); if (!page) return
  const lc = ctxOf('liveC')
  lc.clearRect(0, 0, docSize(page).w, docSize(page).h)
  drawPolyPath(lc, lasso.pts, true)
}

function drawPolyPath(c, pts, dashed) {
  if (pts.length < 2) return
  c.save()
  if (dashed) c.setLineDash([10, 7])
  c.strokeStyle = 'rgba(11,99,197,.9)'
  c.fillStyle = 'rgba(11,99,197,.08)'
  c.lineWidth = 2.5
  c.beginPath(); c.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y)
  c.closePath()
  c.fill(); c.stroke()
  c.restore()
}

function lassoCommit(page) {
  const pts = lasso ? lasso.pts : null
  lasso = null
  const lc = ctxOf('liveC'); lc.clearRect(0, 0, docSize(page).w, docSize(page).h)
  if (!pts || pts.length < 3) { clearSelection(); return }
  const hits = page.strokes.filter(st => anyPtInPoly(st.pts, pts))
  if (!hits.length) { clearSelection(); return }
  S.selection = { page, strokes: hits, bbox: strokeBBox(hits) }
  drawSelectionBox(page)
  showSelBar(page)
}

function drawSelectionBox(page) {
  const sel = S.selection
  if (!sel || sel.page !== page) return
  const b = strokeBBox(sel.strokes)
  sel.bbox = b
  const lc = ctxOf('liveC')
  lc.clearRect(0, 0, docSize(page).w, docSize(page).h)
  lc.save()
  lc.setLineDash([12, 8])
  lc.strokeStyle = 'rgba(11,99,197,.95)'
  lc.lineWidth = 2.5 / 1
  lc.strokeRect(b.x - 14, b.y - 14, b.w + 28, b.h + 28)
  // corner handles
  lc.setLineDash([])
  lc.fillStyle = '#fff'
  for (const [hx, hy] of [[b.x - 14, b.y - 14], [b.x + b.w + 14, b.y - 14], [b.x - 14, b.y + b.h + 14], [b.x + b.w + 14, b.y + b.h + 14]]) {
    lc.beginPath(); lc.arc(hx, hy, 6, 0, Math.PI * 2); lc.fill(); lc.stroke()
  }
  lc.restore()
}

function drawSelectionPreview(page) {
  const sel = S.selection; if (!sel) return
  drawSelectionBox(page)
  const lc = ctxOf('liveC')
  lc.save()
  lc.translate(dragSel.dx, dragSel.dy)
  for (const st of sel.strokes) drawStrokeItem(lc, docSize(page).w, docSize(page).h, st)
  lc.restore()
}

function selectionCommitMove(page) {
  const sel = S.selection; if (!sel) return
  const { dx, dy } = dragSel
  dragSel = null
  ctxOf('liveC').clearRect(0, 0, docSize(page).w, docSize(page).h)
  if (!dx && !dy) { drawSelectionBox(page); refreshSelBar(); return }
  firstCommitPreCapture(page)
  for (const st of sel.strokes) for (const p of st.pts) { p.x += dx; p.y += dy }
  page.undo.push({ t: 'move', strokes: sel.strokes, dx, dy })
  page.redo = []
  sel.bbox = strokeBBox(sel.strokes)
  redrawInk(page)
  drawSelectionBox(page)
  refreshSelBar()
  page.recorder.capture(flattenToCanvas(page))
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
}

function showSelBar(page) {
  let bar = $('selBar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'selBar'
    bar.setAttribute('role', 'toolbar')
    bar.setAttribute('aria-label', 'Selection actions')
    bar.innerHTML = `<button id="selDup" title="Duplicate" aria-label="Duplicate">&#9236;</button><button id="selDel" title="Delete" aria-label="Delete" class="danger">&#10005;</button><button id="selClear" title="Deselect" aria-label="Deselect">&#215;</button>`
    bar.style.transformOrigin = '0 0'
    $('stackInner').append(bar)
    bar.querySelector('#selDup').onclick = () => selectionDuplicate()
    bar.querySelector('#selDel').onclick = () => selectionDelete()
    bar.querySelector('#selClear').onclick = () => { clearSelection(); redrawInk(current()) }
  }
  refreshSelBar()
  positionSelBar()
  bar.classList.remove('hidden')
}

function refreshSelBar() {
  const bar = $('selBar'); if (!bar) return
  bar.style.transform = `scale(${1 / S.zoom})`
}

function positionSelBar() {
  const bar = $('selBar'); if (!bar || !S.selection) return
  const b = S.selection.bbox
  bar.style.left = Math.round(b.x + b.w / 2 - 120) + 'px'
  bar.style.top = Math.max(2, Math.round(b.y - 90)) + 'px'
}

function selectionDelete() {
  const sel = S.selection; if (!sel) return
  const page = sel.page
  firstCommitPreCapture(page)
  page.strokes = page.strokes.filter(st => !sel.strokes.includes(st))
  page.undo.push({ t: 'erase', strokes: [...sel.strokes] })
  page.redo = []
  clearSelection()
  redrawInk(page)
  page.recorder.capture(flattenToCanvas(page))
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
}

function selectionDuplicate() {
  const sel = S.selection; if (!sel) return
  const page = sel.page
  const copies = sel.strokes.map(st => ({ ...st, pts: st.pts.map(p => ({ x: p.x + 26, y: p.y + 26 })), shape: st.shape ? { ...st.shape } : undefined }))
  firstCommitPreCapture(page)
  page.strokes.push(...copies)
  page.undo.push({ t: 'add', strokes: copies })
  page.redo = []
  sel.strokes = copies
  sel.bbox = strokeBBox(copies)
  redrawInk(page)
  drawSelectionBox(page)
  refreshSelBar()
  page.recorder.capture(flattenToCanvas(page))
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
}

function clearSelection() {
  S.selection = null
  dragSel = null
  const bar = $('selBar'); if (bar) bar.remove()
  const page = current()
  if (page) ctxOf('liveC').clearRect(0, 0, docSize(page).w, docSize(page).h)
}

// position the selection bar after bbox recompute; DOM-less redraw otherwise
function updateSelectionChrome(page) {
  if (S.selection && S.selection.page === page) { drawSelectionBox(page); positionSelBar(); refreshSelBar() }
}

// ---------- ruler (stencil line: ink snaps along it; drag the grip to move) ----------
const ruler = { angle: 0, fx: 0.5, fy: 0.55 } // fractions of the doc size
let rulerGrip = null

function toggleRuler() {
  S.rulerOn = !S.rulerOn
  const page = current(); if (!page) return
  syncToolButtons()
  if (S.rulerOn) drawRulerLayer(page)
  else {
    const c = $('rulerC'); c.getContext('2d').clearRect(0, 0, c.width, c.height)
    const ctl = $('rulerCtl'); if (ctl) ctl.remove()
  }
}

function rulerDir(page) {
  const { w, h } = docSize(page)
  const a = ruler.angle * Math.PI / 180
  return { ux: Math.cos(a), uy: Math.sin(a), px: ruler.fx * w, py: ruler.fy * h, w, h }
}

function rulerSnapPoint(x, y) {
  const page = current(); if (!page || !S.rulerOn) return { x, y }
  const { ux, uy, px, py } = rulerDir(page)
  const t = (x - px) * ux + (y - py) * uy
  return { x: px + t * ux, y: py + t * uy }
}

function drawRulerLayer(page) {
  const c = $('rulerC'); if (!c || c.width === 0) return
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  if (!S.rulerOn) return
  const { ux, uy, px, py, w, h } = rulerDir(page)
  const half = (w + h) * 0.52 // long enough to cross any page
  const x0 = clamp(px - ux * half, 0, w), y0 = clamp(py - uy * half, 0, h)
  const x1r = clamp(px + ux * half, 0, w), y1r = clamp(py + uy * half, 0, h)
  ctx.save()
  // body of the stencil: a thick translucent band under the line
  ctx.strokeStyle = 'rgba(11,99,197,.16)'
  ctx.lineWidth = 56
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1r, y1r); ctx.stroke()
  ctx.strokeStyle = 'rgba(11,99,197,.85)'
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1r, y1r); ctx.stroke()
  // division ticks
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(11,99,197,.55)'
  const tickStep = Math.max(1, Math.round(docMM(10)))
  for (let t = 0; t <= half; t += tickStep) {
    for (const s of [1, -1]) {
      const bx = px + s * t * ux, by = py + s * t * uy
      if (bx < -20 || bx > w + 20 || by < -20 || by > h + 20) continue
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - uy * 14, by + ux * 14); ctx.stroke()
    }
  }
  // grip handle at the pivot
  ctx.setLineDash([])
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = 'rgba(11,99,197,.9)'
  ctx.lineWidth = 2.5
  ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(11,99,197,.9)'; ctx.fill()
  ctx.restore()
  drawRulerCtl(px, py)
}

function drawRulerCtl(px, py) {
  let ctl = $('rulerCtl')
  if (!ctl) {
    ctl = document.createElement('div')
    ctl.id = 'rulerCtl'
    ctl.innerHTML = `<button id="rulCCW" title="Rotate left 10&#176;" aria-label="Rotate ruler left"><svg viewBox="0 0 24 24"><path d="M14.6 6.4 9 12l5.6 5.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button id="rulCW" title="Rotate right 10&#176;" aria-label="Rotate ruler right"><svg viewBox="0 0 24 24"><path d="M9.4 6.4 15 12l-5.6 5.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
    ctl.style.transformOrigin = '0 0'
    ctl.querySelector('#rulCCW').onclick = ev => { ev.stopPropagation(); ruler.angle -= 10; redrawRuler() }
    ctl.querySelector('#rulCW').onclick = ev => { ev.stopPropagation(); ruler.angle += 10; redrawRuler() }
    $('stackInner').append(ctl)
  }
  ctl.style.left = (px + 26) + 'px'
  ctl.style.top = (py + 26) + 'px'
  ctl.style.transform = `scale(${1 / S.zoom})`
}

function redrawRuler() {
  const page = current(); if (!page) return
  drawRulerLayer(page)
}

// ruler grip dragging (a pointer down on the handle circle moves the line)
function rulerHandleHit(page, x, y) {
  if (!S.rulerOn) return false
  const { px, py } = rulerDir(page)
  return (x - px) ** 2 + (y - py) ** 2 <= 24 * 24
}

function rulerStartMove(x, y) {
  rulerGrip = { lx: x, ly: y }
}

function rulerMoveUpdate(page, x, y) {
  if (!rulerGrip) return
  const fx = ruler.fx * docSize(page).w + (x - rulerGrip.lx)
  const fy = ruler.fy * docSize(page).h + (y - rulerGrip.ly)
  ruler.fx = clamp(fx / docSize(page).w, 0.02, 0.98)
  ruler.fy = clamp(fy / docSize(page).h, 0.02, 0.98)
  rulerGrip = { lx: x, ly: y }
  drawRulerLayer(page)
}


// ---------- shapes gallery (TextAndShapeFlyout: icons mirror Assets/Images) ----------
const SHAPE_GALLERY = [
  ['line', 0], ['arrow', 0],
  ['circle', 0], ['circle', 1],
  ['ellipse', 0], ['ellipse', 1],
  ['rectangle', 0], ['rectangle', 1],
  ['star', 0], ['star', 1],
  ['polygon3', 0], ['polygon3', 1],
  ['polygon4', 0], ['polygon4', 1],
  ['polygon5', 0], ['polygon5', 1],
  ['polygon6', 0], ['polygon6', 1],
  ['polygon7', 0], ['polygon7', 1],
  ['polygon8', 0], ['polygon8', 1],
  ['polygon9', 0], ['polygon9', 1],
  ['polygon10', 0], ['polygon10', 1],
]

// returns { lines: [ [{x,y}...], ... ] } — one polyline per pen path
function buildShapePts(kind, cx, cy, R) {
  const P = (x, y) => ({ x, y })
  const withClose = pts => [...pts, pts[0]]
  if (kind === 'line') return { lines: [[P(cx - R, cy), P(cx + R, cy)]] }
  if (kind === 'arrow') {
    const A = P(cx - R, cy), T = P(cx + R * 0.6, cy)
    const B1 = P(T.x - R * 0.45, T.y - R * 0.42), B2 = P(T.x - R * 0.45, T.y + R * 0.42)
    return { lines: [[A, T], [B1, T], [B2, T]] }
  }
  if (kind === 'circle') {
    const pts = []
    for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2; pts.push(P(cx + R * Math.cos(a), cy + R * Math.sin(a))) }
    return { lines: [pts] }
  }
  if (kind === 'ellipse') {
    const ry = R * 0.62
    const pts = []
    for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2; pts.push(P(cx + R * Math.cos(a), cy + ry * Math.sin(a))) }
    return { lines: [pts] }
  }
  if (kind === 'rectangle') {
    return { lines: [withClose([P(cx - R, cy - R * 0.72), P(cx + R, cy - R * 0.72), P(cx + R, cy + R * 0.72), P(cx - R, cy + R * 0.72)])] }
  }
  if (kind === 'star') {
    const pts = []
    for (let i = 0; i <= 10; i++) {
      const rr = i % 2 ? R * 0.42 : R
      const a = -Math.PI / 2 + i * Math.PI / 5
      pts.push(P(cx + rr * Math.cos(a), cy + rr * Math.sin(a)))
    }
    return { lines: [pts] }
  }
  const n = parseInt(kind.slice(7), 10) || 5
  const pts = []
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / n
    pts.push(P(cx + R * Math.cos(a), cy + R * Math.sin(a)))
  }
  return { lines: [pts] }
}

function drawShapeIcon(cv, kind, fill) {
  const c = cv.getContext('2d')
  c.clearRect(0, 0, cv.width, cv.height)
  const { lines } = buildShapePts(kind, 18, 18, 12)
  const path = new Path2D()
  for (const ln of lines) {
    path.moveTo(ln[0].x, ln[0].y)
    for (let i = 1; i < ln.length; i++) path.lineTo(ln[i].x, ln[i].y)
    if (fill && ln.length > 2) path.closePath()
  }
  if (fill && lines.length === 1 && lines[0].length > 2) {
    c.fillStyle = '#3a3a3a'
    c.fill(path)
  } else {
    c.strokeStyle = '#3a3a3a'
    c.lineWidth = 1.6
    c.lineCap = 'round'; c.lineJoin = 'round'
    c.stroke(path)
  }
}

function buildShapeGrid() {  const g = $('shapeGrid')
  if (!g) return
  SHAPE_GALLERY.forEach(([kind, fill]) => {
    const b = document.createElement('button')
    b.className = 'sh-card'
    const name = kind.startsWith('polygon') ? `${kind.slice(7)}-sided` : kind
    b.title = fill ? `${name} (filled)` : name
    const cv = document.createElement('canvas')
    cv.width = 36; cv.height = 36
    drawShapeIcon(cv, kind, !!fill)
    b.append(cv)
    b.onclick = () => insertShape(kind, fill)
    g.append(b)
  })
}

function insertShape(kind, fill) {
  const page = current(); if (!page) return
  page.texts = page.texts || []
  // drop at the viewport center (doc coords)
  const host = $('canvasHost').getBoundingClientRect()
  const inner = $('stackInner')
  const rect = inner.getBoundingClientRect()
  const scale = rect.width / inner.offsetWidth
  const { w, h } = docSize(page)
  const cx = clamp((host.left + host.width / 2 - rect.left) / scale, 700, w - 700)
  const cy = clamp((host.top + host.height / 2 - rect.top) / scale, 700, h - 700)
  const R = 620
  const widthMM = clamp(curPen().widthMM, 1.2, 6)
  const { lines } = buildShapePts(kind, cx, cy, R)
  const strokes = lines.map(pts => ({
    type: 'shape',
    color: curPen().color,
    opacity: 1,
    width: docMM(widthMM),
    pts,
    shape: { kind, fill: !!fill },
  }))
  firstCommitPreCapture(page)
  page.strokes.push(...strokes)
  page.undo.push({ t: 'add', strokes })
  page.redo = []
  redrawInk(page)
  page.recorder.capture(flattenToCanvas(page))
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
  closeToolFlyout('shapeFlyout')
}

// ---------- sheet eraser (whole-page one-tap erase) ----------
function eraseSheet(page) {
  const removed = page.strokes
  const removedTexts = page.texts || []
  if (!removed.length && !removedTexts.length) return
  firstCommitPreCapture(page)
  page.strokes = []
  page.texts = []
  // sheet erase clears text boxes too; keep them in the same undo entry
  if (removed.length || removedTexts.length) page.undo.push({ t: 'erase', strokes: removed, texts: removedTexts })
  page.redo = []
  redrawInk(page)
  page.recorder.capture(flattenToCanvas(page))
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
}

function drawEraserPreview() {
  const cv = $('erWave'); if (!cv) return
  const c = cv.getContext('2d')
  c.clearRect(0, 0, cv.width, cv.height)
  const r = 3 + S.eraserMM * 0.85
  c.strokeStyle = '#888'
  c.fillStyle = 'rgba(0,0,0,.16)'
  c.beginPath(); c.arc(cv.width / 2, cv.height / 2, r, 0, Math.PI * 2)
  c.fill(); c.stroke()
}

// ---------- text box (CanvasTextBox parity stub: session-editable, baked on save) ----------
function wireTextTool() {
  const b = $('btnTextTool')
  if (b) b.onclick = startTextTool
}

let textEdit = null
let hintTimer = null

function showHint(msg) {
  const h = $('shapeTextHint')
  if (!h) return
  h.textContent = msg
  h.classList.remove('hidden')
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => h.classList.add('hidden'), 2600)
}

function startTextTool() {
  setTool('text')
  closeToolFlyout('shapeFlyout')
  showHint('Tap on the page to place a text box')
}

function textStyle(el, obj) {
  el.style.fontWeight = obj.bold ? '600' : '400'
  el.style.fontStyle = obj.italic ? 'italic' : 'normal'
  el.style.textDecoration = obj.underline ? 'underline' : 'none'
  el.style.fontSize = obj.size + 'px'
  el.style.color = obj.color
  autoGrowText(el)
}

function autoGrowText(el) {
  el.style.height = 'auto'
  el.style.height = (el.scrollHeight + 2) + 'px'
  el.style.width = Math.max(140, Math.min(1600, el.scrollWidth + 10)) + 'px'
}

function placeTextBox(page, x, y) {
  if (textEdit) { textEdit.el.focus(); return }
  if (!page.texts) page.texts = []
  const obj = {
    txt: '', x, y,
    size: S.textBoxSize || 55,
    color: curPen().color,
    bold: false, italic: false, underline: false,
  }
  const inner = $('stackInner')
  const el = document.createElement('textarea')
  el.id = 'textEdit'
  el.rows = 1
  el.spellcheck = false
  el.style.left = Math.round(x) + 'px'
  el.style.top = Math.round(y) + 'px'
  textStyle(el, obj)
  inner.append(el)
  const bar = buildTextEditBar(page, obj, el)
  bar.style.left = el.style.left
  bar.style.top = Math.max(4, Math.round(y) - 44 / S.zoom) + 'px'
  // the bar is UI chrome: counter-scale so buttons stay screen-sized at any zoom
  bar.style.transformOrigin = '0 0'
  bar.style.transform = `scale(${1 / S.zoom})`
  inner.append(bar)
  el.addEventListener('input', () => autoGrowText(el))
  el.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); finishText(true) }
    else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); finishText(false) }
  })
  el.addEventListener('blur', () => { if (textEdit) finishText(false) })
  textEdit = { el, bar, page, obj }
  el.focus()
}

function buildTextEditBar(page, obj, el) {
  const bar = document.createElement('div')
  bar.id = 'textEditBar'
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Text formatting')
  const btn = (label, title, act, cls, small) => {
    const b = document.createElement('button')
    b.textContent = label
    b.title = title
    b.setAttribute('aria-label', title)
    if (cls) b.className = cls
    if (small) b.style.fontSize = small
    b.addEventListener('mousedown', e => e.preventDefault()) // keep focus in the box
    b.onclick = act
    bar.append(b)
    return b
  }
  const dB = btn('B', 'Bold', () => { obj.bold = !obj.bold; dB.classList.toggle('on', obj.bold); textStyle(el, obj) }, 'tt-b')
  const dI = btn('I', 'Italic', () => { obj.italic = !obj.italic; dI.classList.toggle('on', obj.italic); textStyle(el, obj) }, 'tt-i')
  const dU = btn('U', 'Underline', () => { obj.underline = !obj.underline; dU.classList.toggle('on', obj.underline); textStyle(el, obj) }, 'tt-u')
  btn('A', 'Small text', () => { obj.size = 38; textStyle(el, obj) }, 'tt-sz', '11px')
  btn('A', 'Medium text', () => { obj.size = 55; textStyle(el, obj) }, 'tt-sz', '14px')
  btn('A', 'Large text', () => { obj.size = 86; textStyle(el, obj) }, 'tt-sz', '18px')
  btn('\u2715', 'Discard text box', () => finishText(true), 'danger')
  return bar
}

function finishText(discard) {
  if (!textEdit) return
  const { el, bar, page, obj } = textEdit
  textEdit = null
  obj.txt = el.value.replace(/\s+$/, '')
  const committed = !!obj.txt
  el.remove(); bar.remove()
  if (discard || !committed) return
  firstCommitPreCapture(page)
  page.texts.push(obj)
  page.undo.push({ t: 'text', obj })
  page.redo = []
  redrawInk(page)
  page.recorder.capture(flattenToCanvas(page))
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
  setTool('pen')
}

// ---------- eraser flyout modes ----------

function onPointerUp(e) {
  const page = current(); if (!page) return
  if (pan) {
    const over = pan.over || 0
    const pull = S.pullPx || 0
    const host = $('canvasHost')
    const commit = Math.max(96, host.clientHeight * 0.12)
    pan = null
    S.pullPx = 0
    hidePullHint()
    if (over >= commit) {
      // release past the threshold: page N+1 materialises where you pulled
      applyTransform()
      addPage()
      host.scrollTop = 1e9
    } else if (pull > 3) {
      pullBounce(pull)
    } else {
      applyTransform()
    }
    return
  }
  if (rulerGrip) { rulerGrip = null; return }
  const { x, y } = pageCoords(e)
  const lc = ctxOf('liveC'); lc.clearRect(0, 0, docSize(page).w, docSize(page).h)
  if (live) {
    const stroke = live.stroke
    live = null
    if (!stroke.pts.length) return
    firstCommitPreCapture(page)
    page.strokes.push(stroke)
    redrawInk(page)
    page.undo.push({ t: 'add', stroke })
    page.redo = []
    page.recorder.capture(flattenToCanvas(page))
    page.dirty = true
    scheduleAutosave()
    refreshCurrentThumb()
  } else if (erasePending) {
    const ep = erasePending
    erasePending = null
    if (ep.whole.length) page.undo.push({ t: 'erase', strokes: ep.whole })
    if (ep.pairs.length) page.undo.push({ t: 'erase-split', pairs: ep.pairs })
    if (ep.whole.length || ep.pairs.length) {
      page.redo = []
      page.recorder.capture(flattenToCanvas(page))
      page.dirty = true
      scheduleAutosave()
      refreshCurrentThumb()
    }
  } else if (dragSel) {
    selectionCommitMove(page)
  } else if (lasso) {
    lassoCommit(page)
  } else if (laserLive) {
    laserEnd()
  }
}

// ---------- undo / redo ----------
function undo() {
  const page = current(); if (!page) return
  const a = page.undo.pop()
  if (!a) return
  clearSelection() // the selected object may be the one this action removes
  if (a.t === 'add') {
    for (const st of (a.strokes || [a.stroke])) {
      const idx = page.strokes.lastIndexOf(st)
      if (idx >= 0) page.strokes.splice(idx, 1)
    }
    page.redo.push(a)
  } else if (a.t === 'erase') {
    page.strokes.push(...a.strokes)
    if (a.texts) page.texts.push(...a.texts)
    page.redo.push(a)
  } else if (a.t === 'text') {
    const i = page.texts.indexOf(a.obj)
    if (i >= 0) page.texts.splice(i, 1)
    page.redo.push(a)
  } else if (a.t === 'erase-split') {
    for (const [orig, pieces] of a.pairs) {
      for (const pc of pieces) {
        const i = page.strokes.lastIndexOf(pc)
        if (i >= 0) page.strokes.splice(i, 1)
      }
      page.strokes.push(orig)
    }
    page.redo.push(a)
  } else if (a.t === 'move') {
    for (const st of a.strokes) for (const p of st.pts) { p.x -= a.dx; p.y -= a.dy }
    page.redo.push(a)
    clearSelection()
  }
  redrawInk(page)
  page.recorder.capture(flattenToCanvas(page))
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
}

function redo() {
  const page = current(); if (!page) return
  const a = page.redo.pop()
  if (!a) return
  clearSelection()
  if (a.t === 'add') {
    if (a.strokes) page.strokes.push(...a.strokes)
    else page.strokes.push(a.stroke)
    page.undo.push(a)
  } else if (a.t === 'erase') {
    page.strokes = page.strokes.filter(st => !a.strokes.includes(st))
    if (a.texts) page.texts = page.texts.filter(t => !a.texts.includes(t))
    page.undo.push(a)
  } else if (a.t === 'text') {
    page.texts.push(a.obj)
    page.undo.push(a)
  } else if (a.t === 'erase-split') {
    page.strokes = page.strokes.filter(st => !a.pairs.some(([o]) => st === o))
    // redo must put the surviving fragments back, mirroring undo (which
    // removes them and restores the original stroke)
    for (const [, pieces] of a.pairs) page.strokes.push(...pieces)
    page.undo.push(a)
  } else if (a.t === 'move') {
    for (const st of a.strokes) for (const p of st.pts) { p.x += a.dx; p.y += a.dy }
    page.undo.push(a)
    clearSelection()
  }
  redrawInk(page)
  page.recorder.capture(flattenToCanvas(page))
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
}

// ---------- save / autosave ----------
let autosaveTimer = null
let saveChain = Promise.resolve()
const failedPages = new Set()
function scheduleAutosave() {
  S.editSeq++
  setSaveState('pending', true)
  clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => saveCurrentPage(), 1400)
}

function setSaveState(kind, working) {
  const s = $('saveState')
  if (working) { s.textContent = 'saving…'; s.style.color = 'var(--dim)'; return }
  if (kind === 'ok') { s.textContent = 'saved'; s.style.color = '#6fd68f' }
  else if (kind === 'err') { s.textContent = 'save failed'; s.style.color = 'var(--danger)' }
  else s.textContent = ''
}

// Saves are serialized and captured against the note/page that was current at
// call time. `noteId` and `idx` must never be read after an await: switching
// notes mid-save used to write note A's bitmap into note B's page slot.
export function saveCurrentPage() {
  const noteId = S.noteId
  const idx = S.currentPage
  const page = current()
  if (!page || !noteId) return Promise.resolve(false)
  clearTimeout(autosaveTimer)
  setSaveState('saving', true)
  const run = async () => {
    // snapshot the edit counter at the moment flattening starts; edits made
    // during the async encode/save must keep the page dirty
    const seq = S.editSeq
    try {
      const png = await flattenBytes(page, 'image/png')
      const paper = page.paper
      const rgb = hexToCss(paper.bg, '#FFFFFF').slice(1).toUpperCase()
      const meta = {
        sizeName: (SIZES[paper.size] || SIZES.letter).name,
        orientation: paper.orientation,
        template: paper.template,
        templatePath: templatePathFor(paper.template, paper.orientation),
        bgColor: '#FF' + rgb,
        borderLines: paper.borderLines !== false,
        tool: (() => { const p = curPen(); return { type: p.type, color: p.color, widthMM: p.widthMM, opacity: p.opacity } })(),
        paper: { ...paper },
      }
      const frames = page.recorder.changed ? page.recorder.frames : []
      // vector snapshot so the page reopens as editable ink (sVec chunk)
      const vec = JSON.stringify({ v: 1, strokes: page.strokes, texts: page.texts || [] })
      const res = await bridge.savePage({ noteId, pageIndex: idx, png, frames, vec, meta })
      if (res && res.file) page.file = res.file
      failedPages.delete(page)
      if (S.editSeq === seq) {
        page.dirty = false
        page.recorder.changed = false
      }
      if (S.noteId === noteId && S.currentPage === idx) {
        if (S.note) { S.note.paper = { ...paper }; S.note.tool = { ...meta.tool } }
        refreshCurrentThumb()
        setSaveState('ok')
      }
      return true
    } catch (err) {
      failedPages.add(page)
      console.error(err)
      if (S.noteId === noteId && S.currentPage === idx) setSaveState('err')
      // transient OneDrive/AV lock: retry while the page is still dirty
      clearTimeout(autosaveTimer)
      autosaveTimer = setTimeout(() => { if (page.dirty) saveCurrentPage() }, 5000)
      return false
    }
  }
  const next = saveChain.then(run, run)
  saveChain = next.then(() => { }, () => { })
  return next
}

// Flush the current page and wait for every queued page write. Used before a
// note switch and by the main-process close handshake.
export async function flushCurrentPage() {
  const page = current()
  if (page && S.noteId && (page.dirty || page.recorder.changed)) {
    const ok = await saveCurrentPage()
    if (!ok) return false
  }
  await saveChain
  // a page switched away from earlier may still have a failed queued write
  for (const p of failedPages) if (p.dirty) return false
  return true
}

// ---------- flyouts ----------
// `ignoreEl` is the control that owns this surface: light-dismiss must skip it
// so the control's own click can toggle the surface closed (otherwise the
// pointerdown closer hides it first and the click handler re-opens it).
function closeFlyoutCloser(getEl, onClosed, ignoreEl) {
  const onDown = e => {
    const f = getEl()
    if (f && (f.contains(e.target) || (ignoreEl && ignoreEl.contains(e.target)))) {
      setTimeout(() => document.addEventListener('pointerdown', onDown, { capture: true, once: true }), 0)
      return
    }
    if (f) f.classList.add('hidden')
    document.removeEventListener('pointerdown', onDown, true)
    onClosed && onClosed()
  }
  setTimeout(() => document.addEventListener('pointerdown', onDown, { capture: true, once: true }), 0)
}

function showFlyoutNear(id, anchor) {
  const f = $(id)
  f.classList.remove('hidden') // visible before measuring (display:none → 0)
  const btn = anchor.getBoundingClientRect()
  const w = f.offsetWidth || 300
  f.style.left = Math.max(4, Math.min(btn.left - 66, window.innerWidth - w - 4)) + 'px'
  f.style.top = (btn.bottom + 4) + 'px'
}

// pen flyout centers itself under the slot it belongs to (02-pen-flyout)
function showFlyoutCentered(id, anchor) {
  const f = $(id)
  f.classList.remove('hidden')
  const btn = anchor.getBoundingClientRect()
  const w = f.offsetWidth || 300
  f.style.left = Math.max(4, Math.min(Math.round(btn.left + btn.width / 2 - w / 2), window.innerWidth - w - 4)) + 'px'
  f.style.top = (btn.bottom + 4) + 'px'
}

function closeToolFlyout(id) {
  const f = $(id)
  if (f) f.classList.add('hidden')
  if (S.flyoutOpenTool === id) S.flyoutOpenTool = null
  renderPenStack()
}

// tool flyouts (opened from the toolbar) suppress the selected slot's filled
// circle: the original drops the circle to a plain dot while a flyout is open
// (02-pen-flyout, 06-save) but keeps it for the wide paper band (04-tune)
function openToolFlyout(id, anchor, { centered = false, ignore = null } = {}) {
  if (S.flyoutOpenTool === id) { closeToolFlyout(id); return } // re-click toggles
  if (S.flyoutOpenTool) closeToolFlyout(S.flyoutOpenTool)
  S.flyoutOpenTool = id
  if (centered) showFlyoutCentered(id, anchor)
  else showFlyoutNear(id, anchor)
  closeFlyoutCloser(
    () => (S.flyoutOpenTool === id ? $(id) : null),
    () => {
      if (S.flyoutOpenTool === id) { S.flyoutOpenTool = null; renderPenStack() }
    },
    ignore || anchor,
  )
  renderPenStack()
}

let libCloser = null
function toggleLibraryFlyout() {
  const f = $('libraryFlyout')
  if (!f.classList.contains('hidden')) { f.classList.add('hidden'); libCloser = null; return }
  f.classList.remove('hidden')
  libCloser = true
  closeFlyoutCloser(() => (libCloser ? $('libraryFlyout') : null), () => { libCloser = null }, $('btnMenu'))
}

// ---------- paper panel (full-width band, mirrors 04-tune) ----------
const PP_TPLS = ['blank', 'ruled', 'math', 'ruled10', 'ruled15', 'ruled20', 'ruled30', 'ruled40', 'math10', 'math15', 'math20', 'math30']
const PP_CAPS = { blank: 'blank', ruled: 'ruled', math: 'math', ruled10: 'ruled 10', ruled15: 'ruled 15', ruled20: 'ruled 20', ruled30: 'ruled 30', ruled40: 'ruled 40', math10: 'math 10', math15: 'math 15', math20: 'math 20', math30: 'math 30' }

function markPaperChanged(page) {
  renderPage(page)
  applyTransform()
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
}

function togglePaperPanel() {
  const p = $('paperPanel')
  if (!p.classList.contains('hidden')) { p.classList.add('hidden'); return }
  if (!current()) return
  syncPaperPanel()
  p.classList.remove('hidden')
  // light-dismiss like every other surface; the selected pen slot keeps its
  // circle while the wide band is open (04-tune)
  closeFlyoutCloser(() => $('paperPanel'), null, $('btnPaper'))
}

function syncPaperPanel() {
  const page = current()
  if (!page) return
  document.querySelectorAll('#ppThumbs .pp-thumb').forEach(t => {
    t.classList.toggle('sel', t.dataset.tpl === page.paper.template)
  })
  const orient = page.paper.orientation || 'portrait'
  $('ppPortrait').classList.toggle('accent', orient === 'portrait')
  $('ppPortrait').setAttribute('aria-pressed', orient === 'portrait' ? 'true' : 'false')
  $('ppLandscape').classList.toggle('accent', orient !== 'portrait')
  $('ppLandscape').setAttribute('aria-pressed', orient === 'portrait' ? 'false' : 'true')
  $('paperBrl').checked = page.paper.borderLines !== false
  syncWritingPaneButtons()
}

function syncWritingPaneButtons() {
  // visual parity only — real writing pane lands with the ink-to-text stage
  $('ppPaneOn').classList.toggle('accent', S.writingPane)
  $('ppPaneOn').setAttribute('aria-pressed', S.writingPane ? 'true' : 'false')
  $('ppPaneOff').classList.toggle('accent', !S.writingPane)
  $('ppPaneOff').setAttribute('aria-pressed', S.writingPane ? 'false' : 'true')
}

function applyOrientation(orient) {
  const page = current(); if (!page) return
  page.paper.orientation = orient
  markPaperChanged(page)
  syncPaperPanel()
}

function applyBorderLines() {
  const page = current(); if (!page) return
  page.paper.borderLines = $('paperBrl').checked
  markPaperChanged(page)
}

function setWritingPane(on) {
  S.writingPane = on
  syncWritingPaneButtons()
}

function buildPaperThumbs() {
  const wrap = $('ppThumbs')
  wrap.innerHTML = ''
  PP_TPLS.forEach(id => {
    const b = document.createElement('button')
    b.className = 'pp-thumb'
    b.dataset.tpl = id
    b.title = PP_CAPS[id]
    const cv = document.createElement('canvas')
    cv.width = 236; cv.height = 198
    drawTplPreview(cv, id)
    const cap = document.createElement('span')
    cap.className = 'cap'
    cap.textContent = PP_CAPS[id]
    b.append(cv, cap)
    b.onclick = () => {
      const page = current(); if (!page) return
      page.paper.template = id
      markPaperChanged(page)
      syncPaperPanel()
    }
    wrap.append(b)
  })
}

// 118×99 mini previews re-drawn procedurally at preview scale (no asset copy)
function drawTplPreview(cv, id) {
  const ctx = cv.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, cv.width, cv.height)
  const t = TEMPLATES[id]
  if (!t || !t.kind) return
  // TEMPLATES store color as [r,g,b] + alpha (paper.js css() is private)
  ctx.fillStyle = `rgba(${t.c[0]},${t.c[1]},${t.c[2]},${t.a ?? 1})`
  const k = cv.width / 2500 // doc-size letter width → thumb scale
  const w = cv.width, h = cv.height
  const lh = Math.max(1, Math.round(2 * k))
  if (t.kind === 'h') {
    for (let y = t.step * k; y < h; y += t.step * k) ctx.fillRect(0, Math.round(y - 1), w, lh)
  } else if (t.kind === 'grid') {
    for (let y = t.step * k; y < h; y += t.step * k) ctx.fillRect(0, Math.round(y - 1), w, lh)
    for (let x = t.step * k; x < w; x += t.step * k) ctx.fillRect(Math.round(x - 1), 0, lh, h)
  }
}

function buildPaperPalette() {
  const g = $('paperPalette')
  g.innerHTML = ''
  PEN_PALETTE.filter(c => c !== '#RAINBOW').forEach(c => {
    const b = document.createElement('button')
    b.className = 'ps'
    b.style.background = c
    b.dataset.color = c
    b.title = c
    b.onclick = () => applyPaperBg(c)
    g.append(b)
  })
  const rb = document.createElement('button')
  rb.className = 'ps rainbow'
  rb.title = 'Custom color'
  rb.onclick = () => $('paperBgPicker').click()
  g.append(rb)
  $('paperBgPicker').addEventListener('input', e => applyPaperBg(e.target.value))
}

function applyPaperBg(hex) {
  const page = current(); if (!page) return
  const h = String(hex).replace('#', '')
  page.paper.bg = '#FF' + h.slice(-6).toUpperCase()
  markPaperChanged(page)
  closeToolFlyout('paperColorFlyout')
}

// ---------- save flyout (Title / Project / Options / Save, mirrors 06-save) ----------
async function fillSaveFlyout() {
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  // automatic note naming: an unnamed note suggests today's date
  $('saveTitle').value = (S.note && S.note.name && S.note.name !== 'Untitled') ? S.note.name : iso
  $('saveProject').value = await currentProjectName()
}

async function currentProjectName() {
  if (!S.note || !S.note.parent) return ''
  try {
    const lib = await bridge.library()
    const f = (lib.items || []).find(i => i.id === S.note.parent && i.type === 'folder')
    return f ? f.name : ''
  } catch { return '' }
}

async function saveFromFlyout() {
  if (!S.noteId) return
  const title = $('saveTitle').value.trim()
  const project = $('saveProject').value.trim()
  if (title && S.note && title !== S.note.name) {
    const updated = await bridge.renameItem(S.noteId, title)
    S.note.name = updated && updated.name ? updated.name : title
    updateTitle()
  }
  const cur = await currentProjectName()
  if (project !== cur) {
    if (!project) {
      await bridge.moveItem(S.noteId, 1)
      if (S.note) S.note.parent = 1
    } else {
      const lib = await bridge.library()
      const f = (lib.items || []).find(i => i.type === 'folder' && i.parent === 1 && i.name.toLowerCase() === project.toLowerCase())
      const folder = f || await bridge.createFolder(project, 1)
      await bridge.moveItem(S.noteId, folder.id)
      if (S.note) S.note.parent = folder.id
    }
  }
  // hide the dialog before the async save reports "saved": the status text and
  // the flyout close otherwise race in UI tests and in real perceived latency
  closeToolFlyout('saveFlyout')
  await saveCurrentPage()
}

// ---------- export ----------
async function exportMenu() {
  const { pick } = await import('./ctx.js')
  const items = [
    { label: 'Page → PNG', act: () => exportImg('png') },
    { label: 'Page → JPEG', act: () => exportImg('jpg') },
    { label: 'Note → PDF (all pages)', act: () => exportPDF() },
    { label: 'Replay → GIF', act: () => exportGif() },
  ]
  pick(items, 300, 60)
}
async function exportImg(kind) {
  const page = current(); if (!page || !S.noteId) return
  const bytes = await flattenBytes(page, kind === 'png' ? 'image/png' : 'image/jpeg')
  const name = `${S.note.name}#${String(S.currentPage + 1).padStart(2, '0')}`
  await bridge.exportAs(bytes, name, kind)
}
async function exportPDF() {
  const bytes = []
  for (const page of S.pages) bytes.push(await flattenBytes(page, 'image/png'))
  const paper = current()?.paper || DEFAULT_PAPER()
  const sz = SIZES[paper.size] || SIZES.letter
  await bridge.exportPDF(bytes, { widthMM: paper.orientation === 'landscape' ? sz.h : sz.w, heightMM: paper.orientation === 'landscape' ? sz.w : sz.h, landscape: paper.orientation === 'landscape' })
}
async function exportGif() {
  const page = current(); if (!page || !S.noteId) return
  // sINK is encoded during save; persist first, then read the GIF back.
  let gifBytes = null
  if (page.recorder.frames.length) {
    await saveCurrentPage()
    const res = await bridge.loadNote(S.noteId)
    const p = res?.pages?.[S.currentPage]
    if (p?.inkGif) gifBytes = new Uint8Array(p.inkGif)
  } else if (page.inkGif) gifBytes = page.inkGif
  if (gifBytes) await bridge.exportAs(gifBytes, `${S.note.name}-replay`, 'gif')
}

// ---------- replay ----------
let replayStop = null
function toggleReplay() {
  if (replayStop) { replayStop(); replayStop = null; return }
  const page = current(); if (!page) return
  const viewport = $('viewport')
  replayStop = playReplay(viewport, page, () => { replayStop = null })
}

// ---------- title / rename ----------
function updateTitle() {
  const name = S.note ? S.note.name : 'No note'
  const pages = ` (${S.currentPage + 1}/${S.pages.length})`
  $('btnTitle').textContent = name
  const pagesEl = document.getElementById('tbPages')
  if (pagesEl) pagesEl.textContent = pages
  document.title = `${name}${pages} ‎- WriteCanvas`
  const cap = document.getElementById('capTitle')
  if (cap) cap.textContent = document.title
}

async function renameOpenNote() {
  if (!S.note) return
  const { promptText } = await import('./ctx.js')
  const name = await promptText('Note title', S.note.name)
  if (!name || name === S.note.name) return
  try {
    const updated = await bridge.renameItem(S.noteId, name)
    // library may append " 2" when the sanitized title is already in use
    S.note.name = updated && updated.name ? updated.name : name
    updateTitle()
    if (S.note.name !== name) showHint(`Renamed to "${S.note.name}" — that title was already in use`)
  } catch (err) {
    console.error(err)
    showHint('Rename failed — the note was not changed')
  }
}

// ---------- init / events ----------
export function init(app) {
  host = app
  el = {
    canvasHost: $('canvasHost'), stack: $('canvasStack'), inner: $('stackInner'),
  }

  // pen flyout: 5 pen-type buttons + the 6×5 factory palette + wave preview
  const typeRow = $('penTypeRow')
  PEN_TYPE_ORDER.forEach(t => {
    const b = document.createElement('button')
    b.className = 'penType'
    b.dataset.type = t
    b.title = PEN_TYPES[t].label
    b.innerHTML = `<svg><use href="#pt-${t}"/></svg>`
    b.onclick = () => { curPen().type = t; syncPenFlyout(); closeToolFlyout('penFlyout') }
    typeRow.append(b)
  })
  const pgrid = $('penPalette')
  PEN_PALETTE.forEach(c => {
    const b = document.createElement('button')
    if (c === '#RAINBOW') {
      b.className = 'ps rainbow'
      b.title = 'Custom color'
      // custom: keep the flyout open so the user can iterate
      b.onclick = () => $('colorPicker').click()
    } else {
      b.className = 'ps'
      b.style.background = c
      b.dataset.color = c
      b.title = c
      b.onclick = () => { selectColor(c); closeToolFlyout('penFlyout') }
    }
    pgrid.append(b)
  })
  $('colorPicker').addEventListener('input', e => selectColor(e.target.value))
  $('width').addEventListener('input', e => {
    curPen().widthMM = parseFloat(e.target.value)
    updateWidthFill()
    drawWave()
  })
  loadPens()
  // restore the saved active pen *after* loading slots; the old order called
  // selectColor() first, whose savePens() overwrote the saved slots on every
  // launch, resetting the user's pens to factory defaults
  selectColor(curPen().color)
  syncToolButtons()
  renderPenStack()
  syncPenFlyout()
  buildPaperThumbs()
  buildPaperPalette()
  syncPaperPanel()
  buildShapeGrid()
  wireTextTool()

  $('btnMenu').onclick = () => toggleLibraryFlyout()
  $('btnSave').onclick = () => { fillSaveFlyout(); openToolFlyout('saveFlyout', $('btnSave')) }
  $('btnUndo').onclick = undo
  $('btnRedo').onclick = redo
  $('btnTitle').onclick = renameOpenNote
  $('btnNew').onclick = () => host && host.cmdNewNote && host.cmdNewNote()
  $('btnPaper').onclick = () => togglePaperPanel()
  $('btnExport').onclick = exportMenu
  $('btnSaveConfirm').onclick = saveFromFlyout
  $('saveTitleClear').onclick = () => { $('saveTitle').value = ''; $('saveTitle').focus() }
  $('paperBrl').addEventListener('change', applyBorderLines)
  $('ppPortrait').onclick = () => applyOrientation('portrait')
  $('ppLandscape').onclick = () => applyOrientation('landscape')
  $('ppBgColor').onclick = () => openToolFlyout('paperColorFlyout', $('ppBgColor'))
  $('ppPaneOn').onclick = () => setWritingPane(true)
  $('ppPaneOff').onclick = () => setWritingPane(false)
  $('btnAddPage').onclick = addPage
  wireToolbarToggles()

  // pointer + wheel
  const inner = $('stackInner')
  inner.addEventListener('pointerdown', onPointerDown)
  inner.addEventListener('pointermove', onPointerMove)
  inner.addEventListener('pointerup', onPointerUp)
  inner.addEventListener('pointercancel', onPointerUp)
  inner.addEventListener('contextmenu', e => e.preventDefault())
  $('canvasHost').addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15) }
  }, { passive: false })

  window.addEventListener('keydown', e => {
    const typing = isTextEditing()
    if (e.code === 'Space' && !e.repeat && !typing) {
      S.spaceDown = true
      stackInnerClass()
    }
    const c = e.ctrlKey || e.metaKey
    // inside a text box, Ctrl+Z/Y must undo the text, not the canvas ink
    if (c && !typing && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
    if (c && !typing && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo() }
    if (c && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrentPage() }
    if (c && !typing && e.key.toLowerCase() === 'e') { e.preventDefault(); exportMenu() }
    if (c && e.key.toLowerCase() === 'n' && e.shiftKey) { /* menu: new folder */ }
    // tool shortcuts (factory parity): V laser, E eraser, R ruler,
    // G shapes&text flyout, T text box, Escape dismiss overlays
    if (!c && !e.repeat && !typing) {
      const k = e.key.toLowerCase()
      if (k === 'v') { e.preventDefault(); setTool(S.tool === 'laser' ? 'pen' : 'laser') }
      else if (k === 'e') { e.preventDefault(); setTool(S.tool === 'erase' ? 'pen' : 'erase') }
      else if (k === 'r') { e.preventDefault(); toggleRuler() }
      else if (k === 'g') { e.preventDefault(); setTool('pen'); openToolFlyout('shapeFlyout', $('tbObject')) }
      else if (k === 't') { e.preventDefault(); startTextTool() }
      else if (k === 'escape') {
        for (const f of ['shapeFlyout', 'eraserFlyout', 'penFlyout', 'saveFlyout']) closeToolFlyout(f)
        if (libCloser) toggleLibraryFlyout()
        $('paperPanel').classList.add('hidden')
        clearSelection()
      }
    }
  })
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') { S.spaceDown = false; stackInnerClass() }
  })
  window.addEventListener('blur', () => {
    const page = current()
    if (page && page.dirty) saveCurrentPage()
  })

  // host menu commands
  bridge && bridge.on && bridge.on('cmd', (cmd, arg) => {
    switch (cmd) {
      case 'flush-close':
        // main intercepts window close and waits for this handshake; an async
        // beforeunload save never finishes before the renderer is destroyed
        flushCurrentPage().then(ok => {
          if (ok) { if (bridge.closeReady) bridge.closeReady() }
          else showHint('Save failed — close cancelled. Check the library folder.')
        })
        break
      case 'save': saveCurrentPage(); break
      case 'export': exportMenu(); break
      case 'new-note': app.cmdNewNote(); break
      case 'new-folder': app.cmdNewFolder(); break
      case 'import': app.cmdImport(); break
      case 'reveal-library': bridge.revealLibraryFolder(); break
      case 'zoom': app.cmdZoom(arg); break
    }
  })
  app.cmdZoom = arg => {
    if (arg && arg.reset) { S.zoom = 1; S.hadZoom = true; applyTransform(); return }
    zoomCenter(arg && arg.dir ? arg.dir : 1)
  }
}

function stackInnerClass() {
  $('stackInner').classList.toggle('panning', S.spaceDown || S.tool === 'view')
}

function isTextEditing() {
  const a = document.activeElement
  if (!a) return false
  return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable
}

export function selectColor(c) {
  curPen().color = c
  document.querySelectorAll('.ps').forEach(s => s.classList.toggle('sel', s.dataset.color === c))
  $('colorPicker').value = hexToCss(c, '#000000')
  const circ = document.getElementById('curColorCircle')
  const dot = document.getElementById('curDot')
  if (circ) circ.style.background = c
  if (dot) dot.style.background = c
  drawWave()
  savePens()
}

// ---------- toolbar pen stack — 10 factory slots as in the original app ----------
function renderPenStack() {
  const stack = $('tbPens')
  if (!stack) return
  stack.innerHTML = ''
  S.penSlots.forEach((pen, i) => {
    const b = document.createElement('button')
    const t = PEN_TYPES[pen.type] || PEN_TYPES.marker
    const sel = i === S.penIndex && S.tool === 'pen' && !S.flyoutOpenTool
    b.className = 'tb-penslot' + (sel ? ' sel' : '')
    b.setAttribute('role', 'option')
    b.title = `${t.label} — ${pen.widthMM.toFixed(1)}mm`
    b.setAttribute('aria-label', `Pen ${i + 1}: ${t.label} ${pen.widthMM.toFixed(1)}mm`)
    if (sel) {
      // original: the selected slot is a filled circle in the pen's own color
      // (12-s.png: marker-black slot = black circle, white glyph); light pens
      // flip the glyph dark for contrast
      b.style.background = pen.color
      b.style.color = colorLuma(pen.color) > 0.55 ? '#1a1a1a' : '#fff'
      b.innerHTML = `<svg><use href="#pt-${pen.type || 'marker'}"/></svg>`
    } else {
      const d = Math.round(Math.max(8, Math.min(37, pen.widthMM * 10.1)))
      b.innerHTML = `<span class="dot" style="width:${d}px;height:${d}px;background:${pen.color}"></span>`
    }
    b.onclick = () => onSelectPenSlot(i)
    stack.appendChild(b)
  })
}

function colorLuma(hex) {
  const h = String(hex || '#000000').replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0')
  const r = parseInt(full.slice(0, 2), 16) || 0
  const g = parseInt(full.slice(2, 4), 16) || 0
  const b = parseInt(full.slice(4, 6), 16) || 0
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function onSelectPenSlot(i) {
  if (S.penIndex === i && S.tool === 'pen') {
    // re-click the selected slot: toggle its config flyout (UWP behavior)
    openToolFlyout('penFlyout', $('tbPens').children[i], { centered: true })
    return
  }
  S.penIndex = i
  setTool('pen')
  syncPenFlyout()
  openToolFlyout('penFlyout', $('tbPens').children[i], { centered: true })
  savePens()
}

function syncToolButtons() {
  const map = { erase: 'tbEraser', laser: 'tbLaser', lasso: 'tbLasso', view: 'tbEye' }
  for (const [tool, id] of Object.entries(map)) {
    const b = $(id)
    if (!b) continue
    const on = S.tool === tool
    b.classList.toggle('active', on)
    b.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
  const rulerBtn = $('tbRuler')
  if (rulerBtn) {
    const on = !!S.rulerOn
    rulerBtn.classList.toggle('active', on)
    rulerBtn.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
}

// toggles: laser/laso/eye switch the active tool, ruler toggles the ruler
// overlay, object opens the shapes&text flyout; eraser toggles the eraser tool
function wireToolbarToggles() {
  const eraserBtn = $('tbEraser')
  if (eraserBtn) eraserBtn.onclick = () => setTool(S.tool === 'erase' ? 'pen' : 'erase')
  const objBtn = $('tbObject')
  if (objBtn) objBtn.onclick = () => openToolFlyout('shapeFlyout', objBtn)
  $('tbLaser').onclick = () => setTool(S.tool === 'laser' ? 'pen' : 'laser')
  $('tbRuler').onclick = () => toggleRuler()
  $('tbLasso').onclick = () => setTool(S.tool === 'lasso' ? 'pen' : 'lasso')
  $('tbEye').onclick = () => setTool(S.tool === 'view' ? 'pen' : 'view')
  // caret hot-zones under the toggles open the tool flyouts (MoreArrow parity) —
  // only stop the event for zones whose flyout exists, so bare toggles keep
  // receiving their own click: laser/ruler flyouts are not built yet
  document.querySelectorAll('.caret-zone').forEach(z => {
    z.addEventListener('click', ev => {
      const b = z.closest('button')
      const fly = z.dataset.fly
      if (!fly || !$(fly) || !b) return
      ev.stopPropagation()
      if (fly === 'eraserFlyout') syncEraserFlyout()
      openToolFlyout(fly, b, { ignore: z })
    })
  })
  const est = $('erStroke'), esg = $('erSegment'), esh = $('erSheet')
  if (est) est.onclick = () => { S.eraserMode = 'stroke'; syncEraserFlyout() }
  if (esg) esg.onclick = () => { S.eraserMode = 'segment'; syncEraserFlyout() }
  if (esh) esh.onclick = () => { S.eraserMode = 'sheet'; syncEraserFlyout() }
  document.querySelectorAll('#erSizes .er-chip').forEach(ch => {
    ch.onclick = () => { S.eraserMM = parseFloat(ch.dataset.mm) || 5; syncEraserFlyout() }
  })
  syncEraserFlyout()
}

// the factory eraser modes (SetupFlyout copy: Stroke Eraser / Segment
// Eraser - Small/Medium/Large) — sheet eraser stands in for erase-all
function syncEraserFlyout() {
  const modes = { stroke: $('erStroke'), segment: $('erSegment'), sheet: $('erSheet') }
  for (const [k, b] of Object.entries(modes)) {
    b.classList.toggle('active', S.eraserMode === k)
    b.setAttribute('aria-pressed', S.eraserMode === k ? 'true' : 'false')
  }
  $('erSizeRow').classList.toggle('hidden', S.eraserMode !== 'segment')
  document.querySelectorAll('#erSizes .er-chip').forEach(ch => {
    ch.classList.toggle('active', Math.abs(parseFloat(ch.dataset.mm) - S.eraserMM) < 0.01)
  })
  drawEraserPreview()
}

// ---------- pen flyout sync / wave preview ----------
function syncPenFlyout() {
  const pen = curPen()
  document.querySelectorAll('#penTypeRow .penType').forEach(b => {
    const on = b.dataset.type === pen.type
    b.classList.toggle('active', on)
    b.setAttribute('aria-pressed', on ? 'true' : 'false')
  })
  document.querySelectorAll('#penPalette .ps').forEach(s => s.classList.toggle('sel', s.dataset.color === pen.color))
  $('colorPicker').value = hexToCss(pen.color, '#000000')
  if (Math.abs(parseFloat($('width').value) - pen.widthMM) > 0.01) $('width').value = pen.widthMM
  updateWidthFill()
  const circ = document.getElementById('curColorCircle')
  const dot = document.getElementById('curDot')
  if (circ) circ.style.background = pen.color
  if (dot) dot.style.background = pen.color
  drawWave()
}

// slider filled-portion variable for the WinUI-style range track
function updateRangeFill(el, min, max) {
  if (!el) return
  const v = parseFloat(el.value) || min
  el.style.setProperty('--fill', ((v - min) / (max - min) * 100).toFixed(1) + '%')
}

function updateWidthFill() { updateRangeFill($('width'), 0.5, 12) }

// the size-preview wave: a fixed s-curve stroked by the current pen through
// the real think engine, so it reacts to type/color/width like the original
function drawWave() {
  const cv = $('wavePreview')
  if (!cv) return
  const ctx = cv.getContext('2d')
  ctx.clearRect(0, 0, cv.width, cv.height)
  const cur = curPen()
  const pts = []
  for (let px = 6; px <= cv.width - 6; px += 2) {
    const t = (px - 6) / (cv.width - 12)
    const y = cv.height * 0.55 + Math.sin(t * Math.PI * 2 - 0.7) * cv.height * 0.22 - t * 5
    pts.push({ x: px, y, p: 0.72 + 0.28 * Math.sin(t * Math.PI) })
  }
  const mid = PEN_TYPES[cur.type] ? PEN_TYPES[cur.type].alpha : 1
  drawStrokeAlpha(ctx, cv.width, cv.height, {
    type: cur.type === 'pencil' ? 'pencil' : 'marker',
    color: cur.color,
    opacity: cur.opacity !== undefined ? cur.opacity : mid,
    // the original previews a thin hairline wave scaled by the pen's width
    width: clamp(cur.widthMM * 3.2, 2.6, 46),
    pts,
  })
}

function loadPens() {
  try {
    const raw = localStorage.getItem('wc:pens')
    if (!raw) return
    const d = JSON.parse(raw)
    const arr = Array.isArray(d) ? d : d.slots
    if (Array.isArray(arr) && arr.length === 10) {
      S.penSlots = arr.map(p => ({ type: p && p.type || 'marker', color: p && p.color || '#000000', widthMM: +p.widthMM || 1.06, opacity: p && p.opacity }))
      if (!Array.isArray(d)) S.penIndex = clamp(+d.index || 0, 0, 9)
    }
  } catch { /* corrupted state — keep factory slots */ }
}

function savePens() {
  try { localStorage.setItem('wc:pens', JSON.stringify({ slots: S.penSlots, index: S.penIndex })) } catch { /* ignore */ }
}
