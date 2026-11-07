// SPDX-License-Identifier: AGPL-3.0-only
// assembly-manual's commands (asm.*): declare the parts and the steps that
// put them together, check that each part can get in, write and lint the
// instructions, and draw and save the manual. Nothing here sends anything
// anywhere: the only file that leaves is the one the caller saves.

import { toPng } from '../../_shared/lineart/raster'
import { toPdf, toSvg, type Sheet } from '../../_shared/lineart/sheet'
import { VIEW_NAMES, type V3 } from '../../_shared/lineart/views'
import { zip } from '../../_shared/zip'
import { runCommand } from '../../../src/commands/registry'
import { arr, bool, enumOf, int, num, obj, oneOf, str, vec3 } from '../../../src/commands/schema'
import { readStateSections } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { bom, direction, issues, stepCamera, type Issue } from '../core/assembly'
import type { Hit, PartIn } from '../core/geometry'
import { lint, limitsOf } from '../core/lint'
import { html } from '../core/htmlManual'
import { cover, stepFigure, stepPage } from '../core/manual'
import { THEMES, THEME_IDS, themeOf } from '../core/themes'
import { DEFAULT_SETTINGS, DEFAULT_WORDS, type AsmSettings, type Part, type Step, type StyleName } from '../core/model'
import { useAsm } from '../state/asmStore'
import { drawInWorker, sweepInWorker } from './asmClient'

interface ReverseBody {
  id: number
  name: string
  visible: boolean
  surface?: boolean
}

function bodiesNow(): { id: number; name: string }[] {
  const rev = readStateSections().reverse as { bodies?: ReverseBody[] } | undefined
  return (rev?.bodies ?? []).filter((b) => !b.surface).map((b) => ({ id: b.id, name: b.name }))
}

/** Bodies renamed in Reverse Engineer since: their parts follow. */
function sync() {
  const byId = new Map(bodiesNow().map((b) => [b.id, b.name]))
  const s = useAsm.getState()
  let changed = false
  const parts = s.parts.map((p) => {
    const now = p.bodyId !== undefined ? byId.get(p.bodyId) : undefined
    if (now && now !== p.body) {
      changed = true
      return { ...p, body: now }
    }
    return p
  })
  if (changed) useAsm.getState().set({ parts })
}

async function partsIn(progress?: (t: string) => void): Promise<PartIn[]> {
  sync()
  const s = useAsm.getState()
  const bodies = bodiesNow()
  const out: PartIn[] = []
  for (const p of s.parts) {
    if (!p.body) continue
    const b = bodies.find((x) => x.name === p.body) ?? bodies.find((x) => x.id === p.bodyId)
    if (!b) throw new CommandError('invalid_state', `"${p.name}" is body "${p.body}", which is not in Reverse Engineer now.`)
    progress?.(`Reading ${p.name}…`)
    const r = (await runCommand('reverse.export.step', { bodies: [b.id] })) as { file?: { bytes: Uint8Array } }
    if (!r?.file?.bytes) throw new CommandError('failed', `${p.name} gave no STEP.`)
    out.push({ name: p.name, step: new TextDecoder().decode(r.file.bytes) })
  }
  return out
}

const stepIndex = (ref: string | number): number => {
  const steps = useAsm.getState().steps
  const i = typeof ref === 'number' ? ref - 1 : steps.findIndex((s) => s.id === ref)
  if (i < 0 || i >= steps.length) throw new CommandError('invalid_input', `There is no step ${ref} (steps: ${steps.map((s, j) => `${j + 1} ${s.id}`).join(', ') || 'none'}).`)
  return i
}

const hitWords = (h: Hit) => `Step ${h.step}: ${h.part} runs into ${h.hits} ${h.before} mm before its place, moving along [${h.move.map((v) => +v.toFixed(3)).join(', ')}], near (${h.at.join(', ')}). Put ${h.part} in before ${h.hits}, or give it another direction.`

