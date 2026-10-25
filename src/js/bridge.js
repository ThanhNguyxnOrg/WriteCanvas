// Bridge: the renderer never knows if it runs on Electron or Tauri.
const host = () => {
  if (typeof window !== 'undefined' && window.WriteCanvasHost) return window.WriteCanvasHost
  // Tauri adapter (same contract; wired when the Tauri shell lands)
  if (typeof window !== 'undefined' && window.__TAURI__) {
    const t = window.__TAURI__
    const invoke = t.core ? t.core.invoke : t.invoke
    return {
      platform: 'tauri',
      async library() { return invoke('library_get') },
      async pickLibraryFolder() { return invoke('library_pick_root') },
      async revealLibraryFolder() { return invoke('config_reveal') },
      async importNotes() { return invoke('library_import') },
      async createNote(name, parentId) { return invoke('note_create', { name, parentId }) },
      async createFolder(name, parentId) { return invoke('folder_create', { name, parentId }) },
      async renameItem(id, name) { return invoke('item_rename', { id, name }) },
      async moveItem(id, parentId) { return invoke('item_move', { id, parentId }) },
      async destroyItem(id) { return invoke('item_destroy', { id }) },
      async loadNote(id) { return invoke('note_load', { id }) },
      async loadPage(noteId, pageIndex) { return invoke('note_load_page', { noteId, pageIndex }) },
      async duplicatePage(noteId, pageIndex) { return invoke('note_duplicate_page', { noteId, pageIndex }) },
      async deletePage(noteId, pageIndex) { return invoke('note_delete_page', { noteId, pageIndex }) },
      async savePage(payload) { return invoke('note_save_page', payload) },
      async exportAs(bytes, defaultName, kind) { return invoke('export_save_as', { bytes, defaultName, kind }) },
      async exportPDF(pages, paper) { return invoke('export_pdf', { pages, paper }) },
      async exportProject(noteId) { return invoke('export_project', { noteId }) },
      async importProject() { return invoke('project_import') },
      on(cmd, cb) {
        window.__TAURI__.event.listen('cmd', e => cb(e.payload.cmd, e.payload.arg))
      },
    }
  }
  return null
}

export const bridge = host()
export const isElectron = !!(typeof window !== 'undefined' && window.WriteCanvasHost)
