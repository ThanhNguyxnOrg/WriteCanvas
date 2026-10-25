import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeStroke,
  addPoint,
  pressureFactor,
  strokeIntersectsCircle,
  PEN_TYPES,
  PEN_PALETTE,
  QUICK_PALETTE,
  DEFAULT_PEN_SLOTS,
} from '../src/js/pen.js'
import { SIZES, TEMPLATES, paperDocSize, paperMM, DOC_DPI } from '../src/js/paper.js'
import { clipLineToRect } from '../src/js/ruler.js'

describe('pen and paper pure logic', () => {
  it('strokeIntersectsCircle hits the spine plus half the pen width', () => {
    const line = {
      type: 'marker',
      width: 4,
      pts: [
        { x: 100, y: 200, p: 0.5 },
        { x: 300, y: 200, p: 0.5 },
        { x: 500, y: 200, p: 0.5 },
      ],
    }
    assert.equal(strokeIntersectsCircle(line, 300, 205, 10), true)
    assert.equal(strokeIntersectsCircle(line, 300, 211, 10), true) // within 10 + half width
    assert.equal(strokeIntersectsCircle(line, 300, 260, 10), false)
    // sparse samples: the ink between vertices must still be selectable/erasable
    assert.equal(strokeIntersectsCircle(line, 200, 200, 1), true)
    assert.equal(strokeIntersectsCircle(line, 200, 250, 1), false)
  })

  it('makeStroke and addPoint drop samples closer than minDist', () => {
    const stroke = makeStroke({ type: 'marker', color: '#004DE6' }, 4)
    assert.equal(addPoint(stroke, 10, 10, 0.5, 5), true)
    assert.equal(addPoint(stroke, 12, 12, 0.5, 5), false)
    assert.equal(addPoint(stroke, 20, 20, 0.7, 5), true)
    assert.equal(stroke.pts.length, 2)
    assert.ok(pressureFactor(0.8) > pressureFactor(0.2))
  })

  it('exposes 5 pen instruments, 30 inks, 7 quick colours and 10 pen slots', () => {
    assert.equal(Object.keys(PEN_TYPES).length, 5)
    assert.equal(PEN_PALETTE.length, 30)
    assert.equal(QUICK_PALETTE.length, 7)
    assert.equal(DEFAULT_PEN_SLOTS.length, 10)
  })

  it('exposes 20 paper templates and rotates page dimensions', () => {
    assert.equal(Object.keys(TEMPLATES).length, 20)
    assert.deepEqual(paperDocSize('a4', 'portrait'), { w: SIZES.a4.w, h: SIZES.a4.h })
    assert.deepEqual(paperDocSize('a4', 'landscape'), { w: SIZES.a4.h, h: SIZES.a4.w })
    assert.deepEqual(paperDocSize('unknown', 'portrait'), { w: SIZES.letter.w, h: SIZES.letter.h })
  })

  it('paperMM reports physical print sizes, not document pixels', () => {
    assert.deepEqual(paperMM('letter', 'portrait'), { w: 215.9, h: 279.4 })
    assert.deepEqual(paperMM('letter', 'landscape'), { w: 279.4, h: 215.9 })
    assert.deepEqual(paperMM('a4', 'portrait'), { w: 210, h: 297 })
    assert.deepEqual(paperMM('a4', 'landscape'), { w: 297, h: 210 })
    assert.deepEqual(paperMM('unknown', 'portrait'), { w: 215.9, h: 279.4 })
    // A Letter PDF must not inherit the 2500×3235 px raster dimensions.
    assert.ok(paperMM('letter', 'portrait').w < 300)
    // The physical table and the document-pixel table must describe the same
    // paper; drift between them would make PDFs the wrong physical size.
    for (const [size, px] of Object.entries(SIZES)) {
      const mm = paperMM(size, 'portrait')
      const fromMM = { w: Math.round(mm.w * DOC_DPI / 25.4), h: Math.round(mm.h * DOC_DPI / 25.4) }
      assert.ok(Math.abs(fromMM.w - px.w) <= 1, `${size} width: ${fromMM.w}px vs ${px.w}px`)
      assert.ok(Math.abs(fromMM.h - px.h) <= 1, `${size} height: ${fromMM.h}px vs ${px.h}px`)
    }
  })
})

describe('ruler line clipping', () => {
  it('preserves the requested angle instead of clamping x/y independently', () => {
    const w = 2500, h = 3235
    for (const [px, py] of [[1250, 1779], [1563, 721], [100, 100], [2400, 3100]]) {
      for (const deg of [0, 10, 20, 45, 90, 135, -40]) {
        const rad = deg * Math.PI / 180
        const seg = clipLineToRect(px, py, Math.cos(rad), Math.sin(rad), w, h)
        assert.ok(seg, `expected an intersection at ${deg}° from ${px},${py}`)
        const drawn = Math.atan2(seg.y1 - seg.y0, seg.x1 - seg.x0) * 180 / Math.PI
        assert.ok(Math.abs(drawn - deg) < 1e-6, `requested ${deg}°, drew ${drawn}°`)
        for (const [x, y] of [[seg.x0, seg.y0], [seg.x1, seg.y1]]) {
          assert.ok(x >= -1e-9 && x <= w + 1e-9 && y >= -1e-9 && y <= h + 1e-9)
        }
      }
    }
  })

  it('returns null when the line misses the page', () => {
    assert.equal(clipLineToRect(-100, -100, 1, 0, 2500, 3235), null)
  })
})