const settings: Command<Partial<AsmSettings>> = {
  name: 'settings',
  title: 'Assembly manual settings',
  description: `The manual's title, paper (letter or a4), orientation (landscape or portrait), how far new parts are pulled out in a step's drawing (explode, a share of their travel), and how it looks: theme — ${THEMES.map((t) => `${t.id} (${t.name}: ${t.about})`).join('; ')} — and accent, your own colour as '#rrggbb' over the theme's ('' for the theme's own). The theme sets the HTML's type, colours and layout and the accent and balloons on the pages. With nothing, reads them, and the themes. Defaults: ${JSON.stringify(DEFAULT_SETTINGS)}.`,
  input: obj({
    title: str(undefined, { minLength: 1 }),
    paper: enumOf(['letter', 'a4']),
    orientation: enumOf(['landscape', 'portrait']),
    explode: num(undefined, { minimum: 0.2, maximum: 5 }),
    theme: enumOf(THEME_IDS),
    accent: str('#rrggbb, or empty for the theme’s own.'),
  }),
  run: async (input) => {
    if (input.accent && !/^#[0-9a-fA-F]{6}$/.test(input.accent)) throw new CommandError('invalid_input', `accent is a colour as '#rrggbb' — '#1877c0', say — or '' for the theme's own; not ${JSON.stringify(input.accent)}.`)
    if (Object.keys(input).length) {
      const next = { ...useAsm.getState().settings, ...input }
      if (!next.accent) delete next.accent
      useAsm.getState().set({ settings: next })
    }
    const now = useAsm.getState().settings
    const t = themeOf(now)
    return { settings: now, theme: { id: t.id, name: t.name, accent: t.accent }, themes: THEMES.map(({ id, name, about }) => ({ id, name, about })) }
  },
}

interface PartInput {
  name: string
  body?: string
  kind?: 'part' | 'hardware'
  designation?: string
  source?: string
  qty?: number
}

const parts: Command<{ fromBodies?: boolean; set?: PartInput[]; remove?: string[]; clear?: boolean }> = {
  name: 'parts',
  title: 'The parts of the assembly',
  description:
    'The parts the manual puts together, and the bill of materials they come to. fromBodies: true adds every solid body in Reverse Engineer that isn\'t a part yet, named after it — imported STEP parts and catalog matches included. set adds or changes parts by name: body (its Reverse Engineer body, in its assembled place), kind part or hardware, designation for hardware ("M3×10 ISO 4762"; alike designations come as one item with a count), source (supplier, catalog file, "printed"), qty for an item with no body per piece (a tube of glue). remove drops parts; clear empties the list. A body renamed in Reverse Engineer keeps its part. Returns the parts and the bill of materials.',
  input: obj({
    fromBodies: bool(),
    set: arr(obj({ name: str(undefined, { minLength: 1 }), body: str(), kind: enumOf(['part', 'hardware']), designation: str(), source: str(), qty: int(undefined, { minimum: 1 }) }, ['name'])),
    remove: arr(str()),
    clear: bool(),
  }),
  run: async ({ fromBodies, set, remove, clear }) => {
    sync()
    let list = clear ? [] : [...useAsm.getState().parts]
    const bodies = bodiesNow()
    if (fromBodies) for (const b of bodies) if (!list.some((p) => p.body === b.name || p.bodyId === b.id)) list.push({ name: b.name, body: b.name, bodyId: b.id, kind: 'part' })
    for (const x of set ?? []) {
      const old = list.find((p) => p.name === x.name)
      const body = x.body ?? old?.body
      const id = body ? bodies.find((b) => b.name === body)?.id : undefined
      if (body && id === undefined) throw new CommandError('invalid_input', `There is no body "${body}" in Reverse Engineer (bodies: ${bodies.map((b) => b.name).join(', ') || 'none'}).`)
      const p: Part = { name: x.name, kind: x.kind ?? old?.kind ?? (x.designation ? 'hardware' : 'part'), ...(body ? { body, bodyId: id } : {}), ...((x.designation ?? old?.designation) ? { designation: x.designation ?? old?.designation } : {}), ...((x.source ?? old?.source) ? { source: x.source ?? old?.source } : {}), ...((x.qty ?? old?.qty) ? { qty: x.qty ?? old?.qty } : {}) }
      list = old ? list.map((q) => (q === old ? p : q)) : [...list, p]
    }
    if (remove?.length) list = list.filter((p) => !remove.includes(p.name))
    if (fromBodies || set || remove || clear) useAsm.getState().set({ parts: list })
    const now = useAsm.getState().parts
    return { parts: now, bom: bom(now) }
  },
}

const dirSchema = oneOf([vec3('The way it moves into its place.'), enumOf(['down', 'up', '+x', '-x', '+y', '-y', '+z', '-z'])])
const stepSchema = obj({
  id: str('Its id; given when left out.', { minLength: 1 }),
  place: arr(obj({ part: str(), move: dirSchema, travel: num('How far it comes from, mm; enough to clear it by default.', { exclusiveMinimum: 0 }) }, ['part', 'move']), 'The parts this step puts in, in order, and the way each moves in.'),
  tools: arr(str()),
  torque: str('"0.8 N·m".'),
  notes: str('A caution or a tip, beside the parts list.'),
  text: str('The instructions; asm.text writes and lints them.'),
  view: oneOf([enumOf([...VIEW_NAMES]), obj({ toward: vec3('From the parts toward the viewer.'), up: vec3('Up on the page.') }, ['toward'])], 'Chosen to show the moves when left out.'),
})

type StepInput = Partial<Omit<Step, 'place'>> & { place?: { part: string; move: V3 | string; travel?: number }[] }

function completeStep(x: StepInput, old: Step | undefined, taken: Set<string>): Step {
  let id = x.id ?? old?.id
  if (!id) {
    let i = taken.size + 1
    while (taken.has(`s${i}`)) i++
    id = `s${i}`
  }
  taken.add(id)
  let place: Step['place']
  try {
    place = x.place ? x.place.map((p) => ({ part: p.part, move: direction(p.move as V3 | string), ...(p.travel ? { travel: p.travel } : {}) })) : (old?.place ?? [])
  } catch (e) {
    throw new CommandError('invalid_input', (e as Error).message)
  }
  const merged = { ...old, ...x, id, place }
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) as unknown as Step
}

