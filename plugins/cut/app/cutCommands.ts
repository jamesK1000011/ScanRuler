// SPDX-License-Identifier: AGPL-3.0-only
// cut.*: a part judged and drawn for cutting from sheet. The body is read
// through Reverse Engineer's commands, run by name — never imported, so
// this plugin stands without it: its faces (reverse.body.describe) say
// whether it is a sheet part and how thick; the kernel's own section
// through the middle of the sheet (reverse.body.section) is its profile,
// lines, arcs and circles exact. Figures come from the input, else the
// body's cut setup, else the machine's and the part's material's
// (core/rules.ts). Every command runs headless.

import { buildFlatDxf } from '../../../src/core/flat/dxf'
import { buildFlatSvg } from '../../../src/core/flat/svg'
import { runCommand } from '../../../src/commands/registry'
import { arr, bool, enumOf, num, obj, oneOf, str } from '../../../src/commands/schema'
import { readStateSection } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { awaitingMaterials, materialOfBody } from '../../_shared/materials/assigned'
import { bodyKeyOf, setupFor, setupsOf, type Setup } from '../../_shared/setups'
import { checkCut, type CutFigures, type Finding } from '../core/check'
import { layOut } from '../core/drawing'
import { readFlat, type FaceIn, type FlatRead, type V3 } from '../core/flat'
import { pieceOf, profileBox, profilesOf, roundHoles, type Piece, type Profile, type Pt } from '../core/profile'
import { cutRules, kindOf, KINDS, stuffOf, unsuited, type CutKind } from '../core/rules'

type Json = Record<string, unknown>

const invalid = (m: string): never => {
  throw new CommandError('invalid_input', m)
}
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0

interface Body {
  id: number
  name: string
  visible?: boolean
  surface?: boolean
}

function bodies(): Body[] {
  const r = readStateSection('reverse') as { bodies?: Body[] } | undefined
  if (!r) throw new CommandError('unavailable', 'Reading a part for cutting needs the Reverse engineer workspace, and this build has none.')
  return r.bodies ?? []
}

function bodyNamed(ref: string | number): Body {
  const all = bodies()
  const b = all.find((x) => x.id === ref || x.name === ref) ?? all.find((x) => typeof ref === 'string' && x.name.toLowerCase() === ref.toLowerCase())
  if (!b) throw new CommandError('not_found', `No body "${ref}" — there are ${all.filter((x) => !x.surface).map((x) => x.name).join(', ') || 'none'}.`)
  if (b.surface) invalid(`${b.name} is a surface, not a part.`)
  return b
}

/** A part read for cutting: its sides, thickness and profile, and how its
 *  sheet maps back to the part. */
export interface PartRead {
  body: Body
  flat: FlatRead
  profiles: Profile[]
  /** Chains the section left open: a body that is not closed there. */
  open: number
  toWorld(p: Pt): V3
}

export async function readPart(b: Body): Promise<PartRead> {
  const d = (await runCommand('reverse.body.describe', { body: b.id, edges: false })) as { bodies?: { faceList?: FaceIn[] }[] }
  const faces = d.bodies?.[0]?.faceList ?? []
  const flat = readFlat(faces)
  const none = (): PartRead => ({ body: b, flat, profiles: [], open: 0, toWorld: () => [0, 0, 0] })
  if (!flat.normal || flat.top === null || flat.bottom === null) return none()
  const n = flat.normal
  const mid = (flat.top + flat.bottom) / 2
  const cut = (await runCommand('reverse.body.section', { plane: { kind: 'oriented', point: n.map((x) => x * mid), normal: n }, bodies: [b.id] })) as {
    plane: { origin: V3; basisU: V3; basisV: V3 }
    levels: { chains: { closed: boolean; pieces: Json[] }[] }[]
  }
  const chains = cut.levels?.[0]?.chains ?? []
  const closed = chains.filter((c) => c.closed).map((c) => c.pieces.map(pieceOf).filter((p): p is Piece => p !== null))
  const { origin: o, basisU: u, basisV: v } = cut.plane
  return {
    body: b,
    flat,
    profiles: profilesOf(closed),
    open: chains.length - closed.length,
    toWorld: (p) => [0, 1, 2].map((k) => o[k] + p[0] * u[k] + p[1] * v[k]) as V3,
  }
}

