// SPDX-License-Identifier: AGPL-3.0-only
// Bringing a part's CAD in from where the person downloaded it: a search
// page opened in their own browser, the new CAD files in their downloads
// listed, and one taken — copied, or unpacked from the zip a catalogue
// sends — into an imports folder with a record of where it came from.
// Nothing is fetched by a program: the person clicks download.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { constants as FS } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { home } from './slicer.js'
import { zipEntries } from './zip.js'

export const CAD = ['.stl', '.step', '.stp', '.3mf', '.obj', '.ply', '.glb', '.gltf', '.fbx', '.3ds', '.dae', '.amf', '.wrl', '.iges', '.igs', '.blend']

const tilde = (p) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

/** What goes with a glTF or an OBJ in its zip: its buffers and textures. */
const COMPANIONS = ['.bin', '.mtl', '.png', '.jpg', '.jpeg', '.webp', '.ktx2', '.tga', '.bmp']

/** One ledger update at a time for each imports folder, so two takes at
 *  once never lose each other's records. */
const ledgerQueue = new Map()
function inTurn(folder, job) {
  const before = ledgerQueue.get(folder) ?? Promise.resolve()
  const run = before.then(job, job)
  ledgerQueue.set(folder, run.catch(() => {}))
  return run
}

/** A folder's provenance.json as a list. One not readable as a list is set
 *  aside (provenance.corrupt-<time>.json) rather than lost, and a new one
 *  begun — the files it names are still in the folder. */
async function readLedger(ledger) {
  if (!existsSync(ledger)) return { kept: [], setAside: null }
  try {
    const v = JSON.parse(await readFile(ledger, 'utf8'))
    if (Array.isArray(v)) return { kept: v, setAside: null }
  } catch {}
  const aside = ledger.replace(/\.json$/, `.corrupt-${Date.now()}.json`)
  await rename(ledger, aside)
  return { kept: [], setAside: aside }
}

/** A file written under a name not yet taken in dest — x.stl, x-2.stl … —
 *  claimed with an exclusive create, so two takes at once never write one
 *  over the other. */
