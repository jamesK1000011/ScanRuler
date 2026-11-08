// SPDX-License-Identifier: AGPL-3.0-only
// Electronics › Printed wiring's commands (printed.*): the conductors and
// the settings; a circuit planned on a Reverse Engineer body — traces in a
// conductive filament, or channels for copper — with what each net
// measures, changing nothing; two-point nets routed on a sheet; the plan
// made as features, one undo step; the nets checked at a current; a
// resistance worked out; and the part and its traces exported for a
// two-filament print.

import { runWithin } from '../../../src/commands/registry'
import { arr, bool, enumOf, int, num, obj, oneOf, str, type JsonSchema } from '../../../src/commands/schema'
import { readStateSections } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { zip } from '../../_shared/zip'
import { tidy, type V2, type V3 } from '../core/geometry'
import { awgDiameter, awgTable, customMaterial, loadOf, MATERIALS, materialOf, resistivityAlong, runResistance, sig, wireOhmPerM } from '../core/materials'
import { type Carrier, channelOf, channelTop, DEFAULT_SETTINGS, featuresOf, filamentOf, type Json, measure, type Method, type Net, type Pad, PlanError, type PlanSpec, type ProfileAt, type Settings, type Sheet } from '../core/plan'
import { type Keepout, MAX_GRID_CELLS, type Obstacle, routeAll } from '../core/router'
import { type Made, settingsOf, usePrinted } from '../state/printedStore'

type Ref = string | number
const st = () => usePrinted.getState()
const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0
const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const invalid = (m: string): never => {
  throw new CommandError('invalid_input', m)
}
const planned = <T>(f: () => T): T => {
  try {
    return f()
  } catch (e) {
    if (e instanceof PlanError) invalid(e.message)
    throw e
  }
}

// ---- Reverse Engineer --------------------------------------------------------------------

async function reverse(name: string, input: Json): Promise<Json> {
  try {
    return (await runWithin(`reverse.${name}`, input)) as Json
  } catch (e) {
    if (e instanceof CommandError && e.code === 'unknown_command') throw new CommandError('invalid_state', 'Reverse Engineer is not in this build: printed circuits are made in its bodies.')
    throw e
  }
}

interface ReBody {
  id: number
  name: string
  bounds?: { min: number[]; max: number[] } | null
}
const reState = () => (readStateSections().reverse as { bodies?: ReBody[]; features?: { name: string }[] } | undefined) ?? {}
const takenNames = () => new Set([...(reState().features ?? []).map((f) => f.name.toLowerCase()), ...(reState().bodies ?? []).map((b) => b.name.toLowerCase())])

interface FaceRow {
  index: number
  kind: string
  area?: number
  centroid: V3
  normal?: V3
  fingerprint?: Json
}

async function bodyName(body: Ref): Promise<string> {
  const r = (await reverse('body.describe', { body, edges: false, limit: 1 })) as { bodies?: { name: string }[] }
  return r.bodies?.[0]?.name ?? invalid(`There is no body ${JSON.stringify(body)}.`)
}

async function flatFace(body: Ref, face: number | Json): Promise<{ body: string; face: FaceRow }> {
  const r = (await reverse('body.describe', { body, edges: false, fingerprints: true, ...(typeof face === 'number' ? {} : { where: face }) })) as { bodies?: { name: string; faceList: FaceRow[] }[] }
  const b = r.bodies?.[0] ?? invalid(`There is no body ${JSON.stringify(body)}.`)
  const faces = typeof face === 'number' ? b.faceList.filter((f) => f.index === face) : b.faceList
  if (faces.length === 0) throw new CommandError('not_found', typeof face === 'number' ? `${b.name} has no face ${face} (reverse.body.describe lists them).` : `No face of ${b.name} answers that query.`)
  if (faces.length > 1) invalid(`${faces.length} faces of ${b.name} answer that query: narrow it, or give the face's index.`)
  const f = faces[0]
  if (f.kind !== 'plane' || !f.normal || !f.fingerprint) invalid(`Face ${f.index} of ${b.name} is a ${f.kind}: runs are drawn on a flat face.`)
  return { body: b.name, face: f }
}

interface Described {
  normal: V3
  basisU: V3
  basisV: V3
  point: { at: V2; above: number }
}
const describe = async (plane: Json, point: V3) => (await reverse('plane.describe', { plane, point })) as unknown as Described

/** The sheet: a flat face of the body (into the part against its normal)
 *  or a plane given (into it against the normal unless into: 1). */
type FaceAt = { index: number; centroid: V3; normal: V3; area?: number }
async function sheetOf(body: Ref, on: OnIn): Promise<{ sheet: Sheet; face?: FaceAt }> {
  let plane: Json
  let into: 1 | -1 = -1
  let face: FaceAt | undefined
  if (on.face !== undefined) {
    if (on.plane !== undefined) invalid('on: a face or a plane, not both.')
    const f = await flatFace(body, on.face)
    plane = { kind: 'bodyFace', body, face: f.face.fingerprint }
    face = { index: f.face.index, centroid: f.face.centroid, normal: f.face.normal!, ...(f.face.area ? { area: f.face.area } : {}) }
    if (on.into !== undefined) invalid('on.into: a face’s runs go into the part — leave it out.')
  } else if (on.plane !== undefined) {
    plane = typeof on.plane === 'string' ? planeByName(on.plane) : on.plane
    into = on.into === 1 ? 1 : -1
  } else return invalid('on: { face } (a flat face of the body) or { plane, into? }.')
  const d = await describe(plane, [0, 0, 0])
  const origin = [0, 1, 2].map((k) => -d.point.at[0] * d.basisU[k] - d.point.at[1] * d.basisV[k] - d.point.above * d.normal[k]) as V3
  return { sheet: { plane, origin, normal: d.normal, basisU: d.basisU, basisV: d.basisV, into }, ...(face ? { face } : {}) }
}

function planeByName(n: string): Json {
  const k = n.trim().toLowerCase().replace(/ plane$/, '')
  const axis = k === 'xy' ? 'z' : k === 'yz' ? 'x' : k === 'xz' || k === 'zx' ? 'y' : invalid(`on.plane "${n}": XY, YZ or XZ — or a plane as reverse.feature.add takes one.`)
  return { kind: 'world', axis, offset: 0 }
}

/** A 3D route's profile plane: square to its first straight (or its
 *  last, run backwards) through its end — a coordinate plane, or a plane
 *  through a coordinate axis the straight lies square to. */
