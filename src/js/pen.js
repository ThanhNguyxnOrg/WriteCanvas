// Pen engine v2 — 5 pen types emulated after the original InkToolbar setup
// (docs/research/scrble-feature-inventory.md §1), with the palette and slot
// model from the real UI evidence (02-pen-flyout.png, panel-check.png).
//
// Rendering model: every stroke is stamped into an offscreen coverage mask
// (union — no self-overlap darkening), then composited onto the page exactly
// once with the pen's alpha. This mirrors UWP ink compositing where
// DrawAsHighlighter strokes never darken themselves.
//
// Widths are in mm at doc scale; the original's factory pen width for the
// basic pen (4 device-independent px) is 4/96 in = 1.058 mm.

import { docMM } from './paper.js'

// Factory pen palette, DLL 0xd6a4dc string "255,0,0,0,…" (29 colors, ARGB).
// Position 30 (last swatch) opens the custom color dialog — sentinel '#RAINBOW'.
export const PEN_PALETTE = [
  '#000000', '#FFFFFF', '#D1D3D4', '#A7A9AC', '#808285', '#58595B',
  '#B31564', '#FF0000', '#FF5500', '#FFAA00', '#FFCE00', '#FFE600',
  '#A2E61B', '#26E600', '#008055', '#00AACC', '#004DE6', '#3D00B8',
  '#6600CC', '#600080', '#F7D7C4', '#BB9167', '#8E562E', '#613D30',
  '#FF80FF', '#FFC680', '#FFFB0A', '#32FF5C', '#2EF0FF', '#RAINBOW',
]

// Pen types — labels from PRI resources, semantics emulated from UWP
// ink defaults (PenPen/PenPencil/PenCalligraphy/PenHighlighter/
// _HighlighterSquaredButton). Width multipliers follow the tip shapes:
// chisel tips paint far wider than their applied width value.
export const PEN_TYPES = {
  marker: { id: 'marker', label: 'Pen', glyph: 'marker', tip: 'disc', alpha: 1, wScale: 1, fitToCurve: true, pressure: true },
  pencil: { id: 'pencil', label: 'Pencil', glyph: 'pencil', tip: 'disc', alpha: 0.85, wScale: 0.9, fitToCurve: true, pressure: true },
  calligraphy: { id: 'calligraphy', label: 'Calligraphy', glyph: 'calligraphy', tip: 'nib45', alpha: 1, wScale: 1, fitToCurve: true, pressure: false },
  highlighter: { id: 'highlighter', label: 'Highlighter', glyph: 'highlighter', tip: 'flat', alpha: 0.3, wScale: 3.5, fitToCurve: false, pressure: false },
  highlighterSquared: { id: 'highlighterSquared', label: 'Highlighter squared', glyph: 'highlighterSquared', tip: 'flat', alpha: 1, wScale: 2.2, fitToCurve: false, pressure: false },
}

export const PEN_TYPE_ORDER = ['marker', 'pencil', 'calligraphy', 'highlighter', 'highlighterSquared']

// the quick-ink row (pixel-sampled from the original toolbar's quick colors)
export const QUICK_PALETTE = ['#FF0000', '#004DE6', '#26E600', '#FFFB0A', '#32FF5C', '#2EF0FF', '#000000']

// 10 toolbar slots as seen in the real app (panel-check.png): thin red/blue/
// green markers, wide yellow/green/cyan/black… the user reshapes every slot
// freely; these only seed the first run.
export const DEFAULT_PEN_SLOTS = [
  { type: 'marker', color: '#000000', widthMM: 1.06 },
  { type: 'marker', color: '#FF0000', widthMM: 1.06 },
  { type: 'marker', color: '#004DE6', widthMM: 1.06 },
  { type: 'marker', color: '#26E600', widthMM: 1.06 },
  { type: 'highlighter', color: '#FFE600', widthMM: 3 },
  { type: 'highlighter', color: '#26E600', widthMM: 3 },
  { type: 'highlighter', color: '#2EF0FF', widthMM: 3 },
  { type: 'marker', color: '#000000', widthMM: 2.5 },
  { type: 'marker', color: '#000000', widthMM: 2.5 },
  { type: 'marker', color: '#FF0000', widthMM: 1.06 },
]

