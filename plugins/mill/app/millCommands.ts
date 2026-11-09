// SPDX-License-Identifier: AGPL-3.0-only
// mill.*: a part judged for basic CNC milling, and handed over for it — no
// toolpaths. The body is read through Reverse Engineer's commands, run by
// name, never imported: its faces and edges (reverse.body.describe), each
// face's triangles (reverse.body.face_triangles), the file
// (reverse.export.step); the wall alone through dfm.wall where the build
// has it. Figures from the input, else the body's mill setup, else the
// defaults. Every command runs headless.

import { runCommand } from '../../../src/commands/registry'
import { arr, enumOf, num, obj, oneOf, str } from '../../../src/commands/schema'
import { readStateSection } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { materialOfBody } from '../../_shared/materials/assigned'
import { bodyKeyOf, setupFor, setupsOf, type Setup } from '../../_shared/setups'
import { zip } from '../../_shared/zip'
import { boxOfTris, checkMill, directionOf, directionWord, minWallFor, stockOf, type EdgeIn, type FaceIn, type Finding, type Tris, type V3 } from '../core/reach'
import { setupSheet } from '../core/sheet'
import { AXES, MILL_DEFAULTS } from '../core/defaults'

type Json = Record<string, unknown>

const invalid = (m: string): never => {
  throw new CommandError('invalid_input', m)
}
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

interface Body {
  id: number
  name: string
  visible?: boolean
  surface?: boolean
}

function bodies(): Body[] {
  const r = readStateSection('reverse') as { bodies?: Body[] } | undefined
  if (!r) throw new CommandError('unavailable', 'Reading a part for milling needs the Reverse engineer workspace, and this build has none.')
  return r.bodies ?? []
}

function bodyNamed(ref: string | number): Body {
  const all = bodies()
  const b = all.find((x) => x.id === ref || x.name === ref) ?? all.find((x) => typeof ref === 'string' && x.name.toLowerCase() === ref.toLowerCase())
  if (!b) throw new CommandError('not_found', `No body "${ref}" — there are ${all.filter((x) => !x.surface).map((x) => x.name).join(', ') || 'none'}.`)
  if (b.surface) invalid(`${b.name} is a surface, not a part.`)
  return b
}

function onlyBody(): Body {
  const solids = bodies().filter((b) => !b.surface)
  const shown = solids.filter((b) => b.visible !== false)
  if (shown.length === 1) return shown[0]
  if (solids.length === 1) return solids[0]
  if (!solids.length) throw new CommandError('invalid_state', 'There is no solid body to check — build one in Reverse engineer first.')
  return invalid(`Say which body: ${solids.map((x) => x.name).join(', ')}.`)
}

interface Over {
  axes?: '3' | '3+2'
  directions?: unknown[]
  minTool?: number
  reach?: number
  margin?: number
  stock?: V3
}

/** The figures a check goes by, and which were defaults. */
function figuresFor(setup: Setup | null, over: Over) {
  const defaulted: string[] = []
  const take = <T,>(given: T | undefined, held: unknown, ok: (v: unknown) => boolean, dflt: T, key: string): T => {
    if (given !== undefined) return given
    if (ok(held)) return held as T
    defaulted.push(key)
    return dflt
  }
  const axes = take(over.axes, setup?.axes, (v) => (AXES as readonly unknown[]).includes(v), MILL_DEFAULTS.axes as '3' | '3+2', 'axes')
  const dirsIn = take(over.directions, setup?.directions, (v) => Array.isArray(v) && v.length > 0, [...MILL_DEFAULTS.directions] as unknown[], 'directions')
  const directions = dirsIn.map((d, i) => directionOf(d) ?? invalid(`directions[${i}]: "+z", "-x" … or [x, y, z] of some length.`))
  const minTool = take(over.minTool, setup?.minTool, isNum, MILL_DEFAULTS.minTool as number, 'minTool')
  const reach = take(over.reach, setup?.reach, isNum, MILL_DEFAULTS.reach as number, 'reach')
  const stockSize = over.stock ?? (Array.isArray(setup?.stock) ? (setup!.stock as V3) : undefined)
  const margin = stockSize ? undefined : take(over.margin, setup?.margin, isNum, MILL_DEFAULTS.margin as number, 'margin')
  const grade = Number.isInteger(setup?.grade) ? (setup!.grade as number) : MILL_DEFAULTS.grade
  return { axes, directions, minTool, reach, stockSize, margin, grade, defaulted }
}

