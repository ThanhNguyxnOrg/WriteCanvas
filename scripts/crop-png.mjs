// Crop a rect from a PNG and save (for eyeballing asset details at real scale).
// Usage: node scripts/crop-png.mjs <src.png> x y w h <out.png>
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { decodePNG } from './measure-paper.mjs'

const [src, xs, ys, ws, hs, dst] = process.argv.slice(2)
const { w, h, data } = decodePNG(readFileSync(src))
const x0 = Math.max(0, +xs), y0 = Math.max(0, +ys)
const cw = Math.min(w, x0 + +ws) - x0, ch = Math.min(h, y0 + +hs) - y0

const stride = cw * 4
const raw = Buffer.alloc((stride + 1) * ch)
for (let y = 0; y < ch; y++) {
  raw[y * (stride + 1)] = 0
  for (let x = 0; x < cw; x++) {
    const so = ((y0 + y) * w + (x0 + x)) * 4
    const d = y * (stride + 1) + 1 + x * 4
    const a = data[so + 3] / 255
    // composite over white so line visibility matches the real asset
    raw[d] = Math.round(data[so] * a + 255 * (1 - a))
    raw[d + 1] = Math.round(data[so + 1] * a + 255 * (1 - a))
    raw[d + 2] = Math.round(data[so + 2] * a + 255 * (1 - a))
    raw[d + 3] = 255
  }
}
const crcTable = []
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}
const crc32 = b => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, payload) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(payload.length, 0); head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), payload])))
  return Buffer.concat([head, payload, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(cw, 0); ihdr.writeUInt32BE(ch, 4); ihdr[8] = 8; ihdr[9] = 6
writeFileSync(dst, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]))
console.log(`crop ${cw}x${ch} at (${x0},${y0}) -> ${dst}`)
