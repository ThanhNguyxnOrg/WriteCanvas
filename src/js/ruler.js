/**
 * Ruler geometry and the stencil overlay painters.
 *
 * Geometry: line/rectangle clipping, point projection and distance for edge
 * snapping, and the angle maths.
 *
 * Painters: `paintRulerStencil` (straight edge) and `paintProtractorStencil`
 * (half disc) draw the two stencils in one visual language — a frosted acrylic
 * body, fine graduations printed at the writing edge, a machined grip puck and
 * a rotate ring. Every dimension in that section is in SCREEN pixels and is
 * divided by `scale` (the CSS zoom: document px per screen px) so the stencil
 * keeps its size on screen while the page zooms underneath it. The painters
 * touch only the 2D context they are handed, so the unit suite can drive them
 * with a recorder object and no DOM.
 */

/**
 * Clip an infinite line through (px, py) with unit direction (ux, uy)
 * against the page rectangle [0, w] x [0, h].
 *
 * Returns the two intersection points, or null when the line misses the page.
 * This is a line/rectangle clip, NOT independent x/y clamping: clamping each
 * axis separately changes the angle of a rotated line.
 */
export function clipLineToRect(px, py, ux, uy, w, h) {
  let tMin = -Infinity
  let tMax = Infinity

  for (const [p, d, max] of [[px, ux, w], [py, uy, h]]) {
    if (Math.abs(d) < 1e-12) {
      // Parallel to this axis: the line is either inside the slab or misses it.
      if (p < 0 || p > max) return null
      continue
    }
    let a = -p / d
    let b = (max - p) / d
    if (a > b) {
      const t = a; a = b; b = t
    }
    if (a > tMin) tMin = a
    if (b < tMax) tMax = b
    if (tMin > tMax) return null
  }

  if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) return null
  return {
    x0: px + ux * tMin,
    y0: py + uy * tMin,
    x1: px + ux * tMax,
    y1: py + uy * tMax,
  }
}

/**
 * Project a point onto the infinite line through (px, py) with unit
 * direction (ux, uy). Returns the projected point plus the parameter t
 * (signed distance from the pivot along the line).
 */
export function lineSnapPoint(x, y, px, py, ux, uy) {
  const t = (x - px) * ux + (y - py) * uy
  return { x: px + t * ux, y: py + t * uy, t }
}

/** Perpendicular distance from a point to the same infinite line. */
export function pointLineDistance(x, y, px, py, ux, uy) {
  const t = (x - px) * ux + (y - py) * uy
  return Math.hypot(x - (px + t * ux), y - (py + t * uy))
}

// ---------------------------------------------------------------------------
// Stencil look
// ---------------------------------------------------------------------------

export const STENCIL_PX = {
  body: 46,     // straight ruler: body width from the writing edge to the back
  knob: 12.5,   // grip puck radius (the mover)
  ring: 13,     // rotate ring radius (the far handle)
  label: 9.5,   // graduation font, screen px
}

const ACCENT = '11,99,197'
const SLATE = '51,65,85'
const GREY = '100,116,139'
const TAU = Math.PI * 2

/** Document px per screen px at the current zoom. */
const per = scale => 1 / Math.max(0.08, scale)

/**
 * Grip puck centre. (dx, dy) is the unit direction from the pivot into the
 * body (the ruler's body normal, the protractor's inward radial), so the knob
 * sits centred in the body like a machined handle. The editor's hit test calls
 * this same helper, so what is drawn is exactly what can be grabbed.
 */
export function knobCenter(px, py, dx, dy, scale) {
  const k = per(scale)
  return {
    x: px + dx * STENCIL_PX.body * 0.5 * k,
    y: py + dy * STENCIL_PX.body * 0.5 * k,
    r: STENCIL_PX.knob * k,
  }
}

// The painters trace their paths inline (no Path2D) so the same code runs
// under a plain recorder object in the tests.

function traceRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}

// One frosted body: three offset shadow passes (a per-frame shadowBlur on this
// software compositor is the expensive kind of blur), the translucent fill and
// a hairline outline. `trace` re-traces the body path in the caller's frame.
function paintFrost(ctx, trace, scale, fill, outline) {
  const k = per(scale)
  for (const [off, alpha] of [[2.5, .10], [5, .05], [7.5, .03]]) {
    ctx.save()
    ctx.translate(0, off * k)
    ctx.fillStyle = `rgba(15,23,42,${alpha})`
    trace()
    ctx.fill()
    ctx.restore()
  }
  ctx.fillStyle = fill
  trace()
  ctx.fill()
  ctx.lineWidth = k
  ctx.strokeStyle = outline
  trace()
  ctx.stroke()
}

// The grip puck: frosted disc with a four-way move glyph.
function paintKnob(ctx, kx, ky, r, scale, active) {
  const k = per(scale)
  ctx.beginPath(); ctx.arc(kx, ky + 2 * k, r, 0, TAU)
  ctx.fillStyle = 'rgba(15,23,42,.18)'; ctx.fill()
  const grad = ctx.createLinearGradient(kx, ky - r, kx, ky + r)
  grad.addColorStop(0, 'rgba(255,255,255,.99)')
  grad.addColorStop(1, 'rgba(233,238,246,.96)')
  ctx.beginPath(); ctx.arc(kx, ky, r, 0, TAU)
  ctx.fillStyle = grad; ctx.fill()
  ctx.lineWidth = 1.3 * k
  ctx.strokeStyle = `rgba(${ACCENT},${active ? .8 : .42})`
  ctx.stroke()
  ctx.beginPath(); ctx.arc(kx, ky, Math.max(2 * k, r - 3.4 * k), 0, TAU)
  ctx.lineWidth = k
  ctx.strokeStyle = 'rgba(148,163,184,.4)'
  ctx.stroke()
  const arm = r * 0.42
  ctx.strokeStyle = `rgba(${ACCENT},.85)`
  ctx.lineWidth = 1.5 * k
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(kx - arm, ky); ctx.lineTo(kx + arm, ky)
  ctx.moveTo(kx, ky - arm); ctx.lineTo(kx, ky + arm)
  ctx.stroke()
  ctx.lineCap = 'butt'
  ctx.fillStyle = `rgba(${ACCENT},.85)`
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const bx = kx + dx * arm
    const by = ky + dy * arm
    const pxx = -dy
    const pyy = dx
    ctx.beginPath()
    ctx.moveTo(kx + dx * (arm + r * 0.3), ky + dy * (arm + r * 0.3))
    ctx.lineTo(bx + pxx * r * 0.22, by + pyy * r * 0.22)
    ctx.lineTo(bx - pxx * r * 0.22, by - pyy * r * 0.22)
    ctx.closePath()
    ctx.fill()
  }
}

// The far handle: a frosted ring with a turning arrow, shared by both stencils.
function paintRotateRing(ctx, x, y, scale, active) {
  const k = per(scale)
  const r = STENCIL_PX.ring * k
  ctx.beginPath(); ctx.arc(x, y + 2 * k, r, 0, TAU)
  ctx.fillStyle = 'rgba(15,23,42,.18)'; ctx.fill()
  const grad = ctx.createLinearGradient(x, y - r, x, y + r)
  grad.addColorStop(0, 'rgba(255,255,255,.99)')
  grad.addColorStop(1, 'rgba(233,238,246,.96)')
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU)
  ctx.fillStyle = grad; ctx.fill()
  ctx.lineWidth = 1.3 * k
  ctx.strokeStyle = `rgba(${ACCENT},${active ? .8 : .42})`
  ctx.stroke()
  const ar = r * 0.5
  const a0 = -Math.PI * 0.62
  const a1 = Math.PI * 0.58
  ctx.beginPath(); ctx.arc(x, y, ar, a0, a1)
  ctx.lineWidth = 1.7 * k
  ctx.lineCap = 'round'
  ctx.strokeStyle = `rgba(${ACCENT},.85)`
  ctx.stroke()
  ctx.lineCap = 'butt'
  const hx = x + Math.cos(a1) * ar
  const hy = y + Math.sin(a1) * ar
  const tx = -Math.sin(a1)
  const ty = Math.cos(a1)
  const hl = r * 0.38
  const bcx = hx - tx * hl * 0.45
  const bcy = hy - ty * hl * 0.45
  ctx.beginPath()
  ctx.moveTo(hx + tx * hl, hy + ty * hl)
  ctx.lineTo(bcx - ty * r * 0.2, bcy + tx * r * 0.2)
  ctx.lineTo(bcx + ty * r * 0.2, bcy - tx * r * 0.2)
  ctx.closePath()
  ctx.fillStyle = `rgba(${ACCENT},.85)`
  ctx.fill()
}

