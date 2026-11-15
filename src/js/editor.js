// Editor: canvas stack, tools, undo/redo, pages, save/export, replay.

import { bridge } from './bridge.js'
import { SIZES, paperDocSize, paperMM, renderPaper, docMM, hexToCss, templatePathFor, TEMPLATES } from './paper.js'
import { makeStroke, addPoint, drawStrokeAlpha, createStrokeStamper, paintStamps, strokeIntersectsCircle, PEN_TYPES, PEN_TYPE_ORDER, PEN_PALETTE, QUICK_PALETTE, DEFAULT_PEN_SLOTS } from './pen.js'
import { clipLineToRect, lineSnapPoint, pointLineDistance, knobCenter, paintRulerStencil, paintProtractorStencil } from './ruler.js'
import { Recorder } from './replay.js'
import { applyShortcutHints, initShortcutSheet, openShortcutSheet, isShortcutSheetOpen, modShortcut, modAria } from './shortcuts.js'

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
  eraserMode: 'stroke',  // stroke / segment / sheet (whole-page)
  selectMode: 'lasso',   // lasso drag vs click a stroke to select it
  shapeKind: null,       // selected gallery shape; next drag on the page creates it
  shapeFill: false,
  rulerOn: false,
  rulerMode: 'ruler',    // ruler / protractor — the RulerFlyout's remembered pick
  selection: null,
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
let scratchUsed = null // doc-px rect the mask currently holds, for cheap clears
const DEFAULT_PAPER = () => ({ size: 'letter', orientation: 'portrait', template: 'ruled', bg: '#FFFFFFFF', borderLines: true })
// Muted board colours: paper-like lights and pad.ws/Excalidraw-like darks.
const BOARD_PALETTE = [
  '#FFFFFF', '#FBF8F1', '#F3F6FA', '#E8F0F8', '#F7E9E7', '#EAF4EA',
  '#FFF5D6', '#15181D', '#1C2128', '#232833', '#2B303A', '#101820',
  '#1A2430', '#22201C', '#3A3F4A', '#5A6270', '#8A94A6', '#C9D1DB',
]
const COLOR_NAMES = {
  '#000000': 'Black', '#FFFFFF': 'White', '#FF0000': 'Red', '#004DE6': 'Blue',
  '#26E600': 'Green', '#FFFB0A': 'Yellow', '#2EF0FF': 'Cyan', '#FFE600': 'Gold',
  '#FF5500': 'Orange', '#B31564': 'Magenta', '#3D00B8': 'Violet', '#6600CC': 'Purple',
  '#008055': 'Emerald', '#A2E61B': 'Lime', '#F7D7C4': 'Blush', '#BB9167': 'Tan',
  '#8E562E': 'Brown', '#613D30': 'Cocoa', '#15181D': 'Midnight', '#1C2128': 'Graphite',
  '#232833': 'Slate', '#2B303A': 'Charcoal', '#101820': 'Ink', '#1A2430': 'Navy board',
}
const newPage = paper => ({ paper: { ...paper }, strokes: [], texts: [], rasterBitmap: null, undo: [], redo: [], dirty: false, recorder: new Recorder(), inkGif: null })
let host = null // App context, set by init()

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
// A note load replaces S.pages asynchronously. Until it finishes there is no
// valid page to edit/save, so interaction and saving wait for it.
let noteBusy = false
let loadPromise = Promise.resolve()
let noteLoadToken = 0

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

// The visible page is already split into paper/raster/ink layers. Composing
// those is much cheaper than replaying every stroke and paper pattern at full
// document resolution, which used to hitch on every autosave and thumbnail.
function compositeCurrentPage(page) {
  const { w, h } = docSize(page)
  const off = document.createElement('canvas')
  off.width = w; off.height = h
  const c = off.getContext('2d')
  for (const id of ['paperC', 'rasterC', 'inkC']) {
    const layer = $(id)
    if (layer) c.drawImage(layer, 0, 0)
  }
  return off
}

// Replay frames only need the screen-sized sheet, not a full-page flatten.
// Drawing the three live layers at replay resolution keeps pointer-up cheap,
// and the scratch canvas is reused so a stroke does not allocate a new one.
const replayScratch = document.createElement('canvas')
function captureReplay(page) {
  if (!page || !page.recorder) return
  const { w, h } = docSize(page)
  // Replay is a small preview, not a second copy of the page. 720 keeps the
  // GIF readable while cutting the per-stroke getImageData work by ~3x.
  const maxDim = 720
  const scale = Math.min(1, maxDim / Math.max(w, h))
  const fw = Math.max(1, Math.round(w * scale))
  const fh = Math.max(1, Math.round(h * scale))
  if (replayScratch.width !== fw || replayScratch.height !== fh) {
    replayScratch.width = fw; replayScratch.height = fh
  }
  const c = replayScratch.getContext('2d')
  c.clearRect(0, 0, fw, fh)
  if (page === current()) {
    for (const id of ['paperC', 'rasterC', 'inkC']) {
      const layer = $(id)
      if (layer) c.drawImage(layer, 0, 0, fw, fh)
    }
  } else {
    const flat = flattenToCanvas(page)
    c.drawImage(flat, 0, 0, fw, fh)
  }
  page.recorder.capture(replayScratch)
}

// The replay GIF is a preview of the note, not part of the stroke. Capturing
// it on the pointer-up frame meant a full-page readback between the pen
// leaving the glass and the ink appearing — the little hitch while writing.
// One capture per frame is enough for a GIF, so a burst of quick strokes
// coalesces and pen-up stays on the sheet.
const replayQueued = new WeakSet()
function scheduleReplayCapture(page) {
  if (!page || !page.recorder || replayQueued.has(page)) return
  replayQueued.add(page)
  requestAnimationFrame(() => {
    replayQueued.delete(page)
    captureReplay(page)
  })
}

async function flattenBytes(page, kind = 'image/png') {
  const off = page === current() ? compositeCurrentPage(page) : flattenToCanvas(page)
  const blob = await new Promise(r => off.toBlob(r, kind, kind === 'image/jpeg' ? 0.92 : undefined))
  return new Uint8Array(await blob.arrayBuffer())
}

// ---------- transform / zoom ----------
function applyTransform() {
  const page = current(); if (!page) return
  layoutStack()
  // HUD layers redraw so their counter-scaled chrome tracks the zoom
  if (S.rulerOn) redrawRuler()
  updateSelectionChrome(page)
  ensureVisibleStills()
}

// ---------- pull-to-add-page (last sheet only, Samsung-Notes parity) ----------
let wheelOverscroll = 0
let wheelAddLock = 0

function pullCommitLimit() {
  const host = $('canvasHost')
  return Math.max(96, host.clientHeight * 0.12)
}

function updatePullHint(over, mode = 'pull', action = 'add') {
  const bar = $('pullHint'); if (!bar) return
  if (!over || over <= 24) { bar.classList.add('hidden'); return }
  const commit = pullCommitLimit()
  const prev = action === 'prev'
  const next = action === 'next'
  bar.classList.remove('hidden')
  // Upward pulls show the hint at the top edge so the copy sits on the side the
  // page is moving toward; downward pulls keep the bottom pill.
  bar.classList.toggle('at-top', prev)
  const armed = over >= commit
  bar.classList.toggle('armed', armed)
  const fill = bar.querySelector('.pullFill')
  if (fill) fill.style.width = (Math.min(1, over / commit) * 100).toFixed(0) + '%'
  const text = bar.querySelector('.pullText')
  if (text) {
    text.textContent = armed
      ? (prev ? 'Release for previous page' : next ? 'Release for next page' : 'Release to add a page')
      : (mode === 'wheel'
          ? (prev ? 'Keep scrolling for previous page' : next ? 'Keep scrolling for next page' : 'Keep scrolling to add a page')
          : (prev ? 'Pull up for previous page' : next ? 'Pull down for next page' : 'Pull down to add a page'))
  }
}

function hidePullHint() {
  const bar = $('pullHint'); if (bar) bar.classList.add('hidden')
}

// ---------- continuous page stack ----------
// The whole note is laid out as a vertical run of sheets inside #canvasStack;
// the editable layers (#stackInner) float over the active sheet. Neighbours
// keep a rendered still, so scrolling across a page boundary shows the
// previous page's tail and the next page's head at once — one endless stack,
// the way the original app scrolls.
const PAGE_GAP = 16        // screen px between sheets
const STILL_MAX = 2000     // longest still edge in device px (memory bound)
let stackGeom = { tops: [], heights: [], width: 0, height: 0 }
let hostScrollRaf = 0
let scrollSyncLock = 0     // while a programmatic scroll is settling
const stillQueue = new Set()
let stillRaf = 0

function pageBox(i) { return $('pagesLayer')?.children[i] || null }

function syncPageBoxes() {
  const layer = $('pagesLayer'); if (!layer) return
  while (layer.children.length > S.pages.length) layer.lastElementChild.remove()
  for (let i = 0; i < S.pages.length; i++) {
    let box = layer.children[i]
    if (!box) {
      box = document.createElement('div')
      box.className = 'pageBox'
      layer.appendChild(box)
    }
    const page = S.pages[i]
    box.dataset.page = String(i)
    if (box._page !== page) {
      // indices shift on delete/duplicate; a box that no longer matches its
      // page drops its still rather than showing another sheet's ink
      box._page = page
      box.replaceChildren()
    }
    box.style.background = hexToCss(page.paper && page.paper.bg, '#FFFFFF')
  }
}

function stillSize(page) {
  const { w, h } = docSize(page)
  const scale = Math.min(1, STILL_MAX / Math.max(w, h))
  return { cw: Math.max(1, Math.round(w * scale)), ch: Math.max(1, Math.round(h * scale)) }
}

function stillCanvas(box) {
  let c = box.querySelector('canvas')
  if (!c) {
    c = document.createElement('canvas')
    c.setAttribute('aria-hidden', 'true')
    box.appendChild(c)
  }
  return c
}

// Render one page's still from its data (paper + raster base + strokes/texts).
function renderStill(i) {
  const page = S.pages[i]
  if (!page || i === S.currentPage) return
  const box = pageBox(i); if (!box) return
  const { w, h } = docSize(page)
  const { cw, ch } = stillSize(page)
  const c = stillCanvas(box)
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch }
  const g = c.getContext('2d')
  g.save()
  g.scale(cw / w, ch / h)
  renderPaper(g, page.paper)
  if (page.rasterBitmap) g.drawImage(page.rasterBitmap, 0, 0)
  for (const st of page.strokes) drawStrokeItem(g, w, h, st)
  if (page.texts) for (const t of page.texts) drawTextObj(g, t)
  g.restore()
  page.stillDirty = false
}

// Freeze the active page onto its still straight from the live layers — three
// scaled drawImages instead of replaying every stroke.
function captureStillFromLayers(i) {
  const page = S.pages[i]
  if (!page || i !== S.currentPage) return
  const box = pageBox(i); if (!box) return
  const { cw, ch } = stillSize(page)
  const c = stillCanvas(box)
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch }
  const g = c.getContext('2d')
  g.clearRect(0, 0, cw, ch)
  for (const id of ['paperC', 'rasterC', 'inkC']) {
    const layerEl = $(id)
    if (layerEl) g.drawImage(layerEl, 0, 0, cw, ch)
  }
  page.stillDirty = false
}

function queueStill(i) {
  if (i === S.currentPage || !S.pages[i]) return
  const box = pageBox(i)
  if (box && box.querySelector('canvas') && !S.pages[i].stillDirty) return
  stillQueue.add(i)
  pumpStills()
}

// One still per frame: rendering several full pages in one task would stall
// the scroll it is trying to keep up with.
function pumpStills() {
  if (stillRaf) return
  stillRaf = requestAnimationFrame(() => {
    stillRaf = 0
    const next = stillQueue.values().next().value
    if (next === undefined) return
    stillQueue.delete(next)
    renderStill(next)
    if (stillQueue.size) pumpStills()
  })
}

function ensureVisibleStills() {
  const host = $('canvasHost'); if (!host || !S.pages.length) return
  const pad = host.clientHeight
  const top = host.scrollTop - pad
  const bottom = host.scrollTop + host.clientHeight + pad
  const keep = new Set()
  for (let i = 0; i < stackGeom.tops.length; i++) {
    const t = stackGeom.tops[i], b = t + stackGeom.heights[i]
    if (b < top) continue
    if (t > bottom) break
    keep.add(i)
    queueStill(i)
  }
  // cache a small window around the active page; drop the rest so a long note
  // never accumulates full-page bitmaps
  for (let i = S.currentPage - 2; i <= S.currentPage + 2; i++) {
    if (i >= 0 && i < S.pages.length) keep.add(i)
  }
  const layer = $('pagesLayer'); if (!layer) return
  for (let i = 0; i < layer.children.length; i++) {
    if (keep.has(i) || i === S.currentPage) continue
    const c = layer.children[i].querySelector('canvas')
    if (c) c.remove()
  }
}

// Lay out the run of sheets (screen px) and park the editable layers over the
// active page. Called on every zoom change, page change and note open.
function layoutStack() {
  const stack = $('canvasStack'), inner = $('stackInner')
  if (!stack || !inner || !S.pages.length) return
  const z = S.zoom || 1
  const n = S.pages.length
  let y = 0, maxW = 1
  const tops = [], heights = [], sizes = []
  for (let i = 0; i < n; i++) {
    const { w, h } = docSize(S.pages[i])
    sizes.push({ w, h })
    tops.push(y)
    const hs = Math.max(1, Math.round(h * z))
    heights.push(hs)
    y += hs + PAGE_GAP
    maxW = Math.max(maxW, Math.round(w * z))
  }
  stackGeom = { tops, heights, width: maxW, height: Math.max(1, y - PAGE_GAP) }
  stack.style.width = maxW + 'px'
  stack.style.height = stackGeom.height + 'px'
  syncPageBoxes()
  for (let i = 0; i < n; i++) {
    const box = pageBox(i); if (!box) continue
    const wS = Math.round(sizes[i].w * z)
    box.style.left = Math.round((maxW - wS) / 2) + 'px'
    box.style.top = tops[i] + 'px'
    box.style.width = wS + 'px'
    box.style.height = heights[i] + 'px'
  }
  const page = current()
  if (page) {
    const { w, h } = docSize(page)
    const wS = Math.round(w * z)
    inner.style.width = w + 'px'
    inner.style.height = h + 'px'
    inner.style.left = Math.round((maxW - wS) / 2) + 'px'
    inner.style.top = tops[S.currentPage] + 'px'
    inner.style.transform = `scale(${z})`
  }
}

function scrollPageIntoView(i, smooth = false) {
  const host = $('canvasHost'); if (!host) return
  const top = Math.max(0, (stackGeom.tops[i] || 0) - 14)
  // suppress the centre-based page switch while the animation is in flight,
  // or a rail jump to page 10 would flip through every sheet on the way
  scrollSyncLock = performance.now() + (smooth ? 900 : 120)
  if (smooth && typeof host.scrollTo === 'function') host.scrollTo({ top, behavior: 'smooth' })
  else host.scrollTop = top
}

function onHostScroll() {
  if (hostScrollRaf) return
  hostScrollRaf = requestAnimationFrame(() => { hostScrollRaf = 0; afterScroll() })
}

// Keep the active page and the visible stills in step with the scrollport.
function afterScroll() {
  ensureVisibleStills()
  const host = $('canvasHost')
  if (!host || !S.pages.length || noteBusy) return
  if (performance.now() < scrollSyncLock) return
  const mid = host.scrollTop + host.clientHeight / 2
  let idx = -1
  for (let i = 0; i < stackGeom.tops.length; i++) {
    const t = stackGeom.tops[i]
    if (mid >= t && mid < t + stackGeom.heights[i]) { idx = i; break }
  }
  if (idx >= 0 && idx !== S.currentPage) setPage(idx, false, { keepScroll: true })
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
    if (S.rulerOn) { ensureRulerVisible(); redrawRuler() }
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
  return docPoint(e, rect, scale)
}

// Screen point -> document point against an already-read stack rect. A stroke
// reads the rect once per event and reuses it for every coalesced sample, so
// a burst of pen samples never costs a burst of layout reads.
function docPoint(ev, rect, scale) {
  return { x: (ev.clientX - rect.left) / scale, y: (ev.clientY - rect.top) / scale }
}

// Every raw pen sample the OS collected between two frames. Chromium folds
// them into one pointermove; without reading them back a fast stroke is drawn
// from a chord per frame and visibly kinks ("khựng"). Synthetic events and
// platforms without the API fall back to the event itself.
function coalescedSamples(e) {
  try {
    const raw = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null
    if (raw && raw.length) return raw
  } catch { /* synthetic/test events */ }
  return [e]
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
  queuePreCapture(page)
}

// The replay GIF's "before" frame belongs to the clean page, not to the first
// stroke. Taking it here — a moment after the page is on screen — keeps the
// full-page readback out of the first pen-up, where it used to sit between the
// pen leaving the glass and the ink appearing. The composited layers it reads
// exclude liveC, so even if a stroke starts first the frame is still the
// committed page. firstCommitPreCapture stays as the fallback.
let preCaptureTimer = 0
let preCapturePage = null
function queuePreCapture(page) {
  if (!page || !page.recorder || page.recorder.frames.length || page.recorder.changed) return
  preCapturePage = page
  clearTimeout(preCaptureTimer)
  preCaptureTimer = setTimeout(() => {
    preCaptureTimer = 0
    if (preCapturePage !== page || page !== current()) return
    firstCommitPreCapture(page)
  }, 140)
}

