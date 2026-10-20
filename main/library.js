'use strict'
// Library index manager.
// Layout mirrors the original Scrble Ink: <root>/Scribble/<Name>#<NN>.png
// plus our own index.json that holds the tree + per-page meta.

const fs = require('node:fs/promises')
const fss = require('node:fs')
const path = require('node:path')

const SANITIZE = /[\\/:*?"<>|]/g

// Windows + OneDrive/AV can briefly lock the destination file, making
// rename() fail with EPERM/EBUSY/EACCES even though retrying a moment later
// succeeds (seen live: index.json.tmp -> index.json inside a synced Documents
// folder). Retry with backoff; as a last resort copy over the destination.
async function renameRetry(src, dest, attempts = 6) {
  let lastErr = null
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rename(src, dest)
      return
    } catch (err) {
      lastErr = err
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err
      await new Promise(r => setTimeout(r, 40 * (i + 1)))
    }
  }
  if (lastErr && ['EPERM', 'EBUSY', 'EACCES'].includes(lastErr.code)) {
    await fs.copyFile(src, dest)
    await fs.unlink(src).catch(() => { })
    return
  }
  throw lastErr
}

function sanitizeName(name) {
  let s = String(name || '').trim().replace(SANITIZE, '_').replace(/[. ]+$/g, '')
  if (!s) s = 'Untitled'
  // Windows device names cannot be used as a file stem (CON.png fails)
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) s = '_' + s
  // stay well below the 255-byte component limit even after "#NN.png"
  return s.slice(0, 120)
}

