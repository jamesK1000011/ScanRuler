// SPDX-License-Identifier: AGPL-3.0-only
// Circuit boards written as code with tscircuit (MIT; github.com/tscircuit),
// built on this computer by its own command line, `tsci` — run as a
// program, nothing of it linked in. Found where it installs (SCANRULER_TSCI,
// a project's own node_modules, the PATH, npm's global folder, Bun's,
// nvm's), or run through `bunx tscircuit` when only Bun is there.
//
// Nothing is assumed about the installed tsci that its own --help does not
// show: each subcommand, flag and export format is looked up in its --help
// before it is used, and refused by name when the installed version does
// not list it.
//
// A project is a folder: package.json, tsconfig.json and the board's
// index.circuit.tsx, as `tsci init` lays one out — scaffolded here from
// templates, without the network. Each build is a job folder under
// circuits/builds/ in the ScanRuler folder: the command lines run, the log,
// circuit.json (tscircuit's Circuit JSON, which the Circuit workspace reads)
// and the exports asked for — Gerbers (a zip holding bom.csv and
// pick_and_place.csv, which are taken out beside it), .kicad_pcb, STEP,
// GLB, SVG — with what the build said was wrong (its *_error and *_warning
// elements) in job.json.

import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { zipEntries } from './zip.js'

const tilde = (p) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

export function home(env = process.env) {
  return resolve(tilde(env.SCANRULER_HOME ?? '~/.scanruler'))
}

/** Where projects made here live, and the builds. */
export const circuitsDir = (env = process.env) => join(home(env), 'circuits')
export const buildsDir = (env = process.env) => join(circuitsDir(env), 'builds')

const cancelled = () => Object.assign(new Error('Cancelled.'), { cancelled: true })

// ---- running a program ------------------------------------------------------------

/** A program run to its end, with no shell between: its output (capped), exit
 *  code, and whether it ran out of time. Cancel or the time limit kills it
 *  and what it started (its process group). */
export function run(cmd, args, { cwd, env = process.env, timeoutMs = 600_000, signal } = {}) {
  return new Promise((resolveRun, reject) => {
    if (signal?.aborted) return reject(cancelled())
    const group = process.platform !== 'win32'
    let child
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: group })
    } catch (e) {
      return reject(new Error(`${cmd} could not be started: ${e.message}`))
    }
    let out = ''
    let timedOut = false
    const keep = (d) => {
      out += d
      if (out.length > 400_000) out = out.slice(-200_000)
    }
    const kill = () => {
      try {
        if (group && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          // Gone already.
        }
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, timeoutMs)
    signal?.addEventListener('abort', kill, { once: true })
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', kill)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', (e) => {
      done()
      reject(new Error(`${cmd} could not be started: ${e.message}`))
    })
    child.on('close', (code, sig) => {
      done()
      if (signal?.aborted) return reject(cancelled())
      resolveRun({ code, signal: sig, timedOut, log: out })
    })
  })
}

// ---- finding tsci -----------------------------------------------------------------

