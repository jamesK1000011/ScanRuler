// SPDX-License-Identifier: AGPL-3.0-only
// patent-kit's commands (patent.*): plan the figures, give out the
// numerals, draw and check the sheets, write the draft, save it all to
// disk. Nothing here sends anything anywhere: the only file that leaves
// is the one the caller saves.

import { toPng } from '../../_shared/lineart/raster'
import { toPdf, toSvg } from '../../_shared/lineart/sheet'
import { VIEW_NAMES } from '../../_shared/lineart/views'
import { zip } from '../../_shared/zip'
import { runCommand } from '../../../src/commands/registry'
import { arr, bool, enumOf, int, num, obj, oneOf, str, vec3 } from '../../../src/commands/schema'
import { readStateSections } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { briefDescription, expand, numeralsCsv, toMarkdown, unknownTokens } from '../core/draft'
import type { BodyIn, Drawing } from '../core/drawings'
import { layout, type Layout } from '../core/layout'
import { DEFAULT_SETTINGS, DRAFT_MARK, SECTIONS, type Figure, type Numeral, type PatentSettings, type Section } from '../core/model'
import { assignBodies, nextNumeral, renumber, retoken, syncBodies, type BodyInfo } from '../core/numerals'
import { check, type Finding } from '../core/rules'
import { specification } from '../core/spec'
import { usePatent } from '../state/patentStore'
import { drawInWorker } from './hlrClient'

type Json = Record<string, unknown>
type V3 = [number, number, number]

interface ReverseBody {
  id: number
  name: string
  visible: boolean
  surface?: boolean
}

export function bodiesNow(): BodyInfo[] {
  const rev = readStateSections().reverse as { bodies?: ReverseBody[] } | undefined
  return (rev?.bodies ?? []).filter((b) => b.visible && !b.surface).map((b) => ({ id: b.id, name: b.name }))
}

/** Bodies renamed in Reverse Engineer since: numerals follow them. */
function sync(): { renamed: { n: number; from: string; to: string }[]; lost: number[] } {
  const s = usePatent.getState()
  const r = syncBodies(s.numerals, bodiesNow())
  if (r.renamed.length) {
    const map = new Map(r.renamed.map((x) => [x.from, x.to]))
    usePatent.getState().set({ numerals: r.numerals, figures: s.figures.map((f) => (f.bodies ? { ...f, bodies: f.bodies.map((b) => map.get(b) ?? b) } : f)) })
  }
  return { renamed: r.renamed, lost: r.lost }
}

async function stepOf(id: number): Promise<string> {
  const r = (await runCommand('reverse.export.step', { bodies: [id] })) as { file?: { bytes: Uint8Array } }
  if (!r?.file?.bytes) throw new CommandError('failed', `Body ${id} gave no STEP.`)
  return new TextDecoder().decode(r.file.bytes)
}

interface Drawn {
  layout: Layout
  drawings: Drawing[]
  findings: Finding[]
  missed: { figure: number; n: number; why: string }[]
}

async function drawAll(progress?: (t: string) => void): Promise<Drawn> {
  sync()
  const s = usePatent.getState()
  if (!s.figures.length) throw new CommandError('invalid_state', 'There are no figures yet: patent.figures { plan: "standard" } plans a set.')
  const bodies = bodiesNow()
  if (!bodies.length) throw new CommandError('invalid_state', 'There is no solid body to draw. Build the part in Reverse Engineer (or import its STEP there) first.')
  const wanted = new Set(s.figures.flatMap((f) => f.bodies ?? bodies.map((b) => b.name)))
  const ins: BodyIn[] = []
  for (const b of bodies) {
    if (!wanted.has(b.name)) continue
    progress?.(`Reading ${b.name}…`)
    ins.push({ name: b.name, step: await stepOf(b.id) })
  }
  for (const f of s.figures) for (const name of f.bodies ?? []) if (!ins.some((b) => b.name === name)) throw new CommandError('invalid_input', `Figure ${f.id} names a body "${name}" that isn't there (bodies: ${bodies.map((b) => b.name).join(', ')}).`)
  progress?.(`Drawing ${s.figures.length} figure${s.figures.length === 1 ? '' : 's'}…`)
  const drawings = await drawInWorker(ins, s.figures, s.numerals, s.settings.hidden === 'dashed').catch((e: Error) => {
    throw new CommandError('failed', `Drawing failed: ${e.message}`)
  })
  const l = layout(s.figures, drawings, s.settings)
  const missed = drawings.flatMap((d, i) => d.missed.map((m) => ({ figure: i + 1, ...m })))
  return { layout: l, drawings, missed, findings: check(l, s.figures, s.numerals, s.draft, missed) }
}

