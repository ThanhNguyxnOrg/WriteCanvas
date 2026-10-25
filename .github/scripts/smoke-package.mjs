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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const PORT = 9433
const TIMEOUT_MS = 60_000

const fail = message => {
  console.error(`::error::${message}`)
  process.exit(1)
}

function findExecutable() {
  if (existsSync('dist/win-unpacked/WriteCanvas.exe')) {
    return { command: 'dist/win-unpacked/WriteCanvas.exe', args: [] }
  }

  if (existsSync('dist/linux-unpacked')) {
    const bin = readdirSync('dist/linux-unpacked').find(name => /^writecanvas$/i.test(name))
    if (bin) return { command: join('dist/linux-unpacked', bin), args: ['--no-sandbox'] }
  }

  if (existsSync('dist')) {
    for (const entry of readdirSync('dist')) {
      if (!entry.startsWith('mac')) continue
      const dir = join('dist', entry)
      if (!statSync(dir).isDirectory()) continue
      for (const app of readdirSync(dir)) {
        if (!app.endsWith('.app')) continue
        const macos = join(dir, app, 'Contents', 'MacOS')
        if (!existsSync(macos)) continue
        const bin = app.replace(/\.app$/, '')
        if (existsSync(join(macos, bin))) return { command: join(macos, bin), args: [] }
      }
    }
  }
  return null
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function evaluate(expression) {
  let targets = []
  for (let i = 0; i < TIMEOUT_MS / 500; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      if (targets.some(t => t.type === 'page')) break
    } catch { /* the port is not open yet */ }
    await wait(500)
  }
  const page = targets.find(t => t.type === 'page')
  if (!page) throw new Error('the app never exposed a page over the DevTools protocol')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('could not connect to the page')), { once: true })
  })
  let id = 0
  const result = await new Promise(resolve => {
    const myId = ++id
    const onMessage = event => {
      const message = JSON.parse(event.data)
      if (message.id !== myId) return
      ws.removeEventListener('message', onMessage)
      resolve(message.result?.result?.value)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id: myId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  })
  ws.close()
  if (typeof result !== 'string') throw new Error('the page did not answer the startup check')
  return JSON.parse(result)
}

const executable = findExecutable()
if (!executable) fail('no packaged executable found under dist/')

const sandbox = mkdtempSync(join(tmpdir(), 'wc-smoke-'))
const profile = join(sandbox, 'profile')
const library = join(sandbox, 'library')
for (const dir of [profile, library]) mkdirSync(dir, { recursive: true })
writeFileSync(join(profile, 'config.json'), JSON.stringify({ root: library.split('\\').join('/') }))

const env = { ...process.env }
// Some CI shells export this, and Electron would then run main.js as plain Node.
delete env.ELECTRON_RUN_AS_NODE

let command = executable.command
let args = [...executable.args, `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--disable-gpu', '--disable-dev-shm-usage']
if (process.platform === 'linux' && !process.env.DISPLAY) {
  command = 'xvfb-run'
  args = ['-a', executable.command, ...args]
}

console.log(`launching ${command} ${args.join(' ')}`)
const child = spawn(command, args, { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] })
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
  const state = await evaluate(`JSON.stringify({
    bridge: typeof window.WriteCanvasHost,
    platform: window.WriteCanvasHost && window.WriteCanvasHost.platform,
    tools: document.querySelectorAll('.tb-toggle').length,
    canvas: !!document.getElementById('stackInner'),
    bridgeError: /No host bridge/.test(document.body.innerText)
  })`)

  if (state.bridge !== 'object') fail(`the app started without the bridge (${JSON.stringify(state)})`)
  if (state.bridgeError) fail('the app is showing the "No host bridge" message')
  if (!state.canvas || state.tools < 1) fail(`the editor did not render (${JSON.stringify(state)})`)

  console.log(`::notice::launched ${executable.command} as ${state.platform}; bridge present, ${state.tools} tool toggles`)
} catch (error) {
  console.error(output.split('\n').slice(-20).join('\n'))
  fail(error.message)
} finally {
  stop()
  try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* a locked temp dir is harmless */ }
}