const runnable = (p) => {
  try {
    if (!statSync(p).isFile()) return false
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function onPath(name, env) {
  for (const d of String(env.PATH ?? '').split(delimiter).filter(Boolean)) if (runnable(join(d, name))) return join(d, name)
  return null
}

/** Folders a global install puts its programs in, beside the PATH: a Mac
 *  app's server is often started with a short PATH. */
function globalBins(env) {
  const h = homedir()
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin', join(h, '.bun', 'bin'), join(h, '.npm-global', 'bin'), join(h, '.local', 'bin'), join(h, '.volta', 'bin')]
  if (env.BUN_INSTALL) dirs.unshift(join(env.BUN_INSTALL, 'bin'))
  if (env.NPM_CONFIG_PREFIX) dirs.unshift(join(env.NPM_CONFIG_PREFIX, 'bin'))
  // nvm: each Node version keeps its own global programs.
  const nvm = join(env.NVM_DIR ?? join(h, '.nvm'), 'versions', 'node')
  try {
    for (const v of readdirSync(nvm).sort().reverse()) dirs.push(join(nvm, v, 'bin'))
  } catch {
    // No nvm.
  }
  return dirs
}

/** npm's global folder, as npm itself says: <prefix>/bin. */
async function npmGlobalBin(env) {
  const npm = onPath('npm', env) ?? globalBins(env).map((d) => join(d, 'npm')).find(runnable)
  if (!npm) return null
  try {
    const r = await run(npm, ['prefix', '-g'], { env: envFor(npm, env), timeoutMs: 15_000 })
    const prefix = r.log.trim().split('\n').pop()?.trim()
    return prefix && isAbsolute(prefix) ? join(prefix, process.platform === 'win32' ? '' : 'bin') : null
  } catch {
    return null
  }
}

/** The environment a program found here runs in: its own folder and this
 *  Node's on the PATH, so a `#!/usr/bin/env node` script finds a node. */
function envFor(path, env) {
  const dirs = [dirname(path), dirname(process.execPath)]
  return { ...env, PATH: [...dirs, env.PATH ?? ''].filter(Boolean).join(delimiter) }
}

/**
 * The tsci to run: { cmd, pre, via, path } — `pre` goes before the
 * subcommand (["tscircuit"] for bunx). Looked for in order: SCANRULER_TSCI,
 * the project's node_modules/.bin, the PATH, npm's global folder, the usual
 * global folders, then bunx. null when none is there.
 */
export async function findTsci(env = process.env, projectDir = null) {
  if (env.SCANRULER_TSCI) {
    const p = resolve(tilde(env.SCANRULER_TSCI))
    return runnable(p) ? { cmd: p, pre: [], via: 'SCANRULER_TSCI', path: p } : { broken: `SCANRULER_TSCI is set to ${p}, which is not a program this server can run.` }
  }
  if (projectDir) {
    const local = join(projectDir, 'node_modules', '.bin', 'tsci')
    if (runnable(local)) return { cmd: local, pre: [], via: 'project', path: local }
  }
  const path = onPath('tsci', env)
  if (path) return { cmd: path, pre: [], via: 'PATH', path }
  const npmBin = await npmGlobalBin(env)
  for (const d of [...(npmBin ? [npmBin] : []), ...globalBins(env)]) {
    const p = join(d, 'tsci')
    if (runnable(p)) return { cmd: p, pre: [], via: d === npmBin ? 'npm global' : 'global', path: p }
  }
  const bunx = onPath('bunx', env) ?? globalBins(env).map((d) => join(d, 'bunx')).find(runnable)
  if (bunx) return { cmd: bunx, pre: ['tscircuit'], via: 'bunx', path: bunx }
  return null
}

export const INSTALL_HOW_TO =
  'tscircuit is not installed where this server looks. On a Mac: install Node.js (nodejs.org, or `brew install node`), then in Terminal `npm install -g tscircuit` (or with Bun: `bun install --global tscircuit`), and check with `tsci --help`. If it is installed and still not found, set SCANRULER_TSCI to the path `which tsci` prints, in the agent app’s server settings, and restart it.'

/** What the installed tsci's --help lists for a subcommand: its flags, and
 *  for export the formats it names. Kept per program and modification time. */
const helpCache = new Map()
export async function helpOf(t, sub, env = process.env) {
  let mtime = 0
  try {
    mtime = statSync(t.path).mtimeMs
  } catch {
    // Read afresh.
  }
  const key = `${t.cmd} ${t.pre.join(' ')} ${sub} ${mtime}`
  if (helpCache.has(key)) return helpCache.get(key)
  const r = await run(t.cmd, [...t.pre, ...(sub ? [sub] : []), '--help'], { env: envFor(t.path, env), timeoutMs: 120_000 })
  const text = r.log
  const flags = [...new Set(text.match(/--[a-z0-9][a-z0-9-]*/g) ?? [])]
  // "-f, --format <format>  Output format (json, circuit-json, …)" — the list
  // may wrap over lines.
  const fm = /Output format\s*\(([^)]*)\)/s.exec(text)
  const formats = fm ? fm[1].split(/[\s,]+/).filter(Boolean) : []
  // The commands a top-level --help lists, one per line, two spaces in.
  const commands = sub ? [] : [...text.matchAll(/^\s{2}([a-z][a-z0-9-]*)\b/gm)].map((m) => m[1])
  const out = { ok: r.code === 0 && !r.timedOut, flags, formats, commands, text: text.slice(0, 20_000) }
  if (out.ok) helpCache.set(key, out)
  return out
}

/** Refuse, naming them, what the installed tsci's --help does not list. */
export async function requireHelp(t, sub, flags = [], formats = [], env = process.env) {
  const top = await helpOf(t, '', env)
  if (!top.ok) throw new Error(`${t.path} --help did not answer as tsci does: ${top.text.trim().split('\n').slice(-3).join(' | ') || 'no output'}.`)
  if (!top.commands.includes(sub)) throw new Error(`The installed tsci (${t.path}) does not list a "${sub}" command in its --help — this version cannot be driven this way.`)
  const h = await helpOf(t, sub, env)
  if (!h.ok) throw new Error(`tsci ${sub} --help did not answer: ${h.text.trim().split('\n').slice(-3).join(' | ') || 'no output'}.`)
  const missing = flags.filter((f) => !h.flags.includes(f))
  if (missing.length) throw new Error(`The installed tsci (${t.path}) does not list ${missing.join(', ')} for "${sub}" in its --help — this version cannot be driven this way.`)
  const noFormat = formats.filter((f) => !h.formats.includes(f))
  if (noFormat.length) throw new Error(`The installed tsci does not list the export format${noFormat.length > 1 ? 's' : ''} ${noFormat.join(', ')} (it lists ${h.formats.join(', ') || 'none'}).`)
  return h
}

/** Whether tsci is found, its version, what its build and export take, and
 *  how to install it when not. */
export async function circuitTools(env = process.env) {
  const t = await findTsci(env)
  if (!t) return { ready: false, tsci: null, howTo: INSTALL_HOW_TO, projects: circuitsDir(env) }
  if (t.broken) return { ready: false, tsci: null, howTo: `${t.broken} ${INSTALL_HOW_TO}`, projects: circuitsDir(env) }
  let version = null
  try {
    const r = await run(t.cmd, [...t.pre, '--version'], { env: envFor(t.path, env), timeoutMs: t.via === 'bunx' ? 300_000 : 60_000 })
    version = /(\d+\.\d+\.\d+[\w.-]*)/.exec(r.log)?.[1] ?? null
  } catch {
    // Found, but it does not run.
  }
  const base = { tsci: { path: t.path, via: t.via, version }, projects: circuitsDir(env) }
  if (!version) return { ready: false, ...base, howTo: `Found ${t.path}${t.via === 'bunx' ? ' (bunx tscircuit)' : ''} but it did not answer --version. ${INSTALL_HOW_TO}` }
  const [top, build, exp] = [await helpOf(t, '', env), await helpOf(t, 'build', env), await helpOf(t, 'export', env)]
  const lacking = ['build', 'export'].filter((c) => !top.commands.includes(c))
  return {
    ready: lacking.length === 0,
    ...base,
    commands: top.commands,
    build: { flags: build.flags.filter((f) => f !== '--help') },
    export: { flags: exp.flags.filter((f) => f !== '--help'), formats: exp.formats },
    ...(t.via === 'bunx' ? { note: 'Run through bunx: each run may fetch tscircuit first. `npm install -g tscircuit` makes it faster.' } : {}),
    ...(lacking.length ? { howTo: `This tsci does not list ${lacking.join(' and ')} in its --help — update it: npm install -g tscircuit@latest.` } : {}),
  }
}

// ---- templates --------------------------------------------------------------------

const f3 = (x) => String(Math.round(x * 1000) / 1000)
const mm = (x) => `"${f3(x)}mm"`

/** An E24 value at or above r, as tscircuit writes a resistance. */
export function e24Above(r) {
  const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1]
  const decade = 10 ** Math.floor(Math.log10(r))
  const m = r / decade
  const hit = E24.find((x) => x >= m - 1e-9)
  const v = hit ? hit * decade : 10 * decade
  return Math.round(v * 1000) / 1000
}
const ohmsText = (v) => (v >= 1e6 ? `${f3(v / 1e6)}M` : v >= 1e3 ? `${f3(v / 1e3)}k` : f3(v))

const holeTsx = (x, y, d) => `    <hole diameter=${mm(d)} pcbX=${mm(x)} pcbY=${mm(y)} />`

