// Captures the Microsoft Store screenshots from a running instance.
//
// The listing must not show personal notes, so this runs against a throwaway
// library with a demo page and draws a few deliberate strokes into it. The app
// has to be running with the DevTools protocol open:
//
//   npx electron . --user-data-dir=<temp profile> --remote-debugging-port=9444
//   node scripts/store-shots.mjs
//
// Output: store/screenshot-*.png at 1920x1080 (the Store requires at least
// 1366x768 for desktop screenshots).
import fs from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.WC_SHOT_PORT || 9444)
const OUT = path.resolve('store')
const WIDTH = 1920
const HEIGHT = 1080
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

let seq = 1
const pending = new Map()

async function connect() {
  let targets = []
  for (let i = 0; i < 120; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      if (targets.some(t => t.type === 'page' && /index\.html/.test(t.url))) break
    } catch { /* not up yet */ }
    await wait(250)
  }
  const page = targets.find(t => t.type === 'page' && /index\.html/.test(t.url))
  if (!page) throw new Error('no app window on the DevTools port')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result)
  })
  return ws
}

function send(ws, method, params = {}) {
  const id = seq++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(ws, expression) {
  const result = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result?.value
}

async function waitFor(ws, expression, label, tries = 80) {
  for (let i = 0; i < tries; i++) {
    if (await evaluate(ws, expression)) return
    await wait(250)
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function shot(ws, file) {
  const started = Date.now()
  const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(OUT, file), Buffer.from(data, 'base64'))
  console.log(`${file}  ${Date.now() - started}ms`)
}

// Draws a smooth path through the given points with real pointer events, so the
// ink is produced by the same engine a pen would use.
const DRAW = points => `(() => {
  const inner = document.getElementById('stackInner')
  const opts = (x, y, buttons) => ({
    bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
    pointerId: 7, pointerType: 'pen', isPrimary: true, pressure: 0.5, buttons,
  })
  const pts = ${JSON.stringify(points)}
  inner.dispatchEvent(new PointerEvent('pointerdown', opts(pts[0][0], pts[0][1], 1)))
  for (const [x, y] of pts.slice(1)) inner.dispatchEvent(new PointerEvent('pointermove', opts(x, y, 1)))
  const last = pts[pts.length - 1]
  inner.dispatchEvent(new PointerEvent('pointerup', opts(last[0], last[1], 0)))
  return true
})()`

const wave = (x0, x1, y, amp, n = 60) =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    return [x0 + (x1 - x0) * t, y + Math.sin(t * Math.PI * 3) * amp * (1 - t * 0.3)]
  })

const line = (x0, y0, x1, y1, n = 14) =>
  Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n])

const box = (x0, y0, x1, y1) => [
  ...line(x0, y0, x1, y0),
  ...line(x1, y0, x1, y1).slice(1),
  ...line(x1, y1, x0, y1).slice(1),
  ...line(x0, y1, x0, y0).slice(1),
]

const check = (cx, cy, s) => [
  [cx - s * 0.6, cy],
  [cx - s * 0.1, cy + s * 0.5],
  [cx + s * 0.7, cy - s * 0.6],
]

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const ws = await connect()
  await waitFor(ws, `!!document.getElementById('stackInner') && window.__wc && window.__wc.S.pages.length > 0`, 'the editor')

  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
  })
  await wait(600)

  // A demo note with a name, not "Untitled".
  await evaluate(ws, `document.getElementById('btnTitle').click()`)
  await waitFor(ws, `!document.getElementById('dlg').classList.contains('hidden')`, 'the rename dialog')
  await evaluate(ws, `(() => {
    const input = document.getElementById('dlgInput')
    input.value = 'Field Notes'
    document.getElementById('dlgOk').click()
    return true
  })()`)
  await wait(500)

  // A blank demo page, framed inside the sheet.
  const rect = await evaluate(ws, `(() => {
    const r = document.getElementById('stackInner').getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })()`)
  const X = fx => Math.round(rect.x + rect.w * fx)
  const Y = fy => Math.round(rect.y + rect.h * fy)

  // A deliberate diagram instead of scribbles: two boxes, a check and an arrow.
  await evaluate(ws, DRAW(box(X(0.16), Y(0.24), X(0.36), Y(0.34))))
  await evaluate(ws, DRAW(check(X(0.26), Y(0.29), Math.round(rect.w * 0.018))))
  await evaluate(ws, DRAW(line(X(0.365), Y(0.29), X(0.445), Y(0.29))))
  await evaluate(ws, DRAW(line(X(0.445), Y(0.29), X(0.425), Y(0.272))))
  await evaluate(ws, DRAW(line(X(0.445), Y(0.29), X(0.425), Y(0.308))))
  await evaluate(ws, DRAW(box(X(0.45), Y(0.245), X(0.66), Y(0.355))))
  await evaluate(ws, DRAW(wave(X(0.45), X(0.66), Y(0.41), 3, 30)))
  await wait(700)

  await shot(ws, 'screenshot-1-ink.png')

  // Pen palette.
  await evaluate(ws, `document.getElementById('tbPenCurrent').click()`)
  await waitFor(ws, `!document.getElementById('penFlyout').classList.contains('hidden')`, 'the pen flyout')
  await wait(400)
  await shot(ws, 'screenshot-2-pen.png')
  await evaluate(ws, `document.getElementById('penClose').click()`)
  await wait(300)

  // Board colour, with the per-page / all-pages choice visible.
  await evaluate(ws, `document.getElementById('btnPaper').click()`)
  await wait(400)
  await evaluate(ws, `document.getElementById('ppBgColor').click()`)
  await waitFor(ws, `!document.getElementById('paperColorFlyout').classList.contains('hidden')`, 'the board colour flyout')
  await wait(500)
  await shot(ws, 'screenshot-3-board.png')
  await evaluate(ws, `document.getElementById('paperColorClose').click()`)
  await wait(300)

  // Close the board colour flyout and the paper panel before the next shot.
  await evaluate(ws, `document.getElementById('paperColorClose').click()`)
  await wait(250)
  await evaluate(ws, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait(350)

  // Three pages with something on each, then back to the first so the sheet and
  // the thumbnails both show content.
  await evaluate(ws, `document.getElementById('btnAddPage').click()`)
  await wait(700)
  await evaluate(ws, DRAW(box(X(0.20), Y(0.28), X(0.40), Y(0.38))))
  await evaluate(ws, DRAW(check(X(0.30), Y(0.33), Math.round(rect.w * 0.018))))
  await wait(400)
  await evaluate(ws, `document.getElementById('btnAddPage').click()`)
  await wait(700)
  await evaluate(ws, DRAW(check(X(0.28), Y(0.32), Math.round(rect.w * 0.018))))
  await evaluate(ws, DRAW(wave(X(0.34), X(0.62), Y(0.32), 3, 24)))
  await wait(600)
  await evaluate(ws, `document.querySelector('#pagesBar > *').click()`)
  await wait(800)
  await shot(ws, 'screenshot-4-pages.png')

  // Shortcut sheet, which renders only this platform's chords.
  await evaluate(ws, `window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`)
  await waitFor(ws, `!document.getElementById('shortcutSheet').classList.contains('hidden')`, 'the shortcut sheet')
  await wait(400)
  await shot(ws, 'screenshot-5-shortcuts.png')

  await send(ws, 'Emulation.clearDeviceMetricsOverride')
  ws.close()
  console.log('done')
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