export async function openNote(id) {
  // Two opens must never interleave page arrays. Wait out the active load,
  // then re-check whether this note is already on screen.
  if (noteBusy) await loadPromise.catch(() => { })
  // clicking the already-open note must not reload from disk and throw away
  // the in-memory page that is still inside the autosave debounce window
  if (S.noteId === id && S.note && !noteBusy) return
  const seq = ++openSeq
  // an in-progress text box belongs to the outgoing note
  if (textEdit) finishText(false)
  // A live gesture must not survive the switch: its page array is about to be
  // replaced and the stroke would otherwise commit into the incoming note.
  cancelGesture()
  activePointer = null
  noteBusy = true
  const token = ++noteLoadToken
  if (S.noteId && S.noteId !== id) {
    // noteBusy is already set so no pointer can start a new gesture while the
    // outgoing note is flushed; skip flush's own wait for loadPromise.
    const ok = await flushCurrentPage({ internal: true })
    if (seq !== openSeq) return
    if (!ok) {
      if (token === noteLoadToken) noteBusy = false
      setSaveState('err'); showHint('Save failed — note not switched'); return
    }
  }
  const run = (async () => {
    try {
      let res = null
      try { res = await bridge.loadNote(id) } catch (err) { console.error('loadNote failed', err) }
      if (seq !== openSeq || token !== noteLoadToken) return
      if (!res || !res.pages || !res.pages.length) { showHint('Could not open note'); return }
      disposePages()
      thumbQueue.clear()
      S.noteId = id
      orphanNoteId = null
      S.note = { ...res.note }
      // -1 (not the outgoing note's index) so setPage treats this as a fresh
      // switch and never saves/scrolls the wrong sheet.
      S.currentPage = -1
      S.pages = res.pages.map((p) => {
        const meta = p.paperMeta
        const paper = meta
          ? { size: meta.size, orientation: meta.orientation, template: meta.template, bg: meta.bgColor || '#FFFFFFFF', borderLines: meta.borderLines !== false }
          : (S.note.paper ? { ...S.note.paper } : DEFAULT_PAPER())
        const page = newPage(paper)
        page.file = p.file
        page.loadError = !!p.loadError
        if (p.paperMeta) page.importedChunks = true
        // vector restore: a page saved by us reopens fully editable (strokes +
        // texts); legacy/imported-only pages fall back to the raster base
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
      // Dark mode is chrome-only: a white sheet stays white when the interface
      // theme changes. Board colour is explicit page data.
      if (res.pages.some(p => p.loadError)) {
        showHint('Some pages could not be read — they will not be overwritten')
      }
      try { localStorage.setItem('wc:lastNote', String(id)) } catch { /* storage unavailable */ }
      if (host && host.selectNote) host.selectNote(id)
      S.hadZoom = false
      S.zoom = 1
      wheelOverscroll = 0
      hidePullHint()
      setPage(0, true)
      // the rail may still show the previous note when both have the same
      // page count; force a rebuild with this note's sheets
      refreshPages()
      // decode the clean raster base per page. Pages that only restored their
      // vectors have nothing to decode; imported pages keep their image.
      for (let i = 0; i < res.pages.length; i++) {
        // another note was opened while we were decoding: never write this
        // note's bitmap into the new note's page array
        if (seq !== openSeq || token !== noteLoadToken || S.noteId !== id) return
        const p = res.pages[i]
        if (p.inkGif) S.pages[i].inkGif = p.inkGif
        const rasterBytes = p.rasterBase || p.bytes
        if (!p.exists || !rasterBytes) continue
        try {
          const blob = new Blob([rasterBytes], { type: 'image/png' })
          const bmp = await createImageBitmap(blob)
          if (seq !== openSeq || token !== noteLoadToken || S.noteId !== id) {
            if (bmp.close) bmp.close()
            return
          }
          S.pages[i].rasterBitmap = bmp
          if (i === S.currentPage) {
            renderPage(S.pages[i])
            refreshThumbOf(S.pages[i])
          } else {
            // drop the thumbnail cached before the base decoded; the rail
            // redraws it through the queue, one page per frame
            S.pages[i].stillDirty = true
            queueStill(i)
            S.pages[i].thumbUrl = ''
            thumbQueue.add(i)
            pumpThumbs()
          }
        } catch (err) { console.error('decode page failed', err) }
      }
      if (seq !== openSeq || token !== noteLoadToken || S.noteId !== id) return
    } finally {
      if (token === noteLoadToken) noteBusy = false
    }
  })()
  loadPromise = run
  await run
}

// Clear the editor when the open note is deleted. Leaving S.noteId pointing at
// a removed note made the next openNote() try to flush a file that no longer
// exists, so the app refused to switch notes.
export function closeNote() {
  // invalidate any in-flight load so it cannot repopulate the cleared editor
  openSeq++
  noteLoadToken++
  noteBusy = false
  loadPromise = Promise.resolve()
  cancelTextEdit()
  activePointer = null
  cancelGesture()
  clearTimeout(autosaveTimer)
  autosaveTimer = null
  clearTimeout(retryTimer)
  retryTimer = null
  clearTimeout(thumbTimer)
  thumbTimer = 0
  if (stillRaf) { cancelAnimationFrame(stillRaf); stillRaf = 0 }
  if (thumbQueueRaf) { cancelAnimationFrame(thumbQueueRaf); thumbQueueRaf = 0 }
  thumbQueue.clear()
  disposePages()
  clearSelection()
  S.noteId = null
  orphanNoteId = null
  S.note = null
  S.pages = []
  S.currentPage = -1
  wheelOverscroll = 0
  hidePullHint()
  stillQueue.clear()
  stackGeom = { tops: [], heights: [], width: 0, height: 0 }
  const pagesLayer = $('pagesLayer')
  if (pagesLayer) pagesLayer.replaceChildren()
  const canvasStack = $('canvasStack')
  if (canvasStack) { canvasStack.style.width = '0px'; canvasStack.style.height = '0px' }
  const host = $('canvasHost')
  if (host) { host.scrollTop = 0; host.scrollLeft = 0 }
  for (const id of ['paperC', 'rasterC', 'inkC', 'liveC', 'laserC', 'rulerC']) {
    const c = $(id)
    const ctx = c && c.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, c.width, c.height)
  }
  const bar = $('pagesBar')
  if (bar) bar.innerHTML = ''
  setSaveState('idle')
  updateTitle()
  syncPageNav()
  syncUndoRedo()
}

function sanitizePage() {
  // Persist the outgoing page (and anything else still pending) in the
  // background; switching sheets must not wait on the disk.
  const out = S.pages[S.currentPage]
  if (out && (out.dirty || out.recorder.changed)) saveCurrentPage()
}

// Switching sheets: the outgoing page freezes onto its still (so it stays
// visible above/below), the editable layers move to the incoming one, and the
// scroll position either follows it (rail, buttons) or is left untouched
// (scrolling across a boundary made the page active on its own).
function setPage(i, internal = false, { keepScroll = false, smooth = false } = {}) {
  if (!S.noteId || !S.pages.length || i < 0 || i >= S.pages.length) return
  // A note load owns the page array until it finishes; only the load itself
  // may select a page. Clicks and shortcuts during that window are dropped.
  if (noteBusy && !internal) return
  // Re-selecting the current row must not scroll back to the top of the page.
  if (i === S.currentPage) return
  if (!internal && textEdit) finishText(false)
  cancelGesture()
  wheelOverscroll = 0
  hidePullHint()
  const prevPage = S.currentPage
  const oldPage = current()
  if (oldPage) {
    captureStillFromLayers(prevPage)
    // The outgoing thumbnail must not wait on the debounce once the page
    // leaves the screen; draw it while the layers still show this sheet.
    flushThumbRefresh()
    sanitizePage()
  }
  clearSelection()
  S.currentPage = i
  const page = current()
  renderPage(page)
  if (!S.hadZoom) fitZoom()
  layoutStack()
  if (S.rulerOn) { ensureRulerVisible(); drawRulerLayer(current()) }
  syncPageRail()
  updateTitle()
  syncUndoRedo()
  if (!keepScroll) scrollPageIntoView(i, smooth)
  ensureVisibleStills()
}

function addPage() {
  // No note open means there is nothing to add a sheet to. Without this guard
  // the rail "+" created phantom pages under a "No note" title.
  if (!S.noteId || noteBusy) return
  const page = current()
  const paper = page ? { ...page.paper } : DEFAULT_PAPER()
  const added = newPage(paper)
  // A blank page is still a change: it has to reach index.json and get its own
  // PNG, otherwise reopening the note silently drops the sheet.
  added.dirty = true
  S.pages.push(added)
  setPage(S.pages.length - 1, false, { smooth: true })
  scheduleAutosave()
}

// ---------- pages rail (left, like the original app) ----------
function refreshPages() {
  const bar = $('pagesBar')
  bar.innerHTML = ''
  S.pages.forEach((_, i) => {
    const item = document.createElement('div')
    item.className = 'pageItem' + (i === S.currentPage ? ' cur' : '')
    item.tabIndex = 0
    item.setAttribute('role', 'button')
    item.setAttribute('aria-label', `Page ${i + 1}`)
    if (i === S.currentPage) item.setAttribute('aria-current', 'page')
    const num = document.createElement('div')
    num.className = 'num'
    num.textContent = String(i + 1)
    const t = document.createElement('div')
    t.className = 'pageThumb'
    t.title = 'Page ' + (i + 1)
    item.append(num, t)
    item.onclick = () => setPage(i, false, { smooth: true })
    item.oncontextmenu = e => {
      e.preventDefault()
      item.focus()
      pageMenu(i, e.clientX, e.clientY)
    }
    item.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPage(i, false, { smooth: true }) }
      else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault()
        const r = item.getBoundingClientRect()
        pageMenu(i, r.left + 14, r.bottom - 8)
      }
    }
    bar.appendChild(item)
    scheduleThumb(t, i)
  })
  syncPageNav()
}

function syncPageNav() {
  const prev = $('btnPrevPage'), next = $('btnNextPage'), add = $('btnAddPage')
  if (prev) prev.disabled = S.currentPage <= 0
  if (next) next.disabled = S.currentPage < 0 || S.currentPage >= S.pages.length - 1
  if (add) add.disabled = !S.noteId
}

async function pageFromPayload(p) {
  const meta = p.paperMeta
  const paper = meta
    ? { size: meta.size, orientation: meta.orientation, template: meta.template, bg: meta.bgColor || '#FFFFFFFF', borderLines: meta.borderLines !== false }
    : (S.note && S.note.paper ? { ...S.note.paper } : DEFAULT_PAPER())
  const page = newPage(paper)
  page.file = p.file || null
  page.loadError = !!p.loadError
  if (p.paperMeta) page.importedChunks = true
  if (p.inkGif) page.inkGif = p.inkGif
  if (p.vecJson) {
    try {
      const v = JSON.parse(p.vecJson)
      if (v && Array.isArray(v.strokes)) {
        page.strokes = v.strokes.filter(validStroke)
        page.texts = Array.isArray(v.texts) ? v.texts.filter(validText) : []
      }
    } catch { /* raster fallback */ }
  }
  const rasterBytes = p.rasterBase || p.bytes
  if (rasterBytes) {
    try {
      page.rasterBitmap = await createImageBitmap(new Blob([rasterBytes], { type: 'image/png' }))
    } catch (err) {
      console.error('decode duplicated page failed', err)
    }
  }
  return page
}

async function duplicatePage(index) {
  const noteId = S.noteId
  const source = S.pages[index]
  if (!noteId || !source) return
  if (source.loadError) { showHint('Cannot duplicate an unreadable page'); return }
  // A pristine blank page has no file yet; make it pending so flushCurrentPage
  // gives main something to copy.
  if (!source.file) source.dirty = true
  const saved = await flushCurrentPage()
  if (!saved) { showHint('Duplicate cancelled — save failed'); return }
  if (S.noteId !== noteId) return
  try {
    const res = await bridge.duplicatePage(noteId, index)
    if (S.noteId !== noteId) return
    const payload = await bridge.loadPage(noteId, res.index)
    if (!payload || !payload.file) { showHint('Page copied to disk, but could not be opened'); return }
    const page = await pageFromPayload(payload)
    if (S.noteId !== noteId) {
      if (page.rasterBitmap && typeof page.rasterBitmap.close === 'function') page.rasterBitmap.close()
      return
    }
    S.pages.push(page)
    setPage(S.pages.length - 1, true, { smooth: true })
    showHint(`Page ${index + 1} duplicated`)
  } catch (err) {
    console.error('duplicate page failed', err)
    showHint(`Duplicate failed — ${err && err.message ? err.message : 'unknown error'}`)
  }
}

async function deletePageAt(index) {
  const noteId = S.noteId
  const page = S.pages[index]
  if (!noteId || !page) return
  if (S.pages.length <= 1) { showHint('A note needs at least one page'); return }
  const { askConfirm } = await import('./ctx.js')
  const confirmed = await askConfirm(`Delete page ${index + 1}? This cannot be undone.`)
  if (!confirmed) return
  const saved = await flushCurrentPage()
  if (!saved) { showHint('Delete cancelled — save failed'); return }
  if (S.noteId !== noteId) return
  try {
    const res = await bridge.deletePage(noteId, index)
    if (S.noteId !== noteId) return
    const currentIndex = S.currentPage
    // keep the reader's place inside the current sheet when an earlier page
    // disappears above it
    const host = $('canvasHost')
    const keepOffset = Math.max(0, (host ? host.scrollTop : 0) - ((stackGeom.tops[currentIndex] || 0)))
    if (page.rasterBitmap && typeof page.rasterBitmap.close === 'function') page.rasterBitmap.close()
    S.pages.splice(index, 1)
    if (res && Array.isArray(res.pages)) {
      for (let i = 0; i < S.pages.length; i++) {
        if (res.pages[i]) S.pages[i].file = res.pages[i].file || S.pages[i].file
      }
    }
    const removedCurrent = index === currentIndex
    if (index < currentIndex) S.currentPage = currentIndex - 1
    else if (removedCurrent) S.currentPage = Math.min(index, S.pages.length - 1)
    if (removedCurrent) {
      clearSelection()
      const nextPage = current()
      if (nextPage) renderPage(nextPage)
    }
    refreshPages()
    layoutStack()
    const keepTop = (stackGeom.tops[S.currentPage] || 0) + keepOffset
    if (host) host.scrollTop = Math.max(0, keepTop)
    ensureVisibleStills()
    updateTitle()
    syncPageNav()
    syncUndoRedo()
    showHint(`Page ${index + 1} deleted`)
  } catch (err) {
    console.error('delete page failed', err)
    showHint(`Delete failed — ${err && err.message ? err.message : 'unknown error'}`)
  }
}

async function pageMenu(index, x, y) {
  const page = S.pages[index]
  if (!page || !S.noteId) return
  const { pick } = await import('./ctx.js')
  const total = S.pages.length
  pick([
    { header: `Page ${index + 1}${index === S.currentPage ? ' · current' : ''}` },
    { label: 'Duplicate page', act: () => duplicatePage(index) },
    { label: `Export page ${index + 1} as PNG…`, act: () => exportImg('png', index) },
    '-',
    { label: 'Delete page…', danger: true, disabled: total <= 1, act: () => deletePageAt(index) },
  ], x, y)
}

// Only the selected row changes during a page switch. Rebuilding the whole rail
// (and re-flattening every page) was the main source of page-switch jank.
function syncPageRail() {
  const bar = $('pagesBar')
  if (!bar || bar.children.length !== S.pages.length) { refreshPages(); return }
  Array.from(bar.children).forEach((item, i) => {
    const on = i === S.currentPage
    item.classList.toggle('cur', on)
    if (on) item.setAttribute('aria-current', 'page')
    else item.removeAttribute('aria-current')
  })
  // Keep the active row visible when the rail is long and the page was changed
  // with Ctrl+PageUp/PageDown rather than by clicking it.
  bar.children[S.currentPage]?.scrollIntoView({ block: 'nearest' })
  syncPageNav()
}

function drawThumb(t, i) {
  if (!t) return
  const page = S.pages[i]
  if (!page) return
  const { w, h } = docSize(page)
  // The tile follows the sheet's real aspect ratio; a fixed 140×186 box both
  // cropped landscape pages and left the empty page invisible in dark mode.
  t.style.aspectRatio = `${w} / ${h}`
  const small = document.createElement('canvas')
  small.width = 176; small.height = Math.round(176 * h / w)
  const sc = small.getContext('2d')
  if (i === S.currentPage) {
    // The active page is already composed into these three layers; drawing them
    // into the 176px thumbnail is much cheaper than replaying every stroke.
    for (const id of ['paperC', 'rasterC', 'inkC']) {
      const layer = $(id)
      if (layer) sc.drawImage(layer, 0, 0, small.width, small.height)
    }
  } else if (page.thumbUrl) {
    // Reuse the cached thumbnail. It is refreshed whenever the page is edited
    // or before the page is left.
    t.style.backgroundImage = `url(${page.thumbUrl})`
    return
  } else if (!page.strokes.length && !(page.texts && page.texts.length) && !page.rasterBitmap) {
    // Blank sheet: paint the paper directly at tile resolution instead of
    // flattening a full 2500×3235 document for an empty page.
    sc.save()
    sc.scale(small.width / w, small.height / h)
    renderPaper(sc, page.paper)
    sc.restore()
  } else {
    const off = flattenToCanvas(page)
    sc.drawImage(off, 0, 0, small.width, small.height)
  }
  const url = small.toDataURL()
  page.thumbUrl = url
  t.style.backgroundImage = `url(${url})`
}

function refreshThumbOf(page) {
  const i = S.pages.indexOf(page)
  if (i < 0) return
  page.thumbUrl = ''
  const item = $('pagesBar')?.children[i]
  if (item) drawThumb(item.querySelector('.pageThumb'), i)
}

// The rail paints a paper-only tile at once and replays the ink for one page
// per frame: opening a long note used to flatten every page in one task, which
// blocked the first paint for seconds.
const thumbQueue = new Set()
let thumbQueueRaf = 0
function paintPaperThumb(t, page) {
  const { w, h } = docSize(page)
  t.style.aspectRatio = `${w} / ${h}`
  const small = document.createElement('canvas')
  small.width = 176; small.height = Math.round(176 * h / w)
  const sc = small.getContext('2d')
  sc.save(); sc.scale(small.width / w, small.height / h); renderPaper(sc, page.paper); sc.restore()
  t.style.backgroundImage = `url(${small.toDataURL()})`
}

function scheduleThumb(t, i) {
  const page = S.pages[i]
  if (!page || !t) return
  if (i === S.currentPage || page.thumbUrl) { drawThumb(t, i); return }
  paintPaperThumb(t, page)
  thumbQueue.add(i)
  pumpThumbs()
}

function pumpThumbs() {
  if (thumbQueueRaf) return
  thumbQueueRaf = requestAnimationFrame(() => {
    thumbQueueRaf = 0
    const next = thumbQueue.values().next().value
    if (next === undefined) return
    thumbQueue.delete(next)
    const item = $('pagesBar')?.children[next]
    if (item && S.pages[next]) drawThumb(item.querySelector('.pageThumb'), next)
    if (thumbQueue.size) pumpThumbs()
  })
}

let thumbTimer = 0
function refreshCurrentThumb() {
  syncUndoRedo()
  // Coalesce the thumbnail re-encode (a 176px PNG data-URL per call): rapid
  // strokes used to hitch on encoding one after every pointer-up.
  clearTimeout(thumbTimer)
  thumbTimer = setTimeout(drawCurrentThumb, 220)
}

function drawCurrentThumb() {
  thumbTimer = 0
  const bar = $('pagesBar')
  if (!bar || S.currentPage < 0) return
  const item = bar.children[S.currentPage]
  if (item) drawThumb(item.querySelector('.pageThumb'), S.currentPage)
}

function flushThumbRefresh() {
  if (!thumbTimer) return
  clearTimeout(thumbTimer)
  drawCurrentThumb()
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
let live = null // {stroke, stamper, page, snapMode} while a pen stroke is in flight
let pan = null
let erasePending = null
// Only one pointer may drive a gesture. A second finger used to clear the
// live layer and restart the stroke mid-draw (palm rejection parity).
let activePointer = null

let shapeDraft = null // {kind, fill, page, ax, ay, bx, by} while dragging a shape

function onPointerDown(e) {
  // While a note loads, S.pages still belongs to the outgoing note. Inking
  // then would edit pages that are discarded the moment the load completes.
  if (noteBusy) return
  // HUD chrome lives inside the canvas stack: clicking Duplicate/Delete/rotate
  // or the ruler controls must never start an ink stroke underneath it
  if (e.target.closest('button, input, textarea, select, a, [contenteditable="true"], #selBar, #rulerCtl, #textEditBar, #titleStrip')) return
  if (activePointer !== null) return
  const isPan = S.tool === 'pan' || S.tool === 'view' || S.spaceDown || e.button === 1
  // A press on a neighbouring sheet makes it the active page first, so the
  // stroke lands where the person aimed; pan keeps scrolling the stack instead.
  if (!isPan && !e.target.closest('#stackInner')) {
    const box = e.target.closest('.pageBox')
    const idx = box ? Number(box.dataset.page) : NaN
    if (Number.isInteger(idx) && idx !== S.currentPage && S.pages[idx]) {
      setPage(idx, false, { keepScroll: true })
    }
  }
  const page = current(); if (!page) return
  activePointer = e.pointerId
  const stack = $('stackInner')
  try { stack.setPointerCapture(e.pointerId) } catch { /* synthetic/test pointers */ }
  if (isPan) {
    const host = $('canvasHost')
    pan = { x: e.clientX, y: e.clientY, sl: host.scrollLeft, st: host.scrollTop }
    return
  }
  if (e.button !== 0 && e.pointerType === 'mouse') return
  let { x, y } = pageCoords(e)
  // On the stencil: the centre grip moves the ruler, the far handle rotates it
  if (S.rulerOn && rulerHandleHit(page, x, y)) { rulerStartMove(x, y); return }
  if (S.rulerOn && rulerRotateHit(page, x, y)) { rulerRotate = {}; return }
  // A stencil only takes a stroke that starts on its edge; pen strokes that
  // begin away from it stay free-hand (they used to snap from anywhere).
  let snapMode = null
  if (S.rulerOn && S.tool === 'pen') {
    if (S.rulerMode === 'protractor') {
      if (protractorWithinSnap(page, x, y)) { snapMode = 'arc'; ({ x, y } = protractorSnapPoint(page, x, y)) }
    } else if (rulerWithinSnap(page, x, y)) {
      snapMode = 'line'; ({ x, y } = rulerSnapPoint(x, y))
    }
  }
  const lc = ctxOf('liveC'); const { w, h } = docSize(page)
  lc.clearRect(0, 0, w, h)
  if (S.tool === 'shape') {
    if (!S.shapeKind) { showHint('Pick a shape first, then drag on the page'); return }
    shapeDraft = { kind: S.shapeKind, fill: !!S.shapeFill, page, ax: x, ay: y, bx: x, by: y }
    drawShapePreview()
    return
  }
  if (S.tool === 'pen') {
    // Every stroke starts from a clean mask. Clearing only the region the last
    // stroke painted avoids a full-page wipe per stroke; a size change still
    // falls back to a full clear.
    if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; scratchUsed = null }
    if (scratchUsed) {
      scratchCtx.clearRect(scratchUsed.x0, scratchUsed.y0, scratchUsed.x1 - scratchUsed.x0, scratchUsed.y1 - scratchUsed.y0)
      scratchUsed = null
    } else {
      scratchCtx.clearRect(0, 0, w, h)
    }
    live = { stroke: makeStroke(curPen(), docMM(curPen().widthMM)), page, snapMode, tailBox: null }
    live.stamper = createStrokeStamper(live.stroke)
    if (snapMode) { rulerSnapActive = true; redrawRuler() }
    if (addPoint(live.stroke, x, y, e.pressure, docMM(0.4))) drawLiveSlice(page)
  } else if (S.tool === 'text') {
    // Tapping an existing box with the Text tool edits it instead of stacking
    // a new one on top.
    const hit = textAt(page, x, y)
    if (hit) beginTextEdit(page, hit)
    else placeTextBox(page, x, y)
  } else if (S.tool === 'erase') {
    if (S.eraserMode === 'sheet') { eraseSheet(page); return }
    erasePending = { whole: [], pairs: [], mode: S.eraserMode }
    eraseAt(page, x, y)
  } else if (S.tool === 'lasso') {
    const sel = S.selection
    if (sel && page === sel.page && x >= sel.bbox.x - 12 && x <= sel.bbox.x + sel.bbox.w + 12 && y >= sel.bbox.y - 12 && y <= sel.bbox.y + sel.bbox.h + 12) {
      dragSel = { lx: x, ly: y, dx: 0, dy: 0, sx: x, sy: y, moved: false }
      return
    }
    lassoBegin(page, x, y)
  } else if (S.tool === 'laser') {
    laserAddPoint(page, x, y, true)
  }
}