function num(v, name, lo, hi, dflt) {
  if (v === undefined || v === null) return dflt
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} must be a number.`)
  if (v < lo || v > hi) throw new Error(`${name}: ${lo} to ${hi}.`)
  return v
}

function corners(w, h, inset) {
  const x = w / 2 - inset
  const y = h / 2 - inset
  return [[-x, -y], [x, -y], [x, y], [-x, y]]
}

/** A rounded rectangle's outline, centred on the origin, counter-clockwise,
 *  points about `step` mm apart, with a notch round each keep-out circle
 *  that crosses its edge: the run of outline inside the circle replaced by
 *  the circle's arc on the board's side. A circle wholly inside the board is
 *  no notch (it is listed in `inside`); runs on a straight line are merged. */
export function notchedOutline(w, h, r, keepouts = [], step = 0.25) {
  const hw = w / 2
  const hh = h / 2
  const R = Math.max(0, Math.min(r, hw, hh))
  let pts = []
  const line = (ax, ay, bx, by) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let i = 0; i < n; i++) pts.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n])
  }
  const arc = (cx, cy, a0) => {
    if (R <= 0) return
    const n = Math.max(2, Math.ceil(((Math.PI / 2) * R) / step))
    for (let i = 0; i < n; i++) {
      const a = a0 + ((Math.PI / 2) * i) / n
      pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)])
    }
  }
  line(-hw + R, -hh, hw - R, -hh)
  arc(hw - R, -hh + R, -Math.PI / 2)
  line(hw, -hh + R, hw, hh - R)
  arc(hw - R, hh - R, 0)
  line(hw - R, hh, -hw + R, hh)
  arc(-hw + R, hh - R, Math.PI / 2)
  line(-hw, hh - R, -hw, -hh + R)
  arc(-hw + R, -hh + R, Math.PI)
  const inside = []
  for (const k of keepouts) {
    const notched = notchOne(pts, k, step)
    if (notched === pts) inside.push(k)
    pts = notched
  }
  // Points that coincide (where an arc starts on a sampled point) once.
  pts = pts.filter((p, i) => {
    const q = pts[(i - 1 + pts.length) % pts.length]
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6
  })
  // Drop points on a straight run.
  const keep = pts.filter((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length]
    const b = pts[(i + 1) % pts.length]
    const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])
    return Math.abs(cross) > 1e-7 * Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]))
  })
  const points = keep.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000])
  return Object.assign(points, { inside })
}

/** The outline with the circle k taken out of it, where k crosses its
 *  edge: the run of outline inside the circle replaced by the circle's arc
 *  from where it goes in to where it comes out, clockwise about the
 *  circle's centre (the outline running counter-clockwise, that is the
 *  board's side). A circle over a corner crosses twice, cutting the corner's
 *  tip off: the tip is dropped and the arc runs from the first way in to
 *  the last way out. The same array when the circle crosses no edge; a
 *  circle that would cut the board apart is refused. */
function notchOne(pts, k, step) {
  const n = pts.length
  const isIn = pts.map(([x, y]) => Math.hypot(x - k.x, y - k.y) < k.r - 1e-9)
  if (!isIn.some(Boolean)) return pts
  const where = `The keep-out at ${f3(k.x)}, ${f3(k.y)} (r ${f3(k.r)})`
  if (isIn.every(Boolean)) throw new Error(`${where} covers the whole board.`)
  // Start outside, so no run wraps past the end.
  const s0 = isIn.findIndex((v) => !v)
  const P = [...pts.slice(s0), ...pts.slice(0, s0)]
  const I = [...isIn.slice(s0), ...isIn.slice(0, s0)]
  const meet = (p, q) => {
    // Where p (outside) to q (inside) meets the circle: the first root.
    const dx = q[0] - p[0], dy = q[1] - p[1]
    const fx = p[0] - k.x, fy = p[1] - k.y
    const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - k.r * k.r
    const t = (-b - Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a)
    return [p[0] + t * dx, p[1] + t * dy]
  }
  const runs = []
  for (let i = 0; i < n; i++) {
    if (!I[i] || (i > 0 && I[i - 1])) continue
    let j = i
    while (j + 1 < n && I[j + 1]) j++
    runs.push({ i, j, A: meet(P[i - 1], P[i]), B: meet(P[(j + 1) % n], P[j]) })
  }
  if (runs.length > 2) throw new Error(`${where} crosses the board’s edge ${runs.length * 2} times — it would cut the board apart.`)
  const first = runs[0]
  const last = runs[runs.length - 1]
  const area = (q) => q.reduce((s, p, i) => s + p[0] * q[(i + 1) % q.length][1] - q[(i + 1) % q.length][0] * p[1], 0) / 2
  const arc = (A, B) => {
    const ta = Math.atan2(A[1] - k.y, A[0] - k.x)
    let tb = Math.atan2(B[1] - k.y, B[0] - k.x)
    while (tb > ta) tb -= 2 * Math.PI
    const m = Math.max(2, Math.ceil(((ta - tb) * k.r) / step))
    const out = []
    for (let q = 0; q <= m; q++) {
      const t = ta - ((ta - tb) * q) / m
      out.push([k.x + k.r * Math.cos(t), k.y + k.r * Math.sin(t)])
    }
    return out
  }
  if (runs.length === 2) {
    // The tip between the two runs, cut off: small, or the circle splits the board.
    const tip = [first.B, ...P.slice(first.j + 1, last.i), last.A, ...arc(last.A, first.B).slice(1, -1)]
    if (Math.abs(area(tip)) > 0.1 * Math.abs(area(P))) throw new Error(`${where} cuts across the board — it would cut it apart.`)
  }
  return [...P.slice(0, first.i), ...arc(first.A, last.B), ...P.slice(last.j + 1)]
}

/**
 * The templates a new project starts from: each { label, blurb, params
 * (key: [min, max, default, what]), tsx(params) }. Positions in mm on the
 * board, its centre at the origin, as tscircuit lays a board out.
 */
export const TEMPLATES = {
  blank: {
    label: 'Blank board',
    blurb: 'A board of a size, with M3 mounting holes in the corners if asked — nothing on it yet.',
    params: { width: [5, 500, 50, 'mm'], height: [5, 500, 30, 'mm'], holes: [0, 1, 1, '1: M3 holes in the corners, 0: none'], hole_inset: [2, 50, 3.5, 'mm from each edge to a hole’s centre'] },
    tsx: (p) => [
      'export default () => (',
      `  <board width=${mm(p.width)} height=${mm(p.height)}>`,
      ...(p.holes ? corners(p.width, p.height, p.hole_inset).map(([x, y]) => holeTsx(x, y, 3.2)) : []),
      '  </board>',
      ')',
    ],
  },
  led: {
    label: 'LED and resistor',
    blurb: 'A 2-pin header for power, a series resistor sized for the LED, and the LED — the smallest board that does something.',
    params: { supply: [1.8, 48, 5, 'V at the header'], current: [1, 30, 10, 'mA through the LED'], vf: [1.5, 3.6, 2, 'V the LED drops (red ~2, blue/white ~3)'], width: [15, 200, 30, 'mm'], height: [10, 200, 20, 'mm'] },
    check: (p) => (p.supply <= p.vf + 0.2 ? 'supply must be above the LED’s drop (vf) by 0.2 V or more.' : null),
    tsx: (p) => {
      const r = e24Above((p.supply - p.vf) / (p.current / 1000))
      return [
        `// R1 = (supply − vf) / current = (${f3(p.supply)} − ${f3(p.vf)}) V / ${f3(p.current)} mA, up to the next E24 value.`,
        'export default () => (',
        `  <board width=${mm(p.width)} height=${mm(p.height)}>`,
        `    <pinheader name="J1" pinCount={2} pitch="2.54mm" pcbX=${mm(-p.width / 2 + 4)} pcbY="0mm" pcbRotation="90deg" />`,
        `    <resistor name="R1" resistance="${ohmsText(r)}" footprint="0603" pcbX="0mm" pcbY=${mm(p.height / 6)} />`,
        `    <led name="LED1" color="red" footprint="0603" pcbX=${mm(p.width / 4)} pcbY=${mm(p.height / 6)} />`,
        '    <trace from=".J1 > .pin1" to=".R1 > .pin1" />',
        '    <trace from=".R1 > .pin2" to=".LED1 > .anode" />',
        '    <trace from=".LED1 > .cathode" to=".J1 > .pin2" />',
        '  </board>',
        ')',
      ]
    },
  },
  pico_carrier: {
    label: 'Raspberry Pi Pico (RP2040) carrier',
    blurb: 'Two 20-pin 2.54 mm sockets 17.78 mm apart for a Pico board to plug into, a power LED off 3V3, and M3 holes. Check the row spacing against your board.',
    params: { width: [30, 300, 34, 'mm'], height: [56, 300, 64, 'mm'] },
    tsx: (p) => carrierTsx(p, { rows: 17.78, pins: 20, name: 'Pico', vcc: 36, gnd: 38 }),
  },
  esp32_carrier: {
    label: 'ESP32 DevKitC carrier',
    blurb: 'Two 19-pin 2.54 mm sockets 25.4 mm apart for an ESP32-DevKitC (V4) to plug into, a power LED off 3V3, and M3 holes. Other ESP32 boards differ: check the row spacing.',
    params: { width: [36, 300, 42, 'mm'], height: [54, 300, 62, 'mm'] },
    tsx: (p) => carrierTsx(p, { rows: 25.4, pins: 19, name: 'ESP32-DevKitC', vcc: 1, gnd: 14 }),
  },
  enclosure: {
    label: 'Board to fit an enclosure',
    blurb: 'A board the size of an enclosure’s inside less a clearance each side, its corners rounded to match, notched round the bosses or posts given as keep-outs, with M3 holes if asked.',
    params: {
      inside_width: [10, 500, 76, 'mm, the enclosure’s inside'],
      inside_depth: [10, 500, 56, 'mm, the enclosure’s inside'],
      corner: [0, 50, 2, 'mm, the inside corner radius'],
      clearance: [0, 5, 0.5, 'mm each side'],
      holes: [0, 1, 0, '1: M3 holes in the corners, 0: none'],
      hole_inset: [2, 50, 4, 'mm from each edge'],
    },
    tsx: (p) => {
      const w = p.inside_width - 2 * p.clearance
      const h = p.inside_depth - 2 * p.clearance
      const r = Math.max(0, p.corner - p.clearance)
      const ko = (p.keepouts ?? []).map((k) => ({ x: k.x, y: k.y, r: k.r + p.clearance }))
      const pts = notchedOutline(w, h, r, ko)
      const plain = ko.length === 0 && r === 0
      return [
        `// Inside ${f3(p.inside_width)} × ${f3(p.inside_depth)} mm less ${f3(p.clearance)} mm each side${ko.length ? `, notched round ${ko.length} keep-out${ko.length > 1 ? 's' : ''}` : ''}.`,
        'export default () => (',
        plain
          ? `  <board width=${mm(w)} height=${mm(h)}>`
          : `  <board outline={[\n${pts.map(([x, y]) => `      { x: ${f3(x)}, y: ${f3(y)} },`).join('\n')}\n    ]}>`,
        ...(p.holes ? corners(w, h, p.hole_inset).map(([x, y]) => holeTsx(x, y, 3.2)) : []),
        '  </board>',
        ')',
      ]
    },
  },
}

