import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  modShortcut,
  controlShortcut,
  redoShortcut,
  modAria,
  redoAria,
  platformLabel,
} from '../src/js/shortcuts.js'

describe('platform shortcut labels', () => {
  it('names all three desktop targets explicitly', () => {
    assert.equal(platformLabel('darwin'), 'macOS')
    assert.equal(platformLabel('win32'), 'Windows')
    assert.equal(platformLabel('linux'), 'Linux')
  })

  it('uses ⌘ on macOS and Ctrl on Windows and Linux', () => {
    assert.equal(modShortcut('S', { platform: 'darwin' }), '⌘S')
    assert.equal(modShortcut('S', { platform: 'win32' }), 'Ctrl+S')
    assert.equal(modShortcut('S', { platform: 'linux' }), 'Ctrl+S')
    assert.equal(modShortcut('Z', { shift: true, platform: 'darwin' }), '⇧⌘Z')
    assert.equal(modShortcut('Z', { shift: true, platform: 'win32' }), 'Ctrl+Shift+Z')
  })

  it('uses the platform-standard redo chord', () => {
    assert.equal(redoShortcut('darwin'), '⇧⌘Z')
    assert.equal(redoShortcut('win32'), 'Ctrl+Y')
    assert.equal(redoShortcut('linux'), 'Ctrl+Y')
  })

  it('keeps page navigation on Control across platforms', () => {
    assert.equal(controlShortcut('PageUp', { platform: 'darwin' }), '⌃PageUp')
    assert.equal(controlShortcut('PageUp', { platform: 'win32' }), 'Ctrl+PageUp')
    assert.equal(controlShortcut('PageDown', { platform: 'linux' }), 'Ctrl+PageDown')
  })

  it('uses ARIA modifier names instead of glyphs', () => {
    assert.equal(modAria('S', { platform: 'darwin' }), 'Meta+S')
    assert.equal(modAria('S', { platform: 'win32' }), 'Control+S')
    assert.equal(modAria('Z', { shift: true, platform: 'darwin' }), 'Meta+Shift+Z')
    assert.equal(redoAria('darwin'), 'Meta+Shift+Z')
    assert.equal(redoAria('linux'), 'Control+Y')
  })
})
