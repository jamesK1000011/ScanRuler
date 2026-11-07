// SPDX-License-Identifier: AGPL-3.0-only
// Bringing a part's CAD in from where the person downloaded it: a search
// page opened in their own browser, the new CAD files in their downloads
// listed, and one taken — copied, or unpacked from the zip a catalogue
// sends — into an imports folder with a record of where it came from.
// Nothing is fetched by a program: the person clicks download.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { home } from './slicer.js'
import { zipEntries } from './zip.js'

export const CAD = ['.stl', '.step', '.stp', '.3mf', '.obj', '.ply', '.glb', '.gltf', '.fbx', '.3ds', '.dae', '.amf', '.wrl', '.iges', '.igs', '.blend']

const tilde = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

/** Open a web page in the person's default browser. */
export async function openUrl(url, env = process.env, platform = process.platform) {
  let u
  try {
    u = new URL(String(url))
  } catch {
    throw new Error(`Not a web address: ${url}`)
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https pages are opened.')
  const [cmd, args] = env.SCANRULER_OPENER ? [env.SCANRULER_OPENER, [u.href]] : platform === 'darwin' ? ['open', [u.href]] : platform === 'win32' ? ['cmd', ['/c', 'start', '', u.href]] : ['xdg-open', [u.href]]
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
  const since = Date.now() - sinceMinutes * 60_000
  const out = []
  for (const name of await readdir(folder)) {
    const ext = extname(name).toLowerCase()
    if (!CAD.includes(ext) && ext !== '.zip') continue
    const p = join(folder, name)
    const s = await stat(p)
    if (!s.isFile() || s.mtimeMs < since) continue
    out.push({ name, path: p, bytes: s.size, at: s.mtime.toISOString(), kind: ext === '.zip' ? 'zip' : ext.slice(1) })
  }
  return { folder, files: out.sort((a, b) => b.at.localeCompare(a.at)) }
}

/** Copy a download into the imports folder — unpacking the CAD files of a
 *  zip — and add it to that folder's provenance.json. */
export async function take({ file, to, source, url, licence, redistribute = false, note } = {}, env = process.env) {
  const src = resolve(tilde(file ?? ''))
  if (!file || !existsSync(src)) throw new Error(`There is no file ${src} — catalog_downloads lists the new ones.`)
  if (!source) throw new Error('Say where it came from (source): a catalogue or library, so its terms go with it.')
  const dest = resolve(tilde(to ?? join(home(env), 'imports')))
  await mkdir(dest, { recursive: true })
  const taken = []
  const free = (name) => {
    let n = join(dest, name), i = 2
    while (existsSync(n)) n = join(dest, `${basename(name, extname(name))}-${i++}${extname(name)}`)
    return n
  }
  if (extname(src).toLowerCase() === '.zip') {
    const zip = await zipEntries(src)
    for (const e of zip.entries) {
      if (!CAD.includes(extname(e.name).toLowerCase()) || e.name.endsWith('/')) continue
      const out = free(basename(e.name))
      await writeFile(out, zip.read(e))
      taken.push(out)
    }
    if (!taken.length) throw new Error(`${basename(src)} holds no CAD file (${CAD.join(', ')}).`)
  } else {
    if (!CAD.includes(extname(src).toLowerCase())) throw new Error(`${basename(src)} is not a CAD file this takes (${CAD.join(', ')}, or a zip of them).`)
    const out = free(basename(src))
    await copyFile(src, out)
    taken.push(out)
  }
  const ledger = join(dest, 'provenance.json')
  const kept = existsSync(ledger) ? JSON.parse(await readFile(ledger, 'utf8')) : []
  const at = new Date().toISOString()
  for (const p of taken) kept.push({ file: basename(p), from: basename(src), source, ...(url ? { url } : {}), ...(licence ? { licence } : {}), redistribute: redistribute === true, ...(note ? { note } : {}), at })
  await writeFile(ledger, JSON.stringify(kept, null, 2) + '\n')
  return { taken, provenance: ledger, next: 'Open it: scan_open or import_open for a mesh, reverse_import_step for a STEP to build on; and catalog_provenance { action: "record" } to keep where it came from with the project.' }
}
