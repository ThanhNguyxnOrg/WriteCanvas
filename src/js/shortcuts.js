// Platform-aware keyboard shortcuts: labels, aria tokens and the help sheet.
// Handlers accept Ctrl on Windows/Linux and Cmd on macOS; only the visible
// hints differ so no OS advertises another platform's chord.
import { bridge } from './bridge.js'

const FALLBACK = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent)
  ? 'darwin'
  : 'win32'

export const PLATFORM = bridge && ['darwin', 'win32', 'linux'].includes(bridge.platform)
  ? bridge.platform
  : FALLBACK

// Linux is a first-class target, not a fallback. It shares Windows' Ctrl
// chords but keeps its own label in the help sheet.
const CHORDS = {
  darwin: {
    label: 'macOS', mod: '⌘', ctrl: '⌃', shift: '⇧', join: '',
    ariaMod: 'Meta', redo: '⇧⌘Z', redoAria: 'Meta+Shift+Z',
  },
  win32: {
    label: 'Windows', mod: 'Ctrl', ctrl: 'Ctrl', shift: 'Shift', join: '+',
    ariaMod: 'Control', redo: 'Ctrl+Y', redoAria: 'Control+Y',
  },
  linux: {
    label: 'Linux', mod: 'Ctrl', ctrl: 'Ctrl', shift: 'Shift', join: '+',
    ariaMod: 'Control', redo: 'Ctrl+Y', redoAria: 'Control+Y',
  },
}

const chords = platform => CHORDS[platform] || CHORDS.win32

export const PLATFORM_LABEL = chords(PLATFORM).label

export function platformLabel(platform = PLATFORM) {
  return chords(platform).label
}

export function modShortcut(key, { shift = false, platform = PLATFORM } = {}) {
  const c = chords(platform)
  if (c.join === '') return `${shift ? c.shift : ''}${c.mod}${key}`
  return `${c.mod}${c.join}${shift ? c.shift + c.join : ''}${key}`
}

export function controlShortcut(key, { platform = PLATFORM } = {}) {
  const c = chords(platform)
  return `${c.ctrl}${c.join}${key}`
}

export function redoShortcut(platform = PLATFORM) {
  return chords(platform).redo
}

export function modAria(key, { shift = false, platform = PLATFORM } = {}) {
  return `${chords(platform).ariaMod}+${shift ? 'Shift+' : ''}${key}`
}

export function redoAria(platform = PLATFORM) {
  return chords(platform).redoAria
}

const HELP = () => `? / ${modShortcut('/')}`

const GROUPS = [
  {
    title: 'File',
    rows: [
      ['New note', () => modShortcut('N')],
      ['Save all changed pages', () => modShortcut('S')],
      ['Save & export menu', () => modShortcut('E')],
      ['Open library menu', () => modShortcut('O')],
    ],
  },
  {
    title: 'Edit',
    rows: [
      ['Undo', () => modShortcut('Z')],
      ['Redo', () => redoShortcut()],
    ],
  },
  {
    title: 'Pages',
    rows: [
      ['Previous page', () => controlShortcut('PageUp')],
      ['Next page', () => controlShortcut('PageDown')],
    ],
  },
  {
    title: 'Tools',
    rows: [
      ['Laser pointer', () => 'V'],
      ['Eraser', () => 'E'],
      ['Ruler', () => 'R'],
      ['Shapes & text', () => 'G'],
      ['Text box', () => 'T'],
      ['Pan while held', () => 'Space'],
    ],
  },
  {
    title: 'View',
    rows: [
      ['Zoom in', () => modShortcut('=')],
      ['Zoom out', () => modShortcut('-')],
      ['Reset zoom', () => modShortcut('0')],
    ],
  },
  {
    title: 'General',
    rows: [
      ['Keyboard shortcuts', HELP],
      ['Close panel / cancel', () => 'Esc'],
    ],
  },
]

function hint(id, title, label, aria) {
  const el = document.getElementById(id)
  if (!el) return
  el.title = `${title} (${label})`
  el.setAttribute('aria-keyshortcuts', aria)
}

export function applyShortcutHints() {
  hint('btnMenu', 'Library and menu', modShortcut('O'), modAria('O'))
  hint('btnSave', 'Save all changed pages', modShortcut('S'), modAria('S'))
  hint('btnSaveMore', 'Save options and export', modShortcut('E'), modAria('E'))
  hint('btnUndo', 'Undo', modShortcut('Z'), modAria('Z'))
  hint('btnRedo', 'Redo', redoShortcut(), redoAria())
  hint('btnNew', 'New note', modShortcut('N'), modAria('N'))
  hint('btnPrevPage', 'Previous page', controlShortcut('PageUp'), 'Control+PageUp')
  hint('btnNextPage', 'Next page', controlShortcut('PageDown'), 'Control+PageDown')
  const pan = document.getElementById('tbEye')
  if (pan) pan.title = 'Pan and view — hold Space to pan'
  const help = document.getElementById('libShortcutHint')
  if (help) help.textContent = '?'
}

let lastFocus = null

export function isShortcutSheetOpen() {
  const sheet = document.getElementById('shortcutSheet')
  return !!sheet && !sheet.classList.contains('hidden')
}

function buildShortcutSheet() {
  const list = document.getElementById('shortcutList')
  const platform = document.getElementById('shortcutPlatform')
  if (platform) platform.textContent = `${PLATFORM_LABEL} shortcuts`
  if (!list) return
  list.textContent = ''
  for (const group of GROUPS) {
    const section = document.createElement('section')
    section.className = 'shortcut-group'
    const heading = document.createElement('h3')
    heading.textContent = group.title
    section.appendChild(heading)
    for (const [label, keys] of group.rows) {
      const row = document.createElement('div')
      row.className = 'shortcut-row'
      const name = document.createElement('span')
      name.textContent = label
      const key = document.createElement('kbd')
      key.textContent = keys()
      row.append(name, key)
      section.appendChild(row)
    }
    list.appendChild(section)
  }
}

export function openShortcutSheet() {
  const sheet = document.getElementById('shortcutSheet')
  if (!sheet || !sheet.classList.contains('hidden')) return
  lastFocus = document.activeElement
  buildShortcutSheet()
  sheet.classList.remove('hidden')
  document.getElementById('shortcutClose')?.focus()
}

export function closeShortcutSheet() {
  const sheet = document.getElementById('shortcutSheet')
  if (!sheet || sheet.classList.contains('hidden')) return
  sheet.classList.add('hidden')
  if (lastFocus && lastFocus.focus) lastFocus.focus()
  lastFocus = null
}

export function initShortcutSheet() {
  const sheet = document.getElementById('shortcutSheet')
  if (!sheet) return
  document.getElementById('shortcutClose')?.addEventListener('click', closeShortcutSheet)
  sheet.addEventListener('pointerdown', e => { if (e.target === sheet) closeShortcutSheet() })
  document.addEventListener('keydown', e => {
    if (!isShortcutSheetOpen()) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeShortcutSheet()
    } else if (e.key === 'Tab') {
      // The sheet is informational; keep the focus ring on its only control.
      e.preventDefault()
      document.getElementById('shortcutClose')?.focus()
    }
  }, true)
}