function carrierTsx(p, m) {
  const half = m.rows / 2
  const lenY = (m.pins - 1) * 2.54
  if (p.width < m.rows + 8) throw new Error(`width: at least ${f3(m.rows + 8)} mm for the ${m.name}’s rows.`)
  if (p.height < lenY + 6) throw new Error(`height: at least ${f3(lenY + 6)} mm for ${m.pins} pins.`)
  const inset = 3.5
  return [
    `// Sockets for a ${m.name}: ${m.pins} pins a side, rows ${f3(m.rows)} mm apart (typical — measure yours).`,
    `// Pin ${m.vcc} of J1 is taken as 3V3 and pin ${m.gnd} as GND for the power LED: check your board’s pinout.`,
    'export default () => (',
    `  <board width=${mm(p.width)} height=${mm(p.height)}>`,
    `    <pinheader name="J1" pinCount={${m.pins}} pitch="2.54mm" gender="female" pcbX=${mm(-half)} pcbY="0mm" pcbRotation="90deg" />`,
    `    <pinheader name="J2" pinCount={${m.pins}} pitch="2.54mm" gender="female" pcbX=${mm(half)} pcbY="0mm" pcbRotation="90deg" />`,
    `    <resistor name="R1" resistance="1k" footprint="0603" pcbX="0mm" pcbY=${mm(lenY / 2 + 1)} />`,
    `    <led name="LED1" color="green" footprint="0603" pcbX="0mm" pcbY=${mm(-lenY / 2 - 1)} />`,
    `    <trace from=".J1 > .pin${m.vcc}" to=".R1 > .pin1" />`,
    '    <trace from=".R1 > .pin2" to=".LED1 > .anode" />',
    `    <trace from=".LED1 > .cathode" to=".J1 > .pin${m.gnd}" />`,
    ...corners(p.width, p.height, inset).map(([x, y]) => holeTsx(x, y, 3.2)),
    '  </board>',
    ')',
  ]
}

