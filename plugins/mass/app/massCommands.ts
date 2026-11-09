// SPDX-License-Identifier: AGPL-3.0-only
// The Mass workspace's commands (mass.*): how heavy a part comes out as
// printed, where it balances and how it turns — from the Reverse Engineer
// bodies' meshes, with walls and infill counted — calibrated against a
// print on the scales; a target mass and balance point; and the ballast
// pocket that reaches it, cut into the part as Reverse Engineer features.

import { runCommand, runWithin } from '../../../src/commands/registry'
import { arr, enumOf, int, num, obj, str, vec3 } from '../../../src/commands/schema'
import { readStateSection } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { ballast, BB_GRAMS, boxInside, combine, FILLERS, freeName, inside, type M3, massOf, MATERIALS, pocketSize, readStl, type V3 } from '../core/mass'
import { setupOf, useMass, type BodyMass, type EmbeddedMass, type Pocket } from '../state/massStore'
import { MATERIAL_NAMES, materialId } from '../../_shared/materials'

const st = () => useMass.getState()
const r3 = (x: number) => Math.round(x * 1000) / 1000
const v3 = (v: V3) => v.map(r3) as V3

interface ReverseBody {
  id: number
  name: string
  visible: boolean
  volume?: number
  faces?: number
  surface?: boolean
}
interface ReverseFeature {
  name?: string
}

// One section, not all: the readout's mass part reads this, and all of them
// would read it again.
const reverse = () => (readStateSection('reverse') ?? {}) as { bodies?: ReverseBody[]; features?: ReverseFeature[] }
const solids = (): ReverseBody[] => (reverse().bodies ?? []).filter((b) => !b.surface)
/** The solid bodies as they stand: a reading or a plan of others is stale. */
const bodiesKey = () => JSON.stringify(solids().map((b) => [b.id, b.name, b.visible, b.volume ?? null, b.faces ?? null]))

/** The encased parts as they stand (the Hardware workspace's list): a
 *  reading made with others is stale. */
const embedsKey = () => JSON.stringify((readStateSection('hw') as { encased?: unknown } | undefined)?.encased ?? null)

interface HwPart {
  id: string
  body: string
  what: string
  material: string
  mass: number
  centres: V3[]
  inertia: M3
}

/** The parts encased in these bodies — a magnet, a nut dropped in at a
 *  pause — read from the Hardware workspace (hw.masses), each set of
 *  copies as one, about its own centre; and those whose weight it does not
 *  know, said. None where the workspace is not in the build. */
async function encased(names: string[]): Promise<{ parts: EmbeddedMass[]; notes: string[] }> {
  let r: { parts?: HwPart[]; uncounted?: { id: string; body: string; what: string }[]; warnings?: string[] }
  try {
    r = (await runCommand('hw.masses', { bodies: names })) as typeof r
  } catch (e) {
    if (e instanceof CommandError && e.code === 'unknown_command') return { parts: [], notes: [] }
    throw e
  }
  const parts = (r.parts ?? []).map((p) => {
    const all = combine(p.centres.map((com) => ({ mass: p.mass, com, inertia: p.inertia })))
    return { id: p.id, body: p.body, what: p.what, count: p.centres.length, material: p.material, mass: r3(all.mass), com: v3(all.com), inertia: all.inertia.map((row) => row.map(r3)) as M3 }
  })
  const notes = [...(r.uncounted?.length ? [`Not counted, weight not known: ${r.uncounted.map((u) => `${u.what} in ${u.body} (${u.id})`).join(', ')}. Give its grams in hw.embed, or in hw.record for a pocket recorded there.`] : []), ...(r.warnings ?? [])]
  return { parts, notes }
}

/** The density printed: the material's, or the one given, times the
 *  calibration. g/cm³. */
const density = (scale = st().scale) => (st().density ?? MATERIALS[st().material]?.density ?? 1.24) * scale
const print = (scale?: number) => ({ density: density(scale), infill: st().infill / 100, wallMm: st().walls * st().lineMm })

/** The meshes last read, each with the bodies as they stood then. */
const meshes = new Map<number, { key: string; tris: Float64Array }>()

