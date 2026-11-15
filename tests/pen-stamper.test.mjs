// Guards the one ink-stamp builder that both the flatten path and the live
// stroke preview share. The live path feeds points as they arrive and paints
// each feed's permanent stamps plus its provisional tail; whatever the mask
// holds at pen-up must be exactly the canonical single-pass build, or
// committing a stroke would visibly change it under the pen (the old model
// let the re-walked tail and re-anchored pencil grain do exactly that).
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStamps, createStrokeStamper, PEN_TYPES } from '../src/js/pen.js'

// Deterministic pseudo-random walk, sampled at least the editor's min distance.
function strokeOf(type, width, n, seed = 1) {
  let s = seed >>> 0
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
  const pts = []
  let x = 100, y = 100, dir = 0
  for (let i = 0; i < n; i++) {
    dir += (rnd() - 0.5) * 0.9
    const step = 3 + rnd() * 25
    x += Math.cos(dir) * step
    y += Math.sin(dir) * step
    pts.push({ x, y, p: 0.2 + rnd() * 0.8 })
  }
  return { type, color: '#FF0000', width, pts }
}

const key = s => JSON.stringify(s)
const stampBox = s => {
  const hw = s.kind === 'disc' ? s.r : (Math.abs(Math.cos(s.angle)) * s.len + Math.abs(Math.sin(s.angle)) * s.wid) / 2
  const hh = s.kind === 'disc' ? s.r : (Math.abs(Math.sin(s.angle)) * s.len + Math.abs(Math.cos(s.angle)) * s.wid) / 2
  return { x0: s.x - hw, y0: s.y - hh, x1: s.x + hw, y1: s.y + hh }
}
const touches = (s, box) => {
  const b = stampBox(s)
  return b.x0 <= box.x0 + box.w && b.x1 >= box.x0 && b.y0 <= box.y0 + box.h && b.y1 >= box.y0
}

test('feeding every point at once finalises to the canonical stamp build', () => {
  for (const type of Object.keys(PEN_TYPES)) {
    const stroke = strokeOf(type, 2, 40)
    const live = { ...stroke, pts: [] }
    const stamper = createStrokeStamper(live)
    live.pts.push(...stroke.pts)
    stamper.feed(true)
    assert.deepEqual(stamper.all(), buildStamps(stroke, PEN_TYPES[type]), type)
  }
})

// What the editor paints — permanent stamps from every feed, plus the tail of
// the last feed, with each feed's tail replacing the previous one — must equal
// the canonical stamp set. This is the "pen-up changes nothing" guarantee,
// checked at the stamp level for every pen type.
test('the live mask (permanent stamps + last tail) equals the canonical stamps', () => {
  for (const type of Object.keys(PEN_TYPES)) {
    for (const n of [2, 3, 17, 120]) {
      const stroke = strokeOf(type, 2.5, n)
      const canonical = buildStamps(stroke, PEN_TYPES[type])
      const live = { ...stroke, pts: [] }
      const stamper = createStrokeStamper(live)
      const masked = new Set()
      let lastTail = []
      for (const p of stroke.pts) {
        live.pts.push(p)
        const batch = stamper.feed(false)
        for (const s of batch.stable) masked.add(key(s))
        lastTail = batch.tail
      }
      for (const s of lastTail) masked.add(key(s))
      const canon = new Set(canonical.stamps.map(key))
      assert.equal(masked.size, canon.size, `${type} (n=${n}): live mask has a different stamp count`)
      for (const s of canon) assert.ok(masked.has(s), `${type} (n=${n}): live mask is missing a canonical stamp`)
      for (const s of masked) assert.ok(canon.has(s), `${type} (n=${n}): live mask holds a stamp the commit will not have`)
    }
  }
})

// The mask is a union, so the tail can be wiped and repainted in place: every
// permanent stamp inside the wiped box must be offered back, or the repaint
// would punch a hole in the stroke body.
test('covers() restores every permanent stamp inside a wiped tail box', () => {
  for (const type of Object.keys(PEN_TYPES)) {
    const stroke = strokeOf(type, 2.5, 60)
    const live = { ...stroke, pts: [] }
    const stamper = createStrokeStamper(live)
    const permanent = []
    let checked = 0
    for (const p of stroke.pts) {
      live.pts.push(p)
      const batch = stamper.feed(false)
      permanent.push(...batch.stable)
      if (!batch.tailBox) continue
      checked++
      const covered = new Set(stamper.covers(batch.tailBox).map(key))
      for (const s of permanent) {
        if (touches(s, batch.tailBox)) {
          assert.ok(covered.has(key(s)), `${type}: covers() dropped a permanent stamp under the tail`)
        }
      }
    }
    assert.ok(checked > 1, `${type}: expected more than one provisional tail`)
  }
})

test('highlighter: the closing cap is already in the last live tail', () => {
  const stroke = strokeOf('highlighter', 3, 30)
  const canonical = buildStamps(stroke, PEN_TYPES.highlighter)
  const capLen = stroke.width * PEN_TYPES.highlighter.wScale * 1.2
  const last = stroke.pts[stroke.pts.length - 1]
  const closing = canonical.stamps.filter(s => s.kind === 'rect' && s.len === capLen && Math.hypot(s.x - last.x, s.y - last.y) < 1e-6)
  assert.equal(closing.length, 1, 'expected exactly one closing cap')
  const live = { ...stroke, pts: [] }
  const stamper = createStrokeStamper(live)
  for (const p of stroke.pts) { live.pts.push(p); stamper.feed(false) }
  const tail = stamper.feed(false).tail
  for (const cap of closing) {
    assert.ok(tail.some(s => key(s) === key(cap)), 'the closing cap only arrived at finalise')
  }
})

test('a single point still stamps, and the build is deterministic', () => {
  for (const type of Object.keys(PEN_TYPES)) {
    const stroke = { type, color: '#000', width: 2.5, pts: [{ x: 10, y: 20, p: 0.5 }] }
    const a = buildStamps(stroke, PEN_TYPES[type])
    const b = buildStamps(stroke, PEN_TYPES[type])
    assert.ok(a.stamps.length >= 1, `${type}: a tap stamps nothing`)
    assert.deepEqual(a, b, `${type}: build is not deterministic`)
  }
})