const brief = (f: Finding[]) => {
  const bad = f.filter((x) => !x.ok)
  return { errors: bad.filter((x) => x.level === 'error').length, warnings: bad.filter((x) => x.level === 'warn').length, notes: bad.filter((x) => x.level === 'note').length }
}

const figureOut = (figures: Figure[]) => figures.map((f, i) => ({ fig: i + 1, ...f }))

const numeralTable = (numerals: Numeral[]) => numerals.map((n) => ({ n: n.n, label: n.label, ...('at' in n.target ? { at: n.target.at, ...(n.target.body ? { body: n.target.body } : {}) } : { body: n.target.body }), ...(n.auto ? { auto: true } : {}) }))

const settings: Command<Partial<PatentSettings>> = {
  name: 'settings',
  title: 'Patent drawing settings',
  description: `Paper (letter or a4), hidden lines (omit, the usual, or dashed), numeral and "FIG." heights (mm cap height; 37 CFR 1.84 wants numerals 3.2 mm or more and FIG. labels larger), line weight, figures per sheet (1, 2 or 4), the first numeral and the step between (10, 2), and what the brief description calls the thing ("the device"). With nothing, reads them. Defaults: ${JSON.stringify(DEFAULT_SETTINGS)}.`,
  input: obj({
    paper: enumOf(['letter', 'a4']),
    hidden: enumOf(['omit', 'dashed']),
    numeralMm: num('mm.', { minimum: 2, maximum: 10 }),
    figLabelMm: num('mm.', { minimum: 3, maximum: 15 }),
    lineMm: num('mm.', { minimum: 0.1, maximum: 1 }),
    figuresPerSheet: enumOf([1, 2, 4]),
    numeralStart: int(undefined, { minimum: 1, maximum: 9000 }),
    numeralStep: int(undefined, { minimum: 1, maximum: 10 }),
    title: str('"the device", "the clamp".', { minLength: 1 }),
  }),
  run: async (input) => {
    if (Object.keys(input).length) usePatent.getState().set({ settings: { ...usePatent.getState().settings, ...input } })
    return { settings: usePatent.getState().settings }
  },
}

const viewSchema = oneOf([enumOf([...VIEW_NAMES], 'A named view.'), obj({ toward: vec3('From the part toward the viewer.'), up: vec3('Up on the paper; Z by default.') }, ['toward'], 'A view from a direction.')])
const figureSchema = obj(
  {
    id: str('Its id; given when left out.', { minLength: 1 }),
    kind: enumOf(['view', 'exploded', 'section'], 'view by default.'),
    view: viewSchema,
    bodies: arr(str(), 'Body names; every visible solid body when left out.'),
    numerals: arr(int(), 'Only these numerals; every one it can show when left out.'),
    section: obj({ axis: enumOf(['x', 'y', 'z']), offset: num('Where the plane is on that axis, mm.'), keep: enumOf(['above', 'below'], 'Which side of the plane stays.'), from: str('The figure the cut line is shown on.') }, ['axis', 'offset', 'keep']),
    explode: obj({ factor: num('How far parts move apart, as a share of their distance from the middle; 1.5 by default.', { exclusiveMinimum: 0, maximum: 10 }) }),
    caption: str('After the view in the brief description: "showing the latch open".'),
  },
  [],
)

type FigureIn = Partial<Figure> & { id?: string }

function completeFigure(f: FigureIn, taken: Set<string>): Figure {
  let id = f.id
  if (!id) {
    let i = taken.size + 1
    while (taken.has(`f${i}`)) i++
    id = `f${i}`
  }
  taken.add(id)
  const kind = f.kind ?? (f.section ? 'section' : 'view')
  if (kind === 'section' && !f.section) throw new CommandError('invalid_input', `Figure ${id} is a section and needs section { axis, offset, keep }.`)
  return { id, kind, view: f.view ?? 'iso', ...(f.bodies ? { bodies: f.bodies } : {}), ...(f.numerals ? { numerals: f.numerals } : {}), ...(f.section ? { section: f.section } : {}), ...(kind === 'exploded' ? { explode: { factor: f.explode?.factor ?? 1.5 } } : {}), ...(f.caption ? { caption: f.caption } : {}) }
}

