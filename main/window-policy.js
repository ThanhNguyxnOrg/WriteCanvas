'use strict'

function applyWindowPolicy(contents, trustedURL) {
  const preventUntrusted = (event, url) => {
    if (url !== trustedURL) event.preventDefault()
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
