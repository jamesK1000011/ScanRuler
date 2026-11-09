// SPDX-License-Identifier: AGPL-3.0-only
// The Hardware workspace's commands (hw.*): the table of fasteners, inserts,
// magnets and bearings; the settings (allowances, clearance class, head and
// bridge figures); a hole planned — exactly what it would cut, and where —
// without changing anything; the plan cut into a Reverse Engineer body as
// named sketch and extrude-cut features, one undo step; a pattern of them;
// a round hole already on a body checked against the table; and parts
// encased in the print — a pocket closed under a roof, and the layer the
// print pauses at for each.

import { runWithin } from '../../../src/commands/registry'
import { bool, enumOf, int, num, obj, oneOf, str, vec3, type JsonSchema } from '../../../src/commands/schema'
import { readStateSections } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { fitsOf } from '../core/check'
import { featuresOf, overlapping, patternOffsets, type Pattern, type Placement, type V2, type V3 } from '../core/features'
import { FITS, type Fit, type Head, HEADS, type Kind, KINDS, sizesOf, table } from '../core/hardware'
import { boundaryDown, boundaryUp, EMBED_KINDS, type EmbedKind, encasedCut, EPS, type Layers, type ObjectSpec, pauseLayer, profileReach, schedule } from '../core/embed'
import { type Cut, cutDepth, DEFAULT_SETTINGS, planCut, PlanError, type Settings, type Spec, type Step } from '../core/plan'
import { calibratedKinds, withPrinterFit } from '../core/printerFit'
import { type Embed, type EmbedPlan, settingsOf, useHw, type PlanInput, type PlanOut } from '../state/hwStore'
import { readPrinterFit } from '../../_shared/readPrinterFit'

type Json = Record<string, unknown>
type Ref = string | number

const st = () => useHw.getState()
const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0
const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (v: readonly number[]): V3 | null => {
  const l = Math.hypot(v[0], v[1], v[2])
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : null
}
const invalid = (m: string): never => {
  throw new CommandError('invalid_input', m)
}

// ---- reading Reverse Engineer ----------------------------------------------------------

/** A command of Reverse Engineer's, inside this one's undo step when it
 *  changes anything; refused with a plain word where Reverse Engineer is
 *  not in the build. */
async function reverse(name: string, input: Json): Promise<Json> {
  try {
    return (await runWithin(`reverse.${name}`, input)) as Json
  } catch (e) {
    if (e instanceof CommandError && e.code === 'unknown_command') throw new CommandError('invalid_state', 'Reverse Engineer is not in this build: the Hardware workspace cuts its holes there.')
    throw e
  }
}

interface FaceRow {
  index: number
  kind: string
  area?: number
  centroid: V3
  normal?: V3
  axis?: V3
  radius?: number
  length?: number
  side?: 'boss' | 'bore'
  center?: V3
  fingerprint?: Json
}

async function facesOf(body: Ref, face: number | Json): Promise<{ body: string; faces: FaceRow[] }> {
  const r = (await reverse('body.describe', { body, edges: false, fingerprints: true, ...(typeof face === 'number' ? {} : { where: face }) })) as { bodies?: { name: string; faceList: FaceRow[] }[] }
  const b = r.bodies?.[0]
  if (!b) throw new CommandError('not_found', `There is no body ${JSON.stringify(body)}.`)
  const faces = typeof face === 'number' ? b.faceList.filter((f) => f.index === face) : b.faceList
  if (faces.length === 0) throw new CommandError('not_found', typeof face === 'number' ? `${b.name} has no face ${face} (reverse.body.describe lists them).` : `No face of ${b.name} answers that query.`)
  return { body: b.name, faces }
}

async function oneFace(body: Ref, face: number | Json): Promise<{ body: string; face: FaceRow }> {
  const { body: name, faces } = await facesOf(body, face)
  if (faces.length > 1) invalid(`${faces.length} faces of ${name} answer that query (${faces.slice(0, 8).map((f) => f.index).join(', ')}…): narrow it, or give the face's index.`)
  return { body: name, face: faces[0] }
}

interface Frame {
  normal: V3
  basisU: V3
  basisV: V3
  point: { at: V2; above: number }
}

const describePlane = async (plane: Json, point: V3) => (await reverse('plane.describe', { plane, point })) as unknown as Frame

// ---- where a hole goes ---------------------------------------------------------------------

interface AtIn {
  body: Ref
  face?: number | Json
  point?: V3
  direction?: V3
}

interface Placed {
  placement: Placement
  /** The hole's axis lies near level. */
  level: boolean
  entry: V3
  direction: V3
  basisU: V3
  basisV: V3
  plane: string
  body: string
  /** The flat face drilled into, as it stands. */
  face?: { index: number; centroid: V3; normal: V3; area: number }
}

const AXES = ['x', 'y', 'z'] as const

/**
 * The plane square to the hole and the sheet on it. A direction along a
 * coordinate axis takes the coordinate plane through the entry point; a
 * level one, a plane through the Z axis turned to face it; any other, the
 * flat face it is drilled into (a sketch on the face, which follows it).
 * Each is read back through reverse.plane.describe and checked: square to
 * the hole, and through the entry point at depth 0.
 */
async function place(at: AtIn, offsets: V2[]): Promise<Placed> {
  let entry: V3
  let dir: V3
  let fingerprint: Json | undefined
  let bodyName: string
  let faceAt: Placed['face']
  if (at.face !== undefined) {
    const { body, face } = await oneFace(at.body, at.face)
    bodyName = body
    if (face.kind !== 'plane' || !face.normal) invalid(`Face ${face.index} of ${body} is a ${face.kind}: give a flat face, or a point and a direction.`)
    const n = unit(face.normal!)!
    dir = [-n[0], -n[1], -n[2]]
    const c = face.centroid
    // A point given is taken onto the face's plane, square to it.
    entry = at.point ? (at.point.map((x, i) => x - dot([at.point![0] - c[0], at.point![1] - c[1], at.point![2] - c[2]], n) * n[i]) as V3) : c
    fingerprint = face.fingerprint
    faceAt = { index: face.index, centroid: c, normal: n, area: face.area ?? 0 }
    if (at.direction) invalid('With a face the hole goes square into it: leave direction out, or give point and direction without the face.')
  } else {
    if (!at.point || !at.direction) invalid('at: a body and a flat face of it ({ body, face, point? }), or a body, a point and the direction the hole goes in ({ body, point, direction }).')
    dir = unit(at.direction!) ?? invalid('direction: not all zero.')
    entry = at.point!
    const r = (await reverse('body.describe', { body: at.body, edges: false, limit: 1 })) as { bodies?: { name: string }[] }
    bodyName = r.bodies?.[0]?.name ?? invalid(`There is no body ${JSON.stringify(at.body)}.`)
  }
  const axis = [0, 1, 2].find((i) => Math.abs(Math.abs(dir[i]) - 1) < 1e-6)
  let angle = (Math.atan2(dir[0], -dir[1]) * 180) / Math.PI
  let kind: string
  let base: (offset: number) => Json
  if (axis !== undefined) {
    kind = `the ${['YZ', 'XZ', 'XY'][axis]} plane`
    base = (offset) => ({ kind: 'world', axis: AXES[axis], offset })
  } else if (Math.abs(dir[2]) < 1e-6) {
    kind = 'a plane through the Z axis'
    base = (offset) => ({ kind: 'radial', axis: { kind: 'world', axis: 'z' }, angleDeg: r6(angle), offset })
  } else if (fingerprint) {
    kind = `face ${String(at.face)} of ${bodyName}`
    base = (offset) => ({ kind: 'bodyFace', body: at.body, face: fingerprint, offset })
  } else {
    return invalid(`A hole along (${dir.map(r3).join(', ')}): give a direction along a coordinate axis or level, or a flat face of the body to drill square into.`)
  }
  let f = await describePlane(base(0), entry)
  if (axis === undefined && Math.abs(dir[2]) < 1e-6 && Math.abs(Math.abs(dot(f.normal, dir)) - 1) > 1e-6) {
    // Turned onto the hole: the plane's normal swung about Z onto it.
    const cz = f.normal[0] * dir[1] - f.normal[1] * dir[0]
    angle += (Math.atan2(cz, dot(f.normal, dir)) * 180) / Math.PI
    f = await describePlane(base(0), entry)
  }
  const nd = dot(f.normal, dir)
  if (Math.abs(Math.abs(nd) - 1) > 1e-3) throw new CommandError('failed', `The sketch plane did not come out square to the hole (normal (${f.normal.join(', ')})).`)
  // An offset moves the plane along its normal: the one through the entry
  // point, and below it each depth along the hole.
  let k = 1
  const h0 = f.point.above
  const offsetAt = (t: number) => r6(k * (h0 + t * nd))
  let f0 = await describePlane(base(offsetAt(0)), entry)
  if (Math.abs(f0.point.above) > 1e-4) {
    k = -1
    f0 = await describePlane(base(offsetAt(0)), entry)
    if (Math.abs(f0.point.above) > 1e-4) throw new CommandError('failed', 'The sketch plane could not be put through the entry point.')
  }
  const up: V2 | null = Math.abs(dir[2]) < 0.5 ? (() => {
    const u = f0.basisU[2], v = f0.basisV[2], l = Math.hypot(u, v)
    return l > 1e-6 ? ([u / l, v / l] as V2) : null
  })() : null
  const [u0, v0] = f0.point.at
  return {
    placement: { planeAt: (t) => base(offsetAt(t)), sign: nd > 0 ? 1 : -1, centres: offsets.map(([du, dv]) => [r6(u0 + du), r6(v0 + dv)] as V2), up, body: at.body },
    level: Math.abs(dir[2]) < 0.5,
    entry: entry.map(r6) as V3,
    direction: dir.map(r6) as V3,
    basisU: f0.basisU,
    basisV: f0.basisV,
    plane: kind,
    body: bodyName,
    ...(faceAt ? { face: faceAt } : {}),
  }
}

