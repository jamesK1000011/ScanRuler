// SPDX-License-Identifier: AGPL-3.0-only
// The slicers installed on this computer, driven from their own command
// lines: OrcaSlicer, Bambu Studio and PrusaSlicer. Which ones, where they
// are and which profiles they slice with is the person's — kept in
// slicers.json in the ScanRuler folder (~/.scanruler, or SCANRULER_HOME),
// written by slicer_detect when asked to. Nothing is assumed about a slicer
// that its own --help does not show: a flag the installed version lacks is
// refused by name rather than guessed past.
//
// Each run is a job folder under slices/: the inputs, the command line, the
// slicer's log and its output, so a run can be looked at and repeated. The
// slicer runs as a child process with a time limit, in that folder only.
// Nothing is uploaded and nothing is sent to a printer.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { readGcode } from './gcode.js'
import { zipEntries } from './zip.js'

export const KINDS = {
  orca: {
    label: 'OrcaSlicer',
    family: 'bambu',
    paths: { darwin: ['/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer'], win32: ['C:/Program Files/OrcaSlicer/orca-slicer.exe'], linux: ['/usr/bin/orca-slicer', '/usr/local/bin/orca-slicer'] },
    profileDirs: { darwin: ['~/Library/Application Support/OrcaSlicer/user'], win32: ['~/AppData/Roaming/OrcaSlicer/user'], linux: ['~/.config/OrcaSlicer/user'] },
    flags: ['--slice', '--load-settings', '--load-filaments', '--outputdir', '--export-3mf'],
  },
  bambu: {
    label: 'Bambu Studio',
    family: 'bambu',
    paths: { darwin: ['/Applications/BambuStudio.app/Contents/MacOS/BambuStudio'], win32: ['C:/Program Files/Bambu Studio/bambu-studio.exe'], linux: ['/usr/bin/bambu-studio'] },
    profileDirs: { darwin: ['~/Library/Application Support/BambuStudio/user'], win32: ['~/AppData/Roaming/BambuStudio/user'], linux: ['~/.config/BambuStudio/user'] },
    flags: ['--slice', '--load-settings', '--load-filaments', '--outputdir', '--export-3mf'],
  },
  prusa: {
    label: 'PrusaSlicer',
    family: 'prusa',
    paths: { darwin: ['/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer'], win32: ['C:/Program Files/Prusa3D/PrusaSlicer/prusa-slicer-console.exe'], linux: ['/usr/bin/prusa-slicer'] },
    profileDirs: { darwin: ['~/Library/Application Support/PrusaSlicer'], win32: ['~/AppData/Roaming/PrusaSlicer'], linux: ['~/.config/PrusaSlicer'] },
    flags: ['--export-gcode', '--load', '--output'],
  },
}

const tilde = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

export function home(env = process.env) {
  return resolve(tilde(env.SCANRULER_HOME ?? '~/.scanruler'))
}

export async function loadConfig(env = process.env) {
  const file = join(home(env), 'slicers.json')
  if (!existsSync(file)) return { file, slicers: [] }
  const json = JSON.parse(await readFile(file, 'utf8'))
  return { file, slicers: Array.isArray(json.slicers) ? json.slicers : [] }
}

export async function saveConfig(slicers, env = process.env) {
  const dir = home(env)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'slicers.json')
  await writeFile(file, JSON.stringify({ slicers }, null, 2) + '\n')
  return file
}

function run(cmd, args, { cwd, timeoutMs = 600_000 } = {}) {
  return new Promise((resolveRun) => {
    const started = Date.now()
    let child
    try {
      child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolveRun({ code: -1, log: String(e?.message ?? e), seconds: 0 })
      return
    }
    let log = ''
    const keep = (d) => (log = (log + d).slice(-200_000))
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const timer = setTimeout(() => {
      child.kill()
      keep(`\n[stopped after ${Math.round(timeoutMs / 1000)} s]`)
    }, timeoutMs)
    child.on('error', (e) => keep(`\n${e.message}`))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolveRun({ code, log, seconds: Math.round((Date.now() - started) / 100) / 10 })
    })
  })
}

/** Which of a kind's flags the installed slicer's --help names. */
export async function flagsOf(kind, path) {
  const { log } = await run(path, ['--help'], { timeoutMs: 30_000 })
  const need = KINDS[kind].flags
  return { has: need.filter((f) => log.includes(f)), missing: need.filter((f) => !log.includes(f)), version: /(\d+\.\d+\.\d+[\w.-]*)/.exec(log)?.[1] ?? null }
}

