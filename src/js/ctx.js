// Floating context menu + modal prompt helpers.

const $ = id => document.getElementById(id)

let openMenu = null

export function pick(items, x, y) {
  closeMenu()
  const m = $('ctxMenu')
  m.innerHTML = ''
  for (const it of items) {
    if (it === '-') {
      const hr = document.createElement('div')
      hr.style.cssText = 'height:1px;margin:3px 6px;background:var(--line)'
      m.appendChild(hr)
      continue
    }
    if (it.header) {
      const h = document.createElement('div')
      h.className = 'ctx-head'
      h.textContent = it.header
      m.appendChild(h)
      continue
    }
    const b = document.createElement('button')
    b.textContent = it.label
    if (it.danger) b.className = 'danger'
    if (it.disabled) b.disabled = true
    b.onclick = () => { closeMenu(); it.act && it.act() }
    m.appendChild(b)
  }
  m.classList.remove('hidden')
  const mw = m.offsetWidth, mh = m.offsetHeight
  m.style.left = Math.max(4, Math.min(x, window.innerWidth - mw - 8)) + 'px'
  m.style.top = Math.max(4, Math.min(y, window.innerHeight - mh - 8)) + 'px'
  openMenu = closeMenu
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', esc, true)
  }, 0)
}

function outside(e) {
  const m = $('ctxMenu')
  if (m.contains(e.target)) return
  closeMenu()
}
function esc(e) { if (e.key === 'Escape') closeMenu() }

export function closeMenu() {
  const m = $('ctxMenu')
  if (m) m.classList.add('hidden')
  document.removeEventListener('pointerdown', outside, true)
  document.removeEventListener('keydown', esc, true)
  openMenu = null
}

let dlgBusy = false
// Text prompt. Resolves string|null. With {noInput:true} it acts as Yes/No confirm.
export function promptText(title, value = '', opts = {}) {
  if (dlgBusy) return Promise.resolve(null)
  return new Promise(resolve => {
    dlgBusy = true
    const inp = $('dlgInput'), ok = $('dlgOk'), cancel = $('dlgCancel')
    $('dlgText').textContent = title
    inp.style.display = opts.noInput ? 'none' : ''
    ok.textContent = opts.noInput ? 'Delete' : 'OK'
    if (opts.noInput) ok.classList.add('danger'); else ok.classList.remove('danger')
    inp.value = value
    $('dlg').classList.remove('hidden')
    setTimeout(() => { inp.focus(); inp.select() }, 0)
    const done = v => {
      $('dlg').classList.add('hidden')
      ok.onclick = null; cancel.onclick = null; inp.onkeydown = null
      dlgBusy = false
      resolve(v)
    }
    ok.onclick = () => done(opts.noInput ? true : (inp.value.trim() || null))
    cancel.onclick = () => done(null)
    inp.onkeydown = e => {
      if (e.key === 'Enter' && !opts.noInput) ok.onclick()
      else if (e.key === 'Escape') cancel.onclick()
    }
  })
}
export const askConfirm = title => promptText(title, '', { noInput: true })
