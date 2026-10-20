// Full real-input UI audit of the editor (CDP 9222, app must be running).
// Every control is clicked with real mouse events (hit-testing included), and
// both the resulting state and uncaught exceptions are checked.
//   node scripts/audit-ui.mjs
import { setTimeout as sleep } from 'node:timers/promises'

let wsSeq = 1
const pending = new Map()
const failures = []
const pass = n => console.log('PASS', n)
const fail = (n, info) => { failures.push(`${n}: ${info}`); console.log('FAIL', n, ':', info) }
const ok = (n, cond, info = '') => cond ? pass(n) : fail(n, info || 'expected true')

const connect = wsUrl => new Promise((res, rej) => { const w = new WebSocket(wsUrl); w.addEventListener('open', () => res(w)); w.addEventListener('error', rej) })
const send = (ws, method, params = {}) => { const id = wsSeq++; return new Promise((res, rej) => { pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) }) }
const evalJs = async (ws, expr, opts = {}) => {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!opts.awaitPromise })
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)
  return r.result?.value
}

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find(t => t.type === 'page' && /index\.html|WriteCanvas/i.test(t.title + t.url))
if (!page) { console.error('app page not found'); process.exit(1) }
const ws = await connect(page.webSocketDebuggerUrl)
const jsErrors = []
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params && m.params.exceptionDetails
    jsErrors.push((d && (d.exception?.description || d.text)) || 'unknown')
  }
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result) }
})
await send(ws, 'Runtime.enable')

const center = sel => evalJs(ws, `(() => { const el = ${sel}; if (!el) return null; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) } })()`)
async function realClick(sel) {
  const c = await center(sel)
  if (!c) throw new Error('click target missing/zero: ' + sel)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none' })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(90)
}
const state = expr => evalJs(ws, expr)
async function waitFor(expr, ms = 2600) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await state(expr)) return true
    await sleep(120)
  }
  return false
}

const openId = await state(`__wc.S.noteId`)
// clear leftovers from earlier crashed runs (same scratch name)
await evalJs(ws, `(async () => { const lib = await WriteCanvasHost.library(); const ids = (lib.items || []).filter(i => i.name === 'ZZAudit').map(i => i.id); for (const id of ids) await WriteCanvasHost.destroyItem(id); return ids })()`, { awaitPromise: true })
const note = await evalJs(ws, `WriteCanvasHost.createNote('ZZAudit', 1)`, { awaitPromise: true })
await sleep(400)
await evalJs(ws, `__wc.App.openNote(${note.id})`, { awaitPromise: true })
await sleep(400)
await evalJs(ws, `(() => { const h = document.getElementById('canvasHost'); h.scrollTop = 0; h.scrollLeft = 0; return true })()`)
const geo = await evalJs(ws, `(() => { const i = document.getElementById('stackInner'); const r = i.getBoundingClientRect(); return { left: r.left, top: r.top, zoom: r.width / i.offsetWidth } })()`)
const strokesOf = () => state(`__wc.S.pages[__wc.S.currentPage].strokes.length`) || 0

// ---------- 0. toolbar markup hygiene ----------
const hygiene = await evalJs(ws, `(() => {
  const btns = [...document.querySelectorAll('#topbar button')]
  const issues = []
  for (const b of btns) {
    const label = b.getAttribute('aria-label') || b.textContent.trim()
    if (!label) issues.push('no label: ' + (b.id || b.className))
    if (!b.getAttribute('title') && !b.getAttribute('aria-label')) issues.push('no title: ' + (b.id || b.className))
    const r = b.getBoundingClientRect()
    if (r.width < 24 || r.height < 24) issues.push('small target: ' + (b.id || b.className) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
  }
  const bar = document.getElementById('topbar')
  const overflow = bar.scrollWidth > bar.clientWidth + 1
  const clipped = [...bar.querySelectorAll('button')].some(b => { const r = b.getBoundingClientRect(); return r.right > bar.getBoundingClientRect().right + 1 })
  return { count: btns.length, issues, overflow, clipped, live: document.getElementById('saveState').getAttribute('aria-live') }
})()`)
ok('toolbar: every button labelled + >=24px', hygiene.issues.length === 0, hygiene.issues.join('; '))
ok('toolbar: no overflow/clipping', !hygiene.overflow && !hygiene.clipped, JSON.stringify({ o: hygiene.overflow, c: hygiene.clipped }))
ok('saveState is aria-live', hygiene.live === 'polite', 'aria-live=' + hygiene.live)

