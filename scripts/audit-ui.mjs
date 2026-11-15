// Full real-input UI audit of the editor (CDP 9222, app must be running).
// Every control is clicked with real mouse events (hit-testing included), and
// both the resulting state and uncaught exceptions are checked.
//   node scripts/audit-ui.mjs
import { setTimeout as sleep } from 'node:timers/promises'

let wsSeq = 1
const pending = new Map()
const failures = []
// Values that came back from the page can carry newlines; every result reads
// as one line only if they do not.
const oneLine = value => String(value).replace(/[\r\n]+/g, ' ')
const pass = n => console.log('PASS', n)
const fail = (n, info) => { const text = oneLine(info); failures.push(`${n}: ${text}`); console.log('FAIL', n, ':', text) }
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
const penBefore = await state(`JSON.stringify({ slots: __wc.S.penSlots, index: __wc.S.penIndex })`)
// clear leftovers from earlier crashed runs (same scratch name)
await evalJs(ws, `(async () => { const lib = await WriteCanvasHost.library(); const ids = (lib.items || []).filter(i => i.name === 'ZZAudit').map(i => i.id); for (const id of ids) await WriteCanvasHost.destroyItem(id); return ids })()`, { awaitPromise: true })
const note = await evalJs(ws, `WriteCanvasHost.createNote('ZZAudit', 1)`, { awaitPromise: true })
await sleep(400)
await evalJs(ws, `__wc.App.openNote(${note.id})`, { awaitPromise: true })
await sleep(400)
await evalJs(ws, `(() => { const h = document.getElementById('canvasHost'); h.scrollTop = 0; h.scrollLeft = 0; return true })()`)
const geo = await evalJs(ws, `(() => { const i = document.getElementById('stackInner'); const r = i.getBoundingClientRect(); return { left: r.left, top: r.top, zoom: r.width / i.offsetWidth } })()`)
const strokesOf = () => state(`__wc.S.pages[__wc.S.currentPage].strokes.length`) || 0
const dragDoc = async (x1, y1, x2, y2) => {
  const sx = Math.round(geo.left + x1 * geo.zoom), sy = Math.round(geo.top + y1 * geo.zoom)
  const ex = Math.round(geo.left + x2 * geo.zoom), ey = Math.round(geo.top + y2 * geo.zoom)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx, y: sy, button: 'none' })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', buttons: 1, clickCount: 1 })
  for (let i = 1; i <= 6; i++) {
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(sx + (ex - sx) * i / 6), y: Math.round(sy + (ey - sy) * i / 6), buttons: 1 })
    await sleep(16)
  }
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: ex, y: ey, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(160)
}

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
const toolOrder = await state(`[...document.querySelectorAll('#tbToggles .tb-toggle')].map(b => b.id)`)
ok('toolbar tools follow the working order', JSON.stringify(toolOrder) === JSON.stringify(['tbEraser', 'tbLasso', 'tbText', 'tbObject', 'tbRuler', 'tbLaser', 'tbEye']), JSON.stringify(toolOrder))

// ---------- 1. toggle tools (real clicks, both directions) ----------
await realClick(`document.getElementById('tbLaser')`)
ok('click tbLaser -> tool=laser', await state(`__wc.S.tool`) === 'laser', await state(`__wc.S.tool`))
ok('tbLaser aria-pressed=true', await state(`document.getElementById('tbLaser').getAttribute('aria-pressed')`) === 'true')
await realClick(`document.getElementById('tbLaser')`)
ok('click tbLaser again -> tool=pen', await state(`__wc.S.tool`) === 'pen', await state(`__wc.S.tool`))

