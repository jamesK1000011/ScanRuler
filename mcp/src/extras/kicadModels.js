// SPDX-License-Identifier: AGPL-3.0-only
// KiCad's official 3D model library (kicad-packages3D, by the KiCad
// Libraries Team) as a model library for the Catalog: electronic parts'
// STEP models by package name — "SOT-23", "USB_C_Receptacle",
// "PinHeader_1x04_P2.54mm". Licence: CC-BY-SA 4.0 with the KiCad
// libraries exception (designs made with the models are not bound by it);
// recorded with each file taken.
//
// Looked for first where KiCad installed them on this computer (no
// network), then in the library's GitLab repository through GitLab's API —
// a folder's file list asked for only when a search names it, kept a month
// on disk, one request a second at most, and a 429 answered by waiting —
// and its files from GitLab's raw file address.

import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const KICAD3D = {
  label: 'KiCad 3D models',
  author: 'KiCad Libraries Team',
  licence: 'CC-BY-SA 4.0 with the KiCad libraries exception',
  project: 'kicad/libraries/kicad-packages3D',
  ref: 'master',
}

const MONTH = 30 * 24 * 3600 * 1000
const PER = 12
const MAX_FILE = 100 * 1024 * 1024

/** Where a KiCad install keeps its 3D models. */
export function localModelDirs(env = process.env, platform = process.platform) {
  const named = ['SCANRULER_KICAD_3DMODELS', 'KICAD10_3DMODEL_DIR', 'KICAD9_3DMODEL_DIR', 'KICAD8_3DMODEL_DIR', 'KICAD7_3DMODEL_DIR', 'KICAD6_3DMODEL_DIR'].map((k) => env[k]).filter(Boolean)
  // Only those named when a test or the person says where.
  if (env.SCANRULER_KICAD_3DMODELS) return named.filter((d) => existsSync(d))
  const installs = {
    darwin: ['/Applications/KiCad/KiCad.app/Contents/SharedSupport/3dmodels', join(homedir(), 'Applications/KiCad/KiCad.app/Contents/SharedSupport/3dmodels'), '/Library/Application Support/kicad/3dmodels'],
    linux: ['/usr/share/kicad/3dmodels', '/usr/local/share/kicad/3dmodels'],
    win32: ['10.0', '9.0', '8.0', '7.0'].map((v) => `C:/Program Files/KiCad/${v}/share/kicad/3dmodels`),
  }
  return [...new Set([...named, ...(installs[platform] ?? [])])].filter((d) => existsSync(d))
}

/** The id of a model: its library folder and name, "Package_SO.3dshapes/SOIC-8_3.9x4.9mm_P1.27mm". */
export const ID = /^[A-Za-z0-9_.+-]+\.3dshapes\/[A-Za-z0-9_.,+()\- ]+$/
const okId = (id) => ID.test(id) && !id.split('/').some((p) => p === '..' || p === '.')

/** Which libraries hold a package, by the start of its name: KiCad's
 *  naming, so a search asks GitLab for one folder, not all of them. */