const step: Command<{ add?: StepInput; update?: StepInput; remove?: string; move?: { id: string; to: number } }> = {
  name: 'step',
  title: 'Add or change an assembly step',
  description:
    'One step of the assembly. add appends one: place lists the parts it puts in, in order, each with the way it moves into its place (move: [x, y, z] or down, up, ±x, ±y, ±z) — the part is drawn pulled back along it, and asm.check sweeps it in along it against what is already there; tools, torque, notes, text, and view (chosen to show the moves when left out). update changes a step by id; remove drops one; move puts one at a position (1 = first). Returns the steps.',
  input: obj({ add: stepSchema, update: stepSchema, remove: str(), move: obj({ id: str(), to: int(undefined, { minimum: 1 }) }, ['id', 'to']) }),
  run: async ({ add, update, remove, move }) => {
    let list = [...useAsm.getState().steps]
    const taken = new Set(list.map((s) => s.id))
    if (add) {
      if (add.id && taken.has(add.id)) throw new CommandError('invalid_input', `There is already a step ${add.id}.`)
      list.push(completeStep(add, undefined, taken))
    }
    if (update) {
      const i = list.findIndex((s) => s.id === update.id)
      if (i < 0) throw new CommandError('invalid_input', `There is no step ${update.id}.`)
      list[i] = completeStep(update, list[i], taken)
    }
    if (remove) list = list.filter((s) => s.id !== remove)
    if (move) {
      const i = list.findIndex((s) => s.id === move.id)
      if (i < 0) throw new CommandError('invalid_input', `There is no step ${move.id}.`)
      const [s] = list.splice(i, 1)
      list.splice(Math.min(move.to - 1, list.length), 0, s)
    }
    useAsm.getState().set({ steps: list })
    return { steps: list.map((s, i) => ({ n: i + 1, ...s })) }
  },
}

const steps: Command<Record<string, never>> = {
  name: 'steps',
  title: 'The steps as they stand',
  description: 'The steps in order with the parts each puts in, the bill of materials, and what is missing or placed twice. No geometry: asm.check sweeps the parts in.',
  input: obj({}),
  readOnly: true,
  run: async () => {
    sync()
    const s = useAsm.getState()
    return { steps: s.steps.map((x, i) => ({ n: i + 1, ...x })), bom: bom(s.parts), issues: issues(s.parts, s.steps, bodiesNow().map((b) => b.name)) }
  },
}

