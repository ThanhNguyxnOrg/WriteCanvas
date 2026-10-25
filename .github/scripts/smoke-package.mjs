// Launches the packaged application and checks that it actually starts.
//
// The bundle check (verify-package.mjs) proves the files are inside app.asar. It
// cannot prove the installed app opens: a missing native library, a sandbox
// problem, a bad main script or a preload that fails to load all look identical
// from the archive. This runs the real executable from the build output, points
// it at a throwaway profile and library, and asks the page whether the bridge
// exists.
//
// Runs inside each release build job, on its own operating system.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { findPackagedApp } from './package-paths.mjs'

const PORT = 9433
const TIMEOUT_MS = 60_000
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const fail = message => {
  console.error(`::error::${message}`)
  process.exit(1)
}

async function evaluateOn(wsUrl, expression) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('could not connect to the app window')), { once: true })
  })
  try {
    return await new Promise((resolve, reject) => {
      const id = 1
      const timer = setTimeout(() => reject(new Error('the app window did not answer')), 15_000)
      ws.addEventListener('message', event => {
        const message = JSON.parse(event.data)
        if (message.id !== id) return
        clearTimeout(timer)
        if (message.error) return reject(new Error(message.error.message || 'the check failed in the page'))
        resolve(message.result?.result?.value)
      })
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    })
  } finally {
    ws.close()
  }
}

// Startup is not instant: the first target is about:blank while the window
// navigates to src/index.html. Wait for the real page, and retry the check if
// the execution context is replaced mid-navigation.
async function readState(expression) {
  const deadline = Date.now() + TIMEOUT_MS
  let last = 'the app never opened a window'
  while (Date.now() < deadline) {
    let targets = []
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
    } catch {
      await wait(500)
      continue
    }
    const page = targets.find(t => t.type === 'page' && /index\.html/.test(t.url))
    if (!page) {
      last = `waiting for the app window (${targets.map(t => t.url).join(', ') || 'no targets yet'})`
      await wait(500)
      continue
    }
    try {
      const value = await evaluateOn(page.webSocketDebuggerUrl, expression)
      if (typeof value === 'string') return JSON.parse(value)
      last = 'the app window did not return a value'
    } catch (error) {
      last = error.message
    }
    await wait(500)
  }
  throw new Error(last)
}

const app = findPackagedApp()
if (!app) fail('no packaged executable found under dist/')

const sandbox = mkdtempSync(join(tmpdir(), 'wc-smoke-'))
const profile = join(sandbox, 'profile')
const library = join(sandbox, 'library')
for (const dir of [profile, library]) mkdirSync(dir, { recursive: true })
writeFileSync(join(profile, 'config.json'), JSON.stringify({ root: library.split('\\').join('/') }))

const env = { ...process.env }
// Some CI shells export this, and Electron would then run main.js as plain Node.
delete env.ELECTRON_RUN_AS_NODE

const args = [
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${PORT}`,
  '--disable-gpu',
  '--disable-dev-shm-usage',
]
if (process.platform === 'linux') args.unshift('--no-sandbox')

let command = app.exe
let spawnArgs = args
if (process.platform === 'linux' && !process.env.DISPLAY) {
  command = 'xvfb-run'
  spawnArgs = ['-a', app.exe, ...args]
}

console.log(`launching ${command} ${spawnArgs.join(' ')}`)
const child = spawn(command, spawnArgs, { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
child.stdout.on('data', chunk => { output += chunk })
child.stderr.on('data', chunk => { output += chunk })

const stop = () => {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGKILL')
    }
  } catch { /* already gone */ }
}

try {
  const state = await readState(`JSON.stringify({
    bridge: typeof window.WriteCanvasHost,
    platform: window.WriteCanvasHost && window.WriteCanvasHost.platform,
    tools: document.querySelectorAll('.tb-toggle').length,
    canvas: !!document.getElementById('stackInner'),
    bridgeError: /No host bridge/.test(document.body.innerText)
  })`)

  if (state.bridge !== 'object') fail(`the app started without the bridge (${JSON.stringify(state)})`)
  if (state.bridgeError) fail('the app is showing the "No host bridge" message')
  if (!state.canvas || state.tools < 1) fail(`the editor did not render (${JSON.stringify(state)})`)

  console.log(`::notice::launched ${app.exe} as ${state.platform}; bridge present, ${state.tools} tool toggles`)
} catch (error) {
  console.error(output.split('\n').slice(-20).join('\n'))
  fail(error.message)
} finally {
  stop()
  try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* a locked temp dir is harmless */ }
}