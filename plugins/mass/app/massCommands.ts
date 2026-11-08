// SPDX-License-Identifier: AGPL-3.0-only
// The Mass workspace's commands (mass.*): how heavy a part comes out as
// printed, where it balances and how it turns — from the Reverse Engineer
// bodies' meshes, with walls and infill counted — calibrated against a
// print on the scales; a target mass and balance point; and the ballast
// pocket that reaches it, cut into the part as Reverse Engineer features.

import { runCommand } from '../../../src/commands/registry'
import { arr, enumOf, int, num, obj, str, vec3 } from '../../../src/commands/schema'
import { readStateSections } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { ballast, combine, FILLERS, inside, massOf, MATERIALS, readStl, type V3 } from '../core/mass'
import { setupOf, useMass, type BodyMass, type Pocket } from '../state/massStore'

const st = () => useMass.getState()
const r3 = (x: number) => Math.round(x * 1000) / 1000
const v3 = (v: V3) => v.map(r3) as V3

interface ReverseBody {
  id: number
  name: string
  visible: boolean
  surface?: boolean
}

const solids = (): ReverseBody[] => ((readStateSections().reverse as { bodies?: ReverseBody[] } | undefined)?.bodies ?? []).filter((b) => !b.surface)

/** The density printed: the material's, or the one given, times the
 *  calibration. g/cm³. */
const density = () => (st().density ?? MATERIALS[st().material]?.density ?? 1.24) * st().scale
const print = () => ({ density: density(), infill: st().infill / 100, wallMm: st().walls * st().lineMm })

const meshes = new Map<string, { key: string; tris: Float64Array }>()

async function trianglesOf(body: string): Promise<Float64Array> {
  const r = (await runCommand('reverse.export.stl', { bodies: [body], chord: 0.05 })) as { file?: { bytes: Uint8Array } }
  if (!r?.file?.bytes) throw new CommandError('failed', `${body} gave no mesh.`)
  return readStl(r.file.bytes)
}

async function measure(names?: string[]): Promise<BodyMass[]> {
  const all = solids()
  if (!all.length) throw new CommandError('invalid_state', 'There is no solid body to weigh: build one in Reverse Engineer (or import a STEP there) first.')
  const picked = names?.length ? names.map((n) => all.find((b) => b.name === n) ?? fail(n, all)) : all.filter((b) => b.visible)
  if (!picked.length) throw new CommandError('invalid_state', 'No body is shown: name the bodies (bodies).')
  const out: BodyMass[] = []
  for (const b of picked) {
    const tris = await trianglesOf(b.name)
    meshes.set(b.name, { key: String(tris.length), tris })
    const p = massOf(tris, print())
    out.push({ body: b.name, volume: r3(p.volume), area: r3(p.area), mass: r3(p.mass), com: v3(p.com), inertia: p.inertia.map((row) => row.map(r3)) as BodyMass['inertia'], principal: { moments: v3(p.principal.moments), axes: p.principal.axes.map(v3) as [V3, V3, V3] }, closed: p.closed })
  }
  return out
}

function fail(n: string, all: ReverseBody[]): never {
  throw new CommandError('invalid_input', `There is no body "${n}" (bodies: ${all.map((b) => b.name).join(', ')}).`)
}