// Select, Ruler and the Eraser open their pickers on click (like Shapes); the
// last pick is already marked and choosing one applies it at once and closes
// the picker.
await realClick(`document.getElementById('tbRuler')`)
ok('click tbRuler -> ruler chooser opens', await state(`!document.getElementById('rulerFlyout').classList.contains('hidden')`))
// the marked card must be exactly the remembered pick (it persists across runs)
ok('ruler chooser marks exactly the remembered pick', await state(`(() => {
  const marked = [document.getElementById('rulRuler'), document.getElementById('rulProtractor')].filter(b => b.classList.contains('active') && b.getAttribute('aria-pressed') === 'true')
  return marked.length === 1 && marked[0].id === (__wc.S.rulerMode === 'protractor' ? 'rulProtractor' : 'rulRuler')
})()`) === true)
await realClick(`document.getElementById('rulRuler')`)
ok('picking Ruler turns the stencil on', await state(`__wc.S.rulerOn`) === true && await state(`__wc.S.rulerMode`) === 'ruler')
ok('picking a stencil closes the chooser', await state(`document.getElementById('rulerFlyout').classList.contains('hidden')`))
ok('rulerCtl appears on screen', await state(`!!document.getElementById('rulerCtl') && !document.getElementById('rulerCtl').classList.contains('hidden')`))
await realClick(`document.getElementById('tbRuler')`)
await realClick(`document.getElementById('rulProtractor')`)
ok('picking Protractor switches the stencil', await state(`__wc.S.rulerMode`) === 'protractor' && await state(`__wc.S.rulerOn`) === true)
await realClick(`document.getElementById('tbRuler')`)
ok('protractor pick is remembered when reopened', await state(`document.getElementById('rulProtractor').classList.contains('active')`) === true)
await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(80)
ok('Escape turns the stencil off', await state(`__wc.S.rulerOn`) === false)

await realClick(`document.getElementById('tbEye')`)
ok('click tbEye -> view', await state(`__wc.S.tool`) === 'view')
await realClick(`document.getElementById('tbEye')`)
ok('click tbEye again -> pen', await state(`__wc.S.tool`) === 'pen')

await realClick(`document.getElementById('tbLasso')`)
ok('click tbLasso -> select chooser opens', await state(`!document.getElementById('selectFlyout').classList.contains('hidden')`))
await realClick(`document.getElementById('selLasso')`)
ok('picking Lasso activates select', await state(`__wc.S.tool`) === 'lasso' && await state(`__wc.S.selectMode`) === 'lasso')
ok('picking a select mode closes the chooser', await state(`document.getElementById('selectFlyout').classList.contains('hidden')`))
await realClick(`document.getElementById('tbLasso')`)
await realClick(`document.getElementById('selClick')`)
ok('picking Click switches the select mode', await state(`__wc.S.selectMode`) === 'click' && await state(`__wc.S.tool`) === 'lasso')
await realClick(`document.getElementById('tbLasso')`)
await realClick(`document.getElementById('selLasso')`)
ok('select mode goes back to Lasso', await state(`__wc.S.selectMode`) === 'lasso')

// The Eraser card behaves like Select and Shapes: the click opens its chooser
// with the remembered pick already marked, and choosing a mode applies it at
// once (turning the eraser on) and closes the chooser.
await realClick(`document.getElementById('tbEraser')`)
ok('click tbEraser -> eraser chooser opens', await state(`!document.getElementById('eraserFlyout').classList.contains('hidden')`))
ok('eraser chooser marks exactly the remembered pick', await state(`(() => {
  const ids = { stroke: 'erStroke', segment: 'erSegment', sheet: 'erSheet' }
  const marked = [document.getElementById('erStroke'), document.getElementById('erSegment'), document.getElementById('erSheet')].filter(b => b.classList.contains('active') && b.getAttribute('aria-pressed') === 'true')
  return marked.length === 1 && marked[0].id === ids[__wc.S.eraserMode]
})()`) === true)
await realClick(`document.getElementById('erStroke')`)
ok('picking Stroke turns the eraser on', await state(`__wc.S.tool`) === 'erase' && await state(`__wc.S.eraserMode`) === 'stroke')
ok('picking an eraser mode closes the chooser', await state(`document.getElementById('eraserFlyout').classList.contains('hidden')`))
ok('tbEraser aria-pressed=true', await state(`document.getElementById('tbEraser').getAttribute('aria-pressed')`) === 'true')

