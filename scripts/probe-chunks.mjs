// Chunk-writer unit sanity + real-file repair check (run: node scripts/probe-chunks.mjs)
import { upsertChunks, parseChunks } from '../main/png-chunks.js'
import { repairPNG } from '../main/scrble-format.js'
import fs from 'node:fs'
import zlib from 'node:zlib'

// fake multi-IDAT PNG: IHDR + 3 IDAT + IEND
const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const mk = (type, data) => {
  const h = Buffer.alloc(8)
  h.writeUInt32BE(data.length, 0)
  h.write(type, 4, 'ascii')
  return Buffer.concat([h, data, Buffer.alloc(4)])
}
const base = Buffer.concat([sig, mk('IHDR', Buffer.alloc(13)), mk('IDAT', Buffer.alloc(64, 1)), mk('IDAT', Buffer.alloc(64, 2)), mk('IDAT', Buffer.alloc(64, 3)), mk('IEND', Buffer.alloc(0))])
const entries = ['sVER', 'sINK', 'sLYT', 'sBKG', 'sCRP', 'sSTD', 'sPNA', 'sBKC', 'sBRL', 'sVec'].map(t => ({ type: t, data: Buffer.from(t) }))
const out = upsertChunks(base, entries)
const chunks = parseChunks(out)
const order = chunks.map(c => c.type).join(',')
const idatConsecutive = order.startsWith('IHDR,IDAT,IDAT,IDAT,sVER')

// real broken file: repair and validate the zlib stream decodes to raw size
const path = process.argv[2]
let repairedSize = 0, realOK = null
if (path) {
  const b = fs.readFileSync(path)
  const fixed = repairPNG(b)
  repairedSize = fixed.length
  const cs = parseChunks(fixed)
  const idatBuf = Buffer.concat(cs.filter(c => c.type === 'IDAT').map(c => c.data))
  const ihdr = cs.find(c => c.type === 'IHDR')
  const w = ihdr.data.readUInt32BE(0), h = ihdr.data.readUInt32BE(4), bpp = ihdr.data[8] >= 6 ? 4 : 3
  const raw = zlib.inflateSync(idatBuf)
  realOK = raw.length === (w * bpp + 1) * h
}
console.log(JSON.stringify({ upsertOrder: order, idatConsecutive, nIDAT: chunks.filter(c => c.type === 'IDAT').length, repairedSize, realOK }))
