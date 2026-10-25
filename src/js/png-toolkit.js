// Browser-safe Scrble PNG toolkit.
//
// This is the ONE codec for the private s* ancillary chunks: the renderer,
// main/scrble-format.js (via its Node facade) and tests all use this module.
// It has no Electron, Buffer or fs dependency; callers deal in whole pages:
//
//   const out = writeNotePng(png, meta)
//   const { meta, inkGif, vecJson, rasterBase } = readNotePng(out)
//
// All chunk framing, CRC32, IDAT placement, length-prefixed strings and the
// legacy duplicate/interleaved repair stay inside. `readNotePng` accepts
// options so the main process can read metadata without copying a large sINK,
// decoding a large sVec or copying an imported sRST base on every library row.

import { PLANNERS, SIZES, templatePathFor } from './paper.js'

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

// Same reverse mapping as main/scrble-format.js: official asset paths end in
// the template id; unknown/custom paper degrades to blank.
const PATTERN_TEMPLATES = [
  'blank', 'ruled', 'ruled10', 'ruled15', 'ruled20', 'ruled30', 'ruled40',
  'dotted10', 'dotted20', 'graph', 'isometric', 'math', 'math10', 'math15',
  'math20', 'math30', 'math40', 'music', 'todo',
]
const KNOWN_SIZES = Object.keys(SIZES)

// Chunk types this writer owns. A repeated one is the signature of the old
// buggy writer; keep the list in sync with writeNotePng below.
export const CHUNK_TYPES = ['sVER', 'sINK', 'sLYT', 'sBKG', 'sCRP', 'sSTD', 'sPNA', 'sBKC', 'sBRL', 'sVec', 'sRST']

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function asBytes(value, what) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  throw new TypeError(`${what} must be a Uint8Array or ArrayBuffer`)
}

function readU32(bytes, offset) {
  return (((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0)
}

function u32be(value) {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ])
}

