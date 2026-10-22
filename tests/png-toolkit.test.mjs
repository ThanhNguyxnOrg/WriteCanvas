import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pngIsBroken, readNotePng, repairPng, writeNotePng } from '../src/js/png-toolkit.js'
import { PLANNERS, TEMPLATES, templatePathFor } from '../src/js/paper.js'

const require_ = createRequire(import.meta.url)
const chunks = require_('../main/png-chunks.js')
const scrble = require_('../main/scrble-format.js')

// Valid 1x1 RGBA PNG; the toolkit never touches IDAT.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x3b])
const VEC = JSON.stringify({ v: 1, strokes: [{ pts: [{ x: 1, y: 2, p: 0.5 }] }], texts: [] })
const SCRBLE_CHUNKS = ['sVER', 'sINK', 'sLYT', 'sBKG', 'sCRP', 'sSTD', 'sPNA', 'sBKC', 'sBRL', 'sVec']

const meta = {
  sizeName: 'A4',
  orientation: 'landscape',
  template: 'daily',
  bgColor: '#FF102030',
  borderLines: false,
  fullPage: false,
  inkGif: GIF,
  vecJson: VEC,
}

function parse(buffer) {
  return chunks.parseChunks(Buffer.from(buffer))
}

function assertChunkCrcs(buffer) {
  const bytes = Buffer.from(buffer)
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    const dataStart = offset + 8
    const stored = bytes.readUInt32BE(dataStart + length)
    const expected = chunks.crc32(bytes.subarray(offset + 4, dataStart + length))
    assert.equal(stored, expected, `CRC mismatch in ${type}`)
    offset = dataStart + length + 4
    if (type === 'IEND') break
  }
}

function splitIdat(png) {
  const parsed = parse(png)
  const index = parsed.findIndex(c => c.type === 'IDAT')
  const data = parsed[index].data
  const half = Math.max(1, Math.floor(data.length / 2))
  return chunks.buildPNG([
    ...parsed.slice(0, index),
    { type: 'IDAT', data: data.subarray(0, half) },
    { type: 'IDAT', data: data.subarray(half) },
    ...parsed.slice(index + 1),
  ])
}

describe('png-toolkit Scrble chunk round-trip', () => {
  it('writes and reads every metadata field', () => {
    const { meta: read, inkGif, vecJson } = readNotePng(writeNotePng(PNG, meta))
    assert.equal(read.version, 3)
    assert.equal(read.sizeName, 'A4')
    assert.equal(read.size, 'a4')
    assert.equal(read.orientation, 'landscape')
    assert.equal(read.templatePath, '/Assets/Paper/Landscape/HighRes/daily.png')
    assert.equal(read.template, 'daily')
    assert.equal(read.hasTemplate, true)
    assert.equal(read.bgColor, '#FF102030')
    assert.equal(read.borderLines, false)
    assert.equal(read.hasInkGif, true)
    assert.deepEqual([...inkGif], [...GIF])
    assert.equal(vecJson, VEC)

    // flag payloads, not just their decoded metadata
    const raw = parse(writeNotePng(PNG, meta))
    assert.deepEqual([...raw.find(c => c.type === 'sLYT').data], [1])
    assert.deepEqual([...raw.find(c => c.type === 'sBKG').data], [1])
    assert.deepEqual([...raw.find(c => c.type === 'sCRP').data], [0])
    assert.deepEqual([...raw.find(c => c.type === 'sBRL').data], [0])
  })

  it('keeps metadata after the last IDAT, before IEND, exactly once', () => {
    const types = parse(writeNotePng(PNG, meta)).map(c => c.type)
    const lastIdat = types.lastIndexOf('IDAT')
    const iend = types.indexOf('IEND')
    for (const type of SCRBLE_CHUNKS) {
      const indexes = types.map((t, i) => (t === type ? i : -1)).filter(i => i >= 0)
      assert.equal(indexes.length, 1, `${type} appears once`)
      assert.ok(indexes[0] > lastIdat, `${type} after the last IDAT`)
      assert.ok(indexes[0] < iend, `${type} before IEND`)
    }
    const idats = types.map((t, i) => (t === 'IDAT' ? i : -1)).filter(i => i >= 0)
    for (let i = 1; i < idats.length; i++) assert.equal(idats[i], idats[i - 1] + 1, 'IDAT run is consecutive')
  })

  it('writes valid CRCs for every chunk', () => {
    assertChunkCrcs(writeNotePng(PNG, meta))
  })

  it('stays byte-identical when the same page is written twice', () => {
    const once = writeNotePng(splitIdat(PNG), meta)
    const twice = writeNotePng(once, meta)
    assert.deepEqual(Buffer.from(twice), Buffer.from(once))
    const types = parse(once).map(c => c.type)
    assert.equal(types.filter(t => t === 'IDAT').length, 2)
    for (const type of SCRBLE_CHUNKS) assert.equal(types.filter(t => t === type).length, 1)
  })

  it('defaults to Letter / blank when optional metadata is absent', () => {
    const { meta: read, inkGif, vecJson } = readNotePng(writeNotePng(PNG, {}))
    assert.equal(read.version, 3)
    assert.equal(read.sizeName, 'Letter')
    assert.equal(read.size, 'letter')
    assert.equal(read.orientation, 'portrait')
    assert.equal(read.template, 'blank')
    assert.equal(read.hasTemplate, false)
    assert.equal(read.bgColor, '#FFFFFFFF')
    assert.equal(read.borderLines, true)
    assert.equal(read.hasInkGif, false)
    assert.equal(inkGif, null)
    assert.equal(vecJson, null)
  })

  it('preserves existing sINK/sVec when a later write omits them', () => {
    const first = writeNotePng(PNG, meta)
    const second = writeNotePng(first, {
      sizeName: meta.sizeName,
      orientation: meta.orientation,
      template: meta.template,
    })
    const read = readNotePng(second)
    assert.deepEqual([...read.inkGif], [...GIF])
    assert.equal(read.vecJson, VEC)
  })

  it('treats an unknown template path as blank while preserving the path', () => {
    const bytes = writeNotePng(PNG, {
      template: 'ruled',
      templatePath: '/Assets/Paper/Custom/HighRes/unknown.png',
      sizeName: 'Letter',
    })
    const { meta: read } = readNotePng(bytes)
    assert.equal(read.hasTemplate, true)
    assert.equal(read.template, 'blank')
    assert.equal(read.templatePath, '/Assets/Paper/Custom/HighRes/unknown.png')
  })
})