const check: Command<Record<string, never>> = {
  name: 'check',
  title: 'Check the assembly can be put together',
  description:
    'Sweeps each part in along its move, from far enough out to clear its place, against every part placed before it, and says where one first runs into another and how far short of its place — the order or the direction to change. Also parts that overlap in their places, parts never placed or placed twice, hardware with no designation, and each step\'s instructions linted. ok is true when nothing blocks the assembly.',
  input: obj({}),
  readOnly: true,
  long: true,
  timeoutMs: 600_000,
  run: async (_input, ctx) => {
    const s = useAsm.getState()
    const found: Issue[] = issues(s.parts, s.steps, bodiesNow().map((b) => b.name))
    if (found.some((x) => x.level === 'error')) return { ok: false, issues: found, note: 'Fix these before the sweep can run.' }
    const ins = await partsIn((t) => ctx?.progress(t))
    ctx?.progress('Sweeping each part in…')
    const r = await sweepInWorker(ins, s.steps).catch((e: Error) => {
      throw new CommandError('failed', `The sweep failed: ${e.message}`)
    })
    for (const h of r.hits) found.push({ level: 'error', step: h.step, part: h.part, message: hitWords(h) })
    for (const c of r.clashes) found.push({ level: 'warn', step: c.step, part: c.part, message: `Step ${c.step}: ${c.part} and ${c.with} overlap by ${c.volume.toFixed(2)} mm³ in their places — a press fit, or a model to fix.` })
    const text = s.steps.map((x, i) => ({ step: i + 1, findings: x.text ? lint(x.text, s.style).length : null }))
    return { ok: !found.some((x) => x.level === 'error'), issues: found, hits: r.hits, clashes: r.clashes, lint: text }
  },
}

const text: Command<{ step: string | number; text?: string }> = {
  name: 'text',
  title: 'Write or lint a step\'s instructions',
  description:
    'A step\'s instructions, by id or number. text writes them (empty clears them); without it, reads them. Either way they are linted to the style (asm.style): sentence length, one instruction a sentence, active voice, the verb first, and the project\'s word list — each finding names its sentence. The text is written even with findings: rewrite and write it again.',
  input: obj({ step: oneOf([str(), int(undefined, { minimum: 1 })]), text: str() }, ['step']),
  run: async ({ step: ref, text: t }) => {
    const i = stepIndex(ref)
    if (t !== undefined) {
      const list = [...useAsm.getState().steps]
      list[i] = { ...list[i], text: t.trim() || undefined }
      if (!t.trim()) delete list[i].text
      useAsm.getState().set({ steps: list })
    }
    const s = useAsm.getState()
    const now = s.steps[i].text ?? ''
    const { limits } = limitsOf(s.style)
    return { step: i + 1, id: s.steps[i].id, text: now, style: s.style.name, limits, findings: lint(now, s.style) }
  },
}

const style: Command<{ name?: StyleName; add?: { avoid: string; use: string }[]; remove?: string[]; custom?: string; resetWords?: boolean }> = {
  name: 'style',
  title: 'The instruction style',
  description:
    'The style instructions are written and linted to. ste100 (the default): write to ASD-STE100 Issue 9 — the standard is named, not reproduced; the linter keeps its own limits: 20 words a sentence, one instruction each, active voice, the verb first. plain: plain English, 30 words, passive voice only noted. custom: your own style file in Markdown — lines "maxWords: 25", "passive: warn|note|off", "oneInstruction: on|off", "imperative: on|off", and "- avoid -> use" for words. add puts words in the project list ([{ avoid: "utilize", use: "use" }]), remove takes them out, resetWords goes back to the starting list. With nothing, reads the style.',
  input: obj({ name: enumOf(['ste100', 'plain', 'custom']), add: arr(obj({ avoid: str(undefined, { minLength: 1 }), use: str(undefined, { minLength: 1 }) }, ['avoid', 'use']), 'Words to avoid, and what to write instead.'), remove: arr(str()), custom: str('Your style file (Markdown).'), resetWords: bool() }),
  run: async ({ name, add, remove, custom, resetWords }) => {
    const s = useAsm.getState().style
    let words = resetWords ? { ...DEFAULT_WORDS } : { ...s.words }
    for (const a of add ?? []) words[a.avoid.toLowerCase()] = a.use
    for (const w of remove ?? []) delete words[w.toLowerCase()]
    const next = { ...s, ...(name ? { name } : {}), words, ...(custom !== undefined ? { custom } : {}) }
    if (next.name === 'custom' && !next.custom) throw new CommandError('invalid_input', 'The custom style needs your style file: custom: "maxWords: 25\\n…".')
    useAsm.getState().set({ style: next })
    return { style: next, limits: limitsOf(next).limits, ...(next.name === 'ste100' ? { cite: 'ASD-STE100 Simplified Technical English, Issue 9, from ASD (the Aerospace, Security and Defence Industries Association of Europe). Named, not reproduced: the linter keeps only its own limits.' } : {}) }
  },
}

