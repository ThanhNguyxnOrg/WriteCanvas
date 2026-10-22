'use strict'
// .wcanvas — a WriteCanvas note packed into one portable ZIP container.
//
// Layout (schemaVersion 1):
//   manifest.json   everything but pixels: {schemaVersion, app, kind, name,
//                   createdAt, modifiedAt, project?, tool?, pages[{file, paper}?]}
//   page-NN.png     the pages exactly as the library stores them on disk, so
//                   each file keeps its Scrble-compatible chunks (sINK replay,
//                   sVec strokes, paper/bg chunks) and imports round-trip.
//
// Pages are exported with STORE (method 0): PNGs are already DEFLATE data, so
// re-deflating gains ~0% and costs CPU on every save. The reader accepts
// DEFLATE (method 8, zlib raw) entries too, for files an external tool re-zips.
// No third-party dependencies; only node:zlib.

const zlib = require('node:zlib')

const SCHEMA_VERSION = 1
const MAX_PAGES = 9999 // mirrors the page-index cap in note:savePage
const MAX_PAGE_BYTES = 200 * 1024 * 1024 // mirrors the page-size cap
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024 // whole container

// ---------- CRC-32 (ZIP; same polynomial PNG chunks use) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  const t = CRC_TABLE
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function safeEntryName(name) {
  const s = String(name)
  if (!s || s.includes('\\') || s.includes('\0')) throw new Error(`bad project entry name: ${JSON.stringify(s)}`)
  if (/^[a-zA-Z]:/.test(s) || s.startsWith('/')) throw new Error(`bad project entry name: ${JSON.stringify(s)}`)
  const parts = s.split('/')
  for (const p of parts) if (!p || p === '.' || p === '..') throw new Error(`bad project entry name: ${JSON.stringify(s)}`)
  return s
}

function dosStamp(date) {
  // ZIP timestamps: 2-second resolution, only 1980+ years representable
  const d = date instanceof Date && !isNaN(date) ? date : new Date()
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | Math.floor(d.getSeconds() / 2)
  const day = (((d.getFullYear() - 1980) & 127) << 9) | ((d.getMonth() + 1) << 5) | (d.getDate() & 31)
  return { time, date: day }
}

// ---------- writer ----------
function localHeader(name, data, stamp, extraLen) {
  const h = Buffer.alloc(30)
  h.writeUInt32LE(0x04034b50, 0) // local file header signature
  h.writeUInt16LE(20, 4) // version needed
  h.writeUInt16LE(0, 6) // flags: sizes known, not streaming
  h.writeUInt16LE(0, 8) // method: stored
  h.writeUInt16LE(stamp.time, 10)
  h.writeUInt16LE(stamp.date, 12)
  h.writeUInt32LE(crc32(data), 14)
  h.writeUInt32LE(data.length, 18)
  h.writeUInt32LE(data.length, 22)
  h.writeUInt16LE(Buffer.byteLength(name, 'utf8'), 26)
  h.writeUInt16LE(extraLen, 28)
  return h
}

function centralHeader(e, stamp) {
  const h = Buffer.alloc(46)
  h.writeUInt32LE(0x02014b50, 0)
  h.writeUInt16LE(20, 4) // made by
  h.writeUInt16LE(20, 6) // needed to extract
  h.writeUInt16LE(0, 8)
  h.writeUInt16LE(0, 10)
  h.writeUInt16LE(stamp.time, 12)
  h.writeUInt16LE(stamp.date, 14)
  h.writeUInt32LE(crc32(e.data), 16)
  h.writeUInt32LE(e.data.length, 20)
  h.writeUInt32LE(e.data.length, 24)
  h.writeUInt16LE(e.nameBuf.length, 28)
  h.writeUInt16LE(0, 30) // extra
  h.writeUInt16LE(0, 32) // comment
  h.writeUInt16LE(0, 34) // disk start
  h.writeUInt16LE(0, 36) // internal attrs
  h.writeUInt32LE(0, 38) // external attrs
  h.writeUInt32LE(e.offset, 42)
  return h
}