describe('png-toolkit legacy repair', () => {
  it('flags metadata interleaved between IDATs and restores one consecutive run', () => {
    const split = parse(splitIdat(PNG))
    const firstIdat = split.findIndex(c => c.type === 'IDAT')
    const broken = chunks.buildPNG([
      ...split.slice(0, firstIdat + 1),
      { type: 'sVER', data: Buffer.from([0, 0, 0, 3]) },
      ...split.slice(firstIdat + 1),
    ])
    assert.equal(pngIsBroken(broken), true)
    const fixed = repairPng(broken)
    assert.equal(pngIsBroken(fixed), false)
    const mainFixed = scrble.repairPNG(Buffer.from(broken))
    assert.ok(Buffer.isBuffer(mainFixed))
    assert.equal(pngIsBroken(mainFixed), false)

    const types = parse(fixed).map(c => c.type)
    const idats = types.map((t, i) => (t === 'IDAT' ? i : -1)).filter(i => i >= 0)
    for (let i = 1; i < idats.length; i++) assert.equal(idats[i], idats[i - 1] + 1)
    assert.equal(types.filter(t => t === 'sVER').length, 1)
    const before = Buffer.concat(split.filter(c => c.type === 'IDAT').map(c => c.data))
    const after = Buffer.concat(parse(fixed).filter(c => c.type === 'IDAT').map(c => c.data))
    assert.deepEqual(after, before)
  })

  it('deduplicates repeated s* chunks and preserves the page bytes', () => {
    const split = parse(splitIdat(PNG))
    const firstIdat = split.findIndex(c => c.type === 'IDAT')
    const broken = chunks.buildPNG([
      ...split.slice(0, firstIdat + 1),
      { type: 'sVER', data: Buffer.from([0, 0, 0, 3]) },
      { type: 'sVER', data: Buffer.from([0, 0, 0, 3]) },
      { type: 'sLYT', data: Buffer.from([0]) },
      ...split.slice(firstIdat + 1),
    ])
    assert.equal(pngIsBroken(broken), true)
    const fixed = repairPng(broken)
    const types = parse(fixed).map(c => c.type)
    assert.equal(types.filter(t => t === 'sVER').length, 1)
    assert.equal(types.filter(t => t === 'sLYT').length, 1)
    assert.equal(types.filter(t => t === 'IDAT').length, 2)
  })

  it('leaves a healthy page untouched and main delegates to the same codec', () => {
    assert.equal(pngIsBroken(PNG), false)
    assert.equal(repairPng(PNG), PNG) // same Buffer instance, no needless copy
    assert.equal(scrble.pngIsBroken(PNG), false)
    assert.equal(scrble.repairPNG(PNG), PNG)
  })
})