const figures: Command<{ plan?: 'standard' | 'views'; add?: FigureIn[]; update?: FigureIn[]; remove?: string[]; move?: { id: string; to: number }; clear?: boolean }> = {
  name: 'figures',
  title: 'Plan the patent figures',
  description:
    'The figures, FIG. 1 onward in this order. plan "standard" sets perspective, front, top and right views, and an exploded perspective when there are two or more bodies; "views" adds left, back and bottom too. add appends figures: kind view (a named view or { toward, up }), exploded, or section { axis, offset, keep, from } — a cut square to an axis, seen from the side cut away, its faces hatched, and the cut line drawn on the figure named by from, which must look across it (a top view for a cut on y). update changes figures by id; remove drops them; move puts one at a position (1 = FIG. 1). With nothing, lists them with the brief description they come to. Draws nothing: patent.render does.',
  input: obj({
    plan: enumOf(['standard', 'views'], 'Replaces the figures with a standard set.'),
    add: arr(figureSchema),
    update: arr(figureSchema),
    remove: arr(str()),
    move: obj({ id: str(), to: int(undefined, { minimum: 1 }) }, ['id', 'to']),
    clear: bool(),
  }),
  run: async ({ plan, add, update, remove, move, clear }) => {
    const s = usePatent.getState()
    let list = clear || plan ? [] : [...s.figures]
    const taken = new Set(list.map((f) => f.id))
    if (plan) {
      const views: FigureIn[] = [{ view: 'iso' }, { view: 'front' }, { view: 'top' }, { view: 'right' }]
      if (plan === 'views') views.push({ view: 'left' }, { view: 'back' }, { view: 'bottom' })
      if (bodiesNow().length > 1) views.push({ kind: 'exploded', view: 'iso' })
      list = views.map((v) => completeFigure(v, taken))
    }
    for (const f of add ?? []) {
      if (f.id && taken.has(f.id)) throw new CommandError('invalid_input', `There is already a figure ${f.id}.`)
      list.push(completeFigure(f, taken))
    }
    for (const f of update ?? []) {
      const i = list.findIndex((g) => g.id === f.id)
      if (i < 0) throw new CommandError('invalid_input', `There is no figure ${f.id} (figures: ${list.map((g) => g.id).join(', ') || 'none'}).`)
      const rest = new Set(taken)
      rest.delete(f.id!)
      list[i] = completeFigure({ ...list[i], ...f }, rest)
    }
    if (remove?.length) list = list.filter((f) => !remove.includes(f.id))
    if (move) {
      const i = list.findIndex((f) => f.id === move.id)
      if (i < 0) throw new CommandError('invalid_input', `There is no figure ${move.id}.`)
      const [f] = list.splice(i, 1)
      list.splice(Math.min(move.to - 1, list.length), 0, f)
    }
    for (const f of list) if (f.section?.from && !list.some((g) => g.id === f.section!.from)) throw new CommandError('invalid_input', `Figure ${f.id} is cut on figure ${f.section.from}, which isn't there.`)
    if (plan || add || update || remove || move || clear) usePatent.getState().set({ figures: list })
    const now = usePatent.getState()
    return { figures: figureOut(now.figures), brief: briefDescription(now.figures, now.settings.title) }
  },
}