async function trianglesOf(body: ReverseBody): Promise<Float64Array> {
  const r = (await runCommand('reverse.export.stl', { bodies: [body.id], chord: 0.05 })) as { file?: { bytes: Uint8Array } }
  if (!r?.file?.bytes) throw new CommandError('failed', `${body.name} gave no mesh.`)
  try {
    return readStl(r.file.bytes)
  } catch (e) {
    throw new CommandError('failed', `${body.name}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function bodiesNamed(names?: string[]): ReverseBody[] {
  const all = solids()
  if (!all.length) throw new CommandError('invalid_state', 'There is no solid body to weigh: build one in Reverse Engineer (or import a STEP there) first.')
  const picked = names?.length ? [...new Set(names)].map((n) => all.find((b) => b.name === n) ?? fail(n, all)) : all.filter((b) => b.visible)
  if (!picked.length) throw new CommandError('invalid_state', 'No body is shown: name the bodies (bodies).')
  return picked
}

async function measure(picked: ReverseBody[], how = print()): Promise<BodyMass[]> {
  const key = bodiesKey()
  const out: BodyMass[] = []
  for (const b of picked) {
    const tris = await trianglesOf(b)
    meshes.set(b.id, { key, tris })
    const p = massOf(tris, how)
    out.push({ body: b.name, volume: r3(p.volume), area: r3(p.area), mass: r3(p.mass), com: v3(p.com), inertia: p.inertia.map((row) => row.map(r3)) as BodyMass['inertia'], principal: { moments: v3(p.principal.moments), axes: p.principal.axes.map(v3) as [V3, V3, V3] }, closed: p.closed })
  }
  return out
}

function fail(n: string, all: ReverseBody[]): never {
  throw new CommandError('invalid_input', `There is no solid body "${n}" (bodies: ${all.map((b) => b.name).join(', ')}).`)
}

/** Weighings under way: the panel is busy while any is. */
let weighing = 0

export function describeMass() {
  const s = st()
  return {
    setup: setupOf(s),
    density: r3(density()),
    ...(s.reading ? { reading: { at: s.reading.at, ...(s.reading.bodiesKey !== bodiesKey() || (s.reading.embedsKey ?? embedsKey()) !== embedsKey() ? { stale: true } : {}), total: { mass: r3(s.reading.total.mass), com: v3(s.reading.total.com) }, bodies: s.reading.bodies.map((b) => ({ body: b.body, mass: b.mass, com: b.com })), ...(s.reading.embedded?.length ? { embedded: s.reading.embedded.map((e) => ({ id: e.id, body: e.body, what: e.what, mass: e.mass, com: e.com })) } : {}) } } : {}),
    ...(s.pocket ? { pocket: s.pocket } : {}),
  }
}

const materials: Command<Record<string, never>> = {
  name: 'materials',
  title: 'The materials and fillers',
  description: 'The printed materials (density, g/cm³) and the ballast fillers (their density as packed in a pocket, g/cm³) the Mass workspace knows. Changes nothing.',
  input: obj({}),
  readOnly: true,
  run: async () => ({ materials: MATERIALS, fillers: FILLERS }),
}

const setup: Command<{ material?: string; density?: number | null; infill?: number; walls?: number; lineMm?: number; filler?: string }> = {
  name: 'setup',
  title: 'How the part is printed',
  description: 'The material (pla, petg, abs, asa, petg-cf, pa6-cf, tpu-95a) or its density (g/cm³; null for the material’s — a material picked alone also goes back to its own), the infill (percent), the walls (count) and line width (mm) — the walls taken as solid all round, the inside at the infill’s share — and the ballast filler (mass.materials lists them). Returns the setup and the density used.',
  input: obj({
    material: enumOf(MATERIAL_NAMES),
    density: { oneOf: [num('g/cm³.', { minimum: 0.01, maximum: 25 }), { type: 'null' }], description: 'The density in place of the material’s, g/cm³; null for the material’s.' },
    infill: num('Percent, 0 (walls only) to 100 (solid).', { minimum: 0, maximum: 100 }),
    walls: int('Walls (perimeters).', { minimum: 0, maximum: 50 }),
    lineMm: num('Line width, mm.', { minimum: 0.05, maximum: 3 }),
    filler: enumOf(Object.keys(FILLERS)),
  }),
  history: false,
  run: async ({ material: named, density: d, infill, walls, lineMm, filler }) => {
    const material = named === undefined ? undefined : materialId(named)
    const dens = d !== undefined ? { density: d ?? undefined } : material ? { density: undefined } : {}
    st().set({ ...(material ? { material } : {}), ...dens, ...(infill !== undefined ? { infill } : {}), ...(walls !== undefined ? { walls } : {}), ...(lineMm !== undefined ? { lineMm } : {}), ...(filler ? { filler } : {}) })
    useMass.setState({ reading: null, pocket: null })
    return describeMass()
  },
}

const properties: Command<{ bodies?: string[] }> = {
  name: 'properties',
  title: 'Weigh the part',
  description: 'Mass (g), volume (mm³), surface (mm²), centre of mass (mm) and inertia about it (g·mm², with principal moments and axes) of each body — the shown solid bodies by default — printed as set up, and of them together. Parts encased in them (the Hardware workspace’s: a magnet, a nut dropped in at a pause) are listed under embedded with their mass and centre, and counted in the total; embeddedMass is theirs alone. closed: false means a mesh with holes or faces wound both ways, whose volume is not to trust. Reads the bodies as meshed now.',
  input: obj({ bodies: arr(str(undefined, { minLength: 1 }), 'Bodies by name.', { minItems: 1 }) }),
  readOnly: true,
  long: true,
  run: async ({ bodies }) => weigh(bodies),
}

async function weigh(bodies?: string[]) {
  const picked = bodiesNamed(bodies)
  const how = print()
  const key = bodiesKey()
  weighing++
  useMass.setState({ busy: 'Weighing…' })
  try {
    const list = await measure(picked, how)
    const eKey = embedsKey()
    const held = await encased(picked.map((b) => b.name))
    const total = combine([...list, ...held.parts])
    const reading = { at: new Date().toISOString(), bodiesKey: key, embedsKey: eKey, bodies: list, ...(held.parts.length ? { embedded: held.parts } : {}), total: { mass: r3(total.mass), com: v3(total.com), inertia: total.inertia.map((row) => row.map(r3)) as BodyMass['inertia'] } }
    // Set up otherwise while it weighed: this reading is not of the setup now.
    if (JSON.stringify(print()) === JSON.stringify(how)) useMass.setState({ reading })
    const notes = [...(list.some((b) => !b.closed) ? [`Not closed: ${list.filter((b) => !b.closed).map((b) => b.body).join(', ')} — its volume is not to trust.`] : []), ...held.notes]
    const { embedsKey: _k, ...out } = reading
    void _k
    return { density: r3(how.density), ...out, ...(held.parts.length ? { embeddedMass: r3(held.parts.reduce((t, p) => t + p.mass, 0)) } : {}), ...(notes.length ? { note: notes.join(' ') } : {}) }
  } finally {
    if (--weighing === 0) useMass.setState({ busy: null })
  }
}

/** How far a calibration may move the figures: past this the print was
 *  not made as set up. */
const SCALE_MIN = 0.2
const SCALE_MAX = 5

const calibrate: Command<{ grams?: number; body?: string; reset?: boolean }> = {
  name: 'calibrate',
  title: 'Calibrate from a print on the scales',
  description: 'A print weighed (grams) against what it works out to, printed as set up: the density is scaled by the difference (0.2 to 5 times), so every reading after matches your printer and spool. Parts encased in it (hw.masses) are taken off the grams first: weigh it with them in. reset: true goes back to the material’s figures. Weigh a print of the same material, infill and walls. body: the body printed — needed when more than one is shown.',
  input: obj({ grams: num('What the print weighs, g.', { exclusiveMinimum: 0 }), body: str('The body printed; the only one shown by default.'), reset: { type: 'boolean' } }),
  history: false,
  run: async ({ grams, body, reset }) => {
    if (reset) {
      st().set({ scale: 1 })
      useMass.setState({ reading: null, pocket: null })
      return describeMass()
    }
    if (grams === undefined) throw new CommandError('invalid_input', 'Give the weighed grams, or reset: true.')
    const picked = bodiesNamed(body ? [body] : undefined)
    if (picked.length > 1) throw new CommandError('invalid_input', `More than one body is shown: say which was printed (body): ${picked.map((b) => b.name).join(', ')}.`)
    weighing++
    useMass.setState({ busy: 'Weighing…' })
    let b: BodyMass
    let held: Awaited<ReturnType<typeof encased>>
    try {
      ;[b] = await measure(picked, print(1))
      held = await encased([b.body])
    } finally {
      if (--weighing === 0) useMass.setState({ busy: null })
    }
    if (!(b.mass > 0)) throw new CommandError('invalid_state', `${b.body} works out to no mass as set up (no walls and no infill?): nothing to scale.`)
    // The print on the scales holds its encased parts: the plastic is the rest.
    const parts = r3(held.parts.reduce((t, p) => t + p.mass, 0))
    const plastic = grams - parts
    if (!(plastic > 0)) throw new CommandError('invalid_input', `${grams} g is no more than the parts encased in ${b.body} weigh (${parts} g): weigh the print with them in.`)
    const scale = plastic / b.mass
    if (!(scale >= SCALE_MIN && scale <= SCALE_MAX)) throw new CommandError('invalid_input', `${grams} g${parts ? ` (${r3(plastic)} g less the encased parts)` : ''} against ${r3(b.mass)} g worked out is ×${r3(scale)}: more than ${SCALE_MIN} to ${SCALE_MAX} times off — check the material, infill and walls match the print.`)
    st().set({ scale })
    useMass.setState({ reading: null, pocket: null })
    const notes = [...(parts ? [`${parts} g of encased parts taken off the grams.`] : []), ...(b.closed ? [] : [`${b.body}’s mesh is not closed: its volume is not to trust.`]), ...held.notes]
    return { ...describeMass(), scale: r3(scale), ...(notes.length ? { note: notes.join(' ') } : {}) }
  },
}

const target: Command<{ mass?: number | null; com?: V3 | null; clear?: boolean }> = {
  name: 'target',
  title: 'The mass and balance point wanted',
  description: 'What the part should weigh (g) and where it should balance (com, mm in the part’s frame) — a training replica matching the real thing, a handle that sits right in the hand. One given keeps the other as set; null drops it. clear: true takes it away.',
  input: obj({
    mass: { oneOf: [num('g.', { exclusiveMinimum: 0 }), { type: 'null' }], description: 'g; null drops it.' },
    com: { oneOf: [vec3('mm, part frame.'), { type: 'null' }], description: 'mm, part frame; null drops it.' },
    clear: { type: 'boolean' },
  }),
  history: false,
  run: async ({ mass, com, clear }) => {
    if (clear) st().set({ target: null })
    else {
      if (mass === undefined && com === undefined) throw new CommandError('invalid_input', 'Give the mass wanted, the balance point, or both.')
      const next: { mass?: number; com?: V3 } = { ...(st().target ?? {}) }
      if (mass === null) delete next.mass
      else if (mass !== undefined) next.mass = mass
      if (com === null) delete next.com
      else if (com !== undefined) next.com = com
      st().set({ target: next.mass !== undefined || next.com !== undefined ? next : null })
    }
    useMass.setState({ pocket: null })
    return describeMass()
  },
}

const plan: Command<{ body?: string; filler?: string; width?: number; depth?: number }> = {
  name: 'ballast',
  title: 'Plan the ballast',
  description: 'The pocket that brings the part to the target: its centre (mm), its size (a cube, or width and depth with the rest to suit), the filler’s mass, how much part it takes out and the walls printed round it — solved so mass and balance point both land on the target. Says whether the pocket fits inside the body (clear of its surface by a skin of the walls, 1 mm at least), and why not. mass.apply cuts it. Weighs the part again if it has changed.',
  input: obj({ body: str('The body to cut it into; the only one weighed by default.'), filler: enumOf(Object.keys(FILLERS)), width: num('mm along X.', { exclusiveMinimum: 0 }), depth: num('mm along Y.', { exclusiveMinimum: 0 }) }),
  readOnly: true,
  long: true,
  run: async ({ body, filler, width, depth }) => {
    const t = st().target
    if (!t) throw new CommandError('invalid_state', 'Set the target first (mass.target { mass, com }).')
    useMass.setState({ pocket: null })
    if (filler) st().set({ filler })
    const fill = FILLERS[st().filler]
    if (!st().reading || st().reading!.bodiesKey !== bodiesKey() || (st().reading!.embedsKey ?? embedsKey()) !== embedsKey()) await weigh()
    const reading = st().reading
    if (!reading) throw new CommandError('failed', 'The setup changed while the part was weighed: plan again.')
    const name = body ?? (reading.bodies.length === 1 ? reading.bodies[0].body : null)
    if (!name) throw new CommandError('invalid_input', `Say which body the pocket goes in (body): ${reading.bodies.map((b) => b.body).join(', ')}.`)
    const into = solids().find((b) => b.name === name) ?? fail(name, solids())
    const how = print()
    const there = how.density * how.infill
    const r = ballast(reading.total, t, fill, there, {
      density: how.density * (1 - how.infill),
      t: how.wallMm,
      area: (v) => {
        const [a, b, c] = pocketSize(v, width, depth)
        return 2 * (a * b + b * c + c * a)
      },
      edge: (v) => {
        const [a, b, c] = pocketSize(v, width, depth)
        return 4 * (a + b + c)
      },
    })
    if (!r.ok) throw new CommandError('invalid_state', r.why)
    const size = pocketSize(r.volume, width, depth)
    const cached = meshes.get(into.id)
    const mesh = cached?.key === bodiesKey() ? cached.tris : await trianglesOf(into)
    const skin = Math.max(1, how.wallMm)
    const min = [0, 1, 2].map((i) => r.at[i] - size[i] / 2 - skin) as V3
    const max = [0, 1, 2].map((i) => r.at[i] + size[i] / 2 + skin) as V3
    const centred = inside(mesh, r.at)
    const clear = centred && boxInside(mesh, min, max)
    const small = fill.grain !== undefined && Math.min(...size) < fill.grain
    const fits = clear && !small
    const why = !centred
      ? `The balance point asked for needs the ballast at (${v3(r.at).join(', ')}), outside ${name}: move the target in, or ask for more mass.`
      : !clear
        ? `It reaches ${name}’s surface (with a ${r3(skin)} mm skin): give a width and depth that fit, or a balance point further in.`
        : `${r3(Math.min(...size))} mm is too narrow for ${fill.label.toLowerCase()}: give a width and depth of ${fill.grain} mm or more, or another filler.`
    const pocket: Pocket = {
      body: name,
      at: v3(r.at),
      size: v3(size),
      volume: r3(r.volume),
      fillerMass: r3(r.fillerMass),
      removedMass: r3(r.removedMass),
      wallMass: r3(r.wallMass),
      ...(st().filler === 'steel-bb' ? { count: Math.round(r.fillerMass / BB_GRAMS) } : {}),
      fits,
      ...(fits ? {} : { why }),
      bodiesKey: reading.bodiesKey,
    }
    useMass.setState({ pocket })
    return { pocket, filler: fill.label, note: fill.note }
  },
}

const apply: Command<{ name?: string }> = {
  name: 'apply',
  title: 'Cut the ballast pocket',
  description: 'Cut the planned pocket into its body as Reverse Engineer features — a sketch of its rectangle on the XY plane at its floor, and an extrude cut up its height into that body alone — so it stays editable there. Named "Ballast" (then "Ballast 2" …) unless named here. One undo step in Reverse Engineer. Seal it with a lid or a plug: the features don’t make one.',
  input: obj({ name: str('The features’ name; "Ballast" by default.', { minLength: 1 }) }),
  run: async ({ name }) => {
    const p = st().pocket
    if (!p) throw new CommandError('invalid_state', 'Plan it first: mass.ballast.')
    if (!p.fits) throw new CommandError('invalid_state', `The pocket doesn’t fit: ${p.why}`)
    if (p.bodiesKey !== bodiesKey()) throw new CommandError('invalid_state', 'The bodies have changed since the pocket was planned: plan it again (mass.ballast).')
    const into = solids().find((b) => b.name === p.body)
    if (!into) throw new CommandError('invalid_state', `There is no body "${p.body}" now: plan it again.`)
    const taken = (reverse().features ?? []).flatMap((f) => (f.name ? [f.name] : []))
    const extrude = freeName(name?.trim() || 'Ballast', taken, ['', ' pocket'])
    const sketch = `${extrude} pocket`
    const [x, y, z] = p.at
    const [w, d, h] = p.size
    const r = await runWithin('reverse.feature.add', {
      features: [
        { kind: 'sketch', name: sketch, plane: { kind: 'world', axis: 'z', offset: r3(z - h / 2) }, sketch: { shapes: [{ kind: 'rectangle', id: 1, from: [r3(x - w / 2), r3(y - d / 2)], to: [r3(x + w / 2), r3(y + d / 2)] }] } },
        { kind: 'extrude', name: extrude, sketchId: sketch, regions: 'all', extent: { kind: 'distance', from: 0, to: r3(h) }, op: 'cut', target: into.id },
      ],
    })
    // Cut: the reading is of the part before, and the plan is spent.
    useMass.setState({ reading: null, pocket: null })
    return { cut: { sketch, extrude, body: p.body }, reverse: r }
  },
}

/** Every one runs without the page (Command.headless): the bodies are read
 *  through Reverse Engineer's STL export, the pocket cut through its
 *  features — no scan, no viewport. */
export const massCommands = ([materials, setup, properties, calibrate, target, plan, apply] as Command<never>[]).map((c) => ({ ...c, headless: true }))