function boxUnion(a, b) {
  if (!a) return b || null
  if (!b) return a
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }
}

function clampBox(b, w, h) {
  if (!b) return null
  const x0 = Math.max(0, b.x0 - 1), y0 = Math.max(0, b.y0 - 1)
  const x1 = Math.min(w, b.x1 + 1), y1 = Math.min(h, b.y1 + 1)
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null
}

function asXBox(b) {
  return b ? { x0: b.x0, y0: b.y0, x1: b.x0 + b.w, y1: b.y0 + b.h } : null
}

function strokeAlpha(stroke) {
  return stroke.opacity != null ? clamp(stroke.opacity, 0.02, 1)
    : (PEN_TYPES[stroke.type] || PEN_TYPES.marker).alpha
}

// Paint the in-flight stroke into the scratch mask and report the region that
// changed, in document pixels. Permanent stamps only append, the provisional
// tail is wiped and repainted inside its own region (with the mask restored
// underneath it), so the mask holds exactly the stamp set the committed stroke
// is built from — which is why lifting the pen changes nothing on screen.
function paintLiveStroke(page) {
  if (!live || !live.stamper) return null
  const stroke = live.stroke
  const { w, h } = docSize(page)
  if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; scratchUsed = null; live.tailBox = null }
  const batch = live.stamper.feed(false)
  if (!batch) return null
  if (batch.stable.length && batch.stableBox) paintStamps(scratchCtx, batch.stable, stroke.color)
  const stableBox = clampBox(asXBox(batch.stableBox), w, h)
  const tailBox = clampBox(boxUnion(live.tailBox, asXBox(batch.tailBox)), w, h)
  if (tailBox) {
    scratchCtx.clearRect(tailBox.x0, tailBox.y0, tailBox.x1 - tailBox.x0, tailBox.y1 - tailBox.y0)
    const cover = live.stamper.covers({ x0: tailBox.x0, y0: tailBox.y0, w: tailBox.x1 - tailBox.x0, h: tailBox.y1 - tailBox.y0 })
    // Both repaints are clipped to the wiped box: a stamp reaching past it
    // must not repaint (and so re-darken) the edge it painted in an earlier
    // frame, or the mask would hold values the composited slices never showed.
    if (cover.length) paintStamps(scratchCtx, cover, stroke.color, tailBox)
    if (batch.tail.length) paintStamps(scratchCtx, batch.tail, stroke.color, tailBox)
  }
  live.tailBox = asXBox(batch.tailBox)
  const box = boxUnion(stableBox, tailBox)
  if (box) scratchUsed = scratchUsed ? boxUnion(scratchUsed, box) : box
  return box
}

function drawLiveSlice(page) {
  const box = paintLiveStroke(page)
  if (!box) return
  const lc = ctxOf('liveC')
  // Composite exactly once at the pen's alpha — no within-stroke darkening
  lc.clearRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0)
  lc.globalAlpha = strokeAlpha(live.stroke)
  lc.drawImage(scratch, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0)
  lc.globalAlpha = 1
}

// Live slices are composited at most once per frame (rAF), never per raw
// sample: a 240 Hz pen would otherwise run the mask fill + composite several
// times between two frames and the compositor never gets a clean slot, which
// is what made fast strokes hitch. The stroke's points are already updated
// when this fires, so nothing is dropped — only the paint is coalesced.
let livePaintRaf = 0
function scheduleLivePaint() {
  if (livePaintRaf) return
  livePaintRaf = requestAnimationFrame(() => {
    livePaintRaf = 0
    if (live) drawLiveSlice(live.page)
  })
}
function cancelLivePaint() {
  if (!livePaintRaf) return
  cancelAnimationFrame(livePaintRaf)
  livePaintRaf = 0
}

// the factory eraser modes: 'stroke' removes touched strokes whole, 'segment'
// cuts the stroke where the eraser circle crosses (S/M/L via S.eraserMM),
// 'sheet' rubs the whole page out in one tap.
function eraseCursorR() {
  return docMM(S.eraserMode === 'segment' ? S.eraserMM : 4)
}

// Screen-space gesture threshold, converted to document units. A tap should
// keep working at fit-width zoom without a tiny pen jitter becoming a drag.
function gestureSlopDoc() {
  return 6 / (S.zoom || 1)
}

function paintEraserCursor(page, x, y, r = eraseCursorR()) {
  const lc = ctxOf('liveC')
  lc.clearRect(0, 0, docSize(page).w, docSize(page).h)
  lc.strokeStyle = '#f669'; lc.fillStyle = '#4d4d4d33'
  lc.beginPath(); lc.arc(x, y, r, 0, Math.PI * 2); lc.fill(); lc.stroke()
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
  const kept = [], whole = [], pairs = []
  for (const st of page.strokes) {
    if (!strokeIntersectsCircle(st, x, y, r)) { kept.push(st); continue }
    // A filled shape is solid ink: splitting its outline into fragments would
    // leave a hollow shell behind, so the segment eraser removes it whole.
    const solid = st.type === 'shape' && st.shape && st.shape.fill
    if (S.eraserMode === 'segment' && !solid) {
      const pieces = splitStrokeAroundCircle(st, x, y, r)
      if (pieces) { pairs.push([st, pieces]); kept.push(...pieces); continue }
    }
    whole.push(st)
  }
  if (!whole.length && !pairs.length) { paintEraserCursor(page, x, y, r); return }
  firstCommitPreCapture(page)
  page.strokes = kept
  if (!erasePending) erasePending = { whole: [], pairs: [], mode: S.eraserMode }
  erasePending.whole.push(...whole)
  erasePending.pairs.push(...pairs)
  redrawInk(page)
  paintEraserCursor(page, x, y, r)
}

function onPointerMove(e) {
  if (noteBusy) return
  if (activePointer !== null && e.pointerId !== activePointer) return
  const page = current(); if (!page) return
  if (pan) {
    const host = $('canvasHost')
    scrollSyncLock = 0 // dragging is manual scrolling; follow it at once
    host.scrollLeft = Math.max(0, Math.min(pan.sl - (e.clientX - pan.x), host.scrollWidth - host.clientWidth))
    const maxTop = Math.max(0, host.scrollHeight - host.clientHeight)
    host.scrollTop = Math.max(0, Math.min(pan.st - (e.clientY - pan.y), maxTop))
    return
  }
  // One layout read per event; every coalesced sample is measured against it.
  const inner = $('stackInner')
  const rect = inner.getBoundingClientRect()
  const scale = rect.width / inner.offsetWidth || 1
  let { x, y } = docPoint(e, rect, scale)
  if (rulerGrip) { rulerMoveUpdate(page, x, y); return }
  if (rulerRotate) { rulerRotateUpdate(page, x, y); return }
  if (shapeDraft) {
    shapeDraft.bx = x
    shapeDraft.by = y
    drawShapePreview()
    return
  }
  if (live) {
    // Feed every raw sample the OS produced since the last frame, not just
    // the one Chromium surfaced: a quick flick then draws its true curve
    // instead of two long chords per frame. Painting is frame-batched.
    let added = false
    for (const s of coalescedSamples(e)) {
      const p = s === e ? { x, y } : docPoint(s, rect, scale)
      let sx = p.x, sy = p.y
      if (live.snapMode === 'line') ({ x: sx, y: sy } = rulerSnapPoint(sx, sy))
      else if (live.snapMode === 'arc') ({ x: sx, y: sy } = protractorSnapPoint(page, sx, sy))
      if (addPoint(live.stroke, sx, sy, s.pressure, docMM(0.4))) added = true
    }
    if (added) scheduleLivePaint()
    return
  }
  if (erasePending) {
    eraseAt(page, x, y)
  } else if (lasso) {
    lassoAddPoint(x, y)
  } else if (dragSel) {
    const d = dragSel
    if (!d.moved) {
      const slop = gestureSlopDoc()
      if ((x - d.sx) ** 2 + (y - d.sy) ** 2 < slop * slop) return
      d.moved = true
    }
    d.dx += x - d.lx; d.dy += y - d.ly
    d.lx = x; d.ly = y
    drawSelectionPreview(page)
  } else if (laserLive) {
    for (const s of coalescedSamples(e)) {
      const p = s === e ? { x, y } : docPoint(s, rect, scale)
      laserAddPoint(page, p.x, p.y, false)
    }
  }
}

// Snapshot the pre-edit composite on the first edit after opening a page, so
// the replay GIF starts from the loaded state (imported base included).
function firstCommitPreCapture(page) {
  if (page.recorder && page.recorder.frames.length === 0 && !page.recorder.changed) {
    page.recorder.lastCapture = performance.now() - 600
    captureReplay(page)
  }
}

// ---------- laser pointer (temporary trail, never saved) ----------
// Marks accumulate for the whole annotation burst and stay put until the
// pointer rests. Then the group fades as one, so lifting the pen never erases
// the line you were just drawing. Timings follow tldraw's laser session model.
const LASER_IDLE_MS = 1200
const LASER_FADE_MS = 500
let laserLive = null // { pts, w } while the pointer is down
let laserSession = null // { strokes, lastAt, page }
let laserRAF = 0
// Finished strokes are rasterized once here; the visible layer then composites
// this single image plus the live beam instead of replaying every glow layer.
const laserBase = document.createElement('canvas')
const laserBaseCtx = laserBase.getContext('2d')

function laserClearBase() {
  laserBaseCtx.clearRect(0, 0, laserBase.width, laserBase.height)
}

function laserRenderBase() {
  const c = $('laserC'); if (!c) return
  if (laserBase.width !== c.width || laserBase.height !== c.height) {
    laserBase.width = c.width
    laserBase.height = c.height
  }
  laserClearBase()
  if (!laserSession) return
  for (const stroke of laserSession.strokes) {
    paintLaserStroke(laserBaseCtx, stroke.pts, stroke.w, 1)
  }
}

function laserAddPoint(page, x, y, first) {
  const now = performance.now()
  if (first) {
    // A session that has started fading is spent; a new stroke starts clean.
    if (laserSession && now - laserSession.lastAt >= LASER_IDLE_MS) laserSession = null
    if (!laserSession) {
      laserSession = { strokes: [], lastAt: now, page }
      laserClearBase()
    }
    laserLive = { pts: [{ x, y }], w: docMM(0.7) }
  } else if (laserLive) {
    const last = laserLive.pts[laserLive.pts.length - 1]
    if ((last.x - x) ** 2 + (last.y - y) ** 2 < 9) return
    laserLive.pts.push({ x, y })
  } else return
  laserSession.lastAt = now
  laserTick()
}

function laserEnd() {
  if (laserLive && laserLive.pts.length) {
    if (!laserSession) laserSession = { strokes: [], lastAt: 0, page: current() }
    laserSession.strokes.push(laserLive)
    laserSession.lastAt = performance.now()
    laserRenderBase()
  }
  laserLive = null
  laserTick()
}

function laserStop() {
  if (laserRAF) { cancelAnimationFrame(laserRAF); laserRAF = 0 }
  laserLive = null
  laserSession = null
  laserClearBase()
  const c = $('laserC'); if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height)
}

function laserTick() {
  if (!paintLaser()) return
  if (!laserRAF) laserRAF = requestAnimationFrame(() => { laserRAF = 0; laserTick() })
}

function laserStrokePath(ctx, pts) {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y)
    return
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], n = pts[i + 1]
    ctx.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2)
  }
  const last = pts[pts.length - 1]
  ctx.lineTo(last.x, last.y)
}

// A real beam has a hot core inside saturated red and a soft halo. Layered
// strokes are cheaper than canvas shadowBlur and keep the glow even at zoom.
const LASER_LAYERS = [
  { scale: 4.2, color: '#ff1c22', alpha: .09 },
  { scale: 2.3, color: '#ff1c22', alpha: .18 },
  { scale: 1, color: '#ff2024', alpha: .96 },
  { scale: .36, color: '#fff2ee', alpha: .92 },
]

function paintLaserStroke(ctx, pts, w, alpha) {
  if (!pts.length) return
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const layer of LASER_LAYERS) {
    ctx.globalAlpha = alpha * layer.alpha
    ctx.fillStyle = layer.color
    ctx.strokeStyle = layer.color
    const lw = w * layer.scale
    if (pts.length === 1) {
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, lw / 2, 0, Math.PI * 2); ctx.fill()
    } else {
      ctx.lineWidth = lw
      laserStrokePath(ctx, pts)
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
}

function paintLaser() {
  const c = $('laserC'); if (!c) return false
  const ctx = c.getContext('2d')
  // A page/note switch owns a different sheet; never paint the old trail on it.
  if (laserSession && laserSession.page !== current()) { laserStop(); return false }
  ctx.clearRect(0, 0, c.width, c.height)
  const now = performance.now()
  let alpha = 1
  if (!laserLive && laserSession) {
    const idle = now - laserSession.lastAt
    if (idle >= LASER_IDLE_MS) {
      const p = (idle - LASER_IDLE_MS) / LASER_FADE_MS
      if (p >= 1) {
        laserSession = null
        laserClearBase()
        return false
      }
      alpha = 1 - p * p
    }
  }
  if (laserSession) {
    if (laserBase.width !== c.width || laserBase.height !== c.height) laserRenderBase()
    ctx.globalAlpha = alpha
    ctx.drawImage(laserBase, 0, 0)
    ctx.globalAlpha = 1
  }
  if (laserLive && laserLive.pts.length) {
    paintLaserStroke(ctx, laserLive.pts, laserLive.w, 1)
    // Hot pointer dot: white centre, red bloom, fading to nothing.
    const p = laserLive.pts[laserLive.pts.length - 1]
    const r = docMM(2.4)
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r)
    glow.addColorStop(0, 'rgba(255,255,255,1)')
    glow.addColorStop(.22, 'rgba(255,238,232,.95)')
    glow.addColorStop(.5, 'rgba(255,45,48,.55)')
    glow.addColorStop(1, 'rgba(255,20,24,0)')
    ctx.globalAlpha = 1
    ctx.fillStyle = glow
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill()
  }
  return !!(laserLive || laserSession)
}

// ---------- lasso selection (move / duplicate / delete) ----------
let lasso = null        // {pts:[{x,y}]} while drawing the marching ants
let dragSel = null      // {lx,ly,dx,dy} while moving the selection
let clipboardObjects = null // copied strokes/shapes for copy/paste
let clipboardTexts = null   // copied text boxes, pasted with the strokes