/** The body's faces, edges and each face's triangles. */
async function readBody(b: Body): Promise<{ faces: FaceIn[]; edges: EdgeIn[]; tris: Map<number, Tris> }> {
  const d = (await runCommand('reverse.body.describe', { body: b.id })) as { bodies?: { faceList?: FaceIn[]; edgeList?: EdgeIn[] }[] }
  const faces = d.bodies?.[0]?.faceList ?? []
  const edges = d.bodies?.[0]?.edgeList ?? []
  const tris = new Map<number, Tris>()
  for (const f of faces) {
    const t = (await runCommand('reverse.body.face_triangles', { body: b.id, faces: [f.index] })) as { triangles?: Float32Array | number[] }
    if (t.triangles) tris.set(f.index, t.triangles)
  }
  return { faces, edges, tris }
}

export interface MillRead {
  body: string
  setup: string | null
  material: { id: string; name: string; category: string } | null
  axes: string
  directions: (string | number[])[]
  tool: { minDiameter: number; reach: number }
  grade: number
  stock: { size: V3; min: V3; max: V3; fits: boolean; margin?: number; given?: boolean }
  part: { min: V3; max: V3; size: V3 }
  wall: { least: number | null; min: number; at?: number[] } | null
  machining: Json | null
  defaulted?: string[]
  findings: Finding[]
  errors: number
  warnings: number
}

/** The whole check of one body: what mill.check answers. */
export async function millRead(b: Body, over: Over = {}): Promise<MillRead> {
  const setup = setupFor(b.id, 'mill')
  const f = figuresFor(setup, over)
  const { faces, edges, tris } = await readBody(b)
  if (!faces.length) throw new CommandError('failed', `${b.name} gave no faces to read.`)
  const { findings } = checkMill(faces, edges, tris, f.directions, { minDiameter: f.minTool, reach: f.reach })
  const box = boxOfTris(tris)
  const stock = stockOf(box, f.stockSize ? { size: f.stockSize } : { margin: f.margin })
  if (!stock.fits) findings.unshift({ severity: 'error', rule: 'stock', says: `the part (${box.max.map((x, k) => Math.round((x - box.min[k]) * 1000) / 1000).join(' × ')}) does not fit the stock (${stock.size.join(' × ')})` })
  if (f.axes === '3' && f.directions.length > 1) findings.push({ severity: 'info', rule: 'setups', says: `${f.directions.length} directions on a 3-axis machine: the part is refixtured ${f.directions.length - 1} time${f.directions.length === 2 ? '' : 's'} — keep a datum face for each` })
  const m = materialOfBody(bodyKeyOf(b))
  if (!m) findings.push({ severity: 'info', rule: 'material', says: 'no material set on the part (material.set): the least wall taken as 1' })
  else if (m.category === 'glass') findings.push({ severity: 'error', rule: 'material', says: `${m.name} is not milled: grind or waterjet it` })
  // The wall, where the build reads it.
  const minWall = minWallFor(m?.category)
  let wall: MillRead['wall'] = null
  try {
    const w = (await runCommand('dfm.wall', { body: b.id, min: minWall })) as { least?: number | null; at?: number[] }
    wall = { least: w.least ?? null, min: minWall, ...(w.at ? { at: w.at } : {}) }
    if (isNum(w.least) && w.least < minWall) findings.push({ severity: 'warning', rule: 'thin-wall', says: `a wall ${w.least} thick, under ${minWall} for ${m ? m.name : 'an unset material'}: it chatters and bends under the cutter`, ...(w.at ? { at: w.at as V3 } : {}) })
  } catch (e) {
    findings.push({ severity: 'info', rule: 'thin-wall', says: `the wall was not read: ${e instanceof Error ? e.message : String(e)}` })
  }
  const sev = (s: string) => findings.filter((x) => x.severity === s).length
  return {
    body: b.name,
    setup: setup ? `${setup.name} (${setup.id})` : null,
    material: m ? { id: m.id, name: m.name, category: m.category } : null,
    axes: f.axes,
    directions: f.directions.map((d) => {
      const w = directionWord(d)
      return w.startsWith('[') ? (JSON.parse(w) as number[]) : w
    }),
    tool: { minDiameter: f.minTool, reach: f.reach },
    grade: f.grade,
    stock: { ...stock, ...(f.stockSize ? { given: true } : { margin: f.margin }) },
    part: { min: box.min, max: box.max, size: box.max.map((x, k) => Math.round((x - box.min[k]) * 1000) / 1000) as V3 },
    wall,
    machining: m?.machining ? (m.machining as Json) : null,
    ...(f.defaulted.length ? { defaulted: f.defaulted } : {}),
    findings,
    errors: sev('error'),
    warnings: sev('warning'),
  }
}

