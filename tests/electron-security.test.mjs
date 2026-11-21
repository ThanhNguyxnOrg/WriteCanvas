import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isTrustedSender, guardedIpc } from '../main/ipc-guard.js'
import { applyWindowPolicy, applyPermissionPolicy } from '../main/window-policy.js'

const url = 'file:///app/src/index.html'
function fixture() {
  const frame = { url }
  const contents = { mainFrame: frame, getURL: () => url, isDestroyed: () => false }
  const win = { webContents: contents, isDestroyed: () => false }
  return { win, event: { sender: contents, senderFrame: frame } }
}

test('IPC requires the current live window, main frame, and exact document URL', () => {
  const { win, event } = fixture()
  assert.equal(isTrustedSender(event, win, url), true)
  for (const invalid of [null, {}, { ...event, sender: {} },
    { ...event, senderFrame: null }, { ...event, senderFrame: { url } }]) {
    assert.equal(isTrustedSender(invalid, win, url), false)
  }
  assert.equal(isTrustedSender(event, null, url), false)
  assert.equal(isTrustedSender(event, fixture().win, url), false)
  assert.equal(isTrustedSender(event, { ...win, isDestroyed: () => true }, url), false)
  win.webContents.isDestroyed = () => true
  assert.equal(isTrustedSender(event, win, url), false)
  win.webContents.isDestroyed = () => false
  for (const other of ['https://example.com/', 'about:blank', `${url}?x`, `${url}#x`, '']) {
    event.senderFrame.url = other
    assert.equal(isTrustedSender(event, win, url), false)
  }
  event.senderFrame.url = url
  win.webContents.getURL = () => 'about:blank'
  assert.equal(isTrustedSender(event, win, url), false)
})

test('guarded invokes throw, sends ignore unauthorized callers, and window lookup stays current', () => {
  const handlers = {}, listeners = {}
  const { win, event } = fixture()
  let current = win, calls = 0
  const ipc = guardedIpc({
    handle: (name, cb) => { handlers[name] = cb },
    on: (name, cb) => { listeners[name] = cb },
  }, () => current, url)
  ipc.handle('read', (e, value) => { assert.equal(e, event); calls++; return value })
  ipc.on('write', (e, value) => { assert.equal(e, event); calls += value })
  assert.equal(handlers.read(event, 7), 7)
  listeners.write(event, 2)
  assert.equal(calls, 3)
  for (const invalid of [undefined, {}, { ...event, senderFrame: { url } }]) {
    assert.throws(() => handlers.read(invalid), /Unauthorized IPC sender/)
    assert.doesNotThrow(() => listeners.write(invalid, 10))
  }
  current = fixture().win
  assert.throws(() => handlers.read(event), /Unauthorized IPC sender/)
  listeners.write(event, 10)
  current = null
  assert.throws(() => handlers.read(event), /Unauthorized IPC sender/)
  listeners.write(event, 10)
  assert.equal(calls, 3)
})

test('authorized handler errors propagate', async () => {
  const { win, event } = fixture()
  let handler
  guardedIpc({ handle: (_name, cb) => { handler = cb } }, () => win, url)
    .handle('fail', async () => { throw new Error('disk failed') })
  await assert.rejects(handler(event), /disk failed/)
})

test('app and PDF policies allow only their exact document and deny popups', () => {
  for (const document of [url, 'file:///tmp/wc-pdf/pages.html']) {
    const listeners = {}
    let open
    applyWindowPolicy({
      on: (name, cb) => { listeners[name] = cb },
      setWindowOpenHandler: cb => { open = cb },
    }, document)
    for (const name of ['will-navigate', 'will-redirect']) {
      for (const target of [document, 'https://example.com', 'file:///etc/passwd', 'about:blank', '', undefined]) {
        let prevented = false
        listeners[name]({ preventDefault() { prevented = true } }, target)
        assert.equal(prevented, target !== document)
      }
    }
    assert.deepEqual(open({ url: document }), { action: 'deny' })
    assert.deepEqual(open({ url: 'https://example.com' }), { action: 'deny' })
  }
})

test('permissions are denied even for trusted documents or unknown requests', () => {
  let request, check
  applyPermissionPolicy({
    setPermissionRequestHandler: cb => { request = cb },
    setPermissionCheckHandler: cb => { check = cb },
  })
  for (const permission of ['clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'media', 'notifications', '', undefined]) {
    let result
    request({}, permission, allowed => { result = allowed }, { requestingUrl: url })
    assert.equal(result, false)
    assert.equal(check(null, permission, url, {}), false)
  }
})

test('all main IPC registrations use the guarded adapter', () => {
  const source = readFileSync(new URL('../main/main.js', import.meta.url), 'utf8')
  assert.match(source, /const ipcMain = guardedIpc\(electronIpcMain, \(\) => win, trustedAppURL\)/)
  assert.doesNotMatch(source, /electronIpcMain\.(handle|on)\(/)
  const start = source.indexOf('function registerIpc()')
  const end = source.indexOf('async function chooseRoot(')
  const registrations = [...source.matchAll(/ipcMain\.(?:handle|on)\(/g)]
  assert.ok(registrations.length > 0)
  assert.ok(registrations.every(match => match.index > start && match.index < end))
})