// ---- input --------------------------------------------------------------------------------

const bodyRef = oneOf([num('The body’s id.'), str('Its name.', { minLength: 1 })], 'A Reverse Engineer body, by id or name.')

const atIn = obj(
  {
    body: bodyRef,
    face: oneOf([int('Its index in reverse.body.describe.', { minimum: 0 }), { type: 'object', description: 'A query, as reverse.body.describe takes where; one face must answer.' }], 'A flat face to drill square into.'),
    point: vec3('Where the hole starts, mm: on the face (its centre by default), or on the surface with direction.'),
    direction: vec3('The way the hole goes into the part, without a face: along a coordinate axis, or level.'),
  },
  ['body'],
  'Where the hole goes: { body, face, point? } or { body, point, direction }.',
)

const patternIn = oneOf(
  [
    obj({ kind: enumOf(['circle']), count: int('Holes round it.', { minimum: 2, maximum: 64 }), diameter: num('The bolt circle, mm.', { exclusiveMinimum: 0 }), startDeg: num('Where the first lies, degrees from the sheet’s +u.') }, ['kind', 'count', 'diameter'], 'A bolt circle about the point.'),
    obj({ kind: enumOf(['rectangle']), width: num('Along u, mm.', { exclusiveMinimum: 0 }), height: num('Along v, mm.', { exclusiveMinimum: 0 }) }, ['kind', 'width', 'height'], 'Four holes at the corners of a rectangle centred on the point.'),
    obj({ kind: enumOf(['grid']), countU: int('', { minimum: 1, maximum: 32 }), countV: int('', { minimum: 1, maximum: 32 }), stepU: num('mm', { exclusiveMinimum: 0 }), stepV: num('mm', { exclusiveMinimum: 0 }) }, ['kind', 'countU', 'countV', 'stepU', 'stepV'], 'A grid centred on the point.'),
  ],
  'Copies about the point, on the sketch sheet ([u, v]; the answer’s frame gives the ways u and v run).',
)

const encaseIn = oneOf(
  [
    bool('true: closed under the least roof (roofLayers × layerHeight).'),
    obj({ roof: num('Material over the pocket, mm.', { exclusiveMinimum: 0, maximum: 50 }), roofLayers: int('Or this many layers of it.', { minimum: 1, maximum: 50 }) }, [], 'The roof over it.'),
  ],
  'Sink the pocket under a roof, closed all round, for a part dropped in mid-print; the print pauses at its top (hw.pauses). nut, magnet, bearing, insert or object.',
)

