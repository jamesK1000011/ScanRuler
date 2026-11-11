#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// FreeCAD Agent Link as a Claude Desktop extension: the MCP server Claude
// starts. It finds FreeCAD on this Mac, puts the two add-ons bundled with it
// (Agent Link and ScanRuler for FreeCAD) into FreeCAD's Mod folder so the
// workbench and its Start link button are there — the newest from GitHub
// when it can be reached — then serves:
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
// The launcher itself updates too: a newer copy fetched last time (see
// update) runs in place of this one, told where the extension's own files
// are. A copy that fails to load leaves this one to serve.
const LAUNCHER = path.join(HOME, '.config', 'freecad-agentlink', 'launcher', 'index.js')
let delegated = false
if (!process.env.AGENTLINK_BUNDLE && process.env.AGENTLINK_UPDATE !== 'false' && fs.existsSync(LAUNCHER)) {
  process.env.AGENTLINK_BUNDLE = path.dirname(__dirname)
  try {
    require(LAUNCHER)
    delegated = true
  } catch (e) {
    process.stderr.write(`freecad-agentlink: the updated launcher did not load (${e.message}); the installed one serves\n`)
  }
}
const HERE = process.env.AGENTLINK_BUNDLE || path.dirname(__dirname)
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

// The add-ons as published on GitHub: fetched when either branch moves, so
// a fix reaches this Mac without a new extension. The bundled copy is the
// fallback when GitHub cannot be reached.
const OWNER = 'jamesK1000011'
const SOURCES = [
  { repo: 'FreeCAD', branch: 'agent-link', folder: 'src/Mod/AgentLink', dest: 'AgentLink' },
  { repo: 'ScanRuler', branch: 'freecad-spike', folder: 'freecad/ScanRulerFC', dest: 'ScanRulerFC' },
]
const CACHE = path.join(HOME, '.config', 'freecad-agentlink')

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'freecad-agentlink', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r.json()
}

async function getFile(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'freecad-agentlink' }, signal: AbortSignal.timeout(30000) })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

/** A branch's head commit from git's own ref list (smart HTTP), which is
 *  not held to the GitHub API's 60 calls an hour; the API if that fails. */
async function headSha(repo, branch) {
  try {
    const text = (await getFile(`https://github.com/${OWNER}/${repo}.git/info/refs?service=git-upload-pack`)).toString('utf8')
    const m = text.match(new RegExp(`([0-9a-f]{40}) refs/heads/${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\n|\0|$)`))
    if (m) return m[1]
  } catch (e) {
    log(`ref list for ${repo} failed (${e.message}); asking the API`)
  }
  return (await getJson(`https://api.github.com/repos/${OWNER}/${repo}/commits/${branch}`)).sha
}

/** The add-on's files at a commit: its FILES list (one path a line), read
 *  as a plain file; the API's tree for a commit from before there was one. */
async function addonFiles(s, sha) {
  try {
    const text = (await getFile(`https://raw.githubusercontent.com/${OWNER}/${s.repo}/${sha}/${s.folder}/FILES`)).toString('utf8')
    const files = text.split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'))
    if (files.length) return files
  } catch {}
  const [parent, name] = [s.folder.slice(0, s.folder.lastIndexOf('/')), s.folder.slice(s.folder.lastIndexOf('/') + 1)]
  const listing = await getJson(`https://api.github.com/repos/${OWNER}/${s.repo}/contents/${parent}?ref=${sha}`)
  const sub = listing.find((x) => x.name === name && x.type === 'dir')
  const tree = await getJson(`https://api.github.com/repos/${OWNER}/${s.repo}/git/trees/${sub.sha}?recursive=1`)
  return tree.tree.filter((x) => x.type === 'blob').map((x) => x.path)
}

/** The cached add-ons brought up to the branches' heads. Returns the folder
 *  holding AgentLink and ScanRulerFC, and its version, or null. */