/** A template's values: its defaults, then those given, each checked. */
export function templateValues(id, given = {}) {
  const t = TEMPLATES[id]
  if (!t) throw new Error(`There is no template "${id}" (there are ${Object.keys(TEMPLATES).join(', ')}).`)
  if (given !== undefined && given !== null && (typeof given !== 'object' || Array.isArray(given))) throw new Error('params: the template’s values by key, { width: 50 }.')
  const g = given ?? {}
  const out = {}
  for (const [k, [lo, hi, d]] of Object.entries(t.params)) out[k] = num(g[k], k, lo, hi, d)
  for (const k of Object.keys(g)) if (!Object.hasOwn(t.params, k) && !(id === 'enclosure' && k === 'keepouts')) throw new Error(`${k} is not a value of the ${id} template (it takes ${Object.keys(t.params).join(', ')}${id === 'enclosure' ? ', keepouts' : ''}).`)
  if (id === 'enclosure' && g.keepouts !== undefined) {
    if (!Array.isArray(g.keepouts) || g.keepouts.length > 32) throw new Error('keepouts: a list of up to 32 circles { x, y, r } in mm, the enclosure’s centre at 0, 0.')
    out.keepouts = g.keepouts.map((k, i) => {
      if (!k || typeof k !== 'object') throw new Error(`keepouts[${i}]: { x, y, r } in mm.`)
      return { x: num(k.x, `keepouts[${i}].x`, -500, 500), y: num(k.y, `keepouts[${i}].y`, -500, 500), r: num(k.r, `keepouts[${i}].r`, 0.1, 100) }
    })
    if (out.keepouts.some((k) => k.x === undefined || k.y === undefined || k.r === undefined)) throw new Error('keepouts: each needs x, y and r.')
  }
  if (out.holes !== undefined) out.holes = out.holes >= 0.5 ? 1 : 0
  const why = t.check?.(out)
  if (why) throw new Error(why)
  return out
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/
/** Names in the circuits folder that are its own. */
const RESERVED = new Set(['builds', 'projects.json'])

/** A project is a folder of its own: not the root, not the home folder or
 *  one above it — a build there would let its files be read as a project's. */
function guardFolder(dir) {
  const h = homedir()
  if (dir === resolve('/') || isInside(h, dir)) throw new Error(`${dir} is not a project folder this takes: give a folder of its own, below your home folder.`)
}

/** A project's folder from a name (under circuits/) or a path. */
export function projectDir(project, env = process.env) {
  if (typeof project !== 'string' || !project.trim()) throw new Error('project: a project’s name (circuit_files lists them) or its folder.')
  const p = project.trim()
  if (isAbsolute(tilde(p))) return resolve(tilde(p))
  if (!SAFE_NAME.test(p) || RESERVED.has(p.toLowerCase())) throw new Error(`project: "${p}" is not a name this takes — letters, digits, . _ and -, up to 60, or an absolute folder.`)
  return join(circuitsDir(env), p)
}

/** Projects made or built outside circuits/, so the page may read them. */
async function remember(dir, env) {
  if (isInside(dir, circuitsDir(env))) return
  const file = join(circuitsDir(env), 'projects.json')
  const list = await knownProjects(env)
  if (list.includes(dir)) return
  await mkdir(circuitsDir(env), { recursive: true })
  await writeFile(file, JSON.stringify({ projects: [dir, ...list].slice(0, 200) }, null, 2) + '\n')
}

async function knownProjects(env) {
  try {
    const j = JSON.parse(await readFile(join(circuitsDir(env), 'projects.json'), 'utf8'))
    return Array.isArray(j.projects) ? j.projects.filter((p) => typeof p === 'string' && isAbsolute(p)) : []
  } catch {
    return []
  }
}

const isInside = (p, root) => {
  const r = relative(root, p)
  return r === '' || (!r.startsWith('..') && !isAbsolute(r))
}

/** Scaffold a project folder from a template, as `tsci init` lays one out:
 *  package.json, tsconfig.json, .gitignore and index.circuit.tsx. Refuses a
 *  folder that already holds files. */
export async function newProject({ name, template = 'blank', params = {}, dir }, env = process.env) {
  if (typeof name !== 'string' || !SAFE_NAME.test(name)) throw new Error('name: letters, digits, . _ and -, up to 60, starting with a letter or digit.')
  if (!dir && RESERVED.has(name.toLowerCase())) throw new Error(`name: "${name}" is the circuits folder’s own — pick another.`)
  if (dir !== undefined && (typeof dir !== 'string' || !isAbsolute(tilde(dir)))) throw new Error('dir: a full folder path (/Users/…/boards), or leave it out.')
  const values = templateValues(template, params)
  const t = TEMPLATES[template]
  const folder = dir ? resolve(tilde(dir), name) : join(circuitsDir(env), name)
  guardFolder(folder)
  if (existsSync(folder) && readdirSync(folder).length) throw new Error(`${folder} is there already and not empty — pick another name, or build it with circuit_build.`)
  const tsx = t.tsx(values)
  await mkdir(folder, { recursive: true })
  const pkg = {
    name: name.toLowerCase().replace(/[^a-z0-9._-]/g, '-'),
    version: '1.0.0',
    description: `${t.label} — made with ScanRuler’s ${template} template`,
    main: 'index.circuit.tsx',
    keywords: ['tscircuit', 'circuit', 'pcb', 'electronics'],
    scripts: { dev: 'tsci dev', build: 'tsci build', snapshot: 'tsci snapshot' },
    devDependencies: { tscircuit: 'latest', typescript: '^5.0.0' },
  }
  const tsconfig = {
    compilerOptions: { target: 'ES2020', module: 'ESNext', jsx: 'react-jsx', strict: true, esModuleInterop: true, moduleResolution: 'node', skipLibCheck: true, resolveJsonModule: true, types: ['tscircuit'] },
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['node_modules', 'dist'],
  }
  const files = {
    'package.json': JSON.stringify(pkg, null, 2) + '\n',
    'tsconfig.json': JSON.stringify(tsconfig, null, 2) + '\n',
    '.gitignore': 'node_modules\ndist\n',
    'index.circuit.tsx': tsx.join('\n') + '\n',
  }
  for (const [f, text] of Object.entries(files)) await writeFile(join(folder, f), text)
  await remember(folder, env)
  return { project: folder, name, template, values, files: Object.keys(files), entry: 'index.circuit.tsx', next: 'Edit index.circuit.tsx (tsci dev in that folder shows it live), then circuit_build.' }
}

// ---- building --------------------------------------------------------------------

/** What a build can hand back, and the export format behind each. bom and
 *  pnp come out of the Gerbers zip, where tsci puts bom.csv and
 *  pick_and_place.csv. */
export const OUTPUTS = {
  gerbers: { format: 'gerbers', file: 'gerbers.zip' },
  bom: { format: 'gerbers', from: 'bom.csv' },
  pnp: { format: 'gerbers', from: 'pick_and_place.csv' },
  kicad_pcb: { format: 'kicad_pcb', file: 'board.kicad_pcb' },
  step: { format: 'step', file: 'board.step' },
  glb: { format: 'glb', file: 'board.glb' },
  pcb_svg: { format: 'pcb-svg', file: 'pcb.svg' },
  schematic_svg: { format: 'schematic-svg', file: 'schematic.svg' },
  netlist: { format: 'readable-netlist', file: 'readable.netlist' },
}

/** The board file a project builds: entry if given (inside the project),
 *  else package.json's main, else index.circuit.tsx, index.tsx, or the one
 *  *.circuit.tsx at the top. */
export function entryOf(dir, entry) {
  if (entry !== undefined) {
    if (typeof entry !== 'string' || !entry.trim()) throw new Error('entry: the board file, relative to the project.')
    const p = resolve(dir, entry)
    if (!isInside(p, dir)) throw new Error(`entry: ${entry} is outside the project.`)
    if (!existsSync(p)) throw new Error(`entry: there is no ${entry} in ${dir}.`)
    if (!/\.(tsx|ts|jsx|js)$|(^|[/\\.])circuit\.json$/i.test(p)) throw new Error(`entry: ${entry} is not a .tsx board file or a circuit.json.`)
    return relative(dir, p)
  }
  try {
    const pj = join(dir, 'package.json')
    const main = statSync(pj).size < 1_000_000 ? JSON.parse(readFileSync(pj, 'utf8')).main : undefined
    if (typeof main === 'string' && /\.(tsx|ts)$/.test(main) && existsSync(join(dir, main)) && isInside(resolve(dir, main), dir)) return main
  } catch {
    // No package.json, or no main.
  }
  for (const f of ['index.circuit.tsx', 'index.tsx']) if (existsSync(join(dir, f))) return f
  const c = readdirSync(dir).filter((f) => f.endsWith('.circuit.tsx'))
  if (c.length === 1) return c[0]
  throw new Error(c.length ? `${dir} has ${c.length} *.circuit.tsx files — say which with entry.` : `${dir} has no index.circuit.tsx, index.tsx or *.circuit.tsx to build — circuit_new makes one.`)
}


/** Where tsci build writes an entry's circuit.json, as the CLI names it:
 *  dist/<entry without .circuit.tsx / .board.tsx / .tsx>/circuit.json. */
export function builtPath(dir, entry) {
  const rel = entry.replace(/\\/g, '/')
  const sub = /(^|\/)circuit\.json$/i.test(rel) ? dirname(rel) : rel.replace(/(\.board|\.circuit)?\.tsx$/, '').replace(/\.circuit\.json$/, '')
  return join(dir, 'dist', sub, 'circuit.json')
}

/** What a circuit.json says of itself: element counts, the boards, and its
 *  *_error and *_warning elements' messages. */
export function summarize(json) {
  const els = Array.isArray(json) ? json : []
  const counts = {}
  const errors = []
  const warnings = []
  for (const e of els) {
    const t = typeof e?.type === 'string' ? e.type : '?'
    counts[t] = (counts[t] ?? 0) + 1
    const message = typeof e?.message === 'string' ? e.message.slice(0, 400) : ''
    if (/_error$/.test(t) && errors.length < 100) errors.push({ type: t, message })
    else if (/_warning$/.test(t) && warnings.length < 100) warnings.push({ type: t, message })
  }
  const boards = els.filter((e) => e?.type === 'pcb_board').map((b) => ({ width: b.width ?? null, height: b.height ?? null, thickness: b.thickness ?? null, layers: b.num_layers ?? null, outline: Array.isArray(b.outline) ? b.outline.length : 0 }))
  return { elements: els.length, counts, boards, errors, warnings, errorCount: counts && Object.entries(counts).filter(([k]) => /_error$/.test(k)).reduce((s, [, n]) => s + n, 0), warningCount: Object.entries(counts).filter(([k]) => /_warning$/.test(k)).reduce((s, [, n]) => s + n, 0) }
}

/** Build a project with tsci into a job folder of its own: tsci build, then
 *  tsci export from the circuit.json it wrote for each output asked for. */
export async function build({ project, entry, outputs = [], routing = true, partsEngine = true, name } = {}, env = process.env, { signal, progress = () => {}, timeoutMs = 600_000 } = {}) {
  const dir = projectDir(project, env)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`There is no project folder ${dir} — circuit_new makes one, circuit_files lists them.`)
  guardFolder(dir)
  if (!Array.isArray(outputs)) throw new Error('outputs: a list.')
  const unknown = outputs.filter((o) => !Object.hasOwn(OUTPUTS, o))
  if (unknown.length) throw new Error(`outputs: ${unknown.join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not one this builds (${Object.keys(OUTPUTS).join(', ')}).`)
  if (name !== undefined && (typeof name !== 'string' || !SAFE_NAME.test(name))) throw new Error('name: letters, digits, . _ and -, up to 60.')
  const ent = entryOf(dir, entry)
  const t = await findTsci(env, dir)
  if (!t) throw new Error(INSTALL_HOW_TO)
  if (t.broken) throw new Error(t.broken)
  const tenv = envFor(t.path, env)
  const fromJson = /(^|[/\\.])circuit\.json$/i.test(ent)
  const buildFlags = ['--ignore-errors', ...(routing === false ? ['--routing-disabled'] : []), ...(partsEngine === false ? ['--disable-parts-engine'] : [])]
  const formats = [...new Set(outputs.map((o) => OUTPUTS[o].format))]
  progress('check', 'Reading what the installed tsci takes')
  if (!fromJson) await requireHelp(t, 'build', buildFlags, [], env)
  if (formats.length) await requireHelp(t, 'export', ['--format', '--output'], formats, env)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const jobBase = `${stamp}-${(name ?? basename(dir)).replace(/[^A-Za-z0-9._-]+/g, '_')}`
  let jobId = jobBase
  // Two builds in one second: the second gets -2, -3 …
  for (let n = 2; existsSync(join(buildsDir(env), jobId)); n++) jobId = `${jobBase}-${n}`
  const job = join(buildsDir(env), jobId)
  await mkdir(job, { recursive: true })
  await remember(dir, env)
  const commands = []
  let log = ''
  const step = async (args, what) => {
    signal?.throwIfAborted?.()
    progress(what, `tsci ${args.join(' ')}`)
    commands.push({ args: [...t.pre, ...args], cwd: dir })
    const r = await run(t.cmd, [...t.pre, ...args], { cwd: dir, env: tenv, timeoutMs, signal })
    log += `$ tsci ${args.join(' ')}\n${r.log}\n[exit ${r.code}${r.timedOut ? ', out of time' : ''}]\n\n`
    return r
  }
  const started = Date.now()
  const head = { job: jobId, folder: job, project: dir, entry: ent, tsci: { path: t.path, via: t.via } }
  const finish = async (extra) => {
    await writeFile(join(job, 'command.json'), JSON.stringify({ tsci: t.path, commands }, null, 2))
    await writeFile(join(job, 'build.log'), log)
    const out = { ...head, seconds: Math.round((Date.now() - started) / 100) / 10, ...extra }
    await writeFile(join(job, 'job.json'), JSON.stringify(out, null, 2))
    return out
  }
  let circuitJson = join(job, 'circuit.json')
  try {
    if (fromJson) await copyFile(join(dir, ent), circuitJson)
    else {
      const r = await step(['build', ent, ...buildFlags], 'build')
      const at = builtPath(dir, ent)
      const fresh = existsSync(at) && statSync(at).mtimeMs >= started - 2000 ? at : await newestCircuitJson(join(dir, 'dist'), started - 2000)
      if (!fresh) {
        const tail = r.log.trim().split('\n').slice(-6).join(' | ')
        const failed = await finish({ ok: false, exitCode: r.code })
        throw Object.assign(new Error(`tsci build wrote no circuit.json (exit ${r.code}${r.timedOut ? ', out of time' : ''}): ${tail || 'no output'} — the log is ${join(job, 'build.log')}.`), { job: failed })
      }
      await copyFile(fresh, circuitJson)
    }
  } catch (e) {
    if (e.job || e.cancelled) {
      if (e.cancelled) await finish({ ok: false, cancelled: true }).catch(() => {})
      throw e
    }
    await finish({ ok: false, error: e.message }).catch(() => {})
    throw e
  }
  const files = { 'circuit.json': circuitJson }
  const failed = []
  try {
    for (const format of formats) {
      const target = Object.entries(OUTPUTS).find(([, o]) => o.format === format && o.file)?.[1].file ?? `${format}.out`
      const r = await step(['export', circuitJson, '--format', format, '--output', join(job, target)], `export ${format}`)
      if (r.code === 0 && existsSync(join(job, target))) files[target] = join(job, target)
      else failed.push({ format, exitCode: r.code, said: r.log.trim().split('\n').slice(-4).join(' | ').slice(0, 600) })
    }
  } catch (e) {
    if (e.cancelled) await finish({ ok: false, cancelled: true }).catch(() => {})
    throw e
  }
  // BOM and pick-and-place: out of the Gerbers zip.
  if (files['gerbers.zip']) {
    try {
      const z = await zipEntries(files['gerbers.zip'], { maxEntryBytes: 50 * 2 ** 20 })
      for (const want of ['bom.csv', 'pick_and_place.csv']) {
        const e = z.entries.find((x) => basename(x.name).toLowerCase() === want)
        if (e) {
          await writeFile(join(job, want), z.read(e))
          files[want] = join(job, want)
        }
      }
      files.gerberLayers = z.entries.map((e) => e.name).filter((n) => !/\.csv$/i.test(n))
    } catch (e) {
      failed.push({ format: 'gerbers', said: `The zip could not be read: ${e.message}` })
    }
  }
  for (const o of outputs) if (OUTPUTS[o].from && !files[OUTPUTS[o].from] && !failed.some((f) => f.format === 'gerbers')) failed.push({ format: o, said: `The Gerbers zip held no ${OUTPUTS[o].from}.` })
  let summary
  try {
    summary = summarize(JSON.parse(await readFile(circuitJson, 'utf8')))
  } catch (e) {
    summary = { unreadable: `circuit.json is not JSON: ${e.message}` }
  }
  const layers = files.gerberLayers
  delete files.gerberLayers
  return finish({ ok: !summary.unreadable, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v])), ...(layers ? { gerberFiles: layers } : {}), ...(failed.length ? { exportsFailed: failed } : {}), summary })
}