const objectIn = oneOf(
  [
    obj({ shape: enumOf(['box']), size: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[width along u, length along v, height along the hole], mm.' }, angleDeg: num('Turned on the sheet, degrees from +u.') }, ['shape', 'size'], 'A box.'),
    obj({ shape: enumOf(['cylinder']), diameter: num('mm', { exclusiveMinimum: 0 }), height: num('Along the hole, mm.', { exclusiveMinimum: 0 }) }, ['shape', 'diameter', 'height'], 'A cylinder.'),
  ],
  'kind object: the part dropped in, measured — a weight, a tag, a sensor. The pocket takes the clearance round it.',
)

const specFields: Record<string, JsonSchema> = {
  kind: enumOf([...KINDS, 'object'], 'screw (clearance with a head recess), nut (hex trap), insert (heat-set), pilot (thread-forming screw), magnet (disc), bearing; object (a part of your own, encased only).'),
  size: str('M2–M8 for screw, nut and pilot; M2, M2.5, M3, M3 short, M4, M5 for insert; "6x3" for a magnet (Ø × thickness); 608, 625, 6800… for a bearing. hw.list gives them.', { minLength: 1 }),
  head: enumOf(HEADS, 'A screw’s head: socket (ISO 4762, the default), button (ISO 7380), countersunk (ISO 10642), none.'),
  fit: enumOf(FITS, 'ISO 273 clearance class; the setting by default.'),
  depth: oneOf([num('mm', { exclusiveMinimum: 0 }), { type: 'null' }], 'mm from the surface; null through. Each kind has its default: through for a screw or a nut’s shaft, the insert’s length plus the extra, 2d + 1 for a pilot, the magnet’s thickness plus the extra, the bearing’s width.'),
  sunk: num('A nut: its near face this deep, mm; 0 (the default) opens at the surface.', { minimum: 0 }),
  slot: obj({ length: num('From the nut’s centre to the part’s side, mm.', { exclusiveMinimum: 0 }), toward: vec3('The way it runs, world; projected onto the sheet.'), angleDeg: num('Or degrees from the sheet’s +u.') }, ['length'], 'A nut: a slot to slide it in from the side. Its way by default: up for a level hole, +u otherwise.'),
  shaft: bool('A nut: the screw’s clearance through it too (default true).'),
  relief: bool('A bearing: a hole through behind it clear of the inner race (default true).'),
  allowance: num('mm added to the diameters, in place of the kind’s setting.', { minimum: -1, maximum: 2 }),
  teardrop: bool('A level hole drawn as a teardrop: the setting by default (clearance and pilot holes); true teardrops every round step, false none.'),
  encase: encaseIn,
  object: objectIn,
  clearance: num('Encased: mm on the pocket’s diameter or each side, in place of the setting.', { minimum: 0, maximum: 3 }),
  what: str('Encased: what goes in, for the pause’s message (“a 6x3 magnet” by default).', { minLength: 1 }),
}

const planFields: Record<string, JsonSchema> = { ...specFields, at: atIn, name: str('The features’ base name; the hardware’s by default, numbered.', { minLength: 1 }) }

interface PlanArgs {
  kind: Kind | 'object'
  size?: string
  head?: Head
  fit?: Fit
  depth?: number | null
  sunk?: number
  slot?: { length: number; toward?: V3; angleDeg?: number }
  shaft?: boolean
  relief?: boolean
  allowance?: number
  teardrop?: boolean
  at: AtIn
  name?: string
  pattern?: Pattern
  encase?: boolean | { roof?: number; roofLayers?: number }
  object?: ObjectSpec
  clearance?: number
  what?: string
}

/** Names already taken in Reverse Engineer, lower case. */
const takenNames = () => new Set((((readStateSections().reverse as { features?: { name: string }[] } | undefined)?.features) ?? []).map((f) => f.name.toLowerCase()))

/** The calibration holes are sized with now: null when there is none or
 *  printerFit is off. */
const fitInUse = () => (st().printerFit ? readPrinterFit() : null)

/** The settings holes are sized with: the allowances left at their default
 *  follow the printer's fit calibration. */
function settings(): Settings {
  return withPrinterFit(settingsOf(st()), fitInUse())
}

/** Which calibration a hole of this kind was sized with, for its answer:
 *  none where its allowance was given or set by hand. */
function fitUsed(kind: string, given?: number): { printerFit?: string } {
  const f = fitInUse()
  if (!f || given !== undefined || !(calibratedKinds(settingsOf(st())) as string[]).includes(kind)) return {}
  return { printerFit: f.label }
}

/** The calibration in the readout: what it is and which allowances follow it. */
function fitState() {
  if (!st().printerFit) return { printerFit: 'off: the allowances as set' }
  const f = readPrinterFit()
  if (!f) return {}
  return { printerFit: { used: f.label, hole: f.hole, kinds: calibratedKinds(settingsOf(st())) } }
}

/** The plan, placed: what it cuts, where, and the features that cut it. */
async function planOf(a: PlanArgs) {
  if (a.name !== undefined && a.name.trim().length > 60) invalid('name: up to 60 characters.')
  const offsets = patternOffsets(a.pattern)
  const encase = a.encase !== undefined && a.encase !== false
  if (!encase) {
    if (a.kind === 'object') invalid('object: an encased pocket only — give encase: true (or use hw.embed).')
    for (const k of ['object', 'clearance', 'what'] as const) if (a[k] !== undefined) invalid(`${k}: an encased pocket’s only — give encase: true (or use hw.embed).`)
    if (a.size === undefined) invalid('size: needed.')
  }
  const placed = await place(a.at, offsets)
  if (encase) return encasedPlan(a, placed, offsets)
  const spec: Spec = { kind: a.kind as Kind, size: a.size!, head: a.head, fit: a.fit, depth: a.depth, sunk: a.sunk, shaft: a.shaft, relief: a.relief, allowance: a.allowance, teardrop: a.teardrop }
  if (a.slot) {
    if (a.kind !== 'nut') invalid('slot: a nut’s only.')
    let angleDeg = a.slot.angleDeg
    if (a.slot.toward) {
      const t = a.slot.toward
      const u = dot(t, placed.basisU), v = dot(t, placed.basisV)
      if (Math.hypot(u, v) < 1e-6 * Math.hypot(...t)) invalid('slot.toward runs along the hole: give a way across it.')
      angleDeg = (Math.atan2(v, u) * 180) / Math.PI
    }
    if (angleDeg === undefined) angleDeg = placed.placement.up ? (Math.atan2(placed.placement.up[1], placed.placement.up[0]) * 180) / Math.PI : 0
    spec.slot = { length: a.slot.length, angleDeg: r6(angleDeg) }
  }
  for (const [k, kinds] of [['head', ['screw']], ['sunk', ['nut']], ['shaft', ['nut']], ['relief', ['bearing']]] as const)
    if ((a as unknown as Json)[k] !== undefined && !(kinds as readonly string[]).includes(a.kind)) invalid(`${k}: a ${kinds.join(' or ')}’s only.`)
  let cut
  try {
    cut = planCut(spec, settings(), placed.level)
  } catch (e) {
    if (e instanceof PlanError) invalid(e.message)
    throw e
  }
  return finish(a, placed, offsets, cut, cut.notes)
}

/** The plan's features, names, centres and notes, from its cut. */
function finish(a: PlanArgs, placed: Placed, offsets: V2[], cut: Cut, notes0: string[], embed?: EmbedPlan) {
  const near = overlapping(cut, offsets)
  if (near !== null) invalid(`The pattern puts two holes ${r3(near)} apart, closer than the widest step: space them further.`)
  const count = offsets.length
  const given = a.name?.trim() || undefined
  const base0 = given ?? `${cut.label}${count > 1 ? ` ×${count}` : ''}`
  const taken = takenNames()
  const clash = (names: string[]) => names.some((x) => taken.has(x.toLowerCase()))
  let built = given ? featuresOf(cut, placed.placement, given) : null
  for (let n = given ? 2 : 1; !built || clash(built.names); n++) built = featuresOf(cut, placed.placement, `${base0} ${n}`)
  const centres = offsets.map(([du, dv]) => placed.entry.map((x, i) => r3(x + du * placed.basisU[i] + dv * placed.basisV[i])) as V3)
  const depth = cutDepth(cut)
  const notes = [...notes0]
  // A blind hole deeper than the body: it comes out the far side (an insert
  // hole 6.7 deep in a floor 5.75 over the bed, say). The body's box says
  // it surely does; inside the box, the body may still be thinner there.
  const box = embed ? null : boxOf(placed.body)
  if (box && typeof depth === 'number') {
    let out = -Infinity
    for (const c of centres)
      for (let i = 0; i < 3; i++) {
        const d = placed.direction[i]
        if (Math.abs(d) < 1e-9) continue
        const end = c[i] + depth * d
        out = Math.max(out, d < 0 ? box.min[i] - end : end - box.max[i])
      }
    if (out > EPS) notes.push(`Warning: ${r3(depth)} deep, the hole comes out ${r3(out)} past ${placed.body}’s far side: it will be open there. Give a shorter depth, a smaller size, or drill it from the other side.`)
    else if (out > -0.6) notes.push(`Warning: only ${r3(-out)} would be left under the hole before ${placed.body}’s far side: it may print open there.`)
  }
  if (placed.face && placed.face.area > 0) {
    // A face's reach, roughly: a copy further from its centre than a
    // square of its area is wide may miss it.
    const reach = Math.sqrt(placed.face.area)
    const far = centres.filter((c) => Math.hypot(c[0] - placed.face!.centroid[0], c[1] - placed.face!.centroid[1], c[2] - placed.face!.centroid[2]) > reach)
    if (far.length) notes.push(`Warning: ${far.length === centres.length ? 'the hole lies' : `${far.length} of the holes lie`} far from the face’s centre (more than ${r3(reach)}) — check ${far.length === 1 ? 'it lands' : 'they land'} on the face.`)
  }
  return {
    label: cut.label,
    body: placed.body,
    at: { entry: placed.entry.map(r3), direction: placed.direction.map(r3), plane: placed.plane, frame: { basisU: placed.basisU, basisV: placed.basisV }, level: placed.level },
    steps: cut.steps.map((s) => ({ ...s, to: s.to ?? 'through' })),
    depth: depth ?? 'through',
    centres,
    notes,
    face: placed.face,
    features: built.features,
    names: built.names,
    ...(embed ? { embed } : {}),
    ...fitUsed(a.kind, a.allowance),
  }
}

/** The settings' layers. */
const layersOf = (s: Settings): Layers => ({ height: s.layerHeight, first: s.firstLayer })

/** A body's lowest point in the part's frame — where it meets the bed —
 *  from Reverse Engineer's bounds; null where it has none. */
function baseOf(body: string): number | null {
  return zRange(body)?.[0] ?? null
}

/** A body's lowest and highest Z, from Reverse Engineer's bounds. */
function zRange(body: string): [number, number] | null {
  const b = boxOf(body)
  return b ? [b.min[2], b.max[2]] : null
}

/** A body's bounding box, from Reverse Engineer's bounds. */
function boxOf(body: string): { min: V3; max: V3 } | null {
  const bs = ((readStateSections().reverse as { bodies?: { name: string; bounds?: { min: number[]; max: number[] } | null }[] } | undefined)?.bodies) ?? []
  const b = bs.find((x) => x.name === body)?.bounds
  const ok = (v: unknown): v is V3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
  return b && ok(b.min) && ok(b.max) ? { min: b.min, max: b.max } : null
}

/** A step's outline on the sheet about its centre, as features.ts draws it
 *  (a circle sampled finely), with its teardrop point and riser. */
function outlineOf(step: Step, up: V2 | null): V2[] {
  const r = step.diameter / 2
  const pts: V2[] = []
  if (step.profile === 'circle') for (let i = 0; i < 144; i++) pts.push([r * Math.cos((i * Math.PI) / 72), r * Math.sin((i * Math.PI) / 72)])
  else if (step.profile === 'hex') {
    const R = r / Math.cos(Math.PI / 6)
    const a0 = up ? Math.atan2(up[1], up[0]) : Math.PI / 6
    for (let i = 0; i < 6; i++) pts.push([R * Math.cos(a0 + (i * Math.PI) / 3), R * Math.sin(a0 + (i * Math.PI) / 3)])
  } else if (step.profile === 'rect') {
    const t = ((step.angleDeg ?? 0) * Math.PI) / 180
    const w = step.diameter / 2, h = (step.length ?? step.diameter) / 2
    for (const [a, b] of [[w, h], [-w, h], [-w, -h], [w, -h]]) pts.push([a * Math.cos(t) - b * Math.sin(t), a * Math.sin(t) + b * Math.cos(t)])
  } else {
    const R = r / Math.cos(Math.PI / 6)
    for (let i = 0; i < 6; i++) pts.push([R * Math.cos((i * Math.PI) / 3), R * Math.sin((i * Math.PI) / 3)])
  }
  if (up && step.teardrop) pts.push([r * Math.SQRT2 * up[0], r * Math.SQRT2 * up[1]])
  if (up && step.riser) for (const s of [1, -1]) pts.push([s * r * up[1] + step.riser * up[0], -s * r * up[0] + step.riser * up[1]])
  return pts
}

/**
 * An encased pocket, placed: sunk under its roof and, where the body's
 * place on the bed is known and the hole is upright, its top put on a
 * layer boundary — the roof made thicker going down, the pocket deeper
 * going up — so the layer it falls in is not printed closed a layer early.
 * Each copy's top, the roof over it, the span it bridges and the pause.
 */
function encasedPlan(a: PlanArgs, placed: Placed, offsets: V2[]) {
  if (!(EMBED_KINDS as readonly string[]).includes(a.kind)) invalid(`A ${a.kind} is not dropped in: encase takes ${EMBED_KINDS.join(', ')}.`)
  for (const k of ['sunk', 'slot', 'relief', 'head', 'teardrop'] as const) if (a[k] !== undefined) invalid(`${k}: not with encase — the pocket is closed all round${k === 'teardrop' ? ' (a level one gets straight sides to a flat top)' : ''}.`)
  if (a.depth === null) invalid('depth: an encased pocket has a floor — give a number, or leave it out.')
  if (a.kind === 'object' ? a.size !== undefined : a.size === undefined) invalid(a.kind === 'object' ? 'size: hardware’s only — an object gives object.' : 'size: needed.')
  if (a.kind !== 'object' && a.object !== undefined) invalid('object: kind object’s only.')
  const S = settings()
  const layers = layersOf(S)
  const dz0 = placed.direction[2]
  // A slanted pocket closes over itself before the print reaches its top:
  // nothing could be dropped into it at the pause.
  if (Math.abs(Math.abs(dz0) - 1) > 1e-6 && Math.abs(dz0) > 1e-6) invalid(`An encased pocket goes straight down, straight up or level: one along (${placed.direction.map(r3).join(', ')}) would be closed over before the print reaches its top, and the part could not be dropped in. Give a face or direction square to the bed or upright.`)
  if (a.kind === 'object' && a.object?.shape === 'box' && placed.placement.up) {
    // Level: the box drops in only with its sides upright under a flat top.
    const up = (Math.atan2(placed.placement.up[1], placed.placement.up[0]) * 180) / Math.PI
    const off = ((((a.object.angleDeg ?? 0) - up) % 90) + 90) % 90
    if (Math.min(off, 90 - off) > 0.5) invalid(`A level box pocket stands with its sides upright so the box drops in: turn it (object.angleDeg ${r3(up)} or ${r3(up + 90)}, from the sheet’s +u).`)
  }
  const e = a.encase === true || a.encase === undefined ? {} : (a.encase as { roof?: number; roofLayers?: number })
  if (e.roof !== undefined && e.roofLayers !== undefined) invalid('encase: roof or roofLayers, not both.')
  const minRoof = r3((e.roofLayers ?? S.roofLayers) * S.layerHeight)
  let roof = e.roof ?? minRoof
  const dz = placed.direction[2]
  const down = dz < -1 + 1e-6
  const up = dz > 1 - 1e-6
  const base = baseOf(placed.body)
  const notes: string[] = []
  const make = (r: number, depth?: number) => {
    try {
      return encasedCut({ kind: a.kind as EmbedKind, size: a.size, object: a.object, what: a.what, roof: r, clearance: a.clearance, allowance: a.allowance, depth: depth ?? (a.depth ?? undefined), shaft: a.shaft, fit: a.fit, count: offsets.length }, S, placed.level)
    } catch (err) {
      if (err instanceof PlanError) invalid(err.message)
      throw err
    }
  }
  let cut = make(roof)
  if (base !== null && down) {
    // The top, above the bed, brought down onto a boundary: more roof.
    const top = placed.entry[2] - base - roof
    const b = boundaryDown(top, layers)
    if (b === null || b <= EPS) invalid(`The pocket's top would be ${r3(top)} above the bed, inside the first layer: the part is too thin here for it under a ${r3(roof)} roof.`)
    const more = placed.entry[2] - base - b! - roof
    if (more > EPS) {
      roof = r3(roof + more)
      notes.push(`Roof made ${roof} (from ${r3(roof - more)}) so the pocket's top lands on a layer boundary, ${r3(b!)} above the bed.`)
      cut = make(roof)
    }
  } else if (base !== null && up) {
    // Cut up from below: the pocket made deeper, onto a boundary.
    const pocket = cut.steps[0]
    const top = placed.entry[2] - base + (pocket.to as number)
    const more = boundaryUp(top, layers) - top
    if (more > EPS) {
      cut = make(roof, r3(cut.height + more))
      notes.push(`Pocket made ${cut.height} deep so its top lands on a layer boundary, ${r3(top + more)} above the bed.`)
    }
  }
  if (base !== null && placed.level && cut.steps[0].riser) {
    // Level: the flat top raised onto a layer boundary.
    const top = placed.entry[2] + cut.steps[0].riser - base
    const more = boundaryUp(top, layers) - top
    if (more > EPS) {
      cut.steps[0].riser = r3(cut.steps[0].riser + more)
      notes.push(`Its flat top raised ${r3(more)} onto a layer boundary, ${r3(top + more)} above the bed.`)
    }
  }
  const pocket = cut.steps[0]
  const reach = profileReach(pocket, [placed.basisU[2], placed.basisV[2]])
  const along = Math.max((pocket.from as number) * dz, (pocket.to as number) * dz)
  const tops = offsets.map(([du, dv]) => r3(placed.entry[2] + du * placed.basisU[2] + dv * placed.basisV[2] + along + reach))
  const measured = down ? roof : null
  const warn: string[] = []
  if (measured !== null && measured < minRoof - EPS) warn.push(`Warning: the roof is ${measured}, under ${e.roofLayers ?? S.roofLayers} layers (${minRoof}): it may print thin or open.`)
  // Out through the body's far side: under it going down, over it going up.
  const range = zRange(placed.body)
  if (range && down) {
    const floor = r3(placed.entry[2] - (pocket.to as number) - range[0])
    if (floor <= EPS) invalid(`The pocket would go ${r3(-floor)} out under ${placed.body} (its bottom is at Z ${r3(range[0])}): make it shallower or the roof thinner.`)
    if (floor < minRoof - EPS) warn.push(`Warning: only ${floor} under the pocket to the part’s bottom, under ${minRoof}: it may print open below.`)
  }
  if (up && roof < minRoof - EPS) warn.push(`Warning: the floor under the pocket is ${r3(roof)}, under ${minRoof}: it may print open below.`)
  if (range && !down) {
    const over = r3(range[1] - Math.max(...tops))
    if (over <= EPS) invalid(`The pocket’s top (Z ${Math.max(...tops)}) reaches ${placed.body}’s top (Z ${r3(range[1])}): it can’t be closed over. Make it shallower, or cut it from the top.`)
    if (over < minRoof - EPS) warn.push(`Warning: ${placed.body}’s top is only ${over} over the pocket, under ${minRoof}: it may print open.`)
  }
  // Out through a side: the pocket's outline, every copy, against the
  // body's box — past it, surely out; inside it, the body may still be
  // thinner there (a section shows it).
  const box = boxOf(placed.body)
  if (box) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (const [du, dv] of offsets)
      for (const [u, v] of outlineOf(pocket, placed.placement.up))
        for (const t of [pocket.from as number, pocket.to as number])
          for (let i = 0; i < 3; i++) {
            const x = placed.entry[i] + (du + u) * placed.basisU[i] + (dv + v) * placed.basisV[i] + t * placed.direction[i]
            lo[i] = Math.min(lo[i], x)
            hi[i] = Math.max(hi[i], x)
          }
    const sides = [0, 1, 2].filter((i) => i < 2 || placed.level)
    const out = sides.flatMap((i) => [r3(box.min[i] - lo[i]), r3(hi[i] - box.max[i])].filter((x) => x > EPS).map((x) => `${r3(x)} past ${placed.body}’s ${'XYZ'[i]} side`))
    if (out.length) invalid(`The pocket would break out of ${placed.body}: ${out.join(', ')}. Move it in, or make it smaller.`)
    const thin = Math.min(...sides.flatMap((i) => [lo[i] - box.min[i], box.max[i] - hi[i]]))
    if (thin < minRoof - EPS) warn.push(`Warning: the pocket comes within ${r3(thin)} of ${placed.body}’s side, under ${minRoof}: it may print open there.`)
  }
  if (!down) notes.push(up ? `The part over the pocket is the body's own: check it is ${minRoof} thick at least (section.cut through it).` : `The material round the pocket is the body's own: check it is ${minRoof} thick at least, above it most of all (section.cut through it).`)
  if (cut.span > S.bridgeMax + EPS) {
    const at = base !== null ? pauseLayer(Math.min(...tops) - base, layers) : null
    warn.push(`Warning: the roof spans ${cut.span}, more than a safe bridge (${S.bridgeMax}). ${at ? `Layer ${at.layer} (Z ${at.printZ})` : 'The first layer over it'} bridges it: print it as a bridge (the slicer's bridge settings), narrow the pocket, or turn it so the short side spans.`)
  }
  const pauses = base === null ? [] : [...new Set(tops)].map((t) => ({ top: t, ...pauseLayer(t - base, layers) }))
  for (const p of pauses) if (!p.onBoundary) warn.push(`Warning: the pocket's top (${r3(p.top - base!)} above the bed) is not on a layer boundary at ${S.layerHeight} layers (first ${S.firstLayer}): the layer it falls in may be printed closed over it. Pause is before layer ${p.layer}; check the slice.`)
  if (base === null) notes.push('The body’s place on the bed was not read (is it built?): hw.pauses gives the layer once it is.')
  const embed: EmbedPlan = { kind: a.kind, label: cut.label, what: cut.what, tops, roof: measured, minRoof, span: cut.span, ...(pauses.length ? { pauses: pauses.map((p) => ({ layer: p.layer, z: p.z, printZ: p.printZ, onBoundary: p.onBoundary })) } : {}), ...(base !== null ? { bedZ: base } : {}) }
  return finish(a, placed, offsets, cut, [...cut.notes, ...notes, ...warn], embed)
}

const asInput = (a: PlanArgs): PlanInput => JSON.parse(JSON.stringify(a)) as PlanInput

// ---- the commands -------------------------------------------------------------------------

/** A new encased part's id: E and the next number. */
const nextId = (have: Embed[]) => `E${Math.max(0, ...have.map((e) => Number(/^E(\d+)$/.exec(e.id)?.[1] ?? 0))) + 1}`

/** The plan's pockets recorded, one per height (copies at one height are
 *  one, counted). */
function record(e: EmbedPlan, body: string, features: string[]): Embed[] {
  const groups = new Map<number, number>()
  for (const t of e.tops) groups.set(t, (groups.get(t) ?? 0) + 1)
  const all = [...st().embeds]
  const added: Embed[] = []
  for (const [top, count] of groups) {
    const one: Embed = { id: nextId(all), body, kind: e.kind, label: e.label, what: count > 1 && groups.size > 1 ? e.what.replace(/ ×\d+$/, '') + ` ×${count}` : e.what, top, roof: e.roof, minRoof: e.minRoof, span: e.span, count, features, ...(e.bedZ !== undefined ? { bedZ: e.bedZ } : {}) }
    all.push(one)
    added.push(one)
  }
  st().setEmbeds(all)
  return added
}

const brief = (e: Embed) => ({ id: e.id, body: e.body, what: e.what, top: e.top, roof: e.roof, ...(e.count > 1 ? { count: e.count } : {}), ...(e.source ? { source: e.source } : {}) })

export function describeHw() {
  const s = st()
  return {
    settings: settings(),
    ...fitState(),
    ...(s.embeds.length ? { encased: s.embeds.map(brief) } : {}),
    ...(s.plan ? { plan: { label: s.plan.label, input: s.plan.input, steps: s.plan.steps, centres: s.plan.centres, notes: s.plan.notes, ...(s.plan.embed ? { encased: s.plan.embed } : {}), ...(s.plan.stale ? { stale: 'the settings changed since: hw.apply plans it again with them' } : {}) } } : {}),
    ...(s.made ? { made: s.made } : {}),
    ...(s.check ? { check: { diameter: s.check.diameter, ...(s.check.body ? { body: s.check.body, face: s.check.face } : {}), best: s.check.matches.slice(0, 3) } } : {}),
  }
}

const list: Command<{ kind?: Kind }> = {
  name: 'list',
  title: 'The hardware table',
  description: 'Screws M2–M8 (ISO 273 clearances; ISO 4762, 7380 and 10642 heads), ISO 4032 nuts, heat-set inserts, thread-forming pilots, disc magnets and bearings, mm; with the settings that size the holes cut for them (allowances as calibrated; printerFit says which calibration). kind narrows it to one kind’s sizes. Changes nothing.',
  input: obj({ kind: enumOf(KINDS, 'One kind’s sizes only.') }),
  readOnly: true,
  run: async ({ kind }) => ({ ...(kind ? { kind, sizes: sizesOf(kind) } : table()), settings: settings(), ...fitState() }),
}

interface SetIn {
  allowance?: Partial<Record<Kind, number>> | number
  printerFit?: boolean
  fit?: Fit
  headMargin?: number
  headSink?: number
  teardrop?: boolean
  bridgeLayer?: number
  insertExtra?: number
  magnetExtra?: number
  roofLayers?: number
  layerHeight?: number
  firstLayer?: number
  bridgeMax?: number
  dropClearance?: number
  dropHeadroom?: number
  reset?: boolean
}

const lengthIn = (d: string, max: number) => num(`${d}, mm.`, { minimum: 0, maximum: max })

const set: Command<SetIn> = {
  name: 'set',
  title: 'Hole settings',
  description: 'How holes are sized: allowance (mm added to each diameter and across-flats, FDM holes printing small — one number for every kind, or by kind: screw 0.2, nut 0.2, insert 0, pilot 0, magnet 0.2, bearing 0.1 by default; one left at its default follows the printer’s fit calibration from Fits, moved by how far its holes are off the typical 0.2), printerFit (size holes with that calibration, on; false keeps the allowances as set), fit (ISO 273 class, medium), headMargin (counterbore over the head, 0.4), headSink (head below the surface, 0.2), teardrop (level clearance holes, on), bridgeLayer (a sacrificial layer at each step of an upright hole, 0 for none), insertExtra (hole past the insert, 1), magnetExtra (pocket past the magnet, 0.2); for encased parts: roofLayers (3), layerHeight and firstLayer (0.2 — as the slicer profile prints), bridgeMax (widest roof over air without a warning, 10), dropClearance (0.3) and dropHeadroom (0.2). reset: true for the defaults. Saved with the project.',
  input: obj({
    allowance: oneOf([num('Every kind, mm.', { minimum: -1, maximum: 2 }), obj(Object.fromEntries(KINDS.map((k) => [k, num('mm', { minimum: -1, maximum: 2 })])), [], 'By kind, mm.')], 'mm added to diameters.'),
    printerFit: bool('Size holes with the printer’s fit calibration from Fits (default on).'),
    fit: enumOf(FITS),
    headMargin: lengthIn('Counterbore over the head', 3),
    headSink: lengthIn('Head below the surface', 5),
    teardrop: bool('Teardrop level clearance holes.'),
    bridgeLayer: lengthIn('Sacrificial layer at a step; 0 for none', 1),
    insertExtra: lengthIn('Hole past the insert', 5),
    magnetExtra: lengthIn('Pocket past the magnet', 3),
    roofLayers: int('Encased: layers of roof at least.', { minimum: 1, maximum: 50 }),
    layerHeight: num('The layer height printed at, mm.', { minimum: 0.01, maximum: 2 }),
    firstLayer: num('The first layer’s height, mm.', { minimum: 0.01, maximum: 2 }),
    bridgeMax: lengthIn('Widest roof over air without a warning', 200),
    dropClearance: lengthIn('Encased: on a pocket’s diameter or side', 3),
    dropHeadroom: lengthIn('Encased: over the part, to the pocket’s top', 5),
    reset: bool('Back to the defaults.'),
  }),
  history: false,
  run: async ({ reset, allowance, ...rest }) => {
    if (reset) {
      st().set(settingsOf(DEFAULT_SETTINGS))
      const plan = st().plan
      if (plan) useHw.setState({ plan: { ...plan, stale: true } })
      return describeHw()
    }
    if (allowance === undefined && Object.keys(rest).length === 0) invalid('Give a setting to change, or reset: true.')
    const a = allowance === undefined ? {} : { allowance: typeof allowance === 'number' ? (Object.fromEntries(KINDS.map((k) => [k, allowance])) as Record<Kind, number>) : { ...st().allowance, ...allowance } }
    st().set({ ...rest, ...a })
    const plan = st().plan
    if (plan) useHw.setState({ plan: { ...plan, stale: true } })
    return describeHw()
  },
}

const plan: Command<PlanArgs> = {
  name: 'plan',
  title: 'Plan a hole',
  description: 'The hole a piece of hardware takes, placed on a Reverse Engineer body, without changing anything: each step (head counterbore, 90° countersink, shaft, hex nut trap or side slot, insert hole, pocket, relief) with its profile, diameter (a hex: across flats), and the depths it runs between (from the surface, mm; through), the entry point, direction and sketch frame, notes on how it sits, and the exact reverse.feature.add features hw.apply would add. at: { body, face } drills square into a flat face (at its centre, or point); { body, point, direction } along a coordinate axis or level. A level hole is teardropped point up by the setting. pattern repeats it (bolt circle, rectangle, grid). Kept for hw.apply.',
  input: obj({ ...planFields, pattern: patternIn }, ['kind', 'at']),
  readOnly: true,
  run: async (a) => planAndKeep(a),
}

async function planAndKeep(a: PlanArgs) {
  const p = await planOf(a)
  const out: PlanOut = { input: asInput(a), label: p.label, steps: p.steps, notes: p.notes, centres: p.centres, features: p.features, ...(p.face ? { face: p.face } : {}), ...(p.embed ? { embed: p.embed } : {}) }
  useHw.setState({ plan: out })
  return p
}

const pattern: Command<PlanArgs & { pattern: Pattern }> = {
  name: 'pattern',
  title: 'Plan a pattern of holes',
  description: 'As hw.plan, for a set of holes laid about the point: a bolt circle (count, diameter, startDeg), the corners of a rectangle (width, height) or a grid (countU, countV, stepU, stepV), on the sketch’s sheet. Refused where two would run into each other. Changes nothing; hw.apply cuts it.',
  input: obj({ ...planFields, pattern: patternIn }, ['kind', 'size', 'at', 'pattern']),
  readOnly: true,
  run: async (a) => planAndKeep(a),
}

const apply: Command<Partial<PlanArgs>> = {
  name: 'apply',
  title: 'Cut the hole',
  description: 'Cut the hole hw.plan or hw.pattern planned — or the one given here, as hw.plan takes it — into its Reverse Engineer body: a sketch per step on a plane square to the hole and an extrude cut into that body alone, named after the hardware ("M3 cap screw 1 head"), so each stays editable there. Planned afresh from the body as it stands. One undo step; if any feature fails to build, none is kept. An encased pocket (hw.embed, or encase) is recorded for its pause (hw.pauses). Returns the features and their status.',
  input: obj({ ...planFields, pattern: patternIn }),
  label: (a) => `cut ${a.kind ? `${a.size ?? ''} ${a.kind}` : 'planned hole'}`.replace(/\s+/g, ' '),
  run: async (a) => {
    const asked = a.kind !== undefined
    if (asked && ((a.size === undefined && a.kind !== 'object') || a.at === undefined)) invalid('Give kind, size and at — or nothing, to cut the hole planned last.')
    const kept0 = st().plan
    const args = (asked ? a : (kept0?.input as unknown as PlanArgs | undefined)) ?? invalid('Plan it first (hw.plan or hw.pattern), or give the hole here.')
    useHw.setState({ busy: 'Cutting…' })
    try {
      const p = await planOf(args as PlanArgs)
      // The face planned on, by its index: still the same face?
      const was = asked ? undefined : kept0?.face
      if (was && p.face && (Math.hypot(...p.face.centroid.map((x, i) => x - was.centroid[i])) > 1e-3 || dot(p.face.normal, was.normal) < 0.9999))
        throw new CommandError('invalid_state', `Face ${was.index} of ${p.body} is not the face it was planned on any more (the body changed): plan it again.`)
      const r = (await reverse('feature.add', { features: p.features, detail: 'brief' })) as { added?: Json[]; stopped?: Json }
      const added = r.added ?? []
      const status = (x: Json) => ((x.result as Json | null)?.status ?? (x.feature as Json | undefined)?.status ?? x.status) as string | undefined
      const bad = added.findIndex((x) => status(x) === 'failed')
      if (r.stopped || bad >= 0) {
        const why = r.stopped ? String((r.stopped as Json).message) : String(((added[bad].result as Json | null)?.message as string | undefined) ?? 'it failed to build')
        // None kept: what went in comes out again, last first.
        const kept = new Set(takenNames())
        const stuck: string[] = []
        for (const n of [...p.names].reverse()) if (kept.has(n.toLowerCase())) await reverse('feature.remove', { feature: n, detail: 'none' }).catch(() => stuck.push(n))
        throw new CommandError('failed', `${p.label} could not be cut: ${why}${r.stopped ? '' : ` (${p.names[bad]})`}. ${stuck.length ? `These could not be taken out again: ${stuck.join(', ')} — undo the step (history.undo).` : 'Nothing was kept.'}`)
      }
      const made = { label: p.label, body: p.body, features: p.names }
      const recorded = p.embed ? record(p.embed, p.body, p.names) : []
      useHw.setState({ made, plan: { input: asInput(args as PlanArgs), label: p.label, steps: p.steps, notes: p.notes, centres: p.centres, features: p.features, ...(p.face ? { face: p.face } : {}), ...(p.embed ? { embed: p.embed } : {}) } })
      return { cut: made, steps: p.steps, centres: p.centres, notes: p.notes, ...(p.printerFit ? { printerFit: p.printerFit } : {}), features: added.map((x) => ({ name: ((x.feature as Json | undefined)?.name ?? x.name) as string, status: status(x) ?? 'ok', ...((x.result as Json | null)?.warning ? { warning: (x.result as Json).warning } : {}) })), ...(recorded.length ? { encased: recorded.map(brief), next: 'hw.pauses gives the layer to pause at, and the pauses for slicer_slice.' } : {}) }
    } finally {
      useHw.setState({ busy: null })
    }
  },
}

const check: Command<{ body?: Ref; face?: number | Json; diameter?: number; depth?: number }> = {
  name: 'check',
  title: 'What a hole fits',
  description: 'A round hole on a Reverse Engineer body (body and face: its index or a query; reverse.body.describe lists them) — or a diameter given — against the table: each screw clearance, pilot, head counterbore, insert, magnet and bearing seat within 0.5 mm of the hole hw.plan would cut for it, nearest first — off (this hole less that one, mm), gap (as it should print, less the hardware: negative is interference) and the fit in words; shallow where the hole is not deep enough for it (a face’s depth is read off its area, so a part-round face such as a teardrop reads short). Changes nothing.',
  input: obj({ body: bodyRef, face: oneOf([int('', { minimum: 0 }), { type: 'object', description: 'A query, as reverse.body.describe takes where.' }], 'A round face of the body.'), diameter: num('A hole’s diameter, mm, in place of a face.', { exclusiveMinimum: 0 }), depth: num('Its depth, mm.', { exclusiveMinimum: 0 }) }),
  readOnly: true,
  run: async ({ body, face, diameter, depth }) => {
    let d = diameter
    let deep = depth
    let where: { body: string; face: number; axis?: V3 } | undefined
    if (face !== undefined || body !== undefined) {
      if (diameter !== undefined) invalid('Give a body and face, or a diameter — not both.')
      if (body === undefined || face === undefined) invalid('Give the body and its face.')
      const { body: name, face: f } = await oneFace(body!, face!)
      if (f.kind !== 'cylinder' || f.radius === undefined) invalid(`Face ${f.index} of ${name} is a ${f.kind}, not a round hole.`)
      if (f.side === 'boss') invalid(`Face ${f.index} of ${name} is a boss (a peg, not a hole).`)
      d = 2 * f.radius!
      deep = depth ?? (f.length !== undefined ? r3(f.length) : undefined)
      where = { body: name, face: f.index, ...(f.axis ? { axis: f.axis } : {}) }
    }
    if (d === undefined) invalid('Give a body and its round face, or a diameter.')
    const matches = fitsOf(d!, settings(), deep)
    useHw.setState({ check: { diameter: r3(d!), ...(deep !== undefined ? { depth: deep } : {}), ...(where ? { body: where.body, face: where.face } : {}), matches } })
    return { diameter: r3(d!), ...(deep !== undefined ? { depth: deep } : {}), ...(where ?? {}), matches, ...(matches.length === 0 ? { note: 'Nothing in the table is within 0.5 mm of the hole hw.plan would cut for it.' } : {}) }
  },
}

const clearPlan: Command<Record<string, never>> = {
  name: 'clear',
  title: 'Clear the plan',
  description: 'Put away the hole planned last and the last check. Changes no body.',
  input: obj({}),
  history: false,
  run: async () => {
    useHw.setState({ plan: null, check: null })
    return describeHw()
  },
}

const embed: Command<PlanArgs> = {
  name: 'embed',
  title: 'Plan an encased part',
  description: 'As hw.plan, for a part dropped in mid-print and printed over: a nut, magnet, bearing, insert (dropped in, not pressed hot) or object (a box or cylinder of your own — a weight, a tag), its pocket sunk under a roof (encase: { roof } or { roofLayers }; roofLayers × layerHeight by default) and closed all round. Where the hole is upright and the body built, the pocket’s top is put on a layer boundary. Returns the plan, each pocket’s top (Z, part frame), the roof, the span it bridges, the pause layer at the settings’ layers, and warnings: a thin roof, a span past bridgeMax, a top off a boundary. Changes nothing; hw.apply cuts it and records the pause.',
  input: obj({ ...planFields, pattern: patternIn }, ['kind', 'at']),
  readOnly: true,
  run: async (a) => {
    if (a.encase === false) invalid('encase: hw.embed always encases — use hw.plan for an open hole.')
    return planAndKeep({ ...a, encase: a.encase ?? true })
  },
}

interface RecordIn {
  body?: string
  top?: number
  what?: string
  span?: number
  roof?: number | null
  count?: number
  from?: 'mass'
}

const recordCmd: Command<RecordIn> = {
  name: 'record',
  title: 'Record an encased part',
  description: 'Record a pocket already in a body for a pause: its body, top (Z of the pocket’s top, part frame, mm), what goes in, and span (its roof’s shortest span), roof (material over it) and count if known. from: "mass" takes the ballast pocket the Mass workspace planned (mass.ballast) — its body, top, and the filler — before or after mass.apply cuts it. hw.pauses lists it with the rest.',
  input: obj({ body: str('The body, by name.', { minLength: 1 }), top: num('Z of the pocket’s top, part frame, mm.'), what: str('What goes in.', { minLength: 1 }), span: num('Its roof’s shortest span, mm.', { minimum: 0 }), roof: oneOf([num('mm', { minimum: 0 }), { type: 'null' }], 'Material over it, mm.'), count: int('How many.', { minimum: 1, maximum: 10000 }), from: enumOf(['mass'], 'The Mass workspace’s planned ballast pocket.') }),
  label: () => 'record encased part',
  run: async (a) => {
    let r: Omit<Embed, 'id'>
    const S = settings()
    const minRoof = r3(S.roofLayers * S.layerHeight)
    if (a.from === 'mass') {
      for (const k of ['body', 'top', 'span', 'roof', 'count'] as const) if (a[k] !== undefined) invalid(`${k}: from the Mass plan — leave it out.`)
      const m = readStateSections().mass as { pocket?: { body: string; at: number[]; size: number[]; count?: number; fillerMass?: number }; setup?: { filler?: string } } | undefined
      if (m === undefined) invalid('The Mass workspace is not in this build.')
      const pk = (m!.pocket ?? invalid('Mass has no ballast pocket planned: mass.ballast first (record it before mass.apply clears the plan, or give body and top).')) as { body: string; at: number[]; size: number[]; count?: number; fillerMass?: number; fits?: boolean; why?: string }
      if (pk.fits === false) invalid(`Mass’s pocket doesn’t fit, so it won’t be cut: ${pk.why ?? 'plan it again'}.`)
      if (!Array.isArray(pk.at) || !Array.isArray(pk.size) || pk.at.length !== 3 || pk.size.length !== 3) invalid('The Mass plan’s pocket is not one this reads.')
      const fid = String(m!.setup?.filler ?? 'filler')
      const filler = fid === 'steel-bb' ? 'steel BB' : fid.replace(/-/g, ' ')
      if (a.what !== undefined && (a.what.trim().length === 0 || a.what.length > 60)) invalid('what: 1 to 60 characters.')
      r = { body: pk.body, kind: 'ballast', label: 'Ballast', what: (a.what?.trim() || (pk.count ? `${pk.count} ${filler}s` : `${r3(pk.fillerMass ?? 0)} g of ${filler}`)).slice(0, 60), top: r3(pk.at[2] + pk.size[2] / 2), roof: null, minRoof, span: r3(Math.min(pk.size[0], pk.size[1])), count: 1, features: [], source: 'mass' }
    } else {
      if (a.body === undefined || a.top === undefined || a.what === undefined) invalid('Give body, top and what — or from: "mass".')
      if (a.what!.trim().length === 0 || a.what!.length > 60) invalid('what: 1 to 60 characters.')
      if (!Number.isFinite(a.top)) invalid('top: a number.')
      const bodies = ((readStateSections().reverse as { bodies?: { name: string }[] } | undefined)?.bodies ?? []).map((b) => b.name)
      if (bodies.length && !bodies.includes(a.body!)) invalid(`There is no body "${a.body}" (bodies: ${bodies.join(', ')}).`)
      r = { body: a.body!, kind: 'cavity', label: a.what!.trim(), what: a.what!.trim(), top: r3(a.top!), roof: a.roof ?? null, minRoof, span: r3(a.span ?? 0), count: a.count ?? 1, features: [] }
    }
    const bed = baseOf(r.body)
    if (bed !== null) r.bedZ = bed
    const all = [...st().embeds]
    if (all.some((e) => e.body === r.body && Math.abs(e.top - r.top) < EPS && e.what === r.what)) invalid(`${r.what} at ${r.top} in ${r.body} is recorded already.`)
    const one: Embed = { id: nextId(all), ...r }
    st().setEmbeds([...all, one])
    const warn = [
      ...(r.span > S.bridgeMax + EPS ? [`Warning: the roof spans ${r.span}, more than a safe bridge (${S.bridgeMax}): print the first layer over it as a bridge.`] : []),
      ...(r.roof !== null && r.roof < minRoof - EPS ? [`Warning: the roof is ${r.roof}, under ${minRoof}: it may print thin or open.`] : []),
    ]
    return { recorded: brief(one), ...(warn.length ? { warnings: warn } : {}), next: 'hw.pauses gives the layer to pause at.' }
  },
}

interface PausesIn {
  layerHeight?: number
  firstLayer?: number
  together?: string[]
  bodies?: string[]
}

/** The pauses for the encased parts: each pocket's top above the bed —
 *  its body's lowest point on the bed, or the lowest of the bodies printed
 *  together as one object — at the layers given or set. */
export function pausesOf(a: PausesIn = {}) {
  const S = settings()
  const layers = { height: a.layerHeight ?? S.layerHeight, first: a.firstLayer ?? S.firstLayer }
  try {
    pauseLayer(1, layers)
  } catch (e) {
    if (e instanceof PlanError) invalid(e.message)
    throw e
  }
  const feats = new Set((((readStateSections().reverse as { features?: { name: string }[] } | undefined)?.features) ?? []).map((f) => f.name))
  const all = st().embeds.filter((e) => !a.bodies || a.bodies.includes(e.body))
  const together = a.together && a.together.length ? a.together : null
  const unplaced: string[] = []
  const gone: string[] = []
  const outside: string[] = []
  const moved: string[] = []
  const items = []
  let groupBase: number | null = null
  if (together) {
    const bs = together.map(baseOf)
    if (bs.some((b) => b === null)) invalid(`No place on the bed for ${together.filter((_, i) => bs[i] === null).join(', ')}: is it built?`)
    groupBase = Math.min(...(bs as number[]))
  }
  for (const e of all) {
    if (e.features.length && !e.features.every((f) => feats.has(f))) {
      gone.push(e.id)
      continue
    }
    const base = together && together.includes(e.body) ? groupBase : baseOf(e.body)
    if (base === null) {
      unplaced.push(e.id)
      continue
    }
    if (e.bedZ !== undefined && Math.abs((baseOf(e.body) ?? e.bedZ) - e.bedZ) > 1e-3) moved.push(`${e.id}: ${e.body}’s bottom is at Z ${r3(baseOf(e.body)!)}, not ${r3(e.bedZ)} as when it was ${e.features.length ? 'cut' : 'recorded'} — if the body was moved, its pocket moved with it and this pause is wrong: cut or record it again.`)
    const z = r3(e.top - base)
    if (z <= 1e-4) {
      outside.push(`${e.id}: its top (Z ${e.top}) is not above ${e.body}’s bottom (Z ${r3(base)}) — left out.`)
      continue
    }
    const hi = zRange(e.body)?.[1]
    if (hi !== undefined && e.top >= hi - 1e-4) outside.push(`${e.id}: its top (Z ${e.top}) is at or over ${e.body}’s top (Z ${r3(hi)}): it can’t be printed over — left out.`)
    else items.push({ id: e.id, body: e.body, what: e.what, z })
  }
  let sched
  try {
    sched = schedule(items, layers)
  } catch (e) {
    if (e instanceof PlanError) invalid(e.message)
    throw e
  }
  const byId = new Map(all.map((e) => [e.id, e]))
  const warnings: string[] = []
  for (const p of sched) {
    if (!p.onBoundary) warnings.push(`Layer ${p.layer}: ${p.items.filter((i) => Math.abs(i.z - p.z) > EPS).map((i) => `${i.id} (top ${i.z})`).join(', ')} not on a layer boundary — the layer below may print closed over it; check the slice.`)
    for (const i of p.items) {
      const e = byId.get(i.id)!
      if (e.roof !== null && e.roof < e.minRoof - EPS) warnings.push(`${e.id}: roof ${e.roof}, under the ${e.minRoof} asked for.`)
      if (e.span > S.bridgeMax + EPS) warnings.push(`${e.id}: its roof spans ${e.span}, more than a safe bridge (${S.bridgeMax}) — layer ${p.layer} (Z ${p.printZ}) bridges it: print it as a bridge.`)
    }
  }
  return {
    layers: { height: layers.height, first: layers.first },
    pauses: sched.map((p) => ({ layer: p.layer, afterLayer: p.afterLayer, z: p.z, printZ: p.printZ, note: p.note, items: p.items.map((i) => ({ id: i.id, body: i.body, what: i.what, top: i.z })) })),
    slicer: { pauses: sched.map((p) => ({ z: Math.max(...p.items.map((i) => i.z)), note: p.note })) },
    ...(gone.length ? { gone: `${gone.join(', ')}: the features that cut ${gone.length === 1 ? 'it are' : 'them are'} gone — left out (hw.unembed to forget ${gone.length === 1 ? 'it' : 'them'}).` } : {}),
    ...(unplaced.length ? { unplaced: `${unplaced.join(', ')}: ${unplaced.length === 1 ? 'its body has' : 'their bodies have'} no place on the bed (not built?) — left out.` } : {}),
    ...(outside.length || moved.length || warnings.length ? { warnings: [...outside, ...moved, ...warnings] } : {}),
  }
}

const pauses: Command<PausesIn> = {
  name: 'pauses',
  title: 'Pauses for encased parts',
  description: 'The layers the print pauses at for the encased parts: for each, the layer to pause before (from 1; the first whose bottom is at or above the pocket’s top), the height above the bed it pauses at, the Z the slicer shows that layer at, and what to drop in — parts at one layer merged. Heights are above the bed: a body’s lowest point sits on it, or the lowest of together (bodies exported as one object). layerHeight and firstLayer as the slicer profile prints (the settings by default). slicer.pauses goes straight into slicer_slice { pauses }. Parts whose cut is gone, or whose body is not built, are left out and named. Changes nothing.',
  input: obj({ layerHeight: num('mm', { minimum: 0.01, maximum: 2 }), firstLayer: num('mm', { minimum: 0.01, maximum: 2 }), together: { type: 'array', items: { type: 'string' }, description: 'Bodies exported as one object (one STL): they share the bed.' }, bodies: { type: 'array', items: { type: 'string' }, description: 'Only these bodies’ parts.' } }),
  readOnly: true,
  run: async (a) => pausesOf(a),
}

const unembed: Command<{ id?: string; all?: boolean }> = {
  name: 'unembed',
  title: 'Forget an encased part',
  description: 'Take an encased part (id from hw.pauses) — or all of them — off the pause list. Its pocket stays cut in the body: remove those features in Reverse Engineer.',
  input: obj({ id: str('E1, E2…', { minLength: 1 }), all: bool('Every one.') }),
  label: (a) => (a.all ? 'forget encased parts' : `forget ${a.id ?? ''}`),
  run: async ({ id, all }) => {
    if ((id === undefined) === (all !== true)) invalid('Give id, or all: true.')
    const have = st().embeds
    if (all) {
      st().setEmbeds([])
      return { removed: have.map((e) => e.id) }
    }
    if (!have.some((e) => e.id === id)) invalid(`No encased part "${id}" (${have.map((e) => e.id).join(', ') || 'none recorded'}).`)
    st().setEmbeds(have.filter((e) => e.id !== id))
    return { removed: [id] }
  },
}

export const hwCommands = [list, set, plan, pattern, embed, apply, check, clearPlan, recordCmd, pauses, unembed] as Command<never>[]
