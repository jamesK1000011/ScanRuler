// SPDX-License-Identifier: AGPL-3.0-only
// The hw.* commands run as an agent runs them, against a stand-in for
// Reverse Engineer: a 20 × 20 × 10 block with a bore and a tilted face, its
// planes framed as reverse.plane.describe frames them, its feature list
// kept. A hole placed on a face, along an axis, level and tilted; the cut
// made through reverse.feature.add inside hw.apply's own step (no wait on
// itself), numbered, and taken out again whole when a feature fails; a
// pattern; a slot's way; a hole checked; the settings.
import { beforeAll, describe, expect, test } from 'vitest'
import { runCommand, registerCommands } from '../../../src/commands/registry'
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

const tilt: V3 = [0, 0.6, 0.8]
const FACES = [
  { index: 0, kind: 'plane', centroid: [0, 0, 10], normal: [0, 0, 1] },
  { index: 1, kind: 'plane', centroid: [0, 0, 0], normal: [0, 0, -1] },
  { index: 2, kind: 'plane', centroid: [10, 0, 5], normal: [1, 0, 0] },
  { index: 3, kind: 'plane', centroid: [-10, 0, 5], normal: [-1, 0, 0] },
  { index: 4, kind: 'cylinder', centroid: [5, 5, 5], axis: [0, 0, 1], radius: 1.8, length: 10, side: 'bore' },
  { index: 5, kind: 'plane', centroid: [0, 6, 8], normal: tilt },
  { index: 6, kind: 'cylinder', centroid: [-5, -5, 12], axis: [0, 0, 1], radius: 3, length: 4, side: 'boss' },
].map((f) => ({ ...f, area: 100, fingerprint: { kind: f.kind, centroid: f.centroid, dir: f.normal ?? f.axis, area: 1, origin: 1 } }))

/** A plane's frame as reverse.plane.describe gives it. */
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
    const n = cross(u, v)
    return { origin: add([0, 0, 0], n, off), normal: n, basisU: u, basisV: v }
  }
  if (p.kind === 'bodyFace') {
    const f = FACES.find((x) => JSON.stringify(x.fingerprint) === JSON.stringify(p.face))!
    const n = f.normal as V3
    const u: V3 = [1, 0, 0]
    return { origin: add(f.centroid as V3, n, off), normal: n, basisU: u, basisV: cross(n, u) }
  }
  throw new CommandError('invalid_input', 'plane')
}

let features: Json[] = []
const anyIn = { type: 'object', additionalProperties: true } as never
const fake: Command<Json>[] = [
  {
    name: 'body.describe',
    title: 'describe',
    description: 'd',
    input: anyIn,
    readOnly: true,
    run: async ({ body, limit }) => {
      if (body !== 'Block' && body !== 1) throw new CommandError('not_found', `There is no body ${body}.`)
      return { bodies: [{ name: 'Block', faceList: FACES.slice(0, limit ?? FACES.length) }] }
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
      return { added: list.map((f: Json) => ({ feature: { name: f.name, status: 'ok' }, result: { status: String(f.name).includes('Bad') && f.kind === 'extrude' ? 'failed' : 'ok', message: 'the cut missed' } })) }
    },
  },
  {
    name: 'feature.remove',
    title: 'remove',
    description: 'r',
    input: anyIn,
    run: async ({ feature }) => {
      if (String(feature).startsWith('Stuck') && String(feature).endsWith('sketch')) throw new CommandError('invalid_state', 'in use')
      features = features.filter((f) => f.name !== feature)
      return { removed: feature }
    },
  },
]

/** The Block's box, given in the tests that read it. */
let blockBounds: { min: V3; max: V3 } | null = null

beforeAll(() => {
  registerCommands('reverse', fake as Command<never>[])
  registerCommands('hw', hwCommands)
  registerStateSection('reverse', () => ({ features: features.map((f) => ({ name: f.name })), bodies: [{ id: 1, name: 'Block', ...(blockBounds ? { bounds: blockBounds } : {}) }] }))
})