async function newestCircuitJson(dist, since) {
  let best = null
  const walk = async (d, depth) => {
    if (depth > 6 || !existsSync(d)) return
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p, depth + 1)
      else if (e.name === 'circuit.json') {
        const m = (await stat(p)).mtimeMs
        if (m >= since && (!best || m > best.m)) best = { p, m }
      }
    }
  }
  await walk(dist, 0)
  return best?.p ?? null
}

// ---- files -------------------------------------------------------------------------

export async function jobs(env = process.env) {
  const dir = buildsDir(env)
  if (!existsSync(dir)) return []
  const out = []
  for (const name of (await readdir(dir)).sort().reverse().slice(0, 50)) {
    try {
      const j = JSON.parse(await readFile(join(dir, name, 'job.json'), 'utf8'))
      out.push({ job: j.job, ok: j.ok, project: j.project, entry: j.entry, files: Object.keys(j.files ?? {}), errors: j.summary?.errorCount ?? null, warnings: j.summary?.warningCount ?? null })
    } catch {
      // A build that never finished writing.
    }
  }
  return out
}

export async function job(id, env = process.env) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('job: a job id from circuit_files.')
  const f = join(buildsDir(env), id, 'job.json')
  if (!existsSync(f)) throw new Error(`No job "${id}" — circuit_files lists them.`)
  return JSON.parse(await readFile(f, 'utf8'))
}