const numerals: Command<{ assign?: 'bodies'; set?: { n?: number; label: string; body?: string; at?: V3 }[]; remove?: number[]; renumber?: boolean }> = {
  name: 'numerals',
  title: 'Reference numerals',
  description:
    'The reference numerals: each part, or each point on one, and its number. The same numeral stands for the same part in every figure and paragraph. assign "bodies" gives each visible solid body without one the next free numeral (10, 12, 14… by default), labelled with its name; a body renamed in Reverse Engineer takes its numeral and auto label with it. set adds or changes numerals: { label, body } for a whole body, or { label, at: [x, y, z], body? } for a feature — a point on the part\'s surface, mm (reverse.body.describe gives faces and edges to pick from); n picks the number, the next free one when left out. remove drops numerals; renumber numbers them again in order from the start and moves the draft\'s [[n]] tokens with them. Changes no drawing until patent.render.',
  input: obj({
    assign: enumOf(['bodies']),
    set: arr(obj({ n: int(undefined, { minimum: 1, maximum: 9999 }), label: str('200 characters at most.', { minLength: 1 }), body: str(), at: vec3('A point on the part, mm.') }, ['label'])),
    remove: arr(int()),
    renumber: bool(),
  }),
  run: async (input) => {
    const synced = sync()
    let s = usePatent.getState()
    let list = [...s.numerals]
    const added: number[] = []
    if (input.assign) {
      const r = assignBodies(list, bodiesNow(), s.settings)
      list = r.numerals
      added.push(...r.added.map((x) => x.n))
    }
    for (const x of input.set ?? []) {
      if (x.label.length > 200) throw new CommandError('invalid_input', `${x.label.slice(0, 39)}…: a label is 200 characters at most.`)
      const named = x.label.length > 40 ? `${x.label.slice(0, 39)}…` : x.label
      if (!x.body && !x.at) throw new CommandError('invalid_input', `${named}: give it a body, a point (at), or both.`)
      if (x.at && !x.at.every((v) => Number.isFinite(v) && Math.abs(v) <= 100_000)) throw new CommandError('invalid_input', `${named}: at is a point on the part, mm — within 100 m of the origin.`)
      const n = x.n ?? list.find((m) => m.label === x.label)?.n ?? nextNumeral(list, s.settings)
      const nm: Numeral = { n, label: x.label, auto: false, target: x.at ? { at: x.at, ...(x.body ? { body: x.body } : {}) } : { body: x.body!, ...(bodiesNow().find((b) => b.name === x.body) ? { id: bodiesNow().find((b) => b.name === x.body)!.id } : {}) } }
      list = [...list.filter((m) => m.n !== n), nm].sort((a, b) => a.n - b.n)
      added.push(n)
    }
    if (input.remove?.length) list = list.filter((m) => !input.remove!.includes(m.n))
    let draft = s.draft
    let moved: Record<string, number> | undefined
    if (input.renumber) {
      const r = renumber(list, s.settings)
      list = r.numerals
      draft = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v ? retoken(v, r.map) : v]))
      moved = Object.fromEntries([...r.map].filter(([a, b]) => a !== b).map(([a, b]) => [String(a), b]))
      usePatent.getState().set({ figures: s.figures.map((f) => (f.numerals ? { ...f, numerals: f.numerals.map((n) => r.map.get(n) ?? n) } : f)) })
    }
    usePatent.getState().set({ numerals: list, draft })
    s = usePatent.getState()
    return {
      numerals: numeralTable(s.numerals),
      ...(added.length ? { added } : {}),
      ...(moved ? { moved } : {}),
      ...(synced.renamed.length ? { renamed: synced.renamed } : {}),
      ...(synced.lost.length ? { lost: synced.lost, note: 'These numerals name bodies that are gone or hidden; remove them or point them at another body.' } : {}),
    }
  },
}

const render: Command<{ sheet?: number; format?: 'png' | 'svg' | 'pdf' }> = {
  name: 'render',
  title: 'Draw a patent sheet',
  description:
    'Draws the figures from the Reverse Engineer bodies — hidden lines removed by OCCT — onto sheets laid out to 37 CFR 1.84, and returns one sheet: a PNG to look at (the default), or SVG or PDF. Answers the layout (each figure\'s sheet and scale, numerals placed and any it couldn\'t show and why) and a count of checklist findings; patent.check lists them.',
  input: obj({ sheet: int('Sheet number, from 1; 1 by default.', { minimum: 1 }), format: enumOf(['png', 'svg', 'pdf']) }),
  readOnly: true,
  long: true,
  returnsFile: true,
  returnsImage: true,
  timeoutMs: 600_000,
  run: async ({ sheet = 1, format = 'png' }, ctx) => {
    const d = await drawAll((t) => ctx?.progress(t))
    const sh = d.layout.sheets[sheet - 1]
    if (!sh) throw new CommandError('invalid_input', `There are ${d.layout.sheets.length} sheets.`)
    const name = `patent-sheet-${sheet}`
    const file = format === 'png' ? { name: `${name}.png`, mimeType: 'image/png', bytes: await toPng(sh) } : format === 'svg' ? { name: `${name}.svg`, mimeType: 'image/svg+xml', bytes: new TextEncoder().encode(toSvg(sh)) } : { name: `${name}.pdf`, mimeType: 'application/pdf', bytes: toPdf([sh]) }
    return {
      file,
      sheets: d.layout.sheets.length,
      figures: d.layout.placements.filter((p) => p.sheet === sheet).map((p) => ({ fig: p.figure, id: p.id, scale: Number(p.scale.toFixed(3)), numerals: d.layout.leaders.filter((l) => l.figure === p.figure).map((l) => l.n) })),
      ...(d.missed.length ? { notShown: d.missed } : {}),
      checklist: brief(d.findings),
    }
  },
}