const plan = (input: Json) => runCommand('hw.plan', input) as Promise<Json>
const refused = async (p: Promise<unknown>, re: RegExp) => {
  let err: unknown
  try {
    await p
  } catch (e) {
    err = e
  }
  expect(err instanceof CommandError).toBe(true)
  if (!re.test((err as Error).message)) throw new Error(`"${(err as Error).message}" does not say ${re}`)
}

/** A feature's sketch plane put through the entry point at its depth. */
function planeDepth(p: Json, entry: V3, dir: V3): number {
  const f = frameOf(p)
  // The plane's depth below the entry point along the hole.
  return dot(sub(f.origin, entry), f.normal) / dot(dir, f.normal)
}

describe('hw.plan', () => {
  test('a blind hole deeper than the body says it comes out the far side', async () => {
    blockBounds = { min: [-10, -10, 0], max: [10, 10, 10] }
    try {
      // An M3 insert hole is 6.7 deep: from Z 10 it stops at 3.3, inside.
      const ok = await plan({ kind: 'insert', size: 'M3', at: { body: 'Block', face: 0 } })
      expect(ok.notes.some((n: string) => /far side/.test(n))).toBe(false)
      // A pilot for M8 is 2d + 1 deep: from Z 10 it runs out the bottom.
      const out = await plan({ kind: 'pilot', size: 'M8', at: { body: 'Block', face: 0 } })
      expect(out.notes.some((n: string) => /comes out .* past Block’s far side/.test(n))).toBe(true)
    } finally {
      blockBounds = null
    }
  })
  test('into the top face: the XY plane at its height, drilled down', async () => {
    const p = await plan({ kind: 'screw', size: 'M3', at: { body: 'Block', face: 0 } })
    expect(p.at).toMatchObject({ entry: [0, 0, 10], direction: [0, 0, -1], plane: 'the XY plane', level: false })
    expect(p.features[0].plane).toEqual({ kind: 'world', axis: 'z', offset: 10 })
    expect(p.features[0].sketch.shapes).toEqual([{ kind: 'circle', center: [0, 0], radius: 3.05, fixed: true }])
    expect(p.features[2]).toMatchObject({ kind: 'extrude', extent: { kind: 'distance', from: 0.5, to: -3.2 }, op: 'cut', target: 'Block' })
    expect(p.features[3].extent).toEqual({ kind: 'toLast', from: 0.5, reverse: true })
    expect(p.names[0]).toBe('M3 cap screw 1 head sketch')
    expect(useHw.getState().plan?.label).toBe('M3 cap screw')
  })
  test('a point on the face, taken onto it', async () => {
    const p = await plan({ kind: 'insert', size: 'M3', at: { body: 'Block', face: 0, point: [3, -4, 12] } })
    expect(p.at.entry).toEqual([3, -4, 10])
    expect(p.features[0].sketch.shapes[0].center).toEqual([3, -4])
  })
  test('into a side: level, teardropped point up', async () => {
    const p = await plan({ kind: 'screw', size: 'M4', head: 'none', at: { body: 'Block', face: 2 } })
    expect(p.at).toMatchObject({ direction: [-1, 0, 0], level: true, plane: 'the YZ plane' })
    const shapes = p.features[0].sketch.shapes
    expect(shapes[1].kind).toBe('polyline')
    // The point is straight up the sheet's v (world Z), r√2 above the centre.
    const apex = shapes[1].points[1]
    expect(Math.abs(apex[0] - 0)).toBeLessThan(1e-9)
    expect(Math.abs(apex[1] - (5 + 2.35 * Math.SQRT2))).toBeLessThan(1e-5)
  })
  test('level, along no axis: a plane through Z turned square onto it, through the point', async () => {
    const dir: V3 = [-Math.SQRT1_2, -Math.SQRT1_2, 0]
    const p = await plan({ kind: 'screw', size: 'M3', at: { body: 'Block', point: [7, 7, 5], direction: [-1, -1, 0] } })
    expect(p.at.plane).toBe('a plane through the Z axis')
    const head = p.features.find((f: Json) => f.name.endsWith('head sketch'))
    const f = frameOf(head.plane)
    expect(Math.abs(Math.abs(dot(f.normal, dir)) - 1)).toBeLessThan(1e-9)
    expect(Math.abs(planeDepth(head.plane, [7, 7, 5], dir))).toBeLessThan(1e-6)
    // Its centre on the sheet is the point's.
    const c = head.sketch.shapes[0].center
    const world = add(add(f.origin, f.basisU, c[0]), f.basisV, c[1])
    expect(Math.hypot(...sub(world, [7, 7, 5]))).toBeLessThan(1e-5)
  })
  test('a countersink’s plane sits its sink down the hole', async () => {
    const p = await plan({ kind: 'screw', size: 'M4', head: 'countersunk', at: { body: 'Block', face: 0 } })
    const cs = p.features.find((f: Json) => f.name.endsWith('countersink sketch'))
    expect(Math.abs(planeDepth(cs.plane, [0, 0, 10], [0, 0, -1]) - 0.2)).toBeLessThan(1e-9)
  })
  test('a tilted face: a sketch on the face itself', async () => {
    const p = await plan({ kind: 'magnet', size: '6x3', at: { body: 'Block', face: 5 } })
    expect(p.features[0].plane).toMatchObject({ kind: 'bodyFace', body: 'Block', offset: 0 })
    expect(p.features[1].extent).toEqual({ kind: 'distance', from: 0.5, to: -3.2 })
  })
  test('refusals: a tilted direction, a round face, no body, a stray field', async () => {
    await refused(plan({ kind: 'screw', size: 'M3', at: { body: 'Block', point: [0, 0, 10], direction: [0, 1, -1] } }), /coordinate axis or level/)
    await refused(plan({ kind: 'screw', size: 'M3', at: { body: 'Block', face: 4 } }), /is a cylinder/)
    await refused(plan({ kind: 'screw', size: 'M3', at: { body: 'Nope', face: 0 } }), /no body/)
    await refused(plan({ kind: 'screw', size: 'M3', sunk: 2, at: { body: 'Block', face: 0 } }), /sunk: a nut/)
    await refused(plan({ kind: 'screw', size: 'M3', at: { body: 'Block', face: 0, direction: [0, 0, -1] } }), /square into it/)
    await refused(plan({ kind: 'screw', size: 'M9', at: { body: 'Block', face: 0 } }), /no screw "M9"/)
    await refused(plan({ kind: 'screw', size: 'M3', colour: 'red', at: { body: 'Block', face: 0 } }), /colour/)
  })
  test('a nut slot runs the way asked, on the sheet', async () => {
    const p = await plan({ kind: 'nut', size: 'M3', sunk: 3, slot: { length: 12, toward: [0, 1, 0] }, at: { body: 'Block', face: 0 } })
    expect(useHw.getState().plan?.steps[0]).toMatchObject({ profile: 'hexSlot', slot: { angleDeg: 90 } })
    const pts = p.features[0].sketch.shapes[0].points as [number, number][]
    expect(Math.max(...pts.map((q) => q[1]))).toBeCloseTo(12, 6)
  })
})