const bodyIn = oneOf([str(undefined, { minLength: 1 }), num()], 'The body, by name or Reverse Engineer id.')
const overIn = {
  axes: enumOf(AXES, 'Over the setup’s: "3" or "3+2".'),
  directions: arr(oneOf([enumOf(['+z', '-z', '+x', '-x', '+y', '-y']), arr(num(), undefined, { minItems: 3, maxItems: 3 })]), 'Tool directions over the setup’s: "+z", "-z" … or [x, y, z].', { minItems: 1, maxItems: 6 }),
  minTool: num('The least end mill’s diameter, mm, over the setup’s.', { exclusiveMinimum: 0 }),
  reach: num('How far the longest tool reaches below the part’s top, mm, over the setup’s.', { exclusiveMinimum: 0 }),
  margin: num('Stock margin each side, mm, over the setup’s.', { minimum: 0 }),
  stock: arr(num(undefined, { exclusiveMinimum: 0 }), 'The stock’s size [x, y, z], mm, over the setup’s.', { minItems: 3, maxItems: 3 }),
}

const check: Command<{ body?: string | number } & Over> = {
  name: 'check',
  title: 'Check a part for CNC milling',
  description:
    'Judge a Reverse Engineer body for basic CNC milling (no toolpaths) by its mill setup’s figures (setup.of), each over-ridable here: faces not reached from any tool direction — turned away, or under material along it — are undercuts (errors; the underside standing on the stock is said, not judged); square inside corners along a tool direction, and inside rounds under the least tool’s radius (an end mill leaves its radius); holes under the least tool (drill them) or over about 4 diameters deep; floors narrower than the least tool, or deeper than about 4 times their width; faces deeper than the tool reaches; the stock (the part’s box with a margin, or a size given) and whether the part fits it; the wall against the least for the material (dfm.wall, where the build has it). Directions: "+z" (from above, the default), "-z" (flipped), … or [x, y, z]; on a 3-axis machine several directions are several fixturings. Answers body, setup, material (and its cutting data, machining), axes, directions, tool, grade (the IT grade Fits sizes with), stock, part box, wall, defaulted (the figures not set), findings (severity, rule, says, at), errors, warnings. Approximate: read off the faces’ triangles. Changes nothing.',
  input: obj({ body: bodyIn, ...overIn }),
  readOnly: true,
  headless: true,
  long: true,
  timeoutMs: 300_000,
  run: async ({ body, ...over }) => millRead(body !== undefined ? bodyNamed(body) : onlyBody(), over),
}

/** The bodies a hand-over is of: those named, else the setup's, else the
 *  mill setup the Make tab shows, else the only one. */