const checkCommand: Command<{ all?: boolean }> = {
  name: 'check',
  title: 'Check the drawings against 37 CFR 1.84',
  description:
    'Draws every sheet and checks it against 37 CFR 1.84 as a target, not a guarantee: sheet size and margins, black lines only, numeral and FIG. heights, consecutive figure and sheet numbers, lead lines (crossing, running through a numeral, too long, not ending on the part), detail that may not survive a 2/3 reduction, hatched sections with the cut line shown, brackets on an exploded view sharing a sheet, and every numeral in both a drawing and the description, one numeral per part. Each finding names its rule, level (error, warn, note) and figure. The attorney judges. all: true lists what passed too.',
  input: obj({ all: bool() }),
  readOnly: true,
  long: true,
  timeoutMs: 600_000,
  run: async ({ all = false }, ctx) => {
    const d = await drawAll((t) => ctx?.progress(t))
    return { summary: brief(d.findings), findings: d.findings.filter((f) => all || !f.ok), note: 'A checklist against 37 CFR 1.84 for the attorney to judge, not a guarantee the Office accepts the drawings.' }
  },
}

const draft: Command<{ section?: Section; text?: string; generate?: 'drawings'; scaffold?: boolean }> = {
  name: 'draft',
  title: 'The draft description',
  description: `The draft text, by section: ${SECTIONS.join(', ')}. Write numerals as tokens: [[10]] reads "housing 10", [[10#]] the bare 10 — so a renamed part renames every paragraph. text writes a section (empty clears it); generate "drawings" writes the brief description from the figures. With section alone, reads it (raw and as it reads); with nothing, every section. scaffold: true answers what the detailed description should cover — each numeral, the figures it is in, the parts' sizes — and what geometry can't tell (what each part does, materials, alternatives, what is new), which only the inventor can say. Every section is marked "${DRAFT_MARK}". Claims are suggested language only. Nothing here is sent anywhere.`,
  input: obj({ section: enumOf([...SECTIONS]), text: str('60 000 characters at most.'), generate: enumOf(['drawings']), scaffold: bool() }),
  run: async ({ section, text, generate, scaffold }) => {
    sync()
    const s = usePatent.getState()
    if (generate) usePatent.getState().set({ draft: { ...s.draft, drawings: briefDescription(s.figures, s.settings.title) } })
    if (text !== undefined) {
      if (!section) throw new CommandError('invalid_input', 'Name the section to write.')
      if (text.length > 60_000) throw new CommandError('invalid_input', `A section is 60 000 characters at most (this is ${text.length}); split it.`)
      const bad = unknownTokens(text, s.numerals)
      if (bad.length) throw new CommandError('invalid_input', `No numeral ${bad.join(', ')}: patent.numerals { set } adds one.`)
      const next = { ...usePatent.getState().draft }
      if (text.trim()) next[section] = text
      else delete next[section]
      usePatent.getState().set({ draft: next })
    }
    const now = usePatent.getState()
    const out: Json = { mark: DRAFT_MARK }
    if (section) out.section = { name: section, raw: now.draft[section] ?? '', reads: expand(now.draft[section] ?? '', now.numerals) }
    else out.sections = Object.fromEntries(SECTIONS.map((k) => [k, now.draft[k] ? `${now.draft[k]!.length} characters` : 'empty']))
    if (scaffold) {
      const rev = readStateSections().reverse as { bodies?: (ReverseBody & { bounds?: { min: V3; max: V3 } | null })[] } | undefined
      out.scaffold = {
        numerals: now.numerals.map((n) => ({
          n: n.n,
          label: n.label,
          figures: now.figures.map((f, i) => ({ f, i })).filter(({ f }) => !f.numerals || f.numerals.includes(n.n)).map(({ i }) => i + 1),
          ...('body' in n.target && !('at' in n.target) ? { size: sizeOf(rev?.bodies?.find((b) => b.name === n.target.body)?.bounds) } : {}),
        })),
        figures: briefDescription(now.figures, now.settings.title),
        askTheInventor: ['What each part does, and how they work together', 'What is new over what exists, in their words (the background)', 'Materials, and alternatives that would work as well (other shapes, fasteners, materials)', 'Ranges: sizes or angles that matter, and how far they may vary'],
        rules: 'Flag claim language as a suggestion. Inventorship is decided by people, not tools.',
      }
    }
    return out
  },
}