// entries: [{ name: string, data: Buffer }] — method 0 (store)
function buildZip(entries, date) {
  const stamp = dosStamp(date)
  const parts = []
  let offset = 0
  const eList = entries.map(e => {
    const name = safeEntryName(e.name)
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data)
    if (data.length > MAX_PAGE_BYTES) throw new Error(`entry too large: ${name}`)
    const head = localHeader(name, data, stamp, 0)
    return { name, data, nameBuf: Buffer.from(name, 'utf8'), head, offset }
  })
  for (const e of eList) {
    e.offset = offset
    const total = e.head.length + e.nameBuf.length + e.data.length
    offset += total
    parts.push(e.head, e.nameBuf, e.data)
  }
  const central = eList.map(e => Buffer.concat([centralHeader(e, stamp), e.nameBuf])) // offsets are final now
  const centralSize = central.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4) // disk
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(eList.length, 8)
  end.writeUInt16LE(eList.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // comment
  return Buffer.concat([...parts, ...central, end])
}

// Build a complete .wcanvas payload from note data.
// pages: [{ file: 'page-01.png' | null, data: Buffer | null, paper?: object }]
function buildNoteZip({ name, createdAt, modifiedAt, project, tool, pages }, date) {
  const list = Array.isArray(pages) ? pages : []
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    app: 'writecanvas',
    kind: 'note',
    name: String(name || 'Untitled'),
    createdAt: createdAt || new Date().toISOString(),
    modifiedAt: modifiedAt || new Date().toISOString(),
    project: project ? String(project) : null,
    tool: tool ? JSON.parse(JSON.stringify(tool)) : null,
    pages: list.map(p => ({ file: p.file || null, paper: p.paper ? JSON.parse(JSON.stringify(p.paper)) : null })),
  }
  const entries = [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 1), 'utf8') }]
  for (const p of list) if (p.file) {
    const data = Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data)
    if (!data.length) throw new Error(`empty page data: ${p.file}`)
    entries.push({ name: p.file, data })
  }
  const zip = buildZip(entries, date)
  return { manifest, zip }
}

// ---------- reader ----------
function u32le(b, o) { return b.readUInt32LE(o) }
function u16le(b, o) { return b.readUInt16LE(o) }

