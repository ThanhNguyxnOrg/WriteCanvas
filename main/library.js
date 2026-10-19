'use strict'
// Library index manager.
// Layout mirrors the original Scrble Ink: <root>/Scribble/<Name>#<NN>.png
// plus our own index.json that holds the tree + per-page meta.

const fs = require('node:fs/promises')
const fss = require('node:fs')
const path = require('node:path')

const SANITIZE = /[\\/:*?"<>|]/g

function sanitizeName(name) {
  const s = String(name || '').trim().replace(SANITIZE, '_')
  return s || 'Untitled'
}

function pageFileName(name, index) {
  return `${sanitizeName(name)}#${String(index + 1).padStart(2, '0')}.png`
}

class Library {
  constructor(root) {
    this.root = root
    this.index = null
  }

  get indexFile() { return path.join(this.root, 'index.json') }
  get scribbleDir() { return path.join(this.root, 'Scribble') }

  async ensure() {
    await fs.mkdir(this.scribbleDir, { recursive: true })
    try {
      const raw = await fs.readFile(this.indexFile, 'utf8')
      this.index = JSON.parse(raw)
      if (!this.index || !Array.isArray(this.index.items)) throw new Error('bad index')
    } catch {
      this.index = { version: 1, nextId: 2, items: [{ id: 1, type: 'folder', name: 'My Notes', parent: 0, created: Date.now() }] }
      await this.persist()
    }
  }

  async persist() {
    const tmp = this.indexFile + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(this.index, null, 1), 'utf8')
    await fs.rename(tmp, this.indexFile)
  }

  get(id) { return this.index.items.find(i => i.id === id) || null }

  childrenOf(parentId) {
    const kids = []
    for (const f of this.index.items) if (f.type === 'folder' && f.parent === parentId) kids.push(f)
    const notes = []
    for (const n of this.index.items) if (n.type === 'note' && n.parent === parentId) notes.push(n)
    const byName = (a, b) => a.name.localeCompare(b.name)
    kids.sort(byName); notes.sort(byName)
    for (const n of notes) if (!n.note) n.note = { pages: [{}], currentPage: 0 }
    return [...kids, ...notes]
  }

  nextId() { return this.index.nextId++ }

  // creates folder/note; folder: {name,parent}
  create(type, name, parentId) {
    parentId = Number(parentId) || 0
    if (type !== 'folder' && type !== 'note') throw new Error('bad type')
    if (type === 'folder' && !this.get(parentId)) parentId = 1
    const item = {
      id: this.nextId(),
      type,
      name: sanitizeName(name),
      parent: type === 'folder' ? parentId : (this.get(parentId)?.type === 'folder' ? parentId : 1),
      created: Date.now(),
      modified: Date.now(),
    }
    if (type === 'note') item.note = { pages: [{}], currentPage: 0 }
    // unique name among siblings
    let base = item.name, n = 2
    while (this.siblingNameTaken(item.parent, item.type, item.name, item.id)) item.name = `${base} ${n++}`
    this.index.items.push(item)
    return item
  }

  siblingNameTaken(parentId, type, name, exceptId) {
    return this.index.items.some(i => i.parent === parentId && i.type === type && i.id !== exceptId && i.name === name)
  }

  async rename(id, newName) {
    const item = this.get(id)
    if (!item) throw new Error('not found')
    const clean = sanitizeName(newName)
    if (item.name === clean) return item
    // rename page files of a note
    if (item.type === 'note') {
      const files = (item.note?.pages || []).map(p => p.file).filter(Boolean)
      for (let i = 0; i < (item.note?.pages || []).length; i++) {
        const p = item.note.pages[i]
        if (!p.file) continue
        const from = path.join(this.scribbleDir, p.file)
        const to = path.join(this.scribbleDir, pageFileName(clean, i))
        try { await fs.rename(from, to); p.file = path.basename(to) } catch { /* file missing: leave */ }
      }
    }
    item.name = clean
    item.modified = Date.now()
    await this.persist()
    return item
  }

  async move(id, newParent) {
    const item = this.get(id)
    const target = this.get(newParent)
    if (!item || item.parent === newParent) return item
    if (item.type === 'folder') {
      // no cycles
      let p = target && target.type === 'folder' ? newParent : 1
      let walk = p, guard = 0
      while (walk && guard++ < 100) {
        if (walk === id) return item
        walk = this.get(walk)?.parent || 0
      }
      item.parent = p
    } else {
      item.parent = target && target.type === 'folder' ? newParent : 1
    }
    item.modified = Date.now()
    await this.persist()
    return item
  }

  async destroy(id) {
    const item = this.get(id)
    if (!item || item.id === 1) return
    // cascade folders
    const doomed = new Set([id])
    let grew = true
    while (grew) {
      grew = false
      for (const i of this.index.items) {
        if (doomed.has(i.parent) && !doomed.has(i.id)) { doomed.add(i.id); grew = true }
      }
    }
    for (const i of this.index.items) {
      if (doomed.has(i.id) && i.type === 'note') {
        for (const p of i.note?.pages || []) {
          if (!p.file) continue
          try { await fs.unlink(path.join(this.scribbleDir, p.file)) } catch { }
        }
      }
    }
    this.index.items = this.index.items.filter(i => !doomed.has(i.id))
    await this.persist()
  }

  async savePage(noteId, pageIndex, buffer) {
    const item = this.get(noteId)
    if (!item || item.type !== 'note') throw new Error('note not found')
    if (!item.note) item.note = { pages: [{}], currentPage: 0 }
    const pages = item.note.pages
    while (pages.length <= pageIndex) pages.push({})
    const file = pageFileName(item.name, pageIndex)
    const target = path.join(this.scribbleDir, file)
    // page files follow the current note name; remove stale leftovers
    const old = pages[pageIndex].file
    if (old && old !== file) {
      try { await fs.unlink(path.join(this.scribbleDir, old)) } catch { }
    }
    const tmp = target + '.tmp.png'
    await fs.writeFile(tmp, Buffer.from(buffer))
    await fs.rename(tmp, target)
    pages[pageIndex].file = file
    item.modified = Date.now()
    await this.persist()
    return file
  }

  async readPage(file) {
    return fs.readFile(path.join(this.scribbleDir, file))
  }

  async pageCountOnDisk(name) {
    try {
      const files = await fs.readdir(this.scribbleDir)
      return files.filter(f => f.toLowerCase().startsWith(sanitizeName(name).toLowerCase() + '#') && f.toLowerCase().endsWith('.png'))
    } catch { return [] }
  }

  async setRoot(root) {
    this.root = root
    await this.ensure()
  }

  listFiles() { return fss.existsSync(this.scribbleDir) ? fss.readdirSync(this.scribbleDir) : [] }
  pagePath(file) { return path.join(this.scribbleDir, file) }
}

module.exports = { Library, sanitizeName, pageFileName }