async function profileFor(net: string, path: V3[]): Promise<ProfileAt> {
  const tryEnd = async (p0: V3, p1: V3, reversed: boolean): Promise<ProfileAt | null> => {
    const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
    const d = [0, 1, 2].map((k) => (p1[k] - p0[k]) / l) as V3
    const AX = ['x', 'y', 'z'] as const
    const along = [0, 1, 2].find((k) => Math.abs(Math.abs(d[k]) - 1) < 1e-9)
    let plane: Json
    if (along !== undefined) plane = { kind: 'world', axis: AX[along], offset: r6(p0[along]) }
    else {
      const a = [0, 1, 2].find((k) => Math.abs(d[k]) < 1e-9)
      if (a === undefined) return null
      const axis = [0, 0, 0] as V3
      axis[a] = 1
      const base = (angleDeg: number, offset = 0): Json => ({ kind: 'radial', axis: { kind: 'world', axis: AX[a] }, angleDeg: r6(angleDeg), offset: r6(offset) })
      const n0 = (await describe(base(0), p0)).normal
      const c = [n0[1] * d[2] - n0[2] * d[1], n0[2] * d[0] - n0[0] * d[2], n0[0] * d[1] - n0[1] * d[0]]
      const angle = (Math.atan2(dot(c, axis), dot(n0, d)) * 180) / Math.PI
      const f = await describe(base(angle), p0)
      if (Math.abs(Math.abs(dot(f.normal, d)) - 1) > 1e-6) return null
      let off = f.point.above
      let g = await describe(base(angle, off), p0)
      if (Math.abs(g.point.above) > 1e-4) {
        off = -off
        g = await describe(base(angle, off), p0)
        if (Math.abs(g.point.above) > 1e-4) return null
      }
      plane = base(angle, off)
    }
    const g = await describe(plane, p0)
    if (Math.abs(g.point.above) > 1e-4) return null
    return { plane, at: g.point.at.map(r6) as V2, reversed }
  }
  const n = path.length
  return (await tryEnd(path[0], path[1], false)) ?? (await tryEnd(path[n - 1], path[n - 2], true)) ?? invalid(`${net}: its route starts and ends on straights that run along no coordinate plane — make its first or last straight lie square to X, Y or Z (one coordinate unchanged along it).`)
}

// ---- input ---------------------------------------------------------------------------------

type PtIn = number[] | { x: number; y: number; z?: number; width?: number }
interface PadIn {
  at: PtIn
  shape?: 'round' | 'square'
  size?: number
  hole?: number
  holeDepth?: number
}
interface NetIn {
  name: string
  width?: number
  points?: PtIn[]
  path?: PtIn[]
  pads?: PadIn[]
  vias?: { at: PtIn; to: number; diameter?: number }[]
}
interface OnIn {
  face?: number | Json
  plane?: string | Json
  into?: 1 | -1
}
interface PlanIn {
  method?: Method
  body: Ref
  on?: OnIn
  name?: string
  depth?: number
  thickness?: number
  width?: number
  carrier?: Carrier
  lay?: 'pause' | 'thread'
  bendRadius?: number
  nets: NetIn[]
  keepouts?: Keepout[]
}
interface RouteIn extends PlanIn {
  grid?: number
  bounds?: [number, number, number, number]
  margin?: number
  turnCost?: number
}

/** Loose on purpose: a nested oneOf per point would put the schema past
 *  an agent client's depth; toSheet and to3 check each one. */
const ptIn: JsonSchema = { description: 'A point, mm: [u, v] on the sheet, [x, y, z] in the part’s frame (taken onto the sheet), or { x, y } as a Circuit JSON route point.' }
const padIn = obj(
  {
    at: ptIn,
    shape: enumOf(['round', 'square'], 'round (default) or square (an SMD-style contact).'),
    size: num('Across, mm; 2× the run’s width by default.', { exclusiveMinimum: 0, maximum: 100 }),
    hole: num('A hole through it for a pin or wire, Ø mm.', { exclusiveMinimum: 0, maximum: 50 }),
    holeDepth: num('mm from the surface; through the run by default.', { exclusiveMinimum: 0 }),
  },
  ['at'],
  'A pad: a column of conductor from the run up to the surface (a channel: an opening for the wire).',
)
const netIn = obj(
  {
    name: str('Unique.', { minLength: 1 }),
    width: num('mm; the plan’s by default.', { exclusiveMinimum: 0, maximum: 100 }),
    points: arr(ptIn, 'The run on the sheet, in order.'),
    path: arr(ptIn, 'Or a 3D route, [x, y, z] in the part’s frame; its bends are rounded.'),
    pads: arr(padIn, 'Pads; at a run’s ends they count in its resistance. printed.route takes a net of two pads and no points.'),
    vias: arr(obj({ at: ptIn, to: num('The depth it reaches, mm; 0 the surface.'), diameter: num('mm; the run’s width by default.', { exclusiveMinimum: 0 }) }, ['at', 'to']), 'Columns from the run to another depth.'),
  },
  ['name'],
)
const onIn = obj(
  {
    face: oneOf([int('Its index in reverse.body.describe.', { minimum: 0 }), { type: 'object', description: 'A query, as reverse.body.describe takes where; one face must answer.' }], 'A flat face of the body: the runs go into the part from it.'),
    plane: oneOf([str('XY, YZ or XZ.'), { type: 'object', description: 'A plane as reverse.feature.add takes one.' }], 'Or a plane.'),
    into: enumOf([1, -1], 'With a plane: the way into the part along its normal (−1 by default).'),
  },
  [],
  'The sheet the runs are drawn on, in its [u, v].',
)
const carrierIn = oneOf(
  [
    obj({ kind: enumOf(['wire']), awg: int('Gauge (0000 is −3).', { minimum: -3, maximum: 40 }), diameter: num('Or the copper’s Ø, mm.', { exclusiveMinimum: 0 }), outer: num('Over the insulation, mm.', { exclusiveMinimum: 0 }) }, ['kind'], 'Copper wire.'),
    obj({ kind: enumOf(['tape']), width: num('mm', { exclusiveMinimum: 0 }), thickness: num('mm', { exclusiveMinimum: 0 }) }, ['kind', 'width', 'thickness'], 'Copper tape.'),
    obj({ kind: enumOf(['paint']), width: num('mm', { exclusiveMinimum: 0 }), thickness: num('Dried, mm (0.05).', { exclusiveMinimum: 0 }), sheetResistance: num('Ω per square at that thickness.', { exclusiveMinimum: 0 }), resistivity: num('Or Ω·cm.', { exclusiveMinimum: 0 }) }, ['kind'], 'Conductive paint or ink, in an open groove.'),
  ],
  'channel: what goes in it.',
)
const keepoutIn = oneOf([obj({ rect: arr(num(), '[u0, v0, u1, v1]', { minItems: 4, maxItems: 4 }) }, ['rect']), obj({ circle: arr(num(), '[u, v, r]', { minItems: 3, maxItems: 3 }) }, ['circle'])], 'On the sheet.')

