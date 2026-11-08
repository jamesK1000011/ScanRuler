// SPDX-License-Identifier: AGPL-3.0-only
// The plan's features built in Open CASCADE as Reverse Engineer reads them —
// a sketch's outlines on its sheet, extruded between offsets along the
// plane's normal; new, join and cut; the Combine cut that keeps the tool —
// on a 40 × 40 × 10 block standing on Z 0. The traces' volume is length ×
// width × thickness; the part with the traces cut out and the traces never
// overlap and together are the block; a groove opens on the face it is cut
// from and on no other; a closed channel is closed above its roof.
import { describe, expect, test } from 'vitest'
import type { V2 } from '../core/geometry'
import { channelOf, DEFAULT_SETTINGS, featuresOf, type Json, type PlanSpec, type Sheet } from '../core/plan'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type K = any
let occt: Promise<K> | null = null
const kernel = () => (occt ??= import('occt-wasm').then((m) => m.OcctKernel.init()))
const S = { ...DEFAULT_SETTINGS }

const TOP: Sheet = { plane: { kind: 'world', axis: 'z', offset: 10 }, origin: [0, 0, 10], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0], into: -1 }
const BOTTOM: Sheet = { plane: { kind: 'world', axis: 'z', offset: 0 }, origin: [0, 0, 0], normal: [0, 0, -1], basisU: [1, 0, 0], basisV: [0, -1, 0], into: -1 }

const P = (x: number, y: number, z: number) => ({ x, y, z })
const world = (s: Sheet, p: V2, off: number) => [0, 1, 2].map((k) => s.origin[k] + p[0] * s.basisU[k] + p[1] * s.basisV[k] + off * s.normal[k]) as [number, number, number]

/** One shape of a sketch as a prism between two offsets along the normal. */
function prism(k: K, s: Sheet, shape: Json, a: number, b: number) {
  const lo = Math.min(a, b), hi = Math.max(a, b)
  if (shape.kind === 'circle') {
    const c = world(s, shape.center as V2, lo)
    const cyl = k.makeCylinder(shape.radius, hi - lo)
    // Sheets here face ±Z: a cylinder up Z from its low end.
    const z0 = s.normal[2] > 0 ? c[2] : c[2] - (hi - lo)
    return k.translate(cyl, c[0], c[1], z0)
  }
  const pts = shape.points as V2[]
  const ws = pts.map((p) => world(s, p, lo))
  const edges = ws.map((p, i) => k.makeLineEdge(P(...p), P(...ws[(i + 1) % ws.length])))
  const face = k.makeFace(k.makeWire(edges))
  const d = (hi - lo)
  return k.extrude(face, s.normal[0] * d, s.normal[1] * d, s.normal[2] * d)
}

/** The features built: the block, and the bodies they make. */
function build(k: K, sheet: Sheet, features: Json[]) {
  const bodies: Record<string, K> = { Block: k.makeBoxFromCorners(P(-20, -20, 0), P(20, 20, 10)) }
  const sketches = new Map(features.filter((f) => f.kind === 'sketch').map((f) => [f.name as string, (f.sketch as { shapes: Json[] }).shapes]))
  let traces: string | null = null
  for (const f of features) {
    if (f.kind === 'extrude') {
      const e = f.extent as { from: number; to: number }
      const parts = sketches.get(f.sketchId as string)!.map((sh) => prism(k, sheet, sh, e.from, e.to))
      const solid = parts.length === 1 ? parts[0] : k.fuseAll(parts)
      if (f.op === 'new') {
        bodies[f.name as string] = solid
        traces = f.name as string
      } else if (f.op === 'join') bodies[f.target as string] = k.fuse(bodies[f.target as string], solid)
      else bodies[f.target as string] = k.cut(bodies[f.target as string], solid)
    } else if (f.kind === 'boolean') bodies[f.body as string] = k.cut(bodies[f.body as string], bodies[f.tool as string])
  }
  return { bodies, traces }
}

const BLOCK = 40 * 40 * 10
const plan = (over: Partial<PlanSpec>): PlanSpec => ({ method: 'trace', body: 'Block', name: 'Traces', depth: 1, thickness: 1, nets: [], ...over })

