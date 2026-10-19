// Smoke test over Chrome DevTools Protocol (no deps; Node 22+ built-ins).
// Launches against an already-running instance:
//   npx electron . --remote-debugging-port=9222
//   node scripts/smoke-cdp.mjs
// Steps: locate app page -> create note -> open it -> draw 2 strokes through
// real input events -> save -> report status. Chunk verification happens in
// scripts/verify-note.js afterwards.

import { setTimeout as sleep } from 'node:timers/promises'

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
  const res = await send(ws, 'Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise,
  })
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text + ': ' + (res.exceptionDetails.exception?.description || ''))
  return res.result?.value
}

async function main() {
  const page = await findPage()
  if (!page) throw new Error('WriteCanvas page not found — is the app running with --remote-debugging-port=9222?')
  const ws = await connect(page.webSocketDebuggerUrl)
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    }
  })

  console.log('page:', page.title)
  await evalJs(ws, '1')
  console.log('bridge present:', await evalJs(ws, '!!window.WriteCanvasHost'))

  // create + open a note
  const note = await evalJs(ws, `WriteCanvasHost.createNote('SmokeTest', 1)`, { awaitPromise: true })
  console.log('note id:', note?.id)
  await sleep(600) // index push -> tree render
  await evalJs(ws, `__wc.App.openNote(${note.id})`, { awaitPromise: true })
  await sleep(300)

  // canvas geometry for dispatching mouse input
  const geo = await evalJs(ws, `(() => {
    const inner = document.getElementById('stackInner')
    const r = inner.getBoundingClientRect()
    return { left: r.left, top: r.top, zoom: r.width / inner.offsetWidth }
  })()`)
  console.log('canvas geo:', JSON.stringify(geo))
  if (!geo || !geo.zoom) throw new Error('canvas stack not rendered — editor failed to initialize')

  const Z = geo.zoom
  const px = dx => geo.left + dx * Z
  const py = dy => geo.top + dy * Z

  // draw two strokes (real input -> pointer events with pressure 0)
  const strokes = [
    [[120, 200], [180, 260], [260, 230], [420, 300]],
    [[150, 420], [260, 460], [380, 410], [520, 470]],
  ]
  for (const pts of strokes) {
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(pts[0][0]), y: py(pts[0][1]), button: 'none' })
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px(pts[0][0]), y: py(pts[0][1]), button: 'left', buttons: 1, clickCount: 1 })
    for (const [dx, dy] of pts.slice(1)) {
      await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(dx), y: py(dy), buttons: 1 })
      await sleep(12)
    }
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(pts.at(-1)[0]), y: py(pts.at(-1)[1]), button: 'left', buttons: 0, clickCount: 1 })
    await sleep(80)
  }

  const strokeCount = await evalJs(ws, `__wc.S.pages[0].strokes.length`)
  console.log('strokes committed:', strokeCount)
  if (strokeCount !== 2) throw new Error('expected 2 strokes, got ' + strokeCount)

  // explicit save and wait for completion
  await evalJs(ws, `__wc.saveCurrentPage()`, { awaitPromise: true })
  await sleep(200)
  const state = await evalJs(ws, `JSON.stringify({file: __wc.S.pages[0].file, dirty: __wc.S.pages[0].dirty, frames: __wc.S.pages[0].recorder.frames.length})`)
  console.log('save state:', state)
  const parsed = JSON.parse(state)
  if (!parsed.file) throw new Error('page file was not written')
  if (parsed.dirty) throw new Error('page still marked dirty after save')
  if (parsed.frames < 3) throw new Error('expected replay frames >= 3 (pre + 2 strokes), got ' + parsed.frames)

  // zoom sanity via the same path the wheel uses
  await evalJs(ws, `__wc.App.cmdZoom({ dir: 1 })`)
  console.log('SMOKE OK')
}

main().then(
  () => process.exit(0),
  err => { console.error('SMOKE FAILED:', err.message); process.exit(1) },
)
