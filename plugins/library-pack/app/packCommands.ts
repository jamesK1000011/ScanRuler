// SPDX-License-Identifier: AGPL-3.0-only
// library-pack's commands (pack.*): settings, the licence, upstream parts
// and their attribution, files added from disk, the plan, the privacy
// scrub, platform presets, and the pack itself — a zip saved on this
// computer. Nothing is uploaded or posted anywhere.

import { strToU8, zipSync } from 'fflate'
import { runCommand } from '../../../src/commands/registry'
import { arr, bool, bytes, enumOf, int, obj, str } from '../../../src/commands/schema'
import { readStateSections } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { LICENCES, licenceFile, PACK_LICENCES, readLicence, RESTRICTED_SOURCES, type LicenceId } from '../core/licence'
import { plan, platformText, readme, type PackSettings, type Planned, type Upstream } from '../core/plan'
import { scrubFile, type Change } from '../core/scrub'
import { usePack, type Preset } from '../state/packStore'
import printables from '../presets/printables.json'
import thangs from '../presets/thangs.json'
import makerworld from '../presets/makerworld.json'
import thingiverse from '../presets/thingiverse.json'
import gpl3 from '../licences/GPL-3.0.txt?raw'

type Json = Record<string, unknown>
const BUILT_IN: Preset[] = [printables, thangs, makerworld, thingiverse]
const presets = () => [...BUILT_IN.filter((b) => !usePack.getState().presets.some((p) => p.id === b.id)), ...usePack.getState().presets]
const preset = () => presets().find((p) => p.id === usePack.getState().settings.platform) ?? BUILT_IN[0]

interface ReverseBody {
  id: number
  name: string
  visible: boolean
  surface?: boolean
}

function upstreamNow(): Upstream[] {
  const own = usePack.getState().upstream
  const cat = (readStateSections().catalog as { parts?: { file: string; source: string; redistribute: boolean; url?: string; licence?: string }[] } | undefined)?.parts ?? []
  const filled = own.map((o) => {
    const c = cat.find((x) => x.file === o.part)
    return c ? { ...o, source: o.source ?? c.source, url: o.url ?? c.url, licence: o.licence ?? c.licence, redistribute: o.redistribute ?? c.redistribute } : o
  })
  const fromCatalog = cat.filter((c) => !own.some((o) => o.part === c.file)).map((c) => ({ part: c.file, source: c.source, redistribute: c.redistribute, ...(c.url ? { url: c.url } : {}), ...(c.licence ? { licence: c.licence } : {}) }))
  return [...filled, ...fromCatalog]
}

const planNow = (): Planned => plan(usePack.getState().settings, upstreamNow())

const file = async (name: string, args: Json): Promise<Uint8Array | null> => {
  try {
    const r = (await runCommand(name, args)) as { file?: { bytes: Uint8Array } }
    return r?.file?.bytes ?? null
  } catch {
    return null
  }
}

const VIEWS = ['iso', 'front', 'top', 'iso-rear-left', 'right', 'iso-front-left']

interface Gathered {
  files: { path: string; bytes: Uint8Array; scrub: boolean }[]
  skipped: string[]
  planned: Planned
}

