// Render every paper template through the real renderer (inside the running
// app, via CDP) and save the flattened canvases for measurement against the
// original asset specs.
//   npx electron . --remote-debugging-port=9222
//   node scripts/render-paper-check.mjs [outDir]
import { setTimeout as sleep } from 'node:timers/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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

function send(ws, method, params = {}) {
  const id = wsSeq++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evalJs(ws, expr, { awaitPromise = false } = {}) {
  const res = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text + ': ' + (res.exceptionDetails.exception?.description || ''))
  return res.result?.value
}

const outDir = process.argv[2] || join(process.env.LOCALAPPDATA, 'Temp', 'opencode', 'paper-renders')
mkdirSync(outDir, { recursive: true })

async function main() {
  let page = await findPage()
  for (let i = 0; !page && i < 20; i++) { await sleep(500); page = await findPage() }
  if (!page) throw new Error('WriteCanvas page not found on :9222')
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
  // the running renderer may still hold pre-reload modules — force a reload
  await send(ws, 'Page.enable')
  await send(ws, 'Page.reload')
  await sleep(1200)
  const diag = await evalJs(ws, `(async () => {
    const P = await import('./js/paper.js')
    return { keys: Object.keys(P).length, orderType: typeof P.TEMPLATE_ORDER, first: P.TEMPLATE_ORDER ? P.TEMPLATE_ORDER[0] : null, hasRender: typeof P.renderPaper }
  })()`, { awaitPromise: true })
  console.log('module diag:', JSON.stringify(diag))
  // one dataURL per evaluation: a single huge return object serializes badly
  let rendered = 0
  for (const name of ['blank', 'ruled', 'ruled10', 'ruled15', 'ruled20', 'ruled30', 'ruled40', 'dotted10', 'dotted20', 'graph', 'isometric', 'math', 'math10', 'math15', 'math20', 'math30', 'math40', 'music', 'todo', 'custom', 'ruledBrl']) {
    const url = await evalJs(ws, `(async () => {
      const P = await import('./js/paper.js')
      const { w: width, h: height } = P.paperDocSize('letter', 'portrait')
      const c = document.createElement('canvas')
      c.width = width; c.height = height
      P.renderPaper(c.getContext('2d'), { size: 'letter', orientation: 'portrait', template: ${name === 'ruledBrl' ? "'ruled'" : JSON.stringify(name)}, bg: '#FFFFFFFF', borderLines: ${name === 'ruledBrl'}})
      const blob = await new Promise(r => c.toBlob(r, 'image/png'))
      return await new Promise((res, rej) => {
        const fr = new FileReader()
        fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error(fr.error))
        fr.readAsDataURL(blob)
      })
    })()`, { awaitPromise: true })
    if (!url || !url.startsWith('data:image/png')) { console.error('bad dataURL for', name, String(url).slice(0, 60)); continue }
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'))
    rendered++
  }
  console.log('rendered', rendered, 'pages →', outDir)
  ws.close()
}

main().catch(e => { console.error(e.message); process.exit(1) })
