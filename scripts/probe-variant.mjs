// Variant deconfound: laser w/o flyout, pen w/ flyout, etc. One run prints all.
import { setTimeout as sleep } from 'node:timers/promises'

const CDP = 'http://127.0.0.1:9222'
let wsSeq = 1
const pending = new Map()

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', reject)
  })
}

function send(ws, method, params = {}) {
  const id = wsSeq++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evalJs(ws, expr) {
  const res = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true })
  if (res.exceptionDetails) throw new Error((res.exceptionDetails.exception?.description) || res.exceptionDetails.text)
  return res.result?.value
}

async function sweep(ws, geo, pts) {
  const px = d => geo.left + d[0] * geo.zoom
  const py = d => geo.top + d[1] * geo.zoom
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(pts[0]), y: py(pts[0]), button: 'none' })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px(pts[0]), y: py(pts[0]), button: 'left', buttons: 1, clickCount: 1 })
  for (const p of pts.slice(1)) {
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(p), y: py(p), buttons: 1 })
    await sleep(25)
  }
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(pts.at(-1)), y: py(pts.at(-1)), button: 'left', buttons: 0, clickCount: 1 })
  await sleep(220)
}

const SWEEP = [[400, 1300], [700, 1380], [1000, 1300]]

const list = await (await fetch(`${CDP}/json`)).json()
const page = list.find(t => t.type === 'page' && /index\.html|WriteCanvas/i.test(t.title + t.url))
const ws = await connect(page.webSocketDebuggerUrl)
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
  }
})

const geo = JSON.parse(await evalJs(ws, `JSON.stringify({ left: document.getElementById('stackInner').getBoundingClientRect().left, top: document.getElementById('stackInner').getBoundingClientRect().top, zoom: document.getElementById('stackInner').getBoundingClientRect().width / document.getElementById('stackInner').offsetWidth })`))
const laserPaint = () => evalJs(ws, `(() => { const c = document.getElementById('laserC'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0, t = 0; for (let i = 0; i < d.length; i += 4 * 997) { t++; if (d[i] + d[i + 1] + d[i + 2] > 18) h++ } return h / t })()`)
const strokes = () => evalJs(ws, `__wc.S.pages[0].strokes.length`)
const backToPen = () => evalJs(ws, `(() => { __wc.App && document.querySelector('#tbPens .ps') && document.getElementById('tbPens').firstElementChild.click(); __wc.S.tool = 'pen'; return true })()`)

// baseline visibility state
console.log('win visibility:', await evalJs(ws, `({ hidden: document.hidden, vis: document.visibilityState })`))

console.log('V1 laser only (no flyout):')
await evalJs(ws, `document.getElementById('tbLaser').click()`)
await sleep(80)
console.log('  tool:', await evalJs(ws, `__wc.S.tool`))
await sweep(ws, geo, SWEEP)
console.log('  paint:', await laserPaint(), 'strokes:', await strokes())
await sleep(1700)

// restore pen tool directly (no slot)
await evalJs(ws, `(() => { __wc.S.tool = 'pen'; document.querySelectorAll('[aria-pressed="true"]').forEach(b => b.classList && b.classList.contains('tb-toggles') && b.classList.remove('active')); return true })()`)
console.log('V2 pen, flyout open (slot click, paint branch pen):')
await evalJs(ws, `document.getElementById('tbPens').firstElementChild.click()`)
await sleep(100)
console.log('  flyout:', await evalJs(ws, `__wc.S.flyoutOpenTool`))
const st0 = await strokes()
await sweep(ws, geo, SWEEP)
console.log('  strokes delta:', (await strokes()) - st0)
await evalJs(ws, `__wc.S.tool = 'pen'`)

console.log('V3 laser after Escape (flyout closed):')
await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(60)
await evalJs(ws, `document.getElementById('tbLaser').click()`)
await sleep(80)
await sweep(ws, geo, SWEEP)
console.log('  paint:', await laserPaint(), 'strokes:', await strokes())
await sleep(1700)

console.log('V4 pen no-flyout sanity:')
await backToPen()
const st1 = await strokes()
await sweep(ws, geo, SWEEP)
console.log('  strokes delta:', (await strokes()) - st1)