// ---------- 1. toggle tools (real clicks, both directions) ----------
const toggles = [
  ['tbLaser', 'laser'], ['tbRuler', 'ruler'], ['tbEye', 'view'], ['tbLasso', 'lasso'], ['tbEraser', 'erase'], ['tbPens', 'pen-slot'],
]
await realClick(`document.getElementById('tbLaser')`)
ok('click tbLaser -> tool=laser', await state(`__wc.S.tool`) === 'laser', await state(`__wc.S.tool`))
ok('tbLaser aria-pressed=true', await state(`document.getElementById('tbLaser').getAttribute('aria-pressed')`) === 'true')
await realClick(`document.getElementById('tbLaser')`)
ok('click tbLaser again -> tool=pen', await state(`__wc.S.tool`) === 'pen', await state(`__wc.S.tool`))

await realClick(`document.getElementById('tbRuler')`)
ok('click tbRuler -> rulerOn', await state(`__wc.S.rulerOn`) === true)
ok('rulerCtl appears on screen', await state(`!!document.getElementById('rulerCtl') && !document.getElementById('rulerCtl').classList.contains('hidden')`))
await realClick(`document.getElementById('tbRuler')`)
ok('click tbRuler again -> rulerOff', await state(`__wc.S.rulerOn`) === false)

await realClick(`document.getElementById('tbEye')`)
ok('click tbEye -> view', await state(`__wc.S.tool`) === 'view')
await realClick(`document.getElementById('tbEye')`)
ok('click tbEye again -> pen', await state(`__wc.S.tool`) === 'pen')

await realClick(`document.getElementById('tbLasso')`)
ok('click tbLasso -> lasso', await state(`__wc.S.tool`) === 'lasso')
await realClick(`document.getElementById('tbLasso')`)
ok('click tbLasso again -> pen', await state(`__wc.S.tool`) === 'pen')

await realClick(`document.getElementById('tbEraser')`)
ok('click tbEraser -> erase', await state(`__wc.S.tool`) === 'erase')
ok('tbEraser aria-pressed=true', await state(`document.getElementById('tbEraser').getAttribute('aria-pressed')`) === 'true')
await realClick(`document.getElementById('tbEraser')`)
ok('click tbEraser again -> pen', await state(`__wc.S.tool`) === 'pen')

// ---------- 2. flyouts via caret zones ----------
await realClick(`document.querySelector('.caret-zone[data-fly="eraserFlyout"]')`)
ok('eraser caret -> flyout opens', await state(`!document.getElementById('eraserFlyout').classList.contains('hidden')`))
await realClick(`document.querySelector('.caret-zone[data-fly="eraserFlyout"]')`)
ok('eraser caret again -> flyout closes', await state(`document.getElementById('eraserFlyout').classList.contains('hidden')`))

await realClick(`document.querySelector('.caret-zone[data-fly="shapeFlyout"]')`)
ok('shape caret -> flyout opens', await state(`!document.getElementById('shapeFlyout').classList.contains('hidden')`))
await realClick(`document.querySelector('.caret-zone[data-fly="shapeFlyout"]')`)
ok('shape caret again -> flyout closes', await state(`document.getElementById('shapeFlyout').classList.contains('hidden')`))

await realClick(`document.getElementById('btnMenu')`)
ok('btnMenu -> library flyout opens', await state(`!document.getElementById('libraryFlyout').classList.contains('hidden')`))
await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(90)
ok('Escape closes library flyout', await state(`document.getElementById('libraryFlyout').classList.contains('hidden')`))

await realClick(`document.getElementById('btnPaper')`)
ok('btnPaper -> paper panel opens', await state(`!document.getElementById('paperPanel').classList.contains('hidden')`))
const orient0 = await state(`__wc.S.pages[__wc.S.currentPage].paper.orientation`)
await realClick(`document.getElementById('ppLandscape')`)
ok('paper: landscape applies', await state(`__wc.S.pages[__wc.S.currentPage].paper.orientation`) === 'landscape', 'was ' + orient0)
await realClick(`document.getElementById('ppPortrait')`)
ok('paper: portrait applies', await state(`__wc.S.pages[__wc.S.currentPage].paper.orientation`) === 'portrait')
await realClick(`document.getElementById('btnPaper')`)
ok('btnPaper again -> panel closes', await state(`document.getElementById('paperPanel').classList.contains('hidden')`))

