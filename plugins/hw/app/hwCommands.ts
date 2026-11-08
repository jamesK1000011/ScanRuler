// SPDX-License-Identifier: AGPL-3.0-only
// The Hardware workspace's commands (hw.*): the table of fasteners, inserts,
// magnets and bearings; the settings (allowances, clearance class, head and
// bridge figures); a hole planned — exactly what it would cut, and where —
// without changing anything; the plan cut into a Reverse Engineer body as
// named sketch and extrude-cut features, one undo step; a pattern of them;
// and a round hole already on a body checked against the table.

import { runWithin } from '../../../src/commands/registry'
import { bool, enumOf, int, num, obj, oneOf, str, vec3, type JsonSchema } from '../../../src/commands/schema'
import { readStateSections } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { fitsOf } from '../core/check'
import { featuresOf, overlapping, patternOffsets, type Pattern, type Placement, type V2, type V3 } from '../core/features'
import { FITS, type Fit, type Head, HEADS, type Kind, KINDS, sizesOf, table } from '../core/hardware'
import { cutDepth, DEFAULT_SETTINGS, planCut, PlanError, type Settings, type Spec } from '../core/plan'
import { settingsOf, useHw, type PlanInput, type PlanOut } from '../state/hwStore'

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

const specFields: Record<string, JsonSchema> = {
  kind: enumOf(KINDS, 'screw (clearance with a head recess), nut (hex trap), insert (heat-set), pilot (thread-forming screw), magnet (disc), bearing.'),
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
}

const planFields: Record<string, JsonSchema> = { ...specFields, at: atIn, name: str('The features’ base name; the hardware’s by default, numbered.', { minLength: 1 }) }

interface PlanArgs {
  kind: Kind
  size: string
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
}

/** Names already taken in Reverse Engineer, lower case. */
const takenNames = () => new Set((((readStateSections().reverse as { features?: { name: string }[] } | undefined)?.features) ?? []).map((f) => f.name.toLowerCase()))

function settings(): Settings {
  return settingsOf(st())
}

/** The plan, placed: what it cuts, where, and the features that cut it. */
async function planOf(a: PlanArgs) {
  if (a.name !== undefined && a.name.trim().length > 60) invalid('name: up to 60 characters.')
  const offsets = patternOffsets(a.pattern)
  const placed = await place(a.at, offsets)
  const spec: Spec = { kind: a.kind, size: a.size, head: a.head, fit: a.fit, depth: a.depth, sunk: a.sunk, shaft: a.shaft, relief: a.relief, allowance: a.allowance, teardrop: a.teardrop }
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
  const notes = [...cut.notes]
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
  }
}

const asInput = (a: PlanArgs): PlanInput => JSON.parse(JSON.stringify(a)) as PlanInput

// ---- the commands -------------------------------------------------------------------------

export function describeHw() {
  const s = st()
  return {
    settings: settingsOf(s),
    ...(s.plan ? { plan: { label: s.plan.label, input: s.plan.input, steps: s.plan.steps, centres: s.plan.centres, notes: s.plan.notes, ...(s.plan.stale ? { stale: 'the settings changed since: hw.apply plans it again with them' } : {}) } } : {}),
    ...(s.made ? { made: s.made } : {}),
    ...(s.check ? { check: { diameter: s.check.diameter, ...(s.check.body ? { body: s.check.body, face: s.check.face } : {}), best: s.check.matches.slice(0, 3) } } : {}),
  }
}

const list: Command<{ kind?: Kind }> = {
  name: 'list',
  title: 'The hardware table',
  description: 'Screws M2–M8 (ISO 273 clearances; ISO 4762, 7380 and 10642 heads), ISO 4032 nuts, heat-set inserts, thread-forming pilots, disc magnets and bearings, mm; with the settings that size the holes cut for them. kind narrows it to one kind’s sizes. Changes nothing.',
  input: obj({ kind: enumOf(KINDS, 'One kind’s sizes only.') }),
  readOnly: true,
  run: async ({ kind }) => ({ ...(kind ? { kind, sizes: sizesOf(kind) } : table()), settings: settingsOf(st()) }),
}