export const PREFIXES = [
  [/\bSOT-?\d|\bSC-?70|\bSOT\b/i, ['Package_TO_SOT_SMD']],
  [/\bTO-?\d/i, ['Package_TO_SOT_THT', 'Package_TO_SOT_SMD']],
  [/\b(T?SSOP|MSOP|SOIC|SOP|SO-?\d|HTSSOP|VSSOP)/i, ['Package_SO']],
  [/\b(V|W|U|X)?(QFN|DFN|SON)\b|QFN-|DFN-/i, ['Package_DFN_QFN']],
  [/QFP/i, ['Package_QFP']],
  [/BGA/i, ['Package_BGA']],
  [/\b(P?DIP)-?\d/i, ['Package_DIP']],
  [/\bD_(SOD|SMA|SMB|SMC|MiniMELF|MELF)|\bSOD-?\d/i, ['Diode_SMD']],
  [/\bD_DO|\bDO-?\d/i, ['Diode_THT']],
  [/\bR_\d{4}/i, ['Resistor_SMD']],
  [/\bR_Axial/i, ['Resistor_THT']],
  [/\bC_\d{4}|\bCP_Elec/i, ['Capacitor_SMD']],
  [/\bC_(Disc|Radial|Axial|Rect)|\bCP_Radial/i, ['Capacitor_THT']],
  [/\bL_\d{4}/i, ['Inductor_SMD']],
  [/\bLED_(\d{4}|PLCC|WS2812|SK6812)/i, ['LED_SMD']],
  [/\bLED_D\d/i, ['LED_THT']],
  [/PinHeader/i, ['Connector_PinHeader_{pitch}']],
  [/PinSocket/i, ['Connector_PinSocket_{pitch}']],
  [/USB/i, ['Connector_USB']],
  [/\bJST/i, ['Connector_JST']],
  [/Barrel/i, ['Connector_BarrelJack']],
  [/\bRJ\d|8P8C/i, ['Connector_RJ']],
  [/\bIDC/i, ['Connector_IDC']],
  [/Molex/i, ['Connector_Molex']],
  [/micro.?SD|\bSD_?Card|Card/i, ['Connector_Card']],
  [/\bSW_|Button|Tactile/i, ['Button_Switch_SMD', 'Button_Switch_THT']],
  [/Crystal|HC-?49/i, ['Crystal']],
  [/Fuse/i, ['Fuse']],
  [/Buzzer|Beeper/i, ['Buzzer_Beeper']],
  [/ESP32|ESP-?\d|RF_Module/i, ['RF_Module']],
  [/Potentiometer/i, ['Potentiometer_THT', 'Potentiometer_SMD']],
  [/Relay/i, ['Relay_THT', 'Relay_SMD']],
  [/Battery|CR\d{4}/i, ['Battery']],
  [/TerminalBlock/i, ['TerminalBlock', 'TerminalBlock_Phoenix']],
]

/** The libraries a query names: by KiCad's naming, or a folder given
 *  outright ("Package_SO/SOIC-8", "Package_SO.3dshapes"). */
export function librariesFor(query) {
  const q = String(query)
  const named = /([A-Za-z0-9_.-]+?)(?:\.3dshapes)?\//.exec(q)?.[1] ?? /([A-Za-z0-9_-]+)\.3dshapes/.exec(q)?.[1]
  if (named) return [named]
  const pitch = /_P(\d\.\d+)mm/i.exec(q)?.[1]
  const pitchDir = pitch ? `${Number(pitch).toFixed(2)}mm` : '2.54mm'
  const out = []
  for (const [re, libs] of PREFIXES) if (re.test(q)) for (const l of libs) out.push(l.replace('{pitch}', pitchDir))
  return [...new Set(out)]
}

const words = (q) => String(q).toLowerCase().replace(/[^\w.]+/g, ' ').replace(/_/g, ' ').split(/\s+/).filter(Boolean)
const flat = (s) => String(s).toLowerCase().replace(/[^\w.]+/g, ' ').replace(/_/g, ' ')

/** Names that hold every word of the query, best first: the name itself,
 *  then those it starts, then the shortest. */
