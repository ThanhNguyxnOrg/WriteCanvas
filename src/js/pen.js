// Pen engine v2 — 5 pen types emulated after the original InkToolbar setup,
// with the palette and slot model from the real UI evidence
// (02-pen-flyout.png, panel-check.png).
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
//
// The five types must read as five *different tools* at a glance, at the same
// slider setting: solid and round, dry graphite, a 45° chisel with strong
// thick/thin, a pale wide chisel, a blocky squared marker. Weak differences
// (a hair narrower, a hair lighter) were what made the picker feel pointless.
export const PEN_TYPES = {
  marker: { id: 'marker', label: 'Pen', desc: 'Smooth', glyph: 'marker', tip: 'disc', alpha: 1, wScale: 1, fitToCurve: true, pressure: true },
  pencil: { id: 'pencil', label: 'Pencil', desc: 'Grain', glyph: 'pencil', tip: 'disc', alpha: 0.5, wScale: 0.6, fitToCurve: true, pressure: true, grain: true, edge: 0.6 },
  calligraphy: { id: 'calligraphy', label: 'Calligraphy', desc: 'Chisel 45°', glyph: 'calligraphy', tip: 'nib45', alpha: 1, wScale: 1.45, nib: 2.6, fitToCurve: true, pressure: false },
  highlighter: { id: 'highlighter', label: 'Highlighter', desc: 'Translucent', glyph: 'highlighter', tip: 'flat', alpha: 0.24, wScale: 4.2, fitToCurve: false, pressure: false },
  highlighterSquared: { id: 'highlighterSquared', label: 'Highlighter squared', desc: 'Solid block', glyph: 'highlighterSquared', tip: 'square', alpha: 0.85, wScale: 2.8, fitToCurve: false, pressure: false },
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

// Stamp building. `createStrokeStamper` is the single implementation of the
// geometry: the flatten path feeds every point and finalises, while the
// editor's live path feeds the growing point list and gets back only what was
// added since the last call. A live stroke therefore costs O(new points)
// instead of O(points²) as it grows, from the same stamp positions as the
// final render.
//
// Stamps carry two lifetimes, and that split is what lets the live layer be
// the committed stroke, pixel for pixel:
//   permanent — the spine every settled sample folded into, the pencil grain
//               anchored to it, and the highlighter's opening cap
//   tail      — the walk from the spine end to the newest raw sample plus the
//               flat tip's closing cap; rebuilt by every feed and replaced by
//               the exact final walk when the pen lifts
// The old model let the tail fall into the union permanently while re-walking
// it, so pen-up changed the highlighter's end and reshuffled the pencil's
// grain. The editor now paints the tail inside a repaintable region, so
// nothing provisional ever stays under the ink.
//
// Raw pointer samples are 60–120 Hz chords; stamping those chords directly
// makes a calligraphy nib's corners look like saw teeth and leaves visible
// polygons on fast marker strokes. Every interior sample folds into the spine
// as a midpoint quadratic (the same idea as UWP FitToCurve); pressure is
// interpolated too.
export function penTypeOf(stroke) {
  return PEN_TYPES[stroke.type] || PEN_TYPES.marker
}

function stampBox(s) {
  const hw = s.kind === 'disc' ? s.r : (Math.abs(Math.cos(s.angle)) * s.len + Math.abs(Math.sin(s.angle)) * s.wid) / 2
  const hh = s.kind === 'disc' ? s.r : (Math.abs(Math.sin(s.angle)) * s.len + Math.abs(Math.cos(s.angle)) * s.wid) / 2
  return { x0: s.x - hw, y0: s.y - hh, x1: s.x + hw, y1: s.y + hh }
}

function stampBounds(stamps, pad) {
  if (!stamps.length) return { x0: 0, y0: 0, w: 0, h: 0 }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of stamps) {
    const b = stampBox(s)
    if (b.x0 < x0) x0 = b.x0
    if (b.y0 < y0) y0 = b.y0
    if (b.x1 > x1) x1 = b.x1
    if (b.y1 > y1) y1 = b.y1
  }
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad
  return { x0: Math.floor(x0), y0: Math.floor(y0), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) }
}

