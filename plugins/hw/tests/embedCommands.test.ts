// SPDX-License-Identifier: AGPL-3.0-only
// The encased-part commands as an agent runs them, against a stand-in for
// Reverse Engineer: a 40 × 40 × 10 block on the bed (its lowest point Z 0)
// and a second body standing 5 up whose top is off the layer grid. A pocket
// sunk under its roof from the top, from below and from the side; its top
// put on a layer boundary; the warnings (thin roof, wide span, off a
// boundary); cut and recorded; the pauses, merged and for two bodies; the
// Mass workspace's ballast recorded; a cut that is gone; and the refusals.
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { registerCommands, runCommand } from '../../../src/commands/registry'
import { registerStateSection } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { hwCommands } from '../app/hwCommands'
import { DEFAULT_SETTINGS } from '../core/plan'
import { settingsOf, useHw } from '../state/hwStore'

type V3 = [number, number, number]
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]]

const face = (index: number, centroid: V3, normal: V3) => ({ index, kind: 'plane', centroid, normal, area: 1600, fingerprint: { kind: 'plane', centroid, dir: normal } })
const BODIES: Record<string, { id: number; faces: Json[]; bounds: { min: V3; max: V3 } }> = {
  Block: { id: 1, faces: [face(0, [0, 0, 10], [0, 0, 1]), face(1, [0, 0, 0], [0, 0, -1]), face(2, [20, 0, 5], [1, 0, 0]), face(3, [0, -18, 9], [0, -0.6, 0.8])], bounds: { min: [-20, -20, 0], max: [20, 20, 10] } },
  Raised: { id: 2, faces: [face(0, [60, 0, 15.3], [0, 0, 1])], bounds: { min: [40, -20, 5], max: [80, 20, 15.3] } },
}
let mass: Json | undefined
let features: Json[] = []
let hasBounds = true

function frameOf(p: Json): { origin: V3; normal: V3; basisU: V3; basisV: V3 } {
  const off = (p.offset as number) ?? 0
  if (p.kind === 'world') {
    const [n, u, v]: V3[] = p.axis === 'z' ? [[0, 0, 1], [1, 0, 0], [0, 1, 0]] : p.axis === 'x' ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : [[0, 1, 0], [0, 0, 1], [1, 0, 0]]
    return { origin: add([0, 0, 0], n, off), normal: n, basisU: u, basisV: v }
  }
  if (p.kind === 'radial') {
    const a = (p.angleDeg * Math.PI) / 180
    const u: V3 = [Math.cos(a), Math.sin(a), 0]
    const v: V3 = [0, 0, 1]
    return { origin: add([0, 0, 0], cross(u, v), off), normal: cross(u, v), basisU: u, basisV: v }
  }
  if (p.kind === 'bodyFace') {
    const fp = p.face as { centroid: V3; dir: V3 }
    const n = fp.dir
    const u: V3 = [1, 0, 0]
    return { origin: add(fp.centroid, n, off), normal: n, basisU: u, basisV: cross(n, u) }
  }
  throw new CommandError('invalid_input', `plane ${p.kind}`)
}

const anyIn = { type: 'object', additionalProperties: true } as never
const fake: Command<Json>[] = [
  {
    name: 'body.describe',
    title: 'describe',
    description: 'd',
    input: anyIn,
    readOnly: true,
    run: async ({ body, limit }) => {
      const name = typeof body === 'number' ? Object.keys(BODIES).find((k) => BODIES[k].id === body) : body
      const b = name ? BODIES[name] : undefined
      if (!b) throw new CommandError('not_found', `There is no body ${body}.`)
      return { bodies: [{ name, faceList: b.faces.slice(0, limit ?? b.faces.length) }] }
    },
  },
  {
    name: 'plane.describe',
    title: 'plane',
    description: 'p',
    input: anyIn,
    readOnly: true,
    run: async ({ plane, point }) => {
      const f = frameOf(plane)
      const d = sub(point, f.origin)
      return { ...f, point: { at: [dot(d, f.basisU), dot(d, f.basisV)], above: dot(d, f.normal) } }
    },
  },
  {
    name: 'feature.add',
    title: 'add',
    description: 'a',
    input: anyIn,
    run: async ({ features: list }) => {
      features.push(...list)
      return { added: list.map((f: Json) => ({ feature: { name: f.name, status: 'ok' }, result: { status: 'ok' } })) }
    },
  },
  {
    name: 'feature.remove',
    title: 'remove',
    description: 'r',
    input: anyIn,
    run: async ({ feature }) => {
      features = features.filter((f) => f.name !== feature)
      return { removed: feature }
    },
  },
]

