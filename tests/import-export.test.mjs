import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { buildNoteZip, readNoteZip, readNoteFile, readZipAll, MAX_TOTAL_BYTES, MAX_PAGE_BYTES } from '../main/wcanvas-export.js'
import { importPngNotes } from '../main/png-import.js'
import { renderPdf } from '../main/pdf-export.js'
import { Library } from '../main/library.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function zip(entries) {
  const parts = [], directory = []
  let offset = 0
  for (const { name, data, method = 8, compressed } of entries) {
    const bytes = compressed || (method === 8 ? zlib.deflateRawSync(data) : data)
    const nameBytes = Buffer.from(name)
    const head = Buffer.alloc(30), central = Buffer.alloc(46)
    head.writeUInt32LE(0x04034b50)
    head.writeUInt16LE(method, 8)
    head.writeUInt32LE(bytes.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(nameBytes.length, 26)
    central.writeUInt32LE(0x02014b50)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(bytes.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    parts.push(head, nameBytes, bytes)
    directory.push(central, nameBytes)
    offset += head.length + nameBytes.length + bytes.length
  }
  const cd = Buffer.concat(directory), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

test('valid project round-trip preserves manifest, pages, and blank pages', () => {
  const { zip: bytes, manifest } = buildNoteZip({ name: 'Note', pages: [
    { file: 'page-01.png', data: png, paper: { size: 'a4' } }, { file: null },
  ] })
  const result = readNoteZip(bytes)
  assert.deepEqual(result.manifest, manifest)
  assert.deepEqual(result.files.find(f => f.name === 'page-01.png').data, png)
  assert.throws(() => readNoteZip(Buffer.alloc(0)), /not a .wcanvas/)
})

test('aggregate budget bounds each inflate and aborts before subsequent entries', t => {
  const bytes = zip(['one', 'two', 'never'].map(name => ({ name, data: Buffer.alloc(64) })))
  const inflate = zlib.inflateRawSync, budgets = []
  t.mock.method(zlib, 'inflateRawSync', (data, options) => {
    budgets.push(options.maxOutputLength)
    return inflate(data, options)
  })
  assert.throws(() => readZipAll(bytes, { maxTotalBytes: 100, maxPageBytes: 80 }), { code: 'ERR_BUFFER_TOO_LARGE' })
  assert.deepEqual(budgets, [80, 36])
})

test('zip-bomb entry is constrained by per-entry limit regardless of claimed size', t => {
  const bytes = zip([{ name: 'bomb', data: Buffer.from('x'), compressed: zlib.deflateRawSync(Buffer.alloc(4096)) }])
  const inflate = zlib.inflateRawSync, budgets = []
  t.mock.method(zlib, 'inflateRawSync', (data, options) => {
    budgets.push(options.maxOutputLength)
    return inflate(data, options)
  })
  assert.throws(() => readZipAll(bytes, { maxPageBytes: 128 }), { code: 'ERR_BUFFER_TOO_LARGE' })
  assert.deepEqual(budgets, [128])
  assert.throws(() => readZipAll(bytes, { maxTotalBytes: MAX_TOTAL_BYTES + 1 }), /invalid extraction limits/)
  assert.throws(() => readZipAll(bytes, { maxPageBytes: MAX_PAGE_BYTES + 1 }), /invalid extraction limits/)
})

test('stored entries also obey cumulative budgets, including exact exhaustion', () => {
  const bytes = zip(['one', 'two'].map(name => ({ name, data: Buffer.alloc(64), method: 0 })))
  assert.throws(() => readZipAll(bytes, { maxTotalBytes: 100 }), /budget/)
  assert.throws(() => readZipAll(bytes, { maxTotalBytes: 64 }), /project too large/)
  assert.equal(readZipAll(bytes, { maxTotalBytes: 128 }).length, 2)
})

test('project import decodes only the manifest and referenced pages', () => {
  const manifest = { schemaVersion: 1, app: 'writecanvas', kind: 'note', name: 'Note', pages: [{ file: 'page.png' }] }
  const bytes = zip([
    { name: 'unused-bomb', data: Buffer.from('x'), compressed: Buffer.from('not deflate') },
    { name: 'page.png', data: png },
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
  ])
  const result = readNoteZip(bytes)
  assert.deepEqual(result.files.map(f => f.name), ['page.png', 'manifest.json'])
  assert.deepEqual(result.files[0].data, png)
  const missing = zip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) }])
  assert.throws(() => readNoteZip(missing), /missing from the project/)
})

test('project extraction shares its budget between the manifest and pages', () => {
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, app: 'writecanvas', kind: 'note', name: 'Note', pages: [{ file: 'one.png' }, { file: 'two.png' }] }))
  const bytes = zip([
    { name: 'manifest.json', data: manifest },
    { name: 'one.png', data: Buffer.alloc(64) },
    { name: 'two.png', data: Buffer.alloc(64) },
  ])
  assert.throws(() => readNoteZip(bytes, { maxTotalBytes: manifest.length + 100 }), { code: 'ERR_BUFFER_TOO_LARGE' })
  assert.equal(readNoteZip(bytes, { maxTotalBytes: manifest.length + 128 }).files.length, 3)
})