const bodyRef = oneOf([num('The body’s id.'), str('Its name.', { minLength: 1 })], 'A Reverse Engineer body, by id or name.')
const planFields: Record<string, JsonSchema> = {
  method: enumOf(['trace', 'channel'], 'trace (default): runs of conductive filament, a body of their own. channel: grooves or tunnels for copper.'),
  body: bodyRef,
  on: onIn,
  name: str('The features’ and the traces body’s name; "Traces" or "Channels", numbered.', { minLength: 1 }),
  depth: num('trace: its top under the surface, mm (0 flush, negative proud); channel: the roof over it (0 an open groove). The setting by default (channel: 0).', { minimum: -50, maximum: 100 }),
  thickness: num('trace: mm (the setting); channel: its height, the carrier’s with clearance by default.', { exclusiveMinimum: 0, maximum: 50 }),
  width: num('Each net’s width unless it gives one, mm (trace: the setting; channel: the carrier’s with clearance).', { exclusiveMinimum: 0, maximum: 100 }),
  carrier: carrierIn,
  lay: enumOf(['pause', 'thread'], 'A closed channel: pause (default; level only — the print pauses at its roof to lay the wire) or thread (pulled through after).'),
  bendRadius: num('A 3D route’s bends, mm (the run’s larger side).', { exclusiveMinimum: 0 }),
  nets: arr(netIn, 'The nets.', { minItems: 1, maxItems: 200 }),
  keepouts: arr(keepoutIn, 'printed.route keeps out of these.'),
}

/** Points to the sheet: [u, v] as they are; [x, y, z] and { x, y, z } taken
 *  square onto it; { x, y } as [u, v]. */
const isPt = (p: unknown): p is PtIn => (Array.isArray(p) && (p.length === 2 || p.length === 3) && p.every((x) => typeof x === 'number')) || (!!p && typeof p === 'object' && !Array.isArray(p) && typeof (p as Json).x === 'number' && typeof (p as Json).y === 'number' && ((p as Json).z === undefined || typeof (p as Json).z === 'number'))

async function toSheet(p: PtIn, sheet: Sheet | null, what: string): Promise<V2> {
  if (!isPt(p)) invalid(`${what}: [u, v], [x, y, z] or { x, y, z? }.`)
  const xyz = Array.isArray(p) ? (p.length === 3 ? (p as V3) : null) : p.z !== undefined ? ([p.x, p.y, p.z] as V3) : null
  const uv = Array.isArray(p) ? (p.length === 2 ? (p as V2) : null) : p.z === undefined ? ([p.x, p.y] as V2) : null
  for (const x of xyz ?? uv ?? []) if (!Number.isFinite(x)) invalid(`${what}: a number.`)
  if (uv) return [uv[0], uv[1]]
  if (!sheet) return invalid(`${what}: a 3D point needs on, to take it onto the sheet.`)
  const d = xyz!.map((x, k) => x - sheet.origin[k])
  return [r6(dot(d, sheet.basisU)), r6(dot(d, sheet.basisV))]
}

const to3 = (p: PtIn, what: string): V3 => {
  if (!isPt(p)) invalid(`${what}: [x, y, z] in the part’s frame.`)
  const v = Array.isArray(p) ? (p.length === 3 ? (p as V3) : null) : p.z !== undefined ? ([p.x, p.y, p.z] as V3) : null
  if (!v || !v.every(Number.isFinite)) return invalid(`${what}: [x, y, z] in the part’s frame.`)
  return v
}

interface Resolved {
  spec: PlanSpec
  sheet: Sheet | null
  face?: FaceAt
  profiles: Record<string, ProfileAt>
  keepouts: Keepout[]
  /** Nets with two pads and no points, for the router. */
  open: string[]
}

async function resolve(a: PlanIn, opts: { routing?: boolean } = {}): Promise<Resolved> {
  const S = settingsOf(st())
  const method: Method = a.method ?? 'trace'
  const names = new Set<string>()
  for (const n of a.nets) {
    const k = n.name.trim()
    if (!k) invalid('A net’s name: not blank.')
    if (k.length > 60) invalid(`${k.slice(0, 20)}…: a net’s name, 60 characters at most.`)
    if (names.has(k.toLowerCase())) invalid(`Two nets are named "${k}".`)
    names.add(k.toLowerCase())
  }
  if (method === 'trace' && a.carrier) invalid('carrier: a channel’s — the trace method prints the run in the conductive filament (printed.set material).')
  if (method === 'trace' && a.lay) invalid('lay: a channel’s.')
  if (a.name !== undefined && (!a.name.trim() || a.name.trim().length > 60)) invalid('name: 1 to 60 characters.')
  const body = await bodyName(a.body)
  const needSheet = a.nets.some((n) => n.points || n.pads?.length || n.vias?.length || (!n.path && opts.routing))
  const placed = a.on ? await sheetOf(a.body, a.on) : null
  if (needSheet && !placed) invalid('on: the face or plane the runs, pads and vias are drawn on.')
  const sheet = placed?.sheet ?? null
  const depth = a.depth ?? (method === 'trace' ? S.depth : 0)
  const ch = method === 'channel' ? planned(() => channelOf(a.carrier, S, { width: a.width, thickness: a.thickness })) : null
  const nets: Net[] = []
  const open: string[] = []
  const profiles: Record<string, ProfileAt> = {}
  for (const n of a.nets) {
    const name = n.name.trim()
    const firstW = !Array.isArray(n.points?.[0]) ? (n.points?.[0] as { width?: number } | undefined)?.width : undefined
    const width = method === 'channel' ? ch!.width : (n.width ?? firstW ?? a.width ?? S.width)
    if (method === 'channel' && n.width !== undefined) invalid(`${name}: width — a channel’s is the carrier’s (or the plan’s width).`)
    if (!(width > 0 && width <= 100)) invalid(`${name}: width more than 0, 100 at most.`)
    if (n.points && n.path) invalid(`${name}: points (on the sheet) or path (3D), not both.`)
    const pads: Pad[] = []
    for (const p of n.pads ?? []) {
      const size = p.size ?? (method === 'channel' ? width : 2 * width)
      if (p.hole !== undefined && p.hole >= size) invalid(`${name}: a pad’s hole (${p.hole}) is as wide as the pad (${size}).`)
      if (method === 'channel' && p.shape === 'square') invalid(`${name}: a channel’s pad is the wire’s way out: round.`)
      pads.push({ at: await toSheet(p.at, sheet, `${name} pad`), shape: p.shape ?? 'round', size, ...(p.hole !== undefined ? { hole: p.hole } : {}), ...(p.holeDepth !== undefined ? { holeDepth: p.holeDepth } : {}) })
    }
    const vias = []
    for (const v of n.vias ?? []) vias.push({ at: await toSheet(v.at, sheet, `${name} via`), to: v.to, diameter: v.diameter ?? width })
    const net: Net = { name, width, pads, vias }
    if (n.points) {
      // Repeated points and corners that don't turn taken out.
      net.points = tidy(await Promise.all(n.points.map((p) => toSheet(p, sheet, `${name} point`))))
      if (net.points.length < 2) invalid(`${name}: its points are all at one place.`)
    } else if (n.path) {
      net.path = tidy(n.path.map((p) => to3(p, `${name} path`)))
      if (net.path.length < 2) invalid(`${name}: its route’s points are all at one place.`)
      if (pads.length || vias.length) invalid(`${name}: pads and vias are on a sheet’s runs; a 3D route ends where it ends.`)
      if (net.path.length >= 2) profiles[name] = await profileFor(name, net.path)
    } else if (opts.routing && pads.length === 2) open.push(name)
    else invalid(`${name}: give points or path${opts.routing ? ', or two pads to route between' : ' — or route it (printed.route)'}.`)
    nets.push(net)
  }
  const spec: PlanSpec = { method, body, name: '', depth, ...(a.thickness !== undefined ? { thickness: a.thickness } : {}), ...(method === 'channel' && a.width !== undefined ? { width: a.width } : {}), ...(a.carrier ? { carrier: a.carrier } : {}), ...(a.lay ? { lay: a.lay } : {}), ...(a.bendRadius !== undefined ? { bendRadius: a.bendRadius } : {}), nets }
  if (method === 'channel') {
    if (a.carrier?.kind === 'paint' && depth > 1e-9) invalid('Paint goes into an open groove: depth 0.')
    if (depth < 0) invalid('depth: a channel’s roof, 0 or more.')
  }
  for (const k of a.keepouts ?? []) {
    const v = 'rect' in k ? k.rect : 'circle' in k ? k.circle : null
    if (!v || !v.every(Number.isFinite) || ('circle' in k && !(k.circle[2] > 0))) invalid('keepouts: { rect: [u0, v0, u1, v1] } or { circle: [u, v, r] } with r more than 0.')
  }
  return { spec, sheet, ...(placed?.face ? { face: placed.face } : {}), profiles, keepouts: a.keepouts ?? [], open }
}

