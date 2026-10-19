// Editor: canvas stack, tools, undo/redo, pages, save/export, replay.

import { bridge } from './bridge.js'
import { SIZES, paperDocSize, renderPaper, docMM, hexToCss, templatePathFor, TEMPLATES } from './paper.js'
import { makeStroke, addPoint, drawStrokeAlpha, drawStrokeMask, strokeIntersectsCircle, docEraseR, PEN_TYPES, PEN_TYPE_ORDER, PEN_PALETTE, DEFAULT_PEN_SLOTS } from './pen.js'
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
  eraserMM: 3,
  zoom: 1,
  spaceDown: false,
  flyoutOpenTool: null,   // id of the toolbar flyout currently open
  writingPane: true,
}

// scratch canvas for the live-stroke alpha compositing
const scratch = document.createElement('canvas')
const scratchCtx = scratch.getContext('2d')
const DEFAULT_PAPER = () => ({ size: 'letter', orientation: 'portrait', template: 'ruled', bg: '#FFFFFFFF', borderLines: true })
const newPage = paper => ({ paper: { ...paper }, strokes: [], rasterBitmap: null, undo: [], redo: [], dirty: false, recorder: new Recorder(), inkGif: null })
let host = null // App context, set by init()

function layer(id) { return $(id) }
function ctxOf(id) { return $(id).getContext('2d') }

let el = {}

function current() { return S.pages[S.currentPage] || null }
function curPen() { return S.penSlots[S.penIndex] || S.penSlots[0] }
function docSize(page) { return paperDocSize(page.paper.size, page.paper.orientation) }

function redrawInk(page) {
  const c = ctxOf('inkC'); const { w, h } = docSize(page)
  c.clearRect(0, 0, w, h)
  for (const st of page.strokes) drawStrokeAlpha(c, w, h, st)
}