// pen slot selects + opens its flyout, re-click closes
await realClick(`document.getElementById('tbPens').children[1]`)
ok('pen slot 2 click -> penIndex 1', await state(`__wc.S.penIndex`) === 1, JSON.stringify(await state(`({ i: __wc.S.penIndex, tool: __wc.S.tool })`)))
ok('pen slot click -> pen flyout opens', await state(`!document.getElementById('penFlyout').classList.contains('hidden')`))
await realClick(`document.getElementById('tbPens').children[1]`)
ok('pen slot re-click -> flyout closes', await state(`document.getElementById('penFlyout').classList.contains('hidden')`))

// ---------- 3. flyout options ----------
await realClick(`document.querySelector('.caret-zone[data-fly="eraserFlyout"]')`)
await realClick(`document.getElementById('erSegment')`)
ok('eraser option: segment applies', await state(`__wc.S.eraserMode`) === 'segment')
await realClick(`document.getElementById('erSizes').children[2]`)
ok('eraser size L -> 10mm', await state(`__wc.S.eraserMM`) === 10, await state(`__wc.S.eraserMM`))
await realClick(`document.getElementById('erSizes').children[0]`)
ok('eraser size S -> 2mm', await state(`__wc.S.eraserMM`) === 2, await state(`__wc.S.eraserMM`))
await realClick(`document.getElementById('erSheet')`)
ok('eraser option: sheet applies', await state(`__wc.S.eraserMode`) === 'sheet')
await realClick(`document.getElementById('erStroke')`)
ok('eraser option: stroke applies', await state(`__wc.S.eraserMode`) === 'stroke')
await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(80)

await realClick(`document.querySelector('.caret-zone[data-fly="shapeFlyout"]')`)
const nBeforeShape = await strokesOf()
await realClick(`document.getElementById('shapeGrid').children[0]`)
ok('shape card inserts a shape', await strokesOf() === nBeforeShape + 1, `before=${nBeforeShape} after=${await strokesOf()}`)
await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(80)
const toolAfterShape = await state(`__wc.S.tool`)

// text tool button inside the shapes flyout
await realClick(`document.querySelector('.caret-zone[data-fly="shapeFlyout"]')`)
await realClick(`document.getElementById('btnTextTool')`)
ok('text tool button -> tool=text', await state(`__wc.S.tool`) === 'text', 'tool=' + await state(`__wc.S.tool`))
await realClick(`document.getElementById('tbPens').children[0]`)
ok('pen slot returns to pen tool', await state(`__wc.S.tool`) === 'pen')

// color swatch in topbar
const swatch = await evalJs(ws, `(() => { const s = document.querySelector('#topbar .ps[data-color]'); return s ? { color: s.dataset.color, i: [...s.parentElement.children].indexOf(s) } : null })()`)
if (swatch) {
  await realClick(`document.querySelectorAll('#topbar .ps')[${swatch.i}]`)
  const cur = await state(`(() => { const p = __wc.S.penSlots[__wc.S.penIndex]; return p.color })()`)
  ok('color swatch applies to pen', String(cur).toLowerCase() === String(swatch.color).toLowerCase(), `want=${swatch.color} got=${cur}`)
  await realClick(`document.querySelectorAll('#topbar .ps')[0]`)
} else {
  console.log('SKIP color swatch (no #topbar .ps row)')
}

// ---------- 4. draw + undo/redo via toolbar ----------
await realClick(`document.getElementById('tbPens').children[0]`)
const px = v => Math.round(geo.left + v * geo.zoom)
const py = v => Math.round(geo.top + v * geo.zoom)
const n0 = await strokesOf()
await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(700), y: py(600), button: 'none' })
await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px(700), y: py(600), button: 'left', buttons: 1, clickCount: 1 })
for (let i = 1; i <= 5; i++) { await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: px(700 + i * 60), y: py(600 + (i % 2 ? 30 : -30)), buttons: 1 }); await sleep(12) }
await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px(1000), y: py(600), button: 'left', buttons: 0, clickCount: 1 })
await sleep(120)
ok('draw via real input commits', await strokesOf() === n0 + 1, `${n0} -> ${await strokesOf()}`)
await realClick(`document.getElementById('btnUndo')`)
ok('toolbar undo removes stroke', await strokesOf() === n0, `${n0} -> ${await strokesOf()}`)
await realClick(`document.getElementById('btnRedo')`)
ok('toolbar redo restores stroke', await strokesOf() === n0 + 1, `${n0} -> ${await strokesOf()}`)

