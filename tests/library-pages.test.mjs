import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Library } = require('../main/library.js')

async function makeLibrary() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wc-page-ops-'))
  const scribble = path.join(root, 'Scribble')
  await fs.mkdir(scribble, { recursive: true })
  await fs.writeFile(path.join(scribble, 'PageOps#01.png'), Buffer.from('one'))
  await fs.writeFile(path.join(scribble, 'PageOps#02.png'), Buffer.from('two'))
  await fs.writeFile(path.join(root, 'index.json'), JSON.stringify({
    version: 1,
    nextId: 3,
    items: [
      { id: 1, type: 'folder', name: 'My Notes', parent: 0, created: 1 },
      {
        id: 2, type: 'note', name: 'PageOps', parent: 1, created: 1, modified: 1,
        note: { pages: [{ file: 'PageOps#01.png' }, { file: 'PageOps#02.png' }], currentPage: 0 },
      },
    ],
  }, null, 1))
  const lib = new Library(root)
  await lib.ensure()
  return { root, scribble, lib }
}

async function exists(file) {
  try { await fs.access(file); return true } catch { return false }
}

describe('library initialization', () => {
  async function unopenedLibrary(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wc-index-'))
    const lib = new Library(root)
    t.after(async () => { await lib.close(); await fs.rm(root, { recursive: true, force: true }) })
    return lib
  }

  it('rejects a second writer and preserves both notes across the handoff', async t => {
    const first = await unopenedLibrary(t)
    const second = new Library(first.root)
    try {
      await first.ensure()
      const note = first.create('note', 'First', 1)
      await first.savePage(note.id, 0, Buffer.from('first page'))
      await assert.rejects(second.ensure(), /library already open/i)
      await assert.rejects(second.persist(), /not open for writing/i)

      await first.close()
      await second.ensure()
      second.create('note', 'Second', 1)
      await second.persist()
      const index = JSON.parse(await fs.readFile(second.indexFile, 'utf8'))
      assert.deepEqual(index.items.filter(i => i.type === 'note').map(i => i.name), ['First', 'Second'])
      assert.equal(await fs.readFile(second.pagePath('First#01.png'), 'utf8'), 'first page')
    } finally {
      await second.close()
    }
  })

  it('refuses to initialize over existing pages when both indexes are missing', async t => {
    const lib = await unopenedLibrary(t)
    await fs.mkdir(lib.scribbleDir)
    const page = lib.pagePath('Journal#01.PNG')
    await fs.writeFile(page, 'original page')

    await assert.rejects(lib.ensure(), /no usable index/i)
    assert.deepEqual((await fs.readdir(lib.root)).sort(), ['.writecanvas-lock.sqlite', 'Scribble'])
    assert.equal(await fs.readFile(page, 'utf8'), 'original page')
  })

  it('restores the backup before checking for unindexed pages', async t => {
    const { root, lib } = await makeLibrary()
    t.after(async () => { await lib.close(); await fs.rm(root, { recursive: true, force: true }) })
    const expected = lib.index
    await lib.close()
    await fs.rename(lib.indexFile, lib.indexFile + '.bak')

    await lib.ensure()
    assert.deepEqual(lib.index, expected)
    assert.deepEqual(JSON.parse(await fs.readFile(lib.indexFile, 'utf8')), expected)
  })

  it('initializes a new library when there are no pages', async t => {
    const lib = await unopenedLibrary(t)
    await lib.ensure()
    const index = JSON.parse(await fs.readFile(lib.indexFile, 'utf8'))
    assert.deepEqual(index.items.map(item => item.name), ['My Notes'])
  })
})

describe('library page operations', () => {
  it('duplicates at the end and renumbers after deleting a middle page', async () => {
    const { root, scribble, lib } = await makeLibrary()
    try {
      const dup = await lib.duplicatePage(2, 0)
      assert.equal(dup.index, 2)
      assert.equal(dup.file, 'PageOps#03.png')
      assert.equal((await fs.readFile(path.join(scribble, dup.file))).toString(), 'one')
      assert.equal(lib.get(2).note.pages.length, 3)

      const pages = await lib.deletePage(2, 1)
      assert.deepEqual(pages.map(p => p.file), ['PageOps#01.png', 'PageOps#02.png'])
      assert.equal(lib.get(2).note.pages.length, 2)
      assert.equal((await fs.readFile(path.join(scribble, 'PageOps#01.png'))).toString(), 'one')
      assert.equal((await fs.readFile(path.join(scribble, 'PageOps#02.png'))).toString(), 'one')
      assert.equal(await exists(path.join(scribble, 'PageOps#03.png')), false)

      const persisted = JSON.parse(await fs.readFile(path.join(root, 'index.json'), 'utf8'))
      assert.deepEqual(persisted.items.find(i => i.id === 2).note.pages.map(p => p.file),
        ['PageOps#01.png', 'PageOps#02.png'])
    } finally {
      await lib.close()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('refuses to delete the only remaining page', async () => {
    const { root, lib } = await makeLibrary()
    try {
      await lib.deletePage(2, 0)
      await assert.rejects(() => lib.deletePage(2, 0), /at least one page/)
      assert.equal(lib.get(2).note.pages.length, 1)
    } finally {
      await lib.close()
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
