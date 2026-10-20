// Mini ruler-focus probe: snap draw + grip drag with counters.
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

async function sweep(ws, geo, pts, { moveDelay = 25, upDelay = 250 } = {}) {
  const px = d => geo.left + d[0] * geo.zoom
  const py = d => geo.top + d[1] * geo.zoom
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(pts[0]), y: py(pts[0]), button: 'none' })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px(pts[0]), y: py(pts[0]), button: 'left', buttons: 1, clickCount: 1 })
  for (const p of pts.slice(1)) {
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(p), y: py(p), buttons: 1 })
    await sleep(moveDelay)
  }
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(pts.at(-1)), y: py(pts.at(-1)), button: 'left', buttons: 0, clickCount: 1 })
  await sleep(upDelay)
}

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

// ensure note loaded and tool pen
await evalJs(ws, `(() => { __wc.S.tool = 'pen'; return __wc.S.tool })()`)
const geo = JSON.parse(await evalJs(ws, `JSON.stringify({ left: document.getElementById('stackInner').getBoundingClientRect().left, top: document.getElementById('stackInner').getBoundingClientRect().top, zoom: document.getElementById('stackInner').getBoundingClientRect().width / document.getElementById('stackInner').offsetWidth, w: document.getElementById('stackInner').offsetWidth, h: document.getElementById('stackInner').offsetHeight })`))
console.log('geo:', JSON.stringify(geo))
const PY = geo.h * 0.55
console.log('PY doc:', PY, '-> screen', geo.top + PY * geo.zoom)

await evalJs(ws, `document.getElementById('tbRuler').click()`)
await sleep(120)
console.log('rulerOn:', await evalJs(ws, `__wc.S.rulerOn`))

// snapped draw through ±60 px wiggles
await sweep(ws, geo, [[500, PY - 60], [700, PY + 55], [900, PY - 50], [1100, PY + 60], [1300, PY - 45]])
console.log('QA:', JSON.stringify(await evalJs(ws, `window.__qa`)))
console.log('strokes:', await evalJs(ws, `__wc.S.pages[0].strokes.length`))
const stats = await evalJs(ws, `(() => { const s = __wc.S.pages[0].strokes[__wc.S.pages[0].strokes.length - 1]; return JSON.stringify({ n: s.pts.length, ys: s.pts.map(p => Math.round(p.y)) }) })()`)
console.log('last stroke:', stats)

// rotate via ctl
await evalJs(ws, `document.getElementById('rulCW').click()`)
await sleep(80)

// grip drag
const grip = { x: geo.left + 0.5 * geo.w * geo.zoom, y: geo.top + 0.55 * geo.h * geo.zoom }
console.log('grip screen:', grip.x, grip.y)
await sweep(ws, geo, [[(grip.x - geo.left) / geo.zoom, (grip.y - geo.top) / geo.zoom], [(grip.x - geo.left) / geo.zoom + 30, (grip.y - geo.top) / geo.zoom + 60], [(grip.x - geo.left) / geo.zoom + 60, (grip.y - geo.top) / geo.zoom + 120]])
console.log('QA:', JSON.stringify(await evalJs(ws, `window.__qa`)))
console.log('ctl top:', await evalJs(ws, `document.getElementById('rulerCtl').style.top`), 'left:', await evalJs(ws, `document.getElementById('rulerCtl').style.left`))
console.log('strokes now:', await evalJs(ws, `__wc.S.pages[0].strokes.length`))