async function writeFree(dest, name, bytes) {
  const ext = extname(name)
  const stem = basename(name, ext) || 'file'
  for (let i = 1; i < 10_000; i++) {
    const out = join(dest, i === 1 ? `${stem}${ext}` : `${stem}-${i}${ext}`)
    try {
      if (typeof bytes === 'string') await copyFile(bytes, out, FS.COPYFILE_EXCL)
      else await writeFile(out, bytes, { flag: 'wx' })
      return out
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
  }
  throw new Error(`No free name for ${name} in ${dest}.`)
}

/** Open a web page in the person's default browser. */
export async function openUrl(url, env = process.env, platform = process.platform) {
  let u
  try {
    u = new URL(String(url))
  } catch {
    throw new Error(`Not a web address: ${url}`)
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https pages are opened.')
  const [cmd, args] = env.SCANRULER_OPENER ? [env.SCANRULER_OPENER, [u.href]] : platform === 'darwin' ? ['open', [u.href]] : platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', u.href]] : ['xdg-open', [u.href]]
  await new Promise((resolveRun, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', (e) => reject(new Error(`The browser could not be opened: ${e.message}`)))
    child.on('spawn', () => {
      child.unref()
      resolveRun()
    })
  })
  return { opened: u.href, next: 'When the person has clicked download, catalog_downloads lists the new file and catalog_take brings it in.' }
}

/** The CAD files (and zips) in a downloads folder, newest first. */
export async function downloads({ dir, sinceMinutes = 120 } = {}, env = process.env) {
  const folder = resolve(tilde(dir ?? env.SCANRULER_DOWNLOADS ?? '~/Downloads'))
  if (!existsSync(folder)) throw new Error(`There is no folder ${folder}.`)
  const mins = Number(sinceMinutes)
  const since = Date.now() - (Number.isFinite(mins) && mins > 0 ? mins : 120) * 60_000
  const out = []
  for (const name of await readdir(folder)) {
    const ext = extname(name).toLowerCase()
    if (!CAD.includes(ext) && ext !== '.zip') continue
    const p = join(folder, name)
    let s
    try {
      s = await stat(p)
    } catch {
      continue
    }
    if (!s.isFile() || s.mtimeMs < since) continue
    out.push({ name, path: p, bytes: s.size, at: s.mtime.toISOString(), kind: ext === '.zip' ? 'zip' : ext.slice(1) })
  }
  return { folder, files: out.sort((a, b) => b.at.localeCompare(a.at)) }
}

/** Copy a download into the imports folder — unpacking the CAD files of a
 *  zip, with the buffers and textures a glTF or OBJ needs in a folder of
 *  their own — and add it to that folder's provenance.json. Everything is
 *  read first, then written: a zip that fails part way leaves nothing. */
export async function take({ file, to, source, url, licence, redistribute = false, note } = {}, env = process.env) {
  if (!file || typeof file !== 'string') throw new Error('Name the file to take (file) — catalog_downloads lists the new ones.')
  const src = resolve(tilde(file))
  if (!existsSync(src)) throw new Error(`There is no file ${src} — catalog_downloads lists the new ones.`)
  if (!(await stat(src)).isFile()) throw new Error(`${src} is a folder, not a file.`)
  if (!source) throw new Error('Say where it came from (source): a catalogue or library, so its terms go with it.')
  const dest = resolve(tilde(to ?? join(home(env), 'imports')))
  await mkdir(dest, { recursive: true })
  const ledger = join(dest, 'provenance.json')
  return inTurn(dest, async () => {
    const { kept, setAside } = await readLedger(ledger)
    const taken = []
    if (extname(src).toLowerCase() === '.zip') {
      const zip = await zipEntries(src)
      const files = zip.entries.filter((e) => !e.name.endsWith('/'))
      const cad = files.filter((e) => CAD.includes(extname(e.name).toLowerCase()))
      if (!cad.length) throw new Error(`${basename(src)} holds no CAD file (${CAD.join(', ')}).`)
      const scene = cad.some((e) => /\.(gltf|obj)$/i.test(e.name))
      const wanted = scene ? files.filter((e) => CAD.includes(extname(e.name).toLowerCase()) || COMPANIONS.includes(extname(e.name).toLowerCase())) : cad
      // Read (and so check) every entry before writing any.
      const read = wanted.map((e) => ({ e, bytes: zip.read(e) }))
      if (scene) {
        // A glTF or OBJ finds its files by their paths: kept as they sit in
        // the zip, under a folder named after it — no path leaving it.
        let folder
        for (let i = 1; ; i++) {
          folder = join(dest, `${basename(src, '.zip')}${i === 1 ? '' : `-${i}`}`)
          try {
            await mkdir(folder)
            break
          } catch (err) {
            if (err.code !== 'EEXIST') throw err
          }
        }
        for (const { e, bytes } of read) {
          const parts = e.name.replace(/\\/g, '/').split('/').filter((x) => x && x !== '.' && x !== '..')
          if (!parts.length) continue
          const out = resolve(folder, ...parts)
          if (relative(folder, out).startsWith('..') || !out.startsWith(folder + sep)) continue
          await mkdir(dirname(out), { recursive: true })
          await writeFile(out, bytes, { flag: 'wx' })
          if (CAD.includes(extname(out).toLowerCase())) taken.push(out)
        }
      } else for (const { e, bytes } of read) taken.push(await writeFree(dest, basename(e.name.replace(/\\/g, '/')), bytes))
    } else {
      if (!CAD.includes(extname(src).toLowerCase())) throw new Error(`${basename(src)} is not a CAD file this takes (${CAD.join(', ')}, or a zip of them).`)
      taken.push(await writeFree(dest, basename(src), src))
    }
    const at = new Date().toISOString()
    for (const p of taken) kept.push({ file: relative(dest, p).split(sep).join('/'), from: basename(src), source, ...(url ? { url } : {}), ...(licence ? { licence } : {}), redistribute: redistribute === true, ...(note ? { note } : {}), at })
    const tmp = `${ledger}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmp, JSON.stringify(kept, null, 2) + '\n')
    await rename(tmp, ledger)
    return { taken, provenance: ledger, ...(setAside ? { note: `The provenance.json there could not be read; it is kept as ${basename(setAside)} and a new one begun.` } : {}), next: 'Open it: scan_open or import_open for a mesh, reverse_import_step for a STEP to build on; and record it with the page’s catalog.provenance (through scanruler_batch) to keep where it came from with the project.' }
  })
}

const PARTIAL = /\.(crdownload|download|part|partial|tmp)$/i
let watcher = null

/** Watch the downloads folder: each new CAD file or zip, once its size has
 *  stopped changing, is taken into the imports folder with the source,
 *  page and licence given — no clicking through catalog_take. Runs for
 *  `minutes` (30) or until stopped; one watch at a time. */
export async function watch({ dir, to, source, url, licence, redistribute = false, note, minutes = 30, pollMs = 1000 } = {}, env = process.env) {
  if (!source) throw new Error('Say where the downloads will come from (source), so their terms go with them.')
  const folder = resolve(tilde(dir ?? env.SCANRULER_DOWNLOADS ?? '~/Downloads'))
  if (!existsSync(folder)) throw new Error(`There is no folder ${folder}.`)
  const into = resolve(tilde(to ?? join(home(env), 'imports')))
  // Checked before the watch running is stopped: a bad start leaves it be.
  const mins = Number(minutes)
  if (!(mins > 0 && mins <= 24 * 60)) throw new Error('minutes is how long to watch: more than 0, at most 1440 (a day).')
  const poll = Math.max(250, Number(pollMs) || 1000)
  if (into === folder || into.startsWith(folder + sep) || folder.startsWith(into + sep)) throw new Error(`The imports folder (${into}) is inside the folder watched (${folder}) or holds it: the watch would take its own files. Give another to.`)
  stopWatch()
  const seen = new Map()
  for (const name of await readdir(folder)) seen.set(name, 'old')
  const w = { folder, to: into, source, url, licence, redistribute, startedAt: new Date().toISOString(), until: new Date(Date.now() + mins * 60_000).toISOString(), taken: [], errors: [], sizes: new Map(), steady: new Map(), tries: new Map(), timer: null, busy: false }
  const tick = async () => {
    if (Date.now() > Date.parse(w.until)) return stopWatch()
    if (w.busy) return
    w.busy = true
    try {
      await look()
    } finally {
      w.busy = false
    }
  }
  const look = async () => {
    let names
    try {
      names = await readdir(folder)
      w.folderError = null
    } catch (e) {
      w.folderError = `The folder watched can't be read: ${e.code ?? e.message}.`
      return
    }
    for (const name of names) {
      if (seen.get(name) === 'old' || seen.get(name) === 'done' || PARTIAL.test(name)) continue
      const ext = extname(name).toLowerCase()
      if (!CAD.includes(ext) && ext !== '.zip') continue
      const p = join(folder, name)
      let st
      try {
        st = await stat(p)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      // The same size and time three looks running: finished downloading.
      const mark = `${st.size}:${st.mtimeMs}`
      const steady = w.sizes.get(name) === mark ? (w.steady.get(name) ?? 0) + 1 : 0
      w.sizes.set(name, mark)
      w.steady.set(name, steady)
      if (steady < 2 || st.size === 0) continue
      seen.set(name, 'done')
      try {
        const r = await take({ file: p, to: w.to, source, url, licence, redistribute, note }, env)
        w.taken.push({ from: name, files: r.taken, at: new Date().toISOString() })
        w.tries.delete(name)
      } catch (e) {
        // A zip still being written reads as broken: tried again, three times.
        const tries = (w.tries.get(name) ?? 0) + 1
        w.tries.set(name, tries)
        if (tries < 3) {
          seen.delete(name)
          w.steady.set(name, 0)
        } else w.errors.push({ from: name, error: String(e.message ?? e) })
      }
    }
  }
  w.timer = setInterval(tick, poll)
  w.timer.unref?.()
  watcher = w
  return watchStatus()
}

export function stopWatch() {
  if (!watcher) return { watching: false }
  clearInterval(watcher.timer)
  const was = watchStatus()
  watcher.stopped = true
  watcher.timer = null
  return { ...was, watching: false }
}

export function watchStatus() {
  if (!watcher) return { watching: false }
  const { folder, to, source, url, licence, startedAt, until, taken, errors, stopped, folderError } = watcher
  return { watching: !stopped && Date.now() <= Date.parse(until), folder, to, source, ...(url ? { url } : {}), ...(licence ? { licence } : {}), startedAt, until, taken, ...(errors.length || folderError ? { errors: [...errors, ...(folderError ? [{ error: folderError }] : [])] } : {}) }
}
