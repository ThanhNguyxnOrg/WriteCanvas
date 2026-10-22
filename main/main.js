'use strict'
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const fss = require('node:fs')
const os = require('node:os')
const { Library, sanitizeName, pageFileName } = require('./library')
const { writeNotePng, readNoteMeta, extractInkGif, extractVecJson, pngIsBroken, repairPNG } = require('./scrble-format')
const { GIFEncoder, quantize, applyPalette } = require('gifenc')

let win = null
let lib = null
let allowClose = false
let closePending = false
let closeTimer = null
const configPath = () => path.join(app.getPath('userData'), 'config.json')

async function loadConfig() {
  try { return JSON.parse(await fs.readFile(configPath(), 'utf8')) } catch { return {} }
}
async function saveConfig(cfg) {
  await fs.writeFile(configPath(), JSON.stringify(cfg, null, 1), 'utf8')
}

async function createWindow() {
  allowClose = false
  closePending = false
  // On Windows we host our own UWP-style caption row (titleBarStyle hidden);
  // other platforms keep the native frame.
  const useWCO = process.platform === 'win32'
  win = new BrowserWindow({
    icon: path.join(__dirname, '..', 'src', 'img', 'writecanvas.png'),
    // the original runs on a 1920-wide desktop UI; default to a size that
    // fits the full toolbar (left tools + title + 10 pens + 6 toggles)
    width: 1700, height: 1000, minWidth: 1420, minHeight: 760,
    backgroundColor: '#ffffff',
    autoHideMenuBar: false,
    titleBarStyle: useWCO ? 'hidden' : 'default',
    titleBarOverlay: useWCO ? { color: '#ffffff', symbolColor: '#1a1a1a', height: 32 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'))
  win.on('page-title-updated', e => e.preventDefault())
  // Renderer-side beforeunload cannot await IPC. Intercept close, ask the
  // renderer to flush every pending page write, then close on its handshake.
  win.on('close', e => {
    if (allowClose) return
    if (!win || win.isDestroyed()) return
    e.preventDefault()
    closePending = true
    if (win.webContents.isDestroyed()) { closePending = false; allowClose = true; win.close(); return }
    win.webContents.send('cmd', 'flush-close')
    clearTimeout(closeTimer)
    closeTimer = setTimeout(async () => {
      if (allowClose || !closePending || !win || win.isDestroyed()) return
      const res = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Keep open', 'Close anyway'],
        defaultId: 0, cancelId: 0,
        message: 'Saving is taking longer than expected',
        detail: 'Unsaved strokes may be lost if you close now. Keep the window open and check the library folder if saves are failing.',
      })
      if (!closePending) return
      if (res.response === 1 && win && !win.isDestroyed()) {
        closePending = false; allowClose = true; win.close()
      } else {
        closePending = false
      }
    }, 20000)
  })
  win.on('closed', () => {
    clearTimeout(closeTimer)
    closeTimer = null
    closePending = false
    win = null
  })
}

function pushLibrary() {
  if (win && !win.isDestroyed()) win.webContents.send('cmd', 'library', JSON.parse(JSON.stringify(lib.index)))
}

function menu() {
  const send = (c, a) => () => win.webContents.send('cmd', c, a)
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: send('new-note') },
        { label: 'New Folder', click: send('new-folder') },
        { type: 'separator' },
        { label: 'Import PNG…', click: send('import') },
        { label: 'Open Library Folder', click: send('reveal-library') },
        { type: 'separator' },
        { label: 'Save Page', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: send('export') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }] },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: send('zoom', { dir: 1 }) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: send('zoom', { dir: -1 }) },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: send('zoom', { reset: true }) },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------- sINK replay GIF ----------
async function encodeGif(frames) {
  if (!frames.length) return null
  const gif = GIFEncoder()
  for (const f of frames) {
    const data = f.data instanceof Uint8ClampedArray || f.data instanceof Uint8Array ? f.data : Uint8Array.from(f.data)
    const palette = quantize(data, 256, { format: 'rgb444' })
    const index = applyPalette(data, palette, 'rgb444')
    gif.writeFrame(index, f.width, f.height, { palette, delay: f.delay })
  }
  gif.finish()
  return gif.bytes()
}

