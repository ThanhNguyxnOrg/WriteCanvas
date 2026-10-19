// Scan a decoded PNG raster for anomalous dark (non-red-ink) pixels, e.g. the
// 2x3 px render speck the recon agent reported. Also dumps a crop around each
// hit cluster for visual inspection.
// Usage: node scripts/scan-speck.mjs <png> [outCrop.png]
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { decodePNG } from './measure-paper.mjs'

const file = process.argv[2]
const cropOut = process.argv[3]
const { w, h, data } = decodePNG(readFileSync(file))

const hits = []
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4
    const r = data[o], g = data[o + 1], b = data[o + 2], a = data[o + 3]
    if (a === 0) continue
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    // dark AND visibly desaturated (red ink strokes are r >> g,b)
    if (lum < 90 && r - Math.max(g, b) < 40) hits.push([x, y, r, g, b])
  }
}
console.log(`dark non-red pixels: ${hits.length}`)
for (const [x, y, r, g, b] of hits.slice(0, 40)) console.log(`  (${x},${y}) rgb(${r},${g},${b})`)
if (hits.length > 40) console.log('  …')

if (cropOut && hits.length) {
  const cx = hits[0][0], cy = hits[0][1]
  const R = 40
  const x0 = Math.max(0, cx - R), y0 = Math.max(0, cy - R)
  const cw = Math.min(w, cx + R) - x0, chh = Math.min(h, cy + R) - y0
  // minimal PNG writer: 8-bit RGBA, filter 0, one IDAT
  const stride = cw * 4
  const raw = Buffer.alloc((stride + 1) * chh)
  for (let y = 0; y < chh; y++) {
    raw[y * (stride + 1)] = 0
    for (let x = 0; x < cw; x++) {
      const so = ((y0 + y) * w + (x0 + x)) * 4
      const d = y * (stride + 1) + 1 + x * 4
      raw[d] = data[so]; raw[d + 1] = data[so + 1]; raw[d + 2] = data[so + 2]; raw[d + 3] = 255
    }
  }
  const crcTable = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc32 = b => {
    let c = 0xffffffff
    for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, payload) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(payload.length)
    const td = Buffer.concat([Buffer.from(type), payload])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(cw, 0); ihdr.writeUInt32BE(chh, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(cropOut, png)
  console.log(`crop saved: ${cropOut} (${cw}x${chh} at ${x0},${y0})`)
}