describe('hw.pattern', () => {
  test('a bolt circle: every copy in each step’s sketch', async () => {
    const p = (await runCommand('hw.pattern', { kind: 'screw', size: 'M3', at: { body: 'Block', face: 0 }, pattern: { kind: 'circle', count: 4, diameter: 12 } })) as Json
    expect(p.features[0].sketch.shapes.length).toBe(4)
    expect(p.centres[1]).toEqual([0, 6, 10])
    expect(p.names[0]).toBe('M3 cap screw ×4 1 head sketch')
    await refused(runCommand('hw.pattern', { kind: 'screw', size: 'M3', at: { body: 'Block', face: 0 }, pattern: { kind: 'circle', count: 8, diameter: 6 } }), /closer than/)
  })
})

describe('hw.apply', () => {
  test('cuts the plan inside its own step, then numbers the next', async () => {
    features = []
    await plan({ kind: 'screw', size: 'M3', at: { body: 'Block', face: 0 } })
    const a = (await runCommand('hw.apply', {})) as Json
    expect(a.cut).toMatchObject({ label: 'M3 cap screw', body: 'Block' })
    expect(features.map((f) => f.name)).toEqual(['M3 cap screw 1 head sketch', 'M3 cap screw 1 shaft sketch', 'M3 cap screw 1 head', 'M3 cap screw 1 shaft'])
    await runCommand('hw.apply', { kind: 'screw', size: 'M3', at: { body: 'Block', face: 0, point: [5, 5, 10] } })
    expect(features[4].name).toBe('M3 cap screw 2 head sketch')
    expect(useHw.getState().made?.features.length).toBe(4)
  })
  test('a feature that fails takes the whole cut out again', async () => {
    const before = features.length
    await refused(runCommand('hw.apply', { kind: 'insert', size: 'M3', name: 'Bad', at: { body: 'Block', face: 0 } }), /Nothing was kept/)
    expect(features.length).toBe(before)
  })
  test('a cut that cannot be taken out again says what is left', async () => {
    const before = features.length
    await refused(runCommand('hw.apply', { kind: 'insert', size: 'M3', name: 'Stuck Bad', at: { body: 'Block', face: 0 } }), /could not be taken out again: Stuck Bad hole sketch/)
    // Not the stand-in's way: a real one is undone whole. Put it back.
    features = features.slice(0, before)
  })
  test('the face planned on has changed: refused, plan again', async () => {
    await plan({ kind: 'screw', size: 'M3', at: { body: 'Block', face: 0 } })
    const was = FACES[0].centroid
    FACES[0].centroid = [0, 1, 10]
    try {
      await refused(runCommand('hw.apply', {}), /not the face it was planned on/)
    } finally {
      FACES[0].centroid = was
    }
  })
  test('a name is trimmed; a point far off the face is warned of', async () => {
    const p = await plan({ kind: 'screw', size: 'M3', name: '  Lid  ', at: { body: 'Block', face: 0, point: [40, 0, 10] } })
    expect(p.names[0]).toBe('Lid head sketch')
    expect(p.notes.some((n: string) => /far from the face/.test(n))).toBe(true)
  })
  test('nothing planned and nothing given', async () => {
    useHw.setState({ plan: null })
    await refused(runCommand('hw.apply', {}), /Plan it first/)
    await refused(runCommand('hw.apply', { kind: 'screw' }), /kind, size and at/)
  })
})