// Returns [{ name, method, data }] in central-directory order.
function readZipAll(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('not a .wcanvas file')
  // locate the End Of Central Directory (comment may follow it)
  let eocd = -1
  const tail = Math.min(buf.length, 22 + 0xffff)
  for (let i = buf.length - 22; i >= buf.length - tail; i--) {
    if (u32le(buf, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a .wcanvas file (missing zip end record)')
  const count = u16le(buf, eocd + 10)
  const cdSize = u32le(buf, eocd + 12)
  if (cdSize > MAX_TOTAL_BYTES) throw new Error('project too large')
  const cdOffset = u32le(buf, eocd + 16)
  const cdEnd = cdOffset + cdSize
  if (Number.isSafeInteger(cdOffset) && cdEnd > eocd) throw new Error('corrupt .wcanvas directory')

  const out = []
  let p = cdOffset
  const seen = new Set()
  for (let n = 0; n < count; n++) {
    if (p + 46 > cdEnd || u32le(buf, p) !== 0x02014b50) throw new Error('corrupt .wcanvas directory')
    const method = u16le(buf, p + 10)
    const compSize = u32le(buf, p + 20)
    const nameLen = u16le(buf, p + 28)
    const extraLen = u16le(buf, p + 30)
    const commentLen = u16le(buf, p + 32)
    const lfhOffset = u32le(buf, p + 42)
    if (nameLen > 1024) throw new Error('entry name too long')
    const name = safeEntryName(buf.subarray(p + 46, p + 46 + nameLen).toString('utf8'))
    if (seen.has(name)) throw new Error(`duplicate entry in project: ${name}`)
    seen.add(name)
    if (u32le(buf, lfhOffset) !== 0x04034b50) throw new Error(`corrupt entry: ${name}`)
    const lNameLen = u16le(buf, lfhOffset + 26)
    const lExtraLen = u16le(buf, lfhOffset + 28)
    const dataStart = lfhOffset + 30 + lNameLen + lExtraLen
    if (compSize > MAX_PAGE_BYTES || dataStart + compSize > buf.length) {
      throw new Error(`entry truncated in project: ${name}`)
    }
    out.push({ name, method, dataStart, compSize })
    p += 46 + nameLen + extraLen + commentLen
  }
  if (p !== cdEnd) throw new Error('corrupt .wcanvas directory')

  return out.map(e => {
    const comp = buf.subarray(e.dataStart, e.dataStart + e.compSize)
    let data
    if (e.method === 0) data = comp
    else if (e.method === 8) data = zlib.inflateRawSync(comp, { maxOutputLength: MAX_PAGE_BYTES })
    else throw new Error(`unsupported compression in project entry: ${e.name} (method ${e.method})`)
    return { name: e.name, method: e.method, data: Buffer.from(data) }
  })
}

function validManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return 'manifest.json is not an object'
  if (Number(m.schemaVersion) !== SCHEMA_VERSION && Number(m.schemaVersion) !== 0) {
    if (Number(m.schemaVersion) > SCHEMA_VERSION) return `project was written by a newer WriteCanvas (schema ${m.schemaVersion})`
    return 'manifest.json has an invalid schemaVersion'
  }
  if (m.app !== 'writecanvas') return 'not a WriteCanvas project (unknown app stamp)'
  if (m.kind !== 'note') return `unsupported project kind: ${String(m.kind)}`
  if (typeof m.name !== 'string' || !m.name.trim()) return 'manifest.json has no note name'
  if (!Array.isArray(m.pages) || !m.pages.length) return 'manifest.json has no pages'
  if (m.pages.length > MAX_PAGES) return 'too many pages'
  for (const [i, p] of m.pages.entries()) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return `page ${i} is not an object`
    if (p.file != null && (typeof p.file !== 'string' || p.file.length > 128)) return `page ${i} has an invalid file name`
  }
  if ('tool' in m && m.tool && typeof m.tool !== 'object') return 'manifest tool entry is invalid'
  return null
}

// Read a .wcanvas buffer into manifest + page buffers in manifest order.
// Missing page images are an error: a silent blank import would lose strokes.
function readNoteZip(buf) {
  const entries = readZipAll(buf)
  const total = entries.reduce((n, e) => n + e.data.length, 0)
  if (total > MAX_TOTAL_BYTES) throw new Error('project too large')
  const manifestEntry = entries.find(e => e.name === 'manifest.json')
  if (!manifestEntry) throw new Error('not a WriteCanvas project: manifest.json missing')
  let manifest
  try {
    manifest = JSON.parse(manifestEntry.data.toString('utf8'))
  } catch {
    throw new Error('manifest.json is not valid JSON')
  }
  const bad = validManifest(manifest)
  if (bad) throw new Error(bad)
  for (const p of manifest.pages) {
    if (p.file != null) {
      try { safeEntryName(p.file) } catch { throw new Error(`unusable page name in manifest: ${JSON.stringify(p.file)}`) }
    }
  }
  const byName = new Map(entries.map(e => [e.name, e.data]))
  for (const [i, p] of manifest.pages.entries()) {
    if (!p.file) continue
    const data = byName.get(p.file)
    if (!data) throw new Error(`manifest page ${i + 1} (${p.file}) is missing from the project file`)
  }
  return { manifest, files: entries.filter(e => byName.has(e.name)) }
}

module.exports = { SCHEMA_VERSION, buildNoteZip, readNoteZip, readZipAll, safeEntryName }
