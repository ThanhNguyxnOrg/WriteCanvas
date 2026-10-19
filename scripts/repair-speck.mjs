// Surgical pixel repair for Scrble Ink note PNGs: rewrite a small rect while
// keeping every non-IDAT chunk (sVER, sINK, sLYT, sBKG, sCRP, sSTD, sPNA, sBKC,
// sBRL, pHYs, gAMA, sRGB, ...) byte-identical. IDAT is re-encoded from the
// decoded raster with the patch applied.
//
// Usage: node scripts/repair-speck.mjs <note.png> <out.png> x1,y1,x2,y2 [more rects...]
// Rect corners are inclusive raster coordinates. Fill color = local paper
// background (white); a ruled line crossing the rect is redrawn (#B3DCFE when
// the grid pitch/offset match the Letter default — pass --keep-lines to enable,
// default keeps it simple: pure background fill).
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { decodePNG } from './measure-paper.mjs'

const [, , src, dst, ...rectsRaw] = process.argv
if (!src || !dst || !rectsRaw.length) {
  console.error('usage: node scripts/repair-speck.mjs <src.png> <dst.png> x1,y1,x2,y2 [...]')
  process.exit(1)
}
const rects = rectsRaw.map(r => r.split(',').map(Number))

const bytes = readFileSync(src)
const { w, h, data } = decodePNG(bytes)

// walk original chunks so everything except IDAT is copied verbatim
const chunks = []
let off = 8
while (off + 8 <= bytes.length) {
  const len = bytes.readUInt32BE(off)
  const type = bytes.toString('ascii', off + 4, off + 8)
  if (type === 'IHDR') chunks.push({ type, payload: bytes.subarray(off + 8, off + 8 + 13) })
  else if (type === 'IDAT') { /* replaced below */ }
  else chunks.push({ type, payload: bytes.subarray(off + 8, off + 8 + len) })
  off += 12 + len
  if (type === 'IEND') break
}

for (const [x1, y1, x2, y2] of rects) {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const o = (y * w + x) * 4
      data[o] = 255; data[o + 1] = 255; data[o + 2] = 255; data[o + 3] = 255
    }
  }
}

// re-encode: RGBA8, filter 0, one IDAT
const stride = w * 4
const raw = Buffer.alloc((stride + 1) * h)
for (let y = 0; y < h; y++) {
  raw[y * (stride + 1)] = 0
  data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
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
  const head = Buffer.alloc(8)
  head.writeUInt32BE(payload.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), payload])))
  return Buffer.concat([head, payload, crc])
}
for (let i = 0; i < chunks.length; i++) {
  if (chunks[i].type === 'IHDR') {
    chunks.splice(i + 1, 0, { type: 'IDAT', payload: deflateSync(raw, { level: 9 }) })
    break
  }
}
const out = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ...chunks.map(c => chunk(c.type, c.payload)),
])
writeFileSync(dst, out)
console.log(`patched ${rects.length} rect(s), wrote ${dst} (${out.length} bytes; source ${bytes.length})`)