export function createStrokeStamper(stroke, type = penTypeOf(stroke)) {
  const raw = stroke.pts || []
  const base = stroke.width * type.wScale
  // ISF samples of the original calligraphy nib are 3×6 (a 1:2 rectangle),
  // widened here because a chisel at 1:2 barely reads as one at pen sizes.
  const NIB = type.nib || 2.0
  let pad = 0
  if (type.tip === 'nib45') pad = (base * NIB) / 2 + 2
  else if (type.tip === 'square') pad = base * 1.3 + 2
  else if (type.tip === 'flat') pad = base + 2
  else pad = (base * 1.65) / 2 + 2 + (type.grain ? base : 0)

  const main = []         // permanent stamps in canonical order (grain anchors)
  const specks = []       // pencil grain, permanent, anchored to main only
  const tail = []         // provisional: rebuilt by every feed, final on pen-up
  let pendingStable = []  // main + specks added since the last feed()
  let interiorDone = 0  // interior quads already folded into the stable spine
  let walkPrev = null   // last stable smoothed point; the walk resumes here
  let lastAngle = 0
  let cap0Done = false
  let speckScan = 0
  let started = false
  // Two independent streams: the grain draws from `seed`, the pencil's ragged
  // edge from `seedEdge`. Each is consumed in an order that does not depend on
  // how many feeds the stroke took, so a live stroke and the canonical rebuild
  // land on the same specks and the same edge. Seeds depend on the first point,
  // so they are taken lazily at the first feed (the editor builds the stamper
  // around a stroke whose point list is still empty).
  let seed = 0, seedEdge = 0
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const rndEdge = () => { seedEdge = (seedEdge * 1103515245 + 12345) >>> 0; return seedEdge / 4294967296 }

  function addStable(s) { main.push(s); pendingStable.push(s) }
  function addTail(s) { tail.push(s) }

  // A pencil is not just a lighter marker: graphite rides the edge of the
  // spine as deterministic specks. They hang off permanent stamps only — a
  // provisional tail is never an anchor — so lifting the pen cannot reshuffle
  // the pattern the person just watched appear.
  function pushSpecks() {
    if (!type.grain) return
    while (speckScan < main.length) {
      const j = speckScan++
      if (j % 2 !== 0) continue
      const s = main[j]
      if (!s || s.kind !== 'disc') continue
      for (let k = 0; k < 3; k++) {
        const a = rnd() * Math.PI * 2
        // pushed a touch past the spine edge: a speck swallowed by the core
        // would leave the pencil looking like a plain thin marker
        const d = s.r * (0.6 + rnd() * 1.0) + 0.35
        const speck = {
          kind: 'disc',
          x: s.x + Math.cos(a) * d,
          y: s.y + Math.sin(a) * d,
          // a floor of ~1/3 px keeps the grain alive at everyday pen widths
          r: Math.max(0.35, base * (0.05 + rnd() * 0.08)),
        }
        specks.push(speck)
        pendingStable.push(speck)
      }
    }
  }

  function walkSegment(prev, cur, stableSeg, sink) {
    const dx = cur.x - prev.x, dy = cur.y - prev.y
    const d = Math.hypot(dx, dy)
    if (type.tip === 'flat') {
      if (d < 0.01) return
      const angle = Math.atan2(dy, dx)
      lastAngle = angle
      // chisel/highlighter stamps aligned to the local stroke direction, swept
      // at a fixed step so corners don't leave protruding single rectangles
      const step = Math.max(1.5, base / 5)
      const n = Math.max(1, Math.ceil(d / step))
      const len = d / n + base * 0.6
      for (let k = 1; k <= n; k++) {
        const t = k / n
        sink({ kind: 'rect', x: prev.x + dx * t, y: prev.y + dy * t, len, wid: base, angle })
      }
      return
    }
    if (d < 0.01) return
    if (type.tip === 'nib45') {
      // A calligraphy nib must be swept along the path. Stamping only at raw
      // pointer samples left gaps/teeth whenever the pointer moved fast.
      const step = Math.max(0.75, base / 20)
      const n = Math.max(1, Math.ceil(d / step))
      for (let k = 1; k <= n; k++) {
        const t = k / n
        sink({ kind: 'rect', x: prev.x + dx * t, y: prev.y + dy * t, len: base, wid: base * NIB, angle: -Math.PI / 4 })
      }
    } else if (type.tip === 'square') {
      // solid square tip: axis-aligned blocks, deliberately blockier than the
      // direction-following highlighter chisel
      const step = Math.max(1.2, base / 5)
      const n = Math.max(1, Math.ceil(d / step))
      for (let k = 1; k <= n; k++) {
        const t = k / n
        sink({ kind: 'rect', x: prev.x + dx * t, y: prev.y + dy * t, len: base, wid: base, angle: 0 })
      }
    } else {
      // disc stamps along the smoothed path (marker / pencil), radius from
      // pressure. base/12 keeps the scallop between neighbouring discs below a
      // tenth of a pixel at normal zoom; it also removes the dotted top edge
      // on wide pens.
      const step = Math.max(1.2, base / 12)
      const n = Math.max(1, Math.ceil(d / step))
      for (let k = 1; k <= n; k++) {
        const t = k / n
        const q = { x: prev.x + dx * t, y: prev.y + dy * t, p: prev.p + (cur.p - prev.p) * t }
        let r = (base * (type.pressure ? pressureFactor(q.p) : 1)) / 2
        // A pencil's edge is dry and uneven. The jitter rides permanent stamps
        // only, from its own stream, so it never depends on the feed pattern.
        if (type.edge && stableSeg) r *= 1 + (rndEdge() - 0.5) * type.edge
        sink({ kind: 'disc', x: q.x, y: q.y, r })
      }
    }
  }

  // Fold every newly available interior sample into the stable spine.
  function foldInteriors(L) {
    const avail = Math.max(0, L - 2)
    const stable = []
    for (let i = interiorDone + 1; i <= avail; i++) {
      const p0 = raw[i - 1], p1 = raw[i], p2 = raw[i + 1]
      const m1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2, p: (p0.p + p1.p) / 2 }
      const m2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, p: (p1.p + p2.p) / 2 }
      const d = Math.hypot(m2.x - m1.x, m2.y - m1.y) + Math.hypot(p1.x - m1.x, p1.y - m1.y) + Math.hypot(m2.x - p1.x, m2.y - p1.y)
      const n = Math.max(1, Math.min(12, Math.ceil(d / 8)))
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t
        stable.push({
          x: u * u * m1.x + 2 * u * t * p1.x + t * t * m2.x,
          y: u * u * m1.y + 2 * u * t * p1.y + t * t * m2.y,
          p: u * u * m1.p + 2 * u * t * p1.p + t * t * m2.p,
        })
      }
    }
    interiorDone = Math.max(interiorDone, avail)
    return stable
  }

  // Process every raw point added since the last call. Returns the permanent
  // stamps added this time (to append to the mask), the current provisional
  // tail (to paint inside a repaintable region) and each set's mask bounds.
  // `final` freezes the tail so all() returns the canonical complete stroke.
  function feed(final = false) {
    pendingStable = []
    tail.length = 0
    const L = raw.length
    if (!L) return { stable: [], stableBox: null, tail: [], tailBox: null }
    if (!started) {
      started = true
      if (type.grain) {
        seed = Math.floor(raw[0].x * 31 + raw[0].y * 17 + base * 13) || 9187
        seedEdge = Math.floor(raw[0].x * 13 + raw[0].y * 29 + base * 7) || 7717
      }
      if (type.tip === 'nib45') addStable({ kind: 'rect', x: raw[0].x, y: raw[0].y, len: base, wid: base * NIB, angle: -Math.PI / 4 })
      else if (type.tip === 'square') addStable({ kind: 'rect', x: raw[0].x, y: raw[0].y, len: base, wid: base, angle: 0 })
      else if (type.tip !== 'flat') addStable({ kind: 'disc', x: raw[0].x, y: raw[0].y, r: (base * (type.pressure ? pressureFactor(raw[0].p) : 1)) / 2 })
      walkPrev = { x: raw[0].x, y: raw[0].y, p: raw[0].p }
    }
    const stable = foldInteriors(L)
    for (const pt of stable) { walkSegment(walkPrev, pt, true, addStable); walkPrev = pt }
    if (L >= 2) walkSegment(walkPrev, raw[L - 1], false, addTail)
    if (type.tip === 'flat') {
      if (L === 1) {
        // A tap is one block, painted only by the final build (the live layer
        // has nothing to show for a single sample anyway).
        if (final) addTail({ kind: 'rect', x: raw[0].x, y: raw[0].y, len: base * 1.2, wid: base, angle: 0 })
      } else {
        // The opening cap takes its angle from the first two raw samples: a
        // value both the live feed and the canonical rebuild compute the same
        // way, so it cannot rotate under the ink when the pen lifts.
        if (!cap0Done) {
          cap0Done = true
          addStable({ kind: 'rect', x: raw[0].x, y: raw[0].y, len: base * 1.2, wid: base, angle: Math.atan2(raw[1].y - raw[0].y, raw[1].x - raw[0].x) })
        }
        addTail({ kind: 'rect', x: raw[L - 1].x, y: raw[L - 1].y, len: base * 1.2, wid: base, angle: lastAngle })
      }
    }
    pushSpecks()
    const tailStamps = tail.slice()
    return {
      stable: pendingStable,
      stableBox: pendingStable.length ? stampBounds(pendingStable, pad) : null,
      tail: tailStamps,
      tailBox: tailStamps.length ? stampBounds(tailStamps, pad) : null,
    }
  }

  // The complete stamp list for the stroke as it stands (canonical build).
  function all() {
    const stamps = main.concat(specks, tail)
    return { stamps, ...stampBounds(stamps, pad) }
  }

  // Permanent stamps that intersect a box: the editor wipes the provisional
  // tail's region and repaints what the mask held underneath, so the mask ends
  // up exactly the canonical stamp set.
  function covers(box) {
    if (!box) return []
    const x1 = box.x0 + box.w, y1 = box.y0 + box.h
    const out = []
    for (const s of main) { const b = stampBox(s); if (b.x0 <= x1 && b.x1 >= box.x0 && b.y0 <= y1 && b.y1 >= box.y0) out.push(s) }
    for (const s of specks) { const b = stampBox(s); if (b.x0 <= x1 && b.x1 >= box.x0 && b.y0 <= y1 && b.y1 >= box.y0) out.push(s) }
    return out
  }

  return { feed, all, covers }
}

