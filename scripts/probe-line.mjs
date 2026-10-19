// Probe a horizontal row or vertical column of a PNG: print positions of
// colored runs. Usage: node scripts/probe-line.mjs <png> row|col <index> [x0 x1]
import { readFileSync } from 'node:fs'
import { decodePNG } from './measure-paper.mjs'

const [src, mode, idx, a0, a1] = process.argv.slice(2)
const { w, h, data } = decodePNG(readFileSync(src))
const from = a0 ? Math.max(0, +a0) : 0
const to = a1 ? Math.min(mode === 'row' ? w : h, +a1) : (mode === 'row' ? w : h)
const px = (i, k) => {
  const [x, y] = mode === 'row' ? [i, +idx] : [+idx, i]
  const o = (y * w + x) * 4
  return [data[o], data[o + 1], data[o + 2], data[o + 3]]
}
const runs = []
let s = -1
let col0 = null
for (let i = from; i < to; i++) {
  const [r, g, b, al] = px(i)
  const hit = al > 0 && (r < 246 || g < 246 || b < 246)
  if (hit) {
    if (s < 0) { s = i; col0 = [r, g, b, al] }
  } else if (s >= 0) {
    runs.push([s, i - 1, col0[0], col0[1], col0[2], col0[3]])
    s = -1
  }
}
if (s >= 0) runs.push([s, to - 1, col0[0], col0[1], col0[2], col0[3]])
console.log(`${src.split(/[\\/]/).pop()} ${mode}=${idx} [${from}..${to}) runs=${runs.length}`)
console.log(runs.slice(0, 60).map(r => r.join(',')).join(' | '))
