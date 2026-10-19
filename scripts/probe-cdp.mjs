// One-off debugging helper: what stopped the renderer modules from loading?
//   node scripts/probe-cdp.mjs

async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const t = list.find(x => x.type === 'page')
  if (!t) throw new Error('no page target (app not running?)')
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })

  const seq = { n: 0, pend: new Map() }
  ws.onmessage = e => {
    const m = JSON.parse(e.data)
    if (m.id && seq.pend.has(m.id)) { seq.pend.get(m.id)(m); seq.pend.delete(m.id) }
    else if (m.method === 'Runtime.consoleAPICalled') console.log('[console.' + m.params.type + ']', ...m.params.args.map(a => a.value ?? a.description ?? ''))
    else if (m.method === 'Runtime.exceptionThrown') console.log('[exception]', m.params.exceptionDetails?.text, m.params.exceptionDetails?.exception?.description || '')
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq.n
    seq.pend.set(id, r => (r.error ? reject(new Error(r.error.message)) : resolve(r.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')

  console.log('title:', t.title, '| url:', t.url)
  console.log('wc host:', (await send('Runtime.evaluate', { expression: '!!window.WriteCanvasHost', returnByValue: true })).result?.value)
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { try { await import('./js/app.js'); return 'app.js ok' } catch (e) { return 'ERR ' + e.message + '\\n' + (e.stack || '').slice(0, 600) } })()`,
    returnByValue: true, awaitPromise: true,
  })
  console.log('import probe:', r.result?.value)
  console.log('scripts in DOM:', (await send('Runtime.evaluate', { expression: '[...document.querySelectorAll("script")].map(s=>s.src||s.type).join("|")', returnByValue: true })).result?.value)
  process.exit(0)
}
main().then(() => process.exit(0), err => { console.error('probe failed:', err.message); process.exit(1) })