/** A fetched launcher must parse before it is kept: as Node loads a file,
 *  a first line #! is not code. */
function checkLauncher(text) {
  new Function('require', 'module', 'exports', '__dirname', '__filename', text.toString('utf8').replace(/^#!.*/, ''))
}

async function update() {
  // A folder holding AgentLink and ScanRuler for FreeCAD stands in for
  // GitHub: an install from a checkout, offline, or under test.
  const from = process.env.AGENTLINK_UPDATE_FROM && expand(process.env.AGENTLINK_UPDATE_FROM)
  if (from) {
    if (!fs.existsSync(path.join(from, 'AgentLink'))) throw new Error(`${from} holds no AgentLink folder`)
    let v = 'local'
    try {
      v = 'local+' + fs.readFileSync(path.join(from, 'VERSION'), 'utf8').trim()
    } catch {}
    // A launcher beside them is taken too, as one from GitHub would be.
    const next = path.join(from, 'launcher', 'index.js')
    if (fs.existsSync(next)) {
      const text = fs.readFileSync(next)
      checkLauncher(text)
      fs.mkdirSync(path.dirname(LAUNCHER), { recursive: true })
      fs.writeFileSync(LAUNCHER, text)
      fs.writeFileSync(path.join(path.dirname(LAUNCHER), 'package.json'), '{"type": "commonjs"}\n')
    }
    return { dir: from, version: v }
  }
  const stateFile = path.join(CACHE, 'state.json')
  let state = {}
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  } catch {}
  const shas = await Promise.all(SOURCES.map((s) => headSha(s.repo, s.branch)))
  const version = 'github+' + shas.map((x) => x.slice(0, 7)).join('+')
  const dir = path.join(CACHE, 'addons')
  if (state.version === version && fs.existsSync(path.join(dir, 'AgentLink'))) return { dir, version }
  const stage = fs.mkdtempSync(path.join(CACHE, 'stage-'))
  try {
    for (const [i, s] of SOURCES.entries()) {
      const files = (await addonFiles(s, shas[i])).filter((p) => !/(^|\/)(__pycache__|tests)\//.test(p)).map((p) => ({ path: p }))
      for (let k = 0; k < files.length; k += 8) {
        await Promise.all(files.slice(k, k + 8).map(async (f) => {
          const data = await getFile(`https://raw.githubusercontent.com/${OWNER}/${s.repo}/${shas[i]}/${s.folder}/${f.path}`)
          const p = path.join(stage, s.dest, f.path)
          fs.mkdirSync(path.dirname(p), { recursive: true })
          fs.writeFileSync(p, data)
        }))
      }
    }
    // The launcher, from the same branch as ScanRuler for FreeCAD.
    const sr = SOURCES.findIndex((x) => x.repo === 'ScanRuler')
    const launcher = await getFile(`https://raw.githubusercontent.com/${OWNER}/ScanRuler/${shas[sr]}/scripts/freecad/mcpb/server/index.js`)
    checkLauncher(launcher) // parses, or throws
    fs.rmSync(dir, { recursive: true, force: true })
    fs.renameSync(stage, dir)
    fs.mkdirSync(path.dirname(LAUNCHER), { recursive: true })
    fs.writeFileSync(LAUNCHER, launcher)
    // CommonJS whatever a package.json further up says, or require fails.
    fs.writeFileSync(path.join(path.dirname(LAUNCHER), 'package.json'), '{"type": "commonjs"}\n')
    fs.writeFileSync(stateFile, JSON.stringify({ version, at: new Date().toISOString() }))
    log(`fetched the add-ons from GitHub (${version})`)
    return { dir, version }
  } catch (e) {
    fs.rmSync(stage, { recursive: true, force: true })
    throw e
  }
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
function install(modDir, src = ADDONS, v = bundledVersion()) {
  const stamp = path.join(modDir, 'AgentLink', '.installed-version')
  let have = null
  try {
    have = fs.readFileSync(stamp, 'utf8').trim()
  } catch {}
  if (have === v) return false
  fs.mkdirSync(modDir, { recursive: true })
  for (const name of ['AgentLink', 'ScanRulerFC']) {
    fs.cpSync(path.join(src, name), path.join(modDir, name), { recursive: true, force: true })
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
  let src = { dir: ADDONS, version: bundledVersion() }
  if (process.env.AGENTLINK_UPDATE !== 'false') {
    try {
      fs.mkdirSync(CACHE, { recursive: true })
      src = (await update()) || src
      // A launcher newer than this one came with it: it serves from now,
      // not from the next start.
      if (!process.env.AGENTLINK_RELAUNCHED && fs.existsSync(LAUNCHER) && fs.readFileSync(LAUNCHER, 'utf8') !== fs.readFileSync(__filename, 'utf8')) {
        process.env.AGENTLINK_RELAUNCHED = '1'
        process.env.AGENTLINK_BUNDLE = HERE
        try {
          delete require.cache[require.resolve(LAUNCHER)]
          require(LAUNCHER)
          log('handed over to the launcher just fetched')
          return
        } catch (e) {
          log('the launcher just fetched did not load; this one serves:', e.message)
        }
      }
    } catch (e) {
      log('no update from GitHub, the bundled add-ons serve:', e.message)
      const cached = path.join(CACHE, 'addons')
      try {
        const st = JSON.parse(fs.readFileSync(path.join(CACHE, 'state.json'), 'utf8'))
        if (fs.existsSync(path.join(cached, 'AgentLink'))) src = { dir: cached, version: st.version }
      } catch {}
    }
  }
  const ud = userDir(fc)
  let modDir = null
  if (ud) {
    modDir = path.join(ud, 'Mod')
    try {
      install(modDir, src.dir, src.version)
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
  const base = modDir && fs.existsSync(path.join(modDir, 'AgentLink')) ? modDir : src.dir
  const script = path.join(base, 'AgentLink', 'agentlink_headless.py')
  const pyPath = [path.join(base, 'AgentLink'), path.join(base, 'ScanRulerFC'), fc.lib].join(':')
  const e = env(fc, { AGENTLINK_OUT: OUT, FREECAD_LIB: fc.lib, PYTHONPATH: pyPath, PYTHONUNBUFFERED: '1' })
  const [exe, args] = fc.py ? [fc.py, [script, '--out', OUT]] : [fc.cmd, [script]]
  log('headless:', exe, args.join(' '))
  headless(exe, args, e, { modDir, version: src.version })
}

/** FreeCAD's Python serving, restarted when it dies (a crash in OCC takes the
 *  whole process): every call still waiting is answered with what happened,
 *  and the next call goes to a fresh FreeCAD. The document of the one that
 *  died is gone; the answer says so. */
// The launcher's own tool: the newest add-ons from GitHub, and FreeCAD
// started again on them, without Claude starting again.
const UPDATE_TOOL = {
  name: 'agentlink_update',
  description: 'Fetch the newest Agent Link and ScanRuler for FreeCAD from GitHub and start FreeCAD again on them, without restarting Claude: new tools and fixes from then on. The open document is lost unless saved (doc_save first). Answers the version before and after; the tool list is sent again.',
  inputSchema: { type: 'object', properties: {} },
}

function headless(exe, args, e, inst = {}) {
  const pending = new Map()
  const listing = new Set()
  const initing = new Set()
  let child = null
  let ending = false
  let updating = false
  let restarts = []
  let version = inst.version
  const reply = (id, payload, isError = false) =>
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(payload) }], isError } }) + '\n')
  async function selfUpdate(id) {
    const before = version
    try {
      fs.mkdirSync(CACHE, { recursive: true })
      const got = await update()
      if (!got) throw new Error('GitHub gave nothing')
      if (inst.modDir) install(inst.modDir, got.dir, got.version)
      version = got.version
      if (got.version === before) {
        reply(id, { before, after: version, restarted: false, note: 'Already the newest: nothing to do.' })
        return
      }
      updating = true
      child.kill()
      reply(id, { before, after: version, restarted: true, note: 'FreeCAD started again on the new add-ons: the document is fresh (session_state). New tools are listed.' })
    } catch (err) {
      reply(id, { error: { code: 'unavailable', message: `No update: ${err.message}. The add-ons in place keep serving.` } }, true)
    }
  }
  const send = (line) => {
    if (child && child.stdin.writable) child.stdin.write(line + '\n')
  }
  const start = () => {
    child = spawn(exe, args, { env: e, cwd: OUT, stdio: ['pipe', 'pipe', 'pipe'] })
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      if (!line.startsWith('{')) {
        if (line.trim()) log('freecad:', line)
        return
      }
      let id
      try {
        id = JSON.parse(line).id
      } catch {}
      if (id === '__restart') return
      if (id !== undefined) pending.delete(id)
      if (id !== undefined && initing.has(id)) {
        initing.delete(id)
        try {
          const msg = JSON.parse(line)
          if (msg.result) {
            msg.result.capabilities = msg.result.capabilities || {}
            msg.result.capabilities.tools = { ...(msg.result.capabilities.tools || {}), listChanged: true }
            line = JSON.stringify(msg)
          }
        } catch {}
      }
      if (id !== undefined && listing.has(id)) {
        listing.delete(id)
        try {
          const msg = JSON.parse(line)
          if (msg.result && Array.isArray(msg.result.tools)) {
            msg.result.tools.push(UPDATE_TOOL)
            line = JSON.stringify(msg)
          }
        } catch {}
      }
      process.stdout.write(line + '\n')
    })
    readline.createInterface({ input: child.stderr }).on('line', (l) => logFile.write(`freecad! ${l}\n`))
    child.on('exit', (code, sig) => {
      log(`headless FreeCAD ended (${code ?? sig})`)
      if (ending) process.exit(0)
      const planned = updating
      updating = false
      const why = planned ? 'was started again on the updated add-ons' : sig ? `stopped by ${sig}` : `exited with code ${code}`
      for (const [id, method] of pending) {
        const text = JSON.stringify({ error: { code: 'failed', message: `FreeCAD ${why} during this call and has been started again: the document and everything not saved in it is gone. session_state shows the fresh one; make the part again or doc_open what was saved. If the same call does this again, it is the call — try another way.` } })
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: method === 'tools/call' ? { content: [{ type: 'text', text }], isError: true } : {} }) + '\n')
      }
      pending.clear()
      const now = Date.now()
      restarts = restarts.filter((t) => now - t < 60000)
      if (!planned) restarts.push(now)
      if (restarts.length > 3) {
        log('FreeCAD died more than three times in a minute: giving up')
        process.exit(1)
      }
      start()
      // The fresh process is told the session has begun.
      send(JSON.stringify({ jsonrpc: '2.0', id: '__restart', method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'freecad-agentlink-launcher', version: '1' } } }))
      send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))
      if (planned) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }) + '\n')
    })
  }
  start()
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    let msg = null
    try {
      msg = JSON.parse(line)
    } catch {}
    if (msg && msg.method === 'tools/call' && msg.params && msg.params.name === UPDATE_TOOL.name) {
      selfUpdate(msg.id)
      return
    }
    if (msg && msg.id !== undefined && msg.method) pending.set(msg.id, msg.method)
    if (msg && msg.method === 'tools/list') listing.add(msg.id)
    if (msg && msg.method === 'initialize') initing.add(msg.id)
    send(line)
  }).on('close', () => {
    ending = true
    if (child) child.stdin.end()
  })
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

if (!delegated) {
  main().catch((e) => {
    log('launcher failed:', e.stack || e.message)
    process.exit(1)
  })
}