function nameFor(a: PlanIn, method: Method): string {
  const taken = takenNames()
  const given = a.name?.trim()
  const base = given ?? (method === 'trace' ? 'Traces' : 'Channels')
  const free = (n: string) => ![n, `${n} sketch`, `${n} cut`, `${n} pads`, `${n} channels`].some((x) => taken.has(x.toLowerCase()))
  if (free(base) && (given || !taken.has(base.toLowerCase()))) return base
  for (let k = 2; ; k++) if (free(`${base} ${k}`)) return `${base} ${k}`
}

/** A body's lowest and highest Z, from Reverse Engineer. */
function zRange(body: string): [number, number] | null {
  const b = (reState().bodies ?? []).find((x) => x.name === body)?.bounds
  const lo = b?.min?.[2], hi = b?.max?.[2]
  return typeof lo === 'number' && typeof hi === 'number' ? [lo, hi] : null
}

/** The plan, placed and measured, with its features. */
async function planOf(a: PlanIn, r?: Resolved) {
  const R = r ?? (await resolve(a))
  const S = settingsOf(st())
  const name = nameFor(a, R.spec.method)
  const spec = { ...R.spec, name }
  const m = planned(() => measure(spec, R.sheet, S))
  const built = planned(() => featuresOf(spec, R.sheet, S, R.profiles))
  const notes = [...m.notes]
  const warnings = [...m.warnings, ...m.nets.flatMap((n) => n.warnings.map((w) => `${n.name}: ${w}`))]
  // On a level sheet: the run inside the part's height, not out its far side.
  const range0 = zRange(spec.body)
  if (R.sheet && range0 && Math.abs(Math.abs(R.sheet.normal[2]) - 1) < 1e-6 && spec.nets.some((n) => n.points)) {
    const t = m.nets[0]?.thickness ?? 0
    const z = (d: number) => R.sheet!.origin[2] + R.sheet!.into * d * R.sheet!.normal[2]
    const lo = Math.min(z(spec.depth), z(spec.depth + t)), hi = Math.max(z(spec.depth), z(spec.depth + t))
    const inward = R.sheet.into * R.sheet.normal[2] < 0 ? lo : hi
    if (inward < range0[0] - 1e-6 || inward > range0[1] + 1e-6) invalid(`The runs reach Z ${r3(inward)}, out the far side of ${spec.body} (Z ${r3(range0[0])} to ${r3(range0[1])}): make them shallower or thinner.`)
    const far = spec.method === 'trace' ? (R.sheet.into * R.sheet.normal[2] < 0 ? inward - range0[0] : range0[1] - inward) : Infinity
    if (spec.method === 'trace' && far < S.roofLayers * S.layerHeight - 1e-6) warnings.push(`Only ${r3(far)} of part beyond the traces on the far side, under ${S.roofLayers} layers: it may print open.`)
  }
  if (R.face && R.face.area) {
    const reach = Math.sqrt(R.face.area)
    const pts = spec.nets.flatMap((n) => [...(n.points ?? []), ...n.pads.map((p) => p.at)])
    const c = R.face.centroid.map((x, k) => x - R.sheet!.origin[k])
    const cu = dot(c, R.sheet!.basisU), cv = dot(c, R.sheet!.basisV)
    const off = pts.filter((p) => Math.hypot(p[0] - cu, p[1] - cv) > reach)
    if (off.length) warnings.push(`${off.length} point${off.length === 1 ? ' lies' : 's lie'} far from face ${R.face.index}’s centre (more than ${r3(reach)}): check the runs land on the face.`)
  }
  let pauseTop: number | null | undefined
  if (spec.method === 'channel' && spec.depth > 1e-9) {
    const ch = planned(() => channelOf(spec.carrier, S, { width: spec.width, thickness: spec.thickness }))
    const lay = spec.lay ?? 'pause'
    if (lay === 'pause') {
      const tops: number[] = []
      for (const n of spec.nets) {
        if (n.path) {
          const z = n.path.map((p) => p[2])
          if (Math.max(...z) - Math.min(...z) > 1e-6) invalid(`${n.name}: a closed channel laid at a pause has to run level — this route climbs ${r3(Math.max(...z) - Math.min(...z))}. Give lay: "thread" to pull the wire through after, or keep it level.`)
          tops.push(z[0] + ch.height / 2)
        }
      }
      if (spec.nets.some((n) => n.points || n.vias.length)) {
        const t = channelTop(R.sheet!, spec.depth, ch.height)
        if (t === null) invalid('A closed channel laid at a pause has to run level: draw it on a face or plane that faces up or down — or give lay: "thread" to pull the wire through after.')
        if (spec.nets.some((n) => n.vias.length)) invalid('A closed channel laid at a pause has no vias: the wire is laid on one level.')
        tops.push(t!)
      }
      if (Math.max(...tops) - Math.min(...tops) > 1e-6) invalid('The closed channels lie at different heights: plan each height on its own, one pause each.')
      pauseTop = r6(tops[0])
      const range = zRange(spec.body)
      if (range && pauseTop >= range[1] - 1e-6) invalid(`The channel’s top (Z ${r3(pauseTop)}) is at or over ${spec.body}’s top (Z ${r3(range[1])}): it can’t be closed over.`)
      if (range && pauseTop - ch.height <= range[0] + 1e-6) invalid(`The channel (Z ${r3(pauseTop - ch.height)} to ${r3(pauseTop)}) breaks out under ${spec.body} (its bottom is at Z ${r3(range[0])}).`)
      notes.push(`Closed under ${r3(spec.depth)}: the print pauses at the channel’s top (Z ${r3(pauseTop)}) to lay the wire, then roofs it over. printed.apply records it for hw.pauses.`)
      if (ch.width > 10) warnings.push(`The roof spans ${r3(ch.width)} over the channel: print it as a bridge.`)
    } else {
      notes.push('Threaded after printing: keep the bends easy and the run short enough to push or pull the wire through; leave the ends open with pads.')
      if (!spec.nets.every((n) => n.pads.length >= 2 || n.path)) warnings.push('A threaded channel needs a way in and out: give pads at both ends.')
    }
  }
  if (spec.method === 'channel' && spec.depth <= 1e-9 && spec.lay) invalid('lay: a closed channel’s (depth more than 0).')
  if (spec.method === 'trace') notes.push(`Print the traces body in ${filamentOf(S).name} and the part in your usual filament: printed.export gives the two.`)
  return { spec, sheet: R.sheet, face: R.face, measured: m, built, notes, warnings, pauseTop }
}