function setTool(t) {
  if (S.tool === 'laser') laserStop()
  if (S.tool === 'lasso') clearSelection()
  S.tool = t
  if (t !== 'pen' && S.flyoutOpenTool === 'penFlyout') closeToolFlyout('penFlyout')
  const page = current()
  if (page) { ctxOf('liveC').clearRect(0, 0, docSize(page).w, docSize(page).h) }
  syncToolButtons()
  renderPenStack()
  stackInnerClass()
  if (t === 'laser') showHint('Laser pointer — trail fades, never saved')
  else if (t === 'lasso') showHint(S.selectMode === 'click'
    ? 'Tap a stroke or text to select it, then drag inside the box to move'
    : 'Circle strokes and text to select, then drag inside the box to move')
  else if (t === 'view') showHint('View mode — drag anywhere to pan')
  else if (t === 'shape') showHint('Drag to size the shape, or tap to place one')
  else if (t === 'text') showHint('Tap on the page to place a text box — tap an existing one to edit')
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

// ---------- text-box geometry (measure with the same font the page draws) ----
const textMeasureCtx = document.createElement('canvas').getContext('2d')
function textFontSpec(t) {
  return `${t.italic ? 'italic ' : ''}${t.bold ? '600 ' : ''}${t.size}px "Segoe UI", sans-serif`
}
function textBounds(t) {
  textMeasureCtx.font = textFontSpec(t)
  const lines = String(t.txt).split('\n')
  let w = 0
  for (const ln of lines) w = Math.max(w, textMeasureCtx.measureText(ln).width)
  return { x: t.x, y: t.y, w: Math.max(w, t.size * 0.5), h: lines.length * t.size * 1.25 }
}

// Union box of everything a selection holds (strokes and text boxes). A text
// box has no points, so the old stroke-only bbox would have left it behind.
function selectionBBox(sel) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const push = b => {
    if (!b) return
    if (b.x < x0) x0 = b.x; if (b.y < y0) y0 = b.y
    if (b.x + b.w > x1) x1 = b.x + b.w
    if (b.y + b.h > y1) y1 = b.y + b.h
  }
  for (const st of sel.strokes || []) push(strokeBBox([st]))
  for (const t of sel.texts || []) push(textBounds(t))
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function textAt(page, x, y) {
  const texts = page.texts || []
  // Later boxes draw on top; hit-test from the top down like strokes.
  for (let i = texts.length - 1; i >= 0; i--) {
    const b = textBounds(texts[i])
    const pad = Math.max(6, texts[i].size * 0.15)
    if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return texts[i]
  }
  return null
}

// A lasso catches a text box when any sample of its area lands inside the
// loop: corners, edge midpoints and centre — cheap and reliable for boxes a
// loop only partly covers.
function textInPoly(t, poly) {
  const b = textBounds(t)
  const xs = [b.x, b.x + b.w / 2, b.x + b.w]
  const ys = [b.y, b.y + b.h / 2, b.y + b.h]
  for (const px of xs) for (const py of ys) {
    let inside = false
    for (let j = 0, k = poly.length - 1; j < poly.length; k = j++) {
      const xi = poly[j].x, yi = poly[j].y, xk = poly[k].x, yk = poly[k].y
      if (((yi > py) !== (yk > py)) && (px < (xk - xi) * (py - yi) / (yk - yi) + xi)) inside = !inside
    }
    if (inside) return true
  }
  return false
}

function lassoBegin(page, x, y) {
  if (S.selection && S.selection.page !== page) clearSelection()
  lasso = { pts: [{ x, y }], startX: x, startY: y, moved: false }
}

function lassoAddPoint(x, y) {
  if (!lasso) return
  const slop = gestureSlopDoc()
  if (!lasso.moved && (x - lasso.startX) ** 2 + (y - lasso.startY) ** 2 >= slop * slop) {
    lasso.moved = true
  }
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

function strokeAt(page, x, y) {
  const r = docMM(2)
  for (let i = page.strokes.length - 1; i >= 0; i--) {
    if (strokeIntersectsCircle(page.strokes[i], x, y, r)) return page.strokes[i]
  }
  return null
}

function selectItemAt(page, x, y) {
  // Text boxes render above strokes, so they win the tap first.
  const t = textAt(page, x, y)
  if (t) {
    S.selection = { page, strokes: [], texts: [t], bbox: selectionBBox({ strokes: [], texts: [t] }) }
    drawSelectionBox(page)
    showSelBar(page)
    return
  }
  const st = strokeAt(page, x, y)
  if (!st) { clearSelection(); return }
  S.selection = { page, strokes: [st], texts: [], bbox: selectionBBox({ strokes: [st], texts: [] }) }
  drawSelectionBox(page)
  showSelBar(page)
}

function lassoCommit(page) {
  const l = lasso
  lasso = null
  const lc = ctxOf('liveC'); lc.clearRect(0, 0, docSize(page).w, docSize(page).h)
  // Click mode adds tap-to-select without taking away the drag lasso. A real
  // drag still follows the original polygon path below.
  if (l && !l.moved && S.selectMode === 'click') {
    selectItemAt(page, l.startX, l.startY)
    return
  }
  const pts = l ? l.pts : null
  if (!pts || pts.length < 3) { clearSelection(); return }
  const hits = page.strokes.filter(st => anyPtInPoly(st.pts, pts))
  const textHits = (page.texts || []).filter(t => textInPoly(t, pts))
  if (!hits.length && !textHits.length) { clearSelection(); return }
  S.selection = { page, strokes: hits, texts: textHits, bbox: selectionBBox({ strokes: hits, texts: textHits }) }
  drawSelectionBox(page)
  showSelBar(page)
}

function drawSelectionBox(page) {
  const sel = S.selection
  if (!sel || sel.page !== page) return
  const b = selectionBBox(sel)
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
  const { w, h } = docSize(page)
  lc.save()
  lc.translate(dragSel.dx, dragSel.dy)
  for (const st of sel.strokes) drawStrokeItem(lc, w, h, st)
  lc.restore()
  // Text boxes ride along in the preview too, shifted by the same drag.
  for (const t of sel.texts || []) drawTextObj(lc, { ...t, x: t.x + dragSel.dx, y: t.y + dragSel.dy })
}

// Shift a selection (strokes and text boxes) by (dx, dy) in either direction.
function shiftSelection(sel, dx, dy) {
  for (const st of sel.strokes || []) for (const p of st.pts) { p.x += dx; p.y += dy }
  for (const t of sel.texts || []) { t.x += dx; t.y += dy }
}

function selectionCommitMove(page) {
  const sel = S.selection; if (!sel) return
  const { dx, dy } = dragSel
  dragSel = null
  ctxOf('liveC').clearRect(0, 0, docSize(page).w, docSize(page).h)
  if (!dx && !dy) { drawSelectionBox(page); refreshSelBar(); return }
  firstCommitPreCapture(page)
  shiftSelection(sel, dx, dy)
  page.undo.push({ t: 'move', strokes: sel.strokes, texts: sel.texts || [], dx, dy })
  page.redo = []
  sel.bbox = selectionBBox(sel)
  redrawInk(page)
  drawSelectionBox(page)
  refreshSelBar()
  captureReplay(page)
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
}

function selectionHasItems() {
  const sel = S.selection
  return !!sel && ((sel.strokes && sel.strokes.length) || (sel.texts && sel.texts.length))
}

function showSelBar(page) {
  let bar = $('selBar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'selBar'
    bar.setAttribute('role', 'toolbar')
    bar.setAttribute('aria-label', 'Selection actions')
    // Every action carries a sprite icon: text glyphs here once rendered as
    // tofu or the wrong control picture (the duplicate button showed "DC4").
    bar.innerHTML = `<button id="selCopy" title="Copy" aria-label="Copy"><svg aria-hidden="true"><use href="#ic-copy"/></svg></button><button id="selPaste" title="Paste" aria-label="Paste"><svg aria-hidden="true"><use href="#ic-paste"/></svg></button><button id="selDup" title="Duplicate" aria-label="Duplicate"><svg aria-hidden="true"><use href="#ic-dup"/></svg></button><button id="selDel" title="Delete" aria-label="Delete" class="danger"><svg aria-hidden="true"><use href="#ic-trash"/></svg></button><button id="selClear" title="Deselect" aria-label="Deselect"><svg aria-hidden="true"><use href="#ic-close"/></svg></button>`
    bar.style.transformOrigin = '0 0'
    $('stackInner').append(bar)
    const copyBtn = bar.querySelector('#selCopy')
    copyBtn.title = `Copy (${modShortcut('C')})`
    copyBtn.setAttribute('aria-keyshortcuts', modAria('C'))
    copyBtn.onclick = () => selectionCopy()
    const pasteBtn = bar.querySelector('#selPaste')
    pasteBtn.title = `Paste (${modShortcut('V')})`
    pasteBtn.setAttribute('aria-keyshortcuts', modAria('V'))
    pasteBtn.onclick = () => selectionPaste()
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

function selectionCopy() {
  const sel = S.selection
  if (!selectionHasItems()) return
  // Deep copy so later moves/erases never touch the clipboard buffer
  clipboardObjects = (sel.strokes || []).map(st => JSON.parse(JSON.stringify(st)))
  clipboardTexts = (sel.texts || []).map(t => JSON.parse(JSON.stringify(t)))
  const data = JSON.stringify({ type: 'writecanvas-objects', version: 2, objects: clipboardObjects, texts: clipboardTexts })
  // The OS clipboard carries the copy across notes, windows and app restarts;
  // the in-memory buffer stays as the fallback when the host has no clipboard.
  try {
    if (bridge && bridge.clipboardWriteText) bridge.clipboardWriteText(data).catch(() => {})
    else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(data).catch(() => {})
  } catch { /* clipboard unavailable — in-memory paste still works */ }
  const n = clipboardObjects.length + clipboardTexts.length
  showHint(`Copied ${n} object${n === 1 ? '' : 's'} — ${modShortcut('V')} to paste`)
}

// Read a WriteCanvas payload from the OS clipboard. Returns {strokes, texts}
// (v1 payloads carry strokes only), or null when the clipboard holds
// something else.
async function readClipboardObjects() {
  let text = ''
  try {
    if (bridge && bridge.clipboardReadText) text = await bridge.clipboardReadText()
    else if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText()
  } catch { return null }
  if (!text || text[0] !== '{') return null
  try {
    const parsed = JSON.parse(text)
    if (!parsed || parsed.type !== 'writecanvas-objects' || !Array.isArray(parsed.objects)) return null
    const strokes = parsed.objects.filter(validStroke).map(st => JSON.parse(JSON.stringify(st)))
    const texts = Array.isArray(parsed.texts) ? parsed.texts.filter(validText).map(t => JSON.parse(JSON.stringify(t))) : []
    return (strokes.length || texts.length) ? { strokes, texts } : null
  } catch { return null }
}

function selectionDelete() {
  const sel = S.selection; if (!sel) return
  const page = sel.page
  firstCommitPreCapture(page)
  const goneStrokes = [...(sel.strokes || [])]
  const goneTexts = [...(sel.texts || [])]
  page.strokes = page.strokes.filter(st => !goneStrokes.includes(st))
  page.texts = page.texts.filter(t => !goneTexts.includes(t))
  page.undo.push({ t: 'erase', strokes: goneStrokes, texts: goneTexts })
  page.redo = []
  clearSelection()
  redrawInk(page)
  captureReplay(page)
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
}

async function selectionPaste() {
  const page = current(); if (!page) return
  let source = (clipboardObjects && clipboardObjects.length) || (clipboardTexts && clipboardTexts.length)
    ? { strokes: clipboardObjects || [], texts: clipboardTexts || [] }
    : null
  if (!source) {
    // Nothing copied in this session: fall back to the OS clipboard so paste
    // still works after a restart, or from another window.
    source = await readClipboardObjects()
    if (source) { clipboardObjects = source.strokes; clipboardTexts = source.texts }
  }
  if (!source || (!source.strokes.length && !source.texts.length)) {
    showHint(`Nothing to paste — select ink and press ${modShortcut('C')} to copy first`)
    return
  }
  const copies = source.strokes.map(st => {
    const c = JSON.parse(JSON.stringify(st))
    if (c.pts) {
      c.pts = c.pts.map(p => ({ x: p.x + 26, y: p.y + 26 }))
    }
    return c
  })
  const textCopies = source.texts.map(t => ({ ...JSON.parse(JSON.stringify(t)), x: t.x + 26, y: t.y + 26 }))
  firstCommitPreCapture(page)
  page.strokes.push(...copies)
  page.texts.push(...textCopies)
  page.undo.push({ t: 'add', strokes: copies, texts: textCopies })
  page.redo = []
  S.selection = { page, strokes: copies, texts: textCopies, bbox: null }
  S.selection.bbox = selectionBBox(S.selection)
  redrawInk(page)
  drawSelectionBox(page)
  showSelBar(page)
  positionSelBar()
  captureReplay(page)
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
  const n = copies.length + textCopies.length
  showHint(`Pasted ${n} object${n === 1 ? '' : 's'}`)
}

function selectionDuplicate() {
  const sel = S.selection; if (!sel || !selectionHasItems()) return
  const page = sel.page
  const copies = (sel.strokes || []).map(st => ({ ...st, pts: st.pts.map(p => ({ x: p.x + 26, y: p.y + 26 })), shape: st.shape ? { ...st.shape } : undefined }))
  const textCopies = (sel.texts || []).map(t => ({ ...JSON.parse(JSON.stringify(t)), x: t.x + 26, y: t.y + 26 }))
  firstCommitPreCapture(page)
  page.strokes.push(...copies)
  page.texts.push(...textCopies)
  page.undo.push({ t: 'add', strokes: copies, texts: textCopies })
  page.redo = []
  sel.strokes = copies
  sel.texts = textCopies
  sel.bbox = selectionBBox(sel)
  redrawInk(page)
  drawSelectionBox(page)
  refreshSelBar()
  captureReplay(page)
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
// exported so QA scripts can reset the stencil (ruler state is per session)
export const ruler = { angle: 0, fx: 0.5, fy: 0.55 } // fractions of the doc size
let rulerGrip = null

// Keep the stencil reachable. The default position is 55% down a Letter page,
// which is below the fold on a fitted page; turning Ruler on used to look like
// nothing happened. If the grip is outside the visible canvas, put it in the
// middle of the current viewport before drawing it.
function ensureRulerVisible() {
  if (!S.rulerOn) return false
  const page = current(); if (!page) return false
  const host = $('canvasHost'); const inner = $('stackInner')
  if (!host || !inner || !inner.offsetWidth) return false
  const hr = host.getBoundingClientRect(); const ir = inner.getBoundingClientRect()
  const scale = ir.width / inner.offsetWidth || S.zoom || 1
  const { w, h } = docSize(page)
  const sx = ir.left + ruler.fx * w * scale
  const sy = ir.top + ruler.fy * h * scale
  const padX = 160, padY = 64
  const visible = sx >= hr.left + padX && sx <= hr.right - padX && sy >= hr.top + padY && sy <= hr.bottom - padY
  if (visible) return false
  const cx = hr.left + hr.width / 2
  const cy = hr.top + hr.height / 2
  ruler.fx = clamp((cx - ir.left) / scale / w, 0.06, 0.94)
  ruler.fy = clamp((cy - ir.top) / scale / h, 0.06, 0.94)
  return true
}

function toggleRuler() {
  S.rulerOn = !S.rulerOn
  const page = current(); if (!page) return
  rulerRotate = null
  rulerSnapActive = false
  syncToolButtons()
  if (S.rulerOn) {
    ensureRulerVisible()
    drawRulerLayer(page)
  } else {
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
  const p = lineSnapPoint(x, y, px, py, ux, uy)
  return { x: p.x, y: p.y }
}

// Half the stencil band plus a small margin, in document px. A stroke only
// snaps when it starts inside this band, so the ruler can be left alone.
const RULER_SNAP_DOC = 34
function rulerWithinSnap(page, x, y) {
  const { ux, uy, px, py } = rulerDir(page)
  return pointLineDistance(x, y, px, py, ux, uy) <= RULER_SNAP_DOC
}

// ---------- protractor stencil (the RulerFlyout's second pick) ----------
// A semicircular stencil sharing the ruler's geometry state (angle/fx/fy), so
// switching between the two keeps it where the person left it. The flat edge
// is the base; the arc takes any stroke that starts on it, exactly as the
// straight ruler takes a stroke on its band.
export const protractor = { r: 0.26 }   // arc radius as a fraction of the short page side

function protractorCenter(page) {
  const { w, h } = docSize(page)
  return { px: ruler.fx * w, py: ruler.fy * h, a: ruler.angle * Math.PI / 180, w, h }
}

function protractorRadius(page) {
  const { w, h } = docSize(page)
  return Math.max(220, Math.min(w, h) * protractor.r)
}

// Point on the arc `deg` degrees from the base (0 and 180 are the base's ends,
// 90 is the apex the rotate handle rides on).
function protractorAt(page, deg) {
  const { px, py, a } = protractorCenter(page)
  const r = protractorRadius(page)
  const phi = a - deg * Math.PI / 180
  return { x: px + r * Math.cos(phi), y: py + r * Math.sin(phi) }
}

// Where a point sits relative to the protractor: distance from the centre and
// its signed angle off the base (-180..180). Null right on the pivot, where
// the angle is meaningless.
function protractorArcInfo(page, x, y) {
  const { px, py, a } = protractorCenter(page)
  const dx = x - px, dy = y - py
  const d = Math.hypot(dx, dy)
  if (d < 1) return null
  let rel = (a - Math.atan2(dy, dx)) * 180 / Math.PI
  rel = ((rel % 360) + 360) % 360
  if (rel > 180) rel -= 360
  return { px, py, a, d, rel, r: protractorRadius(page) }
}

export function protractorWithinSnap(page, x, y) {
  const info = protractorArcInfo(page, x, y)
  if (!info) return false
  // the ±8° slack lets a stroke run right up to the base's ends
  return Math.abs(info.d - info.r) <= RULER_SNAP_DOC && info.rel >= -8 && info.rel <= 188
}

// Every sample of a snapped stroke is pulled onto the arc, keeping its angle:
// the pen rides the curve like a compass instead of following the raw hand.
export function protractorSnapPoint(page, x, y) {
  const info = protractorArcInfo(page, x, y)
  if (!info) return { x, y }
  const phi = info.a - clamp(info.rel, 0, 180) * Math.PI / 180
  return { x: info.px + info.r * Math.cos(phi), y: info.py + info.r * Math.sin(phi) }
}

function protractorRotateHandle(page) {
  const { px, py } = protractorCenter(page)
  const r = protractorRadius(page)
  const scale = Math.max(0.08, S.zoom || 1)
  const pull = Math.min(26 / scale, r * 0.2)
  const apex = protractorAt(page, 90)
  const ux = (apex.x - px) / r, uy = (apex.y - py) / r
  return { x: px + ux * (r - pull), y: py + uy * (r - pull) }
}

// The far-end handle rotates the stencil by hand (the ±10° buttons stay for
// fine steps). It rides along the clipped segment so it is always on-screen.
let rulerRotate = null
let rulerSnapActive = false   // a snapped stroke is in flight — band glows

export function rulerRotateHandle(page) {
  if (S.rulerMode === 'protractor') return protractorRotateHandle(page)
  const { ux, uy, px, py, w, h } = rulerDir(page)
  const seg = clipLineToRect(px, py, ux, uy, w, h)
  if (!seg) return null
  const t0 = (seg.x0 - px) * ux + (seg.y0 - py) * uy
  const t1 = (seg.x1 - px) * ux + (seg.y1 - py) * uy
  const tEnd = Math.abs(t1) >= Math.abs(t0) ? t1 : t0   // farther end
  if (Math.abs(tEnd) < 8) return null
  const scale = Math.max(0.08, S.zoom || 1)
  const pull = Math.min(26 / scale, Math.abs(tEnd) * 0.5)
  const t = tEnd - Math.sign(tEnd) * pull
  return { x: px + ux * t, y: py + uy * t }
}

function rulerRotateHit(page, x, y) {
  if (!S.rulerOn) return false
  const h = rulerRotateHandle(page)
  if (!h) return false
  const scale = Math.max(0.08, S.zoom || 1)
  const r = 22 / scale
  return (x - h.x) ** 2 + (y - h.y) ** 2 <= r * r
}

function rulerRotateUpdate(page, x, y) {
  const { px, py } = rulerDir(page)
  let deg = Math.atan2(y - py, x - px) * 180 / Math.PI
  // the protractor's handle rides the apex, a quarter turn off the base
  if (S.rulerMode === 'protractor') deg += 90
  // Near a straight angle the stencil clicks into place; otherwise 1° steps.
  const straight = Math.round(deg / 45) * 45
  deg = Math.abs(deg - straight) < 4 ? straight : Math.round(deg)
  ruler.angle = ((deg + 180) % 360 + 360) % 360 - 180
  redrawRuler()
}

// The stencil overlay: one painter per stencil (ruler.js) plus the floating
// rotate/angle pill. The painters are screen-constant, so the drawing keeps
// its size while the page zooms underneath it.
function drawRulerLayer(page) {
  const c = $('rulerC'); if (!c || c.width === 0) return
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  if (!S.rulerOn) return
  const scale = Math.max(0.08, S.zoom || 1)
  if (S.rulerMode === 'protractor') {
    const { px, py, a } = protractorCenter(page)
    paintProtractorStencil(ctx, {
      px, py, a,
      r: protractorRadius(page),
      scale,
      snapActive: rulerSnapActive,
      rotate: protractorRotateHandle(page),
    })
    drawRulerCtl(px, py)
    return
  }
  const { ux, uy, px, py, w, h } = rulerDir(page)
  const seg = clipLineToRect(px, py, ux, uy, w, h)
  if (!seg) return
  paintRulerStencil(ctx, {
    px, py, ux, uy, seg, scale,
    snapActive: rulerSnapActive,
    rotate: rulerRotateHandle(page),
    mm: docMM(1),
  })
  drawRulerCtl(px, py)
}

// centre of the active stencil plus the unit direction from it into the body:
// the ruler's body normal, the protractor's inward radial. The grip hit test
// and the painters derive the puck position from the same pair, so the drawn
// puck is exactly what can be grabbed.
function stencilFrame(page) {
  if (S.rulerMode === 'protractor') {
    const { px, py, a } = protractorCenter(page)
    return { px, py, dx: Math.cos(a - Math.PI / 2), dy: Math.sin(a - Math.PI / 2) }
  }
  const { ux, uy, px, py } = rulerDir(page)
  return { px, py, dx: -uy, dy: ux }
}

function drawRulerCtl(px, py) {
  let ctl = $('rulerCtl')
  if (!ctl) {
    ctl = document.createElement('div')
    ctl.id = 'rulerCtl'
    ctl.innerHTML = `<button id="rulCCW" title="Rotate left 10&#176;" aria-label="Rotate ruler left"><svg viewBox="0 0 24 24"><path d="M14.6 6.4 9 12l5.6 5.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><span id="rulAngle" class="rul-angle" title="Ruler angle">0&#176;</span><button id="rulCW" title="Rotate right 10&#176;" aria-label="Rotate ruler right"><svg viewBox="0 0 24 24"><path d="M9.4 6.4 15 12l-5.6 5.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
    ctl.style.transformOrigin = '0 0'
    ctl.querySelector('#rulCCW').onclick = ev => { ev.stopPropagation(); ruler.angle -= 10; redrawRuler() }
    ctl.querySelector('#rulCW').onclick = ev => { ev.stopPropagation(); ruler.angle += 10; redrawRuler() }
    $('stackInner').append(ctl)
  }
  const scale = Math.max(0.08, S.zoom || 1)
  // clear of the body: the ruler's body is 46 screen px wide, the protractor's
  // disc sits on the apex side of its base
  const gap = (S.rulerMode === 'protractor' ? 24 : 64) / scale
  ctl.style.left = (px + gap) + 'px'
  ctl.style.top = (py + gap) + 'px'
  ctl.style.transform = `scale(${1 / scale})`
  ctl.dataset.angle = String(ruler.angle)
  ctl.dataset.px = String(px)
  ctl.dataset.py = String(py)
  const angle = ctl.querySelector('#rulAngle')
  if (angle) {
    angle.textContent = `${((Math.round(ruler.angle) + 180) % 360 + 360) % 360 - 180}\u00b0`
    angle.title = S.rulerMode === 'protractor' ? 'Protractor angle' : 'Ruler angle'
  }
}

// Interactive ruler repaints coalesce into ONE paint per animation frame.
// Every mousemove used to paint the whole layer off-rAF, which on this
// GPU-less compositor made dragging the stencil jitter instead of glide.
let rulerPaintQueued = 0
function redrawRuler() {
  if (rulerPaintQueued) return
  rulerPaintQueued = requestAnimationFrame(() => {
    rulerPaintQueued = 0
    const page = current()
    if (page && document.body.contains($('canvasHost'))) drawRulerLayer(page)
  })
}

// ruler grip dragging: a pointer down on the pivot (24 screen px, generous for
// pen/touch at fit-width zoom) or on the drawn grip puck moves the line. The
// puck's hit circle matches exactly where the painters draw it.
function rulerHandleHit(page, x, y) {
  if (!S.rulerOn) return false
  const scale = Math.max(0.08, S.zoom || 1)
  const hit = 24 / scale
  const { px, py, dx, dy } = stencilFrame(page)
  if ((x - px) ** 2 + (y - py) ** 2 <= hit * hit) return true
  const knob = knobCenter(px, py, dx, dy, scale)
  const kr = knob.r + 6 / scale
  return (x - knob.x) ** 2 + (y - knob.y) ** 2 <= kr * kr
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
  redrawRuler()
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

// Build a gallery shape inside the rectangle the user dragged. Lines and
// arrows use the actual start/end points; everything else fits the box.
function buildShapePtsInRect(kind, ax, ay, bx, by) {
  const P = (x, y) => ({ x, y })
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx)
  const y0 = Math.min(ay, by), y1 = Math.max(ay, by)
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2
  if (kind === 'line' || kind === 'arrow') {
    const A = P(ax, ay), T = P(bx, by)
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy)
    if (len < 1) return { lines: [] }
    if (kind === 'line') return { lines: [[A, T]] }
    const ux = dx / len, uy = dy / len
    const head = Math.min(140, Math.max(18, len * 0.24))
    const baseX = T.x - ux * head, baseY = T.y - uy * head
    const side = head * 0.52
    const B1 = P(baseX - uy * side, baseY + ux * side)
    const B2 = P(baseX + uy * side, baseY - ux * side)
    return { lines: [[A, T], [B1, T], [B2, T]] }
  }
  if (kind === 'rectangle') {
    return { lines: [[P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), P(x0, y0)]] }
  }
  if (kind === 'circle') {
    const r = Math.min(rx, ry)
    const pts = []
    for (let i = 0; i <= 64; i++) {
      const a = i / 64 * Math.PI * 2
      pts.push(P(cx + r * Math.cos(a), cy + r * Math.sin(a)))
    }
    return { lines: [pts] }
  }
  if (kind === 'ellipse') {
    const pts = []
    for (let i = 0; i <= 64; i++) {
      const a = i / 64 * Math.PI * 2
      pts.push(P(cx + rx * Math.cos(a), cy + ry * Math.sin(a)))
    }
    return { lines: [pts] }
  }
  const base = buildShapePts(kind, 0, 0, 1)
  return { lines: base.lines.map(line => line.map(p => P(cx + p.x * rx, cy + p.y * ry))) }
}

function makeShapeStrokes(kind, fill, ax, ay, bx, by) {
  const { lines } = buildShapePtsInRect(kind, ax, ay, bx, by)
  const width = docMM(clamp(curPen().widthMM, 1.2, 6))
  return lines.map(pts => ({
    type: 'shape',
    color: curPen().color,
    opacity: 1,
    width,
    pts,
    shape: { kind, fill: !!fill },
  }))
}

// Default box for a tap-to-place: lines and arrows stay horizontal, every
// other shape gets a readable box centred on the tap (341x240 doc px).
function defaultShapeBox(kind, cx, cy) {
  const w = 341, h = 240
  if (kind === 'line' || kind === 'arrow') return { ax: cx - w / 2, ay: cy, bx: cx + w / 2, by: cy }
  return { ax: cx - w / 2, ay: cy - h / 2, bx: cx + w / 2, by: cy + h / 2 }
}

function drawShapePreview() {
  if (!shapeDraft || !shapeDraft.page) return
  const lc = ctxOf('liveC')
  const { w, h } = docSize(shapeDraft.page)
  lc.clearRect(0, 0, w, h)
  const strokes = makeShapeStrokes(shapeDraft.kind, shapeDraft.fill, shapeDraft.ax, shapeDraft.ay, shapeDraft.bx, shapeDraft.by)
  for (const st of strokes) drawShapeItem(lc, st)
}

function syncShapeGrid() {
  document.querySelectorAll('#shapeGrid .sh-card').forEach(b => {
    const on = b.dataset.kind === S.shapeKind && (b.dataset.fill === '1') === !!S.shapeFill
    b.classList.toggle('active', on)
    b.setAttribute('aria-pressed', on ? 'true' : 'false')
  })
}

// The gallery reads in three labelled rows (lines, basics, polygons) instead
// of one undivided wall of 26 icons.
const SHAPE_SECTIONS = (() => {
  const lines = [], basics = [], polygons = []
  for (const [kind, fill] of SHAPE_GALLERY) {
    if (kind === 'line' || kind === 'arrow') lines.push([kind, fill])
    else if (kind.startsWith('polygon')) polygons.push([kind, fill])
    else basics.push([kind, fill])
  }
  return [['Lines & arrows', lines], ['Basics', basics], ['Polygons', polygons]]
})()

function buildShapeGrid() {
  const g = $('shapeGrid')
  if (!g) return
  g.replaceChildren()
  for (const [label, items] of SHAPE_SECTIONS) {
    const sec = document.createElement('section')
    sec.className = 'sh-section'
    const head = document.createElement('div')
    head.className = 'sh-section-label'
    head.textContent = label
    const grid = document.createElement('div')
    grid.className = 'sh-grid'
    for (const [kind, fill] of items) {
      const b = document.createElement('button')
      b.className = 'sh-card'
      b.dataset.kind = kind
      b.dataset.fill = fill ? '1' : '0'
      b.setAttribute('aria-pressed', 'false')
      const name = kind.startsWith('polygon') ? `${kind.slice(7)}-sided` : kind
      b.title = fill
        ? `${name} (filled) — drag on the page, or tap to place one`
        : `${name} — drag on the page, or tap to place one`
      const cv = document.createElement('canvas')
      cv.width = 36; cv.height = 36
      drawShapeIcon(cv, kind, !!fill)
      b.append(cv)
      b.onclick = () => startShapeTool(kind, fill)
      grid.append(b)
    }
    sec.append(head, grid)
    g.append(sec)
  }
  syncShapeGrid()
}

function startShapeTool(kind, fill) {
  S.shapeKind = kind
  S.shapeFill = !!fill
  setTool('shape')
  closeToolFlyout('shapeFlyout')
  syncShapeGrid()
  showHint('Drag on the page to size the shape — Esc when done')
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
  captureReplay(page)
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
// The Text tool has exactly one entry point — the toolbar button (and T). The
// second "Text box" button that used to sit inside the Shapes flyout was the
// duplicated feature the person pointed at.
function startTextTool() {
  setTool('text')
  closeToolFlyout('shapeFlyout')
  showHint('Tap on the page to place a text box — tap an existing one to edit')
}

let textEdit = null
let hintTimer = null

export function showHint(msg) {
  const h = $('shapeTextHint')
  if (!h) return
  h.textContent = msg
  h.classList.remove('hidden')
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => h.classList.add('hidden'), 2600)
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
  openTextBoxEditor(page, obj)
}

// Re-open an already committed text box. The box leaves page.texts while the
// editor is up (otherwise it would draw twice), and goes back at the same
// index when the edit finishes; `before` is the untouched snapshot for undo.
function beginTextEdit(page, obj) {
  if (textEdit) { textEdit.el.focus(); return }
  if (!page.texts) page.texts = []
  const index = page.texts.indexOf(obj)
  if (index < 0) return
  const before = { ...obj }
  page.texts.splice(index, 1)
  clearSelection()
  if (page === current()) redrawInk(page)
  openTextBoxEditor(page, obj, { editing: true, index, before })
}

function openTextBoxEditor(page, obj, { editing = false, index = -1, before = null } = {}) {
  const inner = $('stackInner')
  const el = document.createElement('textarea')
  el.id = 'textEdit'
  el.rows = 1
  el.spellcheck = false
  el.style.left = Math.round(obj.x) + 'px'
  el.style.top = Math.round(obj.y) + 'px'
  inner.append(el)
  if (editing) el.value = obj.txt
  // measure after mounting: a detached textarea reports a zero scroll size
  textStyle(el, obj)
  const bar = buildTextEditBar(page, obj, el)
  bar.style.left = el.style.left
  bar.style.top = Math.max(4, Math.round(obj.y) - 44 / S.zoom) + 'px'
  // the bar is UI chrome: counter-scale so buttons stay screen-sized at any zoom
  bar.style.transformOrigin = '0 0'
  bar.style.transform = `scale(${1 / S.zoom})`
  inner.append(bar)
  el.addEventListener('input', () => autoGrowText(el))
  el.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); finishText(true) }
    else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); finishText(false) }
  })
  // Focus leaves for formatting buttons too: commit, but keep the Text tool
  // active so the next tap can place another box.
  el.addEventListener('blur', () => { if (textEdit) finishText(false, { keepTool: true }) })
  textEdit = { el, bar, page, obj, editing, index, before }
  // The pointerdown that placed the box was aimed at the canvas, so the
  // browser's mousedown default would move focus there and blur (and thus
  // discard) the brand-new box. Focus once that default has run.
  setTimeout(() => {
    if (textEdit && textEdit.el === el) {
      el.focus({ preventScroll: true })
      if (editing) el.setSelectionRange(el.value.length, el.value.length)
    }
  }, 0)
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

// The editor is bound to the page it was placed on, not to "whatever page is
// current when it closes": switching sheets used to commit the text into the
// new page and composite the old page's ink into the new page's PNG.
function finishText(discard, { keepTool = false } = {}) {
  if (!textEdit) return
  const { el, bar, page, obj, editing, index, before } = textEdit
  textEdit = null
  obj.txt = el.value.replace(/\s+$/, '')
  const committed = !!obj.txt
  el.remove(); bar.remove()
  if (!page.texts) page.texts = []

  if (editing) {
    // The box was lifted out of page.texts when the editor opened.
    if (discard) {
      // Put the original values back on the same object and re-insert it; a
      // cancel must not dirty the page.
      Object.assign(obj, before)
      page.texts.splice(Math.min(index, page.texts.length), 0, obj)
      if (page === current()) redrawInk(page)
      return
    }
    if (!committed) {
      // Clearing the whole text and committing deletes the box; undo brings
      // the old content back.
      firstCommitPreCapture(page)
      page.undo.push({ t: 'erase', strokes: [], texts: [before] })
      page.redo = []
      if (page === current()) redrawInk(page)
      captureReplay(page)
      page.dirty = true
      scheduleAutosave()
      refreshThumbOf(page)
      return
    }
    const after = { ...obj }
    page.texts.splice(Math.min(index, page.texts.length), 0, obj)
    page.undo.push({ t: 'text-edit', obj, before, after })
    page.redo = []
    if (page === current()) redrawInk(page)
    captureReplay(page)
    page.dirty = true
    scheduleAutosave()
    refreshThumbOf(page)
    return // keep whatever tool was active when the box was opened
  }

  if (discard || !committed) return
  firstCommitPreCapture(page)
  page.texts.push(obj)
  page.undo.push({ t: 'text', obj })
  page.redo = []
  if (page === current()) redrawInk(page)
  captureReplay(page)
  page.dirty = true
  scheduleAutosave()
  refreshThumbOf(page)
  if (!keepTool) setTool('pen')
}

// Remove the floating editor without touching its page. Used when the note it
// belongs to is being closed/deleted rather than navigated away from.
function cancelTextEdit() {
  if (!textEdit) return
  const { el, bar } = textEdit
  textEdit = null
  el.remove(); bar.remove()
}

// ---------- eraser flyout modes ----------

function onPointerUp(e) {
  // A pointerup for an untracked pointer (its down was ignored, or the gesture
  // was cancelled) must not commit anything.
  if (activePointer === null || e.pointerId !== activePointer) return
  activePointer = null
  // The load replaced the pages, so any gesture that began on the outgoing
  // note must not be committed into the incoming note's current sheet.
  // (openNote already cancelled the gesture when it took over.)
  if (noteBusy) return
  const page = current(); if (!page) return
  if (pan) {
    // Panning is plain scrolling now: the stack is continuous, so a drag
    // simply moves through the pages that are already there.
    pan = null
    hidePullHint()
    return
  }
  if (rulerGrip) { rulerGrip = null; return }
  if (rulerRotate) { rulerRotate = null; return }
  const lc = ctxOf('liveC'); lc.clearRect(0, 0, docSize(page).w, docSize(page).h)
  if (shapeDraft) {
    const d = shapeDraft
    shapeDraft = null
    if (Math.hypot(d.bx - d.ax, d.by - d.ay) < 12) {
      // A tap places a readable default-size shape centred on the spot; a drag
      // still sizes it by hand (tap used to only show a hint).
      const box = defaultShapeBox(d.kind, d.ax, d.ay)
      const strokes = makeShapeStrokes(d.kind, d.fill, box.ax, box.ay, box.bx, box.by)
      if (!strokes.length) return
      firstCommitPreCapture(page)
      page.strokes.push(...strokes)
      page.undo.push({ t: 'add', strokes })
      page.redo = []
      redrawInk(page)
      scheduleReplayCapture(page)
      page.dirty = true
      scheduleAutosave()
      refreshCurrentThumb()
      showHint('Shape added — drag to size one, or press Esc')
      return
    }
    const strokes = makeShapeStrokes(d.kind, d.fill, d.ax, d.ay, d.bx, d.by)
    if (!strokes.length) return
    firstCommitPreCapture(page)
    page.strokes.push(...strokes)
    page.undo.push({ t: 'add', strokes })
    page.redo = []
    redrawInk(page)
    scheduleReplayCapture(page)
    page.dirty = true
    scheduleAutosave()
    refreshCurrentThumb()
    showHint('Shape added — drag again, or press Esc')
    return
  }
  if (live) {
    // Drop the queued live paint before clearing: its callback must not
    // repaint a stroke that is being committed (or was already discarded).
    cancelLivePaint()
    const stroke = live.stroke
    const snapped = live.snapMode
    // Bring the mask up to date with the last samples, then commit those very
    // pixels: the ink lands exactly as it looked on the sheet, with no stroke
    // rebuild to hitch on. A bare tap (nothing painted yet) or a stroke the
    // mask could not cover falls back to the canonical render.
    paintLiveStroke(page)
    const { w, h } = docSize(page)
    const mask = scratchUsed
    live = null
    if (snapped) { rulerSnapActive = false; redrawRuler() }
    if (!stroke.pts.length) return
    firstCommitPreCapture(page)
    const ic = ctxOf('inkC')
    let committed = false
    if (mask) {
      const bx0 = Math.max(0, mask.x0), by0 = Math.max(0, mask.y0)
      const bx1 = Math.min(w, mask.x1), by1 = Math.min(h, mask.y1)
      if (bx1 > bx0 && by1 > by0) {
        ic.save()
        ic.globalAlpha = strokeAlpha(stroke)
        ic.drawImage(scratch, bx0, by0, bx1 - bx0, by1 - by0, bx0, by0, bx1 - bx0, by1 - by0)
        ic.restore()
        committed = true
      }
    }
    if (!committed) drawStrokeItem(ic, w, h, stroke)
    page.strokes.push(stroke)
    page.undo.push({ t: 'add', stroke })
    page.redo = []
    scheduleReplayCapture(page)
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
      scheduleReplayCapture(page)
      page.dirty = true
      scheduleAutosave()
      refreshCurrentThumb()
    }
  } else if (dragSel) {
    const d = dragSel
    if (!d.moved && S.selectMode === 'click') {
      dragSel = null
      selectItemAt(page, d.sx, d.sy)
    } else {
      selectionCommitMove(page)
    }
  } else if (lasso) {
    lassoCommit(page)
  } else if (laserLive) {
    laserEnd()
  }
}

function clearLive(page) {
  if (!page) return
  ctxOf('liveC').clearRect(0, 0, docSize(page).w, docSize(page).h)
}

// Abandon the gesture in flight without committing it. pointercancel (OS
// gesture takeover, pen leaving range) used to call the pointerup path, which
// turned a cancelled drag into ink, an erase, or even a page turn.
function cancelGesture() {
  const page = current()
  if (pan) {
    pan = null
    hidePullHint()
    return
  }
  rulerGrip = null
  rulerRotate = null
  if (rulerSnapActive) { rulerSnapActive = false; redrawRuler() }
  if (shapeDraft) {
    shapeDraft = null
    clearLive(page)
    return
  }
  if (live) {
    cancelLivePaint()
    live = null
    clearLive(page)
    return
  }
  if (erasePending) {
    const ep = erasePending
    erasePending = null
    if (page) {
      // eraseAt already cut ink out of the page while the pointer was down;
      // put every removed stroke/fragment back untouched
      for (const st of ep.whole) if (!page.strokes.includes(st)) page.strokes.push(st)
      for (const [orig, pieces] of [...ep.pairs].reverse()) {
        page.strokes = page.strokes.filter(st => !pieces.includes(st))
        if (!page.strokes.includes(orig)) page.strokes.push(orig)
      }
      if (ep.whole.length || ep.pairs.length) {
        // eraseAt mutates strokes while the pointer is down, and an autosave
        // can snapshot that half-erased state. Reverting must therefore dirty
        // the page and refresh the replay, or disk keeps the cancelled cuts.
        redrawInk(page)
        captureReplay(page)
        page.dirty = true
        scheduleAutosave()
        refreshThumbOf(page)
      }
      clearLive(page)
    }
    return
  }
  if (lasso) { lasso = null; clearLive(page); return }
  if (dragSel) {
    dragSel = null
    if (page && S.selection && S.selection.page === page) drawSelectionBox(page)
    else clearLive(page)
    return
  }
  if (laserLive) laserEnd()
}

function onPointerCancel(e) {
  if (activePointer !== null && e.pointerId !== activePointer) return
  activePointer = null
  cancelGesture()
}

// ---------- undo / redo ----------
function undo() {
  if (noteBusy) return
  const page = current(); if (!page) return
  const a = page.undo.pop()
  if (!a) return
  clearSelection() // the selected object may be the one this action removes
  if (a.t === 'add') {
    for (const st of (a.strokes || [a.stroke])) {
      const idx = page.strokes.lastIndexOf(st)
      if (idx >= 0) page.strokes.splice(idx, 1)
    }
    // pasted/duplicated text boxes travel in the same undo entry
    for (const t of (a.texts || [])) {
      const idx = page.texts.lastIndexOf(t)
      if (idx >= 0) page.texts.splice(idx, 1)
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
  } else if (a.t === 'text-edit') {
    // In-place edit of an existing box: the box object stays in page.texts,
    // only its content/style fields roll back.
    Object.assign(a.obj, a.before)
    page.redo.push(a)
  } else if (a.t === 'erase-split') {
    // Splits within one gesture can nest (a fragment is split again), so undo
    // must restore newest-first; forward order left the intermediate fragment
    // behind and duplicated the original stroke.
    for (const [orig, pieces] of [...a.pairs].reverse()) {
      for (const pc of pieces) {
        const i = page.strokes.lastIndexOf(pc)
        if (i >= 0) page.strokes.splice(i, 1)
      }
      page.strokes.push(orig)
    }
    page.redo.push(a)
  } else if (a.t === 'move') {
    shiftSelection(a, -a.dx, -a.dy)
    page.redo.push(a)
    clearSelection()
  }
  redrawInk(page)
  captureReplay(page)
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
}

function redo() {
  if (noteBusy) return
  const page = current(); if (!page) return
  const a = page.redo.pop()
  if (!a) return
  clearSelection()
  if (a.t === 'add') {
    if (a.strokes) page.strokes.push(...a.strokes)
    else page.strokes.push(a.stroke)
    if (a.texts) page.texts.push(...a.texts)
    page.undo.push(a)
  } else if (a.t === 'erase') {
    page.strokes = page.strokes.filter(st => !a.strokes.includes(st))
    if (a.texts) page.texts = page.texts.filter(t => !a.texts.includes(t))
    page.undo.push(a)
  } else if (a.t === 'text') {
    page.texts.push(a.obj)
    page.undo.push(a)
  } else if (a.t === 'text-edit') {
    Object.assign(a.obj, a.after)
    page.undo.push(a)
  } else if (a.t === 'erase-split') {
    // Rebuild forward, then drop every superseded original in one pass. With
    // nested splits the intermediate fragment is both a piece and an original,
    // so filtering before pushing it would leave that duplicate behind.
    for (const [, pieces] of a.pairs) page.strokes.push(...pieces)
    const superseded = new Set(a.pairs.map(([o]) => o))
    page.strokes = page.strokes.filter(st => !superseded.has(st))
    page.undo.push(a)
  } else if (a.t === 'move') {
    shiftSelection(a, a.dx, a.dy)
    page.undo.push(a)
    clearSelection()
  }
  redrawInk(page)
  captureReplay(page)
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
}

// ---------- save / autosave ----------
let autosaveTimer = null
let retryTimer = null
let saveChain = Promise.resolve()
// Set when the open note vanished from the library index. There is no disk
// target to retry into, so sticking the note forever would wedge every switch.
let orphanNoteId = null
// True when the most recent save pass hit an actual write error. A pass that
// merely found new edits made while it was in flight is not an error.
let saveHadError = false
let lastSavedAt = null
let lastSaveError = ''
function scheduleAutosave() {
  S.editSeq++
  setSaveState('pending', true)
  clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => saveCurrentPage(), 1400)
}

function setSaveState(kind, working) {
  const s = $('saveState')
  const btn = $('btnSave')
  const state = working ? 'saving' : (kind === 'ok' ? 'saved' : kind === 'err' ? 'error' : 'idle')
  if (kind === 'ok') {
    lastSavedAt = new Date()
    lastSaveError = ''
  }
  if (s) {
    if (working) { s.textContent = 'saving…'; s.style.color = 'var(--dim)' }
    else if (kind === 'ok') {
      s.textContent = lastSavedAt
        ? `saved ${lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : 'saved'
      s.style.color = '#6fd68f'
    } else if (kind === 'err') { s.textContent = 'save failed — click Save to retry'; s.style.color = 'var(--danger)' }
    else s.textContent = ''
  }
  if (btn) {
    btn.dataset.saveState = state
    btn.title = working ? 'Saving all changed pages…'
      : kind === 'ok' ? 'All changes saved'
        : kind === 'err' ? `Save failed${lastSaveError ? ': ' + lastSaveError : ''} — click to retry`
          : 'Save all changed pages (' + modShortcut('S') + ')'
  }
}

// Only pages that actually changed are written, and every one of them is:
// switching pages used to leave the previous sheet dirty forever (the old
// autosave only ever saved the current page).
function pendingPages() {
  const out = []
  S.pages.forEach((page, idx) => {
    if (page.dirty || page.recorder.changed) out.push({ page, idx })
  })
  return out
}

// Everything the save needs is captured synchronously: the page can be edited
// again (or switched away) while the encode/IPC write is still in flight.
function snapshotPage(page) {
  const off = page === current() ? compositeCurrentPage(page) : flattenToCanvas(page)
  const paper = page.paper
  const rgb = hexToCss(paper.bg, '#FFFFFF').slice(1).toUpperCase()
  return {
    off,
    seq: S.editSeq,
    frames: page.recorder.changed ? page.recorder.frames.slice() : [],
    // v2: raster imports travel in sRST, so an empty v2 page must never be
    // mistaken for a legacy flattened image when it is reopened.
    vec: JSON.stringify({ v: 2, strokes: page.strokes, texts: page.texts || [] }),
    paper,
    meta: {
      sizeName: (SIZES[paper.size] || SIZES.letter).name,
      orientation: paper.orientation,
      template: paper.template,
      templatePath: templatePathFor(paper.template, paper.orientation),
      bgColor: '#FF' + rgb,
      borderLines: paper.borderLines !== false,
      tool: (() => { const p = curPen(); return { type: p.type, color: p.color, widthMM: p.widthMM, opacity: p.opacity } })(),
      paper: { ...paper },
    },
  }
}

// `noteId` and `idx` are captured before any await: switching notes mid-save
// must never write note A's bitmap into note B's page slot.
async function writePage(page, noteId, idx) {
  const snap = snapshotPage(page)
  const png = await new Promise(r => snap.off.toBlob(r, 'image/png'))
  if (!png) throw new Error('page encode failed')
  const bytes = new Uint8Array(await png.arrayBuffer())
  const res = await bridge.savePage({
    noteId, pageIndex: idx, png: bytes,
    frames: snap.frames, vec: snap.vec, meta: snap.meta,
  })
  if (S.pages[idx] === page && res && res.file) page.file = res.file
  // an edit made while the write was in flight keeps the page dirty; the next
  // autosave captures it instead of losing it
  if (S.editSeq === snap.seq) {
    page.dirty = false
    page.recorder.changed = false
  }
  if (S.noteId === noteId && S.currentPage === idx && S.note) {
    S.note.paper = { ...snap.paper }
    S.note.tool = { ...snap.meta.tool }
  }
}

function scheduleRetry(noteId) {
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    retryTimer = null
    if (S.noteId !== noteId || orphanNoteId === noteId) return
    if (pendingPages().length) saveCurrentPage()
  }, 5000)
}

export function saveCurrentPage() {
  const noteId = S.noteId
  if (!noteId) return Promise.resolve(false)
  if (orphanNoteId === noteId) return Promise.resolve(true)
  clearTimeout(autosaveTimer)
  autosaveTimer = null
  if (!pendingPages().length) {
    setSaveState('ok')
    return Promise.resolve(true)
  }
  setSaveState('saving', true)
  let ok = true
  const run = async () => {
    saveHadError = false
    // Collect at execution time so edits made while this save waited in the
    // chain are included as well.
    for (const { page, idx } of pendingPages()) {
      if (S.noteId !== noteId) return ok
      try {
        await writePage(page, noteId, idx)
      } catch (err) {
        ok = false
        saveHadError = true
        lastSaveError = err && err.message ? err.message : 'unknown error'
        console.error(err)
        if (/note not found/i.test(err && err.message)) {
          orphanNoteId = noteId
          if (S.noteId === noteId) showHint('This note is no longer in the library — changes cannot be saved')
          break
        }
      }
    }
    if (S.noteId !== noteId) return ok
    if (orphanNoteId === noteId) { setSaveState('err'); return true }
    if (pendingPages().length) {
      // New edits landed while the writes were in flight: that is not a
      // failure, their own autosave is already queued. Only actual errors
      // warrant the error state and a retry.
      if (!ok) {
        setSaveState('err')
        scheduleRetry(noteId)
      }
      return false
    }
    setSaveState('ok')
    refreshCurrentThumb()
    return ok
  }
  const next = saveChain.then(run, run)
  saveChain = next.then(() => { }, () => { })
  return next
}

// Flush every dirty page and wait for queued writes. Used before a note
// switch, project export and by the main-process close handshake.
export async function flushCurrentPage({ internal = false } = {}) {
  if (noteBusy && !internal) await loadPromise.catch(() => { })
  if (textEdit) finishText(false)
  const noteId = S.noteId
  if (!noteId) { await saveChain; return true }
  await saveChain
  if (orphanNoteId === noteId) return true
  // New edits raced with the first pass: save again instead of reporting a
  // bogus failure. Real write errors still abort the caller.
  for (let i = 0; i < 3 && pendingPages().length; i++) {
    await saveCurrentPage()
    if (orphanNoteId === noteId) return true
    if (saveHadError) return false
    await saveChain
  }
  return pendingPages().length === 0
}

// ---------- flyouts ----------
// `ignoreEl` is the control that owns this surface: light-dismiss must skip it
// so the control's own click can toggle the surface closed (otherwise the
// pointerdown closer hides it first and the click handler re-opens it).
function closeFlyoutCloser(getEl, onClosed, ignoreEl) {
  const ignores = ignoreEl == null ? [] : (Array.isArray(ignoreEl) ? ignoreEl : [ignoreEl])
  const onDown = e => {
    const f = getEl()
    if (f && (f.contains(e.target) || ignores.some(n => n && n.contains(e.target)))) {
      setTimeout(() => document.addEventListener('pointerdown', onDown, { capture: true, once: true }), 0)
      return
    }
    if (f) f.classList.add('hidden')
    document.removeEventListener('pointerdown', onDown, true)
    onClosed && onClosed()
  }
  setTimeout(() => document.addEventListener('pointerdown', onDown, { capture: true, once: true }), 0)
}

function placeFlyout(f, anchor, { centered = true } = {}) {
  const btn = anchor.getBoundingClientRect()
  const w = f.offsetWidth || 300
  const h = f.offsetHeight || 0
  const margin = 8
  const wantedLeft = centered ? btn.left + btn.width / 2 - w / 2 : btn.left
  const left = Math.max(margin, Math.min(wantedLeft, window.innerWidth - w - margin))
  let top = btn.bottom + 6
  if (h && top + h > window.innerHeight - margin) top = Math.max(margin, btn.top - h - 6)
  f.style.left = Math.round(left) + 'px'
  f.style.top = Math.round(top) + 'px'
}

// ---------- custom color popover (HSV + hex) ----------
// Chromium's platform colour dialog ignores the input's position in Electron
// and opens at the window's top-left. This small picker is anchored to the
// rainbow swatch instead, so the colour stays next to the control the user
// pressed.
const CP = { open: false, target: null, anchor: null, h: 0, s: 0, v: 0, raf: 0 }

function rgbFromHex(hex) {
  const n = normalizeHexColor(hex)
  if (!n) return null
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  }
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max ? d / max : 0, v: max }
}

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360
  const c = v * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

function colorPopoverHex() {
  const { r, g, b } = hsvToRgb(CP.h, CP.s, CP.v)
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase()
}

function setColorPopoverFromHex(hex) {
  const rgb = rgbFromHex(hex)
  if (!rgb) return false
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
  CP.h = hsv.h; CP.s = hsv.s; CP.v = hsv.v
  return true
}

function drawColorPopoverSV() {
  const cv = $('cpSV')
  if (!cv) return
  const ctx = cv.getContext('2d')
  const w = cv.width, h = cv.height
  ctx.fillStyle = `hsl(${CP.h}, 100%, 50%)`
  ctx.fillRect(0, 0, w, h)
  let g = ctx.createLinearGradient(0, 0, w, 0)
  g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
  g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000')
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
  const x = clamp(CP.s, 0, 1) * w
  const y = (1 - clamp(CP.v, 0, 1)) * h
  ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 3; ctx.stroke()
  ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2)
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
}

function drawColorPopoverHue() {
  const cv = $('cpHue')
  if (!cv) return
  const ctx = cv.getContext('2d')
  const w = cv.width, h = cv.height
  const g = ctx.createLinearGradient(0, 0, w, 0)
  for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60}, 100%, 50%)`)
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
  const x = (CP.h / 360) * w
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x - 2, 0, 4, h)
  ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, 0, 2, h)
}

function renderColorPopover() {
  const hex = colorPopoverHex()
  const preview = $('cpPreview')
  if (preview) preview.style.background = hex
  const input = $('cpHex')
  if (input && document.activeElement !== input) {
    input.value = hex
    input.setAttribute('aria-invalid', 'false')
  }
  const err = $('cpError')
  if (err && document.activeElement !== input) err.textContent = ''
  drawColorPopoverSV()
  drawColorPopoverHue()
}

function applyColorPopover() {
  if (!CP.open) return
  const hex = colorPopoverHex()
  if (CP.target === 'pen') selectColor(hex)
  else if (CP.target === 'paper') applyPaperBg(hex)
}

function queueColorPopoverApply() {
  if (!CP.open || CP.raf) return
  CP.raf = requestAnimationFrame(() => {
    CP.raf = 0
    applyColorPopover()
  })
}

function flushColorPopoverApply() {
  if (CP.raf) { cancelAnimationFrame(CP.raf); CP.raf = 0 }
  applyColorPopover()
}

function placeColorPopover() {
  const f = $('colorPopover')
  const a = CP.anchor
  if (!f || !a || !CP.open) return
  const r = a.getBoundingClientRect()
  const fly = a.closest('.flyout')
  const fr = fly ? fly.getBoundingClientRect() : null
  const w = f.offsetWidth || 264
  const h = f.offsetHeight || 0
  const margin = 10
  // Sit immediately beside the flyout, level with the rainbow swatch, so the
  // picker is next to the control without covering the pen settings.
  let left = fr ? fr.left - w - 10 : r.left - w - 10
  let top = r.top
  if (left < margin && fr) left = fr.right + 10
  if (left < margin || left + w > window.innerWidth - margin) {
    // No horizontal room beside the flyout: tuck it above/below the swatch.
    left = clamp(r.left, margin, window.innerWidth - w - margin)
    top = r.top - h - 8
    if (top < margin) top = r.bottom + 8
  }
  if (h && top + h > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - h - margin)
  f.style.left = Math.round(left) + 'px'
  f.style.top = Math.round(top) + 'px'
}

function onColorPopoverOutside(e) {
  if (!CP.open) return
  const pop = $('colorPopover')
  if (pop && pop.contains(e.target)) return
  if (CP.anchor && CP.anchor.contains(e.target)) return
  closeColorPopover()
}

function openColorPopover(target, anchor) {
  if (!anchor || (target !== 'pen' && target !== 'paper')) return
  if (CP.open && CP.target === target && CP.anchor === anchor) { closeColorPopover(); return }
  closeColorPopover()
  CP.open = true
  CP.target = target
  CP.anchor = anchor
  const page = current()
  const source = target === 'pen' ? curPen().color : (page && page.paper && page.paper.bg)
  if (!setColorPopoverFromHex(source)) setColorPopoverFromHex('#000000')
  const pop = $('colorPopover')
  if (!pop) { CP.open = false; return }
  pop.classList.remove('hidden')
  anchor.setAttribute('aria-expanded', 'true')
  renderColorPopover()
  placeColorPopover()
  setTimeout(() => {
    if (CP.open) document.addEventListener('pointerdown', onColorPopoverOutside, true)
  }, 0)
}

function closeColorPopover() {
  if (!CP.open) return
  if (CP.raf) {
    cancelAnimationFrame(CP.raf)
    CP.raf = 0
    applyColorPopover()
  }
  document.removeEventListener('pointerdown', onColorPopoverOutside, true)
  const pop = $('colorPopover')
  if (pop) pop.classList.add('hidden')
  if (CP.anchor) CP.anchor.setAttribute('aria-expanded', 'false')
  CP.open = false
  CP.target = null
  CP.anchor = null
}

function pickColorPopoverSV(e) {
  const cv = $('cpSV')
  if (!cv) return
  const r = cv.getBoundingClientRect()
  CP.s = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1)
  CP.v = clamp(1 - (e.clientY - r.top) / Math.max(1, r.height), 0, 1)
  renderColorPopover()
  queueColorPopoverApply()
}

function pickColorPopoverHue(e) {
  const cv = $('cpHue')
  if (!cv) return
  const r = cv.getBoundingClientRect()
  CP.h = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1) * 360
  renderColorPopover()
  queueColorPopoverApply()
}

function applyColorPopoverHex() {
  const input = $('cpHex')
  if (!input) return
  const hex = normalizeHexColor(input.value)
  if (!hex) {
    input.setAttribute('aria-invalid', 'true')
    const err = $('cpError')
    if (err) err.textContent = 'Enter 3 or 6 hex digits, for example #0B63C5.'
    return
  }
  input.value = hex
  input.setAttribute('aria-invalid', 'false')
  const err = $('cpError')
  if (err) err.textContent = ''
  setColorPopoverFromHex(hex)
  renderColorPopover()
  flushColorPopoverApply()
}

function bindColorPopoverCanvas(cv, pick) {
  if (!cv) return
  cv.addEventListener('pointerdown', e => {
    e.preventDefault()
    try { cv.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
    pick(e)
  })
  cv.addEventListener('pointermove', e => { if (e.buttons) pick(e) })
  cv.addEventListener('pointerup', () => flushColorPopoverApply())
  cv.addEventListener('pointercancel', () => flushColorPopoverApply())
}

let flyoutAnchorEl = null

function syncFlyoutAria() {
  const pairs = [
    ['penFlyout', $('tbPenCurrent')],
    ['shapeFlyout', $('tbObject')],
    ['selectFlyout', $('tbLasso')],
    ['rulerFlyout', $('tbRuler')],
    ['eraserFlyout', $('tbEraser')],
    ['saveFlyout', $('btnSaveMore')],
    ['paperColorFlyout', $('ppBgColor')],
  ]
  for (const [id, btn] of pairs) {
    if (!btn) continue
    btn.setAttribute('aria-expanded', S.flyoutOpenTool === id ? 'true' : 'false')
  }
}

// All toolbar flyouts are anchored to their control, never to a magic offset.
function showFlyoutNear(id, anchor) {
  const f = $(id)
  f.classList.remove('hidden') // visible before measuring (display:none → 0)
  placeFlyout(f, anchor)
}

// pen flyout centers itself under the slot it belongs to (02-pen-flyout)
function showFlyoutCentered(id, anchor) {
  const f = $(id)
  f.classList.remove('hidden')
  placeFlyout(f, anchor)
}

function closeToolFlyout(id) {
  const f = $(id)
  if (f) f.classList.add('hidden')
  if (id === 'penFlyout' || id === 'paperColorFlyout') closeColorPopover()
  if (S.flyoutOpenTool === id) S.flyoutOpenTool = null
  if (S.flyoutOpenTool === null) flyoutAnchorEl = null
  syncFlyoutAria()
  renderPenStack()
}

// tool flyouts (opened from the toolbar) suppress the selected slot's filled
// circle: the original drops the circle to a plain dot while a flyout is open
// (02-pen-flyout, 06-save) but keeps it for the wide paper band (04-tune)
function openToolFlyout(id, anchor, { centered = false, ignore = null } = {}) {
  if (S.flyoutOpenTool === id) { closeToolFlyout(id); return } // re-click toggles
  if (S.flyoutOpenTool) closeToolFlyout(S.flyoutOpenTool)
  S.flyoutOpenTool = id
  flyoutAnchorEl = anchor
  if (centered) showFlyoutCentered(id, anchor)
  else showFlyoutNear(id, anchor)
  syncFlyoutAria()
  closeFlyoutCloser(
    () => (S.flyoutOpenTool === id ? $(id) : null),
    () => {
      if (id === 'penFlyout' || id === 'paperColorFlyout') closeColorPopover()
      if (S.flyoutOpenTool === id) {
        S.flyoutOpenTool = null
        flyoutAnchorEl = null
        syncFlyoutAria()
        renderPenStack()
      }
    },
    [ignore || anchor, $('colorPopover')],
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
  syncPaperColorFlyout()
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
  if (!g) return
  g.innerHTML = ''
  BOARD_PALETTE.forEach(c => {
    const b = document.createElement('button')
    b.className = 'ps'
    b.style.background = c
    b.dataset.color = c
    b.title = COLOR_NAMES[c] || c
    b.setAttribute('aria-label', `Board color ${COLOR_NAMES[c] || c}`)
    b.onclick = () => applyPaperBg(c)
    g.append(b)
  })
  document.querySelectorAll('#paperColorFlyout .board-preset').forEach(b => {
    b.onclick = () => applyPaperBg(b.dataset.board)
  })
}

function applyPaperBg(hex) {
  const page = current(); if (!page) return
  const rgb = normalizeHexColor(hex)
  if (!rgb) return
  const bg = '#FF' + rgb.slice(1)
  // Board colour is page data, not chrome: default to the current sheet and
  // let the flyout opt into the whole note explicitly.
  const targets = boardScope === 'all' ? S.pages.slice() : [page]
  for (const p of targets) {
    p.paper.bg = bg
    p.thumbUrl = ''
    p.dirty = true
  }
  const dark = colorLuma(rgb) < .42
  // New ink must be legible on the chosen board. Only near-neutral ink is
  // flipped; saturated red/blue/green stays readable and stays selected.
  if (dark && inkTooDarkForDarkBoard(curPen().color)) {
    curPen().color = '#FFFFFF'
    savePens()
    showHint('Dark board on - pen switched to white for contrast')
  } else if (!dark && inkTooLightForLightBoard(curPen().color)) {
    curPen().color = '#15181D'
    savePens()
    showHint('Light board on - pen switched to dark for contrast')
  }
  markPaperChanged(page)
  if (targets.length > 1) {
    refreshPages()
    // board colour is page data: neighbouring stills must repaint too
    for (let i = 0; i < S.pages.length; i++) {
      if (i === S.currentPage) continue
      S.pages[i].stillDirty = true
      queueStill(i)
    }
  }
  syncPaperPanel()
  syncPaperColorFlyout()
  syncPenFlyout()
}

function applyPaperHex({ quiet = false } = {}) {
  const input = $('paperHex')
  if (!input) return
  const hex = normalizeHexColor(input.value)
  if (!hex) {
    setHexError('paper', 'Enter 3 or 6 hex digits, for example #15181D.')
    if (!quiet) input.focus()
    return
  }
  clearHexError('paper')
  input.value = hex
  applyPaperBg(hex)
}

let boardScope = 'page'
function setBoardScope(scope) {
  boardScope = scope === 'all' ? 'all' : 'page'
  syncPaperColorFlyout()
}

function syncPaperColorFlyout() {
  const page = current()
  const input = $('paperHex')
  if (!page || !input) return
  const rgb = '#' + String(page.paper.bg || '#FFFFFFFF').slice(-6).toUpperCase()
  if (document.activeElement !== input) input.value = rgb
  input.setAttribute('aria-invalid', 'false')
  const err = $('paperHexError')
  if (err) err.textContent = ''
  const pageScope = $('paperScopePage'), allScope = $('paperScopeAll')
  if (pageScope) pageScope.setAttribute('aria-pressed', boardScope === 'page' ? 'true' : 'false')
  if (allScope) {
    allScope.setAttribute('aria-pressed', boardScope === 'all' ? 'true' : 'false')
    allScope.title = `Apply to all ${S.pages.length} page${S.pages.length === 1 ? '' : 's'} in this note`
  }
  document.querySelectorAll('#paperPalette .ps').forEach(s => {
    s.classList.toggle('sel', s.dataset.color.toUpperCase() === rgb)
  })
  document.querySelectorAll('#paperColorFlyout .board-preset').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.board.toUpperCase() === rgb ? 'true' : 'false')
  })
  const custom = $('paperCustomBtn')
  if (custom) {
    const sw = custom.querySelector('span')
    if (sw) sw.style.background = rgb
    custom.title = `Current board color ${rgb}`
  }
}

// ---------- interface theme (chrome only; board colour is page data) ----------
function initTheme() {
  let saved = null
  try { saved = localStorage.getItem('wc:theme') } catch { /* ignore */ }
  setTheme(saved === 'dark', { persist: false })
}

const boardHex = page => '#' + String(page?.paper?.bg || '#FFFFFFFF').slice(-6).toUpperCase()

function setTheme(dark, { persist = true } = {}) {
  document.body.classList.toggle('dark', !!dark)
  const b = $('btnTheme')
  if (b) {
    b.setAttribute('aria-pressed', dark ? 'true' : 'false')
    b.title = dark ? 'Switch to light mode' : 'Switch to dark mode'
    const use = b.querySelector('use')
    if (use) use.setAttribute('href', dark ? '#ic-sun' : '#ic-moon')
  }
  if (persist) {
    try { localStorage.setItem('wc:theme', dark ? 'dark' : 'light') } catch { /* ignore */ }
  }
  // The native Windows caption overlay sits above the page and has its own
  // colour; without this the dark theme leaves a white rectangle in the corner.
  try { window.WriteCanvasHost?.setTitleBarTheme?.(!!dark) } catch { /* ignore */ }
}

// ---------- note details (rename / project folder; not the normal save path) ----------
let saveFlyoutNoteId = 0
async function fillSaveFlyout() {
  saveFlyoutNoteId = S.noteId || 0
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  // automatic note naming: an unnamed note suggests today's date
  $('saveTitle').value = (S.note && S.note.name && S.note.name !== 'Untitled') ? S.note.name : iso
  let lib = null
  try { lib = await bridge.library() } catch { /* location is informational */ }
  const pathEl = $('saveLibraryPath')
  if (pathEl) {
    pathEl.textContent = lib && lib.root ? lib.root : 'Library location unavailable'
    pathEl.title = lib && lib.root ? lib.root : ''
  }
  const folder = lib && lib.items && S.note
    ? lib.items.find(i => i.id === S.note.parent && i.type === 'folder')
    : null
  $('saveProject').value = folder ? folder.name : ''
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
  // the fields belong to the note that was open when the flyout was filled
  if (!S.noteId || saveFlyoutNoteId !== S.noteId) {
    closeToolFlyout('saveFlyout')
    return
  }
  const noteId = S.noteId
  const title = $('saveTitle').value.trim()
  const project = $('saveProject').value.trim()
  if (title && S.note && title !== S.note.name) {
    const updated = await bridge.renameItem(noteId, title)
    // the flyout can outlive the note it was opened for
    if (S.noteId !== noteId || !S.note) return
    S.note.name = updated && updated.name ? updated.name : title
    updateTitle()
  }
  const cur = await currentProjectName()
  if (S.noteId !== noteId || !S.note) return
  if (project !== cur) {
    if (!project) {
      await bridge.moveItem(noteId, 1)
      if (S.noteId === noteId && S.note) S.note.parent = 1
    } else {
      const lib = await bridge.library()
      const f = (lib.items || []).find(i => i.type === 'folder' && i.parent === 1 && i.name.toLowerCase() === project.toLowerCase())
      const folder = f || await bridge.createFolder(project, 1)
      await bridge.moveItem(noteId, folder.id)
      if (S.noteId === noteId && S.note) S.note.parent = folder.id
    }
  }
  // hide the dialog before the async save reports "saved": the status text and
  // the flyout close otherwise race in UI tests and in real perceived latency
  closeToolFlyout('saveFlyout')
  if (S.noteId !== noteId) return
  await saveCurrentPage()
}

async function changeLibraryFolder() {
  const btn = $('saveChangeLibrary')
  const noteId = S.noteId
  if (btn) btn.disabled = true
  try {
    // the open note belongs to the old library: persist it before the switch
    if (S.noteId) {
      const ok = await flushCurrentPage()
      if (!ok) { showHint('Library not changed — save failed'); return }
      if (S.noteId !== noteId) return
    }
    const res = await bridge.pickLibraryFolder()
    if (!res || res.canceled) return
    if (res.error) { showHint(`Library not changed — ${res.error}`); return }
    if (res.unchanged) { showHint('That folder is already your library'); return }
    closeToolFlyout('saveFlyout')
    closeNote()
    if (host && host.selectNote) host.selectNote(0)
    try { localStorage.removeItem('wc:lastNote') } catch { }
    showHint(`Library changed — new saves go to ${res.root}`)
  } catch (err) {
    showHint(`Library not changed — ${err && err.message ? err.message : 'unknown error'}`)
  } finally {
    if (btn) btn.disabled = false
  }
}

// ---------- export ----------
function exportItems() {
  const total = S.pages.length || 1
  const page = total > 1 ? `This page (${S.currentPage + 1}/${total})` : 'This page'
  return [
    { label: `${page} as PNG…`, act: () => exportImg('png') },
    { label: `${page} as JPEG…`, act: () => exportImg('jpg') },
    { label: `Entire note as PDF (all ${total} page${total === 1 ? '' : 's'})…`, act: () => exportPDF() },
    { label: 'Replay as GIF…', act: () => exportGif() },
  ]
}

function exportName(filePath) {
  return String(filePath || '').split(/[\\/]/).pop() || String(filePath || '')
}

function exportDone(label, filePath) {
  if (filePath) showHint(`${label} saved: ${exportName(filePath)}`)
}

function exportFailed(label, err) {
  console.error(label, err)
  const msg = err && err.message ? err.message : 'unknown error'
  showHint(`${label} failed — ${msg}`)
}

function menuPoint(anchor) {
  if (!anchor) return [300, 60]
  const r = anchor.getBoundingClientRect()
  return [r.left, r.bottom + 6]
}

async function exportMenu(anchor = null) {
  const { pick } = await import('./ctx.js')
  pick(exportItems(), ...menuPoint(anchor))
}

// The download half of the Save split button. The working save is the library
// note itself (a PNG per page with editable stroke data), so there is exactly
// one Save here. Exports live below it; the portable .wcanvas project file is
// in the File menu with Import, not presented as a second way to save.
async function saveMenu(anchor = null) {
  const { pick } = await import('./ctx.js')
  const items = [
    { label: `Save all changes (${modShortcut('S')})`, act: () => saveCurrentPage() },
    { label: 'Save editable copy (.wcanvas)…', act: () => exportProject() },
    '-',
    { header: 'Export' },
    ...exportItems(),
    '-',
    {
      label: 'Note details & library location…',
      act: async () => {
        await fillSaveFlyout()
        openToolFlyout('saveFlyout', $('btnSaveMore'))
      },
    },
  ]
  pick(items, ...menuPoint(anchor))
}
async function exportImg(kind, idx = S.currentPage) {
  const page = S.pages[idx]
  const note = S.note
  if (!page || !S.noteId || !note) return
  if (textEdit && idx === S.currentPage) finishText(false)
  try {
    const bytes = await flattenBytes(page, kind === 'png' ? 'image/png' : 'image/jpeg')
    const name = `${note.name}#${String(idx + 1).padStart(2, '0')}`
    exportDone(kind === 'png' ? 'PNG' : 'JPEG', await bridge.exportAs(bytes, name, kind))
  } catch (err) {
    exportFailed(kind === 'png' ? 'PNG export' : 'JPEG export', err)
  }
}
async function exportPDF() {
  if (!S.noteId || !S.pages.length) return
  if (textEdit) finishText(false)
  const pages = S.pages.slice()
  const paper = (current()?.paper) || pages[0].paper || DEFAULT_PAPER()
  try {
    const bytes = []
    for (const page of pages) bytes.push(await flattenBytes(page, 'image/png'))
    const mm = paperMM(paper.size, paper.orientation)
    const file = await bridge.exportPDF(bytes, { widthMM: mm.w, heightMM: mm.h })
    exportDone(`PDF (${pages.length} page${pages.length === 1 ? '' : 's'})`, file)
  } catch (err) {
    exportFailed('PDF export', err)
  }
}
async function exportGif() {
  const page = current(); if (!page || !S.noteId) return
  const noteId = S.noteId
  const idx = S.currentPage
  const noteName = S.note ? S.note.name : 'replay'
  // sINK is encoded during save; persist first, then read the GIF back.
  let gifBytes = null
  if (page.recorder.frames.length) {
    const ok = await saveCurrentPage()
    if (!ok) { showHint('Replay export cancelled — save failed'); return }
    if (S.noteId !== noteId) return
    const res = await bridge.loadNote(noteId)
    const p = res?.pages?.[idx]
    if (p?.inkGif) gifBytes = new Uint8Array(p.inkGif)
  } else if (page.inkGif) gifBytes = page.inkGif
  if (!gifBytes) { showHint('Replay export — no frames recorded for this page yet'); return }
  try {
    exportDone('Replay GIF', await bridge.exportAs(gifBytes, `${noteName}-replay`, 'gif'))
  } catch (err) {
    exportFailed('Replay export', err)
  }
}
// Portable .wcanvas project: a snapshot of every saved page (vector strokes +
// replay + paper), separate from image/PDF export. Flush the open page first
// so the file is current; main builds the zip from disk pages.
async function exportProject() {
  if (!S.noteId) return
  const noteId = S.noteId
  // main builds the zip from disk, so every dirty page (not just the visible
  // one) must be flushed first — otherwise the project misses recent sheets
  const ok = await flushCurrentPage()
  if (!ok) { showHint('Editable copy cancelled — save failed'); return }
  if (S.noteId !== noteId) return
  try {
    const r = await bridge.exportProject(noteId)
    if (r && r.path) showHint(`Editable copy saved: ${exportName(r.path)} (${r.pages} page${r.pages === 1 ? '' : 's'})`)
  } catch (err) {
    exportFailed('Editable copy export', err)
  }
}

