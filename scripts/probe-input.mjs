// quick probe: does CDP accept negative coords, and where is the page now?
const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find(t => t.type === 'page' && /index/.test(t.url))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => ws.onopen = r)
let id = 0
const send = (method, params) => new Promise((res, rej) => {
  const i = ++id
  const h = ev => { const m = JSON.parse(ev.data); if (m.id === i) { ws.removeEventListener('message', h); m.error ? rej(new Error(m.error.message)) : res(m.result) } }
  ws.addEventListener('message', h)
  ws.send(JSON.stringify({ id: i, method, params }))
})
for (const y of [-50, 0, 50]) {
  try { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y, button: 'none' }); console.log('y=' + y, 'OK') }
  catch (e) { console.log('y=' + y, 'ERR', e.message) }
}
const r = await send('Runtime.evaluate', {
  expression: '(() => { const i = document.getElementById("stackInner"); const r = i.getBoundingClientRect(); const h = document.getElementById("canvasHost"); return { top: r.top, left: r.left, zoom: r.width / i.offsetWidth, scrollTop: h.scrollTop, note: __wc.S.noteId, pages: __wc.S.pages.length, cur: __wc.S.currentPage } })()',
  returnByValue: true,
})
console.log(r.result.value)
ws.close()
process.exit(0)