function sizeOf(b: { min: V3; max: V3 } | null | undefined): string | undefined {
  if (!b) return undefined
  return [0, 1, 2].map((i) => (b.max[i] - b.min[i]).toFixed(1)).join(' × ') + ' mm'
}

const save: Command<{ format?: 'zip' | 'pdf' | 'spec' | 'md' }> = {
  name: 'save',
  title: 'Save the patent kit to disk',
  description:
    'The kit as one file to save on this computer: zip (the default) holds every sheet as SVG, all of them as one PDF, the specification as a PDF, the draft as Markdown, the numeral table as CSV and the checklist; pdf the drawing sheets alone; spec the specification alone — the draft laid out as 37 CFR 1.52 and 1.77 ask: margins, one column, 1½-spaced lines, paragraphs numbered [0001], claims and abstract each from a new page, pages numbered, marked a draft; md the draft alone. Give path to write it to a folder. Only a local save: there is no share, upload or send, and nothing goes anywhere else.',
  input: obj({ format: enumOf(['zip', 'pdf', 'spec', 'md']) }),
  readOnly: true,
  long: true,
  returnsFile: true,
  timeoutMs: 600_000,
  run: async ({ format = 'zip' }, ctx) => {
    sync()
    const s = usePatent.getState()
    const md = toMarkdown(s.draft, s.numerals, s.figures, s.settings.title)
    if (format === 'md') return { file: { name: 'patent-draft.md', mimeType: 'text/markdown', bytes: new TextEncoder().encode(md) } }
    const spec = specification(s.draft, s.numerals, s.figures, s.settings)
    const specPdf = toPdf(spec.sheets)
    if (format === 'spec') return { file: { name: 'patent-specification.pdf', mimeType: 'application/pdf', bytes: specPdf }, pages: spec.sheets.length, paragraphs: spec.paragraphs, findings: spec.findings }
    const d = await drawAll((t) => ctx?.progress(t))
    const pdf = toPdf(d.layout.sheets)
    if (format === 'pdf') return { file: { name: 'patent-drawings.pdf', mimeType: 'application/pdf', bytes: pdf }, sheets: d.layout.sheets.length, checklist: brief(d.findings) }
    const enc = new TextEncoder()
    const checklist = [`# 37 CFR 1.84 checklist`, '', `> ${DRAFT_MARK}. A target, not a guarantee.`, '', ...d.findings.map((f) => `- [${f.ok ? 'x' : ' '}] ${f.rule} (${f.level})${f.figure ? ` FIG. ${f.figure}` : ''}: ${f.message}`), '', '## Specification (37 CFR 1.52, 1.72, 1.75, 1.77)', '', ...(spec.findings.length ? spec.findings.map((f) => `- [ ] ${f.rule} (${f.level}): ${f.message}`) : ['- [x] Every section the specification needs is there.']), ''].join('\n')
    const files = [
      ...d.layout.sheets.map((sh, i) => ({ name: `sheets/sheet-${i + 1}.svg`, bytes: enc.encode(toSvg(sh)) })),
      { name: 'patent-drawings.pdf', bytes: pdf },
      { name: 'patent-specification.pdf', bytes: specPdf },
      { name: 'patent-draft.md', bytes: enc.encode(md) },
      { name: 'numerals.csv', bytes: enc.encode(numeralsCsv(s.numerals)) },
      { name: 'checklist.md', bytes: enc.encode(checklist) },
    ]
    return { file: { name: 'patent-kit.zip', mimeType: 'application/zip', bytes: zip(files) }, files: files.map((f) => f.name), sheets: d.layout.sheets.length, checklist: brief(d.findings) }
  },
}

export const patentCommands = [settings, figures, numerals, render, checkCommand, draft, save]
