#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Agent Link for FreeCAD as a Claude Desktop extension: the MCP server Claude
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
// This launcher's own stamp: a cached copy older than the one installed
// with the extension never runs in its place (no downgrade).
const LAUNCHER_STAMP = 20261114
const stampOf = (file) => {
  try {
    const m = /const LAUNCHER_STAMP = (\d+)/.exec(fs.readFileSync(file, 'utf8'))
    return m ? Number(m[1]) : 0
  } catch {
    return 0
  }
}
let delegated = false
if (!process.env.AGENTLINK_BUNDLE && process.env.AGENTLINK_UPDATE !== 'false' && fs.existsSync(LAUNCHER) && stampOf(LAUNCHER) >= LAUNCHER_STAMP) {
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
  // The newest release by its own version (an older one is often kept
  // beside it as "FreeCAD 1.0.2.app"); the plain name breaks a tie.
  const ver = (app) => {
    try {
      const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8'))
      return m ? m[1].split(/[^0-9]+/).filter(Boolean).map(Number) : []
    } catch { return [] }
  }
  const cmpVer = (x, y) => {
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0)
    return 0
  }
  const found = candidates.slice(given ? 1 : 0)
  found.sort((a, b) => cmpVer(ver(a), ver(b)) || (path.basename(a) === 'FreeCAD.app' ? -1 : path.basename(b) === 'FreeCAD.app' ? 1 : b.localeCompare(a)))
  if (given) found.unshift(candidates[0])
  candidates.splice(0, candidates.length, ...found)
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
  // AddonKit for FreeCAD (14 Nov 2026): the library Agent Link and the
  // add-ons share (records, shapes, fits, data files).
  { repo: 'AddonKit-FreeCAD', branch: 'main', folder: '', dest: 'AddonKit', pin: 'scripts/bakeoff/addonkit-ref' },
  // Agent Link in its own repository since 14 Nov 2026 (it was the FreeCAD
  // fork's agent-link branch, src/Mod/AgentLink): the add-on at its root.
  { repo: 'AgentLink-FreeCAD', branch: 'main', folder: '', dest: 'AgentLink', pin: 'scripts/bakeoff/addon-ref' },
  // ScanRuler for FreeCAD in its own repository since 14 Nov 2026 (it was
  // ScanRuler's freecad/ScanRulerFC).
  { repo: 'ScanRuler-FreeCAD', branch: 'main', folder: '', dest: 'ScanRulerFC', pin: 'scripts/bakeoff/scanrulerfc-ref' },
  // Agent Link for OrcaSlicer (no FreeCAD in it): Agent Link's orca tools,
  // found beside it in the Mod folder.
  { repo: 'AgentLink-OrcaSlicer', branch: 'main', folder: '', dest: 'OrcaLink', pin: 'scripts/bakeoff/orcalink-ref' },
  // Workshop for FreeCAD (14 Nov 2026): plain FreeCAD add-ons whose tools load
  // in Agent Link — Common (the Workshop workbench), Parts (gen_make, gen_part) and Make (fits, threads, encased parts so far).
  { repo: 'Workshop-FreeCAD', branch: 'main', folder: 'Common', dest: 'WorkshopCommon', pin: 'scripts/bakeoff/workshop-ref' },
  { repo: 'Workshop-FreeCAD', branch: 'main', folder: 'Parts', dest: 'WorkshopParts', pin: 'scripts/bakeoff/workshop-ref' },
  { repo: 'Workshop-FreeCAD', branch: 'main', folder: 'Make', dest: 'WorkshopMake', pin: 'scripts/bakeoff/workshop-ref' },
]
// What is installed is what CI checked: each add-on at the commit pinned in
// ScanRuler's freecad-spike (bumped only once the bake-off is green), and
// this launcher from the same commit of ScanRuler.
const CHANNEL = { repo: 'ScanRuler', branch: 'freecad-spike', launcher: 'scripts/freecad/mcpb/server/index.js' }
const NAMES = SOURCES.map((s) => s.dest)
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
/** A path in a repository: the add-on's folder ('' for the root) and a
 *  file in it. */
function inRepo(folder, file) {
  return folder ? `${folder}/${file}` : file
}