// width factor from PointerEvent.pressure (0 for mouse -> treat as .5)
export function pressureFactor(p) {
  if (!p && p !== 0) return 1
  const v = p > 0 ? p : 0.5
  return 0.35 + 1.3 * v
}

function stampDisc(mctx, x, y, r) {
  if (r <= 0) return
  mctx.beginPath()
  mctx.arc(x, y, r, 0, Math.PI * 2)
  mctx.fill()
}

function stampRect(mctx, x, y, len, wid, angle) {
  mctx.save()
  mctx.translate(x, y)
  mctx.rotate(angle)
  mctx.fillRect(-len / 2, -wid / 2, len, wid)
  mctx.restore()
}

// Generate the stamp list for one stroke; stamps are in doc coordinates.
// Returns {stamps, x0, y0, w, h} — the mask bounds to paint into.
function buildStamps(stroke, type, stepMin) {
  const pts = stroke.pts
  const base = stroke.width * type.wScale
  const stamps = []
  let pad = 0
  const NIB = 2.8 // calligraphy blade length as a multiple of width

  if (type.tip === 'nib45') {
    pad = (base * NIB) / 2 + 2
    for (const p of pts) {
      stamps.push({ kind: 'rect', x: p.x, y: p.y, len: base, wid: base * NIB, angle: -Math.PI / 4 })
    }
  } else if (type.tip === 'flat') {
    // chisel stamps aligned to the local stroke direction
    pad = base + 2
    let prev = pts[0]
    for (let i = 1; i < pts.length; i++) {
      const cur = pts[i]
      const dx = cur.x - prev.x, dy = cur.y - prev.y
      const d = Math.hypot(dx, dy)
      if (d < 0.5) continue
      const angle = Math.atan2(dy, dx)
      const len = d + base * 1.2
      stamps.push({ kind: 'rect', x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2, len, wid: base, angle })
      prev = cur
    }
    if (pts.length === 1) prev = pts[0]
    const p0 = pts[0], p1 = pts[pts.length - 1]
    const a0 = pts.length > 1 ? Math.atan2(pts[1].y - p0.y, pts[1].x - p0.x) : 0
    const a1 = pts.length > 1 ? a0 : 0
    stamps.push({ kind: 'rect', x: p0.x, y: p0.y, len: base * 1.2, wid: base, angle: a0 })
    stamps.push({ kind: 'rect', x: p1.x, y: p1.y, len: base * 1.2, wid: base, angle: a1 })
  } else {
    // disc stamps along the path (marker / pencil), radius from pressure
    pad = (base * 1.65) / 2 + 2
    const step = Math.max(stepMin, base / 3)
    const stampAt = q => {
      const r = (base * (type.pressure ? pressureFactor(q.p) : 1)) / 2
      stamps.push({ kind: 'disc', x: q.x, y: q.y, r })
    }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      if (i === 0) { stampAt(p); continue }
      const prev = pts[i - 1]
      const dx = p.x - prev.x, dy = p.y - prev.y
      const d = Math.hypot(dx, dy)
      if (d < 0.01) continue
      const n = Math.max(1, Math.ceil(d / step))
      for (let k = 1; k <= n; k++) {
        const t = k / n
        stampAt({ x: prev.x + dx * t, y: prev.y + dy * t, p: prev.p + (p.p - prev.p) * t })
      }
    }
  }

  // mask bounds
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of stamps) {
    const hw = s.kind === 'disc' ? s.r : (Math.abs(Math.cos(s.angle)) * s.len + Math.abs(Math.sin(s.angle)) * s.wid) / 2
    const hh = s.kind === 'disc' ? s.r : (Math.abs(Math.sin(s.angle)) * s.len + Math.abs(Math.cos(s.angle)) * s.wid) / 2
    if (s.x - hw < x0) x0 = s.x - hw
    if (s.y - hh < y0) y0 = s.y - hh
    if (s.x + hw > x1) x1 = s.x + hw
    if (s.y + hh > y1) y1 = s.y + hh
  }
  if (stamps.length) { x0 -= pad; y0 -= pad; x1 += pad; y1 += pad }
  return { stamps, x0: Math.floor(x0), y0: Math.floor(y0), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) }
}