async function listDir(root, { maxDepth = 5, cap = 500 } = {}) {
  const out = []
  const walk = async (d, depth) => {
    if (depth > maxDepth || out.length >= cap) return
    for (const e of (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= cap) return
      if (e.name === 'node_modules' || e.name === '.git') continue
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p, depth + 1)
      else if (e.isFile()) out.push({ path: relative(root, p).split(sep).join('/'), bytes: (await stat(p)).size })
    }
  }
  await walk(root, 0)
  return out
}

/** The projects and builds, or one's files. */
export async function files({ project, job: jobId } = {}, env = process.env) {
  if (project !== undefined && jobId !== undefined) throw new Error('Give project or job, not both.')
  if (jobId !== undefined) {
    const j = await job(jobId, env)
    return { job: j.job, folder: j.folder, ok: j.ok, files: await listDir(j.folder) }
  }
  if (project !== undefined) {
    const dir = projectDir(project, env)
    if (!existsSync(dir)) throw new Error(`There is no project ${dir}.`)
    return { project: dir, entry: (() => { try { return entryOf(dir) } catch { return null } })(), files: await listDir(dir) }
  }
  const root = circuitsDir(env)
  const projects = []
  if (existsSync(root))
    for (const e of await readdir(root, { withFileTypes: true }))
      if (e.isDirectory() && e.name !== 'builds' && existsSync(join(root, e.name, 'package.json'))) projects.push({ name: e.name, folder: join(root, e.name) })
  for (const p of await knownProjects(env)) if (existsSync(p)) projects.push({ name: basename(p), folder: p })
  return { folder: root, projects, builds: await jobs(env) }
}

