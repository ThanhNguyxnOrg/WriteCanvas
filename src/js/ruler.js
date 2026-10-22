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