/** The slicers found where they install, and what their --help says. */
export async function detect(env = process.env, platform = process.platform) {
  const found = []
  for (const [kind, k] of Object.entries(KINDS)) {
    for (const p of k.paths[platform] ?? []) {
      if (!existsSync(p)) continue
      const f = await flagsOf(kind, p)
      found.push({ id: kind, kind, label: k.label, path: p, version: f.version, flags: f.has, missingFlags: f.missing, profileDirs: (k.profileDirs[platform] ?? []).map(tilde).filter((d) => existsSync(d)) })
      break
    }
  }
  return found
}

/** Profile files under a slicer's profile folders: JSON for the Bambu
 *  family (machine, process, filament), INI for PrusaSlicer. */
export async function listProfiles(slicer) {
  const ext = KINDS[slicer.kind].family === 'prusa' ? '.ini' : '.json'
  const out = []
  const walk = async (dir, depth) => {
    if (depth > 4 || !existsSync(dir)) return
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) await walk(p, depth + 1)
      else if (extname(e.name).toLowerCase() === ext) {
        const parent = basename(dir)
        out.push({ name: basename(e.name, ext), kind: ['machine', 'process', 'filament', 'print', 'printer'].includes(parent) ? parent : 'other', path: p })
      }
    }
  }
  for (const d of slicer.profileDirs ?? []) await walk(tilde(d), 0)
  return out
}

function pickProfile(profiles, want, kind) {
  if (!want) return null
  if (existsSync(tilde(want))) return tilde(want)
  const hit = profiles.find((p) => p.name === want && (p.kind === kind || p.kind === 'other')) ?? profiles.find((p) => p.name === want)
  if (!hit) throw new Error(`No ${kind} profile "${want}" in ${'the slicer’s profile folders'} — slicer_profiles lists them; or give a path.`)
  return hit.path
}

/** A Bambu-family profile with keys set: values as the slicer writes them —
 *  strings, or arrays of strings for a filament's per-extruder keys. */
async function overridden(path, overrides, out) {
  const json = JSON.parse(await readFile(path, 'utf8'))
  for (const [k, v] of Object.entries(overrides)) json[k] = Array.isArray(json[k]) ? json[k].map(() => String(v)) : typeof v === 'number' ? String(v) : v
  await writeFile(out, JSON.stringify(json, null, 2))
  return out
}

const PROCESS_KEYS = new Set(['xy_hole_compensation', 'xy_contour_compensation', 'elefant_foot_compensation', 'layer_height', 'wall_loops', 'sparse_infill_density', 'top_shell_layers', 'bottom_shell_layers', 'enable_support'])