// ---------- 2. flyouts via their real controls ----------
const shapeButton = `document.getElementById('tbObject')`
await realClick(`document.getElementById('tbEraser')`)
ok('click tbEraser -> chooser opens', await state(`!document.getElementById('eraserFlyout').classList.contains('hidden')`))
await realClick(`document.getElementById('tbEraser')`)
ok('click tbEraser again -> chooser closes', await state(`document.getElementById('eraserFlyout').classList.contains('hidden')`))

await realClick(shapeButton)
ok('shape control -> flyout opens', await state(`!document.getElementById('shapeFlyout').classList.contains('hidden')`))
await realClick(shapeButton)
ok('shape control again -> flyout closes', await state(`document.getElementById('shapeFlyout').classList.contains('hidden')`))

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

// the single current-pen control opens its settings flyout, re-click closes
await realClick(`document.getElementById('tbPenCurrent')`)
ok('current pen click -> pen flyout opens', await state(`!document.getElementById('penFlyout').classList.contains('hidden')`))
ok('current pen click keeps pen tool active', await state(`__wc.S.tool`) === 'pen', 'tool=' + await state(`__wc.S.tool`))
await realClick(`document.getElementById('tbPenCurrent')`)
ok('current pen re-click -> flyout closes', await state(`document.getElementById('penFlyout').classList.contains('hidden')`))

// ---------- 3. flyout options ----------
// choosing a mode applies it and closes the card; the S/M/L chips adjust the
// segment size inside the card and keep it open so sizes can be compared
await realClick(`document.getElementById('tbEraser')`)
await realClick(`document.getElementById('erSegment')`)
ok('eraser option: segment applies', await state(`__wc.S.eraserMode`) === 'segment' && await state(`__wc.S.tool`) === 'erase')
ok('picking a segment closes the chooser', await state(`document.getElementById('eraserFlyout').classList.contains('hidden')`))
await realClick(`document.getElementById('tbEraser')`)
ok('reopening shows the segment size row', await state(`!document.getElementById('erSizeRow').classList.contains('hidden')`))
await realClick(`document.getElementById('erSizes').children[2]`)
ok('eraser size L -> 10mm', await state(`__wc.S.eraserMM`) === 10, await state(`__wc.S.eraserMM`))
await realClick(`document.getElementById('erSizes').children[0]`)
ok('eraser size S -> 2mm', await state(`__wc.S.eraserMM`) === 2, await state(`__wc.S.eraserMM`))
await realClick(`document.getElementById('erSheet')`)
ok('eraser option: sheet applies', await state(`__wc.S.eraserMode`) === 'sheet')
await realClick(`document.getElementById('tbEraser')`)
await realClick(`document.getElementById('erStroke')`)
ok('eraser option: stroke applies', await state(`__wc.S.eraserMode`) === 'stroke')
await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(80)

await realClick(shapeButton)
const nBeforeShape = await strokesOf()
await realClick(`document.querySelector('#shapeGrid .sh-card')`)
ok('shape card activates shape tool', await state(`__wc.S.tool`) === 'shape', 'tool=' + await state(`__wc.S.tool`))
await dragDoc(700, 850, 1150, 980)
ok('shape drag creates one vector shape', await strokesOf() === nBeforeShape + 1, `before=${nBeforeShape} after=${await strokesOf()}`)
ok('created stroke is the selected shape kind', await state(`__wc.S.pages[__wc.S.currentPage].strokes.at(-1)?.shape?.kind`) === 'line', 'kind=' + await state(`__wc.S.pages[__wc.S.currentPage].strokes.at(-1)?.shape?.kind`))
// a plain tap places a default-size shape instead of only hinting
const nBeforeTap = await strokesOf()
{
  const cx = Math.round(geo.left + 900 * geo.zoom), cy = Math.round(geo.top + 1500 * geo.zoom)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none' })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(160)
}
ok('shape tap places one default-size shape', await strokesOf() === nBeforeTap + 1, `before=${nBeforeTap} after=${await strokesOf()}`)
const tapSpan = await state(`(() => { const st = __wc.S.pages[__wc.S.currentPage].strokes.at(-1); if (!st || st.type !== 'shape') return null; const xs = st.pts.map(p => p.x); return Math.round(Math.max(...xs) - Math.min(...xs)) })()`)
ok('tap-placed shape has a readable default size', tapSpan >= 100 && tapSpan <= 400, 'span=' + tapSpan)
await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(80)
ok('Escape returns to the pen after shape drag', await state(`__wc.S.tool`) === 'pen', 'tool=' + await state(`__wc.S.tool`))

