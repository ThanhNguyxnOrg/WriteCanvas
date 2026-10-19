'use strict'
const { contextBridge, ipcRenderer } = require('electron')

// Bridge adapter for the Electron host. Mirrors the contract in the spec:
// docs/specs/2026-10-19-writecanvas-design.md
contextBridge.exposeInMainWorld('WriteCanvasHost', {
  platform: process.platform,
  async library() { return ipcRenderer.invoke('lib:get') },
  async pickLibraryFolder() { return ipcRenderer.invoke('lib:pickRoot') },
  async revealLibraryFolder() { return ipcRenderer.invoke('config:reveal') },
  async importNotes() { return ipcRenderer.invoke('lib:import') },
  async createNote(name, parentId) { return ipcRenderer.invoke('note:create', { name, parentId }) },
  async createFolder(name, parentId) { return ipcRenderer.invoke('folder:create', { name, parentId }) },
  async renameItem(id, name) { return ipcRenderer.invoke('item:rename', { id, name }) },
  async moveItem(id, parentId) { return ipcRenderer.invoke('item:move', { id, parentId }) },
  async destroyItem(id) { return ipcRenderer.invoke('item:destroy', { id }) },
  async loadNote(id) { return ipcRenderer.invoke('note:load', { id }) },
  // payload: {noteId,pageIndex,png:Uint8Array,frames:[{delay,width,height,data}],meta}
  // Typed arrays cross contextBridge via structured clone — pass through as-is.
  async savePage(payload) { return ipcRenderer.invoke('note:savePage', payload) },
  async exportAs(bytes, defaultName, kind) { return ipcRenderer.invoke('export:saveAs', { bytes, defaultName, kind }) },
  async exportPDF(pages, paper) { return ipcRenderer.invoke('export:pdf', { pages, paper }) },
  // QA helper: UI test scripts grab the window surface through the main
  // process (CDP captureScreenshot stalls on the GPU-less compositor here)
  async captureWindow() { return ipcRenderer.invoke('debug:captureWindow') },
  on(cmd, cb) { ipcRenderer.on('cmd', (_e, c, arg) => cb(c, arg)) },
})