// ---------- title / rename ----------
function updateTitle() {
  const name = S.note ? S.note.name : 'No note'
  const pages = S.note && S.pages.length ? `(${S.currentPage + 1}/${S.pages.length})` : ''
  $('btnTitle').textContent = name
  const pagesEl = document.getElementById('tbPages')
  if (pagesEl) { pagesEl.textContent = pages; pagesEl.classList.toggle('hidden', !pages) }
  document.title = `${name} ${pages} ‎- WriteCanvas`
  const cap = document.getElementById('capTitle')
  if (cap) cap.textContent = document.title
}

async function renameOpenNote() {
  if (!S.note) return
  const noteId = S.noteId
  const oldName = S.note.name
  const { promptText } = await import('./ctx.js')
  const name = await promptText('Note title', oldName)
  if (!name || name === oldName || S.noteId !== noteId) return
  // Renaming moves the page files; let queued writes land first so the save
  // path and the rename cannot target different names.
  const saved = await flushCurrentPage()
  if (!saved) { showHint('Save failed — rename cancelled'); return }
  if (S.noteId !== noteId) return
  try {
    const updated = await bridge.renameItem(noteId, name)
    // the prompt can outlive a note switch; never rename A's title on B
    if (S.noteId !== noteId || !S.note) return
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
  applyShortcutHints()
  initShortcutSheet()

  // pen flyout: labelled type cards, large palette, hex input, saved pens, size
  const typeRow = $('penTypeRow')
  PEN_TYPE_ORDER.forEach(t => {
    const b = document.createElement('button')
    b.className = 'penType'
    b.dataset.type = t
    const meta = PEN_TYPES[t]
    b.title = `${meta.label} — ${meta.desc}`
    b.setAttribute('aria-pressed', 'false')
    b.setAttribute('aria-label', `${meta.label}: ${meta.desc}`)
    b.innerHTML = `<svg aria-hidden="true"><use href="#pt-${t}"/></svg><canvas class="pt-sample" width="128" height="44" aria-hidden="true"></canvas><span class="pt-label">${meta.label.replace('Highlighter squared', 'Hi-Square')}</span><span class="pt-desc">${meta.desc}</span>`
    b.onclick = () => {
      curPen().type = t
      savePens()
      syncPenFlyout()
      drawWave()
    }
    typeRow.append(b)
  })
  drawPenTypeSamples()
  const pgrid = $('penPalette')
  PEN_PALETTE.filter(c => c !== '#RAINBOW').forEach(c => {
    const b = document.createElement('button')
    b.className = 'ps'
    b.style.background = c
    b.dataset.color = c
    b.title = COLOR_NAMES[c] || c
    b.setAttribute('aria-label', `Color ${COLOR_NAMES[c] || c}`)
    b.onclick = () => selectColor(c)
    pgrid.append(b)
  })
  $('customColorBtn').onclick = () => openColorPopover('pen', $('customColorBtn'))
  $('customColorBtn').setAttribute('aria-haspopup', 'dialog')
  $('customColorBtn').setAttribute('aria-expanded', 'false')
  $('cpClose').onclick = closeColorPopover
  $('cpApply').onclick = applyColorPopoverHex
  $('cpHex').addEventListener('input', () => {
    $('cpHex').setAttribute('aria-invalid', 'false')
    const err = $('cpError')
    if (err) err.textContent = ''
  })
  $('cpHex').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); applyColorPopoverHex() }
    else if (e.key === 'Escape') { e.preventDefault(); closeColorPopover() }
  })
  bindColorPopoverCanvas($('cpSV'), pickColorPopoverSV)
  bindColorPopoverCanvas($('cpHue'), pickColorPopoverHue)
  $('penFlyout').addEventListener('scroll', () => { if (CP.open) placeColorPopover() })
  $('paperColorFlyout').addEventListener('scroll', () => { if (CP.open) placeColorPopover() })
  $('penHexApply').onclick = applyPenHex
  $('penHex').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); applyPenHex() }
    else if (e.key === 'Escape') { e.preventDefault(); syncPenFlyout(); e.target.blur() }
  })
  $('penHex').addEventListener('input', e => clearHexError('pen'))
  $('penHex').addEventListener('blur', () => { if ($('penHex').value.trim()) applyPenHex({ quiet: true }) })
  $('penClose').onclick = () => closeToolFlyout('penFlyout')
  $('penDone').onclick = () => closeToolFlyout('penFlyout')
  $('width').addEventListener('input', e => {
    curPen().widthMM = parseFloat(e.target.value)
    updateWidthFill()
    $('widthReadout').textContent = `${curPen().widthMM.toFixed(1)} mm`
    drawWave()
    savePens()
  })
  loadPens()
  loadToolPrefs()
  buildQuickPalette()
  // restore the saved active pen *after* loading slots; selectColor() saves the
  // slots and must never run before loadPens() or it would overwrite them
  selectColor(curPen().color)
  syncToolButtons()
  renderPenStack()
  syncPenFlyout()
  buildPaperThumbs()
  buildPaperPalette()
  syncPaperPanel()
  buildShapeGrid()
  $('shapeClose').onclick = () => closeToolFlyout('shapeFlyout')
  $('selectClose').onclick = () => closeToolFlyout('selectFlyout')
  $('rulerClose').onclick = () => closeToolFlyout('rulerFlyout')
  $('eraserClose').onclick = () => closeToolFlyout('eraserFlyout')
  initTheme()

  $('btnMenu').onclick = () => toggleLibraryFlyout()
  $('btnSave').onclick = () => { closeToolFlyout('saveFlyout'); saveCurrentPage() }
  $('btnSaveMore').onclick = () => saveMenu($('btnSaveMore'))
  $('btnUndo').onclick = undo
  $('btnRedo').onclick = redo
  $('btnTitle').onclick = renameOpenNote
  $('btnNew').onclick = () => host && host.cmdNewNote && host.cmdNewNote()
  $('btnPaper').onclick = () => togglePaperPanel()
  $('btnSaveConfirm').onclick = saveFromFlyout
  $('saveClose').onclick = () => closeToolFlyout('saveFlyout')
  $('saveOpenLibrary').onclick = () => bridge.revealLibraryFolder()
  $('saveChangeLibrary').onclick = () => changeLibraryFolder()
  $('btnShortcuts').onclick = () => {
    if (libCloser) toggleLibraryFlyout()
    $('btnMenu').focus()
    openShortcutSheet()
  }
  $('saveTitleClear').onclick = () => { $('saveTitle').value = ''; $('saveTitle').focus() }
  $('paperBrl').addEventListener('change', applyBorderLines)
  $('ppPortrait').onclick = () => applyOrientation('portrait')
  $('ppLandscape').onclick = () => applyOrientation('landscape')
  $('ppBgColor').onclick = () => {
    boardScope = 'page'
    syncPaperColorFlyout()
    openToolFlyout('paperColorFlyout', $('ppBgColor'))
  }
  $('paperScopePage').onclick = () => setBoardScope('page')
  $('paperScopeAll').onclick = () => setBoardScope('all')
  $('paperColorClose').onclick = () => closeToolFlyout('paperColorFlyout')
  $('paperCustomBtn').onclick = () => openColorPopover('paper', $('paperCustomBtn'))
  $('paperCustomBtn').setAttribute('aria-haspopup', 'dialog')
  $('paperCustomBtn').setAttribute('aria-expanded', 'false')
  $('paperHexApply').onclick = applyPaperHex
  $('paperHex').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); applyPaperHex() }
    else if (e.key === 'Escape') { e.preventDefault(); syncPaperColorFlyout(); e.target.blur() }
  })
  $('paperHex').addEventListener('input', () => clearHexError('paper'))
  $('paperHex').addEventListener('blur', () => { if ($('paperHex').value.trim()) applyPaperHex({ quiet: true }) })
  $('btnTheme').onclick = () => setTheme(!document.body.classList.contains('dark'))
  $('ppPaneOn').onclick = () => setWritingPane(true)
  $('ppPaneOff').onclick = () => setWritingPane(false)
  $('btnAddPage').onclick = addPage
  $('btnPrevPage').onclick = () => setPage(S.currentPage - 1, false, { smooth: true })
  $('btnNextPage').onclick = () => setPage(S.currentPage + 1, false, { smooth: true })
  syncPageNav()
  wireToolbarToggles()
  stackInnerClass()

  // pointer + wheel. Listeners sit on the stack so a gesture can start on any
  // sheet of the continuous run and switch the active page itself.
  const stack = $('canvasStack')
  stack.addEventListener('pointerdown', onPointerDown)
  stack.addEventListener('pointermove', onPointerMove)
  stack.addEventListener('pointerup', onPointerUp)
  stack.addEventListener('pointercancel', onPointerCancel)
  stack.addEventListener('contextmenu', e => e.preventDefault())
  // Double-click a text box with the Select tool to edit its content in place.
  stack.addEventListener('dblclick', e => {
    if (noteBusy || promptOpen() || isTextEditing()) return
    if (e.target.closest('button, input, textarea, select, a, [contenteditable="true"], #selBar, #rulerCtl, #textEditBar, #titleStrip')) return
    if (S.tool !== 'lasso' && S.tool !== 'text') return
    const page = current(); if (!page) return
    const { x, y } = pageCoords(e)
    const hit = textAt(page, x, y)
    if (hit) { e.preventDefault(); beginTextEdit(page, hit) }
  })
  $('canvasHost').addEventListener('scroll', onHostScroll, { passive: true })
  $('canvasHost').addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      wheelOverscroll = 0
      e.preventDefault()
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15)
      return
    }
    // Normal wheel/trackpad scrolling is left untouched: it now runs across
    // every sheet of the stack. Only at the very bottom of the last sheet does
    // continued downward scrolling become a deliberate "add a page" gesture.
    const host = $('canvasHost')
    // a manual wheel means the reader has taken over: the active page should
    // follow immediately even if a rail jump is still animating
    scrollSyncLock = 0
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? host.clientHeight : 1)
    if (!S.pages.length || dy <= 0) {
      wheelOverscroll = 0
      hidePullHint()
      return
    }
    if (performance.now() < wheelAddLock) return
    const atBottom = host.scrollHeight - host.clientHeight - host.scrollTop <= 2
    if (!atBottom || S.currentPage < S.pages.length - 1) {
      wheelOverscroll = 0
      hidePullHint()
      return
    }
    wheelOverscroll += dy
    const commit = Math.max(250, host.clientHeight * 0.28)
    if (wheelOverscroll < commit) {
      const display = wheelOverscroll * (pullCommitLimit() / commit)
      updatePullHint(display, 'wheel', 'add')
      return
    }
    wheelOverscroll = 0
    wheelAddLock = performance.now() + 900
    hidePullHint()
    addPage()
  }, { passive: false })

  window.addEventListener('keydown', e => {
    if (isShortcutSheetOpen()) return
    const typing = isTextEditing()
    if (e.code === 'Space' && !e.repeat && !typing) {
      S.spaceDown = true
      stackInnerClass()
    }
    const c = e.ctrlKey || e.metaKey
    // Help is deliberately discoverable: ? for everyone, Mod+/ for muscle memory.
    if ((e.key === '?' || (c && e.code === 'Slash')) && !typing && !promptOpen()) {
      e.preventDefault()
      openShortcutSheet()
      return
    }
    if (c && !typing && !promptOpen() && !e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      toggleLibraryFlyout()
      return
    }
    // PageUp/PageDown with Ctrl switches sheets without reaching for the rail.
    if (c && !typing && (e.key === 'PageDown' || e.key === 'PageUp')) {
      e.preventDefault()
      setPage(S.currentPage + (e.key === 'PageDown' ? 1 : -1), false, { smooth: true })
      return
    }
    // inside a text box, Ctrl+Z/Y must undo the text, not the canvas ink
    if (c && !typing && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
    if (c && !typing && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo() }
    if (c && !typing && e.key.toLowerCase() === 'c') { if (selectionHasItems()) { e.preventDefault(); editCopy(); return } }
    if (c && !typing && e.key.toLowerCase() === 'x') { if (selectionHasItems()) { e.preventDefault(); editCut(); return } }
    if (c && !typing && e.key.toLowerCase() === 'v') { e.preventDefault(); editPaste(); return }
    // Delete removes whatever the Select tool holds (strokes, shapes, texts).
    if (!typing && !promptOpen() && !c && (e.key === 'Delete' || e.key === 'Backspace') && selectionHasItems()) {
      e.preventDefault(); selectionDelete(); return
    }
    if (c && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrentPage() }
    if (c && !typing && !promptOpen() && e.key.toLowerCase() === 'e') { e.preventDefault(); exportMenu($('btnSaveMore')) }
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
        closeColorPopover()
        for (const f of ['shapeFlyout', 'selectFlyout', 'rulerFlyout', 'eraserFlyout', 'penFlyout', 'saveFlyout', 'paperColorFlyout']) closeToolFlyout(f)
        if (libCloser) toggleLibraryFlyout()
        $('paperPanel').classList.add('hidden')
        if (S.tool === 'shape') setTool('pen')
        if (S.rulerOn) toggleRuler()
        clearSelection()
      }
    }
  })
  window.addEventListener('resize', () => {
    if (CP.open) placeColorPopover()
    if (!S.flyoutOpenTool || !flyoutAnchorEl) return
    const f = $(S.flyoutOpenTool)
    if (f && !f.classList.contains('hidden')) placeFlyout(f, flyoutAnchorEl)
  })

  window.addEventListener('keyup', e => {
    if (e.code === 'Space') { S.spaceDown = false; stackInnerClass() }
  })
  window.addEventListener('blur', () => {
    // Losing the window ends the in-flight gesture (the pointerup may never
    // arrive) and clears a held Space so the next click is not a pan.
    activePointer = null
    cancelGesture()
    S.spaceDown = false
    stackInnerClass()
    const page = current()
    if (page && (page.dirty || page.recorder.changed)) saveCurrentPage()
  })

  // host menu commands
  bridge && bridge.on && bridge.on('cmd', (cmd, arg) => {
    // Native accelerators bypass DOM focus; navigation/export commands must
    // not fire over a text box or the rename/delete prompt.
    const fieldBusy = isTextEditing() || promptOpen()
    if (fieldBusy && ['new-note', 'new-folder', 'import', 'import-project', 'export', 'export-project', 'reveal-library'].includes(cmd)) return
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
      case 'export': exportMenu($('btnSaveMore')); break
      case 'shortcuts': if (!promptOpen()) openShortcutSheet(); break
      case 'new-note': app.cmdNewNote(); break
      case 'new-folder': app.cmdNewFolder(); break
      case 'import': app.cmdImport(); break
      case 'import-project': app.cmdImportProject(); break
      case 'export-project': exportProject(); break
      case 'reveal-library': bridge.revealLibraryFolder(); break
      case 'zoom': app.cmdZoom(arg); break
      case 'edit-undo': editUndo(); break
      case 'edit-redo': editRedo(); break
      case 'edit-copy': editCopy(); break
      case 'edit-cut': editCut(); break
      case 'edit-paste': editPaste(); break
    }
  })
  app.cmdZoom = arg => {
    if (arg && arg.reset) { S.zoom = 1; S.hadZoom = true; applyTransform(); return }
    zoomCenter(arg && arg.dir ? arg.dir : 1)
  }
}