// Page files are flat inside Scribble/: the sanitized title is the on-disk
// identity. Two notes with the same/sanitized name in different folders would
// otherwise share one PNG and silently overwrite each other.
function nameKey(name) {
  return sanitizeName(name).toLowerCase()
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

  async loadIndex(file) {
    const raw = await fs.readFile(file, 'utf8')
    const idx = JSON.parse(raw)
    if (!idx || !Array.isArray(idx.items)) throw new Error('bad index structure')
    this.index = idx
  }

  async ensure() {
    await fs.mkdir(this.scribbleDir, { recursive: true })
    let indexErr = null
    try {
      await this.loadIndex(this.indexFile)
      return
    } catch (err) {
      indexErr = err
    }
    // A valid backup still knows every note. Recover it for a missing OR
    // corrupt main index; only a first-run library with neither file may be
    // initialized empty. Never overwrite a corrupt index until recovery works.
    try {
      await this.loadIndex(this.indexFile + '.bak')
      this._skipBackup = true // don't copy the missing/corrupt main file over the good backup
      await this.persist()
      return
    } catch { /* no usable backup */ }
    if (indexErr.code === 'ENOENT') {
      this.index = { version: 1, nextId: 2, items: [{ id: 1, type: 'folder', name: 'My Notes', parent: 0, created: Date.now() }] }
      await this.persist()
      return
    }
    throw new Error(`Library index is unreadable: ${this.indexFile} (${indexErr.message}). Nothing was overwritten; restore index.json.bak or fix the file.`)
  }

  async persist() {
    const tmp = `${this.indexFile}.${process.pid}.${Date.now()}.tmp`
    try {
      await fs.writeFile(tmp, JSON.stringify(this.index, null, 1), 'utf8')
      if (!this._skipBackup) {
        try {
          await fs.copyFile(this.indexFile, this.indexFile + '.bak')
        } catch (err) {
          if (err.code !== 'ENOENT') console.warn('index backup failed:', err.message)
        }
      }
      await renameRetry(tmp, this.indexFile)
      this._skipBackup = false
    } finally {
      await fs.unlink(tmp).catch(() => { })
    }
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
    // note names must be unique across the whole library, not just among
    // siblings: their page files share one flat Scribble/ directory
    let base = item.name, n = 2
    while (type === 'note'
      ? this.noteNameTaken(item.name, item.id)
      : this.siblingNameTaken(item.parent, item.type, item.name, item.id)) {
      item.name = `${base} ${n++}`
    }
    this.index.items.push(item)
    return item
  }

  siblingNameTaken(parentId, type, name, exceptId) {
    return this.index.items.some(i => i.parent === parentId && i.type === type && i.id !== exceptId && i.name === name)
  }

  noteNameTaken(name, exceptId) {
    const key = nameKey(name)
    return this.index.items.some(i => i.type === 'note' && i.id !== exceptId && nameKey(i.name) === key)
  }

  async pageFilesTaken(name, pages, exceptFiles = []) {
    const skip = new Set(exceptFiles.filter(Boolean).map(f => String(f).toLowerCase()))
    for (let i = 0; i < Math.max(1, pages.length); i++) {
      const file = pageFileName(name, i)
      if (skip.has(file.toLowerCase())) continue
      try {
        await fs.access(path.join(this.scribbleDir, file))
        return true
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
    }
    return false
  }

  async rename(id, newName) {
    const item = this.get(id)
    if (!item) throw new Error('not found')
    const base = sanitizeName(newName)
    if (item.name === base) return item

    let clean = base, n = 2
    if (item.type === 'note') {
      const pages = item.note?.pages || []
      const currentFiles = pages.map(p => p.file).filter(Boolean)
      // never rename onto another note's title or an existing page file
      while (this.noteNameTaken(clean, id) || await this.pageFilesTaken(clean, pages, currentFiles)) {
        clean = `${base} ${n++}`
      }
    } else {
      while (this.siblingNameTaken(item.parent, 'folder', clean, id)) clean = `${base} ${n++}`
    }

    const oldName = item.name
    const oldModified = item.modified
    const done = []
    if (item.type === 'note' && item.note) {
      const pages = item.note.pages || []
      const moves = []
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i]
        if (!p.file) continue
        const from = this.pagePath(p.file)
        const to = path.join(this.scribbleDir, pageFileName(clean, i))
        if (path.resolve(from) === path.resolve(to)) continue
        moves.push({ from, to, p })
      }
      try {
        for (const m of moves) {
          await renameRetry(m.from, m.to)
          m.p.file = path.basename(m.to)
          done.push(m)
        }
      } catch (err) {
        // leave the index pointing at files that actually exist
        for (const m of done.reverse()) {
          try {
            await renameRetry(m.to, m.from)
            m.p.file = path.basename(m.from)
          } catch { /* best effort rollback */ }
        }
        throw err
      }
    }
    item.name = clean
    item.modified = Date.now()
    try {
      await this.persist()
    } catch (err) {
      // persist is atomic: the old index still points at the old names, so put
      // every file back before reporting the failure
      item.name = oldName
      item.modified = oldModified
      for (const m of done.reverse()) {
        try {
          await renameRetry(m.to, m.from)
          m.p.file = path.basename(m.from)
        } catch { /* best effort rollback */ }
      }
      throw err
    }
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
    // Persist the removal first: if the index write fails, the files are still
    // referenced and must not have been deleted yet.
    const doomedNotes = this.index.items.filter(i => doomed.has(i.id) && i.type === 'note')
    this.index.items = this.index.items.filter(i => !doomed.has(i.id))
    await this.persist()
    for (const i of doomedNotes) {
      for (const p of i.note?.pages || []) {
        if (!p.file) continue
        try { await fs.unlink(this.pagePath(p.file)) } catch { }
      }
    }
  }

  async savePage(noteId, pageIndex, buffer) {
    const item = this.get(noteId)
    if (!item || item.type !== 'note') throw new Error('note not found')
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex > 9999) throw new Error('bad page index')
    if (!item.note) item.note = { pages: [{}], currentPage: 0 }
    const pages = item.note.pages
    while (pages.length <= pageIndex) pages.push({})
    const file = pageFileName(item.name, pageIndex)
    const target = this.pagePath(file)
    // a legacy collision must fail loudly instead of overwriting another note
    const owner = this.index.items.find(i => i.type === 'note' && i.id !== noteId &&
      (i.note?.pages || []).some(p => p.file && String(p.file).toLowerCase() === file.toLowerCase()))
    if (owner) throw new Error(`Page file ${file} is already used by note "${owner.name}"`)
    // page files follow the current note name. Keep the old file until the new
    // index is safely persisted: a failed index write must never leave the
    // index pointing at a file we already deleted.
    const old = pages[pageIndex].file
    const oldShared = old && this.index.items.some(i => i.type === 'note' && i.id !== noteId &&
      (i.note?.pages || []).some(p => p.file && String(p.file).toLowerCase() === String(old).toLowerCase()))
    const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp.png`
    try {
      await fs.writeFile(tmp, Buffer.from(buffer))
      await renameRetry(tmp, target)
    } finally {
      await fs.unlink(tmp).catch(() => { })
    }
    pages[pageIndex].file = file
    item.modified = Date.now()
    try {
      await this.persist()
    } catch (err) {
      pages[pageIndex].file = old
      throw err
    }
    // now that the index names the new file, the old one is an orphan
    if (old && old !== file && !oldShared) {
      try { await fs.unlink(this.pagePath(old)) } catch { }
    }
    return file
  }

  async readPage(file) {
    return fs.readFile(this.pagePath(file))
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
  pagePath(file) {
    const name = String(file || '')
    // index.json is editable local data: never let a page entry escape Scribble/
    if (!name || name === '.' || name === '..' || name.includes('\0') ||
      /[\\/]/.test(name) || path.basename(name) !== name) throw new Error('invalid page file name')
    return path.join(this.scribbleDir, name)
  }
}

module.exports = { Library, sanitizeName, pageFileName }