interface SetIn {
  allowance?: Partial<Record<Kind, number>> | number
  fit?: Fit
  headMargin?: number
  headSink?: number
  teardrop?: boolean
  bridgeLayer?: number
  insertExtra?: number
  magnetExtra?: number
  reset?: boolean
}

const lengthIn = (d: string, max: number) => num(`${d}, mm.`, { minimum: 0, maximum: max })

const set: Command<SetIn> = {
  name: 'set',
  title: 'Hole settings',
  description: 'How holes are sized: allowance (mm added to each diameter and across-flats, FDM holes printing small — one number for every kind, or by kind: screw 0.2, nut 0.2, insert 0, pilot 0, magnet 0.2, bearing 0.1 by default), fit (ISO 273 class, medium), headMargin (counterbore over the head, 0.4), headSink (head below the surface, 0.2), teardrop (level clearance holes, on), bridgeLayer (a sacrificial layer at each step of an upright hole, 0 for none), insertExtra (hole past the insert, 1), magnetExtra (pocket past the magnet, 0.2). reset: true for the defaults. Saved with the project.',
  input: obj({
    allowance: oneOf([num('Every kind, mm.', { minimum: -1, maximum: 2 }), obj(Object.fromEntries(KINDS.map((k) => [k, num('mm', { minimum: -1, maximum: 2 })])), [], 'By kind, mm.')], 'mm added to diameters.'),
    fit: enumOf(FITS),
    headMargin: lengthIn('Counterbore over the head', 3),
    headSink: lengthIn('Head below the surface', 5),
    teardrop: bool('Teardrop level clearance holes.'),
    bridgeLayer: lengthIn('Sacrificial layer at a step; 0 for none', 1),
    insertExtra: lengthIn('Hole past the insert', 5),
    magnetExtra: lengthIn('Pocket past the magnet', 3),
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
  input: obj({ ...planFields, pattern: patternIn }, ['kind', 'size', 'at']),
  readOnly: true,
  run: async (a) => planAndKeep(a),
}

async function planAndKeep(a: PlanArgs) {
  const p = await planOf(a)
  const out: PlanOut = { input: asInput(a), label: p.label, steps: p.steps, notes: p.notes, centres: p.centres, features: p.features, ...(p.face ? { face: p.face } : {}) }
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
  description: 'Cut the hole hw.plan or hw.pattern planned — or the one given here, as hw.plan takes it — into its Reverse Engineer body: a sketch per step on a plane square to the hole and an extrude cut into that body alone, named after the hardware ("M3 cap screw 1 head"), so each stays editable there. Planned afresh from the body as it stands. One undo step; if any feature fails to build, none is kept. Returns the features and their status.',
  input: obj({ ...planFields, pattern: patternIn }),
  label: (a) => `cut ${a.kind ? `${a.size ?? ''} ${a.kind}` : 'planned hole'}`.replace(/\s+/g, ' '),
  run: async (a) => {
    const asked = a.kind !== undefined
    if (asked && (a.size === undefined || a.at === undefined)) invalid('Give kind, size and at — or nothing, to cut the hole planned last.')
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
      useHw.setState({ made, plan: { input: asInput(args as PlanArgs), label: p.label, steps: p.steps, notes: p.notes, centres: p.centres, features: p.features, ...(p.face ? { face: p.face } : {}) } })
      return { cut: made, steps: p.steps, centres: p.centres, notes: p.notes, features: added.map((x) => ({ name: ((x.feature as Json | undefined)?.name ?? x.name) as string, status: status(x) ?? 'ok', ...((x.result as Json | null)?.warning ? { warning: (x.result as Json).warning } : {}) })) }
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

export const hwCommands = [list, set, plan, pattern, apply, check, clearPlan] as Command<never>[]