async function addonFiles(s, sha) {
  // Two plain-file routes, each tried twice, before the API (60 calls an hour).
  const urls = [
    `https://raw.githubusercontent.com/${OWNER}/${s.repo}/${sha}/${inRepo(s.folder, 'FILES')}`,
    `https://github.com/${OWNER}/${s.repo}/raw/${sha}/${inRepo(s.folder, 'FILES')}`,
  ]
  for (const url of [...urls, ...urls]) {
    try {
      const text = (await getFile(url)).toString('utf8')
      const files = text.split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'))
      if (files.length) return files
    } catch (e) {
      log(`FILES for ${s.repo} from ${url} failed (${e.message})`)
    }
  }
  if (!s.folder) {
    const tree = await getJson(`https://api.github.com/repos/${OWNER}/${s.repo}/git/trees/${sha}?recursive=1`)
    return tree.tree.filter((x) => x.type === 'blob' && !x.path.startsWith('.')).map((x) => x.path)
  }
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

/** A file name from a FILES list that stays inside its folder and fetches
 *  the file it names: plain characters only, no "..", no leading slash. */
function safeRel(p) {
  return /^[A-Za-z0-9_][A-Za-z0-9._\-/ ]*$/.test(p) && !p.split('/').some((x) => x === '..' || x === '' || x === '.') && !p.endsWith('/')
}

const verDir = (v) => path.join(CACHE, 'addons-' + String(v).replace(/[^A-Za-z0-9.+_-]/g, '_'))
function readState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE, 'state.json'), 'utf8'))
  } catch {
    return {}
  }
}
function writeState(st) {
  fs.mkdirSync(CACHE, { recursive: true })
  const f = path.join(CACHE, 'state.json')
  fs.writeFileSync(f + '.tmp', JSON.stringify(st))
  fs.renameSync(f + '.tmp', f)
}

/** The add-ons to serve now, with no network: the version last fetched and
 *  passed, else the bundled copy. */
function cachedAddons() {
  const st = readState()
  if (st.current && fs.existsSync(path.join(verDir(st.current), 'AgentLink'))) return { dir: verDir(st.current), version: st.current }
  // A cache from before versioned folders.
  if (st.version && fs.existsSync(path.join(CACHE, 'addons', 'AgentLink'))) return { dir: path.join(CACHE, 'addons'), version: st.version }
  return null
}

/** The pinned commits on GitHub, fetched into a folder of their own when
 *  they are new, smoke-tested there (check(dir) → { ok, failures }), and
 *  only then made current — with the launcher of the same channel commit.
 *  A version that fails is remembered and never fetched again. Returns
 *  { dir, version } of what is current afterwards. */
