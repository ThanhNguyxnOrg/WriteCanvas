'use strict'
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const fss = require('node:fs')
const os = require('node:os')
const { Library, sanitizeName, pageFileName } = require('./library')
const { writeNotePng, readNoteMeta, readNotePage, pngIsBroken, repairPNG, legacyRasterBase } = require('./scrble-format')
const { GIFEncoder, quantize, applyPalette } = require('gifenc')
const { buildNoteZip, readNoteZip } = require('./wcanvas-export')

// Keep the compositor producing frames even when the window is fully covered.
// Windows occlusion heuristics otherwise stop frame production while the app
// sits behind other windows; CDP/Playwright screenshots then stall until the
// window is brought to front again. Pairs with backgroundThrottling: false.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

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
    // The window and taskbar icon on Linux and in development; a packaged
    // Windows build takes its icon from the executable instead.
    icon: path.join(__dirname, '..', 'src', 'img', 'writecanvas.png'),
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
        { label: 'Import .wcanvas Project…', click: send('import-project') },
        { label: 'Export .wcanvas Project…', click: send('export-project') },
        { label: 'Open Library Folder', click: send('reveal-library') },
        { type: 'separator' },
        { label: 'Save Note', accelerator: 'CmdOrCtrl+S', click: send('save') },
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
    {
      role: 'help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: send('shortcuts') },
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
async function loadPageEntry(p) {
  if (!p.file) return { file: null, exists: false }
  try {
    let buf = await fs.readFile(lib.pagePath(p.file))
    if (pngIsBroken(buf)) buf = repairPNG(buf) // heal the pre-fix bloated/interleaved layout in memory
    const page = readNotePage(buf)
    // Prefer the clean sRST base so vector ink is drawn exactly once.
    // Older pages without sRST have the imported image only in IDAT; that
    // fallback applies when their sVec has no editable content (and always
    // for pages that were imported but never saved by us).
    const rasterBase = page.rasterBase || (legacyRasterBase(page.vecJson) ? buf : null)
    return {
      file: p.file, exists: true,
      // only shipped when it is the page image; avoid copying a flattened
      // page alongside its sRST base
      bytes: rasterBase === buf ? new Uint8Array(buf) : null,
      paperMeta: page.meta,
      inkGif: page.inkGif, // replay GIF from sINK
      vecJson: page.vecJson, // vector strokes (sVec) when present
      rasterBase: page.rasterBase ? new Uint8Array(page.rasterBase) : null,
    }
  } catch (err) {
    // Never present an unreadable page as a blank sheet that can then be
    // saved over the original: load it empty but flag it.
    console.error('note:load page failed', p.file, err)
    return { file: p.file, exists: false, loadError: true }
  }
}

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
    const res = process.env.WC_QA_LIBRARY
      ? { canceled: false, filePaths: [path.resolve(process.env.WC_QA_LIBRARY)] }
      : await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choose library folder' })
    if (res.canceled || !res.filePaths[0]) return { canceled: true }
    try {
      return { canceled: false, ...await chooseRoot(res.filePaths[0]) }
    } catch (err) {
      if (!process.env.WC_QA_LIBRARY) dialog.showErrorBox('WriteCanvas — cannot use that library folder', err.message)
      return { canceled: false, error: err.message }
    }
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
    for (const p of item.note.pages) pages.push(await loadPageEntry(p))
    const note = JSON.parse(JSON.stringify(item))
    delete note.note // pages replaced below with bytes
    return { note, pages }
  })

  ipcMain.handle('note:loadPage', async (_e, { noteId, pageIndex }) => {
    const item = lib.get(Number(noteId))
    const index = Number(pageIndex)
    const p = item && item.type === 'note' && item.note && item.note.pages ? item.note.pages[index] : null
    if (!p) return null
    return await loadPageEntry(p)
  })

  ipcMain.handle('note:duplicatePage', async (_e, { noteId, pageIndex }) => {
    const res = await lib.duplicatePage(Number(noteId), Number(pageIndex))
    pushLibrary()
    return res
  })

  ipcMain.handle('note:deletePage', async (_e, { noteId, pageIndex }) => {
    const pages = await lib.deletePage(Number(noteId), Number(pageIndex))
    pushLibrary()
    return { pages }
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
    delete meta.rasterBase
    // Read the previous page because the renderer only sends the flattened
    // composite. Its sRST base (or an untouched import) must survive the save,
    // otherwise the imported image is lost the next time the page is opened.
    let old = null
    const oldFile = item.note?.pages?.[pageIndex]?.file
    if (oldFile) {
      try {
        let oldBuf = await fs.readFile(lib.pagePath(oldFile))
        if (pngIsBroken(oldBuf)) oldBuf = repairPNG(oldBuf)
        old = readNotePage(oldBuf)
        old.buf = oldBuf
      } catch (err) {
        // A vanished old file is just the first save. Any other read/parse
        // failure (transient lock, rename in flight, damaged file) must not be
        // treated as "no base": writing now would drop the only copy of the
        // imported image. Fail and let the autosave retry with fresh state.
        if (!err || err.code !== 'ENOENT') throw err
      }
    }
    // New frames → encode a fresh sINK replay GIF. No frames → keep the old
    // replay (the incoming flattened PNG has no sINK chunk of its own).
    if (Array.isArray(payload.frames) && payload.frames.length) {
      if (payload.frames.length > 5000) throw new Error('too many replay frames')
      const gif = await encodeGif(payload.frames)
      if (gif && gif.length) meta.inkGif = Buffer.from(gif)
    } else if (old && old.inkGif) {
      meta.inkGif = old.inkGif
    }
    if (payload.vec != null) {
      const vec = String(payload.vec)
      if (vec.length > 64 * 1024 * 1024) throw new Error('vector snapshot too large')
      meta.vecJson = vec // vector strokes → sVec chunk
    }
    if (old) {
      // A page written by us already carries the clean base. Older pages
      // without an editable vector payload carry their whole flattened image
      // as the base, so keep it instead of writing a paper-only page.
      if (old.rasterBase) meta.rasterBase = old.rasterBase
      else if (legacyRasterBase(old.vecJson)) meta.rasterBase = old.buf
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
    const res = process.env.WC_QA_PDF
      ? { canceled: false, filePath: path.resolve(process.env.WC_QA_PDF) }
      : await dialog.showSaveDialog(win, { defaultPath: `export.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
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
    const wMM = Math.round(paper.widthMM * 100) / 100
    const hMM = Math.round(paper.heightMM * 100) / 100
    const wIn = Math.round((wMM / 25.4) * 100) / 100
    const hIn = Math.round((hMM / 25.4) * 100) / 100
    const htmlFile = path.join(tmp, 'pages.html')
    await fs.writeFile(htmlFile, `<!doctype html><html><head><style>
      @page { size: ${wMM}mm ${hMM}mm; margin: 0 }
      html,body{margin:0;padding:0}
      img{display:block;width:${wMM}mm;height:${hMM}mm;object-fit:contain;page-break-after:always}
      img:last-child{page-break-after:auto}
    </style></head><body>${files.map(f => `<img src="file:///${f.replace(/\\/g, '/')}">`).join('')}</body></html>`, 'utf8')
    const pdfWin = new BrowserWindow({ show: false, width: 1000, height: 900, webPreferences: { offscreen: true } })
    try {
      await pdfWin.loadFile(htmlFile)
      const buf = await pdfWin.webContents.printToPDF({
        printBackground: true,
        pageSize: { width: wIn, height: hIn },
        preferCSSPageSize: true,
        margins: { marginType: 'none' },
      })
      await fs.writeFile(res.filePath, buf)
      if (!process.env.WC_QA_PDF) shell.showItemInFolder(res.filePath)
    } finally {
      pdfWin.destroy()
      for (const f of files) { try { await fs.unlink(f) } catch { } }
      try { await fs.unlink(htmlFile) } catch { }
      try { await fs.rmdir(tmp) } catch { }
    }
    return res.filePath
  })

  // .wcanvas = one portable project file (ZIP + manifest + Scrble pages).
  // Reads pages straight from disk so the export is a snapshot of what is
  // actually saved — the renderer flushes the open page first (exportProject
  // in editor.js), so only genuinely unsaved scratch is excluded.
  // QA hooks (mirrors the debug:captureWindow precedent): when WC_QA_EXPORT /
  // WC_QA_IMPORT point at a path, the native dialogs are bypassed so CDP test
  // scripts can round-trip a full project without a human at the dialog.
  ipcMain.handle('export:project', async (_e, { noteId }) => {
    const item = lib.get(Number(noteId))
    if (!item || item.type !== 'note') throw new Error('note not found')
    if (!item.note) item.note = { pages: [{}], currentPage: 0 }
    const pages = []
    for (const [i, p] of item.note.pages.entries()) {
      const entry = { file: null, data: null, paper: p.paper ? JSON.parse(JSON.stringify(p.paper)) : null }
      if (p.file) {
        try {
          let buf = await fs.readFile(lib.pagePath(p.file))
          if (pngIsBroken(buf)) buf = repairPNG(buf) // export heals like note:load does
          // under a stable page-NN.png name, not the library's per-note file
          entry.file = `page-${String(i + 1).padStart(2, '0')}.png`
          entry.data = buf
        } catch (err) {
          // Only a genuinely absent page may become a blank manifest entry.
          // A locked/unreadable/damaged page must abort the export instead of
          // silently producing an editable copy that lost that page's ink.
          if (!err || err.code !== 'ENOENT') {
            throw new Error(`Cannot export page ${i + 1} (${p.file}): ${err.message}`)
          }
          entry.file = null
        }
      }
      pages.push(entry)
    }
    const parent = item.parent != null ? lib.get(Number(item.parent)) : null
    const { zip } = buildNoteZip({
      name: item.name,
      createdAt: item.created ? new Date(Number(item.created) || Date.now()).toISOString() : undefined,
      modifiedAt: item.modified ? new Date(Number(item.modified) || Date.now()).toISOString() : undefined,
      project: parent && parent.type === 'folder' ? parent.name : null,
      tool: item.tool,
      pages,
    })
    const res = process.env.WC_QA_EXPORT
      ? { canceled: false, filePath: path.resolve(process.env.WC_QA_EXPORT) }
      : await dialog.showSaveDialog(win, {
          defaultPath: `${sanitizeName(item.name)}.wcanvas`,
          filters: [{ name: 'WriteCanvas Project', extensions: ['wcanvas'] }],
          title: 'Export WriteCanvas project',
        })
    if (res.canceled || !res.filePath) return null
    // atomic write: temp file in the same directory, then rename over the
    // target (retry briefly — sync clients hold files open, like library.js)
    const tmp = `${res.filePath}.tmp-${process.pid}-${Date.now()}`
    try {
      await fs.writeFile(tmp, zip)
      let renamed = false
      for (let a = 0; a < 3 && !renamed; a++) {
        try {
          await fs.rename(tmp, res.filePath)
          renamed = true
        } catch { await new Promise(r => setTimeout(r, 120 * (a + 1))) }
      }
      if (!renamed) {
        await fs.copyFile(tmp, res.filePath)
        await fs.unlink(tmp)
      }
    } catch (err) {
      try { await fs.unlink(tmp) } catch { }
      throw err
    }
    if (!process.env.WC_QA_EXPORT) shell.showItemInFolder(res.filePath)
    return { path: res.filePath, pages: pages.length, bytes: zip.length }
  })

  // Open a .wcanvas project: validated zip (zip-slip guarded, exact manifest
  // pages enforced), then copied into the library as a NEW note — a project
  // file never overwrites live notes.
  ipcMain.handle('project:import', async () => {
    const res = process.env.WC_QA_IMPORT
      ? { canceled: false, filePaths: [path.resolve(process.env.WC_QA_IMPORT)] }
      : await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [{ name: 'WriteCanvas Project', extensions: ['wcanvas'] }],
          title: 'Import WriteCanvas project',
        })
    if (res.canceled || !res.filePaths[0]) return []
    const { manifest, files } = readNoteZip(await fs.readFile(res.filePaths[0]))
    const byName = new Map(files.map(f => [f.name, f.data]))
    // land in the recorded project folder when it exists in this library
    let folder = lib.get(1) ? 1 : 0
    if (manifest.project) {
      const f = lib.index.items.find(i => i.type === 'folder' &&
        String(i.name).toLowerCase() === String(manifest.project).toLowerCase())
      if (f) folder = f.id
    }
    const base = sanitizeName(manifest.name) || sanitizeName(path.basename(res.filePaths[0], path.extname(res.filePaths[0]))) || 'Imported'
    // every page file must be free: unique among sibling notes, unowned by any
    // other note, and not already on disk (same care the PNG import loop has)
    const pagesFree = name => {
      for (let i = 0; i < manifest.pages.length; i++) {
        const file = pageFileName(name, i)
        if (lib.index.items.some(n => n.type === 'note' &&
          (n.note?.pages || []).some(p => p.file && String(p.file).toLowerCase() === file.toLowerCase()))) return false
        if (fss.existsSync(lib.pagePath(file))) return false
      }
      return true
    }
    let finalName = base, probe = 1
    while (lib.siblingNameTaken(folder, 'note', finalName, 0) || !pagesFree(finalName)) finalName = `${base} ${++probe}`
    const note = lib.create('note', finalName, folder)
    const pages = []
    const written = []
    try {
      for (let i = 0; i < manifest.pages.length; i++) {
        const want = manifest.pages[i]
        const page = {}
        if (want.file) {
          const file = pageFileName(note.name, i)
          written.push(file)
          await fs.writeFile(lib.pagePath(file), byName.get(want.file))
          page.file = file
        }
        if (want.paper) page.paper = { ...want.paper }
        pages.push(page)
      }
    } catch (err) {
      // never leave a half-imported note (or its page files) behind
      lib.index.items = lib.index.items.filter(i => i !== note)
      for (const file of written) {
        try { await fs.unlink(lib.pagePath(file)) } catch { }
      }
      throw err
    }
    note.note = { pages, currentPage: 0 }
    const paper0 = manifest.pages[0] && manifest.pages[0].paper
    note.paper = paper0 ? { ...paper0 } : { size: 'letter', orientation: 'portrait', template: 'ruled', bg: '#FFFFFFFF' }
    if (manifest.tool) note.tool = { ...manifest.tool }
    await lib.persist()
    pushLibrary()
    return [note.id]
  })
}

async function chooseRoot(dir) {
  const resolved = path.resolve(dir)
  if (resolved === path.resolve(lib.root)) return { unchanged: true, root: lib.root }
  // validate the new root before replacing the working library: a bad folder
  // must leave the current library usable
  const next = new Library(resolved)
  let hasIndex = true
  try { await fs.access(next.indexFile) } catch {
    try { await fs.access(next.indexFile + '.bak') } catch { hasIndex = false }
  }
  if (!hasIndex) {
    // ensure() would create a fresh empty index here. If the folder already
    // holds Scrble note images, switching would make them disappear from the
    // library (and future saves could overwrite same-named pages).
    let pages = []
    try { pages = (await fs.readdir(next.scribbleDir)).filter(f => /\.png$/i.test(f)) } catch { }
    if (pages.length) {
      throw new Error(`That folder contains ${pages.length} note image(s) in Scribble/ but no index.json. Choose the folder that holds your WriteCanvas library, or an empty folder.`)
    }
  }
  await next.ensure()
  const cfg = await loadConfig()
  cfg.root = resolved
  await saveConfig(cfg)
  lib = next
  pushLibrary()
  return { unchanged: false, root: lib.root }
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
