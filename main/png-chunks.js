'use strict'
// Minimal PNG chunk toolkit. We never touch IDAT — only insert/replace ancillary
// chunks (sVER, sINK, sSTD, sPNA, sBKC, sLYT, sBKG, sCRP, sBRL), which every
// spec-compliant reader ignores visually.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// Parse a PNG into chunks (skips the 8-byte signature).
function parseChunks(png) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!png.subarray(0, 8).equals(sig)) throw new Error('Not a PNG file')
  const chunks = []
  let i = 8
  while (i + 8 <= png.length) {
    const len = png.readUInt32BE(i)
    const type = png.subarray(i + 4, i + 8).toString('ascii')
    const dataStart = i + 8
    if (dataStart + len + 4 > png.length) throw new Error('Truncated PNG chunk ' + type)
    chunks.push({ type, data: png.subarray(dataStart, dataStart + len) })
    i = dataStart + len + 4
    if (type === 'IEND') break
  }
  return chunks
}

function chunkToBuffer(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crcBuf = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcBuf), 0)
  return Buffer.concat([head, data, crc])
}

// Serialize chunks back into a PNG buffer.
function buildPNG(chunks) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([sig, ...chunks.map(c => chunkToBuffer(c.type, c.data))])
}

// Replace ancillary chunks of the given types (or add them), keeping original
// critical chunks (IHDR/sRGB/gAMA/pHYs/IDAT/IEND) and their order.
function upsertChunks(png, entries) {
  // entries: [{type, data}]
  const chunks = parseChunks(png)
  const replaceTypes = new Set(entries.map(e => e.type))
  const kept = []
  let inserted = false
  for (const c of chunks) {
    if (replaceTypes.has(c.type)) continue // drop originals we're replacing
    kept.push(c)
    // Insert custom chunks right after the last IDAT (original layout) or, if
    // none seen yet, before IEND later. sINK/s* chunks must precede IEND.
    if (c.type === 'IDAT') {
      kept.push(...entries.map(e => ({ type: e.type, data: e.data })))
      inserted = true
    }
  }
  if (!inserted) {
    // PNG without IDAT? shouldn't happen for our notes; put before IEND
    kept.splice(Math.max(0, kept.length - 1), 0, ...entries.map(e => ({ type: e.type, data: e.data })))
  }
  return buildPNG(kept)
}

function lengthPrefixedString(str) {
  const b = Buffer.from(str, 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(b.length, 0)
  return Buffer.concat([len, b])
}

function readLengthPrefixedString(data) {
  if (data.length < 4) return null
  const len = data.readUInt32BE(0)
  if (len === 0 || 4 + len > data.length) return null
  return data.subarray(4, 4 + len).toString('utf8')
}

function pngSize(png) {
  const chunks = parseChunks(png)
  const ihdr = chunks.find(c => c.type === 'IHDR')
  if (!ihdr || ihdr.data.length < 8) throw new Error('PNG missing IHDR')
  return { width: ihdr.data.readUInt32BE(0), height: ihdr.data.readUInt32BE(4) }
}

module.exports = { crc32, parseChunks, buildPNG, chunkToBuffer, upsertChunks, lengthPrefixedString, readLengthPrefixedString, pngSize }