// Stamp the (opaque) stroke coverage into `mctx`. Stamps are in doc
// coordinates — the caller sets up the frame (translation) first.
function fillMask(mctx, stamps, color) {
  mctx.save()
  mctx.fillStyle = color || '#000000'
  for (const s of stamps) {
    if (s.kind === 'disc') stampDisc(mctx, s.x, s.y, s.r)
    else stampRect(mctx, s.x, s.y, s.len, s.wid, s.angle)
  }
  mctx.restore()
}

// Paint the stroke's opaque coverage mask into a full-page scratch canvas.
// The caller clears the scratch and composites it once with stroke opacity —
// this is the editor's live-preview path (no per-frame canvas allocation).
export function drawStrokeMask(fullCtx, wDoc, hDoc, stroke) {
  if (!stroke || !stroke.pts || !stroke.pts.length || !(stroke.width > 0)) return
  const type = PEN_TYPES[stroke.type] || PEN_TYPES.marker
  const spec = buildStamps(stroke, type, stroke.type === 'marker' ? 2 : 3)
  if (!spec.stamps.length) return
  // clear exactly the painted region (stamps may fall outside the page)
  const cx0 = Math.max(0, spec.x0), cy0 = Math.max(0, spec.y0)
  const cx1 = Math.min(wDoc, spec.x0 + spec.w), cy1 = Math.min(hDoc, spec.y0 + spec.h)
  if (cx1 > cx0 && cy1 > cy0) fullCtx.clearRect(cx0, cy0, cx1 - cx0, cy1 - cy0)
  // no translation: stamps land at their doc coordinates on the full canvas
  fillMask(fullCtx, spec.stamps, stroke.color)
}

// Render one stroke with its per-type alpha onto any context (flatten path).
// A small bbox-sized mask is allocated, stamped, then composited exactly once.
export function drawStrokeAlpha(ctx, wDoc, hDoc, stroke) {
  if (!stroke || !stroke.pts || !stroke.pts.length || !(stroke.width > 0)) return
  const type = PEN_TYPES[stroke.type] || PEN_TYPES.marker
  const spec = buildStamps(stroke, type, stroke.type === 'marker' ? 2 : 3)
  if (!spec.stamps.length) return
  // clamp to the page rect; the canvas clips stamp overflow at its edges
  const x0 = Math.max(spec.x0, 0), y0 = Math.max(spec.y0, 0)
  const w = Math.min(spec.x0 + spec.w, wDoc) - x0
  const h = Math.min(spec.y0 + spec.h, hDoc) - y0
  if (w <= 0 || h <= 0) return
  const mask = document.createElement('canvas')
  mask.width = w; mask.height = h
  const mctx = mask.getContext('2d')
  mctx.translate(-x0, -y0)
  fillMask(mctx, spec.stamps, stroke.color)
  ctx.save()
  ctx.globalAlpha = stroke.opacity !== undefined ? stroke.opacity : type.alpha
  ctx.drawImage(mask, x0, y0)
  ctx.restore()
}

// Collect stroke points from pointer events into a stroke object.
export function makeStroke(pen, widthDoc) {
  // pen: { type, color, widthMM, opacity? } — widthDoc is the doc-px width
  return { type: pen.type || 'marker', color: pen.color, width: widthDoc, opacity: pen.opacity, pts: [] }
}

export function addPoint(stroke, x, y, p, minDist) {
  const pts = stroke.pts
  const last = pts[pts.length - 1]
  if (last) {
    const dx = x - last.x, dy = y - last.y
    if (dx * dx + dy * dy < minDist * minDist) return false
  }
  pts.push({ x, y, p: typeof p === 'number' && p > 0 ? p : 0.5 })
  return true
}

// Stroke intersection test for the stroke eraser (checks the spine; the
// visual footprint is wider by half the pen width).
export function strokeIntersectsCircle(stroke, cx, cy, r) {
  const R = r + (stroke.width || 0) / 2
  const R2 = R * R
  for (const pt of stroke.pts) {
    const dx = pt.x - cx, dy = pt.y - cy
    if (dx * dx + dy * dy <= R2) return true
  }
  return false
}

export const docEraseR = mm => docMM(mm) / 2
