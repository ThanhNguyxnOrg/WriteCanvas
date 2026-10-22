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
import { SIZES, TEMPLATES, paperDocSize } from '../src/js/paper.js'

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
})
