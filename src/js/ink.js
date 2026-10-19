// Ink stroke engine — variable-width pressure strokes, alpha-safe per-stroke
// rendering, stroke-eraser. Document coordinates are the 3x paper px.

import { docMM } from './paper.js'

// width factor from PointerEvent.pressure (0 for mouse -> treat as .5)
export function pressureFactor(p) {
  if (!p && p !== 0) return 1
  const v = p > 0 ? p : 0.5
  return 0.35 + 1.3 * v
}

function segmentPath(ctx, a, b, wa, wb) {
  ctx.beginPath()
  ctx.lineWidth = Math.max(0.5, wa)
  ctx.moveTo(a.x, a.y)
  // quadratic midpoint smoothing when a mid control exists
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
}

// Draw one stroke into ctx (opaque), as segments with variable width.
export function drawStrokeOpaque(ctx, stroke) {
  const pts = stroke.pts
  if (!pts.length) return
  ctx.save()
  ctx.strokeStyle = stroke.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.fillStyle = stroke.color
  if (pts.length === 1) {
    const p = pts[0]
    ctx.beginPath()
    ctx.arc(p.x, p.y, Math.max(0.5, stroke.width * pressureFactor(p.p) / 2), 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }
  // smooth: quadratic through midpoints, width sampled per point
  let prev = pts[0]
  let prevW = stroke.width * pressureFactor(prev.p)
  // dot for the start
  ctx.beginPath()
  ctx.arc(prev.x, prev.y, Math.max(0.5, prevW / 2), 0, Math.PI * 2)
  ctx.fill()
  for (let i = 1; i < pts.length; i++) {
    const cur = pts[i]
    const w = stroke.width * pressureFactor(cur.p)
    segmentPath(ctx, prev, cur, prevW, w)
    prev = cur; prevW = w
  }
  ctx.restore()
}

// Collect stroke points from pointer events into a stroke object.
export function makeStroke(color, widthDoc, opacity) {
  return { color, width: widthDoc, opacity, pts: [] }
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

// Stroke intersection test for the stroke eraser.
export function strokeIntersectsCircle(stroke, cx, cy, r) {
  const r2 = r * r
  for (const pt of stroke.pts) {
    const dx = pt.x - cx, dy = pt.y - cy
    if (dx * dx + dy * dy <= r2) return true
  }
  return false
}

export const docEraseR = mm => docMM(mm) / 2
