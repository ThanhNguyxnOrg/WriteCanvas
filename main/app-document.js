'use strict'

const path = require('node:path')
const { fileURLToPath } = require('node:url')

function sameAppDocument(url, trustedURL, platform = process.platform) {
  try {
    const windows = platform === 'win32'
    const paths = windows ? path.win32 : path.posix
    const normalize = value => {
      const parsed = new URL(value)
      if (parsed.protocol !== 'file:') throw new Error('not a file URL')
      parsed.search = ''
      parsed.hash = ''
      const normalized = paths.normalize(fileURLToPath(parsed, { windows }))
      return windows ? normalized.toLowerCase() : normalized
    }
    return normalize(url) === normalize(trustedURL)
  } catch {
    return false
  }
}

module.exports = { sameAppDocument }