function stackInnerClass() {
  const inner = $('stackInner')
  inner.classList.toggle('panning', S.spaceDown || S.tool === 'view')
  inner.classList.toggle('shape-tool', S.tool === 'shape')
  // A pen drag must be ink, never a browser scroll gesture. All inking tools
  // opt out of native touch/pen panning; Pan/View keep native scrolling. The
  // class also lands on #canvasStack so a gesture starting on a neighbouring
  // sheet is ink too, never a scroll.
  const inking = !S.spaceDown && S.tool !== 'pan' && S.tool !== 'view'
  inner.classList.toggle('inking', inking)
  const stack = $('canvasStack')
  if (stack) stack.classList.toggle('inking', inking)
}

function isTextEditing() {
  const a = document.activeElement
  if (!a) return false
  return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable
}

function promptOpen() {
  const d = $('dlg')
  return !!d && !d.classList.contains('hidden')
}

// ---------- edit commands (Edit menu + Ctrl/Cmd chords) ----------
// The native Edit menu routes through the renderer now, because a menu
// accelerator would otherwise swallow the chord before the page ever sees it.
// A focused text field or prompt still gets the real native editing behaviour;
// everywhere else the commands act on the canvas selection.
function editContextIsNative() {
  return isTextEditing() || promptOpen()
}

