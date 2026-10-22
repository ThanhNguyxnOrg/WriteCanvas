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
  marker: { id: 'marker', label: 'Pen', desc: 'Smooth', glyph: 'marker', tip: 'disc', alpha: 1, wScale: 1, fitToCurve: true, pressure: true },
  pencil: { id: 'pencil', label: 'Pencil', desc: 'Grain', glyph: 'pencil', tip: 'disc', alpha: 0.55, wScale: 0.72, fitToCurve: true, pressure: true, grain: true },
  calligraphy: { id: 'calligraphy', label: 'Calligraphy', desc: 'Chisel 45°', glyph: 'calligraphy', tip: 'nib45', alpha: 1, wScale: 1.35, fitToCurve: true, pressure: false },
  highlighter: { id: 'highlighter', label: 'Highlighter', desc: 'Translucent', glyph: 'highlighter', tip: 'flat', alpha: 0.24, wScale: 4.0, fitToCurve: false, pressure: false },
  highlighterSquared: { id: 'highlighterSquared', label: 'Highlighter squared', desc: 'Solid block', glyph: 'highlighterSquared', tip: 'square', alpha: 1, wScale: 2.5, fitToCurve: false, pressure: false },
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

// Raw pointer samples are 60–120 Hz chords; stamping those chords directly
// makes a calligraphy nib's corners look like saw teeth and leaves visible
// polygons on fast marker strokes. Smooth with midpoint quadratics (the same
// idea as UWP FitToCurve) before building stamps; pressure is interpolated too.
function smoothPoints(pts) {
  if (!pts || pts.length < 3) return pts || []
  const out = [{ ...pts[0] }]
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1]
    const m1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2, p: (p0.p + p1.p) / 2 }
    const m2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, p: (p1.p + p2.p) / 2 }
    const d = Math.hypot(m2.x - m1.x, m2.y - m1.y) + Math.hypot(p1.x - m1.x, p1.y - m1.y) + Math.hypot(m2.x - p1.x, m2.y - p1.y)
    const n = Math.max(1, Math.min(12, Math.ceil(d / 8)))
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t
      out.push({
        x: u * u * m1.x + 2 * u * t * p1.x + t * t * m2.x,
        y: u * u * m1.y + 2 * u * t * p1.y + t * t * m2.y,
        p: u * u * m1.p + 2 * u * t * p1.p + t * t * m2.p,
      })
    }
  }
  out.push({ ...pts[pts.length - 1] })
  return out
}