// text tool: toolbar button, tap-to-place, type, commit with Enter
await realClick(`document.getElementById('tbText')`)
ok('toolbar Text button -> tool=text', await state(`__wc.S.tool`) === 'text', 'tool=' + await state(`__wc.S.tool`))
const textsOf = () => state(`__wc.S.pages[__wc.S.currentPage].texts.length`) || 0
const nTexts0 = await textsOf()
{
  const cx = Math.round(geo.left + 800 * geo.zoom), cy = Math.round(geo.top + 1200 * geo.zoom)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none' })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(120)
}
ok('text tap opens the in-place editor', await state(`!!document.getElementById('textEdit')`))
await send(ws, 'Input.insertText', { text: 'Audit text' })
await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await sleep(160)
ok('Enter commits the typed text box', await textsOf() === nTexts0 + 1, `${nTexts0} -> ${await textsOf()}`)
const textX0 = await state(`__wc.S.pages[__wc.S.currentPage].texts.at(-1).x`)
ok('typed text kept on the box', await state(`__wc.S.pages[__wc.S.currentPage].texts.at(-1).txt`) === 'Audit text')

// select the text box with the real select chooser + click mode, then move it
await realClick(`document.getElementById('tbLasso')`)
await realClick(`document.getElementById('selClick')`)
ok('Click mode applies from the select chooser', await state(`__wc.S.selectMode`) === 'click' && await state(`__wc.S.tool`) === 'lasso')
{
  const cx = Math.round(geo.left + 830 * geo.zoom), cy = Math.round(geo.top + 1215 * geo.zoom)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none' })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(140)
}
ok('click selects the text box', await state(`(__wc.S.selection && __wc.S.selection.texts.length) || 0`) === 1, JSON.stringify(await state(`__wc.S.selection && { s: __wc.S.selection.strokes.length, t: __wc.S.selection.texts.length }`)))
ok('selection bar appears for text', await state(`!!document.getElementById('selBar')`))
await dragDoc(830, 1215, 1190, 1455)
const textX1 = await state(`__wc.S.pages[__wc.S.currentPage].texts.at(-1).x`)
ok('dragging inside the box moves the text', Math.abs(textX1 - (textX0 + 360)) < 40, `x ${textX0} -> ${textX1}`)
// copy / paste through the real chords
await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 2 })
await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 2 })
await sleep(120)
await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 })
await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 })
await sleep(200)
ok('Ctrl+C / Ctrl+V copies the text box', await textsOf() === nTexts0 + 2, 'texts=' + await textsOf())
// Delete removes the pasted copy
await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 })
await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 })
await sleep(200)
ok('Delete removes the selected text box', await textsOf() === nTexts0 + 1, 'texts=' + await textsOf())
// double-click re-opens the box for editing (it moved with the drag above)
const tbPos = await state(`(() => { const t = __wc.S.pages[__wc.S.currentPage].texts.at(-1); return { x: t.x, y: t.y } })()`)
{
  const cx = Math.round(geo.left + (tbPos.x + 20) * geo.zoom), cy = Math.round(geo.top + (tbPos.y + 30) * geo.zoom)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none' })
  for (const n of [1, 2]) {
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: n })
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: n })
  }
  await sleep(220)
}
ok('double-click opens the text for editing', await state(`!!document.getElementById('textEdit')`) && await state(`document.getElementById('textEdit').value === 'Audit text'`))
await send(ws, 'Input.insertText', { text: ' (edited)' })
await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await sleep(200)
ok('edited text saves back to the page', await state(`__wc.S.pages[__wc.S.currentPage].texts.at(-1).txt`) === 'Audit text (edited)')
await evalJs(ws, `document.getElementById('btnUndo').click()`)
await sleep(120)
ok('undo restores the text before the edit', await state(`__wc.S.pages[__wc.S.currentPage].texts.at(-1).txt`) === 'Audit text', 'txt=' + await state(`__wc.S.pages[__wc.S.currentPage].texts.at(-1).txt`))
await evalJs(ws, `document.getElementById('btnRedo').click()`)
await sleep(120)
ok('redo re-applies the edit', await state(`__wc.S.pages[__wc.S.currentPage].texts.at(-1).txt`) === 'Audit text (edited)')
// back to the pen for the remaining sections
await realClick(`document.getElementById('tbText')`)
if (await state(`__wc.S.tool`) !== 'pen') await realClick(`document.getElementById('tbPenCurrent')`)
await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(80)
ok('current pen returns to pen tool', await state(`__wc.S.tool`) === 'pen', 'tool=' + await state(`__wc.S.tool`))

