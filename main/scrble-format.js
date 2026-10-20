'use strict'
// Scrble Ink note format support (see docs/ANALYSIS.md for the evidence).
//
// A note is a PNG with ancillary chunks (order in sau files: sVER, sINK, sLYT,
// sBKG, sCRP, sSTD, sPNA, sBKC, sBRL — written after the last IDAT, before IEND):
//   sVER  : uint32 BE format version (3)
//   sINK  : full GIF89a replay animation of the drawing
//   sLYT  : 1 byte layout/orientation (0 portrait, 1 landscape)
//   sBKG  : 1 byte has-template flag
//   sCRP  : 1 byte flag (mirrored as-is)
//   sSTD  : 4-byte-BE-length-prefixed string, paper size ("Letter")
//   sPNA  : length-prefixed string, paper template path
//   sBKC  : length-prefixed string, background color "#AARRGGBB" (ARGB hex)
//   sBRL  : 1 byte flag (mirrored as-is)

const { upsertChunks, parseChunks, buildPNG, lengthPrefixedString, readLengthPrefixedString } = require('./png-chunks')

const CHUNK_TYPES = ['sVER', 'sINK', 'sLYT', 'sBKG', 'sCRP', 'sSTD', 'sPNA', 'sBKC', 'sBRL', 'sVec']

// Map template ids to original asset paths so notes round-trip into Scrble
// Ink with the correct paper. Pattern papers live under Square/ regardless of
// page orientation; planner papers have Portrait/ and Landscape/ variants.
const PATTERN_TEMPLATES = [
  'blank', 'ruled', 'ruled10', 'ruled15', 'ruled20', 'ruled30', 'ruled40',
  'dotted10', 'dotted20', 'graph', 'isometric', 'math', 'math10', 'math15',
  'math20', 'math30', 'math40', 'music', 'todo',
]
const PLANNERS = [
  '5days', '7days', 'daily', 'dailyPlanner', 'fitness', 'habitTracker',
  'homework', 'menuPlanner', 'monthly', 'phone', 'phoneAndNote',
  'projectPlanner', 'tablet', 'tabletAndNote', 'yearly', 'yearlyPlanner',
]
const TEMPLATE_PATH = (template, orientation) => {
  if (!template || template === 'blank' || template === 'custom') return ''
  if (PLANNERS.includes(template)) {
    const L = orientation === 'landscape' ? 'Landscape' : 'Portrait'
    return `/Assets/Paper/${L}/HighRes/${template}.png`
  }
  return `/Assets/Paper/Square/HighRes/${template}.png`
}

// Reverse mapping for importing original notes: official paths end with the
// template id; unknown/custom papers degrade to blank.
function templateFromPath(p) {
  if (!p) return 'blank'
  const base = String(p).split(/[\\/]/).pop().replace(/\.png$/i, '')
  if (PATTERN_TEMPLATES.includes(base) || PLANNERS.includes(base)) return base
  return 'blank'
}