/** The figures a check or a file goes by, and which were assumed. */
function figuresFor(read: PartRead, setup: Setup | null, over: { machine?: CutKind; thickness?: number; kerf?: number; minFeature?: number; sheet?: [number, number] }) {
  const kind = over.machine ?? kindOf(setup)
  const m = materialOfBody(bodyKeyOf(read.body))
  const stuff = stuffOf(m?.category)
  const sheetThickness = over.thickness ?? (isNum(setup?.thickness) ? setup!.thickness : null)
  const t = sheetThickness ?? read.flat.thickness ?? 0
  const rules = cutRules(kind, stuff, t)
  const assumed: string[] = []
  const pick = (given: number | undefined, held: unknown, rule: number, key: string) => {
    if (given !== undefined) return given
    if (isNum(held)) return held
    assumed.push(key)
    return rule
  }
  const kerf = pick(over.kerf, setup?.kerf, rules.kerf, 'kerf')
  const minFeature = pick(over.minFeature, setup?.minFeature, kind === 'router' ? Math.max(rules.minFeature, kerf) : rules.minFeature, 'minFeature')
  const sheet = over.sheet ?? (Array.isArray(setup?.sheet) ? (setup!.sheet as [number, number]) : null)
  const figures: CutFigures = { kind, sheetThickness, kerf, minFeature, tool: kind === 'router' ? kerf : null, holePerThickness: rules.holePerThickness, sheet }
  return { figures, rules, stuff, material: m ? { id: m.id, name: m.name, category: m.category } : null, assumed }
}

const bodyIn = oneOf([str(undefined, { minLength: 1 }), num()], 'The body, by name or Reverse Engineer id.')
const overIn = {
  machine: enumOf(KINDS, 'Over the setup’s: laser, waterjet, plasma or router.'),
  thickness: num('The sheet’s thickness, mm, over the setup’s.', { exclusiveMinimum: 0 }),
  kerf: num('mm, over the setup’s (a router’s cutter diameter).', { exclusiveMinimum: 0 }),
  minFeature: num('The least web, slot or hole, mm, over the setup’s.', { exclusiveMinimum: 0 }),
  sheet: arr(num(undefined, { exclusiveMinimum: 0 }), 'The sheet’s size [width, height], mm, over the setup’s.', { minItems: 2, maxItems: 2 }),
}

const counts = (f: Finding[]) => ({ errors: f.filter((x) => x.severity === 'error').length, warnings: f.filter((x) => x.severity === 'warning').length })

const check: Command<{ body?: string | number; machine?: CutKind; thickness?: number; kerf?: number; minFeature?: number; sheet?: [number, number] }> = {
  name: 'check',
  title: 'Check a part for cutting from sheet',
  description:
    'Judge a Reverse Engineer body for a sheet cut — laser, waterjet, plasma or router — by its cut setup’s figures (setup.of), each over-ridable here: is it a sheet part (two parallel flat sides, every other face square to them — a step, pocket, bevel, chamfer or rounded edge is an error, naming the face), its thickness against the sheet’s, its narrow webs and slots against the least feature (narrower than the kerf: cannot be cut), its round holes against the least feature and the thickness (laser and plasma: a hole under the thickness comes out tapered), a router’s inside corners against its cutter’s radius, and whether it fits the sheet (turned if need be). Figures not set come from the machine and the part’s material (assumed lists them; rules says why). Answers body, setup, machine, material, thickness, figures, profile (pieces, holes, round holes with diameters, size on the sheet, sides’ normal), findings (severity, rule, says, at — the part’s frame), errors, warnings. Changes nothing.',
  input: obj({ body: bodyIn, ...overIn }),
  readOnly: true,
  headless: true,
  long: true,
  timeoutMs: 120_000,
  run: async ({ body, ...over }) => {
    const b = body !== undefined ? bodyNamed(body) : onlyBody()
    const setup = setupFor(b.id, 'cut')
    const read = await readPart(b)
    const { figures, rules, stuff, material, assumed } = figuresFor(read, setup, over)
    const findings = checkCut(read.flat, read.profiles, figures, read.toWorld)
    if (read.open > 0) findings.unshift({ severity: 'error', rule: 'profile', says: `${read.open} open chain${read.open === 1 ? '' : 's'} in the section: the body is not closed there (reverse.body.check)` })
    const bad = unsuited(figures.kind, stuff, read.flat.thickness ?? 0)
    if (bad) findings.unshift({ severity: bad.severity, rule: 'material', says: bad.says })
    if (!material) findings.push({ severity: 'info', rule: 'material', says: 'no material set on the part (material.set): rules for an unknown one taken' })
    if (figures.sheetThickness === null && read.flat.thickness !== null) findings.push({ severity: 'info', rule: 'thickness', says: `no sheet thickness set: the part’s ${read.flat.thickness} taken` })
    const sizes = read.profiles.map((p) => {
      const bx = profileBox(p)
      return [r4(bx.max[0] - bx.min[0]), r4(bx.max[1] - bx.min[1])]
    })
    return {
      body: b.name,
      setup: setup ? `${setup.name} (${setup.id})` : null,
      machine: figures.kind,
      material,
      thickness: read.flat.thickness,
      figures: { sheetThickness: figures.sheetThickness, kerf: figures.kerf, minFeature: figures.minFeature, holePerThickness: figures.holePerThickness, sheet: figures.sheet, tolerance: rules.tolerance, ...(assumed.length ? { assumed } : {}), rules: rules.basis },
      profile: {
        flat: read.flat.flat,
        normal: read.flat.normal,
        pieces: read.profiles.length,
        holes: read.profiles.reduce((s, p) => s + p.holes.length, 0),
        roundHoles: read.profiles.flatMap((p) => roundHoles(p).map((h) => ({ diameter: h.diameter, at: read.toWorld(h.at).map(r4) }))).slice(0, 40),
        size: sizes,
      },
      findings,
      ...counts(findings),
    }
  },
}

