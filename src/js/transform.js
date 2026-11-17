// Selection transform: enlarging or shrinking what a selection holds (ink,
// text, pictures) around a fixed point, like dragging a corner of the box in
// the original app. Pure maths, no DOM, so the unit suite can check the whole
// resize gesture: the editor turns a corner drag into one factor with
// `scaleFromDrag`, applies it with the `scale*` helpers, and the undo entry
// carries the same factor back.
//
// The factor is uniform (both axes together): a handwriting block, a text box
// and a pasted screenshot keep their shape. Everything is in document pixels.

export const MIN_SCALE = 0.05
export const MAX_SCALE = 20

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
// A resize is a hand gesture, not a measurement: two decimals of a document
// pixel is far below one screen pixel at any zoom, and it keeps the saved
// vector JSON compact.
const r2 = v => Math.round(v * 100) / 100

// The four corner handles of a selection box, clockwise from the top left.
// `pad` is the gap the box is drawn at: the editor divides the screen gap by
// the zoom, so the box and its handles stay the same size on screen.
export const CORNERS = ['nw', 'ne', 'sw', 'se']

export function handlePoints(box, pad) {
  return [
    { corner: 'nw', x: box.x - pad, y: box.y - pad },
    { corner: 'ne', x: box.x + box.w + pad, y: box.y - pad },
    { corner: 'sw', x: box.x - pad, y: box.y + box.h + pad },
    { corner: 'se', x: box.x + box.w + pad, y: box.y + box.h + pad },
  ]
}

// Which handle a pointer at (x, y) grabbed: the first corner within `r`
// document pixels, or null. The editor tests this before it starts a move, so
// a corner drag resizes even when it begins just outside the box.
export function handleAt(box, pad, x, y, r) {
  if (!box || !(r > 0)) return null
  for (const h of handlePoints(box, pad)) {
    const dx = x - h.x, dy = y - h.y
    if (dx * dx + dy * dy <= r * r) return h.corner
  }
  return null
}

// The corner that stays put while `corner` is dragged: the diagonally
// opposite handle, in document pixels. The selection grows away from it.
export function anchorFor(box, pad, corner) {
  const opposite = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }[corner]
  const h = handlePoints(box, pad).find(p => p.corner === opposite)
  return h ? { x: h.x, y: h.y } : { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}

// The uniform factor for a drag that started at (sx, sy) and is now at
// (x, y): how much further from the anchor the pointer is than it started. A
// pointer that has not moved (or started on the anchor) is a factor of 1, and
// the result is clamped so a selection can never collapse to nothing or
// explode past the canvas.
export function scaleFromDrag(ax, ay, sx, sy, x, y) {
  const d0 = Math.hypot(sx - ax, sy - ay)
  if (!(d0 > 0)) return 1
  return clamp(Math.hypot(x - ax, y - ay) / d0, MIN_SCALE, MAX_SCALE)
}

// One stroke scaled around (ax, ay): the spine moves and the nib width scales
// with it, so a resized stroke still looks like the same pen. Filled gallery
// shapes carry no width of their own.
export function scaleStroke(st, s, ax, ay) {
  if (!st || !(s > 0)) return st
  for (const p of st.pts || []) {
    p.x = r2(ax + (p.x - ax) * s)
    p.y = r2(ay + (p.y - ay) * s)
  }
  if (typeof st.width === 'number' && st.width > 0) st.width = r2(st.width * s)
  return st
}

// A text box scales its font size along with its position, so the text keeps
// its place in the resized block and stays editable at the new size.
export function scaleText(t, s, ax, ay) {
  if (!t || !(s > 0)) return t
  t.x = r2(ax + (t.x - ax) * s)
  t.y = r2(ay + (t.y - ay) * s)
  if (typeof t.size === 'number' && t.size > 0) t.size = r2(t.size * s)
  return t
}

// A picture scales its box. The stored image data is left alone, so enlarging
// a small screenshot softens it instead of re-encoding it on every drag.
export function scaleImage(o, s, ax, ay) {
  if (!o || !(s > 0)) return o
  o.x = r2(ax + (o.x - ax) * s)
  o.y = r2(ay + (o.y - ay) * s)
  o.w = Math.max(1, r2(o.w * s))
  o.h = Math.max(1, r2(o.h * s))
  return o
}

// A box scaled the same way: the editor keeps the selection box following the
// objects while a handle is dragged, and the undo entry restores it through
// the recomputed union when the gesture ends.
export function scaleBox(b, s, ax, ay) {
  if (!b) return b
  return {
    x: r2(ax + (b.x - ax) * s),
    y: r2(ay + (b.y - ay) * s),
    w: Math.max(0, r2(b.w * s)),
    h: Math.max(0, r2(b.h * s)),
  }
}