export function rank(names, query) {
  const w = words(String(query).replace(/^.*\//, '').replace(/\.3dshapes/i, ''))
  const q = String(query).replace(/^.*\//, '').toLowerCase()
  // Each word the start of a word of the name (a number the whole of one:
  // SOT-23 is not SOT-223); failing that, anywhere in it.
  const tokens = (n) => flat(n).split(/\s+/)
  const starts = (n) => {
    const t = tokens(n)
    return w.every((x) => t.some((y) => (/^\d+$/.test(x) ? y === x : y.startsWith(x))))
  }
  let hits = names.filter(starts)
  if (!hits.length) hits = names.filter((n) => w.every((x) => flat(n).includes(x)))
  const score = (n) => (n.toLowerCase() === q ? 0 : n.toLowerCase().startsWith(q) ? 1 : 2)
  return hits.sort((a, b) => score(a) - score(b) || a.length - b.length || a.localeCompare(b))
}

// ---- this computer's copy ----------------------------------------------------------

const localIndex = new Map()

/** The STEP models under a KiCad install's 3D folder: { id, path, size }. */
async function local(dir) {
  let m = 0
  try {
    m = statSync(dir).mtimeMs
  } catch {
    return []
  }
  const hit = localIndex.get(dir)
  if (hit && hit.m === m) return hit.items
  const items = []
  for (const lib of await readdir(dir).catch(() => [])) {
    if (!lib.endsWith('.3dshapes')) continue
    for (const f of await readdir(join(dir, lib)).catch(() => [])) {
      const mm = /^(.*)\.(step|stp)$/i.exec(f)
      if (mm) items.push({ id: `${lib}/${mm[1]}`, lib: lib.replace(/\.3dshapes$/, ''), name: mm[1], path: join(dir, lib, f) })
    }
  }
  localIndex.set(dir, { m, items })
  return items
}

// ---- the GitLab repository ----------------------------------------------------------

let lastCall = 0
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * The provider, with the fetch helper and the ScanRuler folder of the
 * Catalog (models.js), so it answers and fails as the other libraries do.
 * env.SCANRULER_KICAD_API stands in for https://gitlab.com (tests).
 */
export function kicadProvider({ http, home, Cancelled }) {
  const base = (env) => String(env.SCANRULER_KICAD_API ?? 'https://gitlab.com').replace(/\/$/, '')
  const project = encodeURIComponent(KICAD3D.project)
  const cacheDir = (env) => join(home(env), 'cache', 'kicad3d')
  const page = (env, id) => `${base(env)}/${KICAD3D.project}/-/blob/${KICAD3D.ref}/${id.split('/').map(encodeURIComponent).join('/')}.step`
  const raw = (env, id) => `${base(env)}/${KICAD3D.project}/-/raw/${KICAD3D.ref}/${id.split('/').map(encodeURIComponent).join('/')}.step`

  /** One GitLab API call, a second after the last at least. */
  async function api(env, path, signal) {
    const wait = lastCall + (env.SCANRULER_KICAD_API ? 0 : 1000) - Date.now()
    if (wait > 0) await pause(wait)
    lastCall = Date.now()
    return http(`${base(env)}/api/v4/projects/${project}/${path}`, { signal, timeoutMs: 20_000 })
  }

  async function cached(env, key, make) {
    const dir = cacheDir(env)
    const file = join(dir, `${key.replace(/[^\w.-]+/g, '_')}.json`)
    const s = await stat(file).catch(() => null)
    if (s && Date.now() - s.mtimeMs < MONTH) {
      try {
        return JSON.parse(await readFile(file, 'utf8'))
      } catch {}
    }
    const v = await make()
    await mkdir(dir, { recursive: true })
    await writeFile(file, JSON.stringify(v))
    return v
  }

  /** A library folder's STEP files, from the repository's file tree. */
  const remoteLibrary = (env, lib, signal) =>
    cached(env, `lib-${lib}`, async () => {
      const names = []
      for (let p = 1; p <= 20; p++) {
        const list = await api(env, `repository/tree?path=${encodeURIComponent(`${lib}.3dshapes`)}&ref=${KICAD3D.ref}&per_page=100&page=${p}`, signal).catch((e) => {
          // A folder that is not there: no models, not an error.
          if (/answered 404/.test(e.message)) return []
          throw e
        })
        if (!Array.isArray(list)) break
        for (const f of list) {
          const m = typeof f?.name === 'string' && f.type === 'blob' ? /^(.*)\.(step|stp)$/i.exec(f.name) : null
          if (m) names.push(m[1])
        }
        if (list.length < 100) break
      }
      return names
    })

  /** The repository's library folders, for a query that names one by a
   *  word of its own ("molex"). */
  const remoteLibraries = (env, signal) =>
    cached(env, 'libraries', async () => {
      const libs = []
      for (let p = 1; p <= 5; p++) {
        const list = await api(env, `repository/tree?ref=${KICAD3D.ref}&per_page=100&page=${p}`, signal)
        if (!Array.isArray(list)) break
        for (const f of list) if (f?.type === 'tree' && /\.3dshapes$/.test(f.name ?? '')) libs.push(f.name.replace(/\.3dshapes$/, ''))
        if (list.length < 100) break
      }
      return libs
    })

  const hit = (env, id, isLocal) => {
    const name = id.split('/').pop()
    return { source: 'kicad', id, name, author: KICAD3D.author, licence: KICAD3D.licence, url: page(env, id), thumbnail: null, downloadable: true, library: id.split('/')[0].replace(/\.3dshapes$/, ''), ...(isLocal ? { local: true } : {}) }
  }

  return {
    async search(query, pageNo, _secret, env, signal) {
      const q = String(query).trim()
      const locals = (await Promise.all(localModelDirs(env).map(local))).flat()
      const byId = new Map()
      for (const it of locals) if (!byId.has(it.id)) byId.set(it.id, it)
      let libs = librariesFor(q)
      const names = new Map()
      if (byId.size) {
        // Installed: searched whole, here.
        for (const it of byId.values()) if (!libs.length || libs.includes(it.lib)) names.set(it.id, true)
        if (libs.length && ![...names.keys()].length) for (const it of byId.values()) names.set(it.id, true)
      } else {
        if (!libs.length) {
          // No package name known: a library whose folder name holds a word.
          const w = words(q)
          libs = (await remoteLibraries(env, signal)).filter((l) => w.some((x) => x.length >= 3 && l.toLowerCase().includes(x))).slice(0, 3)
        }
        for (const lib of libs.slice(0, 4)) {
          if (signal?.aborted) throw new Cancelled()
          for (const n of await remoteLibrary(env, lib, signal)) names.set(`${lib}.3dshapes/${n}`, false)
        }
      }
      const ranked = rank([...names.keys()].map((id) => id.split('/').pop()), q)
      const ids = []
      const seen = new Set()
      for (const n of ranked) for (const id of names.keys()) if (id.endsWith(`/${n}`) && !seen.has(id)) (seen.add(id), ids.push(id))
      return ids.slice((pageNo - 1) * PER, pageNo * PER).map((id) => hit(env, id, byId.has(id)))
    },
    async files(id, _secret, env, signal) {
      if (!okId(id)) throw new Error(`"${String(id).slice(0, 80)}" is not a KiCad model — its id is library.3dshapes/name, from a search.`)
      const locals = (await Promise.all(localModelDirs(env).map(local))).flat()
      const mine = locals.find((x) => x.id === id)
      const name = `${id.split('/').pop()}.step`
      const size = mine ? (await stat(mine.path).catch(() => null))?.size ?? null : null
      return {
        licence: KICAD3D.licence,
        url: page(env, id),
        author: KICAD3D.author,
        files: [{ id: 'step', name, size, format: 'step' }],
        fetch: async (fileId) => {
          if (fileId !== 'step') throw new Error(`KiCad model ${id} has only its STEP file (step).`)
          const bytes = mine ? new Uint8Array(await readFile(mine.path)) : await http(raw(env, id), { as: 'bytes', timeoutMs: 120_000, signal })
          if (bytes.byteLength > MAX_FILE) throw new Error(`${name} is over 100 MB.`)
          if (!/^\s*ISO-10303-21/.test(new TextDecoder().decode(bytes.subarray(0, 64)))) throw new Error(`${name} did not come back as a STEP file.`)
          return bytes
        },
      }
    },
  }
}
