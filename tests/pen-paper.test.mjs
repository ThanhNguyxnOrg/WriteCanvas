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
import {
  clipLineToRect,
  lineSnapPoint,
  pointLineDistance,
  knobCenter,
  paintRulerStencil,
  paintProtractorStencil,
  STENCIL_PX,
} from '../src/js/ruler.js'

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

  it('a filled gallery shape is hit anywhere inside its box, not only on the outline', () => {
    // A filled circle drawn as a 65-point outline: the spine only follows the
    // rim, so a tap in the middle used to miss both the eraser and click-select.
    const rim = []
    for (let i = 0; i <= 64; i++) {
      const a = i / 64 * Math.PI * 2
      rim.push({ x: 400 + 100 * Math.cos(a), y: 400 + 100 * Math.sin(a), p: 0.5 })
    }
    const filled = { type: 'shape', width: 8, color: '#000', shape: { kind: 'circle', fill: true }, pts: rim }
    assert.equal(strokeIntersectsCircle(filled, 400, 400, 6), true)   // centre
    assert.equal(strokeIntersectsCircle(filled, 460, 400, 6), true)   // inside, mid-radius
    assert.equal(strokeIntersectsCircle(filled, 550, 400, 6), false)  // outside the rim
    // An outline-only shape keeps the thin-spine behaviour at the centre.
    const hollow = { ...filled, shape: { kind: 'circle', fill: false } }
    assert.equal(strokeIntersectsCircle(hollow, 400, 400, 6), false)
    assert.equal(strokeIntersectsCircle(hollow, 500, 400, 6), true)
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

  it('lineSnapPoint projects onto the ruler line and keeps the along-line position', () => {
    // 30° stencil through (1000, 1500)
    const rad = 30 * Math.PI / 180
    const ux = Math.cos(rad), uy = Math.sin(rad)
    // a point 40 doc px above the line, 200 along it
    const t = 200
    const x = 1000 + ux * t - uy * 40
    const y = 1500 + uy * t + ux * 40
    const snapped = lineSnapPoint(x, y, 1000, 1500, ux, uy)
    assert.ok(Math.abs(snapped.t - t) < 1e-9)
    assert.ok(Math.abs(snapped.x - (1000 + ux * t)) < 1e-9)
    assert.ok(Math.abs(snapped.y - (1500 + uy * t)) < 1e-9)
  })

  it('pointLineDistance measures the perpendicular gap to the stencil', () => {
    assert.equal(pointLineDistance(5, 30, 0, 0, 1, 0), 30)
    assert.equal(pointLineDistance(5, -12, 0, 0, 1, 0), 12)
    // vertical stencil: distance is the horizontal gap
    assert.equal(pointLineDistance(-7, 99, 0, 0, 0, 1), 7)
  })
})