// ---------- 5. pages ----------
const pagesBefore = await state(`__wc.S.pages.length`)
await realClick(`document.getElementById('btnAddPage')`)
ok('btnAddPage adds a page', await state(`__wc.S.pages.length`) === pagesBefore + 1, 'pages=' + await state(`__wc.S.pages.length`))
ok('new page is current', await state(`__wc.S.currentPage`) === pagesBefore)
await realClick(`document.getElementById('pagesBar').children[0]`)
ok('page rail switches page', await state(`__wc.S.currentPage`) === 0)

// ---------- 6. save flyout (real save path) ----------
await realClick(`document.getElementById('btnSave')`)
ok('btnSave -> save flyout opens', await state(`!document.getElementById('saveFlyout').classList.contains('hidden')`))
ok('save flyout prefills note title', await state(`document.getElementById('saveTitle').value`) === await state(`__wc.S.note.name`), 'title=' + await state(`document.getElementById('saveTitle').value`))
await realClick(`document.getElementById('btnSaveConfirm')`)
const saved = await waitFor(`document.getElementById('saveState').textContent === 'saved'`, 6000)
ok('Save confirm reports saved', saved, 'text=' + await state(`document.getElementById('saveState').textContent`))
ok('save flyout closes after save', await state(`document.getElementById('saveFlyout').classList.contains('hidden')`))
ok('page is clean after save', await state(`__wc.S.pages[__wc.S.currentPage].dirty`) === false)

// export menu opens from the save flyout (native dialog items are not clicked)
await realClick(`document.getElementById('btnSave')`)
await realClick(`document.getElementById('btnExport')`)
ok('btnExport -> export menu opens (4 items)', await state(`!document.getElementById('ctxMenu').classList.contains('hidden') && document.getElementById('ctxMenu').children.length === 4`), 'items=' + await state(`document.getElementById('ctxMenu').children.length`))
await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(80)
ok('Escape closes export menu', await state(`document.getElementById('ctxMenu').classList.contains('hidden')`))
await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(80)

// ---------- 7. pen flyout: types / palette / width ----------
const penInfo = () => state(`(() => { const p = __wc.S.penSlots[__wc.S.penIndex]; return { type: p.type, color: p.color, width: p.widthMM } })()`)
const slotSel = `document.getElementById('tbPens').children[0]`
const penFlyoutOpen = () => state(`!document.getElementById('penFlyout').classList.contains('hidden')`)
if (!(await penFlyoutOpen())) await realClick(slotSel)
ok('pen flyout opens for the selected slot', await penFlyoutOpen())
const types = await state(`[...document.querySelectorAll('#penTypeRow .penType')].map(b => b.dataset.type)`)
for (const t of types) {
  if (!(await penFlyoutOpen())) await realClick(slotSel)
  await realClick(`document.querySelector('#penTypeRow .penType[data-type="${t}"]')`)
  const pi = await penInfo()
  ok(`pen type "${t}" applies`, pi.type === t, 'type=' + pi.type)
}
if (!(await penFlyoutOpen())) await realClick(slotSel)
const sw = await evalJs(ws, `(() => { const b = document.querySelector('#penPalette .ps[data-color]'); return b ? b.dataset.color : null })()`)
await realClick(`document.querySelector('#penPalette .ps[data-color]')`)
const pi2 = await penInfo()
ok('palette color applies to pen', String(pi2.color).toLowerCase() === String(sw).toLowerCase(), `want=${sw} got=${pi2.color}`)
if (!(await penFlyoutOpen())) await realClick(slotSel)
const wRect = await evalJs(ws, `(() => { const r = document.getElementById('width').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } })()`)
const clickSlider = async frac => {
  const x = wRect.x + Math.round(wRect.w * frac), y = wRect.y + Math.round(wRect.h / 2)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(100)
}
await clickSlider(0.8)
const wHi = (await penInfo()).width
await clickSlider(0.15)
const wLo = (await penInfo()).width
ok('width slider changes pen width', wHi > wLo && wHi > 6 && wLo < 6, `80%->${wHi} 15%->${wLo}`)
await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(80)