describe('hw.check and hw.set', () => {
  test('the bore takes M3 at medium clearance; a boss is no hole', async () => {
    const c = (await runCommand('hw.check', { body: 'Block', face: 4 })) as Json
    expect(c).toMatchObject({ diameter: 3.6, depth: 10, body: 'Block', face: 4 })
    expect(c.matches[0]).toMatchObject({ kind: 'screw', size: 'M3', fit: 'ISO medium' })
    await refused(runCommand('hw.check', { body: 'Block', face: 6 }), /boss/)
    await refused(runCommand('hw.check', { body: 'Block', face: 0 }), /not a round hole/)
    await refused(runCommand('hw.check', {}), /diameter/)
  })
  test('one allowance for every kind, by kind, and back to the defaults', async () => {
    await runCommand('hw.set', { allowance: 0.3 })
    expect(Object.values(useHw.getState().allowance)).toEqual([0.3, 0.3, 0.3, 0.3, 0.3, 0.3])
    await runCommand('hw.set', { allowance: { bearing: 0.05 }, teardrop: false })
    expect(useHw.getState().allowance.bearing).toBe(0.05)
    expect(useHw.getState().allowance.screw).toBe(0.3)
    await plan({ kind: 'screw', size: 'M3', at: { body: 'Block', face: 0 } })
    await runCommand('hw.set', { reset: true })
    expect(settingsOf(useHw.getState())).toEqual(DEFAULT_SETTINGS)
    expect(useHw.getState().plan?.stale).toBe(true)
    await refused(runCommand('hw.set', {}), /Give a setting/)
  })
  test('hw.list', async () => {
    const l = (await runCommand('hw.list', { kind: 'magnet' })) as Json
    expect(l.sizes[0]).toBe('3x2')
    const all = (await runCommand('hw.list', {})) as Json
    expect(all.metric.length).toBe(7)
  })
})