async function update(check) {
  // A folder holding the add-ons stands in for GitHub: an install from a
  // checkout, offline, or under test.
  const from = process.env.AGENTLINK_UPDATE_FROM && expand(process.env.AGENTLINK_UPDATE_FROM)
  if (from) {
    if (!fs.existsSync(path.join(from, 'AgentLink'))) throw new Error(`${from} holds no AgentLink folder`)
    let v = 'local'
    try {
      v = 'local+' + fs.readFileSync(path.join(from, 'VERSION'), 'utf8').trim()
    } catch {}
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
  fs.mkdirSync(CACHE, { recursive: true })
  const channel = await headSha(CHANNEL.repo, CHANNEL.branch)
  const shas = await Promise.all(SOURCES.map(async (s) => {
    if (s.pin) {
      try {
        const pinned = (await getFile(`https://raw.githubusercontent.com/${OWNER}/${CHANNEL.repo}/${channel}/${s.pin}`)).toString('utf8').trim()
        if (/^[0-9a-f]{40}$/.test(pinned)) return pinned
      } catch {}
      log(`no pin for ${s.repo} at ${channel.slice(0, 7)}: its branch head is taken`)
    }
    return headSha(s.repo, s.branch)
  }))
  const version = 'github+' + shas.map((x) => x.slice(0, 7)).join('+') + '+' + channel.slice(0, 7)
  const st = readState()
  if (st.current === version && fs.existsSync(path.join(verDir(version), 'AgentLink'))) return { dir: verDir(version), version }
  if ((st.bad || []).includes(version)) {
    log(`${version} failed its smoke test before: kept out`)
    return cachedAddons()
  }
  const stage = fs.mkdtempSync(path.join(CACHE, 'stage-'))
  try {
    for (const [i, s] of SOURCES.entries()) {
      const listed = (await addonFiles(s, shas[i])).filter((p) => !/(^|\/)(__pycache__|tests)\//.test(p))
      const bad = listed.filter((p) => !safeRel(p))
      if (bad.length) throw new Error(`${s.repo}'s FILES names paths that are not plain file names inside it: ${bad.slice(0, 3).join(', ')}`)
      for (let k = 0; k < listed.length; k += 8) {
        await Promise.all(listed.slice(k, k + 8).map(async (f) => {
          const url = `https://raw.githubusercontent.com/${OWNER}/${s.repo}/${shas[i]}/${inRepo(s.folder, f).split('/').map(encodeURIComponent).join('/')}`
          const p = path.resolve(stage, s.dest, f)
          if (!p.startsWith(path.resolve(stage, s.dest) + path.sep)) throw new Error(`${f}: outside ${s.dest}`)
          const data = await getFile(url)
          fs.mkdirSync(path.dirname(p), { recursive: true })
          fs.writeFileSync(p, data)
        }))
      }
    }
    const launcher = await getFile(`https://raw.githubusercontent.com/${OWNER}/${CHANNEL.repo}/${channel}/${CHANNEL.launcher}`)
    checkLauncher(launcher) // parses, or throws
    fs.writeFileSync(path.join(stage, '.launcher.js'), launcher)
    const verdict = check ? check(stage) : { ok: true }
    if (!verdict.ok) {
      writeState({ ...readState(), bad: [...(readState().bad || []), version].slice(-10) })
      throw new Error(`the add-ons at ${version} failed the smoke test, so they are not used: ${(verdict.failures || []).join('; ').slice(0, 400)}`)
    }
    fs.rmSync(verDir(version), { recursive: true, force: true })
    fs.renameSync(stage, verDir(version))
  } catch (e) {
    fs.rmSync(stage, { recursive: true, force: true })
    throw e
  }
  const text = fs.readFileSync(path.join(verDir(version), '.launcher.js'))
  if (stampOf(path.join(verDir(version), '.launcher.js')) >= LAUNCHER_STAMP) {
    fs.mkdirSync(path.dirname(LAUNCHER), { recursive: true })
    fs.writeFileSync(LAUNCHER, text)
    // CommonJS whatever a package.json further up says, or require fails.
    fs.writeFileSync(path.join(path.dirname(LAUNCHER), 'package.json'), '{"type": "commonjs"}\n')
  }
  const before = readState()
  writeState({ ...before, current: version, previous: before.current || null, version, at: new Date().toISOString() })
  // Older versions go; the one before stays to go back to.
  for (const n of fs.readdirSync(CACHE)) {
    if (n.startsWith('addons-') && n !== path.basename(verDir(version)) && n !== path.basename(verDir(before.current || '-'))) fs.rmSync(path.join(CACHE, n), { recursive: true, force: true })
  }
  fs.rmSync(path.join(CACHE, 'addons'), { recursive: true, force: true })
  log(`fetched the add-ons from GitHub (${version}), smoke test passed`)
  return { dir: verDir(version), version }
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
  for (const name of NAMES) {
    // A bundle from before a source was added has no copy of it.
    if (!fs.existsSync(path.join(src, name))) continue
    // Copied whole beside it, then swapped in: files removed upstream go
    // too, and a copy cut short never stands in the Mod folder.
    const dest = path.join(modDir, name)
    const fresh = `${dest}.new-${process.pid}`
    const old = `${dest}.old-${process.pid}`
    fs.rmSync(fresh, { recursive: true, force: true })
    fs.cpSync(path.join(src, name), fresh, { recursive: true })
    if (fs.existsSync(dest)) fs.renameSync(dest, old)
    fs.renameSync(fresh, dest)
    fs.rmSync(old, { recursive: true, force: true })
  }
  fs.writeFileSync(stamp, v + '\n')
  log(`installed the add-ons (${v}) into ${modDir}`)
  return true
}

/** The window link's pairing (agentlink/link_token.py in Agent Link): each
 *  side proves it knows the secret in ~/.config/freecad-agentlink/link-token
 *  (made by the window, mode 600) without sending it, so a program that took
 *  the port first learns nothing and cannot pass for the window. Resolves
 *  'paired'; 'old' when nothing answered the hello in time (a window from
 *  before pairing ignores it); 'refused' when what answered is not the
 *  window or there is no secret here. */
const TOKEN_FILE = process.env.AGENTLINK_TOKEN_FILE || path.join(HOME, '.config', 'freecad-agentlink', 'link-token')
function pairWindow(s, waitMs = 2500) {
  const crypto = require('crypto')
  let secret = null
  try {
    secret = fs.readFileSync(TOKEN_FILE, 'utf8').trim() || null
  } catch {}
  const proof = (role, nonce) => crypto.createHmac('sha256', secret).update(`${role}:${nonce}`).digest('hex')
  return new Promise((resolve) => {
    let buf = ''
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      clearTimeout(timer)
      s.removeListener('data', onData)
      s.removeListener('close', onClose)
      resolve(v)
    }
    const onClose = () => finish('refused')
    const onData = (d) => {
      buf += d.toString('utf8')
      const i = buf.indexOf('\n')
      if (i < 0) return
      let p = null
      try {
        const m = JSON.parse(buf.slice(0, i))
        if (m.jsonrpc === '2.0' && m.method === 'agentlink/hello' && m.params) p = m.params
      } catch {}
      const want = Buffer.from(proof('window', nonce))
      const got = Buffer.from(p && typeof p.proof === 'string' ? p.proof : '')
      if (!p || typeof p.nonce !== 'string' || got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
        log('what answered on the window port did not prove it is the FreeCAD window: not used')
        return finish('refused')
      }
      s.write(JSON.stringify({ jsonrpc: '2.0', method: 'agentlink/proof', params: { proof: proof('client', p.nonce) } }) + '\n')
      finish('paired')
    }
    const timer = setTimeout(() => finish('old'), waitMs)
    if (!secret) {
      // A window from before pairing makes no secret: it serves as it did.
      clearTimeout(timer)
      return resolve('old')
    }
    const nonce = crypto.randomBytes(16).toString('hex')
    s.on('data', onData)
    s.on('close', onClose)
    s.write(JSON.stringify({ jsonrpc: '2.0', method: 'agentlink/hello', params: { nonce } }) + '\n')
  })
}

function windowLink() {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: '127.0.0.1', port: PORT })
    const done = async (ok) => {
      s.removeAllListeners()
      s.setTimeout(0)
      if (!ok) {
        s.destroy()
        return resolve(null)
      }
      const how = await pairWindow(s)
      if (how === 'refused') {
        s.destroy()
        return resolve(null)
      }
      resolve(s)
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
  // Served at once from what is here — the version fetched and passed last
  // time, else the copy bundled with the extension — so Claude gets its
  // answer without waiting on the network. The newest pinned version is
  // fetched and smoke-tested in the background and serves from the next
  // start (or at once, by agentlink_update).
  const updates = process.env.AGENTLINK_UPDATE !== 'false'
  let src = (updates && cachedAddons()) || { dir: ADDONS, version: bundledVersion() }
  if (updates && process.env.AGENTLINK_UPDATE_FROM) {
    try {
      src = await update()
    } catch (e) {
      log('no update from the folder given:', e.message)
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

  // With a FreeCAD Python to hand, the server runs headless and sends each
  // tool call to the window when its link is on (agentlink/supervise.py),
  // so closing or restarting the window never ends the session. Relaying
  // straight to the window is left for a FreeCAD without one.
  const sock = fc.py || fc.cmd ? null : await windowLink()
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
  const pyPath = [...NAMES.map((n) => path.join(base, n)), fc.lib].join(':')
  const e = env(fc, { AGENTLINK_OUT: OUT, FREECAD_LIB: fc.lib, PYTHONPATH: pyPath, PYTHONUNBUFFERED: '1' })
  const [exe, args] = fc.py ? [fc.py, [script, '--out', OUT]] : [fc.cmd, [script]]
  log('headless:', exe, args.join(' '))
  headless(exe, args, e, { modDir, version: src.version })
  if (updates && !process.env.AGENTLINK_UPDATE_FROM) {
    setTimeout(() => {
      update((dir) => smokeTest(exe, e, dir))
        .then((got) => got && got.version !== src.version && log(`${got.version} is ready: it serves from the next start (agentlink_update switches now)`))
        .catch((err) => log('no update from GitHub:', err.message))
    }, 2000)
  }
}

/** FreeCAD's Python serving, restarted when it dies (a crash in OCC takes the
 *  whole process): every call still waiting is answered with what happened,
 *  and the next call goes to a fresh FreeCAD. The document of the one that
 *  died is gone; the answer says so. */
// The launcher's own tool: the newest add-ons from GitHub, and FreeCAD
// started again on them, without Claude starting again.
// Companions: other local MCP servers kept as git clones beside this one
// (BumpMesh), brought up to their branch by the same update, and their
// running copy stopped so Claude starts it again on the new code. The list
// is a local setting (~/AgentLink/companions.json, a list like the default);
// a clone with work of its own is left as it is and said.
const COMPANIONS_DEFAULT = [
  { name: 'bumpmesh', dir: '~/src/bumpmesh', url: `https://github.com/${OWNER}/stlTexturizer.git`, branch: 'agent-link', process: 'mcp/' },
]

function companions() {
  let list = COMPANIONS_DEFAULT
  try {
    list = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'AgentLink', 'companions.json'), 'utf8'))
  } catch {}
  return (Array.isArray(list) ? list : []).map((c) => ({ ...c, dir: String(c.dir || '').replace(/^~(?=$|\/)/, os.homedir()) }))
}

