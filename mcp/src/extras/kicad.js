// SPDX-License-Identifier: AGPL-3.0-only
// KiCad's own command line, kicad-cli, run on this computer as a program of
// its own — nothing of KiCad is linked or copied in (KiCad is GPL). It is
// looked for where KiCad installs (the Mac app, Homebrew, the PATH;
// SCANRULER_KICAD_CLI names another), its version read, and each command's
// --help read before the command is used: the flags differ between KiCad 7,
// 8, 9 and 10, and a flag the installed version does not list is refused by
// name rather than guessed past.
//
// What it does here: a board's 3D model as STEP (to bring into Reverse
// Engineer), a fabrication package (Gerbers, drill files with plated and
// unplated holes apart, the placement and parts lists, the DRC report),
// and a DRC run. Each run gets a job folder under the ScanRuler folder's
// boards/; the board file itself is only read.

import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fabLayers, MAX_BOARD_BYTES, readBoard } from './kicadBoard.js'
import { home } from './slicer.js'
import { zipStore } from './zip.js'

const cancelled = () => Object.assign(new Error('Cancelled.'), { cancelled: true })

/** A program run to its end: output (capped), exit code, whether it ran
 *  out of time. Cancel or a timeout kills it and what it started. */
export function run(cmd, args, { cwd, env = process.env, timeoutMs = 600_000, signal } = {}) {
  return new Promise((resolveRun, reject) => {
    if (signal?.aborted) return reject(cancelled())
    const group = process.platform !== 'win32'
    let child
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: group })
    } catch (e) {
      return reject(new Error(`${basename(cmd)} could not be started: ${e.message}`))
    }
    let out = ''
    let timedOut = false
    const keep = (d) => {
      out += d
      if (out.length > 2e6) out = out.slice(-1e6)
    }
    const kill = () => {
      try {
        if (group && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {}
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
      reject(new Error(`${basename(cmd)} could not be started: ${e.message}`))
    })
    child.on('close', (code, sig) => {
      done()
      if (signal?.aborted) return reject(cancelled())
      resolveRun({ code, signal: sig, timedOut, out })
    })
  })
}

// ---- finding kicad-cli ------------------------------------------------------------

const tilde = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

export const KICAD_PATHS = {
  darwin: ['/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli', '~/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli', '/Applications/KiCad.app/Contents/MacOS/kicad-cli', '/opt/homebrew/bin/kicad-cli', '/usr/local/bin/kicad-cli'],
  linux: ['/usr/bin/kicad-cli', '/usr/local/bin/kicad-cli', '/snap/bin/kicad-cli', '/var/lib/flatpak/exports/bin/org.kicad.KiCad'],
  win32: ['C:/Program Files/KiCad/10.0/bin/kicad-cli.exe', 'C:/Program Files/KiCad/9.0/bin/kicad-cli.exe', 'C:/Program Files/KiCad/8.0/bin/kicad-cli.exe', 'C:/Program Files/KiCad/7.0/bin/kicad-cli.exe'],
}

