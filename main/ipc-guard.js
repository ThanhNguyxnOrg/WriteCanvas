'use strict'

const { sameAppDocument } = require('./app-document')

function isTrustedSender(event, win, trustedURL) {
  if (!event || !win || win.isDestroyed()) return false
  const contents = win.webContents
  if (!contents || contents.isDestroyed()) return false
  const frame = event.senderFrame
  return event.sender === contents && !!frame && frame === contents.mainFrame &&
    sameAppDocument(frame.url, trustedURL) && sameAppDocument(contents.getURL(), trustedURL)
}

function guardedIpc(ipc, getWindow, trustedURL) {
  return {
    handle(channel, handler) {
      ipc.handle(channel, (event, ...args) => {
        if (!isTrustedSender(event, getWindow(), trustedURL)) throw new Error('Unauthorized IPC sender')
        return handler(event, ...args)
      })
    },
    on(channel, handler) {
      ipc.on(channel, (event, ...args) => {
        if (isTrustedSender(event, getWindow(), trustedURL)) handler(event, ...args)
      })
    },
  }
}

module.exports = { isTrustedSender, guardedIpc }