function editNativeOr(op, fallback) {
  if (editContextIsNative()) {
    if (bridge && bridge.editNative) bridge.editNative(op).catch(() => {})
    else if (fallback) document.execCommand(fallback)
    return true
  }
  return false
}

function editUndo() {
  if (editNativeOr('undo', 'undo')) return
  undo()
}

function editRedo() {
  if (editNativeOr('redo', 'redo')) return
  redo()
}

function editCopy() {
  if (editNativeOr('copy', 'copy')) return
  selectionCopy()
}

function editCut() {
  if (editNativeOr('cut', 'cut')) return
  if (!selectionHasItems()) return
  selectionCopy()
  selectionDelete()
}

function editPaste() {
  if (editNativeOr('paste', null)) return
  selectionPaste()
}

export function selectColor(c) {
  let hex = normalizeHexColor(c)
  if (!hex) return
  // The swatch palette is shared by light and dark boards. Black is a valid
  // choice on paper, but on the midnight board it is effectively invisible;
  // keep the action useful by flipping only the neutral near-black colours.
  const page = current()
  if (page && colorLuma(boardHex(page)) < .32 && inkTooDarkForDarkBoard(hex)) {
    hex = '#FFFFFF'
    showHint('Black is hard to see on this dark page - pen switched to white')
  }
  curPen().color = hex
  savePens()
  syncPenFlyout()
}