const KNOWN_SIZES = ['letter', 'legal', 'tabloid', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']

function sizeFromName(name) {
  if (!name) return 'letter'
  const k = String(name).toLowerCase()
  for (const s of KNOWN_SIZES) if (k === s) return s
  for (const s of KNOWN_SIZES) if (k.includes(s)) return s
  return 'letter'
}

function buildMetaChunks(meta) {
  const entries = []
  const ver = Buffer.alloc(4)
  ver.writeUInt32BE(3, 0)
  const L = Buffer.alloc(1); L[0] = meta.orientation === 'landscape' ? 1 : 0
  const hasTpl = Buffer.alloc(1); hasTpl[0] = meta.template && meta.template !== 'blank' && meta.template !== 'custom' ? 1 : 0
  const crp = Buffer.alloc(1); crp[0] = meta.fullPage === false ? 0 : 1
  const brl = Buffer.alloc(1); brl[0] = meta.borderLines === false ? 0 : 1
  entries.push({ type: 'sVER', data: ver })
  if (meta.inkGif && meta.inkGif.length) entries.push({ type: 'sINK', data: meta.inkGif })
  entries.push({ type: 'sLYT', data: L })
  entries.push({ type: 'sBKG', data: hasTpl })
  entries.push({ type: 'sCRP', data: crp })
  entries.push({ type: 'sSTD', data: lengthPrefixedString(meta.sizeName || 'Letter') })
  entries.push({ type: 'sPNA', data: lengthPrefixedString(meta.templatePath || TEMPLATE_PATH(meta.template, meta.orientation)) })
  entries.push({ type: 'sBKC', data: lengthPrefixedString(meta.bgColor || '#FFFFFFFF') })
  entries.push({ type: 'sBRL', data: brl })
  // WriteCanvas extension (ignored by Scrble Ink and other readers — the
  // lowercase second letter marks it private): vector strokes + text objects
  // so a saved page reopens as editable ink, not just a flattened raster.
  if (meta.vecJson && meta.vecJson.length) entries.push({ type: 'sVec', data: Buffer.from(meta.vecJson, 'utf8') })
  return entries
}

// png: Buffer of the flattened page PNG from the renderer.
// meta: {sizeName, orientation, template, templatePath, bgColor, inkGif?}
function writeNotePng(png, meta) {
  return upsertChunks(png, buildMetaChunks(meta))
}

// Read paper metadata from an existing note PNG (original or ours).
// Does NOT parse sINK (large); returns its index+length instead.
function readNoteMeta(png) {
  const chunks = parseChunks(png)
  const find = t => chunks.find(c => c.type === t)
  const meta = {}
  const sv = find('sVER')
  if (sv && sv.data.length >= 4) meta.version = sv.data.readUInt32BE(0)
  const std = find('sSTD'); meta.sizeName = std ? readLengthPrefixedString(std.data) : null
  const pna = find('sPNA'); meta.templatePath = pna ? readLengthPrefixedString(pna.data) : null
  const bkc = find('sBKC'); meta.bgColor = bkc ? readLengthPrefixedString(bkc.data) : null
  const lyt = find('sLYT'); meta.layoutByte = lyt ? lyt.data[0] : 0
  const bkg = find('sBKG'); meta.hasTemplate = bkg ? bkg.data[0] === 1 : null
  const brl = find('sBRL'); meta.borderLines = brl ? brl.data[0] !== 0 : true
  meta.orientation = meta.layoutByte === 1 ? 'landscape' : 'portrait'
  meta.template = meta.hasTemplate ? templateFromPath(meta.templatePath) : 'blank'
  meta.size = sizeFromName(meta.sizeName)
  const ink = find('sINK')
  meta.hasInkGif = !!ink
  return meta
}

function extractInkGif(png) {
  const c = parseChunks(png).find(x => x.type === 'sINK')
  return c ? Buffer.from(c.data) : null
}

// Vector extension chunk ({v:1, strokes:[…], texts:[…]}), or null.
function extractVecJson(png) {
  const c = parseChunks(png).find(x => x.type === 'sVec')
  return c ? c.data.toString('utf8') : null
}

// Older (buggy) builds inserted meta chunks between Chromium's hundreds of
// 4KB IDAT chunks, breaking the required IDAT run and bloating the file with
// hundreds of sINK copies. Two signatures: a non-IDAT chunk sitting between
// two IDAT chunks, or the same ancillary chunk type appearing more than once.
function pngIsBroken(png) {
  const seenCustom = new Set()
  let prevWasIdat = false, sawAnyIdat = false
  for (const c of parseChunks(png)) {
    if (c.type === 'IDAT') {
      if (sawAnyIdat && !prevWasIdat) return true // IDAT run interrupted
      sawAnyIdat = true; prevWasIdat = true
      continue
    }
    prevWasIdat = false
    // only our own chunk types indicate the old duplication bug; standard
    // chunks such as tEXt may legitimately appear more than once
    if (CHUNK_TYPES.includes(c.type)) {
      if (seenCustom.has(c.type)) return true
      seenCustom.add(c.type)
    }
  }
  return false
}

function repairPNG(png) {
  const chunks = parseChunks(png)
  if (!pngIsBroken(png)) return png
  // IDAT: keep EVERY chunk in order (multi-IDAT chunks concatenate into one
  // zlib stream — collapsing them by type would destroy the image data).
  // Preserve every standard chunk byte-for-byte; drop only duplicated copies
  // of our own ancillary chunks. PLTE/tRNS must sit before IDAT.
  const idat = [], pre = [], post = []
  const seenCustom = new Set()
  let sawIdat = false
  for (const c of chunks) {
    if (c.type === 'IHDR' || c.type === 'IEND') continue
    if (c.type === 'IDAT') { idat.push(c); sawIdat = true; continue }
    if (CHUNK_TYPES.includes(c.type)) {
      if (seenCustom.has(c.type)) continue
      seenCustom.add(c.type)
    }
    if (!sawIdat || c.type === 'PLTE' || c.type === 'tRNS') pre.push(c)
    else post.push(c)
  }
  const ihdr = chunks.find(c => c.type === 'IHDR')
  const iend = chunks.find(c => c.type === 'IEND')
  return buildPNG([ihdr, ...pre, ...idat, ...post, iend].filter(Boolean))
}

module.exports = { writeNotePng, readNoteMeta, extractInkGif, extractVecJson, repairPNG, pngIsBroken, TEMPLATE_PATH, sizeFromName, CHUNK_TYPES }
