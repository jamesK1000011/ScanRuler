// SPDX-License-Identifier: AGPL-3.0-only
// The printers set up on this computer (printers.json in the ScanRuler
// folder), and getting a sliced job onto one: test, status, upload, and a
// start that only asks the person. Pause, resume and stop go straight
// through. Secrets come from the Keychain or the secrets file (secrets.js)
// and never appear in an answer.

import { lookup } from 'node:dns/promises'
import { existsSync } from 'node:fs'
import { isIP } from 'node:net'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { openUrl } from './catalog.js'
import { adapterFor, KINDS } from './printers/adapters.js'
import { ask, cancelRequest, listRequests } from './printers/confirm.js'
import { getSecret, hasSecret } from './secrets.js'
import { home, job as sliceJob } from './slicer.js'

const tilde = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)
/** Fields only the person sets, by editing printers.json: a program to run
 *  (ffmpeg), where a Bambu printer fetches its job (startUrl), and leave to
 *  reach a printer that is not on the local network (allowPublic). Kept
 *  across printer_add while the host stays the same. */
const PERSON_ONLY = ['ffmpeg', 'startUrl', 'allowPublic']
const FIELDS = ['name', 'kind', 'host', 'port', 'serial', 'folder', 'app', 'storage', 'useAms', 'amsMapping', 'plate', 'startUrl', 'mqttPort', 'ftpPort', 'user', 'model', 'camera', 'cameraPort', 'ffmpeg', 'confirm', 'fingerprint', 'allowPublic']

/** What can be sent to a printer: sliced jobs, nothing else. */
export const PRINT_FILES = /\.(gcode|gco|g|bgcode|3mf|ufp)$/i

/** The host of a printer address — a name or an IP, with a port and an
 *  http(s):// in front at most; never a path, a query or a login. */
export function hostOf(h) {
  const m = /^(?:(https?):\/\/)?(\[[0-9a-f:.]+\]|[a-z0-9.-]+|[0-9a-f:]+)(?::(\d{1,5}))?\/?$/i.exec(String(h ?? '').trim())
  if (!m) throw new Error(`"${String(h).slice(0, 60)}" is not a printer address: give its name or IP, with a port if it needs one (voron.local, http://octopi:5000, or the IP the printer’s screen shows) — no path or query.`)
  return m[2].replace(/^\[|\]$/g, '')
}

/** Whether an address is on this machine or the local network: loopback,
 *  the private ranges, link-local, carrier-grade NAT, and their IPv6 kin. */
export function localAddress(a) {
  if (isIP(a) === 4) {
    const [x, y] = a.split('.').map(Number)
    return x === 10 || x === 127 || (x === 172 && y >= 16 && y < 32) || (x === 192 && y === 168) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y < 128)
  }
  if (isIP(a) === 6) {
    const l = a.toLowerCase()
    if (l.startsWith('::ffff:')) return localAddress(l.slice(7))
    return l === '::1' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l)
  }
  return false
}

/** A printer may be reached only on the local network, unless the person
 *  set allowPublic in printers.json. A name is looked up each time, so one
 *  that moves to a public address is refused then. */
async function reachable(p) {
  if (!p.host || p.allowPublic === true) return
  const h = hostOf(p.host)
  const addrs = isIP(h) ? [h] : (await lookup(h, { all: true }).catch(() => { throw new Error(`${h} could not be found on the network.`) })).map((x) => x.address)
  if (!addrs.length || !addrs.every(localAddress)) throw new Error(`${p.name} is at ${h}, which is not on the local network. Printers are reached on the local network only; if this one really is elsewhere, the person sets "allowPublic": true on it in printers.json.`)
}

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
  await reachable(p)
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
  if (input.host !== undefined) hostOf(input.host)
  if (input.app !== undefined && !/^[\w .-]{1,60}$/.test(input.app)) throw new Error('app is the name of the slicer app (BambuStudio, OrcaSlicer).')
  const { printers } = await loadPrinters(env)
  const entry = Object.fromEntries(FIELDS.filter((f) => f !== 'fingerprint' && !PERSON_ONLY.includes(f) && input[f] !== undefined).map((f) => [f, f === 'folder' ? resolve(tilde(input[f])) : input[f]]))
  const old = printers.find((p) => p.name === input.name)
  const kept = old && old.host === entry.host ? Object.fromEntries(['fingerprint', ...PERSON_ONLY].filter((f) => old[f] !== undefined).map((f) => [f, old[f]])) : {}
  const next = old ? printers.map((p) => (p === old ? { ...entry, ...kept } : p)) : [...printers, entry]
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
    if (!PRINT_FILES.test(f)) throw new Error('Only a sliced job goes to a printer: a .gcode, .bgcode or .3mf file.')
    if (!existsSync(f) || !(await stat(f)).isFile()) throw new Error(`There is no file at ${f}.`)
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

export async function start({ printer, file }, env = process.env, platform = process.platform, page = null) {
  const p = await find(printer, env)
  if (KINDS[p.kind].starts !== 'after you confirm') throw new Error(`${p.name} is started by ${KINDS[p.kind].starts}, not from here.`)
  const last = lastUpload.get(p.name)
  const name = file ?? last?.name
  if (!name) throw new Error(`Name the file on ${p.name}, or printer_upload one first.`)
  const j = last?.name === name ? last.job : null
  const summary = { ...(j?.totals?.seconds ? { time: minutes(j.totals.seconds) } : {}), ...(j?.totals?.filamentG ? { filament: `${Math.round(j.totals.filamentG)} g` } : {}), ...(last?.name === name ? { size: last.bytes < 1024 ? `${last.bytes} B` : last.bytes < 1048576 ? `${Math.round(last.bytes / 1024)} KB` : `${(last.bytes / 1048576).toFixed(1)} MB` } : {}) }
  const a = await adapter(p, env)
  return ask({ printer: p.name, file: name, summary, onStart: () => a.start(name), open: (u) => openUrl(u, env, platform), page }, p.confirm ? { ...env, SCANRULER_CONFIRM: p.confirm } : env, platform)
}

export const requests = () => ({ requests: listRequests() })
export const withdraw = (id) => cancelRequest(id)

export async function control(name, what, env = process.env, platform = process.platform, page = null) {
  const p = await find(name, env)
  if (what === 'resume' && KINDS[p.kind].starts === 'after you confirm') {
    const a = await adapter(p, env)
    return ask({ verb: 'resume', printer: p.name, file: lastUpload.get(p.name)?.name ?? 'the paused print', summary: {}, onStart: () => a.resume(), open: (u) => openUrl(u, env, platform), page }, p.confirm ? { ...env, SCANRULER_CONFIRM: p.confirm } : env, platform)
  }
  return { printer: p.name, ...(await (await adapter(p, env))[what]()) }
}

export async function camera(name, env = process.env) {
  const p = await find(name, env)
  return (await adapter(p, env)).camera()
}