// quick colour swatches in the topbar (hidden below 1360px)
const swatch = await evalJs(ws, `(() => { const s = document.querySelector('#tbQuick .tb-swatch[data-color]'); if (!s || !s.getBoundingClientRect().width) return null; return { color: s.dataset.color, i: [...s.parentElement.children].indexOf(s) } })()`)
if (swatch) {
  await realClick(`document.querySelectorAll('#tbQuick .tb-swatch')[${swatch.i}]`)
  const cur = await state(`(() => { const p = __wc.S.penSlots[__wc.S.penIndex]; return p.color })()`)
  ok('quick colour swatch applies to pen', String(cur).toLowerCase() === String(swatch.color).toLowerCase(), `want=${swatch.color} got=${cur}`)
  await realClick(`document.querySelectorAll('#tbQuick .tb-swatch')[0]`)
} else {
  console.log('SKIP quick colour swatch (row hidden / narrow window)')
}

// ---------- 4. draw + undo/redo via toolbar ----------
// A toolbar flyout overlapping the canvas would swallow the pointer stream.
if (!(await state(`document.getElementById('penFlyout').classList.contains('hidden')`))) {
  await realClick(`document.getElementById('penDone')`)
}
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

// ---------- 6. direct save + save/export overflow ----------
await realClick(`document.getElementById('btnSave')`)
const saved = await waitFor(`document.getElementById('saveState').textContent.startsWith('saved')`, 6000)
ok('btnSave saves directly', saved, 'text=' + await state(`document.getElementById('saveState').textContent`))
ok('direct save never opens note details', await state(`document.getElementById('saveFlyout').classList.contains('hidden')`))
ok('page is clean after direct save', await state(`__wc.S.pages[__wc.S.currentPage].dirty`) === false)