// ---------- flatten (paper + raster + strokes) ----------
function flattenToCanvas(page) {
  const { w, h } = docSize(page)
  const off = document.createElement('canvas')
  off.width = w; off.height = h
  const c = off.getContext('2d')
  renderPaper(c, page.paper)
  if (page.rasterBitmap) { c.save(); c.imageSmoothingEnabled = true; c.drawImage(page.rasterBitmap, 0, 0); c.restore() }
  for (const st of page.strokes) drawStrokeAlpha(c, w, h, st)
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
  inner.style.transform = `scale(${S.zoom})`
  const stack = $('canvasStack')
  stack.style.width = (w * S.zoom) + 'px'
  stack.style.height = (h * S.zoom) + 'px'
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
  for (const id of ['paperC', 'rasterC', 'inkC', 'liveC']) {
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
}

export async function openNote(id) {
  const res = await bridge.loadNote(id)
  if (!res || !res.pages || !res.pages.length) return
  S.noteId = id
  S.note = { ...res.note }
  S.pages = res.pages.map((p, idx) => {
    const meta = p.paperMeta
    const paper = meta
      ? { size: meta.size, orientation: meta.orientation, template: meta.template, bg: meta.bgColor || '#FFFFFFFF', borderLines: meta.borderLines !== false }
      : (S.note.paper ? { ...S.note.paper } : DEFAULT_PAPER())
    const page = newPage(paper)
    page.file = p.file
    if (p.paperMeta) page.importedChunks = true
    return page
  })
  localStorage.setItem('wc:lastNote', String(id))
  if (host && host.selectNote) host.selectNote(id)
  S.hadZoom = false
  S.zoom = 1
  setPage(0)
  // decode rasters + capture replays (async, per page)
  for (let i = 0; i < res.pages.length; i++) {
    const p = res.pages[i]
    if (p.inkGif) S.pages[i].inkGif = p.inkGif
    if (!p.exists || !p.bytes) continue
    try {
      const blob = new Blob([p.bytes], { type: 'image/png' })
      const bmp = await createImageBitmap(blob)
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
  S.currentPage = i
  const page = current()
  renderPage(page)
  if (!S.hadZoom) fitZoom()
  applyTransform()
  refreshPages()
  updateTitle()
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
  const item = $('pagesBar').children[S.currentPage]
  if (item) drawThumb(item.querySelector('.pageThumb'), S.currentPage)
}

// ---------- pointer drawing ----------
let live = null // {stroke, drawnIdx}
let pan = null
let erasePending = null

function onPointerDown(e) {
  const page = current(); if (!page) return
  const stack = $('stackInner')
  stack.setPointerCapture(e.pointerId)
  const isPan = S.tool === 'pan' || S.spaceDown || e.button === 1
  if (isPan) {
    const host = $('canvasHost')
    pan = { x: e.clientX, y: e.clientY, sl: host.scrollLeft, st: host.scrollTop }
    return
  }
  if (e.button !== 0 && e.pointerType === 'mouse') return
  const { x, y } = pageCoords(e)
  const lc = ctxOf('liveC'); const { w, h } = docSize(page)
  lc.clearRect(0, 0, w, h)
  if (S.tool === 'pen') {
    live = { stroke: makeStroke(curPen(), docMM(curPen().widthMM)), drawnIdx: -1 }
    if (addPoint(live.stroke, x, y, e.pressure, docMM(0.8))) drawLiveSlice(page)
  } else if (S.tool === 'erase') {
    erasePending = []
    eraseAt(page, x, y)
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

function eraseAt(page, x, y) {
  const r = docEraseR(S.eraserMM)
  const kept = [], removed = []
  for (const st of page.strokes) (strokeIntersectsCircle(st, x, y, r) ? removed : kept).push(st)
  if (!removed.length) {
    // paint the eraser cursor
    const lc = ctxOf('liveC')
    lc.clearRect(0, 0, docSize(page).w, docSize(page).h)
    lc.strokeStyle = '#f669'; lc.fillStyle = '#4d4d4d33'
    lc.beginPath(); lc.arc(x, y, r, 0, Math.PI * 2); lc.fill(); lc.stroke()
    return
  }
  firstCommitPreCapture(page) // snapshot pre-edit state while it still exists
  page.strokes = kept
  erasePending.push(...removed)
  redrawInk(page)
  const lc = ctxOf('liveC')
  lc.clearRect(0, 0, docSize(page).w, docSize(page).h)
  lc.strokeStyle = '#f669'; lc.fillStyle = '#4d4d4d33'
  lc.beginPath(); lc.arc(x, y, r, 0, Math.PI * 2); lc.fill(); lc.stroke()
}

function onPointerMove(e) {
  const page = current(); if (!page) return
  if (pan) {
    const host = $('canvasHost')
    host.scrollLeft = pan.sl - (e.clientX - pan.x)
    host.scrollTop = pan.st - (e.clientY - pan.y)
    return
  }
  const { x, y } = pageCoords(e)
  if (live) {
    const last = live.stroke.pts[live.stroke.pts.length - 1]
    if (addPoint(live.stroke, x, y, e.pressure, docMM(0.8))) drawLiveSlice(page)
  } else if (erasePending) {
    eraseAt(page, x, y)
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

function onPointerUp(e) {
  const page = current(); if (!page) return
  if (pan) { pan = null; return }
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
    const removed = erasePending
    erasePending = null
    if (removed.length) {
      page.undo.push({ t: 'erase', strokes: removed })
      page.redo = []
      page.recorder.capture(flattenToCanvas(page))
      page.dirty = true
      scheduleAutosave()
      refreshCurrentThumb()
    }
  }
}

// ---------- undo / redo ----------
function undo() {
  const page = current(); if (!page) return
  const a = page.undo.pop()
  if (!a) return
  if (a.t === 'add') {
    const idx = page.strokes.lastIndexOf(a.stroke)
    if (idx >= 0) page.strokes.splice(idx, 1)
    page.redo.push(a)
  } else if (a.t === 'erase') {
    page.strokes.push(...a.strokes)
    page.redo.push(a)
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
  if (a.t === 'add') {
    page.strokes.push(a.stroke)
    page.undo.push(a)
  } else if (a.t === 'erase') {
    page.strokes = page.strokes.filter(st => !a.strokes.includes(st))
    page.undo.push(a)
  }
  redrawInk(page)
  page.recorder.capture(flattenToCanvas(page))
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
}

// ---------- save / autosave ----------
let autosaveTimer = null
function scheduleAutosave() {
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

export async function saveCurrentPage() {
  clearTimeout(autosaveTimer)
  const idx = S.currentPage
  const page = current(); if (!page || !S.noteId) return
  setSaveState('saving', true)
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
    const res = await bridge.savePage({ noteId: S.noteId, pageIndex: idx, png, frames, meta })
    if (res && res.file) page.file = res.file
    page.dirty = false
    page.recorder.changed = false
    if (S.note) { S.note.paper = { ...paper }; S.note.tool = { ...meta.tool } }
    refreshCurrentThumb()
    setSaveState('ok')
  } catch (err) {
    console.error(err)
    setSaveState('err')
  }
}

// ---------- flyouts ----------
function closeFlyoutCloser(getEl, onClosed) {
  const onDown = e => {
    const f = getEl()
    if (f && f.contains(e.target)) { setTimeout(() => document.addEventListener('pointerdown', onDown, { capture: true, once: true }), 0); return }
    const cur = getEl()
    if (cur) cur.classList.add('hidden')
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
function openToolFlyout(id, anchor, { centered = false } = {}) {
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
  )
  renderPenStack()
}

let libCloser = null
function toggleLibraryFlyout() {
  const f = $('libraryFlyout')
  if (!f.classList.contains('hidden')) { f.classList.add('hidden'); libCloser = null; return }
  f.classList.remove('hidden')
  libCloser = true
  closeFlyoutCloser(() => (libCloser ? $('libraryFlyout') : null), () => { libCloser = null })
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
  closeFlyoutCloser(() => $('paperPanel'), null)
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
    await bridge.renameItem(S.noteId, title)
    S.note.name = title
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
  await saveCurrentPage()
  closeToolFlyout('saveFlyout')
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
  await bridge.renameItem(S.noteId, name)
  S.note.name = name
  updateTitle()
}

// ---------- init / events ----------
export function init(app) {
  host = app
  el = {
    canvasHost: $('canvasHost'), stack: $('canvasStack'), inner: $('stackInner'),
  }
  selectColor('#000000')

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
  syncToolButtons()
  renderPenStack()
  syncPenFlyout()
  buildPaperThumbs()
  buildPaperPalette()
  syncPaperPanel()

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
    if (e.code === 'Space' && !e.repeat && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      S.spaceDown = true
      stackInnerClass()
    }
    const c = e.ctrlKey || e.metaKey
    if (c && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
    if (c && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo() }
    if (c && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrentPage() }
    if (c && e.key.toLowerCase() === 'e') { e.preventDefault(); exportMenu() }
    if (c && e.key.toLowerCase() === 'n' && e.shiftKey) { /* menu: new folder */ }
  })
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') { S.spaceDown = false; stackInnerClass() }
  })
  window.addEventListener('blur', () => {
    const page = current()
    if (page && page.dirty) saveCurrentPage()
  })
  window.addEventListener('beforeunload', () => {
    const page = current()
    if (page && (page.dirty || page.recorder.changed)) saveCurrentPage()
  })

  // host menu commands
  bridge && bridge.on && bridge.on('cmd', (cmd, arg) => {
    switch (cmd) {
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
  $('stackInner').classList.toggle('panning', S.spaceDown)
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
  S.tool = 'pen'
  syncToolButtons()
  renderPenStack()
  syncPenFlyout()
  openToolFlyout('penFlyout', $('tbPens').children[i], { centered: true })
  savePens()
}

function syncToolButtons() {
  const eraser = $('tbEraser')
  if (eraser) {
    const on = S.tool === 'erase'
    eraser.classList.toggle('active', on)
    eraser.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
}

// toggles whose tools land in later phases (laser, ruler, object, lasso, eye)
// get pressed-state visuals for now
function wireToolbarToggles() {
  const eraserBtn = $('tbEraser')
  if (eraserBtn) eraserBtn.onclick = () => {
    S.tool = S.tool === 'erase' ? 'pen' : 'erase'
    renderPenStack()
    syncToolButtons()
  }
  for (const id of ['tbLaser', 'tbRuler', 'tbObject', 'tbLasso', 'tbEye']) {
    const b = document.getElementById(id)
    if (b) b.onclick = () => {
      const on = b.getAttribute('aria-pressed') !== 'true'
      b.setAttribute('aria-pressed', on ? 'true' : 'false')
      b.classList.toggle('active', on)
    }
  }
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
function updateWidthFill() {
  const el = $('width')
  if (!el) return
  const v = parseFloat(el.value) || 0.5
  el.style.setProperty('--fill', ((v - 0.5) / (12 - 0.5) * 100).toFixed(1) + '%')
}

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