/**
 * The straight ruler. The body sits on one side of the guide line — the line
 * is the writing edge, exactly as the protractor's arc is its writing edge —
 * with graduations running from the edge inward, centimetres numbered from the
 * grip in both directions (kept upright when the stencil is turned around).
 *
 * `seg` is the clipped line segment, `mm` a document-pixel millimetre
 * (paper.js `docMM(1)`; 0 skips the graduations), `rotate` the far handle.
 * Everything else is screen-constant.
 */
export function paintRulerStencil(ctx, { px, py, ux, uy, seg, scale, snapActive = false, rotate = null, mm = 0 }) {
  const k = per(scale)
  const t0 = (seg.x0 - px) * ux + (seg.y0 - py) * uy
  const t1 = (seg.x1 - px) * ux + (seg.y1 - py) * uy
  const xA = Math.min(t0, t1)
  const xB = Math.max(t0, t1)
  const bodyW = STENCIL_PX.body * k

  ctx.save()
  ctx.translate(px, py)
  ctx.rotate(Math.atan2(uy, ux))
  // local x runs along the line, local y runs across into the body
  const trace = () => traceRoundRect(ctx, xA, 0, xB - xA, bodyW, 8 * k)
  const grad = ctx.createLinearGradient(0, 0, 0, bodyW)
  grad.addColorStop(0, 'rgba(255,255,255,.94)')
  grad.addColorStop(0.55, 'rgba(244,247,252,.82)')
  grad.addColorStop(1, 'rgba(220,228,240,.76)')
  paintFrost(ctx, trace, scale, grad, snapActive ? `rgba(${ACCENT},.5)` : `rgba(${GREY},.4)`)

  if (mm > 0) {
    // 1 mm, 5 mm and 1 cm marks; the fine ones only appear once the page is
    // zoomed enough to keep them apart. All marks share one path per weight.
    const spacing = mm * scale
    const showMM = spacing >= 4.6
    const show5 = spacing * 5 >= 8
    const iA = Math.floor(xA / mm) - 1
    const iB = Math.ceil(xB / mm) + 1
    ctx.beginPath()
    for (let i = iA; i <= iB; i++) {
      if (i === 0 || i % 10 === 0) continue
      const five = i % 5 === 0
      if (five ? !show5 : !showMM) continue
      ctx.moveTo(i * mm, 0)
      ctx.lineTo(i * mm, (five ? 7.5 : 4.5) * k)
    }
    ctx.lineWidth = k
    ctx.strokeStyle = `rgba(${SLATE},.5)`
    ctx.stroke()
    ctx.beginPath()
    for (let i = iA; i <= iB; i++) {
      if (i === 0 || i % 10 !== 0) continue
      ctx.moveTo(i * mm, 0)
      ctx.lineTo(i * mm, (i % 50 === 0 ? 13 : 11.5) * k)
    }
    ctx.lineWidth = 1.2 * k
    ctx.strokeStyle = `rgba(${SLATE},.72)`
    ctx.stroke()
    // centimetres from the grip, both ways; numbers thin out to every 5 cm
    // when the stencil is far out, and stay upright when it is turned around
    const cmGap = mm * 10 * scale
    const every = cmGap >= 20 ? 10 : cmGap * 5 >= 20 ? 50 : 0
    if (every) {
      ctx.font = `500 ${STENCIL_PX.label * k}px "Segoe UI", system-ui, sans-serif`
      ctx.fillStyle = `rgba(${SLATE},.78)`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const flip = ux < 0
      for (let i = iA; i <= iB; i++) {
        if (i === 0 || i % every !== 0) continue
        ctx.save()
        ctx.translate(i * mm, 20 * k)
        if (flip) ctx.rotate(Math.PI)
        ctx.fillText(String(Math.abs(i) / 10), 0, 0)
        ctx.restore()
      }
    }
  }

  // glass: a highlight hairline just under the edge, then the guide itself
  ctx.beginPath(); ctx.moveTo(xA, 2.6 * k); ctx.lineTo(xB, 2.6 * k)
  ctx.lineWidth = 1.2 * k
  ctx.strokeStyle = 'rgba(255,255,255,.9)'
  ctx.stroke()
  if (snapActive) {
    ctx.beginPath(); ctx.moveTo(xA, 0); ctx.lineTo(xB, 0)
    ctx.lineWidth = 10 * k
    ctx.strokeStyle = `rgba(${ACCENT},.18)`
    ctx.stroke()
  }
  ctx.beginPath(); ctx.moveTo(xA, 0); ctx.lineTo(xB, 0)
  ctx.lineWidth = 2 * k
  ctx.strokeStyle = `rgba(${ACCENT},${snapActive ? .95 : .72})`
  ctx.stroke()
  ctx.restore()

  const knob = knobCenter(px, py, -uy, ux, scale)
  paintKnob(ctx, knob.x, knob.y, knob.r, scale, snapActive)
  if (rotate) paintRotateRing(ctx, rotate.x, rotate.y, scale, snapActive)
}