// Generate the stamp list for one stroke; stamps are in doc coordinates.
// Returns {stamps, x0, y0, w, h} — the mask bounds to paint into.
function buildStamps(stroke, type) {
  const raw = stroke.pts
  if (!raw || !raw.length) return { stamps: [], x0: 0, y0: 0, w: 0, h: 0 }
  const pts = smoothPoints(raw)
  const base = stroke.width * type.wScale
  const stamps = []
  let pad = 0
  // ISF samples of the original calligraphy nib are 3×6 (a 1:2 rectangle),
  // not the exaggerated 1:2.8 wedge used before.
  const NIB = 2.0

  if (type.tip === 'nib45') {
    pad = (base * NIB) / 2 + 2
    // A calligraphy nib must be swept along the path. Stamping only at raw
    // pointer samples left gaps/teeth whenever the pointer moved fast.
    const step = Math.max(0.75, base / 20)
    const at = q => stamps.push({ kind: 'rect', x: q.x, y: q.y, len: base, wid: base * NIB, angle: -Math.PI / 4 })
    at(pts[0])
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1], cur = pts[i]
      const dx = cur.x - prev.x, dy = cur.y - prev.y
      const d = Math.hypot(dx, dy)
      if (d < 0.01) continue
      const n = Math.max(1, Math.ceil(d / step))
      for (let k = 1; k <= n; k++) {
        const t = k / n
        at({ x: prev.x + dx * t, y: prev.y + dy * t })
      }
    }
  } else if (type.tip === 'square') {
    // solid square tip: axis-aligned blocks, deliberately blockier than the
    // direction-following highlighter chisel
    pad = base * 1.3 + 2
    const step = Math.max(1.2, base / 5)
    const at = q => stamps.push({ kind: 'rect', x: q.x, y: q.y, len: base, wid: base, angle: 0 })
    at(pts[0])
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1], cur = pts[i]
      const dx = cur.x - prev.x, dy = cur.y - prev.y
      const d = Math.hypot(dx, dy)
      if (d < 0.01) continue
      const n = Math.max(1, Math.ceil(d / step))
      for (let k = 1; k <= n; k++) {
        const t = k / n
        at({ x: prev.x + dx * t, y: prev.y + dy * t })
      }
    }
  } else if (type.tip === 'flat') {
    // chisel/highlighter stamps aligned to the local stroke direction, swept
    // at a fixed step so corners don't leave protruding single rectangles
    pad = base + 2
    const step = Math.max(1.5, base / 5)
    const p0 = pts[0], p1 = pts[pts.length - 1]
    let firstAngle = 0, lastAngle = 0
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1], cur = pts[i]
      const dx = cur.x - prev.x, dy = cur.y - prev.y
      const d = Math.hypot(dx, dy)
      if (d < 0.01) continue
      const angle = Math.atan2(dy, dx)
      if (i === 1) firstAngle = angle
      lastAngle = angle
      const n = Math.max(1, Math.ceil(d / step))
      const len = d / n + base * 0.6
      for (let k = 1; k <= n; k++) {
        const t = k / n
        stamps.push({ kind: 'rect', x: prev.x + dx * t, y: prev.y + dy * t, len, wid: base, angle })
      }
    }
    if (pts.length === 1) {
      stamps.push({ kind: 'rect', x: p0.x, y: p0.y, len: base * 1.2, wid: base, angle: 0 })
    } else {
      stamps.push({ kind: 'rect', x: p0.x, y: p0.y, len: base * 1.2, wid: base, angle: firstAngle })
      stamps.push({ kind: 'rect', x: p1.x, y: p1.y, len: base * 1.2, wid: base, angle: lastAngle })
    }
  } else {
    // disc stamps along the smoothed path (marker / pencil), radius from pressure.
    // base/12 keeps the scallop between neighbouring discs below a tenth of a
    // pixel at normal zoom; it also removes the dotted top edge on wide pens.
    pad = (base * 1.65) / 2 + 2
    const step = Math.max(1.2, base / 12)
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

  // A pencil is not just a lighter marker: sprinkle deterministic graphite
  // specks just outside the spine so the edge looks dry and grainy.
  if (type.grain) {
    const main = stamps.length
    let seed = Math.floor(raw[0].x * 31 + raw[0].y * 17 + base * 13) || 9187
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    pad = Math.max(pad, base * 0.72 + 2)
    for (let i = 0; i < main; i += 4) {
      const s = stamps[i]
      if (!s || s.kind !== 'disc') continue
      for (let k = 0; k < 2; k++) {
        const a = rnd() * Math.PI * 2
        const d = base * (0.3 + rnd() * 0.28)
        stamps.push({
          kind: 'disc',
          x: s.x + Math.cos(a) * d,
          y: s.y + Math.sin(a) * d,
          r: Math.max(0.5, base * (0.035 + rnd() * 0.045)),
        })
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
  // Add every stamp to ONE path and fill once. Filling stamp-by-stamp lets the
  // translucent antialiased edge of each rectangle overlap the next stamp,
  // producing a fine comb along the nib edge; a single nonzero fill rasterises
  // only the union boundary.
  const path = new Path2D()
  for (const s of stamps) {
    if (s.kind === 'disc') {
      if (s.r <= 0) continue
      path.moveTo(s.x + s.r, s.y)
      path.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      continue
    }
    const c = Math.cos(s.angle), n = Math.sin(s.angle)
    const hx = c * s.len / 2, hy = n * s.len / 2   // along the nib
    const wx = -n * s.wid / 2, wy = c * s.wid / 2  // across the nib
    path.moveTo(s.x - hx - wx, s.y - hy - wy)
    path.lineTo(s.x + hx - wx, s.y + hy - wy)
    path.lineTo(s.x + hx + wx, s.y + hy + wy)
    path.lineTo(s.x - hx + wx, s.y - hy + wy)
    path.closePath()
  }
  mctx.save()
  mctx.fillStyle = color || '#000000'
  mctx.fill(path)
  mctx.restore()
}

// Paint the stroke's opaque coverage mask into a full-page scratch canvas.
// The caller clears the scratch and composites it once with stroke opacity —
// this is the editor's live-preview path (no per-frame canvas allocation).
export function drawStrokeMask(fullCtx, wDoc, hDoc, stroke) {
  if (!stroke || !stroke.pts || !stroke.pts.length || !(stroke.width > 0)) return
  const type = PEN_TYPES[stroke.type] || PEN_TYPES.marker
  const spec = buildStamps(stroke, type)
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
  const spec = buildStamps(stroke, type)
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
  const pts = stroke.pts || []
  // A fast stroke can have only a few samples, so testing just the vertices
  // misses the ink between them (click-select and the eraser both rely on this).
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (!b) {
      const dx = a.x - cx, dy = a.y - cy
      if (dx * dx + dy * dy <= R2) return true
      break
    }
    const dx = b.x - a.x, dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    let t = len2 ? ((cx - a.x) * dx + (cy - a.y) * dy) / len2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const ex = cx - (a.x + t * dx), ey = cy - (a.y + t * dy)
    if (ex * ex + ey * ey <= R2) return true
  }
  return false
}

export const docEraseR = mm => docMM(mm) / 2