function keep(a: PlanIn, p: Awaited<ReturnType<typeof planOf>>) {
  usePrinted.setState({ plan: { input: JSON.parse(JSON.stringify(a)) as Record<string, unknown>, method: p.spec.method, body: p.spec.body, name: p.spec.name, nets: p.measured.nets, warnings: p.warnings, notes: p.notes, features: p.built.features, ...(p.pauseTop !== undefined ? { pauseTop: p.pauseTop } : {}), ...(p.face ? { face: p.face } : {}) } })
}

const answer = (p: Awaited<ReturnType<typeof planOf>>) => ({
  method: p.spec.method,
  body: p.spec.body,
  name: p.spec.name,
  depth: p.spec.depth,
  nets: p.measured.nets,
  ...(p.pauseTop !== undefined && p.pauseTop !== null ? { pause: { top: p.pauseTop } } : {}),
  notes: p.notes,
  warnings: p.warnings,
  ...(p.sheet ? { frame: { normal: p.sheet.normal, basisU: p.sheet.basisU, basisV: p.sheet.basisV, into: p.sheet.into } } : {}),
  features: p.built.features,
})

// ---- the commands --------------------------------------------------------------------------

export function describePrinted() {
  const s = st()
  return {
    settings: settingsOf(s),
    ...(s.plan ? { plan: { method: s.plan.method, body: s.plan.body, name: s.plan.name, nets: s.plan.nets.map((n) => ({ name: n.name, length: n.length, resistance: n.resistance })), warnings: s.plan.warnings, ...(s.plan.stale ? { stale: 'the settings changed since: printed.apply plans it again with them' } : {}) } } : {}),
    ...(s.made.length ? { made: s.made } : {}),
  }
}

const list: Command<Record<string, never>> = {
  name: 'list',
  title: 'Conductors and settings',
  description: 'The conductive filaments with their resistivity along and through the layers (Ω·cm, typical, from the makers), copper wire AWG 10–30 (diameter, area and Ω/m worked out from the gauge and copper’s resistivity), and the settings. Changes nothing.',
  input: obj({}),
  readOnly: true,
  run: async () => {
    const s = settingsOf(st())
    return { materials: [...MATERIALS, ...(s.material === 'custom' ? [customMaterial(s.along, s.through ?? undefined)] : [])], copper: { ohmM: s.copper, awg: awgTable(10, 30, s.copper) }, settings: s }
  },
}

type SetIn = Partial<Settings> & { reset?: boolean }

const set: Command<SetIn> = {
  name: 'set',
  title: 'Circuit settings',
  description: 'material (protopasta, electrifi or custom — along and through in Ω·cm for custom; through null for the same), nozzle (0.4) and layerHeight (0.2), clearance (1, conductor edge to edge), the default trace width (2), thickness (0.6) and depth (0, flush), current (A, 0.01) and heatWarn (W per metre of run, 1) for the checks, copper (Ω·m, 1.68e-8), wireClearance (0.3), tapeClearance (0.2), roofLayers (3). reset: true for the defaults. Saved with the project.',
  input: obj({
    material: enumOf([...MATERIALS.map((m) => m.id), 'custom']),
    along: num('custom: Ω·cm along the layers.', { exclusiveMinimum: 0 }),
    through: oneOf([num('', { exclusiveMinimum: 0 }), { type: 'null' }], 'custom: Ω·cm through them.'),
    nozzle: num('mm', { minimum: 0.1, maximum: 2 }),
    layerHeight: num('mm', { minimum: 0.01, maximum: 2 }),
    clearance: num('mm', { minimum: 0, maximum: 50 }),
    width: num('mm', { minimum: 0.05, maximum: 100 }),
    thickness: num('mm', { minimum: 0.01, maximum: 50 }),
    depth: num('mm', { minimum: -50, maximum: 100 }),
    current: num('A', { minimum: 0, maximum: 1000 }),
    heatWarn: num('W/m', { minimum: 0 }),
    copper: num('Ω·m', { minimum: 1e-9, maximum: 1e-6 }),
    wireClearance: num('mm', { minimum: 0, maximum: 5 }),
    tapeClearance: num('mm', { minimum: 0, maximum: 5 }),
    roofLayers: int('', { minimum: 1, maximum: 50 }),
    reset: bool('Back to the defaults.'),
  }),
  history: false,
  run: async ({ reset, ...rest }) => {
    if (reset) st().set(settingsOf(DEFAULT_SETTINGS))
    else {
      if (Object.keys(rest).length === 0) invalid('Give a setting to change, or reset: true.')
      if ((rest.along !== undefined || rest.through !== undefined) && (rest.material ?? st().material) !== 'custom') invalid('along and through: the custom material’s — give material: "custom" with them.')
      st().set(rest)
    }
    const plan = st().plan
    if (plan) usePrinted.setState({ plan: { ...plan, stale: true } })
    return describePrinted()
  },
}