/**
 * The protractor: a frosted half disc whose arc is the writing edge (strokes
 * ride it like a compass), degrees printed from the arc inward, the same grip
 * puck and rotate ring as the ruler. `r` is a document-pixel radius, `a` the
 * base angle; the disc is on the apex side of the base.
 */
export function paintProtractorStencil(ctx, { px, py, a, r, scale, snapActive = false, rotate = null }) {
  const k = per(scale)
  const ix = Math.cos(a - Math.PI / 2)
  const iy = Math.sin(a - Math.PI / 2)
  const trace = () => {
    ctx.beginPath()
    ctx.arc(px, py, r, a - Math.PI, a, false)
    ctx.closePath()
  }
  const grad = ctx.createRadialGradient(px, py, Math.max(1, r * 0.12), px, py, r)
  grad.addColorStop(0, 'rgba(255,255,255,.4)')
  grad.addColorStop(0.75, 'rgba(252,253,255,.62)')
  grad.addColorStop(1, 'rgba(244,247,252,.9)')
  paintFrost(ctx, trace, scale, grad, snapActive ? `rgba(${ACCENT},.5)` : `rgba(${GREY},.4)`)

  // degrees: 5° hairlines, 15° medium, 45° long, all from the arc inward
  ctx.beginPath()
  for (let deg = 5; deg < 180; deg += 5) {
    if (deg % 15 === 0) continue
    const phi = a - deg * Math.PI / 180
    const ux = Math.cos(phi)
    const uy = Math.sin(phi)
    ctx.moveTo(px + ux * r, py + uy * r)
    ctx.lineTo(px + ux * (r - 5 * k), py + uy * (r - 5 * k))
  }
  ctx.lineWidth = k
  ctx.strokeStyle = `rgba(${SLATE},.5)`
  ctx.stroke()
  ctx.beginPath()
  for (let deg = 15; deg < 180; deg += 15) {
    if (deg % 45 === 0) continue
    const phi = a - deg * Math.PI / 180
    const ux = Math.cos(phi)
    const uy = Math.sin(phi)
    ctx.moveTo(px + ux * r, py + uy * r)
    ctx.lineTo(px + ux * (r - 8 * k), py + uy * (r - 8 * k))
  }
  ctx.lineWidth = 1.1 * k
  ctx.strokeStyle = `rgba(${SLATE},.62)`
  ctx.stroke()
  ctx.beginPath()
  for (let deg = 0; deg <= 180; deg += 45) {
    const phi = a - deg * Math.PI / 180
    const ux = Math.cos(phi)
    const uy = Math.sin(phi)
    ctx.moveTo(px + ux * r, py + uy * r)
    ctx.lineTo(px + ux * (r - 11.5 * k), py + uy * (r - 11.5 * k))
  }
  ctx.lineWidth = 1.3 * k
  ctx.strokeStyle = `rgba(${SLATE},.75)`
  ctx.stroke()

  // numbers every 30°, lifted a little off the base line and kept upright
  // whichever way the stencil is turned
  ctx.font = `500 ${STENCIL_PX.label * k}px "Segoe UI", system-ui, sans-serif`
  ctx.fillStyle = `rgba(${SLATE},.78)`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let deg = 0; deg <= 180; deg += 30) {
    const phi = a - deg * Math.PI / 180
    const lr = r - 26 * k
    let rot = phi
    if (Math.cos(rot) < 0) rot += Math.PI
    ctx.save()
    ctx.translate(px + Math.cos(phi) * lr + ix * 2.5 * k, py + Math.sin(phi) * lr + iy * 2.5 * k)
    ctx.rotate(rot)
    ctx.fillText(String(deg), 0, 0)
    ctx.restore()
  }

  // the base (the 0-180 axis) and a small centre mark at the pivot
  ctx.beginPath()
  ctx.moveTo(px - Math.cos(a) * r, py - Math.sin(a) * r)
  ctx.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r)
  ctx.lineWidth = 1.2 * k
  ctx.strokeStyle = `rgba(${GREY},.45)`
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(px - Math.cos(a) * 5 * k, py - Math.sin(a) * 5 * k)
  ctx.lineTo(px + Math.cos(a) * 5 * k, py + Math.sin(a) * 5 * k)
  ctx.moveTo(px - ix * 5 * k, py - iy * 5 * k)
  ctx.lineTo(px + ix * 5 * k, py + iy * 5 * k)
  ctx.lineWidth = k
  ctx.strokeStyle = `rgba(${ACCENT},.55)`
  ctx.stroke()

  // glass: a highlight hairline inside the arc, then the guide arc itself
  ctx.beginPath()
  ctx.arc(px, py, Math.max(1, r - 2.6 * k), a - Math.PI, a, false)
  ctx.lineWidth = 1.2 * k
  ctx.strokeStyle = 'rgba(255,255,255,.9)'
  ctx.stroke()
  if (snapActive) {
    ctx.beginPath(); ctx.arc(px, py, r, a - Math.PI, a, false)
    ctx.lineWidth = 10 * k
    ctx.strokeStyle = `rgba(${ACCENT},.18)`
    ctx.stroke()
  }
  ctx.beginPath(); ctx.arc(px, py, r, a - Math.PI, a, false)
  ctx.lineWidth = 2 * k
  ctx.strokeStyle = `rgba(${ACCENT},${snapActive ? .95 : .72})`
  ctx.stroke()

  const knob = knobCenter(px, py, ix, iy, scale)
  paintKnob(ctx, knob.x, knob.y, knob.r, scale, snapActive)
  if (rotate) paintRotateRing(ctx, rotate.x, rotate.y, scale, snapActive)
}
