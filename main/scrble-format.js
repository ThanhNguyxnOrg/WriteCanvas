'use strict'
// Scrble Ink note format support. The byte-level contract — every chunk name,
// its payload and the compatibility rules — is documented in docs/FORMAT.md.
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
//   sRST  : WriteCanvas extension — clean raster base (PNG) that sVec ink is
//           composited over; keeps imported page images lossless while still
//           writing a flattened IDAT for Scrble compatibility

const toolkit = require('../src/js/png-toolkit.js')
const { templatePathFor } = require('../src/js/paper.js')

const { CHUNK_TYPES, sizeFromName } = toolkit
const TEMPLATE_PATH = templatePathFor

// sVec v2 means the page was written with a clean sRST base whenever it carries
// raster content. Older (v1) pages flattened any imported image into IDAT and
// may have no sRST, so their whole PNG is the only copy of that image.
function vecHasContent(vecJson) {
  if (!vecJson) return false
  try {
    const v = JSON.parse(vecJson)
    return !!((Array.isArray(v && v.strokes) && v.strokes.length) ||
      (Array.isArray(v && v.texts) && v.texts.length))
  } catch {
    return true
  }
}

function legacyRasterBase(vecJson) {
  if (!vecJson) return true
  try {
    const v = JSON.parse(vecJson)
    if (Number(v && v.v) >= 2) return false
    return !vecHasContent(vecJson)
  } catch {
    return true
  }
}

function writeNotePng(png, meta) {
  return Buffer.from(toolkit.writeNotePng(png, meta))
}

// Metadata scans must not copy sINK/sRST or decode sVec; library rows only
// need the paper fields.
function readNoteMeta(png) {
  return toolkit.readNotePng(png, { ink: false, vec: false, raster: false }).meta
}

// One parse for a page load: paper fields, replay GIF, vector ink and the
// clean raster base.
function readNotePage(png) {
  const { meta, inkGif, vecJson, rasterBase } = toolkit.readNotePng(png)
  return {
    meta,
    inkGif: inkGif ? Buffer.from(inkGif) : null,
    vecJson,
    rasterBase: rasterBase ? Buffer.from(rasterBase) : null,
  }
}

function extractInkGif(png) {
  const gif = toolkit.readNotePng(png, { vec: false, raster: false }).inkGif
  return gif ? Buffer.from(gif) : null
}

function extractVecJson(png) {
  return toolkit.readNotePng(png, { ink: false, raster: false }).vecJson
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
  readNotePage,
  extractInkGif,
  extractVecJson,
  repairPNG,
  pngIsBroken,
  legacyRasterBase,
  TEMPLATE_PATH,
  sizeFromName,
  CHUNK_TYPES,
}