test('archive file is statted and oversized input is rejected before any read', async () => {
  let reads = 0
  await assert.rejects(readNoteFile('huge', {
    stat: async () => ({ size: MAX_TOTAL_BYTES + 1 }),
    readFile: async () => { reads++; throw new Error('must not read') },
  }), /project too large/)
  assert.equal(reads, 0)
  const { zip: bytes } = buildNoteZip({ name: 'Blank', pages: [{ file: null }] })
  const result = await readNoteFile('valid', { stat: async () => ({ size: bytes.length }), readFile: async () => bytes })
  assert.equal(result.manifest.name, 'Blank')
  await assert.rejects(readNoteFile('missing', { stat: async () => { throw new Error('missing') } }), /missing/)
})

async function libraryFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wc-import-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const lib = new Library(path.join(root, 'library'))
  await lib.ensure()
  const sources = ['one', 'two', 'three'].map(name => path.join(root, `${name}.png`))
  for (const source of sources) await fs.writeFile(source, png)
  return { lib, sources }
}

test('PNG import persists valid images unchanged and reports unreadable sources', async t => {
  const { lib, sources } = await libraryFixture(t)
  const result = await importPngNotes(lib, sources)
  assert.equal(result.imported.length, 3)
  assert.deepEqual(result.errors, [])
  for (const id of result.imported) {
    assert.deepEqual(await fs.readFile(lib.pagePath(lib.get(id).note.pages[0].file)), png)
  }
  const failed = await importPngNotes(lib, [path.join(lib.root, 'missing.png')])
  assert.deepEqual(failed.imported, [])
  assert.match(failed.errors[0].error, /ENOENT/)
  assert.equal(lib.index.items.filter(i => i.type === 'note').length, 3)
})

test('PNG imports retain successful files around a failed copy without phantom notes', async t => {
  const { lib, sources } = await libraryFixture(t)
  const result = await importPngNotes(lib, sources, { ...fs, copyFile: async (src, dest) => {
    await fs.copyFile(src, dest)
    if (src === sources[1]) throw new Error('injected copy failure')
  } })
  assert.equal(result.imported.length, 2)
  assert.deepEqual(result.errors, [{ path: sources[1], error: 'injected copy failure' }])
  assert.deepEqual(lib.index.items.filter(i => i.type === 'note').map(i => i.name), ['one', 'three'])
  assert.deepEqual((await fs.readdir(lib.scribbleDir)).sort(), ['one#01.png', 'three#01.png'])
  const reloaded = new Library(lib.root)
  await reloaded.ensure()
  assert.deepEqual(reloaded.index.items, lib.index.items)
})

test('PNG import rolls back file and item on failed persistence, and handles empty input', async t => {
  const { lib, sources } = await libraryFixture(t)
  assert.deepEqual(await importPngNotes(lib, []), { imported: [], errors: [] })
  lib.persist = async () => { throw new Error('disk full') }
  const result = await importPngNotes(lib, sources.slice(0, 1))
  assert.equal(result.imported.length, 0)
  assert.match(result.errors[0].error, /disk full/)
  assert.equal(lib.index.items.filter(i => i.type === 'note').length, 0)
  assert.deepEqual(await fs.readdir(lib.scribbleDir), [])
})

test('PDF resources are cleaned after success and every preparation/printing failure', async () => {
  for (const failure of [null, 'image', 'html', 'window', 'load', 'print', 'destination', 'destroy']) {
    let destroyed = false, removed = false, created = false
    const io = {
      mkdtemp: async () => '/fake/wc-pdf',
      writeFile: async file => {
        if ((failure === 'image' && file.endsWith('.png')) || (failure === 'html' && file.endsWith('.html')) ||
            (failure === 'destination' && file === '/out.pdf')) throw new Error(failure)
      },
      rm: async (dir, options) => {
        assert.equal(dir, '/fake/wc-pdf')
        assert.deepEqual(options, { recursive: true, force: true })
        removed = true
      },
    }
    const createWindow = () => {
      if (failure === 'window') throw new Error(failure)
      created = true
      return {
        loadFile: async () => { if (failure === 'load') throw new Error(failure) },
        webContents: { printToPDF: async () => { if (failure === 'print') throw new Error(failure); return Buffer.from('pdf') } },
        destroy: () => { destroyed = true; if (failure === 'destroy') throw new Error(failure) },
      }
    }
    const run = renderPdf([png], { widthMM: 210, heightMM: 297 }, '/out.pdf', createWindow, io)
    if (failure) await assert.rejects(run, new RegExp(failure))
    else await run
    assert.equal(removed, true)
    assert.equal(destroyed, created)
  }
})
