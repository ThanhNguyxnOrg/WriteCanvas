// App bootstrap: wires the bridge, editor, and library UI together; keeps the
// library tree in sync with main-process pushes; exposes a small test hook.

import { bridge } from './bridge.js'
import { init as initEditor, S, openNote, saveCurrentPage } from './editor.js'
import { init as initLib, update as libUpdate, selectNote, selectedFolder } from './library.js'
import { promptText } from './ctx.js'

const $ = id => document.getElementById(id)

const App = {
  bridge,

  async openNote(id) {
    try { await openNote(id) } catch (err) { console.error('openNote failed', err) }
  },

  // menu / shortcut command handlers
  async cmdNewNote() {
    const item = await bridge.createNote('Untitled', selectedFolder())
    libUpdate(await bridge.library())
    this.openNote(item.id)
  },
  async cmdNewFolder() {
    const name = await promptText('New folder name', 'Folder')
    if (name) await bridge.createFolder(name, selectedFolder())
  },
  async cmdImport() {
    const ids = await bridge.importNotes()
    if (ids.length) this.openNote(ids[0])
  },
  async cmdImportProject() {
    const ids = await bridge.importProject()
    if (ids.length) this.openNote(ids[0])
  },
  reloadLibrary() {
    bridge.library().then(libUpdate)
  },

  // editor reports which note it opened; tree follows the selection
  selectNote(id) { selectNote(id) },

  // the editor keeps runtime strokes; only refresh the visible title
  async reloadTitle() {
    const { currentNoteName } = await import('./library.js')
    $('noteTitle').textContent = currentNoteName()
  },
}

// keep the tree in sync with every mutation the main process pushes
function wirePushes() {
  bridge.on('cmd', (cmd, arg) => {
    if (cmd === 'library') libUpdate(arg)
  })
}

async function main() {
  if (!bridge) {
    document.body.innerHTML =
      '<div style="padding:2rem;font-family:sans-serif;color:#e26" >No host bridge found — run WriteCanvas through Electron or Tauri.</div>'
    return
  }
  if (bridge.platform !== 'win32') document.body.classList.add('native-frame')

  initEditor(App)
  initLib(App)

  const lib = await bridge.library()
  libUpdate(lib)
  wirePushes()

  // reopen the last note
  const last = Number(localStorage.getItem('wc:lastNote'))
  if (last && lib.items.some(i => i.id === last)) await App.openNote(last)
}

// deterministic test hooks for the Playwright/CDP flows
window.__wc = { App, S, saveCurrentPage, openNote }

main()