const TEXT = /\.(json|tsx?|jsx?|csv|kicad_pcb|kicad_sch|kicad_pro|svg|md|txt|log|netlist|step|stp|dsn|gbr|gtl|gbl|gto|gbo|gts|gbs|gko|drl|xln|cir)$/i
export const READ_CAP = 20 * 2 ** 20

/** A file of a project or a build, as text — one a page or an agent may
 *  read: inside the circuits folder or a project made or built here. A zip
 *  answers with what it holds. */
export async function readCircuitFile({ path, project, job: jobId, entry }, env = process.env) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('path: the file, relative to the project or job, or absolute.')
  let base = null
  if (jobId !== undefined) base = (await job(jobId, env)).folder
  else if (project !== undefined) base = projectDir(project, env)
  const p = base ? resolve(base, path) : resolve(tilde(path))
  if (base && !isInside(p, base)) throw new Error(`${path} is outside the ${jobId ? 'job' : 'project'}.`)
  const roots = [circuitsDir(env), ...(await knownProjects(env))]
  if (!roots.some((r) => isInside(p, r))) throw new Error(`${p} is not in a circuit project or build this server made or built — it reads only those.`)
  if (!existsSync(p) || !statSync(p).isFile()) throw new Error(`There is no file ${p}.`)
  // Where it really is, past any link: inside one of them too.
  const real = realpathSync(p)
  const realRoots = roots.filter((r) => existsSync(r)).map((r) => realpathSync(r))
  if (!realRoots.some((r) => isInside(real, r))) throw new Error(`${p} links to ${real}, outside the circuit projects and builds — not read.`)
  const size = statSync(p).size
  if (/\.zip$/i.test(p)) {
    const z = await zipEntries(p, { maxEntryBytes: READ_CAP })
    if (entry === undefined) return { path: p, bytes: size, entries: z.entries.map((e) => ({ name: e.name, bytes: e.uncompressed })) }
    const e = z.entries.find((x) => x.name === entry)
    if (!e) throw new Error(`${basename(p)} holds no ${entry}.`)
    if (!TEXT.test(e.name)) throw new Error(`${entry} is not a text file this reads.`)
    return { path: p, entry: e.name, bytes: e.uncompressed, text: z.read(e).toString('utf8') }
  }
  if (!TEXT.test(p)) throw new Error(`${basename(p)} is not a text file this reads (${extname(p) || 'no extension'}) — its path is ${p}.`)
  if (size > READ_CAP) throw new Error(`${basename(p)} is ${Math.round(size / 2 ** 20)} MB — more than the ${READ_CAP / 2 ** 20} MB this reads.`)
  return { path: p, bytes: size, text: await readFile(p, 'utf8') }
}

/** Builds one at a time — the tool's and the page's alike: tsci's own
 *  build is heavy, and two in one project would write the same dist/. */
let queue = Promise.resolve()
let waitingBuilds = 0
export const buildsWaiting = () => waitingBuilds
export function buildInTurn(args, env = process.env, opts = {}) {
  waitingBuilds++
  const mine = queue.then(() => {
    waitingBuilds--
    if (opts.signal?.aborted) throw cancelled()
    return build(args, env, opts)
  })
  queue = mine.catch(() => {})
  return mine
}

/** Every template: its label, what it is, and its values with their ranges. */
export const templatesInfo = () =>
  Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label, blurb: t.blurb, params: Object.fromEntries(Object.entries(t.params).map(([k, [min, max, dflt, what]]) => [k, { min, max, default: dflt, what }])), ...(id === 'enclosure' ? { keepouts: 'Circles to notch the outline round: [{ x, y, r }] in mm, the enclosure’s centre at 0, 0 — bosses or posts.' } : {}) }))
