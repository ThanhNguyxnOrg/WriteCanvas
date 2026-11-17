// The resize gesture behind the selection's corner handles: which handle a
// pointer grabbed, which corner stays put, the factor a drag produces, and what
// scaling does to a stroke, a text box and a pasted picture.
//
// These rules decide whether a resize feels right and whether undo lands back
// where it started, so they are worth pinning down without a canvas.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  handlePoints,
  handleAt,
  anchorFor,
  scaleFromDrag,
  scaleStroke,
  scaleText,
  scaleImage,
  scaleBox,
  MIN_SCALE,
  MAX_SCALE,
} from '../src/js/transform.js'

const box = { x: 100, y: 200, w: 400, h: 300 }
const PAD = 14

describe('selection handles', () => {
  it('sits on the four corners of the box, padded like the drawn box', () => {
    assert.deepEqual(handlePoints(box, PAD), [
      { corner: 'nw', x: 86, y: 186 },
      { corner: 'ne', x: 514, y: 186 },
      { corner: 'sw', x: 86, y: 514 },
      { corner: 'se', x: 514, y: 514 },
    ])
  })

  it('grabs the handle under the pointer and nothing a pointer misses', () => {
    assert.equal(handleAt(box, PAD, 514, 514, 20), 'se')
    assert.equal(handleAt(box, PAD, 86, 186, 20), 'nw')
    assert.equal(handleAt(box, PAD, 300, 186, 20), null)   // halfway along an edge
    assert.equal(handleAt(box, PAD, 300, 350, 20), null)   // inside the box
  })

  it('uses the grab radius, not a fixed pixel count', () => {
    // 25 document px from the corner: inside a zoom-out grab radius, outside a
    // tight one.
    assert.equal(handleAt(box, PAD, 86 + 25, 186, 30), 'nw')
    assert.equal(handleAt(box, PAD, 86 + 25, 186, 12), null)
  })

  it('refuses a box or a radius it cannot use', () => {
    assert.equal(handleAt(null, PAD, 0, 0, 20), null)
    assert.equal(handleAt(box, PAD, 514, 514, 0), null)
  })

  it('anchors every drag on the corner opposite the grabbed one', () => {
    assert.deepEqual(anchorFor(box, PAD, 'se'), { x: 86, y: 186 })
    assert.deepEqual(anchorFor(box, PAD, 'nw'), { x: 514, y: 514 })
    assert.deepEqual(anchorFor(box, PAD, 'ne'), { x: 86, y: 514 })
    assert.deepEqual(anchorFor(box, PAD, 'sw'), { x: 514, y: 186 })
    // an unknown corner falls back to the box centre rather than throwing
    assert.deepEqual(anchorFor(box, PAD, 'xx'), { x: 300, y: 350 })
  })
})

describe('the factor a corner drag produces', () => {
  // Anchor at 0,0; the drag started 100 to the right.
  it('stays 1 until the pointer leaves its starting distance', () => {
    assert.equal(scaleFromDrag(0, 0, 100, 0, 100, 0), 1)
  })

  it('grows with the distance from the anchor and shrinks on the way back', () => {
    assert.equal(scaleFromDrag(0, 0, 100, 0, 200, 0), 2)
    assert.equal(scaleFromDrag(0, 0, 100, 0, 50, 0), 0.5)
    // the diagonal works the same way
    assert.equal(scaleFromDrag(0, 0, 30, 40, 60, 80), 2)
  })

  it('clamps a runaway or collapsing drag instead of producing a bad factor', () => {
    assert.equal(scaleFromDrag(0, 0, 100, 0, 100000, 0), MAX_SCALE)
    assert.equal(scaleFromDrag(0, 0, 100, 0, 0.0001, 0), MIN_SCALE)
  })

  it('is 1 when the drag started on the anchor', () => {
    assert.equal(scaleFromDrag(50, 50, 50, 50, 200, 200), 1)
  })
})

describe('scaling a stroke', () => {
  const mk = () => ({ type: 'marker', color: '#000000', width: 12, pts: [{ x: 10, y: 20, p: 0.5 }, { x: 30, y: 40, p: 0.7 }] })

  it('moves the spine and the nib width around the anchor', () => {
    const st = scaleStroke(mk(), 2, 0, 0)
    assert.deepEqual(st.pts, [{ x: 20, y: 40, p: 0.5 }, { x: 60, y: 80, p: 0.7 }])
    assert.equal(st.width, 24)
  })

  it('keeps the point the anchor names exactly where it was', () => {
    const st = mk()
    scaleStroke(st, 3, 10, 20)
    assert.deepEqual(st.pts[0], { x: 10, y: 20, p: 0.5 })
    assert.deepEqual(st.pts[1], { x: 70, y: 80, p: 0.7 })
  })

  it('scales down without losing the stroke', () => {
    const st = scaleStroke(mk(), 0.5, 0, 0)
    assert.deepEqual(st.pts, [{ x: 5, y: 10, p: 0.5 }, { x: 15, y: 20, p: 0.7 }])
    assert.equal(st.width, 6)
  })

  it('round-trips: scaling by s and back by 1/s lands on the original numbers', () => {
    const before = mk()
    const st = mk()
    scaleStroke(st, 1.7, 12, 34)
    scaleStroke(st, 1 / 1.7, 12, 34)
    assert.deepEqual(st.pts, before.pts)
    assert.equal(st.width, before.width)
  })

  it('leaves an object it cannot scale alone', () => {
    assert.equal(scaleStroke(null, 2, 0, 0), null)
    const st = mk()
    assert.deepEqual(scaleStroke(st, 0, 0, 0).pts, mk().pts)
    assert.deepEqual(scaleStroke(st, -1, 0, 0).pts, mk().pts)
  })
})

describe('scaling a text box and a picture', () => {
  it('scales the text size with the box position', () => {
    const t = { txt: 'hello', x: 110, y: 220, size: 50, color: '#111111' }
    scaleText(t, 2, 100, 200)
    assert.deepEqual({ x: t.x, y: t.y, size: t.size }, { x: 120, y: 240, size: 100 })
    assert.equal(t.txt, 'hello')
  })

  it('scales a picture box but never to a zero or negative size', () => {
    const o = { x: 100, y: 100, w: 400, h: 200, data: 'data:image/png;base64,AA' }
    scaleImage(o, 0.5, 100, 100)
    assert.deepEqual({ x: o.x, y: o.y, w: o.w, h: o.h }, { x: 100, y: 100, w: 200, h: 100 })
    scaleImage(o, 0.0001, 100, 100)
    assert.equal(o.w >= 1, true)
    assert.equal(o.h >= 1, true)
  })

  it('scales a box the way it scales the objects inside it', () => {
    assert.deepEqual(scaleBox({ x: 100, y: 200, w: 400, h: 300 }, 2, 100, 200), { x: 100, y: 200, w: 800, h: 600 })
    assert.deepEqual(scaleBox({ x: 0, y: 0, w: 40, h: 40 }, 0.5, 0, 0), { x: 0, y: 0, w: 20, h: 20 })
  })
})