function bodiesFor(asked: (string | number)[] | undefined, setupRef: string | undefined): { list: Body[]; setup: Setup | null } {
  if (asked) return { list: asked.map(bodyNamed), setup: null }
  const all = setupsOf().filter((s) => s.type === 'mill')
  const sel = (readStateSection('setups') as { selected?: string | null } | undefined)?.selected
  const s = setupRef !== undefined ? all.find((x) => x.id === setupRef || x.name.toLowerCase() === setupRef.toLowerCase()) : (all.find((x) => x.id === sel) ?? (all.length === 1 ? all[0] : undefined))
  if (setupRef !== undefined && !s) throw new CommandError('not_found', `No mill setup "${setupRef}" — there are ${all.map((x) => `${x.id} ${x.name}`).join(', ') || 'none'}.`)
  if (!s) return invalid(all.length ? `Say which parts (bodies) or which mill setup (setup): ${all.map((x) => `${x.id} ${x.name}`).join(', ')}.` : 'Name the parts (bodies): there is no mill setup to take them from.')
  if (!s.bodies.length) invalid(`${s.name} (${s.id}) has no parts: setup.set { id: "${s.id}", add: [...] } first.`)
  return { list: s.bodies.map((k) => bodyNamed(/^\d+$/.test(k) ? Number(k) : k)), setup: s }
}

const stem = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'parts'

const exportFile: Command<{ bodies?: (string | number)[]; setup?: string }> = {
  name: 'export',
  title: 'The parts for the machinist: STEP and a setup sheet',
  description:
    'A zip for milling: the parts as one STEP file of solids (reverse.export.step) and a setup sheet as setup.json and setup.md — per part its material and cutting data, the machine’s axes, the tool directions, the stock (size and where), the least tool and the reach, the IT grade sizes hold, the wall, and the check’s findings (mill.check), with the setup’s note. bodies: by name or id; by default the mill setup named (setup), else the one the Make tab shows, else the only one. No toolpaths: those are the CAM’s. Answers the file’s bytes and name, the files in it, and each part’s errors and warnings. Changes nothing.',
  input: obj({ bodies: arr(bodyIn, 'The parts; a mill setup’s by default.', { minItems: 1 }), setup: str('The mill setup whose parts these are, by id or name.', { minLength: 1 }) }),
  readOnly: true,
  headless: true,
  long: true,
  returnsFile: true,
  timeoutMs: 600_000,
  run: async ({ bodies: asked, setup: setupRef }) => {
    const { list, setup } = bodiesFor(asked, setupRef)
    const reads: MillRead[] = []
    for (const b of list) reads.push(await millRead(b))
    const step = (await runCommand('reverse.export.step', { bodies: list.map((b) => b.id) })) as { file?: { name: string; bytes: Uint8Array } }
    if (!step?.file?.bytes) throw new CommandError('failed', 'The STEP export gave no file.')
    const name = stem(setup?.name ?? (list.length === 1 ? list[0].name : 'parts'))
    const sheet = setupSheet(reads, { title: setup ? `${setup.name} (${setup.id})` : list.map((b) => b.name).join(', '), note: typeof setup?.note === 'string' ? setup.note : undefined, step: `${name}.step` })
    const enc = new TextEncoder()
    const files = [
      { name: `${name}.step`, bytes: step.file.bytes },
      { name: 'setup.json', bytes: enc.encode(JSON.stringify(sheet.json, null, 2) + '\n') },
      { name: 'setup.md', bytes: enc.encode(sheet.markdown) },
    ]
    const errors = reads.reduce((s, r) => s + r.errors, 0)
    return {
      file: { name: `${name}-mill.zip`, mimeType: 'application/zip', bytes: zip(files) },
      files: files.map((f) => f.name),
      parts: reads.map((r) => ({ body: r.body, errors: r.errors, warnings: r.warnings })),
      status: `${list.length} part${list.length === 1 ? '' : 's'} for milling: STEP and a setup sheet${errors ? ` — ${errors} error${errors === 1 ? '' : 's'} on the sheet` : ''}.`,
    }
  },
}

export const millCommands = [check, exportFile] as Command<never>[]