describe('png-toolkit read options', () => {
  it('can skip the large sINK/sVec payloads while still reporting their presence', () => {
    const light = readNotePng(writeNotePng(PNG, meta), { ink: false, vec: false })
    assert.equal(light.meta.hasInkGif, true)
    assert.equal(light.inkGif, null)
    assert.equal(light.vecJson, null)
  })
})

describe('png-toolkit main-process interop', () => {
  it('toolkit output is readable by main/scrble-format', () => {
    const bytes = Buffer.from(writeNotePng(PNG, meta))
    const read = scrble.readNoteMeta(bytes)
    assert.equal(read.version, 3)
    assert.equal(read.size, 'a4')
    assert.equal(read.orientation, 'landscape')
    assert.equal(read.template, 'daily')
    assert.equal(read.templatePath, '/Assets/Paper/Landscape/HighRes/daily.png')
    assert.equal(read.bgColor, '#FF102030')
    assert.equal(read.borderLines, false)
    assert.equal(read.hasInkGif, true)
    assert.equal(scrble.extractVecJson(bytes), VEC)
    assert.deepEqual(scrble.extractInkGif(bytes), Buffer.from(GIF))
  })

  it('main/scrble-format output is readable by the toolkit', () => {
    const bytes = scrble.writeNotePng(PNG, {
      sizeName: 'Letter',
      orientation: 'portrait',
      template: 'ruled',
      bgColor: '#FFFFFFFF',
      borderLines: true,
      vecJson: '{"v":2}',
      inkGif: Buffer.from(GIF),
    })
    const { meta: read, inkGif, vecJson } = readNotePng(bytes)
    assert.equal(read.version, 3)
    assert.equal(read.size, 'letter')
    assert.equal(read.orientation, 'portrait')
    assert.equal(read.template, 'ruled')
    assert.equal(read.templatePath, '/Assets/Paper/Square/HighRes/ruled.png')
    assert.deepEqual([...inkGif], [...GIF])
    assert.equal(vecJson, '{"v":2}')
  })

  it('agrees with main on every template path and orientation', () => {
    for (const template of [...Object.keys(TEMPLATES), ...PLANNERS]) {
      for (const orientation of ['portrait', 'landscape']) {
        assert.equal(
          templatePathFor(template, orientation),
          scrble.TEMPLATE_PATH(template, orientation),
          `${template}/${orientation}`,
        )
      }
    }
  })

  it('round-trips every planner template in both orientations', () => {
    for (const template of PLANNERS) {
      for (const orientation of ['portrait', 'landscape']) {
        const read = readNotePng(writeNotePng(PNG, {
          template,
          orientation,
          sizeName: 'Letter',
        })).meta
        assert.equal(read.template, template, `${template}/${orientation}`)
        assert.equal(read.templatePath, templatePathFor(template, orientation), `${template}/${orientation}`)
      }
    }
  })

  it('writes the same sPNA path as main for pattern, planner and blank papers', () => {
    for (const [template, orientation] of [
      ['ruled', 'portrait'],
      ['daily', 'landscape'],
      ['blank', 'portrait'],
      ['custom', 'landscape'],
    ]) {
      const bytes = writeNotePng(PNG, { template, orientation, sizeName: 'Letter' })
      const read = scrble.readNoteMeta(Buffer.from(bytes))
      // an empty length-prefixed string reads back as null in main, not ''
      assert.equal(read.templatePath || '', scrble.TEMPLATE_PATH(template, orientation), `${template}/${orientation}`)
      assert.equal(read.template, template === 'blank' || template === 'custom' ? 'blank' : template)
    }
  })
})

describe('png-toolkit malformed input', () => {
  it('rejects empty and non-PNG input', () => {
    assert.throws(() => readNotePng(new Uint8Array(0)), /Not a PNG file/)
    assert.throws(() => readNotePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /Not a PNG file/)
  })

  it('rejects a truncated chunk instead of silently truncating the page', () => {
    assert.throws(() => readNotePng(PNG.subarray(0, 20)), /Truncated PNG chunk IHDR/)
    assert.throws(() => writeNotePng(PNG.subarray(0, 20), {}), /Truncated PNG chunk IHDR/)
  })

  it('accepts an ArrayBuffer as well as a typed array', () => {
    const bytes = writeNotePng(PNG, meta)
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    assert.equal(readNotePng(buffer).meta.size, 'a4')
  })

  it('rejects an untyped inkGif instead of silently skipping it', () => {
    assert.throws(
      () => writeNotePng(PNG, { inkGif: [0x47, 0x49] }),
      /inkGif must be a Uint8Array or ArrayBuffer/,
    )
    const bytes = writeNotePng(PNG, { inkGif: Uint8Array.of(0x47, 0x49).buffer })
    assert.equal(readNotePng(bytes).meta.hasInkGif, true)
  })
})
