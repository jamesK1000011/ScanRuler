// SPDX-License-Identifier: AGPL-3.0-only
// The printers set up on this computer (printers.json in the ScanRuler
// folder), and getting a sliced job onto one: test, status, upload, and a
// start that only asks the person. Pause, resume and stop go straight
// through. Secrets come from the Keychain or the secrets file (secrets.js)
// and never appear in an answer.

import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { openUrl } from './catalog.js'
import { adapterFor, KINDS } from './printers/adapters.js'
import { ask, cancelRequest, listRequests } from './printers/confirm.js'
import { getSecret, hasSecret } from './secrets.js'
import { home, job as sliceJob } from './slicer.js'

const tilde = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)
const FIELDS = ['name', 'kind', 'host', 'port', 'serial', 'folder', 'app', 'storage', 'useAms', 'amsMapping', 'plate', 'startUrl', 'mqttPort', 'ftpPort', 'user', 'model', 'camera', 'cameraPort', 'ffmpeg', 'fingerprint']

export async function loadPrinters(env = process.env) {
  const file = join(home(env), 'printers.json')
  const printers = existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')).printers ?? []) : []
  return { file, printers }
}

async function savePrinters(printers, env) {
  await mkdir(home(env), { recursive: true })
  const file = join(home(env), 'printers.json')
  await writeFile(file, JSON.stringify({ printers }, null, 2))
  return file
}

const account = (name) => `printer:${name}`

async function find(name, env) {
  const { printers } = await loadPrinters(env)
  const p = printers.find((x) => x.name === name) ?? (printers.length === 1 && !name ? printers[0] : null)
  if (!p) throw new Error(printers.length ? `No printer "${name}" — have ${printers.map((x) => x.name).join(', ')}.` : 'No printer is set up — printer_add adds one.')
  return p
}

async function adapter(p, env) {
  return adapterFor(p, KINDS[p.kind]?.secret ? await getSecret(account(p.name), env) : null, env)
}

export async function list(env = process.env) {
  const { file, printers } = await loadPrinters(env)
  return {
    file,
    printers: await Promise.all(printers.map(async (p) => ({ ...Object.fromEntries(FIELDS.filter((f) => p[f] !== undefined && f !== 'fingerprint').map((f) => [f, p[f]])), adapter: KINDS[p.kind]?.label, starts: KINDS[p.kind]?.starts, ...(KINDS[p.kind]?.secret ? { secret: (await hasSecret(account(p.name), env)) ? 'set' : `not set — ${KINDS[p.kind].secret}` } : {}), ...(p.fingerprint ? { pinned: true } : {}) }))),
    kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { label: v.label, needs: v.needs, secret: v.secret, starts: v.starts, note: v.note }])),
  }
}

export async function add(input, env = process.env) {
  const kind = KINDS[input.kind]
  if (!kind) throw new Error(`No kind "${input.kind}" — kinds: ${Object.keys(KINDS).join(', ')}.`)
  for (const f of kind.needs) if (!input[f]) throw new Error(`A ${kind.label} needs ${f}.`)
  if (!/^[\w .-]{1,40}$/.test(input.name ?? '')) throw new Error('Name it with letters, digits, spaces, dots, dashes or underscores (40 at most).')
  const { printers } = await loadPrinters(env)
  const entry = Object.fromEntries(FIELDS.filter((f) => f !== 'fingerprint' && input[f] !== undefined).map((f) => [f, f === 'folder' ? resolve(tilde(input[f])) : input[f]]))
  const old = printers.find((p) => p.name === input.name)
  const next = old ? printers.map((p) => (p === old ? { ...entry, ...(old.host === entry.host && old.fingerprint ? { fingerprint: old.fingerprint } : {}) } : p)) : [...printers, entry]
  const file = await savePrinters(next, env)
  const secretSet = kind.secret ? await hasSecret(account(input.name), env) : null
  return {
    saved: file,
    printer: entry.name,
    ...(kind.secret && !secretSet ? { secret: `Not set. The person adds ${kind.secret} in a terminal, where it stays out of this chat: node mcp/src/extras/secrets.js set ${account(input.name)}` } : {}),
    note: kind.note,
    next: 'printer_test checks it can be reached.',
  }
}