const plan: Command<PlanIn> = {
  name: 'plan',
  title: 'Plan a circuit',
  description: 'A circuit on a Reverse Engineer body, changing nothing. method trace: each net a run of conductive filament, its own body ("Traces") cut out of the part, with pads (columns to the surface for a wire, pin or contact; hole for a pin), vias to another depth, and 3D routes (path). method channel: the runs cut into the part for copper — carrier wire (awg or diameter), tape or paint — open (depth 0) or closed under a roof, laid at a pause or threaded. on: the face or plane the [u, v] points are on. Returns each net’s length, width, thickness, resistance (run and pad columns; along and through the layers), drop, power and heat at the current, the warnings (width and thickness for the nozzle and layers, cover, clearance), the pause for a closed channel, and the reverse.feature.add features. Kept for printed.apply.',
  input: obj(planFields, ['body', 'nets']),
  readOnly: true,
  run: async (a) => {
    const p = await planOf(a)
    keep(a, p)
    return answer(p)
  },
}

/** Everything already on the sheet, for the router. */
function obstaclesOf(nets: Net[], halfPad = true): Obstacle[] {
  const out: Obstacle[] = []
  for (const n of nets) {
    if (n.points) out.push({ net: n.name, points: n.points, width: n.width })
    for (const p of n.pads) out.push({ net: n.name, center: p.at, radius: halfPad && p.shape === 'square' ? (p.size / 2) * Math.SQRT2 : p.size / 2 })
  }
  return out
}

const route: Command<RouteIn> = {
  name: 'route',
  title: 'Route nets',
  description: 'As printed.plan, routing first each net given as two pads and no points: the shortest way on a grid with straights along the sheet’s axes and at 45°, a cost per bend, kept the clearance from keep-outs, the other nets’ pads and the runs already there; nets one at a time in order, each routed becoming an obstacle. grid (mm, 0.5), bounds [u0, v0, u1, v1] (the pads and points with margin round them, 5 by default). Two-point nets only; no rip-up. Returns routed (points, length), failed (net, why) and the plan of the rest; changes nothing.',
  input: obj({ ...planFields, grid: num('mm', { minimum: 0.05, maximum: 10 }), bounds: arr(num(), '[u0, v0, u1, v1] on the sheet.', { minItems: 4, maxItems: 4 }), margin: num('mm round the pads, for bounds.', { minimum: 0 }), turnCost: num('Per bend, in grid steps.', { minimum: 0, maximum: 20 }) }, ['body', 'nets']),
  readOnly: true,
  run: async (a) => {
    const R = await resolve(a, { routing: true })
    if (R.open.length === 0) invalid('No net to route: a net to route gives two pads and no points.')
    const S = settingsOf(st())
    const g = a.grid ?? 0.5
    const all: V2[] = R.spec.nets.flatMap((n) => [...(n.points ?? []), ...n.pads.map((p) => p.at)])
    for (const k of R.keepouts) {
      if ('rect' in k) all.push([k.rect[0], k.rect[1]], [k.rect[2], k.rect[3]])
      else all.push([k.circle[0] - k.circle[2], k.circle[1] - k.circle[2]], [k.circle[0] + k.circle[2], k.circle[1] + k.circle[2]])
    }
    const m = a.margin ?? 5
    const bounds = a.bounds ?? [Math.min(...all.map((p) => p[0])) - m, Math.min(...all.map((p) => p[1])) - m, Math.max(...all.map((p) => p[0])) + m, Math.max(...all.map((p) => p[1])) + m]
    if (!(bounds[2] > bounds[0] && bounds[3] > bounds[1])) invalid('bounds: [u0, v0, u1, v1] with u1 > u0 and v1 > v0.')
    const cells = Math.ceil((bounds[2] - bounds[0]) / g + 2) * Math.ceil((bounds[3] - bounds[1]) / g + 2)
    if (cells > MAX_GRID_CELLS) invalid(`The grid would be about ${cells} cells (most ${MAX_GRID_CELLS}): a coarser grid, or tighter bounds.`)
    const routedNets = R.spec.nets.filter((n) => !R.open.includes(n.name))
    const asks = R.open.map((name) => {
      const n = R.spec.nets.find((x) => x.name === name)!
      if (Math.hypot(n.pads[0].at[0] - n.pads[1].at[0], n.pads[0].at[1] - n.pads[1].at[1]) < 1e-6) invalid(`${name}: its two pads are at one place — nothing to route.`)
      return { net: name, from: n.pads[0].at, to: n.pads[1].at, width: n.width }
    })
    const pads = R.spec.nets.filter((n) => R.open.includes(n.name)).flatMap((n) => obstaclesOf([{ ...n, points: undefined }]))
    const { routed, failed } = routeAll(asks, { grid: g, clearance: S.clearance, bounds: bounds as [number, number, number, number], keepouts: R.keepouts, obstacles: [...obstaclesOf(routedNets), ...pads], ...(a.turnCost !== undefined ? { turnCost: a.turnCost } : {}) })
    // The plan of what is routed, as given: routed points filled in.
    const done = new Map(routed.map((r) => [r.net, r.points]))
    const input: PlanIn = { ...a, nets: a.nets.filter((n) => !R.open.includes(n.name.trim()) || done.has(n.name.trim())).map((n) => (done.has(n.name.trim()) ? { ...n, points: done.get(n.name.trim())! } : n)) }
    for (const k of ['grid', 'bounds', 'margin', 'turnCost'] as const) delete (input as unknown as Json)[k]
    const out = { routed: routed.map((r) => ({ net: r.net, points: r.points, length: sig(r.length) })), failed, grid: g, bounds }
    if (input.nets.length === 0) return { ...out, note: 'Nothing routed, so nothing planned.' }
    const R2 = await resolve(input)
    const p = await planOf(input, R2)
    keep(input, p)
    return { ...out, plan: answer(p) }
  },
}

/** A new circuit's id. */
const nextId = (have: Made[]) => `C${Math.max(0, ...have.map((m) => Number(/^C(\d+)$/.exec(m.id)?.[1] ?? 0))) + 1}`