describe('stencil painters', () => {
  const PAGE = { w: 2500, h: 3235 }
  const MM = (2500 / 8.5) / 25.4 // docMM(1), the physical millimetre

  // A recorder 2D context: enough of the API for the painters and it keeps
  // every op, the effective stroke width and the drawn texts, so the
  // graduations and handles can be checked without a browser.
  function recorder() {
    const ops = []
    const texts = []
    const rec = (op) => (...args) => {
      ops.push({ op, args, lineWidth: ctx.lineWidth, strokeStyle: ctx.strokeStyle, fillStyle: ctx.fillStyle })
    }
    const ctx = {
      ops, texts,
      lineWidth: 1, strokeStyle: '', fillStyle: '', font: '',
      textAlign: '', textBaseline: '', lineCap: '', lineJoin: '',
      beginPath: rec('beginPath'), closePath: rec('closePath'),
      moveTo: rec('moveTo'), lineTo: rec('lineTo'), arcTo: rec('arcTo'), arc: rec('arc'),
      fill: rec('fill'), stroke: rec('stroke'),
      save: rec('save'), restore: rec('restore'),
      translate: rec('translate'), rotate: rec('rotate'),
      fillText: (text, x, y) => { texts.push({ text, x, y }); ops.push({ op: 'fillText', args: [x, y] }) },
      createLinearGradient: (...a) => { ops.push({ op: 'createLinearGradient', args: a }); return { addColorStop () {} } },
      createRadialGradient: (...a) => { ops.push({ op: 'createRadialGradient', args: a }); return { addColorStop () {} } },
    }
    return ctx
  }
  const finite = ctx => ctx.ops.flatMap(o => o.args.filter(v => typeof v === 'number')).every(Number.isFinite)

  // Graduation marks are moveTo(x, 0) / lineTo(same x, len) pairs; the body and
  // the guide are drawn with different endpoints and stay out of the list.
  const tickPairs = (ctx) => {
    const out = []
    for (let i = 1; i < ctx.ops.length; i++) {
      const a = ctx.ops[i - 1]
      const b = ctx.ops[i]
      if (a.op === 'moveTo' && b.op === 'lineTo' && a.args[1] === 0 && b.args[1] > 0 && b.args[0] === a.args[0]) {
        out.push([a.args[0], b.args[1]])
      }
    }
    return out
  }

  const lineCase = (deg, scale, snapActive = false) => {
    const px = PAGE.w * 0.5
    const py = PAGE.h * 0.55
    const rad = deg * Math.PI / 180
    const ux = Math.cos(rad)
    const uy = Math.sin(rad)
    return { px, py, ux, uy, seg: clipLineToRect(px, py, ux, uy, PAGE.w, PAGE.h), scale, snapActive, mm: MM }
  }

  it('knobCenter sits the puck half a body into the body, at any zoom', () => {
    const k = knobCenter(100, 200, 0, 1, 0.5)
    assert.equal(k.x, 100)
    assert.equal(k.y, 200 + STENCIL_PX.body / 2 * 2)
    assert.equal(k.r, STENCIL_PX.knob * 2)
    const k2 = knobCenter(100, 200, 1, 0, 1)
    assert.equal(k2.x, 100 + STENCIL_PX.body / 2)
    assert.equal(k2.r, STENCIL_PX.knob)
  })

  it('paintRulerStencil prints centimetres from the grip, on the millimetre grid', () => {
    const ctx = recorder()
    paintRulerStencil(ctx, lineCase(0, 0.5))
    assert.ok(ctx.ops.length > 50)
    assert.ok(finite(ctx), 'a painter argument was not finite')
    const labels = ctx.texts.map(t => t.text)
    assert.equal(labels.length, 20) // ±1..10 cm at 0.5 zoom
    assert.ok(labels.includes('1') && labels.includes('10'))
    const ticks = tickPairs(ctx)
    assert.ok(ticks.length > 100)
    for (const [x, len] of ticks) {
      assert.ok(Math.abs(x / MM - Math.round(x / MM)) < 1e-6, `tick at ${x} is off the millimetre grid`)
      assert.equal(len > 0, true)
      assert.ok(len >= 4 / 0.5 - 1e-9 && len <= 13 / 0.5 + 1e-9, `tick length ${len}`)
    }
    // graduations stay inside the clipped segment, plus the edge marks
    const xs = ticks.map(p => p[0])
    assert.ok(Math.min(...xs) >= -PAGE.w / 2 - 2 * MM)
    assert.ok(Math.max(...xs) <= PAGE.w / 2 + 2 * MM)
    // the snap line is the widest accent stroke on the layer
    const guide = ctx.ops.filter(o => o.op === 'stroke' && Math.abs(o.lineWidth - 2 / 0.5) < 1e-9)
    assert.equal(guide.length, 1)
  })

  it('paintRulerStencil follows the line angle and thins out when far out', () => {
    const ctx = recorder()
    paintRulerStencil(ctx, lineCase(30, 0.47))
    const rot = ctx.ops.find(o => o.op === 'rotate')
    assert.ok(rot && Math.abs(rot.args[0] - 30 * Math.PI / 180) < 1e-9, 'the painter must rotate into the line frame')
    assert.ok(finite(ctx))
    const near = recorder()
    paintRulerStencil(near, lineCase(0, 0.47))
    const far = recorder()
    paintRulerStencil(far, lineCase(0, 0.2))
    assert.ok(tickPairs(far).length < tickPairs(near).length, 'fine graduations should drop out at 0.2 zoom')
  })

  it('paintRulerStencil glows along the edge while a stroke rides it', () => {
    const ctx = recorder()
    paintRulerStencil(ctx, lineCase(0, 0.47, true))
    const glow = ctx.ops.filter(o => o.op === 'stroke' && Math.abs(o.lineWidth - 10 / 0.47) < 1e-6)
    assert.equal(glow.length, 1)
  })

  it('paintProtractorStencil prints every 30°, ticks the arc and reuses the shared handles', () => {
    const ctx = recorder()
    const px = 1250
    const py = 1779
    const r = 650
    const scale = 0.47
    const ring = { x: px, y: py - r + 26 / scale }
    paintProtractorStencil(ctx, { px, py, a: 0, r, scale, snapActive: false, rotate: ring })
    assert.ok(finite(ctx))
    assert.deepEqual(ctx.texts.map(t => t.text), ['0', '30', '60', '90', '120', '150', '180'])
    // 37 marks (0..180 by 5°) run from the arc inward, all screen-constant
    const ticks = []
    for (let i = 1; i < ctx.ops.length; i++) {
      const a = ctx.ops[i - 1]
      const b = ctx.ops[i]
      if (a.op !== 'moveTo' || b.op !== 'lineTo') continue
      const dA = Math.hypot(a.args[0] - px, a.args[1] - py)
      const dB = Math.hypot(b.args[0] - px, b.args[1] - py)
      if (Math.abs(dA - r) < 1e-6 && dB < r - 1e-6) ticks.push({ len: (r - dB) * scale, deg: Math.atan2(-(a.args[1] - py), a.args[0] - px) * 180 / Math.PI })
    }
    assert.equal(ticks.length, 37)
    for (const t of ticks) {
      assert.ok([5, 8, 11.5].some(v => Math.abs(t.len - v) < 1e-6), `tick length ${t.len} screen px`)
      assert.ok(Math.abs(t.deg - Math.round(t.deg / 5) * 5) < 1e-6)
    }
    // grip puck and rotate ring are the same drawn shapes as the ruler's
    const circles = ctx.ops.filter(o => o.op === 'arc')
    const knob = knobCenter(px, py, Math.cos(-Math.PI / 2), Math.sin(-Math.PI / 2), scale)
    assert.ok(circles.some(o => Math.abs(o.args[0] - knob.x) < 1e-6 && Math.abs(o.args[1] - knob.y) < 1e-6 && Math.abs(o.args[2] - knob.r) < 1e-6), 'grip puck missing')
    assert.ok(circles.some(o => Math.abs(o.args[0] - ring.x) < 1e-6 && Math.abs(o.args[1] - ring.y) < 1e-6 && Math.abs(o.args[2] - STENCIL_PX.ring / scale) < 1e-6), 'rotate ring missing')
  })
})