// Generate the stamp list for one stroke; stamps are in doc coordinates.
// Returns {stamps, x0, y0, w, h} — the mask bounds to paint into.
export function buildStamps(stroke, type = penTypeOf(stroke)) {
  if (!stroke || !stroke.pts || !stroke.pts.length) return { stamps: [], x0: 0, y0: 0, w: 0, h: 0 }
  const stamper = createStrokeStamper(stroke, type)
  stamper.feed(true)
  return stamper.all()
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

// Paint a batch of stamps into a mask context (a union with whatever the mask
// already holds) — the incremental counterpart of the full-stroke fill.
export function paintStamps(mctx, stamps, color, clip) {
  if (!stamps || !stamps.length) return
  if (clip) {
    mctx.save()
    mctx.beginPath()
    mctx.rect(clip.x0, clip.y0, clip.x1 - clip.x0, clip.y1 - clip.y0)
    mctx.clip()
    fillMask(mctx, stamps, color)
    mctx.restore()
    return
  }
  fillMask(mctx, stamps, color)
}

// Paint the stroke's opaque coverage mask into a full-page scratch canvas.
// The caller clears the scratch and composites it once with stroke opacity —
// this is the editor's live-preview path (no per-frame canvas allocation).
// `clip` (optional, {x0,y0,x1,y1} in doc pixels) confines the fill: the
// editor wipes a region of the mask and repaints the stamps under it, and a
// stamp reaching past that region must not repaint, and so re-darken, the
// antialiased edge it painted on an earlier frame.
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
  // A filled gallery shape inks its whole interior, but the spine test only
  // sees the outline it was built from. A tap in the middle of a filled
  // circle used to miss (eraser and click-select both rely on this test), so
  // treat the shape's box as solid when it is filled.
  if (stroke.type === 'shape' && stroke.shape && stroke.shape.fill) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const p of pts) {
      if (p.x < x0) x0 = p.x
      if (p.x > x1) x1 = p.x
      if (p.y < y0) y0 = p.y
      if (p.y > y1) y1 = p.y
    }
    if (x0 !== Infinity) {
      const nx = cx < x0 ? x0 : cx > x1 ? x1 : cx
      const ny = cy < y0 ? y0 : cy > y1 ? y1 : cy
      const dx = cx - nx, dy = cy - ny
      if (dx * dx + dy * dy <= R2) return true
    }
  }
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