const apply: Command<Partial<PlanIn>> = {
  name: 'apply',
  title: 'Make the circuit',
  description: 'Make what printed.plan or printed.route planned — or the plan given here, as printed.plan takes it — in Reverse Engineer, planned afresh from the body as it stands: sketches, then the runs (trace: a new body named after the plan, then cut out of the part by a Combine that keeps it; channel: cuts into the part), then the pads’ holes. One undo step; if any feature fails, none is kept. A closed channel laid at a pause is recorded with the Hardware workspace (hw.record), so hw.pauses and slicer_slice { pauses } stop there. Returns the features, the traces body and each net’s resistance.',
  input: obj(planFields),
  label: (a) => `make ${a.method === 'channel' ? 'channels' : 'traces'}`,
  run: async (a) => {
    const asked = a.nets !== undefined
    if (asked && a.body === undefined) invalid('Give body and nets — or nothing, to make the plan kept.')
    const kept0 = st().plan
    const args = (asked ? (a as PlanIn) : (kept0?.input as unknown as PlanIn | undefined)) ?? invalid('Plan it first (printed.plan or printed.route), or give the plan here.')
    usePrinted.setState({ busy: 'Making…' })
    try {
      const p = await planOf(args)
      const was = asked ? undefined : kept0?.face
      if (was && p.face && (Math.hypot(...p.face.centroid.map((x, i) => x - was.centroid[i])) > 1e-3 || dot(p.face.normal, was.normal) < 0.9999))
        throw new CommandError('invalid_state', `Face ${was.index} of ${p.spec.body} is not the face it was planned on any more (the body changed): plan it again.`)
      const r = (await reverse('feature.add', { features: p.built.features, detail: 'brief' })) as { added?: Json[]; stopped?: Json }
      const added = r.added ?? []
      const status = (x: Json) => ((x.result as Json | null)?.status ?? (x.feature as Json | undefined)?.status ?? x.status) as string | undefined
      const bad = added.findIndex((x) => status(x) === 'failed')
      const undo = async () => {
        const have = new Set((reState().features ?? []).map((f) => f.name.toLowerCase()))
        const stuck: string[] = []
        for (const n of [...p.built.names].reverse()) if (have.has(n.toLowerCase())) await reverse('feature.remove', { feature: n, detail: 'none' }).catch(() => stuck.push(n))
        return stuck
      }
      if (r.stopped || bad >= 0) {
        const why = r.stopped ? String((r.stopped as Json).message) : String(((added[bad].result as Json | null)?.message as string | undefined) ?? 'it failed to build')
        const stuck = await undo()
        throw new CommandError('failed', `${p.spec.name} could not be made: ${why}${r.stopped ? '' : ` (${p.built.names[bad]})`}. ${stuck.length ? `These could not be taken out again: ${stuck.join(', ')} — undo the step (history.undo).` : 'Nothing was kept.'}`)
      }
      const notes: string[] = []
      // The traces body named as the plan.
      if (p.built.traces) await reverse('body.set', { body: p.built.traces, name: p.built.traces }).catch(() => notes.push(`The traces body could not be named ${p.built.traces}: it keeps its Solid name.`))
      let pause: Made['pause']
      if (p.pauseTop !== undefined && p.pauseTop !== null) {
        const ch = channelOf(p.spec.carrier, settingsOf(st()), { width: p.spec.width, thickness: p.spec.thickness })
        const what = `${ch.conductor.label.replace(/ \(.*\)$/, '')} in ${p.spec.name}`.slice(0, 60)
        let recorded = false
        try {
          await runWithin('hw.record', { body: p.spec.body, top: p.pauseTop, what, span: r3(ch.width), roof: r3(p.spec.depth) })
          recorded = true
        } catch (e) {
          const range = zRange(p.spec.body)
          if (e instanceof CommandError && e.code === 'unknown_command') notes.push(`The Hardware workspace is not in this build: pause the print at ${range ? `${r3(p.pauseTop - range[0])} mm above the bed` : `Z ${p.pauseTop} (part frame)`} — slicer_slice { pauses: [{ z, note }] } — to lay the wire.`)
          else notes.push(`The pause was not recorded (${e instanceof Error ? e.message : String(e)}): record it with hw.record { body, top: ${p.pauseTop} }.`)
        }
        pause = { top: p.pauseTop, what, recorded }
        if (recorded) notes.push('Recorded for its pause: hw.pauses gives the layer, and the pauses for slicer_slice.')
      }
      const made: Made = { id: nextId(st().made), method: p.spec.method, body: p.spec.body, ...(p.built.traces ? { traces: p.built.traces, filament: filamentOf(settingsOf(st())).name } : {}), features: p.built.names, nets: p.measured.nets.map((n) => ({ name: n.name, resistance: n.resistance })), ...(pause ? { pause } : {}) }
      st().setMade([...st().made, made])
      keep(args, p)
      return { made, features: added.map((x) => ({ name: ((x.feature as Json | undefined)?.name ?? x.name) as string, status: status(x) ?? 'ok', ...((x.result as Json | null)?.warning ? { warning: (x.result as Json).warning } : {}) })), nets: p.measured.nets, warnings: p.warnings, notes: [...p.notes, ...notes], ...(made.traces ? { next: 'printed.export gives the part and the traces as separate files for a two-filament print.' } : {}) }
    } finally {
      usePrinted.setState({ busy: null })
    }
  },
}

const check: Command<{ current?: number }> = {
  name: 'check',
  title: 'Check the circuit',
  description: 'The plan kept, measured afresh at a current (A; the setting by default): each net’s resistance end to end, the drop, the power and power per metre, the current at which it reaches the heat warning, and the warnings — width and thickness for the nozzle and layers, cover, clearance between nets. Changes nothing.',
  input: obj({ current: num('A', { minimum: 0, maximum: 1000 }) }),
  readOnly: true,
  run: async ({ current }) => {
    const kept = st().plan ?? invalid('Nothing planned: printed.plan or printed.route first.')
    const R = await resolve(kept!.input as unknown as PlanIn)
    const S = settingsOf(st())
    const m = planned(() => measure({ ...R.spec, name: kept!.name }, R.sheet, S, current ?? S.current))
    const warnings = [...m.warnings, ...m.nets.flatMap((n) => n.warnings.map((w) => `${n.name}: ${w}`))]
    const out = { current: current ?? S.current, nets: m.nets, warnings }
    usePrinted.setState({ check: out })
    return { ...out, notes: m.notes }
  },
}

interface ResIn {
  conductor: string | Carrier
  length: number
  width?: number
  thickness?: number
  climb?: 'along' | 'through' | number
  current?: number
}

