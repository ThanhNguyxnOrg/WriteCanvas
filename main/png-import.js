'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { sanitizeName, pageFileName } = require('./library')
const { readNoteMeta } = require('./scrble-format')

async function importPngNotes(lib, sources, io = fs) {
  const imported = [], errors = []
  const folder = lib.get(1) ? 1 : 0
  for (const src of sources) {
    let note, tmp, target, copied = false
    try {
      const meta = readNoteMeta(await io.readFile(src))
      const base = sanitizeName(path.basename(src, path.extname(src)))
      let name = base, probe = 1
      while (lib.noteNameTaken(name, 0) || await io.stat(lib.pagePath(pageFileName(name, 0))).then(() => true, err => {
        if (err.code !== 'ENOENT') throw err
        return false
      })) name = `${base} ${++probe}`
      note = lib.create('note', name, folder)
      const file = pageFileName(note.name, 0)
      target = lib.pagePath(file)
      tmp = `${target}.${randomUUID()}.import`
      await io.copyFile(src, tmp)
      await io.rename(tmp, target)
      copied = true
      note.paper = { size: meta.size || 'letter', orientation: meta.orientation || 'portrait', template: meta.template || 'ruled', bg: meta.bgColor || '#FFFFFFFF' }
      note.note = { pages: [{ file, paper: note.paper }], currentPage: 0 }
      await lib.persist()
      imported.push(note.id)
    } catch (err) {
      if (note) lib.index.items = lib.index.items.filter(item => item !== note)
      const cleanupErrors = []
      for (const file of [tmp, copied && target].filter(Boolean)) {
        try { await io.unlink(file) } catch (cleanup) {
          if (cleanup.code !== 'ENOENT') cleanupErrors.push(`Could not remove ${file}: ${cleanup.message}`)
        }
      }
      errors.push({ path: src, error: [err.message, ...cleanupErrors].join('\n') })
    }
  }
  return { imported, errors }
}

module.exports = { importPngNotes }