export async function slice({ slicerId, model, machine, process: proc, filament, print, printer, overrides = {}, name, timeoutMs }, env = process.env) {
  const { slicers } = await loadConfig(env)
  const slicer = slicers.find((s) => s.id === slicerId) ?? (slicers.length === 1 && !slicerId ? slicers[0] : null)
  if (!slicer) throw new Error(slicers.length ? `No slicer "${slicerId}" — have ${slicers.map((s) => s.id).join(', ')}.` : 'No slicer is set up — run slicer_detect { save: true } first.')
  const src = resolve(tilde(model ?? ''))
  if (!model || !existsSync(src)) throw new Error(`There is no model at ${src} — export the part first (export_stl { path }), then give its path.`)
  const kind = KINDS[slicer.kind]
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const jobId = `${stamp}-${(name ?? basename(src, extname(src))).replace(/[^A-Za-z0-9._-]+/g, '_')}`
  const dir = join(home(env), 'slices', jobId)
  await mkdir(join(dir, 'out'), { recursive: true })
  const modelCopy = join(dir, basename(src))
  await copyFile(src, modelCopy)
  const profiles = await listProfiles(slicer)
  let args
  if (kind.family === 'bambu') {
    const m = pickProfile(profiles, machine ?? slicer.defaults?.machine, 'machine')
    let p = pickProfile(profiles, proc ?? slicer.defaults?.process, 'process')
    let f = pickProfile(profiles, filament ?? slicer.defaults?.filament, 'filament')
    const procKeys = Object.fromEntries(Object.entries(overrides).filter(([k]) => PROCESS_KEYS.has(k) || !k.startsWith('filament_')))
    const filKeys = Object.fromEntries(Object.entries(overrides).filter(([k]) => k.startsWith('filament_')))
    if (Object.keys(procKeys).length) {
      if (!p) throw new Error('Overrides on process settings need a process profile to set them in.')
      p = await overridden(p, procKeys, join(dir, 'process.json'))
    }
    if (Object.keys(filKeys).length) {
      if (!f) throw new Error('Overrides on filament settings need a filament profile to set them in.')
      f = await overridden(f, filKeys, join(dir, 'filament.json'))
    }
    const settings = [m, p].filter(Boolean)
    args = ['--slice', '0', ...(settings.length ? ['--load-settings', settings.join(';')] : []), ...(f ? ['--load-filaments', f] : []), '--outputdir', join(dir, 'out'), '--export-3mf', join(dir, 'out', 'job.3mf'), modelCopy]
  } else {
    const loads = [printer ?? slicer.defaults?.printer, print ?? slicer.defaults?.print, filament ?? slicer.defaults?.filament].filter(Boolean).map((x) => pickProfile(profiles, x, 'print'))
    const keys = Object.entries(overrides).flatMap(([k, v]) => [`--${k.replace(/_/g, '-')}`, String(v)])
    args = ['--export-gcode', ...loads.flatMap((l) => ['--load', l]), ...keys, '--output', join(dir, 'out', 'job.gcode'), modelCopy]
  }
  const missing = (slicer.flags ? kind.flags.filter((f) => !slicer.flags.includes(f) && args.includes(f)) : [])
  if (missing.length) throw new Error(`${slicer.label ?? kind.label} at ${slicer.path} does not list ${missing.join(', ')} in its --help — this version cannot be driven this way.`)
  await writeFile(join(dir, 'command.json'), JSON.stringify({ slicer: slicer.id, path: slicer.path, args, overrides }, null, 2))
  const result = await run(slicer.path, args, { cwd: dir, timeoutMs })
  await writeFile(join(dir, 'slicer.log'), result.log)
  const gcode = await findGcode(join(dir, 'out'))
  const job = { job: jobId, folder: dir, slicer: slicer.id, exitCode: result.code, seconds: result.seconds, model: basename(src), overrides }
  if (!gcode) {
    const tail = result.log.trim().split('\n').slice(-6).join(' | ')
    await writeFile(join(dir, 'job.json'), JSON.stringify({ ...job, ok: false }, null, 2))
    throw new Error(`${slicer.label ?? kind.label} wrote no G-code (exit ${result.code}): ${tail || 'no output'} — the log is ${join(dir, 'slicer.log')}.`)
  }
  const read = await readGcode(gcode)
  const out = { ...job, ok: true, gcode, ...read }
  await writeFile(join(dir, 'job.json'), JSON.stringify(out, null, 2))
  return out
}

/** The G-code a run wrote: a .gcode in the output folder, or the first
 *  plate inside its exported .3mf. */
async function findGcode(dir) {
  const files = existsSync(dir) ? await readdir(dir) : []
  const g = files.find((f) => f.toLowerCase().endsWith('.gcode'))
  if (g) return join(dir, g)
  const tmf = files.find((f) => f.toLowerCase().endsWith('.3mf'))
  if (!tmf) return null
  const zip = await zipEntries(join(dir, tmf))
  const entry = zip.entries.find((e) => /plate_\d+\.gcode$/i.test(e.name)) ?? zip.entries.find((e) => e.name.toLowerCase().endsWith('.gcode'))
  if (!entry) return null
  const out = join(dir, basename(entry.name))
  await writeFile(out, zip.read(entry))
  return out
}

export async function jobs(env = process.env) {
  const dir = join(home(env), 'slices')
  if (!existsSync(dir)) return []
  const out = []
  for (const name of (await readdir(dir)).sort().reverse().slice(0, 50)) {
    const f = join(dir, name, 'job.json')
    if (!existsSync(f)) continue
    const j = JSON.parse(await readFile(f, 'utf8'))
    out.push({ job: j.job, ok: j.ok, slicer: j.slicer, model: j.model, seconds: j.totals?.seconds ?? null, filamentG: j.totals?.filamentG ?? null, layers: j.counted?.layers ?? null, at: (await stat(f)).mtime.toISOString() })
  }
  return out
}

export async function job(id, env = process.env) {
  const f = join(home(env), 'slices', String(id ?? ''), 'job.json')
  if (!id || !existsSync(f)) throw new Error(`No job "${id}" — slicer_jobs lists them.`)
  return JSON.parse(await readFile(f, 'utf8'))
}
