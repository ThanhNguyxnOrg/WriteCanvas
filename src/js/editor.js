// Editor: canvas stack, tools, undo/redo, pages, save/export, replay.

import { bridge } from './bridge.js'
import { PALETTE, QUICK_PALETTE } from './palette.js'
import { SIZES, paperDocSize, renderPaper, docMM, hexToCss, templatePathFor } from './paper.js'
import { makeStroke, addPoint, drawStrokeOpaque, strokeIntersectsCircle, docEraseR } from './ink.js'
import { Recorder, playReplay } from './replay.js'

const $ = id => document.getElementById(id)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

export const S = {
  lib: null,
  noteId: null, note: null,
  pages: [], currentPage: -1,
  tool: 'pen',
  pen: { color: '#000000', widthMM: 2.5, opacity: 1 },
  eraserMM: 3,
  zoom: 1,
  spaceDown: false,
}

// scratch canvas for per-stroke alpha compositing
const scratch = document.createElement('canvas')
const scratchCtx = scratch.getContext('2d')
const DEFAULT_PAPER = () => ({ size: 'letter', orientation: 'portrait', template: 'ruled', bg: '#FFFFFFFF', borderLines: true })
const newPage = paper => ({ paper: { ...paper }, strokes: [], rasterBitmap: null, undo: [], redo: [], dirty: false, recorder: new Recorder(), inkGif: null })
let host = null // App context, set by init()

function layer(id) { return $(id) }
function ctxOf(id) { return $(id).getContext('2d') }

let el = {}

function current() { return S.pages[S.currentPage] || null }
function docSize(page) { return paperDocSize(page.paper.size, page.paper.orientation) }

// ---------- stroke alpha rendering ----------
function drawStrokeAlpha(targetCtx, w, h, stroke) {
  if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h }
  scratchCtx.clearRect(0, 0, w, h)
  drawStrokeOpaque(scratchCtx, stroke)
  targetCtx.save()
  targetCtx.globalAlpha = clamp(stroke.opacity, 0.05, 1)
  targetCtx.drawImage(scratch, 0, 0)
  targetCtx.restore()
}

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
    live = { stroke: makeStroke(S.pen.color, docMM(S.pen.widthMM), S.pen.opacity), drawnIdx: -1 }
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
  // redraw the stroke opaque on the shared scratch once per new point, then
  // composite at the stroke's opacity (no within-stroke darkening artifacts)
  scratchCtx.clearRect(0, 0, w, h)
  drawStrokeOpaque(scratchCtx, stroke)
  lc.globalAlpha = clamp(stroke.opacity, 0.05, 1)
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
      tool: { color: S.pen.color, widthMM: S.pen.widthMM, opacity: S.pen.opacity },
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
  const btn = anchor.getBoundingClientRect()
  f.style.left = Math.min(btn.left - 12, window.innerWidth - 300) + 'px'
  f.style.top = (btn.bottom + 6) + 'px'
  f.classList.remove('hidden')
  closeFlyoutCloser(() => $(id))
}

let libCloser = null
function toggleLibraryFlyout() {
  const f = $('libraryFlyout')
  if (!f.classList.contains('hidden')) { f.classList.add('hidden'); libCloser = null; return }
  f.classList.remove('hidden')
  libCloser = true
  closeFlyoutCloser(() => (libCloser ? $('libraryFlyout') : null), () => { libCloser = null })
}

function syncPaperFlyout() {
  const page = current(); if (!page) return
  $('paperSize').value = page.paper.size
  $('paperOrient').value = page.paper.orientation
  $('paperTpl').value = page.paper.template
  $('paperBg').value = hexToCss(page.paper.bg, '#ffffff')
  $('paperBrl').checked = page.paper.borderLines !== false
}

function applyPaper() {
  const page = current(); if (!page) return
  page.paper = {
    size: $('paperSize').value,
    orientation: $('paperOrient').value,
    template: $('paperTpl').value,
    bg: '#FF' + $('paperBg').value.slice(1).toUpperCase(),
    borderLines: $('paperBrl').checked,
  }
  renderPage(page)
  applyTransform()
  page.dirty = true
  scheduleAutosave()
  refreshCurrentThumb()
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
  const label = `${name} (${S.currentPage + 1}/${S.pages.length})`
  $('btnTitle').textContent = label
  document.title = `${label} - WriteCanvas`
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
  // quick palette row (the 7 colors sampled from the original app)
  const pal = $('palette')
  QUICK_PALETTE.forEach(c => {
    const s = document.createElement('div')
    s.className = 'swatch'
    s.style.background = c
    s.dataset.color = c
    s.onclick = () => selectColor(c)
    pal.appendChild(s)
  })
  const ext = $('extPalette')
  PALETTE.forEach(c => {
    const s = document.createElement('div')
    s.className = 'swatch'
    s.style.background = c
    s.dataset.color = c
    s.onclick = () => selectColor(c)
    ext.appendChild(s)
  })
  selectColor('#000000')
  $('colorPicker').addEventListener('input', e => selectColor(e.target.value))

  // tools (segmented inside the pen flyout)
  document.querySelectorAll('#penFlyout .tool').forEach(b => {
    b.onclick = () => {
      S.tool = b.dataset.tool
      document.querySelectorAll('#penFlyout .tool').forEach(x => {
        x.classList.toggle('active', x === b)
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false')
      })
    }
  })
  $('width').addEventListener('input', e => {
    S.pen.widthMM = parseFloat(e.target.value)
    $('widthVal').textContent = S.pen.widthMM.toFixed(1) + 'mm'
  })
  $('widthVal').textContent = (S.pen.widthMM).toFixed(1) + 'mm'
  $('opacity').addEventListener('input', e => {
    S.pen.opacity = parseFloat(e.target.value) / 100
    $('opacityVal').textContent = e.target.value + '%'
  })

  $('btnMenu').onclick = () => toggleLibraryFlyout()
  $('btnSave').onclick = saveCurrentPage
  $('btnUndo').onclick = undo
  $('btnRedo').onclick = redo
  $('btnTitle').onclick = renameOpenNote
  $('btnTune').onclick = () => showFlyoutNear('penFlyout', $('btnTune'))
  $('curColorCircle').onclick = () => showFlyoutNear('penFlyout', $('btnTune'))
  $('btnPaper').onclick = () => { syncPaperFlyout(); showFlyoutNear('paperFlyout', $('btnPaper')) }
  $('paperSize').onchange = applyPaper
  $('paperOrient').onchange = applyPaper
  $('paperTpl').onchange = applyPaper
  $('paperBg').addEventListener('input', applyPaper)
  $('btnPlay').onclick = toggleReplay
  $('btnExport').onclick = exportMenu
  $('btnAddPage').onclick = addPage

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
  S.pen.color = c
  document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('sel', s.dataset.color === c))
  $('colorPicker').value = hexToCss(c, '#000000')
  $('curColorCircle').style.background = c
  $('curDot').style.background = c
}
