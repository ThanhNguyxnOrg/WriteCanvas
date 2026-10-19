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

const { upsertChunks, parseChunks, lengthPrefixedString, readLengthPrefixedString } = require('./png-chunks')

const CHUNK_TYPES = ['sVER', 'sINK', 'sLYT', 'sBKG', 'sCRP', 'sSTD', 'sPNA', 'sBKC', 'sBRL']

// Map our template ids to sau-style template paths so notes round-trip into
// the original app with the correct paper rendering.
const TEMPLATE_PATH = (template, orientation) => {
  const L = orientation === 'landscape' ? 'Landscape' : 'Portrait'
  switch (template) {
    case 'ruled': return `/Assets/Paper/${L}/HighRes/ruled.png`
    case 'grid': return `/Assets/Paper/${L}/HighRes/grid.png`
    case 'graph': return `/Assets/Paper/${L}/HighRes/mathpaper.png`
    case 'dotted': return `/Assets/Paper/${L}/HighRes/dotted.png`
    case 'black': return `/Assets/Paper/${L}/HighRes/black.png`
    default: return ''
  }
}

// Reverse mapping for importing original notes.
function templateFromPath(p) {
  if (!p) return 'blank'
  const s = p.toLowerCase()
  if (s.includes('grid')) return 'grid'
  if (s.includes('dotted')) return 'dotted'
  if (s.includes('math')) return 'graph'
  if (s.includes('black')) return 'black'
  if (s.includes('ruled') || s.includes('paper')) return 'ruled'
  return 'blank'
}

const KNOWN_SIZES = new Set(['letter', 'a4', 'a5', 'square'])

function sizeFromName(name) {
  if (!name) return 'letter'
  const k = String(name).toLowerCase()
  for (const s of KNOWN_SIZES) if (k.includes(s)) return s
  return 'letter'
}

function buildMetaChunks(meta) {
  const entries = []
  const ver = Buffer.alloc(4)
  ver.writeUInt32BE(3, 0)
  const L = Buffer.alloc(1); L[0] = meta.orientation === 'landscape' ? 1 : 0
  const hasTpl = Buffer.alloc(1); hasTpl[0] = meta.template && meta.template !== 'blank' ? 1 : 0
  const crp = Buffer.alloc(1); crp[0] = 1
  const brl = Buffer.alloc(1); brl[0] = 1
  entries.push({ type: 'sVER', data: ver })
  if (meta.inkGif && meta.inkGif.length) entries.push({ type: 'sINK', data: meta.inkGif })
  entries.push({ type: 'sLYT', data: L })
  entries.push({ type: 'sBKG', data: hasTpl })
  entries.push({ type: 'sCRP', data: crp })
  entries.push({ type: 'sSTD', data: lengthPrefixedString(meta.sizeName || 'Letter') })
  entries.push({ type: 'sPNA', data: lengthPrefixedString(meta.templatePath || TEMPLATE_PATH(meta.template, meta.orientation)) })
  entries.push({ type: 'sBKC', data: lengthPrefixedString(meta.bgColor || '#FFFFFFFF') })
  entries.push({ type: 'sBRL', data: brl })
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

module.exports = { writeNotePng, readNoteMeta, extractInkGif, TEMPLATE_PATH, sizeFromName, CHUNK_TYPES }