// ---------- IPC ----------
function registerIpc() {
  // Windows draws the caption buttons in a native overlay above the page; the
  // overlay has its own colour and does not inherit body.dark. Keep it in step
  // with the in-app theme so dark mode never leaves a white corner.
  ipcMain.on('ui:titlebar-theme', (_e, dark) => {
    if (!win || win.isDestroyed()) return
    try {
      win.setTitleBarOverlay({
        color: dark ? '#15181D' : '#F7F8FA',
        symbolColor: dark ? '#E6E9EF' : '#1A1A1A',
        height: 32,
      })
    } catch { /* non-Windows or unsupported Electron */ }
  })

  ipcMain.on('app:close-ready', () => {
    // only honor the handshake from a close we actually initiated; a stray
    // message must not disable the flush guard for the next real close
    if (!closePending || allowClose) return
    closePending = false
    clearTimeout(closeTimer)
    closeTimer = null
    allowClose = true
    if (win && !win.isDestroyed()) win.close()
  })

  ipcMain.handle('lib:get', async () => {
    await lib.ensure()
    // root is exposed so QA/probe scripts can resolve note files without
    // hardcoding anyone's local directory layout
    return { ...JSON.parse(JSON.stringify(lib.index)), root: lib.root }
  })

  ipcMain.handle('lib:pickRoot', async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choose library folder' })
    if (res.canceled || !res.filePaths[0]) return null
    try {
      await chooseRoot(res.filePaths[0])
    } catch (err) {
      dialog.showErrorBox('WriteCanvas — cannot use that library folder', err.message)
    }
    return null
  })

  ipcMain.handle('config:reveal', async () => shell.openPath(lib.root))

  ipcMain.handle('lib:import', async () => {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'], filters: [{ name: 'PNG notes', extensions: ['png'] }], title: 'Import note images',
    })
    if (res.canceled || !res.filePaths[0]) return []
    const folder = lib.get(1) ? 1 : 0 // "My Notes" or root
    const imported = []
    for (const src of res.filePaths) {
      const buf = await fs.readFile(src)
      const meta = readNoteMeta(buf)
      const base = sanitizeName(path.basename(src, path.extname(src)))
      // unique among index siblings AND on disk (page-0 file must not exist)
      let finalName = base, probe = 1
      while (lib.siblingNameTaken(folder, 'note', finalName, 0) ||
             fss.existsSync(lib.pagePath(pageFileName(finalName, 0)))) finalName = `${base} ${++probe}`
      const note = lib.create('note', finalName, folder)
      const file = pageFileName(note.name, 0)
      const target = lib.pagePath(file)
      await fs.copyFile(src, target) // chunks preserved as-is
      note.paper = { size: meta.size || 'letter', orientation: meta.orientation || 'portrait', template: meta.template || 'ruled', bg: meta.bgColor || '#FFFFFFFF' }
      note.note = { pages: [{ file, paper: note.paper }], currentPage: 0 }
      imported.push(note.id)
    }
    await lib.persist()
    pushLibrary()
    return imported
  })

  ipcMain.handle('note:create', async (_e, { name, parentId }) => {
    const item = lib.create('note', name, parentId)
    item.paper = { size: 'letter', orientation: 'portrait', template: 'ruled', bg: '#FFFFFFFF' }
    item.tool = { color: '#000000', widthMM: 2.5, opacity: 1 }
    await lib.persist(); pushLibrary()
    return item
  })

  ipcMain.handle('folder:create', async (_e, { name, parentId }) => {
    const item = lib.create('folder', name, parentId)
    await lib.persist(); pushLibrary()
    return item
  })

  ipcMain.handle('item:rename', async (_e, { id, name }) => {
    const item = await lib.rename(id, name)
    pushLibrary(); return item
  })

  ipcMain.handle('item:move', async (_e, { id, parentId }) => {
    const item = await lib.move(id, parentId)
    pushLibrary(); return item
  })

  ipcMain.handle('item:destroy', async (_e, { id }) => {
    await lib.destroy(id)
    pushLibrary()
    return null
  })

  ipcMain.handle('note:load', async (_e, { id }) => {
    const item = lib.get(Number(id))
    if (!item || item.type !== 'note') return null
    if (!item.note) item.note = { pages: [{}], currentPage: 0 }
    // first blank page has no file yet
    const pages = []
    for (const p of item.note.pages) {
      if (!p.file) { pages.push({ file: null, exists: false }); continue }
      const full = lib.pagePath(p.file)
      try {
        let buf = await fs.readFile(full)
        if (pngIsBroken(buf)) buf = repairPNG(buf) // heal the pre-fix bloated/interleaved layout in memory
        pages.push({
          file: p.file, exists: true, bytes: new Uint8Array(buf),
          paperMeta: readNoteMeta(buf),
          inkGif: extractInkGif(buf) || null, // replay GIF from sINK
          vecJson: extractVecJson(buf), // vector strokes (sVec) when present
        })
      } catch {
        pages.push({ file: p.file, exists: false })
      }
    }
    const note = JSON.parse(JSON.stringify(item))
    delete note.note // pages replaced below with bytes
    return { note, pages }
  })

  ipcMain.handle('note:savePage', async (_e, payload) => {
    const noteId = Number(payload && payload.noteId)
    const pageIndex = Number(payload && payload.pageIndex)
    if (!Number.isInteger(noteId) || !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex > 9999) {
      throw new Error('bad save target')
    }
    if (!payload || !payload.png || typeof payload.png.byteLength !== 'number' || payload.png.byteLength === 0) {
      throw new Error('empty page')
    }
    if (payload.png.byteLength > 200 * 1024 * 1024) throw new Error('page too large')
    const item = lib.get(noteId)
    if (!item || item.type !== 'note') throw new Error('note not found')
    const png = Buffer.from(payload.png)
    const meta = payload.meta && typeof payload.meta === 'object' ? { ...payload.meta } : {}
    delete meta.inkGif
    delete meta.vecJson
    // New frames → encode a fresh sINK replay GIF. No frames → leave the
    // original sINK untouched (upsertChunks only replaces provided types).
    if (Array.isArray(payload.frames) && payload.frames.length) {
      if (payload.frames.length > 5000) throw new Error('too many replay frames')
      const gif = await encodeGif(payload.frames)
      if (gif && gif.length) meta.inkGif = Buffer.from(gif)
    }
    if (payload.vec != null) {
      const vec = String(payload.vec)
      if (vec.length > 64 * 1024 * 1024) throw new Error('vector snapshot too large')
      meta.vecJson = vec // vector strokes → sVec chunk
    }
    const out = writeNotePng(png, meta)
    const file = await lib.savePage(noteId, pageIndex, out)
    // remember tool + paper settings in the index
    if (meta.tool) item.tool = meta.tool
    if (meta.paper && item.note?.pages?.[pageIndex]) item.note.pages[pageIndex].paper = meta.paper
    await lib.persist()
    pushLibrary()
    return { file }
  })

  // QA helper for UI test scripts (CDP captureScreenshot stalls on this
  // GPU-less compositor; go through webContents.capturePage instead)
  ipcMain.handle('debug:captureWindow', async e => {
    // a minimized / unpainted window has no display surface to capture
    if (win.isMinimized()) win.restore()
    win.show()
    for (let i = 0; i < 3; i++) {
      try {
        await new Promise(r => setTimeout(r, 120))
        const img = await e.sender.capturePage()
        if (!img.isEmpty()) return img.toPNG()
      } catch (err) {
        if (i === 2) throw err
      }
    }
    throw new Error('captureWindow: empty surface after 3 tries')
  })

  ipcMain.handle('export:saveAs', async (_e, { bytes, defaultName, kind }) => {
    const filters = { png: [{ name: 'PNG', extensions: ['png'] }], jpg: [{ name: 'JPEG', extensions: ['jpg'] }], gif: [{ name: 'GIF', extensions: ['gif'] }] }
    const res = await dialog.showSaveDialog(win, { defaultPath: `${sanitizeName(defaultName)}.${kind}`, filters: filters[kind] || filters.png })
    if (res.canceled || !res.filePath) return null
    await fs.writeFile(res.filePath, Buffer.from(bytes))
    shell.showItemInFolder(res.filePath)
    return res.filePath
  })

  ipcMain.handle('export:pdf', async (_e, { pages, paper }) => {
    const res = await dialog.showSaveDialog(win, { defaultPath: `export.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (res.canceled || !res.filePath) return null
    // write page PNGs + an HTML wrapper to a temp dir, then print that to one
    // PDF in the paper's physical size (loadFile, not data: — a data: page
    // cannot load file:// images).
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wc-pdf-'))
    const files = []
    for (let i = 0; i < pages.length; i++) {
      const f = path.join(tmp, `p${i}.png`)
      await fs.writeFile(f, Buffer.from(pages[i]))
      files.push(f)
    }
    const wIn = Math.round((paper.widthMM / 25.4) * 100) / 100
    const hIn = Math.round((paper.heightMM / 25.4) * 100) / 100
    const htmlFile = path.join(tmp, 'pages.html')
    await fs.writeFile(htmlFile, `<!doctype html><html><head><style>
      @page { margin: 0 } html,body{margin:0;padding:0}
      img{display:block;width:${wIn}in;height:${hIn}in;page-break-after:always}
      img:last-child{page-break-after:auto}
    </style></head><body>${files.map(f => `<img src="file:///${f.replace(/\\/g, '/')}">`).join('')}</body></html>`, 'utf8')
    const pdfWin = new BrowserWindow({ show: false, width: 1000, height: 900, webPreferences: { offscreen: true } })
    try {
      await pdfWin.loadFile(htmlFile)
      const buf = await pdfWin.printToPDF({
        printBackground: true,
        pageSize: { width: wIn, height: hIn },
        margins: { marginType: 'none' },
        landscape: !!paper.landscape,
      })
      await fs.writeFile(res.filePath, buf)
      shell.showItemInFolder(res.filePath)
    } finally {
      pdfWin.destroy()
      for (const f of files) { try { await fs.unlink(f) } catch { } }
      try { await fs.unlink(htmlFile) } catch { }
      try { await fs.rmdir(tmp) } catch { }
    }
    return res.filePath
  })
}

async function chooseRoot(dir) {
  // validate the new root before replacing the working library: a bad folder
  // must leave the current library usable
  const next = new Library(dir)
  await next.ensure()
  const cfg = await loadConfig()
  cfg.root = dir
  await saveConfig(cfg)
  lib = next
  pushLibrary()
}

app.whenReady().then(async () => {
  const cfg = await loadConfig()
  const root = cfg.root || path.join(app.getPath('documents'), 'WriteCanvas')
  lib = new Library(root)
  try {
    await lib.ensure()
  } catch (err) {
    dialog.showErrorBox('WriteCanvas — library error', err.message)
    app.quit()
    return
  }
  registerIpc()
  menu()
  await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}).catch(err => {
  dialog.showErrorBox('WriteCanvas — startup error', err && err.stack ? err.stack : String(err))
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