describe('traces in OCCT', () => {
  for (const [label, pts] of [
    ['an L', [[-10, -10], [10, -10], [10, 10]]],
    ['45° jogs', [[-15, 0], [-5, 0], [0, 5], [5, 5], [10, 0], [15, 0]]],
  ] as [string, V2[]][]) {
    test(`${label}: volume is length × width × thickness, and the part and traces don’t overlap`, async () => {
      const k = await kernel()
      const L = pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0)
      const b = featuresOf(plan({ nets: [{ name: 'A', width: 2, points: pts, pads: [], vias: [] }] }), TOP, S, {})
      const { bodies, traces } = build(k, TOP, b.features)
      const vt = k.getVolume(bodies[traces!])
      expect(Math.abs(vt / (L * 2 * 1) - 1)).toBeLessThan(1e-6)
      const vp = k.getVolume(bodies.Block)
      expect(vp).toBeCloseTo(BLOCK - vt, 4)
      // Cutting the traces out of the part again takes nothing: no overlap.
      expect(k.getVolume(k.cut(bodies.Block, bodies[traces!]))).toBeCloseTo(vp, 4)
      expect(k.getVolume(k.common(bodies.Block, bodies[traces!]))).toBeLessThan(1e-6)
      // Together they are the block.
      expect(k.getVolume(k.fuse(bodies.Block, bodies[traces!]))).toBeCloseTo(BLOCK, 3)
      // Buried 1 under the top: plastic above the trace, trace below it.
      const m = pts[1]
      expect(k.containsPoint(bodies.Block, P(m[0], m[1], 9.5))).toBe(true)
      expect(k.containsPoint(bodies[traces!], P(m[0], m[1], 8.5))).toBe(true)
      expect(k.containsPoint(bodies.Block, P(m[0], m[1], 8.5))).toBe(false)
      k.releaseAll()
    })
  }

  test('pads reach the surface and a pin’s hole goes through pad and part', async () => {
    const k = await kernel()
    const b = featuresOf(plan({ nets: [{ name: 'A', width: 2, points: [[-10, 0], [10, 0]], pads: [{ at: [-10, 0], shape: 'round', size: 4, hole: 1 }, { at: [10, 0], shape: 'square', size: 4 }], vias: [] }] }), TOP, S, {})
    const all = [...b.features]
    // The holes cut both bodies: built in order.
    const { bodies, traces } = build(k, TOP, all)
    expect(k.containsPoint(bodies[traces!], P(10, 0, 9.8))).toBe(true)
    expect(k.containsPoint(bodies[traces!], P(-11.5, 0, 9.8))).toBe(true)
    expect(k.containsPoint(bodies[traces!], P(-10, 0, 9.5))).toBe(false)
    expect(k.containsPoint(bodies.Block, P(-10, 0, 8.5))).toBe(false)
    expect(k.getVolume(k.common(bodies.Block, bodies[traces!]))).toBeLessThan(1e-6)
    k.releaseAll()
  })
})

describe('channels in OCCT', () => {
  const wire = { kind: 'wire' as const, awg: 22 }
  const ch = channelOf(wire, S, {})

  test('an open groove from the top opens on the top face, not the bottom', async () => {
    const k = await kernel()
    const b = featuresOf(plan({ method: 'channel', depth: 0, thickness: undefined, carrier: wire, nets: [{ name: 'W', width: ch.width, points: [[-10, 0], [10, 0]], pads: [], vias: [] }] }), TOP, S, {})
    const { bodies } = build(k, TOP, b.features)
    expect(k.getVolume(bodies.Block)).toBeCloseTo(BLOCK - 20 * ch.width * ch.height, 4)
    expect(k.containsPoint(bodies.Block, P(0, 0, 9.99))).toBe(false)
    expect(k.containsPoint(bodies.Block, P(0, 0, 10 - ch.height - 0.05))).toBe(true)
    expect(k.containsPoint(bodies.Block, P(0, 0, 0.05))).toBe(true)
    k.releaseAll()
  })

  test('from the bottom face it opens on the bottom', async () => {
    const k = await kernel()
    const b = featuresOf(plan({ method: 'channel', depth: 0, thickness: undefined, carrier: wire, nets: [{ name: 'W', width: ch.width, points: [[-10, 0], [10, 0]], pads: [], vias: [] }] }), BOTTOM, S, {})
    const { bodies } = build(k, BOTTOM, b.features)
    expect(k.containsPoint(bodies.Block, P(0, 0, 0.01))).toBe(false)
    expect(k.containsPoint(bodies.Block, P(0, 0, 9.99))).toBe(true)
    k.releaseAll()
  })

  test('a closed channel under a 1 mm roof: empty below the roof, solid above it', async () => {
    const k = await kernel()
    const b = featuresOf(plan({ method: 'channel', depth: 1, thickness: undefined, carrier: wire, nets: [{ name: 'W', width: ch.width, points: [[-10, 0], [10, 0]], pads: [], vias: [] }] }), TOP, S, {})
    const { bodies } = build(k, TOP, b.features)
    expect(k.containsPoint(bodies.Block, P(0, 0, 9.5))).toBe(true)
    expect(k.containsPoint(bodies.Block, P(0, 0, 9 - 0.05))).toBe(false)
    expect(k.containsPoint(bodies.Block, P(0, 0, 9 - ch.height + 0.05))).toBe(false)
    expect(k.containsPoint(bodies.Block, P(0, 0, 9 - ch.height - 0.05))).toBe(true)
    k.releaseAll()
  })
})