function onlyBody(): Body {
  const solids = bodies().filter((b) => !b.surface)
  const shown = solids.filter((b) => b.visible !== false)
  if (shown.length === 1) return shown[0]
  if (solids.length === 1) return solids[0]
  if (!solids.length) throw new CommandError('invalid_state', 'There is no solid body to check — build one in Reverse engineer first.')
  return invalid(`Say which body: ${solids.map((x) => x.name).join(', ')}.`)
}

/** The bodies a file is of: those named, else the setup's, else the cut
 *  setups' (the one the Make tab shows when it is one). */
function bodiesFor(asked: (string | number | { body: string | number; count?: number })[] | undefined, setupRef: string | undefined): { body: Body; count: number }[] {
  if (asked) {
    return asked.map((a) => {
      const ref = typeof a === 'object' ? a.body : a
      const count = typeof a === 'object' && a.count !== undefined ? a.count : 1
      if (!Number.isInteger(count) || count < 1 || count > 500) invalid('count: a whole number from 1 to 500.')
      return { body: bodyNamed(ref), count }
    })
  }
  const all = setupsOf().filter((s) => s.type === 'cut')
  const sel = (readStateSection('setups') as { selected?: string | null } | undefined)?.selected
  const s = setupRef !== undefined ? all.find((x) => x.id === setupRef || x.name.toLowerCase() === setupRef.toLowerCase()) : (all.find((x) => x.id === sel) ?? (all.length === 1 ? all[0] : undefined))
  if (setupRef !== undefined && !s) throw new CommandError('not_found', `No cut setup "${setupRef}" — there are ${all.map((x) => `${x.id} ${x.name}`).join(', ') || 'none'}.`)
  if (!s) return invalid(all.length ? `Say which parts (bodies) or which cut setup (setup): ${all.map((x) => `${x.id} ${x.name}`).join(', ')}.` : 'Name the parts (bodies): there is no cut setup to take them from.')
  if (!s.bodies.length) invalid(`${s.name} (${s.id}) has no parts: setup.set { id: "${s.id}", add: [...] } first.`)
  return s.bodies.map((k) => ({ body: bodyNamed(/^\d+$/.test(k) ? Number(k) : k), count: 1 }))
}

const stem = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'parts'

