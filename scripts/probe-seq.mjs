// Full failing-sequence tracer: slot click -> laser click -> real sweep.
// Prints pointer trace, flyout state, and whether the laser branch runs.
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
    events.push('PAGE-EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).slice(0, 400))
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    if (msg.params.type === 'error') {
      events.push('CONSOLE-error: ' + (msg.params.args?.map(a => a.value ?? a.description).join(' ').slice(0, 300) || ''))
    }
  }
})

await send(ws, 'Runtime.enable')
await evalJs(ws, `(() => {
  window.__trace = []
  document.getElementById('stackInner').addEventListener('pointerdown', e => window.__trace.push(['down-stack', e.target.id || e.target.tagName, e.isTrusted]), true)
  document.getElementById('stackInner').addEventListener('pointermove', e => { if (window.__trace.filter(t => t[0] === 'move-stack').length < 6) window.__trace.push(['move-stack', e.target.id || e.target.tagName]) }, true)
})()`)

console.log('step0 tool:', await evalJs(ws, `__wc.S.tool`), '| flyout:', await evalJs(ws, `__wc.S.flyoutOpenTool`))
await evalJs(ws, `document.getElementById('tbPens').firstElementChild.click()`)
await sleep(100)
console.log('step1 slot click -> flyout:', await evalJs(ws, `__wc.S.flyoutOpenTool`), '| penFlyout hidden:', await evalJs(ws, `document.getElementById('penFlyout').classList.contains('hidden')`))
await evalJs(ws, `document.getElementById('tbLaser').click()`)
await sleep(100)
console.log('step2 tbLaser -> tool:', await evalJs(ws, `__wc.S.tool`), '| flyout:', await evalJs(ws, `__wc.S.flyoutOpenTool`), '| penFlyout hidden:', await evalJs(ws, `document.getElementById('penFlyout').classList.contains('hidden')`))

const geo = JSON.parse(await evalJs(ws, `JSON.stringify({ left: document.getElementById('stackInner').getBoundingClientRect().left, top: document.getElementById('stackInner').getBoundingClientRect().top, zoom: document.getElementById('stackInner').getBoundingClientRect().width / document.getElementById('stackInner').offsetWidth })`))
const px = d => geo.left + d * geo.zoom
const py = d => geo.top + d * geo.zoom
const pts = [[400, 1300], [700, 1380], [1000, 1300]]
await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(pts[0][0]), y: py(pts[0][1]), button: 'none' })
await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px(pts[0][0]), y: py(pts[0][1]), button: 'left', buttons: 1, clickCount: 1 })
for (const [dx, dy] of pts.slice(1)) {
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(dx), y: py(dy), buttons: 1 })
  await sleep(25)
}
await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(pts.at(-1)[0]), y: py(pts.at(-1)[1]), button: 'left', buttons: 0, clickCount: 1 })
await sleep(200)

console.log('trace:', await evalJs(ws, `JSON.stringify(window.__trace)`))
console.log('laserLive/trail state:', await evalJs(ws, `(() => {
  const c = document.getElementById('laserC')
  const d = c ? c.getContext('2d').getImageData(0, 0, c.width, c.height).data : null
  let hit = 0, tot = 0
  if (d) for (let i = 0; i < d.length; i += 4 * 997) { tot++; if (d[i] + d[i + 1] + d[i + 2] > 18) hit++ }
  return JSON.stringify({ paint: tot ? hit / tot : 'nosize', strokes: __wc.S.pages[0].strokes.length, flyout: __wc.S.flyoutOpenTool })
})()`))
console.log('--- page events ---')
for (const e of events.slice(0, 10)) console.log(e)