async function pages(progress?: (t: string) => void): Promise<Sheet[] & { figures: Sheet[] }> {
  const s = useAsm.getState()
  if (!s.steps.length) throw new CommandError('invalid_state', 'There are no steps yet: asm.step { add }.')
  const ins = await partsIn(progress)
  progress?.(`Drawing ${s.steps.length} step${s.steps.length === 1 ? '' : 's'}…`)
  const drawings = await drawInWorker(ins, s.steps, s.steps.map(stepCamera), s.settings.explode).catch((e: Error) => {
    throw new CommandError('failed', `Drawing failed: ${e.message}`)
  })
  const sheets = [cover(s.parts, s.steps, s.settings), ...s.steps.map((x, i) => stepPage(i, x, drawings[i], s.parts, s.steps.length, s.settings))]
  return Object.assign(sheets, { figures: s.steps.map((_, i) => stepFigure(drawings[i], s.parts, s.settings)) })
}

const render: Command<{ page?: number; format?: 'png' | 'svg' | 'pdf' }> = {
  name: 'render',
  title: 'Draw a page of the manual',
  description: 'One page of the manual: 0 the cover with the bill of materials, n step n — its drawing (parts already in grey, the step\'s parts in black pulled back along their moves, with the path to their place and a balloon for each item), its parts, tools and torque, and its instructions. A PNG to look at (the default), or SVG or PDF.',
  input: obj({ page: int('0 the cover, n step n; 1 by default.', { minimum: 0 }), format: enumOf(['png', 'svg', 'pdf']) }),
  readOnly: true,
  long: true,
  returnsFile: true,
  returnsImage: true,
  timeoutMs: 600_000,
  run: async ({ page = 1, format = 'png' }, ctx) => {
    const all = await pages((t) => ctx?.progress(t))
    const sh = all[page]
    if (!sh) throw new CommandError('invalid_input', `There are ${all.length - 1} steps; page 0 is the cover.`)
    const name = page === 0 ? 'manual-cover' : `manual-step-${page}`
    const file = format === 'png' ? { name: `${name}.png`, mimeType: 'image/png', bytes: await toPng(sh, 3) } : format === 'svg' ? { name: `${name}.svg`, mimeType: 'image/svg+xml', bytes: new TextEncoder().encode(toSvg(sh)) } : { name: `${name}.pdf`, mimeType: 'application/pdf', bytes: toPdf([sh]) }
    return { file, pages: all.length, step: page || null }
  },
}

const save: Command<{ format?: 'html' | 'pdf' | 'zip' }> = {
  name: 'save',
  title: 'Save the manual',
  description: 'The whole manual as one file to save on this computer: html (the default; self-contained and styled by the theme — a cover with the bill of materials and contents, then a step a page with its drawing, parts, tools and instructions; prints a step a page), pdf (a page a step after the cover), or zip (both, and every page as SVG). Give path to write it to a folder. Local only: nothing is sent anywhere.',
  input: obj({ format: enumOf(['html', 'pdf', 'zip']) }),
  readOnly: true,
  long: true,
  returnsFile: true,
  timeoutMs: 600_000,
  run: async ({ format = 'html' }, ctx) => {
    const s = useAsm.getState()
    const all = await pages((t) => ctx?.progress(t))
    const enc = new TextEncoder()
    const doc = html(s.settings, s.parts, s.steps, all.figures)
    const stem = s.settings.title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'manual'
    if (format === 'html') return { file: { name: `${stem}.html`, mimeType: 'text/html', bytes: enc.encode(doc) }, pages: all.length }
    const pdf = toPdf(all)
    if (format === 'pdf') return { file: { name: `${stem}.pdf`, mimeType: 'application/pdf', bytes: pdf }, pages: all.length }
    const files = [{ name: `${stem}.html`, bytes: enc.encode(doc) }, { name: `${stem}.pdf`, bytes: pdf }, ...all.map((p, i) => ({ name: `pages/${i === 0 ? 'cover' : `step-${i}`}.svg`, bytes: enc.encode(toSvg(p)) }))]
    return { file: { name: `${stem}.zip`, mimeType: 'application/zip', bytes: zip(files) }, files: files.map((f) => f.name), pages: all.length }
  },
}

export const asmCommands = [settings, parts, step, steps, check, text, style, render, save]