function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || r.error?.message || '').trim() }
}

function updateCompanions() {
  const out = []
  for (const c of companions()) {
    if (!c.dir || !fs.existsSync(path.join(c.dir, '.git'))) continue
    const row = { name: c.name, branch: c.branch }
    try {
      const f = git(c.dir, ['fetch', '--quiet', c.url, c.branch])
      if (!f.ok) throw new Error(f.err.split('\n').pop() || 'fetch failed')
      const before = git(c.dir, ['rev-parse', '--short', 'HEAD']).out
      if (git(c.dir, ['rev-parse', '--abbrev-ref', 'HEAD']).out !== c.branch) {
        const sw = git(c.dir, ['switch', c.branch])
        if (!sw.ok) {
          const mk = git(c.dir, ['switch', '-c', c.branch, 'FETCH_HEAD'])
          if (!mk.ok) throw new Error(`could not switch to ${c.branch}: ${(sw.err || mk.err).split('\n').pop()}`)
        }
      }
      const m = git(c.dir, ['merge', '--ff-only', 'FETCH_HEAD'])
      if (!m.ok) throw new Error(`left as it is — it has work of its own (${m.err.split('\n').pop()})`)
      const after = git(c.dir, ['rev-parse', '--short', 'HEAD']).out
      Object.assign(row, { from: before, to: after })
      // Restarted on each commit once: kept in a small state file, so a
      // restart that missed (an older launcher's) is made up next time.
      const stateFile = path.join(os.homedir(), 'AgentLink', '.companions.json')
      let state = {}
      try {
        state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
      } catch {}
      if (c.process && (after !== before || state[c.name] !== after)) {
        // Its running copies stopped: Claude starts it again on the new code.
        const k = spawnSync('pkill', ['-f', path.join(c.dir, c.process)], { timeout: 10000 })
        row.restarted = k.status === 0
        if (k.status !== 0) row.note = 'no running copy found to restart'
        state[c.name] = after
        try {
          fs.writeFileSync(stateFile, JSON.stringify(state))
        } catch {}
      }
    } catch (e) {
      row.error = String(e.message || e)
    }
    out.push(row)
  }
  return out
}

