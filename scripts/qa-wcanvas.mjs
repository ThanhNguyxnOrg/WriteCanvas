// E2E for the .wcanvas project format over CDP:
//   (app must run with WC_QA_EXPORT + WC_QA_IMPORT pointing at the same path)
//   node scripts/qa-wcanvas.mjs
// Steps: create note -> draw -> save -> export .wcanvas -> verify the file on
// disk -> import it back as a new note -> open it -> the stroke must restore.
// Scratch notes created here are removed again before exit.

import { setTimeout as sleep } from 'node:timers/promises'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const { readNoteZip } = require_('../main/wcanvas-export.js')

const CDP = 'http://127.0.0.1:9222'
let wsSeq = 1
const pending = new Map()

async function findPage() {
  const list = await (await fetch(`${CDP}/json`)).json()
  return list.find(t => t.type === 'page' && /index\.html|WriteCanvas/i.test(t.title + t.url))
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', reject)
  })
}

function send(ws, method, params = {}, sessionId) {
  const id = wsSeq++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
  })
}

async function evalJs(ws, expr, { awaitPromise = false } = {}) {
  const res = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text + ': ' + (res.exceptionDetails.exception?.description || ''))
  return res.result?.value
}

let failures = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}

async function main() {
  const page = await findPage()
  if (!page) throw new Error('app not running on 9222')
  const ws = await connect(page.webSocketDebuggerUrl)
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    }
  })
  await evalJs(ws, '1')

  const targets = []
  const prevLast = await evalJs(ws, `localStorage.getItem('wc:lastNote')`)
  try {
    // ---- export side ----
    const note = await evalJs(ws, `WriteCanvasHost.createNote('WCProjectQA', 1)`, { awaitPromise: true })
    targets.push(note.id)
    await sleep(600)
    await evalJs(ws, `__wc.App.openNote(${note.id})`, { awaitPromise: true })
    await sleep(300)
    const geo = await evalJs(ws, `(() => { const r = document.getElementById('stackInner').getBoundingClientRect();
      return { left: r.left, top: r.top, zoom: r.width / document.getElementById('stackInner').offsetWidth } })()`)
    const Z = geo.zoom
    const px = dx => geo.left + dx * Z
    const py = dy => geo.top + dy * Z
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px(140), y: py(180), button: 'left', buttons: 1, clickCount: 1 })
    for (const [dx, dy] of [[180, 240], [260, 230], [430, 320]]) {
      await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(dx), y: py(dy), buttons: 1 })
      await sleep(12)
    }
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(430), y: py(320), button: 'left', buttons: 0, clickCount: 1 })
    await sleep(120)
    await evalJs(ws, `__wc.saveCurrentPage()`, { awaitPromise: true })

    const exportPath = process.env.WC_QA_EXPORT
    if (!exportPath) throw new Error('WC_QA_EXPORT not set')
    fs.mkdirSync(path.dirname(exportPath), { recursive: true })

    const res = await evalJs(ws, `WriteCanvasHost.exportProject(${note.id})`, { awaitPromise: true })
    check('export:project returns a result', !!res && !!res.path)
    check('export file exists on disk', res && fs.existsSync(res.path), res && String(res.path))
    const buf = fs.readFileSync(res.path)
    const { manifest, files } = readNoteZip(buf)
    check('manifest names the note', manifest.name === note.name, manifest.name)
    check('manifest has the drawn page', manifest.pages.length === 1 && manifest.pages[0].file === 'page-01.png')
    check('page png embedded with chunks', files.length === 2 && files.some(f => f.name === 'page-01.png' && f.data.subarray(0, 8).toString('latin1') === '\x89PNG\r\n\x1a\n'))

    // ---- import side ----
    const ids = await evalJs(ws, `WriteCanvasHost.importProject()`, { awaitPromise: true })
    check('project:import returns the new note id', Array.isArray(ids) && ids.length === 1 && ids[0] > note.id, JSON.stringify(ids))
    const importedId = ids[0]
    targets.push(importedId)
    const lib = await evalJs(ws, `WriteCanvasHost.library()`, { awaitPromise: true })
    const item = lib.items.find(i => i.id === importedId)
    check('imported note lands in the library', !!item, item && item.name)
    check('import keeps the note title', item && item.name.startsWith('WCProjectQA'), item && item.name)
    check('import keeps paper settings', item && item.paper && item.paper.template === 'ruled', item && JSON.stringify(item.paper))

    await evalJs(ws, `__wc.App.openNote(${importedId})`, { awaitPromise: true })
    await sleep(500)
    const state = await evalJs(ws, `JSON.stringify({
      strokes: __wc.S.pages[0].strokes.length,
      hasFile: !!__wc.S.pages[0].file,
      size: __wc.S.pages[0].paper.size,
      name: document.getElementById('btnTitle').textContent,
    })`)
    const s = JSON.parse(state)
    check('reopened note restores the stroke vector', s.strokes >= 1, `strokes=${s.strokes}`)
    check('reopened note loads its page file', s.hasFile)
    check('reopened note keeps the title', s.name.startsWith('WCProjectQA'), s.name)
    check('paper flows through the project file', s.size === 'letter', s.size)
  } finally {
    // clean scratch + restore the session's last note
    for (const id of targets) {
      await evalJs(ws, `WriteCanvasHost.destroyItem(${id})`, { awaitPromise: true }).catch(() => { })
    }
    await sleep(300)
    if (prevLast && Number(prevLast)) {
      await evalJs(ws, `localStorage.setItem('wc:lastNote', ${JSON.stringify(prevLast)})`)
    }
  }
  console.log(failures ? `QA FAILED: ${failures}` : 'QA WCANVAS OK')
  process.exit(failures ? 1 : 0)
}

main().catch(err => { console.error('QA ERROR:', err.message); process.exit(1) })
