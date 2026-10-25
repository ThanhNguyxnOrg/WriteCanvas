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
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