beforeAll(() => {
  registerCommands('reverse', fake as Command<never>[])
  registerCommands('hw', hwCommands)
  registerStateSection('reverse', () => ({ features: features.map((f) => ({ name: f.name })), bodies: Object.entries(BODIES).map(([name, b]) => ({ id: b.id, name, bounds: hasBounds ? b.bounds : null })) }))
  registerStateSection('mass', () => mass)
})

const reset = () => {
  features = []
  mass = undefined
  hasBounds = true
  useHw.setState({ ...settingsOf(DEFAULT_SETTINGS), plan: null, made: null, check: null, embeds: [], busy: null })
}
beforeEach(reset)

const run = (name: string, input: Json = {}) => runCommand(`hw.${name}`, input) as Promise<Json>
const refused = async (p: Promise<unknown>, re: RegExp) => {
  let err: unknown
  try {
    await p
  } catch (e) {
    err = e
  }
  expect(err instanceof Error).toBe(true)
  if (!re.test((err as Error).message)) throw new Error(`"${(err as Error).message}" does not match ${re}`)
}
const warnings = (p: Json) => (p.notes as string[]).filter((n) => n.startsWith('Warning'))

describe('hw.embed', () => {
  test('a magnet from the top face: sunk under 3 layers, top on a boundary, its pause', async () => {
    const p = await run('embed', { kind: 'magnet', size: '6x3', at: { body: 'Block', face: 0 } })
    expect(p.steps[0]).toMatchObject({ role: 'pocket', diameter: 6.3, from: 0.6, to: 3.8 })
    expect(p.embed).toEqual({ kind: 'magnet', label: '6x3 magnet', what: 'a 6x3 magnet', tops: [9.4], roof: 0.6, minRoof: 0.6, span: 6.3, pauses: [{ layer: 48, z: 9.4, printZ: 9.6, onBoundary: true }], bedZ: 0 })
    expect(warnings(p)).toEqual([])
    // The cut starts under the surface: closed above.
    const cut = p.features.find((f: Json) => f.kind === 'extrude')
    expect(Math.min(Math.abs(cut.extent.from), Math.abs(cut.extent.to))).toBeCloseTo(0.6, 6)
    expect(useHw.getState().plan!.embed!.tops).toEqual([9.4])
  })

  test('the roof made thicker to put the top on a boundary, from a body standing 5 up', async () => {
    // Its top is 10.3 above the bed: 10.3 − 0.6 = 9.7 is off the grid; 9.6 is on it.
    const p = await run('embed', { kind: 'magnet', size: '6x3', at: { body: 'Raised', face: 0 } })
    expect(p.embed.roof).toBe(0.7)
    expect(p.embed.tops).toEqual([14.6])
    expect(p.embed.pauses[0]).toEqual({ layer: 49, z: 9.6, printZ: 9.8, onBoundary: true })
    expect(p.notes.some((n: string) => /Roof made 0\.7 \(from 0\.6\)/.test(n))).toBe(true)
  })

  test('cut up from the bottom face: the pocket made deeper onto a boundary, the roof the body’s own', async () => {
    const p = await run('embed', { kind: 'object', object: { shape: 'cylinder', diameter: 8, height: 2.05 }, what: 'a steel slug', at: { body: 'Block', face: 1 } })
    // 0.6 up, 2.25 deep: top 2.85, raised to 3.0.
    expect(p.steps[0]).toMatchObject({ from: 0.6, to: 3 })
    expect(p.embed).toMatchObject({ tops: [3], roof: null, what: 'a steel slug' })
    expect(p.notes.some((n: string) => /Pocket made 2\.4 deep/.test(n))).toBe(true)
    expect(p.notes.some((n: string) => /body's own/.test(n))).toBe(true)
  })

  test('from the side: straight sides up to a flat top on a boundary, so the part drops in', async () => {
    const p = await run('embed', { kind: 'magnet', size: '6x3', at: { body: 'Block', face: 2 } })
    // Ø6.3: its top 3.15 over the centre (Z 5), raised to 8.2 on the grid.
    expect(p.steps[0]).toMatchObject({ riser: 3.2, from: 0.6 })
    expect(p.steps[0].teardrop).toBe(undefined)
    expect(p.embed.tops[0]).toBeCloseTo(8.2, 6)
    expect(p.embed.pauses[0]).toMatchObject({ layer: 42, onBoundary: true })
    expect(p.notes.some((n: string) => /Level pocket: straight sides/.test(n))).toBe(true)
    expect(warnings(p)).toEqual([])
    // A nut stands on a corner, its sides run up from its middle.
    const n = await run('embed', { kind: 'nut', size: 'M3', shaft: false, at: { body: 'Block', face: 2 } })
    const R = 5.8 / 2 / Math.cos(Math.PI / 6)
    expect(n.steps[0].riser >= R - 1e-9).toBe(true)
    expect(n.embed.tops[0]).toBeCloseTo(5 + n.steps[0].riser, 6)
  })

  test('refused: slanted, out through a side, a level box turned off upright', async () => {
    await refused(run('embed', { kind: 'magnet', size: '6x3', at: { body: 'Block', face: 3 } }), /straight down, straight up or level/)
    await refused(run('embed', { kind: 'magnet', size: '6x3', at: { body: 'Block', face: 0, point: [19, 0, 10] } }), /break out of Block: 2\.15 past Block’s X side/)
    const near = await run('embed', { kind: 'magnet', size: '6x3', at: { body: 'Block', face: 0, point: [16.7, 0, 10] } })
    expect(warnings(near).some((w: string) => /within 0\.15 of Block’s side/.test(w))).toBe(true)
    await refused(run('embed', { kind: 'object', object: { shape: 'box', size: [5, 5, 2], angleDeg: 30 }, at: { body: 'Block', face: 2 } }), /sides upright/)
    expect((await run('embed', { kind: 'object', object: { shape: 'box', size: [5, 5, 2] }, at: { body: 'Block', face: 2 } })).embed.tops[0]).toBeCloseTo(5 + 2.65, 6)
  })

  test('warned: a roof under the layers asked for, a span past a safe bridge (and the layer that bridges)', async () => {
    const thin = await run('embed', { kind: 'magnet', size: '6x3', encase: { roof: 0.3 }, at: { body: 'Block', face: 0 } })
    expect(thin.embed.roof).toBe(0.4)
    expect(warnings(thin)[0]).toMatch(/roof is 0\.4, under 3 layers \(0\.6\)/)
    const wide = await run('embed', { kind: 'object', object: { shape: 'box', size: [30, 20, 3] }, at: { body: 'Block', face: 0 } })
    expect(wide.embed.span).toBe(20.3)
    expect(warnings(wide)[0]).toMatch(/spans 20\.3, more than a safe bridge \(10\)\. Layer 48 \(Z 9\.6\) bridges it/)
    // roofLayers: 5 → 1.0 of roof.
    expect((await run('embed', { kind: 'magnet', size: '6x3', encase: { roofLayers: 5 }, at: { body: 'Block', face: 0 } })).embed.roof).toBe(1)
  })

  test('refused out through the far side; warned close to it', async () => {
    await refused(run('embed', { kind: 'object', object: { shape: 'cylinder', diameter: 5, height: 9.5 }, at: { body: 'Block', face: 0 } }), /out under Block/)
    const near = await run('embed', { kind: 'object', object: { shape: 'cylinder', diameter: 5, height: 9 }, at: { body: 'Block', face: 1 } })
    expect(near.embed.tops).toEqual([9.8])
    expect(warnings(near).some((w: string) => /top is only 0\.2 over the pocket/.test(w))).toBe(true)
    await refused(run('embed', { kind: 'object', object: { shape: 'cylinder', diameter: 5, height: 9.5 }, at: { body: 'Block', face: 1 } }), /reaches Block’s top/)
    const thin = await run('embed', { kind: 'magnet', size: '6x3', encase: { roof: 0.2 }, at: { body: 'Block', face: 1 } })
    expect(warnings(thin).some((w: string) => /floor under the pocket is 0\.2/.test(w))).toBe(true)
  })

  test('a pattern: one pocket each, one height', async () => {
    const p = await run('embed', { kind: 'nut', size: 'M3', at: { body: 'Block', face: 0 }, pattern: { kind: 'rectangle', width: 20, height: 20 } })
    expect(p.embed.tops).toEqual([9.4, 9.4, 9.4, 9.4])
    expect(p.embed.what).toBe('an M3 nut ×4')
  })

  test('the body not built: no place on the bed, so no pause yet — said so', async () => {
    hasBounds = false
    const p = await run('embed', { kind: 'magnet', size: '6x3', at: { body: 'Block', face: 0 } })
    expect(p.embed.pauses).toBe(undefined)
    expect(p.notes.some((n: string) => /place on the bed was not read/.test(n))).toBe(true)
  })

  test('refused', async () => {
    await refused(run('embed', { kind: 'screw', size: 'M3', at: { body: 'Block', face: 0 } }), /not dropped in/)
    await refused(run('embed', { kind: 'nut', size: 'M3', slot: { length: 10 }, at: { body: 'Block', face: 0 } }), /slot: not with encase/)
    await refused(run('embed', { kind: 'magnet', size: '6x3', depth: null, at: { body: 'Block', face: 0 } }), /has a floor/)
    await refused(run('embed', { kind: 'magnet', size: '6x3', encase: false, at: { body: 'Block', face: 0 } }), /always encases/)
    await refused(run('embed', { kind: 'magnet', size: '6x3', encase: { roof: 1, roofLayers: 2 }, at: { body: 'Block', face: 0 } }), /not both/)
    await refused(run('embed', { kind: 'object', size: 'M3', object: { shape: 'cylinder', diameter: 3, height: 3 }, at: { body: 'Block', face: 0 } }), /hardware’s only/)
    await refused(run('embed', { kind: 'magnet', size: '6x3', encase: { roof: 9.9 }, at: { body: 'Block', face: 0 } }), /inside the first layer/)
    await refused(run('plan', { kind: 'object', object: { shape: 'cylinder', diameter: 3, height: 3 }, at: { body: 'Block', face: 0 } }), /encased pocket only/)
    await refused(run('plan', { kind: 'magnet', size: '6x3', what: 'x', at: { body: 'Block', face: 0 } }), /encased pocket’s only/)
    // An open hole still plans as before.
    expect((await run('plan', { kind: 'magnet', size: '6x3', at: { body: 'Block', face: 0 } })).embed).toBe(undefined)
  })
})

describe('cut, recorded, and the pauses', () => {
  test('hw.apply cuts the encased pocket and records it; hw.pauses gives the layer and slicer_slice’s input', async () => {
    await run('embed', { kind: 'magnet', size: '6x3', what: 'a 6x3 magnet, N up', at: { body: 'Block', face: 0 } })
    const cut = await run('apply')
    expect(cut.encased).toEqual([{ id: 'E1', body: 'Block', what: 'a 6x3 magnet, N up', top: 9.4, roof: 0.6 }])
    expect(useHw.getState().embeds[0].features).toEqual(cut.cut.features)
    const p = await run('pauses')
    expect(p.pauses).toEqual([{ layer: 48, afterLayer: 47, z: 9.4, printZ: 9.6, note: 'Insert a 6x3 magnet, N up', items: [{ id: 'E1', body: 'Block', what: 'a 6x3 magnet, N up', top: 9.4 }] }])
    expect(p.slicer).toEqual({ pauses: [{ z: 9.4, note: 'Insert a 6x3 magnet, N up' }] })
    // At the slicer's layers: 0.28 with a 0.2 first layer.
    const q = await run('pauses', { layerHeight: 0.28, firstLayer: 0.2 })
    expect(q.pauses[0].layer).toBe(2 + Math.ceil((9.4 - 0.2 - 1e-4) / 0.28))
    expect(q.warnings[0]).toMatch(/not on a layer boundary/)
    // Planned at the slicer's layers, the top lands on its grid.
    await run('set', { layerHeight: 0.28, firstLayer: 0.2 })
    const r = await run('embed', { kind: 'magnet', size: '6x3', at: { body: 'Block', face: 0, point: [10, 10, 10] } })
    expect(r.embed.pauses[0].onBoundary).toBe(true)
    expect(r.embed.tops[0]).toBeCloseTo(10 - 0.84, 6)
    expect(r.embed.roof).toBe(0.84)
  })

  test('two on one layer merged; two bodies each on the bed, or together as one object', async () => {
    await run('record', { body: 'Block', top: 4, what: 'an RFID tag', span: 25 })
    await run('record', { body: 'Raised', top: 9, what: 'an M3 nut' })
    const p = await run('pauses')
    expect(p.pauses.map((x: Json) => [x.layer, x.note])).toEqual([[21, 'Insert an RFID tag, an M3 nut']])
    expect(p.warnings.some((w: string) => /E1: its roof spans 25/.test(w))).toBe(true)
    const t = await run('pauses', { together: ['Block', 'Raised'] })
    expect(t.pauses.map((x: Json) => x.layer)).toEqual([21, 46])
    expect((await run('pauses', { bodies: ['Raised'] })).pauses.map((x: Json) => x.layer)).toEqual([21])
    await refused(run('record', { body: 'Block', top: 4, what: 'an RFID tag' }), /recorded already/)
    await refused(run('record', { body: 'Nope', top: 4, what: 'x' }), /no body "Nope"/)
    await refused(run('record', { body: 'Block', what: 'x' }), /Give body, top and what/)
    await refused(run('pauses', { together: ['Block', 'Gone'] }), /No place on the bed for Gone/)
  })

  test('pockets out of their body left out of the pauses, said so; a thin roof recorded warned', async () => {
    await run('record', { body: 'Block', top: -1, what: 'under' })
    await run('record', { body: 'Block', top: 12, what: 'over' })
    await run('record', { body: 'Block', top: 4, what: 'fine' })
    const p = await run('pauses')
    expect(p.pauses.map((x: Json) => x.note)).toEqual(['Insert fine'])
    expect(p.warnings.filter((w: string) => /left out/.test(w)).length).toBe(2)
    const r = await run('record', { body: 'Block', top: 5, what: 'thin', roof: 0.2 })
    expect(r.warnings[0]).toMatch(/roof is 0\.2, under 0\.6/)
  })

  test('the Mass workspace’s ballast pocket recorded: its top, its BBs', async () => {
    await refused(run('record', { from: 'mass' }), /not in this build/)
    mass = { setup: { filler: 'steel-bb' } }
    await refused(run('record', { from: 'mass' }), /mass\.ballast first/)
    mass = { setup: { filler: 'steel-bb' }, pocket: { body: 'Block', at: [0, 0, 4], size: [12, 10, 4], count: 120, fillerMass: 44.4 } }
    mass = { setup: { filler: 'steel-bb' }, pocket: { body: 'Block', at: [0, 0, 4], size: [12, 10, 4], count: 120, fits: false, why: 'it reaches the surface' } }
    await refused(run('record', { from: 'mass' }), /doesn’t fit.*reaches the surface/)
    mass = { setup: { filler: 'steel-bb' }, pocket: { body: 'Block', at: [0, 0, 4], size: [12, 10, 4], count: 120, fillerMass: 44.4, fits: true } }
    await refused(run('record', { from: 'mass', count: 2 }), /from the Mass plan/)
    const r = await run('record', { from: 'mass' })
    expect(r.recorded).toEqual({ id: 'E1', body: 'Block', what: '120 steel BBs', top: 6, roof: null, source: 'mass' })
    expect((await run('pauses')).pauses[0]).toMatchObject({ layer: 31, z: 6 })
    await refused(run('record', { from: 'mass', top: 3 }), /from the Mass plan/)
  })

  test('a cut that is gone is left out and named; forgotten by id or all', async () => {
    await run('apply', { kind: 'magnet', size: '6x3', encase: true, at: { body: 'Block', face: 0 } })
    await run('record', { body: 'Block', top: 4, what: 'a tag' })
    features = features.slice(1)
    const p = await run('pauses')
    expect(p.gone).toMatch(/^E1: the features that cut it are gone/)
    expect(p.pauses.map((x: Json) => x.items[0].id)).toEqual(['E2'])
    await refused(run('unembed', {}), /Give id, or all/)
    await refused(run('unembed', { id: 'E9' }), /No encased part "E9"/)
    expect((await run('unembed', { id: 'E1' })).removed).toEqual(['E1'])
    expect((await run('unembed', { all: true })).removed).toEqual(['E2'])
    expect(useHw.getState().embeds).toEqual([])
  })

  test('a body moved since its pocket was cut: said so', async () => {
    await run('embed', { kind: 'magnet', size: '6x3', at: { body: 'Block', face: 0 } })
    await run('apply')
    expect(useHw.getState().embeds[0].bedZ).toBe(0)
    expect((await run('pauses')).warnings).toBe(undefined)
    const was = BODIES.Block.bounds
    BODIES.Block.bounds = { min: [-20, -20, 3], max: [20, 20, 13] }
    try {
      expect((await run('pauses')).warnings.some((w: string) => /E1: Block’s bottom is at Z 3, not 0 .* moved/.test(w))).toBe(true)
    } finally {
      BODIES.Block.bounds = was
    }
  })

  test('the state section names what is encased', async () => {
    await run('record', { body: 'Block', top: 4, what: 'a tag' })
    const r = await run('list', { kind: 'magnet' })
    expect(r.settings.roofLayers).toBe(3)
    const { describeHw } = await import('../app/hwCommands')
    expect(describeHw().encased).toEqual([{ id: 'E1', body: 'Block', what: 'a tag', top: 4, roof: null }])
  })
})

// ---- the pocket built in OCCT -------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type K = any
let occt: Promise<K> | null = null
const kernel = () => (occt ??= import('occt-wasm').then((m) => m.OcctKernel.init()))
const P3 = (p: V3) => ({ x: p[0], y: p[1], z: p[2] })

/** The plan's features built on the block as Reverse Engineer reads them:
 *  each sketch's shapes on its plane's sheet, extruded between the extent's
 *  offsets along the normal and cut. Open lines close on their ends. */
function buildBlock(k: K, feats: Json[]) {
  let block = k.makeBoxFromCorners(P3([-20, -20, 0]), P3([20, 20, 10]))
  const sketches = new Map(feats.filter((f) => f.kind === 'sketch').map((f) => [f.name, f]))
  for (const f of feats.filter((x) => x.kind === 'extrude')) {
    const sk = sketches.get(f.sketchId)!
    const fr = frameOf(sk.plane)
    const e = f.extent as { from: number; to: number }
    const lo = Math.min(e.from, e.to), hi = Math.max(e.from, e.to)
    const w = (q: number[], t: number) => add(add(add(fr.origin, fr.basisU, q[0]), fr.basisV, q[1]), fr.normal, t)
    const solids = (sk.sketch.shapes as Json[]).map((sh) => {
      let pts: number[][]
      if (sh.kind === 'circle') pts = Array.from({ length: 180 }, (_, i) => [sh.center[0] + sh.radius * Math.cos((i * Math.PI) / 90), sh.center[1] + sh.radius * Math.sin((i * Math.PI) / 90)])
      else if (sh.kind === 'polygon') {
        const R = sh.radius / Math.cos(Math.PI / 6)
        const a0 = (sh.angleDeg * Math.PI) / 180 - Math.PI / 6
        pts = Array.from({ length: 6 }, (_, i) => [sh.center[0] + R * Math.cos(a0 + (i * Math.PI) / 3), sh.center[1] + R * Math.sin(a0 + (i * Math.PI) / 3)])
      } else pts = sh.points
      const ws = pts.map((q) => w(q, lo))
      const face = k.makeFace(k.makeWire(ws.map((p, i) => k.makeLineEdge(P3(p), P3(ws[(i + 1) % ws.length])))))
      const d = hi - lo
      return k.extrude(face, fr.normal[0] * d, fr.normal[1] * d, fr.normal[2] * d)
    })
    block = k.cut(block, solids.length === 1 ? solids[0] : k.fuseAll(solids))
  }
  return block
}

describe('the encased pocket in OCCT', () => {
  test('from the top: closed under three whole layers, open below its top', async () => {
    const k = await kernel()
    const p = await run('embed', { kind: 'magnet', size: '6x3', at: { body: 'Block', face: 0 } })
    const b = buildBlock(k, p.features)
    // The roof: each of its three layers solid over the centre and to the rim.
    for (const z of [9.5, 9.7, 9.9]) for (const x of [0, 3.1]) expect(k.containsPoint(b, P3([x, 0, z]))).toBe(true)
    // Under the top: open to its rim, then the wall.
    for (const z of [9.35, 7, 6.25]) {
      expect(k.containsPoint(b, P3([3.1, 0, z]))).toBe(false)
      expect(k.containsPoint(b, P3([3.2, 0, z]))).toBe(true)
    }
    expect(k.containsPoint(b, P3([0, 0, 6.15]))).toBe(true)
    expect(k.getVolume(b)).toBeCloseTo(16000 - Math.PI * 3.15 * 3.15 * 3.2, 0)
    k.releaseAll()
  })

  test('from the side: the part drops in — open as wide as it from its middle to the flat top, closed over it', async () => {
    const k = await kernel()
    const p = await run('embed', { kind: 'magnet', size: '6x3', at: { body: 'Block', face: 2 } })
    const b = buildBlock(k, p.features)
    const x = 20 - 0.6 - 1.6 // mid-depth
    // Every height from the centre (Z 5) to the top (8.2): open across the magnet's 6.
    for (let z = 5; z < 8.2 - 1e-9; z += 0.4) for (const y of [-3.05, 0, 3.05]) expect(k.containsPoint(b, P3([x, y, z]))).toBe(false)
    expect(k.containsPoint(b, P3([x, 0, 8.15]))).toBe(false)
    // The roof over it: solid at once above the top, to the block's top.
    for (const z of [8.25, 9, 9.9]) expect(k.containsPoint(b, P3([x, 0, z]))).toBe(true)
    // Round below the centre: the magnet's seat.
    expect(k.containsPoint(b, P3([x, 0, 5 - 3.1]))).toBe(false)
    expect(k.containsPoint(b, P3([x, 3, 5 - 1.5]))).toBe(true)
    // Closed at the side face (the roof along the hole) and behind.
    expect(k.containsPoint(b, P3([19.7, 0, 5]))).toBe(true)
    expect(k.containsPoint(b, P3([20 - 3.8 - 0.1, 0, 5]))).toBe(true)
    k.releaseAll()
  })

  test('a nut from the side: on a corner below, straight sides above, its flats’ width open to the top', async () => {
    const k = await kernel()
    const p = await run('embed', { kind: 'nut', size: 'M3', shaft: false, at: { body: 'Block', face: 2 } })
    const b = buildBlock(k, p.features)
    const x = 20 - 0.6 - 1
    const top = p.embed.tops[0]
    for (let z = 5; z < top - 1e-9; z += 0.3) for (const y of [-2.85, 0, 2.85]) expect(k.containsPoint(b, P3([x, y, z]))).toBe(false)
    expect(k.containsPoint(b, P3([x, 0, top + 0.05]))).toBe(true)
    // The corner down.
    expect(k.containsPoint(b, P3([x, 0, 5 - 3.3]))).toBe(false)
    expect(k.containsPoint(b, P3([x, 2.85, 5 - 2.5]))).toBe(true)
    k.releaseAll()
  })
})
