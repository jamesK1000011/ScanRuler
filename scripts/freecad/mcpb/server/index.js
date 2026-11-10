#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// FreeCAD Agent Link as a Claude Desktop extension: the MCP server Claude
// starts. It finds FreeCAD on this Mac, puts the two add-ons bundled with it
// (Agent Link and ScanRuler for FreeCAD) into FreeCAD's Mod folder so the
// workbench and its Start link button are there, then serves:
//   - through the FreeCAD window, when the window's link is on (Start link
//     in the Agent Link workbench) — the person watches the work happen;
//   - else headless, FreeCAD's own Python with no window.
// Only JSON-RPC lines reach Claude: anything else FreeCAD prints goes to
// the log.

'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { spawn, spawnSync } = require('child_process')
const readline = require('readline')

const HOME = os.homedir()
const HERE = path.dirname(__dirname)
const ADDONS = path.join(HERE, 'addons')
const PORT = Number(process.env.AGENTLINK_PORT || 7318)
const OUT = expand(process.env.AGENTLINK_OUT || path.join(HOME, 'AgentLink'))
const LOG_DIR = path.join(HOME, 'Library', 'Logs', 'FreeCAD Agent Link')

fs.mkdirSync(LOG_DIR, { recursive: true })
const logFile = fs.createWriteStream(path.join(LOG_DIR, 'launcher.log'), { flags: 'a' })
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`
  logFile.write(line)
  process.stderr.write(line)
}

function expand(p) {
  return p.replace(/^~(?=$|\/)/, HOME).replace(/\$\{HOME\}/g, HOME)
}

function findApp() {
  const given = process.env.FREECAD_APP && expand(process.env.FREECAD_APP)
  const roots = ['/Applications', path.join(HOME, 'Applications')]
  const candidates = given ? [given] : []
  for (const r of roots) {
    try {
      for (const n of fs.readdirSync(r)) if (/^FreeCAD.*\.app$/i.test(n)) candidates.push(path.join(r, n))
    } catch {}
  }
  // The plain name first, then the newest-looking.
  candidates.sort((a, b) => (path.basename(a) === 'FreeCAD.app' ? -1 : path.basename(b) === 'FreeCAD.app' ? 1 : b.localeCompare(a)))
  for (const app of candidates) {
    const bin = path.join(app, 'Contents', 'Resources', 'bin')
    const lib = path.join(app, 'Contents', 'Resources', 'lib')
    const py = ['python3', 'python'].map((n) => path.join(bin, n)).find((p) => fs.existsSync(p))
    const cmd = ['freecadcmd', 'FreeCADCmd'].map((n) => path.join(bin, n)).find((p) => fs.existsSync(p))
    if (py || cmd) return { app, bin, lib, py, cmd }
  }
  return null
}

function env(fc, extra = {}) {
  const e = { ...process.env, ...extra }
  // FreeCAD's own bin first: gmsh, ccx and its Python live there.
  e.PATH = [fc.bin, '/opt/homebrew/bin', '/usr/local/bin', e.PATH || ''].join(':')
  return e
}

/** FreeCAD's per-user folder, asked of FreeCAD itself (it differs by version). */
function userDir(fc) {
  const code = "import FreeCAD,sys;sys.stdout.write('@@'+FreeCAD.getUserAppDataDir()+'@@')"
  const tries = []
  if (fc.py) tries.push([fc.py, ['-c', `import sys;sys.path.append(${JSON.stringify(fc.lib)});${code}`]])
  if (fc.cmd) tries.push([fc.cmd, ['-c', code]])
  for (const [exe, args] of tries) {
    const r = spawnSync(exe, args, { env: env(fc), encoding: 'utf8', timeout: 60000 })
    const m = /@@(.+?)@@/.exec((r.stdout || '') + (r.stderr || ''))
    if (m) return m[1]
    log('could not ask', exe, 'for its user folder:', (r.stderr || r.error || '').toString().slice(0, 400))
  }
  return null
}

function bundledVersion() {
  try {
    return fs.readFileSync(path.join(ADDONS, 'VERSION'), 'utf8').trim()
  } catch {
    return 'unknown'
  }
}

/** The add-ons into FreeCAD's Mod folder, when they are not there at this
 *  version already. Files of this version are written over; nothing else
 *  of the person's is touched. */
function install(modDir) {
  const v = bundledVersion()
  const stamp = path.join(modDir, 'AgentLink', '.installed-version')
  let have = null
  try {
    have = fs.readFileSync(stamp, 'utf8').trim()
  } catch {}
  if (have === v) return false
  fs.mkdirSync(modDir, { recursive: true })
  for (const name of ['AgentLink', 'ScanRulerFC']) {
    fs.cpSync(path.join(ADDONS, name), path.join(modDir, name), { recursive: true, force: true })
  }
  fs.writeFileSync(stamp, v + '\n')
  log(`installed the add-ons (${v}) into ${modDir}`)
  return true
}

function windowLink() {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: '127.0.0.1', port: PORT })
    const done = (ok) => {
      s.removeAllListeners()
      if (!ok) s.destroy()
      resolve(ok ? s : null)
    }
    s.setTimeout(700, () => done(false))
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
  })
}

/** Lines from a stream to Claude: JSON-RPC only, the rest to the log. */
function protocolOut(stream, tag) {
  const rl = readline.createInterface({ input: stream })
  rl.on('line', (line) => {
    if (line.startsWith('{')) process.stdout.write(line + '\n')
    else if (line.trim()) log(`${tag}:`, line)
  })
  return rl
}

async function main() {
  log(`start: node ${process.version}, out ${OUT}`)
  fs.mkdirSync(OUT, { recursive: true })
  const fc = findApp()
  if (!fc) {
    log('FreeCAD not found in /Applications or ~/Applications; set "FreeCAD app" in the extension settings.')
    serveError('FreeCAD was not found in /Applications or ~/Applications. Install FreeCAD 1.0 or later, or set the FreeCAD app path in this extension’s settings, then restart Claude.')
    return
  }
  log('FreeCAD:', fc.app)
  const ud = userDir(fc)
  let modDir = null
  if (ud) {
    modDir = path.join(ud, 'Mod')
    try {
      install(modDir)
    } catch (e) {
      log('install failed:', e.message)
    }
  }

  const sock = await windowLink()
  if (sock) {
    log(`relaying to the FreeCAD window on port ${PORT}`)
    process.stdin.pipe(sock)
    protocolOut(sock, 'window')
    sock.on('close', () => process.exit(0))
    return
  }

  // Headless: the add-ons from the Mod folder (else the bundle), FreeCAD's
  // Python, no window.
  const base = modDir && fs.existsSync(path.join(modDir, 'AgentLink')) ? modDir : ADDONS
  const script = path.join(base, 'AgentLink', 'agentlink_headless.py')
  const pyPath = [path.join(base, 'AgentLink'), path.join(base, 'ScanRulerFC'), fc.lib].join(':')
  const e = env(fc, { AGENTLINK_OUT: OUT, FREECAD_LIB: fc.lib, PYTHONPATH: pyPath, PYTHONUNBUFFERED: '1' })
  const [exe, args] = fc.py ? [fc.py, [script, '--out', OUT]] : [fc.cmd, [script]]
  log('headless:', exe, args.join(' '))
  const child = spawn(exe, args, { env: e, cwd: OUT, stdio: ['pipe', 'pipe', 'pipe'] })
  process.stdin.pipe(child.stdin)
  protocolOut(child.stdout, 'freecad')
  readline.createInterface({ input: child.stderr }).on('line', (l) => logFile.write(`freecad! ${l}\n`))
  child.on('exit', (code, sig) => {
    log(`headless FreeCAD ended (${code ?? sig})`)
    process.exit(code ?? 1)
  })
  process.stdin.on('end', () => child.stdin.end())
}

/** No FreeCAD: still a server, so Claude shows why instead of a dead entry. */
function serveError(message) {
  const rl = readline.createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.id === undefined) return
    let result
    if (msg.method === 'initialize') result = { protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'freecad-agentlink', version: bundledVersion() }, instructions: message }
    else if (msg.method === 'tools/list') result = { tools: [{ name: 'freecad_status', description: 'Why FreeCAD Agent Link is not running.', inputSchema: { type: 'object', properties: {} } }] }
    else if (msg.method === 'tools/call') result = { content: [{ type: 'text', text: message }], isError: true }
    else result = {}
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n')
  })
}

main().catch((e) => {
  log('launcher failed:', e.stack || e.message)
  process.exit(1)
})