// Unattended use (G): an update must not leave FreeCAD worse off with no
// one at the Mac. The add-ons in place are kept before new ones go in; the
// settings file is snapshotted; the new add-ons are smoke-tested headless
// (agentlink/smoke.py: every family loads, a few core tools run) before
// FreeCAD moves onto them; on a failure the kept ones go back and the
// broken ones stay on disk for a look. Each update is written down in
// ~/AgentLink/versions.json.
const PREVIOUS = path.join(CACHE, 'previous')
const AL_HOME = process.env.AGENTLINK_HOME ? expand(process.env.AGENTLINK_HOME) : path.join(HOME, 'AgentLink')

function stampNow() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function keepPrevious(modDir) {
  if (!modDir || !fs.existsSync(path.join(modDir, 'AgentLink'))) return false
  fs.rmSync(PREVIOUS, { recursive: true, force: true })
  fs.mkdirSync(PREVIOUS, { recursive: true })
  for (const n of NAMES) {
    if (fs.existsSync(path.join(modDir, n))) fs.cpSync(path.join(modDir, n), path.join(PREVIOUS, n), { recursive: true })
  }
  return true
}

function restorePrevious(modDir, broken) {
  const aside = path.join(CACHE, `broken-${String(broken).replace(/[^A-Za-z0-9.+_-]/g, '_')}`)
  fs.rmSync(aside, { recursive: true, force: true })
  fs.mkdirSync(aside, { recursive: true })
  for (const n of NAMES) {
    const p = path.join(modDir, n)
    if (fs.existsSync(p)) fs.renameSync(p, path.join(aside, n))
    if (fs.existsSync(path.join(PREVIOUS, n))) fs.cpSync(path.join(PREVIOUS, n), p, { recursive: true })
  }
  // Two broken sets at most are kept.
  try {
    const old = fs.readdirSync(CACHE).filter((n) => n.startsWith('broken-')).map((n) => path.join(CACHE, n))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    for (const o of old.slice(2)) fs.rmSync(o, { recursive: true, force: true })
  } catch {}
  return aside
}