// Accept #RGB, RRGGBB and ARGB/HTML #AARRGGBB input. Returns #RRGGBB or null.
function normalizeHexColor(raw) {
  let s = String(raw || '').trim().replace(/^#/, '')
  if (s.length === 8) s = s.slice(2)
  if (s.length === 3) s = s.split('').map(ch => ch + ch).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
  return '#' + s.toUpperCase()
}

function setHexField(which, color) {
  const input = $(which + 'Hex')
  if (!input) return
  const hex = normalizeHexColor(color)
  if (!hex) return
  // never clobber a value the user is actively editing
  if (document.activeElement !== input) input.value = hex
  input.setAttribute('aria-invalid', 'false')
  clearHexError(which)
}

function setHexError(which, message) {
  const input = $(which + 'Hex')
  const err = $(which + 'HexError')
  if (input) input.setAttribute('aria-invalid', 'true')
  if (err) err.textContent = message
}

function clearHexError(which) {
  const input = $(which + 'Hex')
  const err = $(which + 'HexError')
  if (input) input.setAttribute('aria-invalid', 'false')
  if (err) err.textContent = ''
}

function applyPenHex({ quiet = false } = {}) {
  const input = $('penHex')
  if (!input) return
  const hex = normalizeHexColor(input.value)
  if (!hex) {
    setHexError('pen', 'Enter 3 or 6 hex digits, for example #0B63C5.')
    if (!quiet) input.focus()
    return
  }
  clearHexError('pen')
  input.value = hex
  selectColor(hex)
}

// ---------- toolbar pen control: one readable card, not ten coloured dots ----------
function renderPenStack() {
  const stack = $('tbPens')
  if (!stack) return
  const pen = curPen()
  const t = PEN_TYPES[pen.type] || PEN_TYPES.marker
  const b = document.createElement('button')
  b.id = 'tbPenCurrent'
  b.className = 'tb-pen-current' + (S.tool === 'pen' ? ' is-pen' : '')
  b.setAttribute('aria-haspopup', 'dialog')
  b.setAttribute('aria-expanded', S.flyoutOpenTool === 'penFlyout' ? 'true' : 'false')
  const title = `${t.label} · ${pen.widthMM.toFixed(1)} mm · ${COLOR_NAMES[pen.color] || pen.color}`
  b.title = title
  b.setAttribute('aria-label', `Current pen: ${title}. Open pen settings`)
  b.innerHTML = `<span class="tp-dot" style="background:${pen.color};color:${colorLuma(pen.color) > .58 ? '#15181d' : '#fff'}"><svg aria-hidden="true"><use href="#pt-${pen.type || 'marker'}"/></svg></span><span class="tp-copy"><span class="tp-name">${t.label.replace('Highlighter squared', 'Hi-Square')}</span><span class="tp-meta">${pen.widthMM.toFixed(1)} mm</span></span><span class="tp-chevron" aria-hidden="true"></span>`
  b.onclick = () => {
    const wasOpen = S.flyoutOpenTool === 'penFlyout'
    if (S.tool !== 'pen') setTool('pen')
    syncPenFlyout()
    const anchor = $('tbPenCurrent') || b
    if (wasOpen) closeToolFlyout('penFlyout')
    else openToolFlyout('penFlyout', anchor, { centered: true })
  }
  stack.replaceChildren(b)
  if (S.flyoutOpenTool === 'penFlyout') flyoutAnchorEl = b
  syncFlyoutAria()
}

function buildQuickPalette() {
  const wrap = $('tbQuick')
  if (!wrap) return
  wrap.innerHTML = ''
  QUICK_PALETTE.forEach(c => {
    const b = document.createElement('button')
    b.className = 'tb-swatch'
    b.dataset.color = c
    b.style.setProperty('--sw', c)
    b.title = COLOR_NAMES[c] || c
    b.setAttribute('aria-label', `Quick color ${COLOR_NAMES[c] || c}`)
    b.onclick = () => {
      if (S.tool !== 'pen') setTool('pen')
      selectColor(c)
    }
    wrap.append(b)
  })
}

function syncQuickPalette() {
  const c = curPen().color
  document.querySelectorAll('#tbQuick .tb-swatch').forEach(s => {
    const on = s.dataset.color === c
    s.classList.toggle('sel', on)
    s.setAttribute('aria-pressed', on ? 'true' : 'false')
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

// A red marker on a dark board is perfectly readable; only neutral near-black
// ink disappears. Chroma keeps saturated hues from being swapped to white.
function inkTooDarkForDarkBoard(hex) {
  const h = String(hex || '#000000').replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0')
  const r = parseInt(full.slice(0, 2), 16) || 0
  const g = parseInt(full.slice(2, 4), 16) || 0
  const b = parseInt(full.slice(4, 6), 16) || 0
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255
  return luma < .30 && chroma < .16
}

// The inverse: a white pen left over from a dark board vanishes on paper.
// Only near-white neutrals are swapped, so pale colours the user chose stay.
function inkTooLightForLightBoard(hex) {
  const h = String(hex || '#FFFFFF').replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, 'f')
  const r = parseInt(full.slice(0, 2), 16) || 0
  const g = parseInt(full.slice(2, 4), 16) || 0
  const b = parseInt(full.slice(4, 6), 16) || 0
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255
  return luma > .88 && chroma < .08
}

function syncToolButtons() {
  const map = { erase: 'tbEraser', laser: 'tbLaser', lasso: 'tbLasso', view: 'tbEye', shape: 'tbObject', text: 'tbText' }
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

// toggles: laser/eye switch the active tool; select, ruler, shapes and eraser
// open the picker the person chooses from (their last pick is already marked)
// and choosing applies it at once, so all four cards behave the same way
function wireToolbarToggles() {
  const eraserBtn = $('tbEraser')
  if (eraserBtn) eraserBtn.onclick = () => { syncEraserFlyout(); openToolFlyout('eraserFlyout', eraserBtn) }
  const objBtn = $('tbObject')
  if (objBtn) objBtn.onclick = () => openToolFlyout('shapeFlyout', objBtn)
  $('tbLaser').onclick = () => setTool(S.tool === 'laser' ? 'pen' : 'laser')
  // Select, Ruler and Eraser open their choosers on click, like the Shapes
  // gallery: the remembered pick is already marked when the card appears.
  $('tbRuler').onclick = () => { syncRulerFlyout(); openToolFlyout('rulerFlyout', $('tbRuler')) }
  $('tbLasso').onclick = () => { syncSelectFlyout(); openToolFlyout('selectFlyout', $('tbLasso')) }
  $('tbText').onclick = () => setTool(S.tool === 'text' ? 'pen' : 'text')
  $('tbEye').onclick = () => setTool(S.tool === 'view' ? 'pen' : 'view')
  // Picking a mode applies it and closes the picker, exactly like picking a
  // shape: one click in the card, one click on the choice.
  const sll = $('selLasso'), slc = $('selClick')
  if (sll) sll.onclick = () => applySelectMode('lasso')
  if (slc) slc.onclick = () => applySelectMode('click')
  const rru = $('rulRuler'), rpr = $('rulProtractor')
  if (rru) rru.onclick = () => applyRulerMode('ruler')
  if (rpr) rpr.onclick = () => applyRulerMode('protractor')
  // 'drag' was an invented fourth mode that only erased after the pointer had
  // moved — the same tool as 'stroke' with a threshold, which made the flyout
  // read as duplicated options. The factory flyout lists stroke / segment
  // sizes / sheet only.
  if (S.eraserMode === 'drag') S.eraserMode = 'stroke'
  const est = $('erStroke'), esg = $('erSegment'), esh = $('erSheet')
  if (est) est.onclick = () => applyEraserMode('stroke')
  if (esg) esg.onclick = () => applyEraserMode('segment')
  if (esh) esh.onclick = () => applyEraserMode('sheet')
  document.querySelectorAll('#erSizes .er-chip').forEach(ch => {
    ch.onclick = () => { S.eraserMM = parseFloat(ch.dataset.mm) || 5; saveToolPrefs(); syncEraserFlyout() }
  })
  syncSelectFlyout()
  syncEraserFlyout()
  syncRulerFlyout()
}

const SELECT_MODE_LABEL = { lasso: 'Lasso', click: 'Click' }
const RULER_MODE_LABEL = { ruler: 'Ruler', protractor: 'Protractor' }
const ERASER_MODE_LABEL = { stroke: 'Stroke', segment: 'Segment', sheet: 'Sheet' }

// Picking in the chooser applies it at once and closes the picker — the same
// one-click contract as picking a shape in the Shapes gallery.
function applySelectMode(mode) {
  S.selectMode = mode === 'click' ? 'click' : 'lasso'
  saveToolPrefs()
  closeToolFlyout('selectFlyout')
  setTool('lasso')
  showHint(S.selectMode === 'click'
    ? 'Select on — tap a stroke or text box, then drag inside the box to move it'
    : 'Select on — circle strokes and text, then drag inside the box to move them')
  syncSelectFlyout()
}

function applyRulerMode(mode) {
  const prev = S.rulerMode
  S.rulerMode = mode === 'protractor' ? 'protractor' : 'ruler'
  saveToolPrefs()
  const wasOn = S.rulerOn
  const page = current()
  S.rulerOn = true
  rulerRotate = null
  rulerSnapActive = false
  if (page) {
    ensureRulerVisible()
    drawRulerLayer(page)
  }
  syncToolButtons()
  closeToolFlyout('rulerFlyout')
  if (!wasOn || prev !== S.rulerMode) {
    showHint(S.rulerMode === 'protractor'
      ? 'Protractor on — a stroke that starts on the arc follows it, Esc when done'
      : 'Ruler on — a stroke that starts on the edge rides it, Esc when done')
  }
  syncRulerFlyout()
}

// Picking an eraser mode applies it, turns the eraser on and closes the card —
// the same one-click contract as Select, Ruler and the Shapes gallery.
function applyEraserMode(mode) {
  S.eraserMode = ERASER_MODE_LABEL[mode] ? mode : 'stroke'
  saveToolPrefs()
  closeToolFlyout('eraserFlyout')
  setTool('erase')
  showHint(S.eraserMode === 'segment'
    ? `Segment eraser on — ${S.eraserMM} mm, drag over the ink to rub out parts`
    : S.eraserMode === 'sheet'
      ? 'Sheet eraser on — tap a page to clear it'
      : 'Stroke eraser on — tap a stroke to remove the whole line')
  syncEraserFlyout()
}

function syncSelectFlyout() {
  const modes = { lasso: $('selLasso'), click: $('selClick') }
  for (const [k, b] of Object.entries(modes)) {
    if (!b) continue
    b.classList.toggle('active', S.selectMode === k)
    b.setAttribute('aria-pressed', S.selectMode === k ? 'true' : 'false')
  }
  const label = SELECT_MODE_LABEL[S.selectMode] || 'Lasso'
  const btn = $('tbLasso')
  if (btn) {
    btn.title = `Select strokes and text (${label} picked) — click to change`
    btn.setAttribute('aria-label', `Select strokes and text. Current pick: ${label}. Open selection modes`)
  }
}

// The RulerFlyout: straightedge or protractor, the last pick stays marked.
function syncRulerFlyout() {
  const modes = { ruler: $('rulRuler'), protractor: $('rulProtractor') }
  for (const [k, b] of Object.entries(modes)) {
    if (!b) continue
    b.classList.toggle('active', S.rulerMode === k)
    b.setAttribute('aria-pressed', S.rulerMode === k ? 'true' : 'false')
  }
  const label = RULER_MODE_LABEL[S.rulerMode] || 'Ruler'
  const btn = $('tbRuler')
  if (btn) {
    btn.title = `Ruler or protractor (${label} picked) — click to change`
    btn.setAttribute('aria-label', `Ruler or protractor. Current pick: ${label}. Open stencil choices`)
  }
}

// the factory eraser modes (SetupFlyout copy: Stroke Eraser / Segment
// Eraser - Small/Medium/Large) — sheet eraser stands in for erase-all.
function syncEraserFlyout() {
  const modes = { stroke: $('erStroke'), segment: $('erSegment'), sheet: $('erSheet') }
  for (const [k, b] of Object.entries(modes)) {
    b.classList.toggle('active', S.eraserMode === k)
    b.setAttribute('aria-pressed', S.eraserMode === k ? 'true' : 'false')
  }
  const mode = ERASER_MODE_LABEL[S.eraserMode] || 'Stroke'
  const btn = $('tbEraser')
  if (btn) {
    btn.title = `Eraser (${mode} mode) — click to change`
    btn.setAttribute('aria-label', `Eraser. Current pick: ${mode}. Open eraser options`)
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
  document.querySelectorAll('#penPalette .ps').forEach(s => {
    const on = s.dataset.color === pen.color
    s.classList.toggle('sel', on)
    s.setAttribute('aria-pressed', on ? 'true' : 'false')
  })
  setHexField('pen', pen.color)
  const width = $('width')
  if (width && Math.abs(parseFloat(width.value) - pen.widthMM) > 0.01) width.value = pen.widthMM
  updateWidthFill()
  const readout = $('widthReadout')
  if (readout) readout.textContent = `${pen.widthMM.toFixed(1)} mm`
  renderPenStack()
  syncQuickPalette()
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
  drawStrokeAlpha(ctx, cv.width, cv.height, {
    // Use the real pen type: this preview is how users tell calligraphy,
    // highlighter and hi-square apart before drawing on the page.
    type: cur.type || 'marker',
    color: cur.color,
    opacity: cur.opacity,
    width: clamp(cur.widthMM * 5, 5, 12),
    pts,
  })
}

// Small real-engine samples in the pen picker. Icons for the five pens were
// nearly indistinguishable; the rendered stroke is the honest control.
function drawPenTypeSamples() {
  document.querySelectorAll('#penTypeRow .penType').forEach(b => {
    const cv = b.querySelector('.pt-sample')
    if (!cv) return
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, cv.width, cv.height)
    const type = b.dataset.type
    const pts = []
    for (let x = 8; x <= cv.width - 8; x += 3) {
      const t = (x - 8) / (cv.width - 16)
      pts.push({
        x,
        y: cv.height * 0.55 + Math.sin(t * Math.PI * 1.7 - 0.6) * cv.height * 0.19 - t * 2,
        p: 0.62 + 0.3 * Math.sin(t * Math.PI),
      })
    }
    const sampleWidth = type === 'highlighter' ? 5 : type === 'highlighterSquared' ? 6 : type === 'calligraphy' ? 8 : type === 'pencil' ? 6 : 7
    drawStrokeAlpha(ctx, cv.width, cv.height, {
      type,
      color: '#15181D',
      width: sampleWidth,
      pts,
    })
  })
}

// The Select, Ruler and Eraser picks survive a restart, like the pen slots.
function loadToolPrefs() {
  try {
    const raw = localStorage.getItem('wc:tools')
    if (!raw) return
    const d = JSON.parse(raw)
    if (d && d.selectMode === 'click') S.selectMode = 'click'
    if (d && (d.rulerMode === 'ruler' || d.rulerMode === 'protractor')) S.rulerMode = d.rulerMode
    if (d && ERASER_MODE_LABEL[d.eraserMode]) S.eraserMode = d.eraserMode
    if (d && [2, 5, 10].includes(+d.eraserMM)) S.eraserMM = +d.eraserMM
  } catch { /* corrupted state — keep the defaults */ }
}

function saveToolPrefs() {
  try {
    localStorage.setItem('wc:tools', JSON.stringify({
      selectMode: S.selectMode, rulerMode: S.rulerMode,
      eraserMode: S.eraserMode, eraserMM: S.eraserMM,
    }))
  } catch { /* ignore */ }
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