export async function remove(name, env = process.env) {
  const { printers } = await loadPrinters(env)
  if (!printers.some((p) => p.name === name)) throw new Error(`No printer "${name}".`)
  return { saved: await savePrinters(printers.filter((p) => p.name !== name), env), removed: name, note: `Its secret stays in the Keychain or secrets file until removed: node mcp/src/extras/secrets.js delete ${account(name)}` }
}

export async function test(name, { trust = false } = {}, env = process.env) {
  const p = await find(name, env)
  const a = await adapter(trust ? { ...p, fingerprint: undefined } : p, env)
  const r = await a.test()
  if (a.seen?.fingerprint && a.seen.fingerprint !== p.fingerprint) {
    const { printers } = await loadPrinters(env)
    await savePrinters(printers.map((x) => (x.name === p.name ? { ...x, fingerprint: a.seen.fingerprint } : x)), env)
    r.pinned = 'The printer’s certificate is pinned: a different one will be refused.'
  }
  delete r.fingerprint
  return { printer: p.name, ...r }
}

export async function status(name, env = process.env) {
  const p = await find(name, env)
  return { printer: p.name, ...(await (await adapter(p, env)).status()) }
}

const lastUpload = new Map()

/** The file for a slicer job: its 3MF for a Bambu printer, else its G-code. */
async function fileFor(p, { file, job }, env) {
  if (file) {
    const f = resolve(tilde(file))
    if (!existsSync(f)) throw new Error(`There is no file at ${f}.`)
    return { path: f }
  }
  if (!job) throw new Error('Give a file, or a job from slicer_jobs.')
  const j = await sliceJob(job, env)
  const tmf = join(j.folder, 'out', 'job.3mf')
  const bambuish = p.kind === 'bambu-lan' || p.kind === 'bambu-studio'
  const path = bambuish && existsSync(tmf) ? tmf : bambuish ? null : j.gcode
  if (!path) throw new Error(`Job ${job} has no 3MF for a Bambu printer; slice it with Bambu Studio or OrcaSlicer.`)
  return { path, name: `${String(j.job).slice(20, 60) || 'job'}${path.endsWith('.3mf') ? '.3mf' : '.gcode'}`, job: j }
}

export async function upload({ printer, file, job }, env = process.env) {
  const p = await find(printer, env)
  const f = await fileFor(p, { file, job }, env)
  let path = f.path
  if (f.name && basename(path) !== f.name) {
    const staged = join(home(env), 'outbox', f.name)
    await mkdir(join(home(env), 'outbox'), { recursive: true })
    await writeFile(staged, await readFile(path))
    path = staged
  }
  const r = await (await adapter(p, env)).upload(path)
  lastUpload.set(p.name, { name: basename(path), job: f.job ?? null, bytes: (await stat(path)).size })
  return { printer: p.name, next: KINDS[p.kind].starts === 'after you confirm' ? 'printer_start asks the person to start it.' : `It is started by ${KINDS[p.kind].starts}.`, ...r }
}

const minutes = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`)

export async function start({ printer, file }, env = process.env, platform = process.platform) {
  const p = await find(printer, env)
  if (KINDS[p.kind].starts !== 'after you confirm') throw new Error(`${p.name} is started by ${KINDS[p.kind].starts}, not from here.`)
  const last = lastUpload.get(p.name)
  const name = file ?? last?.name
  if (!name) throw new Error(`Name the file on ${p.name}, or printer_upload one first.`)
  const j = last?.name === name ? last.job : null
  const summary = { ...(j?.totals?.seconds ? { time: minutes(j.totals.seconds) } : {}), ...(j?.totals?.filamentG ? { filament: `${Math.round(j.totals.filamentG)} g` } : {}), ...(last?.name === name ? { size: last.bytes < 1024 ? `${last.bytes} B` : last.bytes < 1048576 ? `${Math.round(last.bytes / 1024)} KB` : `${(last.bytes / 1048576).toFixed(1)} MB` } : {}) }
  const a = await adapter(p, env)
  return ask({ printer: p.name, file: name, summary, onStart: () => a.start(name), open: (u) => openUrl(u, env, platform) }, env, platform)
}

export const requests = () => ({ requests: listRequests() })
export const withdraw = (id) => cancelRequest(id)

export async function control(name, what, env = process.env) {
  const p = await find(name, env)
  return { printer: p.name, ...(await (await adapter(p, env))[what]()) }
}

export async function camera(name, env = process.env) {
  const p = await find(name, env)
  return (await adapter(p, env)).camera()
}