const runnable = (p) => {
  try {
    if (!statSync(p).isFile()) return false
    if (process.platform !== 'win32') accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Where kicad-cli is: SCANRULER_KICAD_CLI, else where KiCad installs, else
 *  the PATH. null when none. */
export function findKicadCli(env = process.env, platform = process.platform) {
  if (env.SCANRULER_KICAD_CLI) {
    const p = tilde(env.SCANRULER_KICAD_CLI)
    return runnable(p) ? p : null
  }
  for (const p of KICAD_PATHS[platform] ?? []) {
    // The Flatpak's launcher is KiCad itself, not kicad-cli.
    if (/flatpak/.test(p)) continue
    if (runnable(tilde(p))) return tilde(p)
  }
  const sep = platform === 'win32' ? ';' : ':'
  for (const d of String(env.PATH ?? '').split(sep).filter(Boolean)) {
    for (const name of platform === 'win32' ? ['kicad-cli.exe'] : ['kicad-cli']) if (runnable(join(d, name))) return join(d, name)
  }
  return null
}

/**
 * The commands this uses, each with the flags it cannot go without (need)
 * and those it uses when there (want). Read off each command's --help
 * before use.
 *   KiCad 7: no pcb drc, no sch export bom; step has --no-virtual.
 *   KiCad 8: pcb drc (json, --exit-code-violations → 5), sch export bom;
 *            step has --no-unspecified and --no-dnp.
 *   KiCad 9, 10: as 8, more step options; drill gains --generate-report (10).
 */
export const COMMANDS = {
  step: { args: ['pcb', 'export', 'step'], need: ['--output', '--force', '--user-origin'], want: ['--subst-models', '--board-only', '--no-dnp', '--no-unspecified', '--no-virtual'] },
  gerbers: { args: ['pcb', 'export', 'gerbers'], need: ['--output', '--layers'], want: ['--no-protel-ext', '--subtract-soldermask', '--no-x2'] },
  drill: { args: ['pcb', 'export', 'drill'], need: ['--output', '--format', '--excellon-separate-th', '--excellon-units'], want: ['--generate-map', '--map-format'] },
  pos: { args: ['pcb', 'export', 'pos'], need: ['--output', '--format', '--units', '--side'], want: ['--exclude-dnp'] },
  drc: { args: ['pcb', 'drc'], need: ['--output', '--format', '--exit-code-violations'], want: ['--severity-all', '--units', '--schematic-parity'] },
  bom: { args: ['sch', 'export', 'bom'], need: ['--output'], want: ['--fields', '--labels', '--group-by', '--exclude-dnp'] },
}

/** Whether a --help text lists a flag (as a word, not the start of a longer one). */
export const lists = (help, flag) => new RegExp(`(^|[\\s,\\[|])${flag.replace(/[-]/g, '\\-')}(?=[\\s,=\\]|<]|$)`, 'm').test(help)

const cache = new Map()

/**
 * kicad-cli found, its version, and for each command the flags its --help
 * lists of those needed and wanted. `fresh` reads them again.
 */
export async function kicadTools(env = process.env, { fresh = false, platform = process.platform } = {}) {
  const path = findKicadCli(env, platform)
  if (!path) {
    return {
      found: false,
      path: null,
      ready: false,
      note: env.SCANRULER_KICAD_CLI
        ? `SCANRULER_KICAD_CLI names ${env.SCANRULER_KICAD_CLI}, which is not a program that runs.`
        : 'kicad-cli was not found. Install KiCad 8 or later (kicad.org — on a Mac it puts kicad-cli in /Applications/KiCad/KiCad.app/Contents/MacOS), or set SCANRULER_KICAD_CLI to where it is.',
    }
  }
  let mtime = 0
  try {
    mtime = statSync(path).mtimeMs
  } catch {}
  const key = `${path}@${mtime}`
  if (!fresh && cache.has(key)) return cache.get(key)
  // The version first (a KiCad that does not start says so here, once),
  // then every command's --help at once.
  const v = await run(path, ['version'], { env, timeoutMs: 20_000 }).catch((e) => ({ code: -1, out: e.message }))
  const version = /(\d+\.\d+(?:\.\d+)?)/.exec(v.out)?.[1] ?? null
  const major = version ? Number(version.split('.')[0]) : null
  const commands = {}
  await Promise.all(
    Object.entries(COMMANDS).map(async ([id, c]) => {
      const h = version ? await run(path, [...c.args, '--help'], { env, timeoutMs: 15_000 }).catch((e) => ({ code: -1, out: e.message })) : { out: '' }
      const help = h.out ?? ''
      // A command this KiCad does not have answers with the level above's
      // help, which lists none of its flags.
      const has = [...c.need, ...c.want].filter((f) => lists(help, f))
      const missing = c.need.filter((f) => !has.includes(f))
      commands[id] = { ok: missing.length === 0, has, missing }
    }),
  )
  const out = {
    found: true,
    path,
    version,
    major,
    ready: commands.step.ok,
    commands,
    ...(version ? {} : { note: `${path} did not say its version — it may not run on this computer.` }),
    ...(major !== null && major < 8 ? { note: `KiCad ${version}: board import and Gerbers work; DRC and the parts list need KiCad 8 or later.` } : {}),
  }
  cache.set(key, out)
  return out
}

/** The flags of a command to use, each checked against its --help: a
 *  needed one it lacks throws, naming it and the version. */
function flagsFor(tools, id) {
  if (!tools.found) throw new Error(tools.note)
  const c = tools.commands[id]
  if (!c?.ok) throw new Error(`kicad-cli${tools.version ? ` ${tools.version}` : ''} does not list ${c?.missing?.join(', ') ?? 'it'} for "${COMMANDS[id].args.join(' ')}" in its --help — ${id === 'drc' || id === 'bom' ? 'that needs KiCad 8 or later' : 'this KiCad is older or newer than ScanRuler knows'}.`)
  return (flag) => c.has.includes(flag)
}

// ---- the board file -------------------------------------------------------------

/** A board file named by the person: a .kicad_pcb that is there. */
export async function boardFile(path, cwd = process.cwd()) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('Give the board: the path of its .kicad_pcb file.')
  // A path pasted with the quotes a terminal or Finder put round it.
  const p = resolve(cwd, tilde(path.trim().replace(/^(['"])(.*)\1$/, '$2')))
  if (extname(p).toLowerCase() !== '.kicad_pcb') throw new Error(`${basename(p)} is not a KiCad board — give the .kicad_pcb file.`)
  const s = await stat(p).catch(() => null)
  if (!s?.isFile()) throw new Error(`No board at ${p}.`)
  if (s.size > MAX_BOARD_BYTES) throw new Error(`${basename(p)} is over 100 MB — not a board this reads.`)
  return { path: p, name: basename(p, extname(p)), size: s.size, modified: s.mtimeMs }
}

/** The board read from its file, without KiCad. */
export async function readBoardFile(path, env = process.env) {
  const f = await boardFile(path, env.SCANRULER_CWD ?? process.cwd())
  const board = readBoard(await readFile(f.path, 'utf8'), { name: f.name })
  const sch = join(dirname(f.path), `${f.name}.kicad_sch`)
  return { file: f.path, modified: f.modified, schematic: existsSync(sch) ? sch : null, ...board }
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
const safe = (s) => String(s).replace(/[^\w.() -]+/g, '_').replace(/^\.+/, '').slice(0, 60) || 'board'

async function jobDir(env, what, name) {
  const root = join(home(env), 'boards')
  await mkdir(root, { recursive: true })
  for (let n = 0; ; n++) {
    const dir = join(root, `${stamp()}-${safe(name)}-${what}${n ? `-${n}` : ''}`)
    if (existsSync(dir)) continue
    await mkdir(dir, { recursive: true })
    return dir
  }
}

const tail = (s, n = 1200) => String(s ?? '').trim().slice(-n)
/** A run that went wrong, in words, with the end of what it said. */
function failed(what, r) {
  if (r.timedOut) return new Error(`kicad-cli ran out of time on ${what}.`)
  if (r.signal) return new Error(`kicad-cli was stopped (${r.signal}) on ${what}.`)
  return new Error(`kicad-cli could not ${what} (exit ${r.code}): ${tail(r.out, 600) || 'it said nothing.'}`)
}

const fmt = (x) => String(Math.round(x * 10000) / 10000)

// ---- board import ---------------------------------------------------------------

/**
 * The board as STEP, centred on its outline's box (x right, y up, the
 * bottom face at z = 0), with what was read of it. components: false —
 * the board alone (--board-only); subst: KiCad's STEP models in place of
 * VRML ones of the same name (--subst-models); dnp: keep parts marked
 * do-not-populate (dropped by default, where --no-dnp is listed).
 */
export async function importBoard({ path, components = true, subst = true, dnp = false } = {}, env = process.env, { signal, progress = () => {} } = {}) {
  const board = await readBoardFile(path, env)
  const tools = await kicadTools(env)
  const has = flagsFor(tools, 'step')
  const job = await jobDir(env, 'step', board.name)
  const out = join(job, `${safe(board.name)}.step`)
  const args = [...COMMANDS.step.args, '--output', out, '--force', '--user-origin', `${fmt(board.origin[0])}x${fmt(board.origin[1])}mm`]
  if (subst && has('--subst-models')) args.push('--subst-models')
  if (!components && has('--board-only')) args.push('--board-only')
  if (!dnp && has('--no-dnp')) args.push('--no-dnp')
  args.push(board.file)
  progress('step', `kicad-cli ${tools.version}: exporting the board as STEP`)
  const r = await run(tools.path, args, { env, signal, timeoutMs: 900_000, cwd: job })
  await writeFile(join(job, 'command.txt'), [tools.path, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ') + '\n')
  await writeFile(join(job, 'log.txt'), r.out ?? '')
  const made = await stat(out).catch(() => null)
  if (r.code !== 0 || !made?.size) throw failed('export the STEP', r)
  if (made.size > 500 * 1024 * 1024) throw new Error(`The board's STEP is ${Math.round(made.size / 1048576)} MB — too big to bring in. Try components: false.`)
  const bytes = new Uint8Array(await readFile(out))
  // What kicad-cli said it could not find: 3D models missing.
  const warnings = [...new Set(String(r.out).split(/\r?\n/).filter((l) => /could not|cannot|not found|missing|failed/i.test(l)).map((l) => l.trim().slice(0, 240)))].slice(0, 30)
  // The placement file, where this KiCad writes it: each connector's place
  // and turn as KiCad reports them, checked against what was read here.
  let checked = null
  if (tools.commands.pos.ok) {
    const posFile = join(job, `${safe(board.name)}-pos.csv`)
    const p = await run(tools.path, [...COMMANDS.pos.args, '--output', posFile, '--format', 'csv', '--units', 'mm', '--side', 'both', board.file], { env, signal, timeoutMs: 120_000, cwd: job }).catch((e) => {
      if (e.cancelled) throw e
      return null
    })
    if (p?.code === 0 && existsSync(posFile)) checked = checkPositions(board, parseCsv(await readFile(posFile, 'utf8')))
  }
  return { board, step: { name: `${safe(board.name)}.step`, bytes, size: made.size }, job, kicad: tools.version, components, warnings, ...(checked ? { positions: checked } : {}) }
}

/** A CSV as rows of cells (quoted cells kept whole). */
export function parseCsv(text) {
  const rows = []
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"'
          i++
        } else if (c === '"') q = false
        else cur += c
      } else if (c === '"') q = true
      else if (c === ',') {
        cells.push(cur)
        cur = ''
      } else cur += c
    }
    cells.push(cur)
    rows.push(cells)
  }
  return rows
}

/** Each connector's place and turn from KiCad's placement file beside what
 *  was read from the board: the turn taken from KiCad where it gives one;
 *  `agrees` whether the two places are the same (the file's y may run
 *  either way and its origin be the page's). */
export function checkPositions(board, rows) {
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase())
  const col = (n) => head.indexOf(n)
  const [ref, x, y, rot, side] = ['ref', 'posx', 'posy', 'rot', 'side'].map(col)
  if (ref < 0 || x < 0 || y < 0) return null
  const byRef = new Map(rows.slice(1).map((r) => [r[ref], r]))
  const out = []
  for (const c of board.connectors) {
    const r = byRef.get(c.ref)
    if (!r) continue
    const px = Number(r[x])
    const py = Number(r[y])
    // Back in KiCad's frame from ours: x + cx, cy - y; the file's y may be
    // KiCad's or turned up.
    const kx = c.x + board.origin[0]
    const ky = board.origin[1] - c.y
    const agrees = Math.abs(px - kx) < 0.02 && (Math.abs(py - ky) < 0.02 || Math.abs(py + ky) < 0.02)
    const turn = rot >= 0 ? Number(r[rot]) : NaN
    if (Number.isFinite(turn)) c.rot = turn
    out.push({ ref: c.ref, agrees, rot: Number.isFinite(turn) ? turn : null, side: side >= 0 ? r[side] : null })
  }
  return out
}

// ---- DRC ------------------------------------------------------------------------

/** KiCad's DRC report (JSON) in short: counts by severity and by kind, the
 *  first violations with where they are. */
export function summariseDrc(report, keep = 50) {
  const list = (k) => (Array.isArray(report?.[k]) ? report[k] : [])
  const all = [...list('violations').map((v) => ({ ...v, group: 'violation' })), ...list('unconnected_items').map((v) => ({ ...v, group: 'unconnected' })), ...list('schematic_parity').map((v) => ({ ...v, group: 'parity' }))]
  const count = (key) => all.reduce((m, v) => ((m[v[key] ?? 'unknown'] = (m[v[key] ?? 'unknown'] ?? 0) + 1), m), {})
  return {
    violations: list('violations').length,
    unconnected: list('unconnected_items').length,
    parity: list('schematic_parity').length,
    bySeverity: count('severity'),
    byType: count('type'),
    units: report?.coordinate_units ?? null,
    items: all.slice(0, keep).map((v) => ({
      group: v.group,
      type: v.type ?? null,
      severity: v.severity ?? null,
      description: String(v.description ?? '').slice(0, 200),
      at: (Array.isArray(v.items) ? v.items : []).map((i) => (i?.pos ? [Number(i.pos.x), Number(i.pos.y)] : null)).filter(Boolean).slice(0, 2),
      items: (Array.isArray(v.items) ? v.items : []).map((i) => String(i?.description ?? '').slice(0, 120)).slice(0, 2),
    })),
    ...(all.length > keep ? { more: all.length - keep } : {}),
  }
}

/** DRC on the board, as KiCad runs it: the report in its job folder, and
 *  its summary. Exit 5 is "violations found", not a failure. */
export async function runDrc({ path, parity = false, into } = {}, env = process.env, { signal, progress = () => {} } = {}) {
  const f = await boardFile(path, env.SCANRULER_CWD ?? process.cwd())
  const tools = await kicadTools(env)
  const has = flagsFor(tools, 'drc')
  const job = into ?? (await jobDir(env, 'drc', f.name))
  const out = join(job, `${safe(f.name)}-drc.json`)
  const args = [...COMMANDS.drc.args, '--output', out, '--format', 'json', '--exit-code-violations']
  if (has('--severity-all')) args.push('--severity-all')
  if (has('--units')) args.push('--units', 'mm')
  if (parity && has('--schematic-parity')) args.push('--schematic-parity')
  args.push(f.path)
  progress('drc', `kicad-cli ${tools.version}: design rule check`)
  const r = await run(tools.path, args, { env, signal, timeoutMs: 600_000, cwd: job })
  if ((r.code !== 0 && r.code !== 5) || !existsSync(out)) throw failed('run the DRC', r)
  let report
  try {
    report = JSON.parse(await readFile(out, 'utf8'))
  } catch {
    throw new Error(`kicad-cli wrote a DRC report that is not JSON (${out}).`)
  }
  const summary = summariseDrc(report)
  return { board: f.name, clean: r.code === 0 && summary.violations === 0 && summary.unconnected === 0, exit: r.code, report: out, job, kicad: tools.version, ...summary }
}

// ---- the fab package ------------------------------------------------------------

/** KiCad's Gerber layer names (as in its file names: F_Cu) and the Protel
 *  extensions board houses read, for the fab naming. */
const PROTEL = { F_Cu: 'GTL', B_Cu: 'GBL', F_Mask: 'GTS', B_Mask: 'GBS', F_SilkS: 'GTO', B_SilkS: 'GBO', F_Silkscreen: 'GTO', B_Silkscreen: 'GBO', F_Paste: 'GTP', B_Paste: 'GBP', Edge_Cuts: 'GKO' }

/** The name a fab file goes by in the package: KiCad's own (kicad), or
 *  board.EXT with the Protel extension JLCPCB and PCBWay read (fab). */
export function fabName(file, boardName, naming) {
  if (naming !== 'fab') return file
  const base = file.replace(/\.[^.]+$/, '')
  const ext = extname(file).toLowerCase()
  if (ext === '.drl') return /NPTH/i.test(base) ? `${boardName}-NPTH.DRL` : /PTH/i.test(base) ? `${boardName}-PTH.DRL` : `${boardName}.DRL`
  if (ext === '.gbrjob') return `${boardName}.gbrjob`
  const layer = base.slice(base.lastIndexOf('-') + 1)
  // Inner copper as JLCPCB's naming page lists it: the board's second
  // layer .G2L, its third .G3L (In1.Cu is layer 2).
  const inner = /^In(\d+)_Cu$/.exec(layer)
  if (inner) return `${boardName}.G${Number(inner[1]) + 1}L`
  return PROTEL[layer] ? `${boardName}.${PROTEL[layer]}` : file
}

/** KiCad's placement CSV under the column names JLCPCB's assembly reads. */
export function fabPositions(csv) {
  const rows = parseCsv(csv)
  if (!rows.length) return csv
  const names = { Ref: 'Designator', Val: 'Val', Package: 'Package', PosX: 'Mid X', PosY: 'Mid Y', Rot: 'Rotation', Side: 'Layer' }
  const q = (c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)
  return [rows[0].map((h) => names[h.trim()] ?? h), ...rows.slice(1)].map((r) => r.map(q).join(',')).join('\n') + '\n'
}

/**
 * The fabrication package: Gerbers of the board's own layers, drill files
 * (Excellon, plated and unplated apart, mm), the placement list (CSV, mm),
 * the parts list from the schematic beside the board where there is one
 * and this KiCad makes one, and the DRC report — in a job folder, with two
 * zips: the whole package, and the Gerbers and drill files alone to upload.
 * naming: fab (Protel extensions, JLCPCB's column names: the default) or
 * kicad (KiCad's own .gbr names and columns).
 */
export async function fabPackage({ path, naming = 'fab', drc = true, dnp = false } = {}, env = process.env, { signal, progress = () => {} } = {}) {
  if (naming !== 'fab' && naming !== 'kicad') throw new Error('naming is fab or kicad.')
  const board = await readBoardFile(path, env)
  const tools = await kicadTools(env)
  const gHas = flagsFor(tools, 'gerbers')
  flagsFor(tools, 'drill')
  const pHas = flagsFor(tools, 'pos')
  const job = await jobDir(env, 'fab', board.name)
  const gdir = join(job, 'gerbers')
  await mkdir(gdir, { recursive: true })
  const notes = []
  const say = (what, detail) => progress(what, detail)
  const layers = fabLayers(board)
  say('gerbers', `Gerbers: ${layers.join(', ')}`)
  const gArgs = [...COMMANDS.gerbers.args, '--output', `${gdir}/`, '--layers', layers.join(',')]
  if (naming === 'kicad' && gHas('--no-protel-ext')) gArgs.push('--no-protel-ext')
  // JLCPCB's KiCad guide: silkscreen taken off where the mask opens (pads).
  if (naming === 'fab' && gHas('--subtract-soldermask')) gArgs.push('--subtract-soldermask')
  gArgs.push(board.file)
  const g = await run(tools.path, gArgs, { env, signal, timeoutMs: 600_000, cwd: job })
  if (g.code !== 0) throw failed('plot the Gerbers', g)
  say('drill', 'Drill files')
  const dHas = (f) => tools.commands.drill.has.includes(f)
  const dArgs = [...COMMANDS.drill.args, '--output', `${gdir}/`, '--format', 'excellon', '--excellon-separate-th', '--excellon-units', 'mm']
  // A drill map beside them, which board houses ask for (which holes are
  // plated, how many slots), as a Gerber.
  if (dHas('--generate-map') && dHas('--map-format')) dArgs.push('--generate-map', '--map-format', 'gerberx2')
  dArgs.push(board.file)
  const d = await run(tools.path, dArgs, { env, signal, timeoutMs: 300_000, cwd: job })
  if (d.code !== 0) throw failed('write the drill files', d)
  say('pos', 'Placement list')
  const posFile = join(job, `${safe(board.name)}-pos.csv`)
  const pArgs = [...COMMANDS.pos.args, '--output', posFile, '--format', 'csv', '--units', 'mm', '--side', 'both']
  if (!dnp && pHas('--exclude-dnp')) pArgs.push('--exclude-dnp')
  pArgs.push(board.file)
  const p = await run(tools.path, pArgs, { env, signal, timeoutMs: 120_000, cwd: job })
  if (p.code !== 0) throw failed('write the placement list', p)
  if (naming === 'fab' && existsSync(posFile)) await writeFile(posFile, fabPositions(await readFile(posFile, 'utf8')))

  let bom = null
  if (!board.schematic) notes.push(`No schematic (${board.name}.kicad_sch) beside the board: no parts list.`)
  else if (!tools.commands.bom.ok) notes.push(`kicad-cli ${tools.version} makes no CSV parts list (sch export bom is KiCad 8 and later).`)
  else {
    say('bom', 'Parts list')
    const bomFile = join(job, `${safe(board.name)}-bom.csv`)
    const has = (f) => tools.commands.bom.has.includes(f)
    const bArgs = [...COMMANDS.bom.args, '--output', bomFile]
    if (naming === 'fab' && has('--fields') && has('--labels') && has('--group-by')) bArgs.push('--fields', 'Value,Reference,Footprint,LCSC', '--labels', 'Comment,Designator,Footprint,LCSC Part #', '--group-by', 'Value,Footprint')
    if (!dnp && has('--exclude-dnp')) bArgs.push('--exclude-dnp')
    bArgs.push(board.schematic)
    const b = await run(tools.path, bArgs, { env, signal, timeoutMs: 120_000, cwd: job })
    if (b.code === 0 && existsSync(bomFile)) bom = bomFile
    else notes.push(`The parts list could not be made: ${tail(b.out, 300) || `exit ${b.code}`}`)
  }

  let drcResult = null
  if (drc) {
    if (!tools.commands.drc.ok) notes.push(`kicad-cli ${tools.version} has no DRC (KiCad 8 and later).`)
    else {
      try {
        drcResult = await runDrc({ path: board.file, into: job }, env, { signal, progress })
      } catch (e) {
        if (e.cancelled) throw e
        notes.push(`DRC did not run: ${e.message}`)
      }
    }
  }

  // The package: fab files at the top under the names chosen, the lists
  // and the report beside them.
  say('zip', 'Packing')
  const fabFiles = (await readdir(gdir)).filter((f) => /\.(g[a-z0-9]+|gbr|drl|gbrjob)$/i.test(f)).sort()
  if (!fabFiles.some((f) => /\.drl$/i.test(f))) notes.push('No drill file was written (a board without holes?).')
  const taken = new Set()
  const entries = []
  for (const f of fabFiles) {
    let name = fabName(f, safe(board.name), naming)
    if (taken.has(name.toLowerCase())) name = f
    taken.add(name.toLowerCase())
    entries.push({ name, data: await readFile(join(gdir, f)) })
  }
  const gerberZip = join(job, `${safe(board.name)}-gerbers.zip`)
  await writeFile(gerberZip, zipStore(entries))
  const extra = [posFile, bom, drcResult?.report].filter((x) => x && existsSync(x))
  for (const x of extra) entries.push({ name: `${x === drcResult?.report ? 'reports' : 'assembly'}/${basename(x)}`, data: await readFile(x) })
  const zip = join(job, `${safe(board.name)}-fab.zip`)
  const zipBytes = zipStore(entries)
  await writeFile(zip, zipBytes)
  return {
    board: board.name,
    naming,
    kicad: tools.version,
    job,
    zip,
    gerberZip,
    files: entries.map((e) => e.name),
    layers,
    positions: posFile,
    bom,
    drc: drcResult ? { clean: drcResult.clean, violations: drcResult.violations, unconnected: drcResult.unconnected, bySeverity: drcResult.bySeverity, report: drcResult.report } : null,
    notes,
    bytes: new Uint8Array(zipBytes),
  }
}

