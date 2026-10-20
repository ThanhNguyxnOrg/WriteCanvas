// Live instrument: Runtime.enable + collect page console/errors while doing a
// controlled tool-switch then a single real-input stroke. Prints everything.
import { setTimeout as sleep } from 'node:timers/promises'

const CDP = 'http://127.0.0.1:9222'
let wsSeq = 1
const pending = new Map()
const events = []

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

const list = await (await fetch(`${CDP}/json`)).json()
const page = list.find(t => t.type === 'page' && /index\.html|WriteCanvas/i.test(t.title + t.url))
if (!page) throw new Error('app not found')
const ws = await connect(page.webSocketDebuggerUrl)
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    events.push('PAGE-EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 300))
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    if (msg.params.type === 'error' || msg.params.type === 'warning') {
      events.push('CONSOLE-' + msg.params.type + ': ' + (msg.params.args?.map(a => a.value ?? a.description).join(' ').slice(0, 300) || ''))
    }
  }
})

await send(ws, 'Runtime.enable')
await send(ws, 'Log.enable')

// baseline
console.log('tool:', await evalJs(ws, `__wc.S.tool`))
console.log('flyoutOpenTool:', await evalJs(ws, `__wc.S.flyoutOpenTool`))
console.log('geo now:', await evalJs(ws, `JSON.stringify((() => {
  const inner = document.getElementById('stackInner')
  const r = inner.getBoundingClientRect()
  return { left: Math.round(r.left), top: Math.round(r.top), zoom: Math.round(r.width / inner.offsetWidth * 1000) / 1000, w: inner.offsetWidth, h: inner.offsetHeight }
})())`))

// switch to laser via slot click + real events
await evalJs(ws, `document.getElementById('tbPens').firstElementChild.click()`)
await sleep(120)
console.log('after slot click, flyout open?', await evalJs(ws, `__wc.S.flyoutOpenTool`))
await evalJs(ws, `document.getElementById('tbLaser').click()`)
await sleep(120)
console.log('tool after tbLaser click:', await evalJs(ws, `__wc.S.tool`))

const geo = JSON.parse(await evalJs(ws, `JSON.stringify({ left: document.getElementById('stackInner').getBoundingClientRect().left, top: document.getElementById('stackInner').getBoundingClientRect().top, zoom: document.getElementById('stackInner').getBoundingClientRect().width / document.getElementById('stackInner').offsetWidth })`))
const px = d => geo.left + d * geo.zoom
const py = d => geo.top + d * geo.zoom
// one short sweep in doc space
for (const p of [[4200, 1400], [5200, 1500]]) { /* far off-page guard replaced below */ }
const pts = [[420, 1500], [600, 1560], [800, 1500]]
await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(pts[0][0]), y: py(pts[0][1]), button: 'none' })
await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px(pts[0][0]), y: py(pts[0][1]), button: 'left', buttons: 1, clickCount: 1 })
for (const [dx, dy] of pts.slice(1)) {
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(dx), y: py(dy), buttons: 1 })
  await sleep(25)
}
await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(pts.at(-1)[0]), y: py(pts.at(-1)[1]), button: 'left', buttons: 0, clickCount: 1 })
await sleep(250)

console.log('laser paint share:', await evalJs(ws, `(() => {
  const c = document.getElementById('laserC')
  if (!c) return 'no-canvas'
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let hit = 0, tot = 0
  for (let i = 0; i < d.length; i += 4 * 997) { tot++; if (d[i] + d[i + 1] + d[i + 2] > 18) hit++ }
  return tot ? hit / tot : 'empty-size'
})()`))
console.log('strokes:', await evalJs(ws, `__wc.S.pages[0].strokes.length`))
console.log('--- captured page events ---')
for (const e of events.slice(0, 12)) console.log(e)
process.exit(events.length ? 0 : 0)