// ---------- 8. every paper template applies ----------
await realClick(`document.getElementById('btnPaper')`)
const tpls = await state(`[...document.querySelectorAll('#ppThumbs .pp-thumb')].map(t => t.dataset.tpl)`)
const tplBefore = await state(`__wc.S.pages[__wc.S.currentPage].paper.template`)
let tplFails = []
for (let i = 0; i < tpls.length; i++) {
  await evalJs(ws, `document.getElementById('ppThumbs').children[${i}].scrollIntoView({ block: 'nearest', inline: 'center' })`)
  await sleep(30)
  await realClick(`document.getElementById('ppThumbs').children[${i}]`)
  const got = await state(`__wc.S.pages[__wc.S.currentPage].paper.template`)
  if (got !== tpls[i]) tplFails.push(`${tpls[i]}->${got}`)
}
ok(`all ${tpls.length} paper templates apply`, tplFails.length === 0, tplFails.join(','))
await evalJs(ws, `document.getElementById('ppThumbs').children[${Math.max(0, tpls.indexOf(tplBefore))}].scrollIntoView({ block: 'nearest', inline: 'center' })`)
await sleep(30)
await realClick(`document.getElementById('ppThumbs').children[${Math.max(0, tpls.indexOf(tplBefore))}]`)
ok('paper template restored', await state(`__wc.S.pages[__wc.S.currentPage].paper.template`) === tplBefore)
await realClick(`document.getElementById('btnPaper')`)

// ---------- 9. ruler rotate buttons ----------
await realClick(`document.getElementById('tbRuler')`)
ok('ruler control cluster appears', await state(`!!document.getElementById('rulerCtl')`))
await realClick(`document.getElementById('rulCW')`)
await realClick(`document.getElementById('rulCW')`)
await realClick(`document.getElementById('rulCCW')`)
ok('ruler rotate buttons run cleanly', await state(`!!document.getElementById('rulerCtl')`))
await realClick(`document.getElementById('tbRuler')`)

// ---------- 10. rename dialog (open + cancel) ----------
const nameBefore = await state(`__wc.S.note.name`)
await realClick(`document.getElementById('btnTitle')`)
ok('btnTitle -> rename dialog opens', await state(`!document.getElementById('dlg').classList.contains('hidden')`))
ok('rename dialog prefilled with title', await state(`document.getElementById('dlgInput').value`) === nameBefore, 'value=' + await state(`document.getElementById('dlgInput').value`))
await realClick(`document.getElementById('dlgCancel')`)
ok('rename cancel closes without rename', await state(`document.getElementById('dlg').classList.contains('hidden')`) && await state(`__wc.S.note.name`) === nameBefore)

// ---------- 11. New note button ----------
const prevId = await state(`__wc.S.noteId`)
await realClick(`document.getElementById('btnNew')`)
const newOpened = await waitFor(`__wc.S.noteId && __wc.S.noteId !== ${Number(prevId)}`, 4000)
ok('btnNew opens a fresh note', newOpened, 'noteId=' + await state(`__wc.S.noteId`))
const createdId = await state(`__wc.S.noteId`)

// ---------- 7. exception gate ----------
ok('no uncaught JS exceptions during audit', jsErrors.length === 0, jsErrors.slice(0, 5).join(' | '))
if (jsErrors.length) console.log('JS ERRORS:\n' + jsErrors.join('\n'))

// ---------- cleanup ----------
if (openId) { try { await evalJs(ws, `__wc.App.openNote(${openId})`, { awaitPromise: true }) } catch { } }
for (const id of [createdId, note.id]) {
  if (!id || id === openId) continue
  try { await evalJs(ws, `WriteCanvasHost.destroyItem(${Number(id)})`, { awaitPromise: true }) } catch { }
}
console.log(failures.length ? `\nAUDIT FAILED (${failures.length})` : '\nAUDIT ALL PASS')
try { ws.close() } catch { }
process.exit(failures.length ? 1 : 0)