async function gather(progress?: (t: string) => void): Promise<Gathered> {
  const s = usePack.getState().settings
  const planned = planNow()
  const pre = preset()
  const m = pre.folders.models
  const out: Gathered['files'] = []
  const skipped: string[] = []
  const bodies = ((readStateSections().reverse as { bodies?: ReverseBody[] } | undefined)?.bodies ?? []).filter((b) => b.visible && !b.surface)
  const outBodies = new Set([...planned.leftOut, ...planned.blocked.map((b) => ({ ...b, body: upstreamNow().find((u) => u.part === b.part)?.body }))].map((x) => x.body).filter(Boolean))
  const keep = bodies.filter((b) => !outBodies.has(b.name))
  for (const b of bodies.filter((x) => outBodies.has(x.name))) skipped.push(`body ${b.name} (left out: see README)`)
  const stem = s.title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'part'
  if (keep.length) {
    progress?.('Exporting the bodies…')
    const ids = keep.map((b) => b.id)
    const stl = await file('reverse.export.stl', { bodies: ids })
    if (stl) out.push({ path: `${m}/${stem}.stl`, bytes: stl, scrub: true })
    if (s.include3mf) {
      const tmf = await file('reverse.export.stl', { bodies: ids, format: '3mf' })
      if (tmf) out.push({ path: `${m}/${stem}.3mf`, bytes: tmf, scrub: true })
    }
    if (s.includeStep) {
      const step = await file('reverse.export.step', { bodies: ids })
      if (step) out.push({ path: `${m}/${stem}.step`, bytes: step, scrub: true })
    }
  } else if (!bodies.length) {
    progress?.('Exporting the scan…')
    const stl = await file('export.stl', {})
    if (stl) out.push({ path: `${m}/${stem}.stl`, bytes: stl, scrub: true })
    else skipped.push('no model: open a scan or build bodies in Reverse Engineer')
  }
  for (const a of usePack.getState().added) out.push({ path: `${m}/${a.name}`, bytes: a.bytes, scrub: true })
  for (let i = 0; i < Math.min(s.renders, VIEWS.length); i++) {
    progress?.(`Render ${i + 1} of ${s.renders}…`)
    const png = await file('view.render', { view: VIEWS[i], fit: true, width: Math.min(2048, pre.images.width), height: Math.min(2048, pre.images.height) })
    if (png) out.push({ path: `${pre.folders.images}/${stem}-${i + 1}.png`, bytes: png, scrub: true })
    else skipped.push(`render ${i + 1} (the 3D view isn't available)`)
  }
  if (s.includeManual && ((readStateSections().asm as { steps?: number } | undefined)?.steps ?? 0) > 0) {
    progress?.('Adding the assembly manual…')
    const html = await file('asm.save', { format: 'html' })
    if (html) out.push({ path: 'assembly-manual.html', bytes: html, scrub: true })
  }
  if (s.includeNotes) {
    try {
      const notes = (await runCommand('reverse.note.list', {})) as { notes?: { text?: string; title?: string }[] }
      if (notes?.notes?.length) out.push({ path: 'NOTES.md', bytes: strToU8(['# Notes', '', ...notes.notes.map((n) => `- ${n.title ?? n.text ?? ''}`)].join('\n') + '\n'), scrub: true })
    } catch {
      skipped.push('notes (Reverse Engineer is not loaded)')
    }
  }
  return { files: out, skipped, planned }
}

function scrubAll(files: Gathered['files']): { files: Gathered['files']; changes: Change[] } {
  const users = new Set<string>()
  const first = files.map((f) => (f.scrub ? scrubFile(f.path, f.bytes, users) : { bytes: f.bytes, changes: [] }))
  const again = files.map((f, i) => (f.scrub && users.size ? scrubFile(f.path, first[i].bytes, users) : first[i]))
  const changes = [...first, ...again].flatMap((r) => r.changes)
  const merged = new Map<string, Change>()
  for (const c of changes) {
    const k = `${c.file}|${c.what}`
    const m = merged.get(k)
    if (m) m.count += c.count
    else merged.set(k, { ...c })
  }
  return { files: files.map((f, i) => ({ ...f, bytes: again[i].bytes })), changes: [...merged.values()] }
}

const settingsCmd: Command<Partial<Omit<PackSettings, 'licence'>>> = {
  name: 'settings',
  title: 'What the pack says and holds',
  description:
    'The pack\'s title, author (the copyright holder, as they want to be credited), summary, print settings (text for the README), platform (a preset id: printables, thangs, makerworld, thingiverse, or your own), whether to include STEP, the 3MF, the project\'s notes (off by default) and the assembly manual, and how many renders (0–6). With nothing, reads them.',
  input: obj({ title: str(undefined, { minLength: 1 }), author: str(), summary: str(), printSettings: str(), platform: str(), includeStep: bool(), include3mf: bool(), includeNotes: bool(), includeManual: bool(), renders: int(undefined, { minimum: 0, maximum: 6 }) }),
  run: async (input) => {
    if (input.platform && !presets().some((p) => p.id === input.platform)) throw new CommandError('invalid_input', `No preset "${input.platform}" — have ${presets().map((p) => p.id).join(', ')}.`)
    if (Object.keys(input).length) usePack.getState().set({ settings: { ...usePack.getState().settings, ...input } })
    return { settings: usePack.getState().settings }
  },
}