const resistance: Command<ResIn> = {
  name: 'resistance',
  title: 'Work out a resistance',
  description: 'A run’s resistance from its length and cross-section: conductor a filament (protopasta, electrifi, custom — the settings’ figures), or a carrier ({ kind: "wire", awg | diameter }, { kind: "tape", width, thickness }, { kind: "paint", … }). A filament run takes width and thickness, and climb: along (the layers, the default), through (them) or the Z part of its direction (0–1). With current (A): the drop, power and power per metre. Changes nothing.',
  input: obj({ conductor: oneOf([enumOf([...MATERIALS.map((m) => m.id), 'custom']), carrierIn], 'A filament, or a copper carrier.'), length: num('mm', { exclusiveMinimum: 0 }), width: num('mm', { exclusiveMinimum: 0 }), thickness: num('mm', { exclusiveMinimum: 0 }), climb: oneOf([enumOf(['along', 'through']), num('', { minimum: 0, maximum: 1 })], 'Which way it runs through the layers.'), current: num('A', { minimum: 0 }) }, ['conductor', 'length']),
  readOnly: true,
  run: async ({ conductor, length, width, thickness, climb, current }) => {
    const S = settingsOf(st())
    let rho: number
    let area: number
    let label: string
    if (typeof conductor === 'string') {
      const m = conductor === 'custom' ? customMaterial(S.along, S.through ?? undefined) : materialOf(conductor)!
      if (width === undefined || thickness === undefined) invalid('A filament run: width and thickness.')
      const dz = climb === 'through' ? 1 : climb === 'along' || climb === undefined ? 0 : climb
      rho = resistivityAlong(m, dz)
      area = width! * thickness!
      label = m.name
    } else {
      if (climb !== undefined) invalid('climb: a filament’s — copper conducts the same every way.')
      if (conductor.kind === 'wire') {
        if ((conductor.awg === undefined) === (conductor.diameter === undefined)) invalid('A wire’s awg or diameter, one.')
        const d = conductor.awg !== undefined ? awgDiameter(conductor.awg) : conductor.diameter!
        const perM = wireOhmPerM(d, S.copper)
        const R = (perM * length) / 1000
        return { conductor: conductor.awg !== undefined ? `AWG ${conductor.awg}` : `Ø${d}`, diameter: sig(d), ohmPerM: sig(perM), resistance: sig(R), ...(current !== undefined ? loadsOf(R, length, current) : {}) }
      }
      const ch = planned(() => channelOf(conductor, S, {}))
      rho = ch.conductor.along
      area = ch.conductor.area(width ?? ch.width, thickness ?? 0)
      label = ch.conductor.label
    }
    const R = runResistance(rho, length, area)
    return { conductor: label, resistivity: sig(rho), area: sig(area), resistance: sig(R), ohmPerM: sig(R / (length / 1000)), ...(current !== undefined ? loadsOf(R, length, current) : {}) }
  },
}

const loadsOf = (R: number, length: number, current: number) => {
  const l = loadOf({ resistance: R, length, current })
  return { current, volts: sig(l.volts), watts: sig(l.watts), wPerM: sig(l.wPerM) }
}

const exportCmd: Command<{ circuits?: string[] }> = {
  name: 'export',
  title: 'Export for two filaments',
  description: 'The parts and their traces bodies as named STLs in one zip, with filaments.txt saying which body takes which filament (the part its own, the traces the conductive one). The 3MF the app writes carries no filament per object, so the files go separately: load them together into the slicer as one object of several parts (they keep their places), then give each part its filament. circuits: ids from printed.apply (all by default). Returns the zip.',
  input: obj({ circuits: arr(str('C1, C2…'), 'Which circuits.', { minItems: 1 }) }),
  readOnly: true,
  long: true,
  returnsFile: true,
  timeoutMs: 600_000,
  run: async ({ circuits }) => {
    const all = st().made.filter((m) => m.traces)
    const pick = circuits ? circuits.map((id) => all.find((m) => m.id === id) ?? invalid(`No traces circuit "${id}" (${all.map((m) => m.id).join(', ') || 'none made'}).`)) : all
    if (pick.length === 0) invalid('No traces made yet: printed.apply a trace plan first. Channels need no second filament.')
    const bodies = new Set((reState().bodies ?? []).map((b) => b.name))
    const rows: { body: string; filament: string }[] = []
    for (const m of pick) {
      if (!rows.some((r) => r.body === m.body)) rows.push({ body: m.body, filament: 'filament 1 — the part’s own' })
      rows.push({ body: m.traces!, filament: `filament 2 — ${m.filament ?? 'the conductive filament'}` })
    }
    const missing = rows.filter((r) => bodies.size && !bodies.has(r.body))
    if (missing.length) throw new CommandError('invalid_state', `${missing.map((r) => r.body).join(', ')}: no such body any more (renamed or removed) — make the circuit again.`)
    const files: { name: string; bytes: Uint8Array }[] = []
    const used = new Set<string>()
    for (const r of rows) {
      const out = (await reverse('export.stl', { bodies: [r.body], format: 'stl' })) as { file?: { bytes: Uint8Array } }
      if (!out.file) throw new CommandError('failed', `${r.body} exported nothing.`)
      let fn = `${r.body.replace(/[\\/:*?"<>|]+/g, '_')}.stl`
      for (let k = 2; used.has(fn.toLowerCase()); k++) fn = `${r.body.replace(/[\\/:*?"<>|]+/g, '_')} ${k}.stl`
      used.add(fn.toLowerCase())
      files.push({ name: fn, bytes: out.file.bytes })
      ;(r as { file?: string }).file = fn
    }
    const txt = ['Printed circuit: which file takes which filament', '', ...rows.map((r) => `${(r as { file?: string }).file}\t${r.filament}`), '', 'Load every STL at once and, when the slicer asks, load them as one object with several parts: they keep their places, the traces inside the part.', 'Then give each part its filament. Conductive filament prints best slow and without a wipe through the part.', ''].join('\n')
    files.push({ name: 'filaments.txt', bytes: new TextEncoder().encode(txt) })
    const name = `${pick[0].body.replace(/[\\/:*?"<>|]+/g, '_')} circuit.zip`
    return { file: { name, mimeType: 'application/zip', bytes: zip(files) }, files: rows.map((r) => ({ file: (r as { file?: string }).file, body: r.body, filament: r.filament })), note: 'The app’s 3MF holds no filament per object: named STLs instead.' }
  },
}

const clear: Command<Record<string, never>> = {
  name: 'clear',
  title: 'Clear the plan',
  description: 'Put away the plan and the last check. Changes no body.',
  input: obj({}),
  history: false,
  run: async () => {
    usePrinted.setState({ plan: null, check: null })
    return describePrinted()
  },
}

const forget: Command<{ id?: string; all?: boolean }> = {
  name: 'forget',
  title: 'Forget a circuit',
  description: 'Take a circuit made (id from printed.apply) — or all — off the list printed.export reads. Its features stay in Reverse Engineer, and a pause recorded stays with the Hardware workspace (hw.unembed).',
  input: obj({ id: str('C1, C2…', { minLength: 1 }), all: bool('Every one.') }),
  label: (a) => (a.all ? 'forget circuits' : `forget ${a.id ?? ''}`),
  run: async ({ id, all }) => {
    if ((id === undefined) === (all !== true)) invalid('Give id, or all: true.')
    const have = st().made
    if (all) {
      st().setMade([])
      return { removed: have.map((m) => m.id) }
    }
    if (!have.some((m) => m.id === id)) invalid(`No circuit "${id}" (${have.map((m) => m.id).join(', ') || 'none made'}).`)
    st().setMade(have.filter((m) => m.id !== id))
    return { removed: [id] }
  },
}

export const printedCommands = [list, set, plan, route, apply, check, resistance, exportCmd, clear, forget] as Command<never>[]
