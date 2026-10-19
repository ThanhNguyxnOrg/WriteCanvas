// Probe exact pixel colors at fractional positions in given PNGs (chrome sampling).
// Usage: node scripts/probe-chrome.mjs <png> x,y [x,y ...]   (x,y = fractions 0..1)
import { readFileSync } from 'node:fs'
import { decodePNG } from './measure-paper.mjs'

const file = process.argv[2]
const { w, h, data } = decodePNG(readFileSync(file))
const pts = process.argv.slice(3).map(p => p.split(',').map(Number))
console.log(`${file.split(/[\\/]/).pop()} ${w}x${h}`)
for (const [fx, fy] of pts) {
  const x = Math.min(w - 1, Math.round(fx * w))
  const y = Math.min(h - 1, Math.round(fy * h))
  const o = (y * w + x) * 4
  const hex = '#' + [data[o], data[o + 1], data[o + 2]].map(v => v.toString(16).padStart(2, '0')).join('')
  console.log(`  (${fx},${fy}) px(${x},${y}) = ${hex}`)
}