const licence: Command<{ id?: LicenceId }> = {
  name: 'licence',
  title: 'Choose the pack\'s licence',
  description: `The licence the pack goes out under: ${PACK_LICENCES.map((id) => `${id} (${LICENCES[id].short})`).join(', ')}. Every upstream part is checked against it: a remix of a ShareAlike part must keep its licence, a NonCommercial part can't go out under a licence that allows selling, a NoDerivatives part can't be remixed, and an all-rights-reserved part needs its author's permission. Returns what is blocked and why. A guide, not legal advice. With nothing, reads it.`,
  input: obj({ id: enumOf([...PACK_LICENCES]) }),
  run: async ({ id }) => {
    if (id) usePack.getState().set({ settings: { ...usePack.getState().settings, licence: id } })
    const p = planNow()
    const now = usePack.getState().settings.licence
    return { licence: now ? { id: now, ...LICENCES[now] } : null, ok: p.blocked.length === 0, blocked: p.blocked, leftOut: p.leftOut.map((x) => x.part) }
  },
}

const attrib: Command<{ set?: Upstream[]; remove?: string[] }> = {
  name: 'attrib',
  title: 'Upstream parts and their credit',
  description: `The parts this design uses from others: part (its name here — a body or an imported file), body (the Reverse Engineer body it became, so it is left out of the model if it must be), title, author, url (its page), licence (as the page says it; read as one of the table's), source, redistribute (false: its files can't be shared on), modified (a remix; true unless said), permission (the person confirmed the author's permission). Parts recorded by catalog come in too, with their source and whether they may be shared on. Parts from ${RESTRICTED_SOURCES.join(', ')} are left out of the pack and linked instead. remove drops parts by name. Returns the parts and the plan.`,
  input: obj({
    set: arr(obj({ part: str(undefined, { minLength: 1 }), body: str(), title: str(), author: str(), url: str(), licence: str(), source: str(), redistribute: bool(), modified: bool(), permission: bool() }, ['part'])),
    remove: arr(str()),
  }),
  run: async ({ set, remove }) => {
    let list = [...usePack.getState().upstream]
    for (const u of set ?? []) if (u.url && !/^https?:\/\/[^\s<>"]+$/i.test(u.url)) throw new CommandError('invalid_input', `${u.part}: url is its page, an http or https address.`)
    for (const u of set ?? []) {
      const old = list.find((x) => x.part === u.part)
      list = old ? list.map((x) => (x === old ? { ...old, ...u } : x)) : [...list, u]
    }
    if (remove?.length) list = list.filter((x) => !remove.includes(x.part))
    usePack.getState().set({ upstream: list })
    const p = planNow()
    return { parts: upstreamNow().map((u) => ({ ...u, read: readLicence(u.licence) })), plan: p }
  },
}

/** What may be added to a pack: models, slicer projects, pictures,
 *  drawings and notes. */
const PACK_KINDS = '.stl .3mf .step .stp .obj .png .jpg .jpeg .webp .gif .svg .dxf .pdf .md .txt'
const PACK_FILES = new RegExp(`\\.(${PACK_KINDS.replace(/\./g, '').split(' ').join('|')})$`, 'i')

/** A key, an environment block or a system file, whatever it was named. */
function looksPrivate(b: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(b.subarray(0, 4096))
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|-----BEGIN OPENSSH|ssh-(rsa|ed25519) AAAA/.test(head)) return true
  if (/^[A-Z_][A-Z0-9_]*=[^\0\n]*\0[A-Z_][A-Z0-9_]*=/.test(head)) return true
  if (/^root:[^:]*:0:0:/m.test(head)) return true
  return false
}

const add: Command<{ bytes: Uint8Array; name: string }> = {
  name: 'add',
  title: 'Add a file from this computer to the pack',
  description: 'A file to go in the pack beside the model — the sliced 3MF with its print profile (slicer_slice\'s job folder), a photo of the print, a drawing. Give path. It is scrubbed with the rest when the pack is built. Kept for this session: the project keeps its name, not its bytes. pack.files lists and removes them.',
  input: obj({ bytes: bytes('The file.'), name: str('Its name in the pack.', { minLength: 1 }) }, ['bytes', 'name']),
  run: async ({ bytes: data, name }) => {
    const safe = name.split(/[\\/]/).pop()!.replace(/[^\w.() -]+/g, '_').replace(/^[\s_]+|[\s_]+$/g, '')
    if (!safe.replace(/[._ -]/g, '') || safe.startsWith('.')) throw new CommandError('invalid_input', 'Name it with letters or digits, not starting with a dot: photo-of-print.jpg.')
    if (!PACK_FILES.test(safe)) throw new CommandError('invalid_input', `A pack holds models, slicer projects, pictures, drawings and notes — ${PACK_KINDS} — not "${safe.slice(0, 60)}".`)
    if (looksPrivate(data)) throw new CommandError('invalid_input', 'That file looks like something private — a key, or an environment or system file — not something to share. Pick the file meant for the pack.')
    usePack.getState().set({ added: [...usePack.getState().added.filter((a) => a.name !== safe), { name: safe, bytes: data }] })
    return { added: safe, bytes: data.length, files: usePack.getState().added.map((a) => a.name) }
  },
}

const files: Command<{ remove?: string[] }> = {
  name: 'files',
  title: 'Files added to the pack',
  description: 'The files added with pack.add, by name and size; remove takes them out.',
  input: obj({ remove: arr(str()) }),
  run: async ({ remove }) => {
    if (remove?.length) usePack.getState().set({ added: usePack.getState().added.filter((a) => !remove.includes(a.name)) })
    return { files: usePack.getState().added.map((a) => ({ name: a.name, bytes: a.bytes.length })) }
  },
}

const planCmd: Command<Record<string, never>> = {
  name: 'plan',
  title: 'What goes in the pack',
  description: 'What the pack will hold and what can\'t go: the licence, upstream parts credited (with what each needs), parts left out and linked, parts that block this licence and why, files added, the platform preset, and what is still missing (a licence, an author, an upstream part\'s author or page). ok is true when it can be built. Builds nothing.',
  input: obj({}),
  readOnly: true,
  run: async () => {
    const s = usePack.getState()
    return { ...planNow(), settings: s.settings, added: s.added.map((a) => a.name), preset: preset() }
  },
}

const scrub: Command<Record<string, never>> = {
  name: 'scrub',
  title: 'What the privacy scrub takes out',
  description: 'Gathers every file the pack would hold (model exports, renders, added files, the manual) and reports what the scrub takes out of each: absolute paths and the user name in them, access codes, API keys, tokens and passwords, printer serial numbers and addresses, e-mail addresses, a STEP header\'s author and organisation, text in an STL header, EXIF and text in pictures. Builds nothing; pack.build applies the same scrub.',
  input: obj({}),
  readOnly: true,
  long: true,
  timeoutMs: 600_000,
  run: async (_i, ctx) => {
    const g = await gather((t) => ctx?.progress(t))
    const r = scrubAll(g.files)
    return { files: g.files.map((f) => f.path), changes: r.changes, ...(g.skipped.length ? { skipped: g.skipped } : {}) }
  },
}

/** A folder inside the pack: no empty, absolute, hidden or ".." part. */
const FOLDER = /^(?!.*(^|\/)\.)[\w-][\w.-]*(\/[\w-][\w.-]*)*$/

const presetsCmd: Command<{ add?: Preset; remove?: string }> = {
  name: 'presets',
  title: 'Platform presets',
  description: 'The presets for where the pack will be uploaded: folder names, render size and count, and how long the title and summary may be — Printables, Thangs, MakerWorld and Thingiverse built in (defaults, not the sites\' rules: check each upload form). add puts in your own or replaces one by id ({ id, name, images: { count, width, height }, folders: { models, images }, fields: { title, summary }, note }); remove drops your own. Choose one with pack.settings { platform }.',
  input: obj({
    add: obj({ id: str(undefined, { minLength: 1 }), name: str(), images: obj({ count: int(), width: int(undefined, { minimum: 64, maximum: 4096 }), height: int(undefined, { minimum: 64, maximum: 4096 }) }, ['count', 'width', 'height']), folders: obj({ models: str(), images: str() }, ['models', 'images']), fields: obj({ title: int(), summary: int() }, ['title', 'summary']), note: str() }, ['id', 'name', 'images', 'folders', 'fields']),
    remove: str(),
  }),
  run: async ({ add: p, remove }) => {
    if (p) {
      if (!/^[\w-]{1,40}$/.test(p.id)) throw new CommandError('invalid_input', 'id: letters, digits, dashes, 40 at most.')
      for (const [k, v] of Object.entries(p.folders)) if (!FOLDER.test(v)) throw new CommandError('invalid_input', `folders.${k} "${String(v).slice(0, 40)}": a folder in the pack — names of letters, digits, dots and dashes, split by / — never empty, absolute or with "..".`)
      if (p.images.count < 0 || p.images.count > 12) throw new CommandError('invalid_input', 'images.count: 0 to 12.')
      if (p.fields.title < 10 || p.fields.title > 500 || p.fields.summary < 10 || p.fields.summary > 5000) throw new CommandError('invalid_input', 'fields: title 10–500 characters, summary 10–5000.')
    }
    if (remove && !usePack.getState().presets.some((x) => x.id === remove)) throw new CommandError('invalid_input', BUILT_IN.some((b) => b.id === remove) ? `"${remove}" is built in and stays; add one with its id to change it.` : `No preset "${remove}" of yours.`)
    let own = [...usePack.getState().presets]
    if (p) own = [...own.filter((x) => x.id !== p.id), p]
    if (remove) own = own.filter((x) => x.id !== remove)
    if (p || remove) usePack.getState().set({ presets: own })
    return { presets: presets(), chosen: preset().id }
  },
}

const build: Command<Record<string, never>> = {
  name: 'build',
  title: 'Build the pack',
  description: 'The pack as a zip to save on this computer — give path. It holds the model files, renders, added files and the manual, all scrubbed, plus README.md (description, print settings, fit and printability notes, attribution, parts not included with their links), LICENSE and PLATFORM.md (the upload form\'s fields, to paste). Refused, saying why, while a part blocks the licence or the licence or author is missing. Nothing is uploaded: the person uploads it.',
  input: obj({}),
  readOnly: true,
  long: true,
  returnsFile: true,
  timeoutMs: 600_000,
  run: async (_i, ctx) => {
    const s = usePack.getState().settings
    const first = planNow()
    if (!first.ok) throw new CommandError('invalid_state', [first.blocked.map((b) => `${b.part}: ${b.why}`).join(' '), ...first.problems].filter(Boolean).join(' '))
    const g = await gather((t) => ctx?.progress(t))
    const r = scrubAll(g.files)
    const fit = (readStateSections().fit as { last?: { scaleXY?: number; contourOffset?: number; holeOffset?: number } } | undefined)?.last ?? null
    const dfmLast = (readStateSections().dfm as { last?: { errors: number; warnings: number; waived: number } } | undefined)?.last ?? null
    const input = { settings: s, planned: g.planned, files: r.files.map((f) => f.path), fit, dfm: dfmLast, scrubbed: r.changes }
    const root = s.title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'part'
    const entries: Record<string, Uint8Array> = {}
    const put = (path: string, b: Uint8Array) => {
      const parts = path.split('/').filter((x) => x && x !== '.')
      if (parts.some((x) => x === '..' || x.startsWith('.'))) throw new CommandError('invalid_state', `"${path}" would land outside the pack's folder.`)
      const at = [root, ...parts].join('/')
      if (entries[at]) throw new CommandError('invalid_state', `Two files would both be ${at}: rename one (pack.files) or change the preset's folders.`)
      entries[at] = b
    }
    put('README.md', strToU8(readme(input)))
    put('LICENSE', strToU8(licenceFile(s.licence!, s.author, new Date().getFullYear(), gpl3)))
    put('PLATFORM.md', strToU8(platformText(input, preset())))
    for (const f of r.files) put(f.path, f.bytes)
    const zip = zipSync(entries, { level: 6 })
    return {
      file: { name: `${root}.zip`, mimeType: 'application/zip', bytes: zip },
      files: Object.keys(entries),
      licence: LICENCES[s.licence!].short,
      credited: g.planned.credited.map((c) => c.part),
      leftOut: g.planned.leftOut.map((x) => x.part),
      scrubbed: r.changes,
      ...(g.skipped.length ? { skipped: g.skipped } : {}),
      next: `Upload it yourself on ${preset().name}: PLATFORM.md has the fields to paste.`,
    }
  },
}

export const packCommands = [settingsCmd, licence, attrib, add, files, planCmd, scrub, presetsCmd, build]
