'use strict'
// Scrble Ink note format support (see docs/ANALYSIS.md and
// docs/research/scrble-ink-chunk-2026-10-20.md for the byte-level evidence).
//
// The codec itself lives in src/js/png-toolkit.js so the renderer, tests and
// future hosts share ONE implementation. This file is the Node facade:
// Buffer in/out plus the legacy repair helpers the main process needs.
//
// A note is a PNG with private ancillary chunks, written after the last IDAT:
//   sVER  : uint32 BE format version (3)
//   sINK  : ink compatibility envelope (GIF; see the research note)
//   sLYT  : 1 byte layout/orientation (0 portrait, 1 landscape)
//   sBKG  : 1 byte has-template flag
//   sCRP  : 1 byte flag (mirrored as-is)
//   sSTD  : 4-byte-BE-length-prefixed string, paper size ("Letter")
//   sPNA  : length-prefixed string, paper template path
//   sBKC  : length-prefixed string, background color "#AARRGGBB"
//   sBRL  : 1 byte flag (mirrored as-is)
//   sVec  : WriteCanvas extension — editable vector strokes + text (UTF-8 JSON)

const toolkit = require('../src/js/png-toolkit.js')
const { templatePathFor } = require('../src/js/paper.js')

const { CHUNK_TYPES, sizeFromName } = toolkit
const TEMPLATE_PATH = templatePathFor

function writeNotePng(png, meta) {
  return Buffer.from(toolkit.writeNotePng(png, meta))
}

// Metadata scans must not copy sINK or decode sVec; library rows only need the
// paper fields.
function readNoteMeta(png) {
  return toolkit.readNotePng(png, { ink: false, vec: false }).meta
}

function extractInkGif(png) {
  const gif = toolkit.readNotePng(png, { vec: false }).inkGif
  return gif ? Buffer.from(gif) : null
}

function extractVecJson(png) {
  return toolkit.readNotePng(png, { ink: false }).vecJson
}

function pngIsBroken(png) {
  return toolkit.pngIsBroken(png)
}

function repairPNG(png) {
  const fixed = toolkit.repairPng(png)
  return fixed === png ? png : Buffer.from(fixed)
}

module.exports = {
  writeNotePng,
  readNoteMeta,
  extractInkGif,
  extractVecJson,
  repairPNG,
  pngIsBroken,
  TEMPLATE_PATH,
  sizeFromName,
  CHUNK_TYPES,
}
