// Stroke each pen type through the real engine (inside the running app, via
// CDP) and save the render outputs for eyeballing + alpha measurements.
// Checks, per type: single-composite alpha (no self-overlap darkening) and
// that the flatten path (drawStrokeAlpha) matches the live path math.
//   npx electron . --remote-debugging-port=9222
//   node scripts/pen-engine-check.mjs [outDir]
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

const outDir = process.argv[2] || join(process.env.LOCALAPPDATA, 'Temp', 'opencode', 'pen-renders')
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
  await send(ws, 'Page.enable')
  await send(ws, 'Page.reload')
  await sleep(1200)

  for (const type of ['marker', 'pencil', 'calligraphy', 'highlighter', 'highlighterSquared']) {
    const url = await evalJs(ws, `(async () => {
      const type = ${JSON.stringify(type)}
      const P = await import('./js/pen.js')
      const w = 480, h = 300
      const pts = []
      for (let x = 20; x <= 460; x += 3) {
        const t = (x - 20) / 440
        pts.push({ x, y: 150 + Math.sin(t * Math.PI * 3) * 95 * Math.sin(t * Math.PI), p: 0.85 })
      }
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      P.drawStrokeAlpha(c.getContext('2d'), w, h, { type, color: '#FF0000', width: 12, opacity: undefined, pts })
      const blob = await new Promise(r => c.toBlob(r, 'image/png'))
      const fr = new FileReader()
      const url = await new Promise((res, rej) => { fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error(fr.error)); fr.readAsDataURL(blob) })
      return { url, stats: (() => {
        const g = c.getContext('2d')
        // probe columns: blue-channel min down each column tells ink presence
        const probe = []
        for (const x of [60, 150, 230, 330, 420]) {
          const col = g.getImageData(x, 0, 1, h).data
          let min = 255
          for (let y = 0; y < h * 4; y += 4 * 2) min = Math.min(min, col[y])
          probe.push(min)
        }
        // full-red run length on the mid row (255,0,0 bands → ink coverage)
        const row = g.getImageData(0, Math.round(h * 0.62), w, 1).data
        let run = 0, best = 0
        for (let i = 0; i < w * 4; i += 4) {
          if (row[i] === 255) { run++; if (run > best) best = run } else run = 0
        }
        // alpha histogram (stride 3×3): stacking would MULTIPLY alphas — for
        // highlighter (a=0.3) the core must stay at 77, never 130/141
        const img = g.getImageData(0, 0, w, h).data
        const hist = {}
        for (let y = 0; y < h; y += 3) {
          for (let x = 0; x < w; x += 3) {
            const a = img[(y * w + x) * 4 + 3]
            if (a > 0) hist[a] = (hist[a] || 0) + 1
          }
        }
        let maxA = 0, modeA = 0, modeN = 0
        for (const k of Object.keys(hist)) { const v = +k; if (v > maxA) maxA = v; if (hist[k] > modeN) { modeN = hist[k]; modeA = v } }
        return { probe, best, maxA, modeA, modeN }
      })() }
    })()`, { awaitPromise: true })
    if (!url || !url.url || !url.url.startsWith('data:image/png')) { console.error('bad render for', type); continue }
    writeFileSync(join(outDir, `${type}.png`), Buffer.from(url.url.split(',')[1], 'base64'))
    const s = url.stats
    console.log(type, JSON.stringify({ coreAlpha: s.modeA, maxAlpha: s.maxA, alphaModes: s.modeN, maxRun: s.best, probeMins: s.probe }))
  }
  ws.close()
}

main().catch(e => { console.error(e.message); process.exit(1) })