function smokeTest(exe, e, modDir) {
  const script = path.join(modDir, 'AgentLink', 'agentlink', 'smoke.py')
  if (!fs.existsSync(script)) return { ok: true, skipped: 'these add-ons have no smoke test' }
  const pp = [...NAMES.map((n) => path.join(modDir, n)), e.FREECAD_LIB].filter(Boolean).join(':')
  const env2 = { ...e, PYTHONPATH: pp }
  delete env2.AGENTLINK_SUPERVISED
  const r = spawnSync(exe, [script], { env: env2, encoding: 'utf8', timeout: 600000 })
  const lines = (r.stdout || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).reverse()
  for (const l of lines) {
    try {
      return JSON.parse(l)
    } catch {}
  }
  return { ok: false, failures: [`no answer (${r.error ? r.error.message : 'exit ' + r.status}): ${(r.stderr || '').slice(-400)}`] }
}

function snapshotSettings(exe, e) {
  try {
    const code = "import FreeCAD,sys;sys.stdout.write('@@'+FreeCAD.getUserConfigDir()+'@@')"
    const args = exe.endsWith('python3') || exe.endsWith('python') ? ['-c', `import sys;sys.path.append(${JSON.stringify(e.FREECAD_LIB || '')});${code}`] : ['-c', code]
    const r = spawnSync(exe, args, { env: e, encoding: 'utf8', timeout: 60000 })
    const m = /@@(.*)@@/.exec(r.stdout || '')
    const cfg = m && path.join(m[1], 'user.cfg')
    if (!cfg || !fs.existsSync(cfg)) return null
    const dir = path.join(AL_HOME, 'settings')
    fs.mkdirSync(dir, { recursive: true })
    const dest = path.join(dir, `${stampNow()}-update.cfg`)
    fs.copyFileSync(cfg, dest)
    fs.appendFileSync(path.join(AL_HOME, 'settings-log.jsonl'), JSON.stringify({ t: Date.now() / 1000, tool: 'agentlink_update', name: 'before update', snapshot: dest, restart: false }) + '\n')
    return dest
  } catch {
    return null
  }
}