await realClick(`document.getElementById('btnSaveMore')`)
ok('btnSaveMore -> save/export menu opens', await state(`!document.getElementById('ctxMenu').classList.contains('hidden')`))
ok('save/export menu offers exactly one library Save', await state(`[...document.querySelectorAll('#ctxMenu button')].filter(b => /^Save all changes/.test(b.textContent)).length`) === 1)
ok('the .wcanvas copy is presented as an export, not a second Save', await state(`[...document.querySelectorAll('#ctxMenu button')].filter(b => /wcanvas/i.test(b.textContent) && /editable copy/i.test(b.textContent)).length`) === 1)
ok('save/export menu offers PDF export', await state(`[...document.querySelectorAll('#ctxMenu button')].some(b => b.textContent.includes('PDF'))`))
ok('save/export menu offers note details', await state(`[...document.querySelectorAll('#ctxMenu button')].some(b => b.textContent.includes('Note details'))`))
await realClick(`[...document.querySelectorAll('#ctxMenu button')].find(b => b.textContent.includes('Note details'))`)
ok('Note details opens its own dialog', await state(`!document.getElementById('saveFlyout').classList.contains('hidden')`))
const hintText = await state(`document.querySelector('#saveFlyout .fs-hint').textContent`)
ok('note details explains the library save needs no dialog', /no file dialog/i.test(hintText || '') && /editable copy/i.test(hintText || ''), 'hint=' + hintText)
ok('note details prefills note title', await state(`document.getElementById('saveTitle').value`) === await state(`__wc.S.note.name`), 'title=' + await state(`document.getElementById('saveTitle').value`))
await realClick(`document.getElementById('btnSaveConfirm')`)
const detailsSaved = await waitFor(`document.getElementById('saveState').textContent.startsWith('saved')`, 6000)
ok('Note details apply reports saved', detailsSaved, 'text=' + await state(`document.getElementById('saveState').textContent`))
ok('note details closes after apply', await state(`document.getElementById('saveFlyout').classList.contains('hidden')`))

await realClick(`document.getElementById('btnSaveMore')`)
await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(80)
ok('Escape closes save/export menu', await state(`document.getElementById('ctxMenu').classList.contains('hidden')`))

// ---------- 7. pen flyout: types / palette / width ----------
const penInfo = () => state(`(() => { const p = __wc.S.penSlots[__wc.S.penIndex]; return { type: p.type, color: p.color, width: p.widthMM } })()`)
const slotSel = `document.getElementById('tbPenCurrent')`
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
// Pick a saturated swatch: near-black ink is intentionally flipped to white
// on the midnight board, so the first (black) swatch is covered by its own
// contrast rule rather than being a pure palette-application test.
const sw = '#FF0000'
await realClick(`document.querySelector('#penPalette .ps[data-color="${sw}"]')`)
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

// custom colour picker must open beside the rainbow swatch, not at the window corner
if (!(await penFlyoutOpen())) await realClick(slotSel)
const swatchRect = await evalJs(ws, `(() => { const r = document.getElementById('customColorBtn').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right } })()`)
await realClick(`document.getElementById('customColorBtn')`)
const popRect = await evalJs(ws, `(() => { const p = document.getElementById('colorPopover'); const r = p.getBoundingClientRect(); return { hidden: p.classList.contains('hidden'), l: r.left, t: r.top, r: r.right, b: r.bottom } })()`)
ok('custom colour picker opens in-page', !popRect.hidden && popRect.l > 100, JSON.stringify(popRect))
ok('custom colour picker sits beside the rainbow swatch', popRect.r <= swatchRect.l + 2 && Math.abs(popRect.t - swatchRect.t) < 80, JSON.stringify({ pop: popRect, swatch: swatchRect }))
await realClick(`document.getElementById('cpClose')`)
ok('closing custom colour keeps pen flyout open', await penFlyoutOpen() && await state(`document.getElementById('colorPopover').classList.contains('hidden')`))
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

// ---------- 9. ruler: rotate buttons, drag handle, and near-the-edge snap only ----------
await evalJs(ws, `(() => { __wc.ruler.angle = 0; __wc.ruler.fx = 0.5; __wc.ruler.fy = 0.35; return true })()`)
await realClick(`document.getElementById('tbRuler')`)
await realClick(`document.getElementById('rulRuler')`)
ok('ruler control cluster appears', await state(`!!document.getElementById('rulerCtl')`))
await realClick(`document.getElementById('rulCW')`)
await realClick(`document.getElementById('rulCW')`)
await realClick(`document.getElementById('rulCCW')`)
ok('ruler rotate buttons run cleanly', await state(`!!document.getElementById('rulerCtl')`))
await evalJs(ws, `(() => { __wc.ruler.angle = 0; return true })()`)