const exportFile: Command<{ bodies?: (string | number | { body: string | number; count?: number })[]; setup?: string; format?: 'dxf' | 'svg'; compensate?: boolean; kerf?: number; gap?: number; sheet?: [number, number]; labels?: boolean }> = {
  name: 'export',
  title: 'The parts’ outlines as a cutting file',
  description:
    'The flat profiles of sheet parts as one file to cut from — DXF (millimetres, AutoCAD 2000, layer edges) or SVG (one unit a millimetre) — each part’s outline and holes as lines, arcs and circles, read exactly from the kernel’s section through the middle of its sheet, laid out flat in rows (row packing, not true nesting) with gap between (the larger of 3 and two kerfs by default), wrapping at the sheet’s width and onto further sheets beside when one fills (the sheet: the setup’s, or given). bodies: by name or id, or { body, count } for copies; by default the cut setup named (setup), else the one the Make tab shows, else the only one. compensate: the path moved half the kerf off the part (out round an outline, in round a hole) so the cut lands on the drawn edge — circles stay circles, other loops become short lines; off by default (the setup’s compensate), the machine’s software then compensates. labels: the part names as text on their own layer (off: a cutter may cut text). A part that is not a sheet part is drawn by its section all the same, and said in notes. Answers the file’s bytes and name, placed (each part, its sheet, where, turned), sheets, size, compensated, kerf, notes. Changes nothing.',
  input: obj({
    bodies: arr(oneOf([bodyIn, obj({ body: bodyIn, count: num('Copies, 1 by default.', { minimum: 1, maximum: 500 }) }, ['body'])]), 'The parts; a cut setup’s by default.', { minItems: 1 }),
    setup: str('The cut setup whose parts these are, by id or name.', { minLength: 1 }),
    format: enumOf(['dxf', 'svg'], 'dxf (the default) or svg.'),
    compensate: bool('Move the path half the kerf off the part; the setup’s by default (off).'),
    kerf: num('mm, over the setup’s, for compensation and the gap.', { exclusiveMinimum: 0 }),
    gap: num('The room between parts, mm.', { minimum: 0, maximum: 200 }),
    sheet: overIn.sheet,
    labels: bool('Write the part names on a layer of their own (off by default).'),
  }),
  readOnly: true,
  headless: true,
  long: true,
  returnsFile: true,
  timeoutMs: 300_000,
  run: async ({ bodies: asked, setup: setupRef, format = 'dxf', compensate, kerf: kerfIn, gap, sheet: sheetIn, labels = false }) => {
    const want = bodiesFor(asked, setupRef)
    const notes: string[] = []
    const parts: { name: string; profiles: Profile[] }[] = []
    let kerf = 0
    let sheet: [number, number] | null = sheetIn ?? null
    let comp = compensate
    for (const { body, count } of want) {
      const setup = setupFor(body.id, 'cut')
      const read = await readPart(body)
      if (!read.profiles.length) throw new CommandError('invalid_state', `${body.name} has no closed outline through the middle of a sheet: it is not a sheet part (cut.check { body: ${JSON.stringify(body.name)} } says why).`)
      if (!read.flat.flat) notes.push(`${body.name} is not a sheet part (${read.flat.offenders.length} face${read.flat.offenders.length === 1 ? '' : 's'} a straight cut does not make): drawn by its section through the middle`)
      if (read.open) notes.push(`${body.name}: ${read.open} open chain${read.open === 1 ? '' : 's'} in its section left out`)
      const f = figuresFor(read, setup, { ...(kerfIn !== undefined ? { kerf: kerfIn } : {}) })
      kerf = Math.max(kerf, f.figures.kerf)
      sheet ??= f.figures.sheet
      comp ??= setup?.compensate === true
      for (let i = 0; i < count; i++) parts.push({ name: count > 1 ? `${body.name} ${i + 1}` : body.name, profiles: read.profiles })
    }
    const compensated = comp === true
    const spacing = gap ?? Math.max(3, 2 * kerf)
    const title = `${want.map((w) => w.body.name).join(', ')} — flat profiles to cut`
    const note = `${parts.length} part${parts.length === 1 ? '' : 's'}; ${compensated ? `path kerf-compensated (kerf ${r4(kerf)})` : 'drawn edges: the machine compensates the kerf'}; laid out in rows ${r4(spacing)} apart`
    const laid = layOut(parts, { gap: spacing, sheet, compensate: compensated, kerf, labels, title, note })
    if (sheet && laid.sheets > 1) notes.push(`${laid.sheets} sheets of ${sheet[0]} × ${sheet[1]}, laid side by side`)
    const text = format === 'svg' ? buildFlatSvg(laid.input) : buildFlatDxf({ ...laid.input, origin: null, edgeTolerance: 0, units: 'mm' })
    const name = `${stem(want.length === 1 ? want[0].body.name : (setupRef ?? 'parts'))}-cut.${format}`
    return {
      file: { name, mimeType: format === 'svg' ? 'image/svg+xml' : 'application/dxf', bytes: new TextEncoder().encode(text) },
      placed: laid.placed,
      sheets: laid.sheets,
      size: laid.size,
      compensated,
      kerf: r4(kerf),
      gap: r4(spacing),
      ...(notes.length ? { notes } : {}),
      status: `${parts.length} part${parts.length === 1 ? '' : 's'} as ${format.toUpperCase()}${compensated ? ', kerf-compensated' : ''}.`,
    }
  },
}

const rules: Command<{ machine?: CutKind; material?: string; thickness?: number }> = {
  name: 'rules',
  title: 'What a sheet cut holds to',
  description: 'The figures a cut goes by where a setup leaves them unset — kerf, least feature, the hole-to-thickness rule and the ± a cut size lands within, mm — for a machine (laser by default), a material category (metal, thermoplast, wood, glass; other by default) and a thickness (mm, 0 by default), and why: shop rules of thumb, not a datasheet. Changes nothing.',
  input: obj({ machine: overIn.machine, material: enumOf(['metal', 'thermoplast', 'wood', 'glass', 'other'], 'The material’s category.'), thickness: num('mm', { minimum: 0, maximum: 300 }) }),
  readOnly: true,
  headless: true,
  run: async ({ machine = 'laser', material = 'other', thickness = 0 }) => {
    const stuff = stuffOf(material)
    return { machine, material: stuff, thickness, ...cutRules(machine, stuff, thickness), ...(unsuited(machine, stuff, thickness) ? { unsuited: unsuited(machine, stuff, thickness) } : {}) }
  },
}

export const cutCommands = awaitingMaterials([check, exportFile, rules] as Command<never>[])