export function describeMass() {
  const s = st()
  return {
    setup: setupOf(s),
    density: r3(density()),
    ...(s.reading ? { reading: { at: s.reading.at, total: { mass: r3(s.reading.total.mass), com: v3(s.reading.total.com) }, bodies: s.reading.bodies.map((b) => ({ body: b.body, mass: b.mass, com: b.com })) } } : {}),
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
  description: 'The material (pla, petg, abs, asa, petg-cf, pa6-cf, tpu) or its density (g/cm³; null for the material’s), the infill (percent), the walls (count) and line width (mm) — the walls taken as solid, the inside at the infill’s share — and the ballast filler (mass.materials lists them). Returns the setup and the density used.',
  input: obj({
    material: enumOf(Object.keys(MATERIALS)),
    density: { oneOf: [num('g/cm³.', { exclusiveMinimum: 0, maximum: 25 }), { type: 'null' }], description: 'The density in place of the material’s, g/cm³; null for the material’s.' },
    infill: num('Percent, 0 (walls only) to 100 (solid).', { minimum: 0, maximum: 100 }),
    walls: int('Walls (perimeters).', { minimum: 0, maximum: 50 }),
    lineMm: num('Line width, mm.', { exclusiveMinimum: 0, maximum: 3 }),
    filler: enumOf(Object.keys(FILLERS)),
  }),
  history: false,
  run: async ({ material, density: d, infill, walls, lineMm, filler }) => {
    st().set({ ...(material ? { material } : {}), ...(d !== undefined ? { density: d ?? undefined } : {}), ...(infill !== undefined ? { infill } : {}), ...(walls !== undefined ? { walls } : {}), ...(lineMm !== undefined ? { lineMm } : {}), ...(filler ? { filler } : {}) })
    useMass.setState({ reading: null, pocket: null })
    return describeMass()
  },
}

const properties: Command<{ bodies?: string[] }> = {
  name: 'properties',
  title: 'Weigh the part',
  description: 'Mass (g), volume (mm³), surface (mm²), centre of mass (mm) and inertia about it (g·mm², with principal moments and axes) of each body — the shown solid bodies by default — printed as set up, and of them together. closed: false means a mesh with holes, whose volume is not to trust. Reads the bodies as meshed now.',
  input: obj({ bodies: arr(str(undefined, { minLength: 1 }), 'Bodies by name.', { minItems: 1 }) }),
  readOnly: true,
  long: true,
  run: async ({ bodies }) => weigh(bodies),
}

async function weigh(bodies?: string[]) {
  {
    useMass.setState({ busy: 'Weighing…' })
    try {
      const list = await measure(bodies)
      const total = combine(list)
      const reading = { at: new Date().toISOString(), bodies: list, total: { mass: r3(total.mass), com: v3(total.com), inertia: total.inertia.map((row) => row.map(r3)) as BodyMass['inertia'] } }
      useMass.setState({ reading })
      return { density: r3(density()), ...reading, ...(list.some((b) => !b.closed) ? { note: `Not closed: ${list.filter((b) => !b.closed).map((b) => b.body).join(', ')} — its volume is not to trust.` } : {}) }
    } finally {
      useMass.setState({ busy: null })
    }
  }
}

const calibrate: Command<{ grams?: number; body?: string; reset?: boolean }> = {
  name: 'calibrate',
  title: 'Calibrate from a print on the scales',
  description: 'A print weighed (grams) against what it works out to, printed as set up: the density is scaled by the difference, so every reading after matches your printer and spool. reset: true goes back to the material’s figures. Weigh a print of the same material, infill and walls.',
  input: obj({ grams: num('What the print weighs, g.', { exclusiveMinimum: 0 }), body: str('The body printed; the only one shown by default.'), reset: { type: 'boolean' } }),
  history: false,
  run: async ({ grams, body, reset }) => {
    if (reset) {
      st().set({ scale: 1 })
      return describeMass()
    }
    if (grams === undefined) throw new CommandError('invalid_input', 'Give the weighed grams, or reset: true.')
    const was = st().scale
    st().set({ scale: 1 })
    try {
      const [b] = await measure(body ? [body] : undefined)
      st().set({ scale: grams / b.mass })
    } catch (e) {
      st().set({ scale: was })
      throw e
    }
    return { ...describeMass(), scale: r3(st().scale) }
  },
}

const target: Command<{ mass?: number; com?: V3; clear?: boolean }> = {
  name: 'target',
  title: 'The mass and balance point wanted',
  description: 'What the part should weigh (g) and where it should balance (com, mm in the part’s frame) — a training replica matching the real thing, a handle that sits right in the hand. clear: true takes it away.',
  input: obj({ mass: num('g.', { exclusiveMinimum: 0 }), com: vec3('mm, part frame.'), clear: { type: 'boolean' } }),
  history: false,
  run: async ({ mass, com, clear }) => {
    if (clear) {
      st().set({ target: null })
      useMass.setState({ pocket: null })
    }
    else {
      if (mass === undefined && com === undefined) throw new CommandError('invalid_input', 'Give the mass wanted, the balance point, or both.')
      st().set({ target: { ...(st().target ?? {}), ...(mass !== undefined ? { mass } : {}), ...(com ? { com } : {}) } })
      useMass.setState({ pocket: null })
    }
    return describeMass()
  },
}

/** A pocket's size for a volume: as given, or a cube; a width and depth
 *  given, the height follows. */
function sizeFor(volume: number, w?: number, d?: number): V3 {
  if (w && d) return [w, d, volume / (w * d)]
  if (w) return [w, Math.sqrt(volume / w), Math.sqrt(volume / w)]
  const s = Math.cbrt(volume)
  return [s, s, s]
}

const plan: Command<{ body?: string; filler?: string; width?: number; depth?: number }> = {
  name: 'ballast',
  title: 'Plan the ballast',
  description: 'The pocket that brings the part to the target: its centre (mm), its size (a cube, or width × depth with the height to suit), the filler’s mass and how much part it takes out — solved so mass and balance point both land on the target. Says whether the pocket fits inside the body (every corner in it, with a 1 mm skin), and why not. mass.apply cuts it. Weighs the part first if needed.',
  input: obj({ body: str('The body to cut it into; the only one shown by default.'), filler: enumOf(Object.keys(FILLERS)), width: num('mm along X.', { exclusiveMinimum: 0 }), depth: num('mm along Y.', { exclusiveMinimum: 0 }) }),
  readOnly: true,
  long: true,
  run: async ({ body, filler, width, depth }) => {
    const t = st().target
    if (!t) throw new CommandError('invalid_state', 'Set the target first (mass.target { mass, com }).')
    if (filler) st().set({ filler })
    const fill = FILLERS[st().filler]
    if (!st().reading) await weigh()
    const reading = st().reading!
    const name = body ?? (reading.bodies.length === 1 ? reading.bodies[0].body : null)
    if (!name) throw new CommandError('invalid_input', `Say which body the pocket goes in (body): ${reading.bodies.map((b) => b.body).join(', ')}.`)
    const there = (st().density ?? MATERIALS[st().material].density) * st().scale * (st().infill / 100)
    const r = ballast(reading.total, t, fill, there)
    if (!r.ok) throw new CommandError('invalid_state', r.why)
    const size = sizeFor(r.volume, width, depth)
    const mesh = meshes.get(name)?.tris ?? (await trianglesOf(name))
    const skin = 1
    const corners: V3[] = []
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push([r.at[0] + sx * (size[0] / 2 + skin), r.at[1] + sy * (size[1] / 2 + skin), r.at[2] + sz * (size[2] / 2 + skin)])
    const out = corners.filter((c) => !inside(mesh, c)).length
    const fits = inside(mesh, r.at) && out === 0
    const pocket: Pocket = {
      body: name,
      at: v3(r.at),
      size: v3(size),
      volume: r3(r.volume),
      fillerMass: r3(r.fillerMass),
      removedMass: r3(r.removedMass),
      ...(st().filler === 'steel-bb' ? { count: Math.round(r.fillerMass / 0.37) } : {}),
      fits,
      ...(fits ? {} : { why: inside(mesh, r.at) ? `${out} of its corners are outside ${name} (with a 1 mm skin): give a width and depth that fit, or a balance point further in.` : `The balance point asked for needs the ballast at (${v3(r.at).join(', ')}), outside ${name}: move the target in, or ask for more mass.` }),
    }
    useMass.setState({ pocket })
    return { pocket, filler: fill.label, note: fill.note }
  },
}

const apply: Command<{ name?: string }> = {
  name: 'apply',
  title: 'Cut the ballast pocket',
  description: 'Cut the planned pocket into its body as Reverse Engineer features — a sketch of its rectangle on the XY plane at its floor, and an extrude cut up its height into that body alone — so it stays editable there. One undo step in Reverse Engineer. Seal it with a lid or a plug: the features don’t make one.',
  input: obj({ name: str('The features’ name; "Ballast" by default.') }),
  run: async ({ name = 'Ballast' }) => {
    const p = st().pocket
    if (!p) throw new CommandError('invalid_state', 'Plan it first: mass.ballast.')
    if (!p.fits) throw new CommandError('invalid_state', `The pocket doesn’t fit: ${p.why}`)
    const [x, y, z] = p.at
    const [w, d, h] = p.size
    const sketch = `${name} pocket`
    const r = await runCommand('reverse.feature.add', {
      features: [
        { kind: 'sketch', name: sketch, plane: { kind: 'world', axis: 'z', offset: r3(z - h / 2) }, sketch: { shapes: [{ kind: 'rectangle', id: 1, from: [r3(x - w / 2), r3(y - d / 2)], to: [r3(x + w / 2), r3(y + d / 2)] }] } },
        { kind: 'extrude', name, sketchId: sketch, regions: 'all', extent: { kind: 'distance', from: 0, to: r3(h) }, op: 'cut', target: p.body },
      ],
    })
    useMass.setState({ reading: null })
    return { cut: { sketch, extrude: name, body: p.body }, reverse: r }
  },
}

export const massCommands = [materials, setup, properties, calibrate, target, plan, apply] as Command<never>[]
