// Library tree UI — folders and notes, creation/renaming/moving/deletion via
// the host bridge. Rendering refreshes on every push from the main process.

import { pick, promptText, askConfirm } from './ctx.js'

let app = null
let items = []
let selected = 0
let currentNote = 0
const collapsed = new Set()

export function init(hostApp) {
  app = hostApp
  const tree = document.getElementById('tree')
  tree.addEventListener('contextmenu', e => {
    e.preventDefault()
    if (e.target.closest('.row')) return
    pick([
      { label: 'New Note', act: () => newNote(0) },
      { label: 'New Folder', act: () => newFolder(0) },
    ], e.clientX, e.clientY)
  })
}

// main-process pushes after every library mutation
export function update(libIndex) {
  items = (libIndex && libIndex.items) || []
  if (selected && !items.some(i => i.id === selected)) selected = 0
  render()
}

// selection target for "new note here" — selection in tree; not stored here
export function selectedFolder() {
  const s = items.find(i => i.id === selected)
  if (s && s.type === 'folder') return s.id
  if (s) return s.parent
  return items.find(i => i.id === 1) ? 1 : 0
}

export function currentNoteName() {
  const n = items.find(i => i.id === currentNote)
  return n ? n.name : ''
}

// highlight + track the note opened in the editor
export function selectNote(id) {
  currentNote = id
  selected = id
  render()
}

function buildTree(parentId) {
  const byKind = (a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1)
  return items
    .filter(i => i.parent === parentId)
    .sort(byKind)
    .map(k => ({ item: k, children: k.type === 'folder' ? buildTree(k.id) : [] }))
}

function render() {
  const tree = document.getElementById('tree')
  tree.innerHTML = ''
  const rootId = items.some(i => i.id === 1) ? 1 : 0
  const roots = buildTree(rootId)
  if (!roots.length) {
    tree.innerHTML = '<div style="color:var(--dim);padding:10px 8px;font-size:12px">Empty library</div>'
    return
  }
  tree.appendChild(renderLevel(roots, 0))
}

function renderLevel(nodes, depth) {
  const ul = document.createElement('ul')
  if (depth === 0) ul.className = 'root'
  for (const { item, children } of nodes) {
    const li = document.createElement('li')
    li.appendChild(rowEl(item, depth))
    if (item.type === 'folder' && !collapsed.has(item.id) && children.length) {
      li.appendChild(renderLevel(children, depth + 1))
    }
    ul.appendChild(li)
  }
  return ul
}

function rowEl(item, depth) {
  const row = document.createElement('div')
  row.className = 'row' + (item.id === selected ? ' sel' : '')
  if (item.id === currentNote && item.type === 'note') row.classList.add('current')
  row.dataset.id = item.id
  const icon = document.createElement('span')
  icon.className = 'icon'
  const glyph = item.type === 'folder'
    ? (collapsed.has(item.id) ? 'ic-folder' : 'ic-folder-open')
    : 'ic-note'
  icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${glyph}"/></svg>`
  if (depth > 0) row.style.paddingLeft = `${8 + depth * 12}px`
  const name = document.createElement('span')
  name.textContent = item.name
  name.className = 'name'
  row.title = item.name
  row.append(icon, name)
  row.onclick = () => {
    selected = item.id
    if (item.type === 'folder') toggle(item.id)
    else app.openNote(item.id)
  }
  row.oncontextmenu = e => {
    e.preventDefault()
    selected = item.id
    render()
    itemMenu(item, e.clientX, e.clientY)
  }
  return row
}

function toggle(folderId) {
  const kids = items.filter(i => i.parent === folderId)
  if (kids.length && collapsed.has(folderId)) collapsed.delete(folderId)
  else if (kids.length) collapsed.add(folderId)
  render()
}

function itemMenu(item, x, y) {
  const acts = []
  acts.push({ label: 'New Note Here', act: () => newNote(item.id) })
  if (item.type === 'folder') acts.push({ label: 'New Folder Here', act: () => newFolder(item.id) })
  acts.push('-')
  acts.push({ label: 'Rename…', act: () => rename(item) })
  acts.push({ label: 'Move to…', act: () => moveTo(item) })
  if (item.id !== 1) acts.push({ label: 'Delete', danger: true, act: () => destroy(item) })
  pick(acts, x, y)
}

async function newNote(parentId) {
  const name = await promptText('New note name', 'Untitled')
  if (!name) return
  const item = await app.bridge.createNote(name, parentId || selectedFolder())
  selectNote(item.id)
  await app.openNote(item.id)
}

async function newFolder(parentId) {
  const name = await promptText('New folder name', 'Folder')
  if (!name) return
  const item = await app.bridge.createFolder(name, parentId || selectedFolder())
  selected = item.id
}

async function rename(item) {
  const name = await promptText(`Rename "${item.name}"`, item.name)
  if (!name || name === item.name) return
  await app.bridge.renameItem(item.id, name)
  if (item.id === currentNote && app.reloadTitle) app.reloadTitle()
}

function folderTargets(exceptId) {
  const out = []
  const walk = (pid, depth) => {
    for (const i of items) {
      if (i.parent !== pid || i.type !== 'folder') continue
      if (i.id !== exceptId) out.push(i)
      if (i.id !== exceptId || exceptId == null) walk(i.id, depth + 1)
    }
  }
  walk(0, 0)
  return out
}

function moveTo(item) {
  const folders = folderTargets(item.type === 'folder' ? item.id : null)
  const acts = folders.map(f => ({ label: f.name, act: () => app.bridge.moveItem(item.id, f.id) }))
  if (!acts.length) acts.push({ label: 'No folders yet', act: () => { } })
  pick(acts, 240, 90)
}

async function destroy(item) {
  const ok = await askConfirm(`Delete "${item.name}"${item.type === 'folder' ? ' and everything inside' : ''}?`)
  if (!ok) return
  const gone = new Set([item.id])
  if (item.type === 'folder') {
    let grew = true
    while (grew) {
      grew = false
      for (const it of items) {
        if (it.parent && gone.has(it.parent) && !gone.has(it.id)) { gone.add(it.id); grew = true }
      }
    }
  }
  const wasOpen = gone.has(currentNote)
  if (item.id === currentNote) currentNote = 0
  if (item.id === selected) selected = 0
  // Close before destroying: openNote() flushes the current page first, and a
  // flush against a deleted file used to block every later note switch.
  if (wasOpen) app.closeNote()
  await app.bridge.destroyItem(item.id)
  if (wasOpen) {
    const next = items.find(i => i.type === 'note' && !gone.has(i.id))
    if (next) await app.openNote(next.id)
    else await app.cmdNewNote()
  }
}