const rulerPivot = await state(`(() => {
  const inner = document.getElementById('stackInner')
  const r = inner.getBoundingClientRect()
  const z = r.width / inner.offsetWidth
  return { px: __wc.ruler.fx * inner.offsetWidth, py: __wc.ruler.fy * inner.offsetHeight, z, left: r.left, top: r.top }
})()`)
const rDoc = (dx, dy) => ({ x: Math.round(rulerPivot.left + (rulerPivot.px + dx) * rulerPivot.z), y: Math.round(rulerPivot.top + (rulerPivot.py + dy) * rulerPivot.z) })
const rulerDrag = async (a, b) => {
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y, button: 'none' })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 })
  for (let i = 1; i <= 5; i++) {
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(a.x + (b.x - a.x) * i / 5), y: Math.round(a.y + (b.y - a.y) * i / 5), buttons: 1 })
    await sleep(16)
  }
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(150)
}

// far from the stencil: the stroke stays free-hand (it used to snap anywhere)
const pyDoc = Math.round(rulerPivot.py)
const nBeforeFree = await strokesOf()
await rulerDrag(rDoc(-220, 260), rDoc(220, 330))
const freePts = await state(`(() => { const st = __wc.S.pages[__wc.S.currentPage].strokes.at(-1); return st ? st.pts.map(p => Math.round(p.y - ${pyDoc})) : null })()`)
ok('stroke away from the ruler stays free-hand', await strokesOf() === nBeforeFree + 1 && freePts && Math.max(...freePts.map(v => Math.abs(v))) > 120, JSON.stringify(freePts))

// starting on the band: every sample rides the line
const nBeforeSnap = await strokesOf()
await rulerDrag(rDoc(-320, 0), rDoc(320, 90))
const snapPts = await state(`(() => { const st = __wc.S.pages[__wc.S.currentPage].strokes.at(-1); return st ? st.pts.map(p => Math.round(p.y - ${pyDoc})) : null })()`)
ok('stroke started on the ruler rides the line', await strokesOf() === nBeforeSnap + 1 && snapPts && snapPts.every(v => Math.abs(v) <= 1), JSON.stringify(snapPts))

