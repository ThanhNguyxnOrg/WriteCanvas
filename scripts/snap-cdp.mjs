// Capture the WriteCanvas window contents for visual parity checks.
// Goes through webContents.capturePage via a debug IPC — CDP
// captureScreenshot stalls on this GPU-less Electron compositor.
//   node scripts/snap-cdp.mjs <out.png> [clickTargetId]
import fs from 'node:fs'

const out = process.argv[2] || 'ui-snap.png'
const clickId = process.argv[3]
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

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const t = list.find(x => x.type === 'page')
if (!t) throw new Error('no page target — app not running?')
const ws = await connect(t.webSocketDebuggerUrl)
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
  }
})

const evalJs = (expr, { awaitPromise = false } = {}) =>
  send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
    .then(r => {
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ': ' + (r.exceptionDetails.exception?.description || ''))
      return r.result?.value
    })

// the window caches CSS/HTML between tool runs — reload so the shot reflects
// the current files (state resets; fine for QA shots). Reload happens BEFORE
// the click so the clicked state survives into the capture.
await send(ws, 'Page.enable')
await send(ws, 'Page.reload', { ignoreCache: true })
await new Promise(r => setTimeout(r, 1500))

if (clickId) {
  // "slot:N" clicks a pen-stack slot (dynamically created, no id);
  // "sel:<css>" clicks any element; "js:<expr>" runs arbitrary setup JS
  const m = /^slot:(\d+)$/.exec(clickId)
  const expr = m
    ? `document.getElementById('tbPens').children[${m[1]}]?.click()`
    : clickId.startsWith('js:')
      ? clickId.slice(3)
      : clickId.startsWith('sel:')
        ? `document.querySelector(${JSON.stringify(clickId.slice(4))})?.click()`
        : `document.getElementById(${JSON.stringify(clickId)})?.click()`
  await evalJs(expr)
  await new Promise(r => setTimeout(r, 300))
}

const url = await evalJs(`(async () => {
  const bytes = await window.WriteCanvasHost.captureWindow()
  await new Promise(r => setTimeout(r, 30))
  const bytes2 = bytes && bytes.byteLength ? bytes : await window.WriteCanvasHost.captureWindow()
  let bin = ''
  const u8 = new Uint8Array(bytes2)
  for (let i = 0; i < u8.length; i += 32768) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 32768))
  return 'data:image/png;base64,' + btoa(bin)
})()`, { awaitPromise: true })
if (!url || !url.startsWith('data:image/png')) throw new Error('capture failed: ' + String(url).slice(0, 80))
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'))
console.log('saved', out, fs.statSync(out).size, 'bytes')
ws.close()
process.exit(0)
