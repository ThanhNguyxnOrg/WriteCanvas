'use strict'

const { sameAppDocument } = require('./app-document')

function applyWindowPolicy(contents, trustedURL) {
  const preventUntrusted = (event, url) => {
    if (!sameAppDocument(url, trustedURL)) event.preventDefault()
  }
  contents.on('will-navigate', preventUntrusted)
  contents.on('will-redirect', preventUntrusted)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

function applyPermissionPolicy(session) {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
}

module.exports = { applyWindowPolicy, applyPermissionPolicy }