// the far handle rotates the stencil by hand
const handle = await state(`(() => { const h = __wc.rulerRotateHandle(__wc.S.pages[__wc.S.currentPage]); return h && { hx: h.x, hy: h.y } })()`)
ok('rotate handle exists on the page', !!handle && handle.hx > 0)
if (handle) {
  const from = rDoc(handle.hx - rulerPivot.px, handle.hy - rulerPivot.py)
  const to = rDoc(420, -420)
  await rulerDrag(from, to)
  const angle = await state(`Math.round(__wc.ruler.angle)`)
  ok('dragging the handle turns the ruler', Math.abs(angle) > 8 && Math.abs(angle) < 60, 'angle=' + angle)
}
// ---------- 9b. protractor: strokes that start on the arc ride the circle ----------
await evalJs(ws, `(() => { __wc.ruler.angle = 0; __wc.ruler.fx = 0.5; __wc.ruler.fy = 0.62; return true })()`)
await realClick(`document.getElementById('tbRuler')`)
await realClick(`document.getElementById('rulProtractor')`)
ok('protractor turns on from its chooser', await state(`__wc.S.rulerMode`) === 'protractor' && await state(`__wc.S.rulerOn`) === true)
const pGeo = await state(`(() => {
  const inner = document.getElementById('stackInner')
  const r = inner.getBoundingClientRect()
  const z = r.width / inner.offsetWidth
  const w = inner.offsetWidth, h = inner.offsetHeight
  const px = __wc.ruler.fx * w, py = __wc.ruler.fy * h
  const radius = Math.max(220, Math.min(w, h) * __wc.protractor.r)
  return { px, py, radius, z, left: r.left, top: r.top }
})()`)
const pDoc = (x, y) => ({ x: Math.round(pGeo.left + x * pGeo.z), y: Math.round(pGeo.top + y * pGeo.z) })
// start 8 doc px inside the band at the apex, then sweep along the arc
const nBeforeArc = await strokesOf()
await rulerDrag(pDoc(pGeo.px, pGeo.py - pGeo.radius + 8), pDoc(pGeo.px + pGeo.radius * 0.55, pGeo.py - pGeo.radius * 0.8))
const arcErr = await state(`(() => {
  const st = __wc.S.pages[__wc.S.currentPage].strokes.at(-1)
  if (!st || st.type === 'shape') return null
  return st.pts.map(p => Math.round(Math.hypot(p.x - ${pGeo.px}, p.y - ${pGeo.py}) - ${pGeo.radius}))
})()`)
ok('stroke started on the arc rides the circle', await strokesOf() === nBeforeArc + 1 && arcErr && arcErr.every(v => Math.abs(v) <= 2), JSON.stringify(arcErr))
// a stroke well away from the arc stays free-hand (start left of the pivot:
// the floating rotate controls sit below-right and swallow a press there)
const nBeforeFreeP = await strokesOf()
await rulerDrag(pDoc(pGeo.px - 260, pGeo.py + 60), pDoc(pGeo.px - 520, pGeo.py + 220))
ok('stroke away from the protractor stays free-hand', await strokesOf() === nBeforeFreeP + 1)
// the apex handle turns the protractor
const pHandle = await state(`(() => { const h = __wc.rulerRotateHandle(__wc.S.pages[__wc.S.currentPage]); return h && { x: h.x, y: h.y } })()`)
ok('protractor rotate handle exists', !!pHandle && pHandle.y < pGeo.py)
if (pHandle) {
  await rulerDrag(pDoc(pHandle.x, pHandle.y), pDoc(pGeo.px + pGeo.radius * 0.8, pGeo.py - pGeo.radius * 0.2))
  const pAngle = await state(`Math.round(__wc.ruler.angle)`)
  ok('dragging the protractor handle turns it', Math.abs(pAngle) > 8 && Math.abs(pAngle) < 100, 'angle=' + pAngle)
}
await evalJs(ws, `(() => { __wc.ruler.angle = 0; __wc.ruler.fx = 0.5; __wc.ruler.fy = 0.55; return true })()`)
await evalJs(ws, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(80)
ok('ruler turns off cleanly', await state(`__wc.S.rulerOn`) === false)

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
if (jsErrors.length) console.log('JS ERRORS:\n' + jsErrors.map(oneLine).join('\n'))

// ---------- cleanup ----------
if (openId) { try { await evalJs(ws, `__wc.App.openNote(${openId})`, { awaitPromise: true }) } catch { } }
for (const id of [createdId, note.id]) {
  if (!id || id === openId) continue
  try { await evalJs(ws, `WriteCanvasHost.destroyItem(${Number(id)})`, { awaitPromise: true }) } catch { }
}
// the audit exercises the real pen controls; put the user's pen back exactly
if (penBefore) {
  await evalJs(ws, `(() => {
    const d = JSON.parse(${JSON.stringify(penBefore)})
    __wc.S.penSlots = d.slots
    __wc.S.penIndex = d.index
    localStorage.setItem('wc:pens', JSON.stringify({ slots: d.slots, index: d.index }))
    return true
  })()`)
  try { await realClick(`document.getElementById('tbPenCurrent')`); await realClick(`document.getElementById('tbPenCurrent')`) } catch { }
}
console.log(failures.length ? `\nAUDIT FAILED (${failures.length})` : '\nAUDIT ALL PASS')
try { ws.close() } catch { }
process.exit(failures.length ? 1 : 0)