function concatBytes(parts) {
  let total = 0
  for (const part of parts) total += part.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

function parseChunks(png) {
  const bytes = asBytes(png, 'png')
  if (bytes.byteLength < PNG_SIGNATURE.byteLength) throw new Error('Not a PNG file')
  for (let i = 0; i < PNG_SIGNATURE.byteLength; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('Not a PNG file')
  }
  const chunks = []
  let offset = PNG_SIGNATURE.byteLength
  while (offset + 8 <= bytes.byteLength) {
    const length = readU32(bytes, offset)
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    const dataStart = offset + 8
    if (dataStart + length + 4 > bytes.byteLength) throw new Error(`Truncated PNG chunk ${type}`)
    chunks.push({ type, data: bytes.subarray(dataStart, dataStart + length) })
    offset = dataStart + length + 4
    if (type === 'IEND') break
  }
  return chunks
}

function chunkToBytes(type, data) {
  if (type.length !== 4) throw new Error('PNG chunk type must be 4 characters')
  const typeBytes = encoder.encode(type)
  const body = concatBytes([typeBytes, data])
  return concatBytes([u32be(data.byteLength), typeBytes, data, u32be(crc32(body))])
}

function buildPng(chunks) {
  return concatBytes([PNG_SIGNATURE, ...chunks.map(c => chunkToBytes(c.type, c.data))])
}

// Replace ancillary chunks by type in one pass. The metadata goes after the
// LAST IDAT (never between IDATs — Chromium splits the zlib stream across many
// of them, and the IDAT run must stay consecutive) and before IEND.
function upsertChunks(png, entries) {
  const replaceTypes = new Set(entries.map(e => e.type))
  const kept = parseChunks(png).filter(c => !replaceTypes.has(c.type))
  let lastIdat = -1
  for (let i = 0; i < kept.length; i++) if (kept[i].type === 'IDAT') lastIdat = i
  const at = lastIdat >= 0 ? lastIdat + 1 : Math.max(0, kept.length - 1)
  kept.splice(at, 0, ...entries)
  return buildPng(kept)
}

function lengthPrefixedString(value) {
  const bytes = encoder.encode(String(value ?? ''))
  return concatBytes([u32be(bytes.byteLength), bytes])
}

function readLengthPrefixedString(data) {
  if (!data || data.byteLength < 4) return null
  const length = readU32(data, 0)
  if (length === 0 || 4 + length > data.byteLength) return null
  return decoder.decode(data.subarray(4, 4 + length))
}

function templateFromPath(path) {
  if (!path) return 'blank'
  const base = String(path).split(/[\\/]/).pop().replace(/\.png$/i, '')
  if (PATTERN_TEMPLATES.includes(base) || PLANNERS.includes(base)) return base
  return 'blank'
}

export function sizeFromName(name) {
  if (!name) return 'letter'
  const key = String(name).toLowerCase()
  for (const size of KNOWN_SIZES) if (key === size) return size
  for (const size of KNOWN_SIZES) if (key.includes(size)) return size
  return 'letter'
}

// Older builds inserted metadata between Chromium's many IDAT chunks and/or
// wrote the same s* chunk dozens of times. Detect both so a page can be healed
// before it is re-read or re-exported.
export function pngIsBroken(png) {
  const seenCustom = new Set()
  let previousWasIdat = false
  let sawIdat = false
  for (const chunk of parseChunks(png)) {
    if (chunk.type === 'IDAT') {
      if (sawIdat && !previousWasIdat) return true
      sawIdat = true
      previousWasIdat = true
      continue
    }
    previousWasIdat = false
    if (CHUNK_TYPES.includes(chunk.type)) {
      if (seenCustom.has(chunk.type)) return true
      seenCustom.add(chunk.type)
    }
  }
  return false
}

export function repairPng(png) {
  const bytes = asBytes(png, 'png')
  if (!pngIsBroken(bytes)) return bytes
  const parsed = parseChunks(bytes)
  const idat = []
  const pre = []
  const post = []
  const seenCustom = new Set()
  let sawIdat = false
  for (const chunk of parsed) {
    if (chunk.type === 'IHDR' || chunk.type === 'IEND') continue
    if (chunk.type === 'IDAT') {
      idat.push(chunk)
      sawIdat = true
      continue
    }
    if (CHUNK_TYPES.includes(chunk.type)) {
      if (seenCustom.has(chunk.type)) continue
      seenCustom.add(chunk.type)
    }
    if (!sawIdat || chunk.type === 'PLTE' || chunk.type === 'tRNS') pre.push(chunk)
    else post.push(chunk)
  }
  const ihdr = parsed.find(c => c.type === 'IHDR')
  const iend = parsed.find(c => c.type === 'IEND')
  return buildPng([ihdr, ...pre, ...idat, ...post, iend].filter(Boolean))
}

// meta mirrors the main-process writeNotePng contract:
// { sizeName, orientation, template, templatePath?, bgColor, borderLines,
//   fullPage?, inkGif?, vecJson?, rasterBase? }
//
// sRST is WriteCanvas' clean raster base: the imported page image (or the
// previous sRST) WITHOUT this session's vector ink. The IDAT stays a flattened
// page for Scrble compatibility; reloading draws sRST + sVec instead, so ink
// is never baked twice.
export function writeNotePng(png, meta = {}) {
  const entries = [{ type: 'sVER', data: u32be(3) }]
  if (meta.inkGif != null) {
    const ink = asBytes(meta.inkGif, 'inkGif')
    if (ink.byteLength) entries.push({ type: 'sINK', data: ink })
  }
  if (meta.rasterBase != null) {
    const base = asBytes(meta.rasterBase, 'rasterBase')
    if (base.byteLength) entries.push({ type: 'sRST', data: base })
  }

  const hasTemplate = meta.template && meta.template !== 'blank' && meta.template !== 'custom' ? 1 : 0
  entries.push(
    { type: 'sLYT', data: Uint8Array.of(meta.orientation === 'landscape' ? 1 : 0) },
    { type: 'sBKG', data: Uint8Array.of(hasTemplate) },
    { type: 'sCRP', data: Uint8Array.of(meta.fullPage === false ? 0 : 1) },
    { type: 'sSTD', data: lengthPrefixedString(meta.sizeName || 'Letter') },
    { type: 'sPNA', data: lengthPrefixedString(meta.templatePath || templatePathFor(meta.template, meta.orientation)) },
    { type: 'sBKC', data: lengthPrefixedString(meta.bgColor || '#FFFFFFFF') },
    { type: 'sBRL', data: Uint8Array.of(meta.borderLines === false ? 0 : 1) },
  )
  if (meta.vecJson && String(meta.vecJson).length) {
    entries.push({ type: 'sVec', data: encoder.encode(String(meta.vecJson)) })
  }
  return upsertChunks(png, entries)
}

// One parse returns everything a page loader needs. inkGif and rasterBase are
// owned copies, so the caller can retain or mutate them; vecJson is already
// decoded UTF-8. Set ink/vec/raster to false when only metadata is needed
// (library scans) so a large sINK is not copied, a large sVec is not decoded
// and a large sRST base is not copied.
export function readNotePng(png, { ink = true, vec = true, raster = true } = {}) {
  const chunks = parseChunks(png)
  const find = type => chunks.find(c => c.type === type)
  const meta = {}

  const version = find('sVER')
  if (version && version.data.byteLength >= 4) meta.version = readU32(version.data, 0)
  const sizeName = find('sSTD')
  meta.sizeName = sizeName ? readLengthPrefixedString(sizeName.data) : null
  const templatePath = find('sPNA')
  meta.templatePath = templatePath ? readLengthPrefixedString(templatePath.data) : null
  const bgColor = find('sBKC')
  meta.bgColor = bgColor ? readLengthPrefixedString(bgColor.data) : null
  const layout = find('sLYT')
  meta.layoutByte = layout ? layout.data[0] : 0
  const background = find('sBKG')
  meta.hasTemplate = background ? background.data[0] === 1 : null
  const border = find('sBRL')
  meta.borderLines = border ? border.data[0] !== 0 : true

  meta.orientation = meta.layoutByte === 1 ? 'landscape' : 'portrait'
  meta.template = meta.hasTemplate ? templateFromPath(meta.templatePath) : 'blank'
  meta.size = sizeFromName(meta.sizeName)
  const inkChunk = find('sINK')
  const vecChunk = find('sVec')
  const rasterChunk = find('sRST')
  meta.hasInkGif = !!inkChunk
  meta.hasRasterBase = !!rasterChunk && rasterChunk.data.byteLength > 0

  return {
    meta,
    inkGif: ink && inkChunk ? new Uint8Array(inkChunk.data) : null,
    vecJson: vec && vecChunk ? decoder.decode(vecChunk.data) : null,
    rasterBase: raster && rasterChunk && rasterChunk.data.byteLength ? new Uint8Array(rasterChunk.data) : null,
  }
}