function recordVersions(before, after, outcome) {
  const p = path.join(AL_HOME, 'versions.json')
  let v = { history: [] }
  try {
    v = JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {}
  v.history = (v.history || []).concat([{ t: Date.now() / 1000, before, after, outcome }]).slice(-6)
  try {
    fs.mkdirSync(AL_HOME, { recursive: true })
    fs.writeFileSync(p, JSON.stringify(v, null, 1))
  } catch {}
}

const UPDATE_TOOL = {
  name: 'agentlink_update',
  description: 'Fetch the newest Agent Link and ScanRuler for FreeCAD from GitHub and start FreeCAD again on them, without restarting Claude: new tools and fixes from then on. Companion servers kept as git clones (BumpMesh) are brought up to their branch too and started again. The open document is lost unless saved (doc_save first). Answers the version before and after, and each companion\'s; the tool list is sent again.',
  inputSchema: { type: 'object', properties: {} },
}

/** The window (if its link is on) quits and opens again on the new add-ons:
 *  its documents saved and reopened by app_restart; nothing if it is closed.
 *  Resolves once the window has answered (its restart mark written, so calls
 *  from here on wait for it) — true — or false when no window answered. */
function restartWindow() {
  return new Promise((resolve) => {
    let done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    const s = net.connect(PORT, '127.0.0.1')
    s.on('error', () => finish(false))
    s.on('connect', async () => {
      // Paired first; a window from before pairing ('old') still restarts
      // onto the add-ons that pair. Nothing is sent to what is not the window.
      if ((await pairWindow(s)) === 'refused') {
        s.destroy()
        return finish(false)
      }
      s.write(JSON.stringify({ jsonrpc: '2.0', id: '__update', method: 'tools/call', params: { name: 'app_restart', arguments: {} } }) + '\n')
      let buf = ''
      // Closed with no answer: the restart was not taken.
      s.on('close', () => finish(false))
      s.on('data', (d) => {
        buf += d.toString('utf8')
        if (!buf.includes('\n')) return
        // Refused (a document never saved): the window keeps running the
        // old add-ons, and says why.
        let why = null
        try {
          const r = JSON.parse(buf.split('\n')[0]).result || {}
          if (r.isError) why = JSON.parse(r.content[0].text).error.message
        } catch {}
        finish(why ? { refused: why } : true)
        s.destroy()
      })
      setTimeout(() => { finish(true); s.destroy() }, 5000)
    })
  })
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
      const got = await update((dir) => smokeTest(exe, e, dir))
      if (!got) throw new Error('GitHub gave nothing')
      let snapshot = null
      if (inst.modDir && got.version !== before) {
        keepPrevious(inst.modDir)
        snapshot = snapshotSettings(exe, e)
        install(inst.modDir, got.dir, got.version)
        // Smoke-tested before it was taken; once more in place, as installed.
        const smoke = smokeTest(exe, e, inst.modDir)
        if (!smoke.ok) {
          const st = readState()
          writeState({ ...st, current: st.previous || null, bad: [...(st.bad || []), got.version].slice(-10) })
          const aside = restorePrevious(inst.modDir, got.version)
          recordVersions({ addons: before }, { addons: got.version }, `smoke failed: rolled back (${(smoke.failures || []).join('; ').slice(0, 300)})`)
          reply(id, { error: { code: 'failed', message: `The new add-ons (${got.version}) failed the smoke test, so FreeCAD stays on ${before}: ${(smoke.failures || []).join('; ').slice(0, 600)}. They are kept at ${aside} for a look; nothing was restarted.` } }, true)
          return
        }
        recordVersions({ addons: before }, { addons: got.version }, smoke.skipped ? `installed (${smoke.skipped})` : 'smoke passed')
      } else if (inst.modDir) install(inst.modDir, got.dir, got.version)
      version = got.version
      const comp = updateCompanions()
      if (comp.some((c) => c.from && c.to && c.from !== c.to)) recordVersions({ companions: comp.map((c) => `${c.name}@${c.from}`) }, { companions: comp.map((c) => `${c.name}@${c.to}`) }, 'companions moved')
      if (got.version === before) {
        reply(id, { before, after: version, restarted: false, ...(comp.length ? { companions: comp } : {}), note: 'Already the newest: nothing to do.' })
        return
      }
      updating = true
      const windowed = await restartWindow()
      child.kill()
      reply(id, { before, after: version, restarted: true, ...(snapshot ? { settingsSnapshot: snapshot } : {}), ...(comp.length ? { companions: comp } : {}), note: windowed && windowed.refused
        ? `The hidden FreeCAD runs the new add-ons, but the window did not restart and keeps the old ones: ${windowed.refused} Then app_restart.`
        : windowed
          ? 'FreeCAD started again on the new add-ons: the window reopens its documents (calls wait for it, up to 90 s), the one in front back in front. New tools are listed.'
          : 'FreeCAD started again on the new add-ons: the document is fresh (session_state). New tools are listed.' })
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
    else if (msg.method === 'tools/list') result = { tools: [{ name: 'freecad_status', description: 'Why Agent Link for FreeCAD is not running.', inputSchema: { type: 'object', properties: {} } }] }
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
