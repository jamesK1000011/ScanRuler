// SPDX-License-Identifier: AGPL-3.0-only
// The arithmetic worked by hand: resistance from resistivity, length and
// cross-section, along and through the layers; copper wire by gauge; the
// drop and heat at a current. The geometry: a mitred run's area is its
// centreline times its width; distances; rounded bends. The router on
// small grids: straight, detour, blocked, clearance. The features a plan
// makes, and a closed channel's top.
import { describe, expect, test } from 'vitest'
import { area, mitredOutline, pieceGap, piecesGap, polylineDistance, routeLength, runPieces, segmentDistance, type V2, type V3 } from '../core/geometry'
import { awgDiameter, awgTable, COPPER_OHM_M, currentFor, loadOf, MATERIALS, resistivityAlong, runResistance, wireOhmPerM } from '../core/materials'
import { ensureMaterials, libraryMaterial } from '../../_shared/materials'
import { channelOf, channelTop, DEFAULT_SETTINGS, featuresOf, LEAD, measure, type PlanSpec, type Sheet } from '../core/plan'
import { piecesOf, routeAll, routeOne, shortfall } from '../core/router'

const S = { ...DEFAULT_SETTINGS }
const pp = MATERIALS.find((m) => m.id === 'protopasta')!
const el = MATERIALS.find((m) => m.id === 'electrifi')!

/** The top face of a 40 × 40 × 10 block: Z 10, u = X, v = Y, into −Z. */
const TOP: Sheet = { plane: { kind: 'world', axis: 'z', offset: 10 }, origin: [0, 0, 10], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0], into: -1 }
/** A standing face at X 20: u = Y, v = Z, into −X. */
const SIDE: Sheet = { plane: { kind: 'world', axis: 'x', offset: 20 }, origin: [20, 0, 0], normal: [1, 0, 0], basisU: [0, 1, 0], basisV: [0, 0, 1], into: -1 }

describe('resistance', () => {
  test('units: 1 Ω·cm over 10 mm of 1 mm² is 100 Ω (0.01 Ω·m × 0.01 m / 1e-6 m²)', () => {
    expect(runResistance(1, 10, 1)).toBeCloseTo(100, 9)
  })

  test('Protopasta, 100 × 2 × 1 mm: along the layers 15 kΩ, through them 57.5 kΩ', () => {
    // 30 Ω·cm = 300 Ω·mm; 300 × 100 / 2 = 15 000. 115 Ω·cm: 1150 × 100 / 2 = 57 500.
    expect(runResistance(resistivityAlong(pp, 0), 100, 2)).toBeCloseTo(15000, 6)
    expect(runResistance(resistivityAlong(pp, 1), 100, 2)).toBeCloseTo(57500, 6)
    expect(runResistance(resistivityAlong(pp, -1), 100, 2)).toBeCloseTo(57500, 6)
  })

  test('climbing at 45°: the tensor projected, (30 + 115) / 2 = 72.5 Ω·cm', () => {
    expect(resistivityAlong(pp, Math.SQRT1_2)).toBeCloseTo(72.5, 9)
    expect(runResistance(resistivityAlong(pp, Math.SQRT1_2), 100, 2)).toBeCloseTo(36250, 6)
  })

  test('Electrifi, 100 × 2 × 1 mm: 0.006 Ω·cm → 3 Ω, either way', () => {
    expect(runResistance(resistivityAlong(el, 0), 100, 2)).toBeCloseTo(3, 9)
    expect(runResistance(resistivityAlong(el, 1), 100, 2)).toBeCloseTo(3, 9)
  })

  test('AWG from its definition: 36 is 0.005 in, 0000 is 0.46 in, 22 is 0.6438 mm', () => {
    expect(awgDiameter(36)).toBeCloseTo(0.127, 9)
    expect(awgDiameter(-3)).toBeCloseTo(11.684, 3)
    expect(awgDiameter(22)).toBeCloseTo(0.6438, 4)
  })

  test('AWG 22 copper: 0.0516 Ω/m at 1.68e-8 Ω·m, 0.0530 at the annealed 1.724e-8 the tables use', () => {
    // A = π 0.6438² / 4 = 0.32553 mm²; 1.68e-8 / 0.32553e-6 = 0.05161.
    expect(wireOhmPerM(awgDiameter(22))).toBeCloseTo(0.0516, 4)
    expect(Math.abs(wireOhmPerM(awgDiameter(22)) / 0.053 - 1)).toBeLessThan(0.03)
    expect(wireOhmPerM(awgDiameter(22), 1.7241e-8)).toBeCloseTo(0.053, 4)
    const t = awgTable(20, 24)
    expect(t.map((r) => r.awg)).toEqual([20, 21, 22, 23, 24])
    expect(t[2].ohmPerM).toBeCloseTo(0.0516, 4)
  })

  test('copper’s resistivity, kept here, agrees with the shared library’s copper (59.59 MS/m)', async () => {
    await ensureMaterials()
    const ms = libraryMaterial('copper')!.electrical!.conductivity!
    expect(Math.abs(1 / (ms * 1e6) / COPPER_OHM_M - 1)).toBeLessThan(0.005)
  })

  test('drop and heat: 15 kΩ over 100 mm at 10 mA is 150 V, 1.5 W, 15 W/m', () => {
    const l = loadOf({ resistance: 15000, length: 100, current: 0.01 })
    expect(l.volts).toBeCloseTo(150, 9)
    expect(l.watts).toBeCloseTo(1.5, 9)
    expect(l.wPerM).toBeCloseTo(15, 9)
    // 150 kΩ/m at 1 W/m: √(1 / 150 000) = 2.58 mA.
    expect(currentFor(150000, 1)).toBeCloseTo(0.002582, 6)
  })
})

describe('a plan measured', () => {
  const spec = (over: Partial<PlanSpec> = {}): PlanSpec => ({ method: 'trace', body: 'Block', name: 'Traces', depth: 0, thickness: 1, nets: [{ name: 'A', width: 2, points: [[-50, 0], [50, 0]], pads: [], vias: [] }], ...over })

  test('a straight 100 mm on the top face: along the layers, 15 kΩ', () => {
    const m = measure(spec(), TOP, { ...S, current: 0 })
    expect(m.nets[0]).toMatchObject({ name: 'A', length: 100, width: 2, thickness: 1, area: 2, resistance: 15000, run: 15000, terminals: 0, mitred: true })
  })

  test('pads at its ends: a column from the surface to the run’s middle, through the layers', () => {
    // Ø4 pad: 12.566 mm²; 0.5 mm of 115 Ω·cm: 1150 × 0.5 / 12.566 = 45.76 Ω each.
    const m = measure(spec({ nets: [{ name: 'A', width: 2, points: [[-50, 0], [50, 0]], pads: [{ at: [-50, 0], shape: 'round', size: 4 }, { at: [50, 0], shape: 'round', size: 4 }], vias: [] }] }), TOP, S)
    expect(m.nets[0].terminals).toBeCloseTo(91.51, 1)
    expect(m.nets[0].resistance).toBeCloseTo(15091.5, 0)
  })

  test('on a standing face, a run up the face is through the layers', () => {
    const m = measure(spec({ nets: [{ name: 'Up', width: 2, points: [[0, 0], [0, 100]], pads: [], vias: [] }, { name: 'Level', width: 2, points: [[10, 0], [110, 0]], pads: [], vias: [] }] }), SIDE, { ...S, clearance: 0 })
    expect(m.nets[0].run).toBeCloseTo(57500, 3)
    expect(m.nets[1].run).toBeCloseTo(15000, 3)
  })

  test('a via down to depth 3 from a 1 mm run at the surface: 2.5 mm through the layers', () => {
    // Ø2: 3.1416 mm²; 1150 × 2.5 / 3.1416 = 915.1 Ω.
    const m = measure(spec({ nets: [{ name: 'A', width: 2, points: [[0, 0], [10, 0]], pads: [], vias: [{ at: [10, 0], to: 3, diameter: 2 }] }] }), TOP, S)
    expect(m.nets[0].vias[0].resistance).toBeCloseTo(915.1, 0)
  })

  test('heat: 15 W/m at 10 mA warns, with the current that would not', () => {
    const m = measure(spec(), TOP, S)
    expect(m.nets[0].wPerM).toBeCloseTo(15, 6)
    expect(m.nets[0].warnings.join(' ')).toMatch(/over the 1 W\/m warning.*Below 0\.00258\d* A/)
  })

  test('width and thickness for the nozzle and layers', () => {
    expect(() => measure(spec({ nets: [{ name: 'A', width: 0.3, points: [[0, 0], [10, 0]], pads: [], vias: [] }] }), TOP, S)).toThrow(/under one line/)
    const thin = measure(spec({ nets: [{ name: 'A', width: 0.6, points: [[0, 0], [10, 0]], pads: [], vias: [] }] }), TOP, S)
    expect(thin.nets[0].warnings[0]).toMatch(/under 0\.8/)
    const odd = measure(spec({ thickness: 0.5 }), TOP, { ...S, current: 0 })
    expect(odd.nets[0].warnings.join(' ')).toMatch(/not a whole number of 0\.2 layers/)
    expect(() => measure(spec({ thickness: 0.1 }), TOP, S)).toThrow(/under one layer/)
  })

  test('clearance between nets: edge to edge', () => {
    // Centres 2.5 apart, widths 1: 1.5 between edges, under 2.
    const m = measure(spec({ nets: [{ name: 'A', width: 1, points: [[0, 0], [10, 0]], pads: [], vias: [] }, { name: 'B', width: 1, points: [[0, 2.5], [10, 2.5]], pads: [], vias: [] }] }), TOP, { ...S, clearance: 2, current: 0 })
    expect(m.warnings[0]).toMatch(/A and B come 1\.5 apart, under the 2 clearance/)
    // To a mitred corner: B's round pad 2.2 out from A's bend on the
    // diagonal, 1.197 from the mitre's point (1.611 from the centreline's
    // half width).
    const c = measure(spec({ nets: [{ name: 'A', width: 2, points: [[-10, 0], [0, 0], [0, 10]], pads: [], vias: [] }, { name: 'B', width: 1, points: [[2.2, -2.2], [10, -10]], pads: [{ at: [2.2, -2.2], shape: 'round', size: 1 }], vias: [] }] }), TOP, { ...S, clearance: 1.5, current: 0 })
    expect(c.warnings.some((w) => /A and B come 1\.197 apart, under the 1\.5 clearance/.test(w))).toBe(true)
    const ok = measure(spec({ nets: [{ name: 'A', width: 1, points: [[0, 0], [10, 0]], pads: [], vias: [] }, { name: 'B', width: 1, points: [[0, 3.5], [10, 3.5]], pads: [], vias: [] }] }), TOP, { ...S, clearance: 2, current: 0 })
    expect(ok.warnings).toEqual([])
  })

  test('a buried trace under thin cover is warned', () => {
    const m = measure(spec({ depth: 0.2 }), TOP, { ...S, current: 0 })
    expect(m.nets[0].warnings.join(' ')).toMatch(/Cover over it is 0\.2, under 3 layers/)
  })

  test('a wire channel: AWG 22 copper, 1 m', () => {
    const m = measure({ method: 'channel', body: 'Block', name: 'C', depth: 0, carrier: { kind: 'wire', awg: 22 }, nets: [{ name: 'W', width: 0, points: [[0, 0], [1000, 0]], pads: [], vias: [] }] }, TOP, S)
    expect(m.nets[0].run).toBeCloseTo(0.0516, 4)
    expect(m.nets[0].width).toBeCloseTo(0.944, 3)
  })
})

describe('geometry', () => {
  const L = (p: V2[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0)

  test('a mitred run’s area is its length times its width: an L, a 45° jog, a zigzag', () => {
    for (const pts of [[[0, 0], [20, 0], [20, 15]], [[0, 0], [10, 0], [15, 5], [30, 5]], [[0, 0], [10, 0], [10, 10], [20, 10], [20, 20]]] as V2[][]) {
      const o = mitredOutline(pts, 2)!
      expect(o === null).toBe(false)
      expect(Math.abs(area(o))).toBeCloseTo(L(pts) * 2, 4)
    }
  })

  test('a segment too short for the mitres at its ends: rectangles and discs instead', () => {
    // Two left turns of 45° 0.707 apart: the inside needs 2 × tan 22.5° = 0.83.
    const pts: V2[] = [[0, 0], [10, 0], [10.5, 0.5], [10.5, 10]]
    expect(mitredOutline(pts, 2)).toBeNull()
    const r = runPieces(pts, 2)
    expect(r.mitred).toBe(false)
    expect(r.pieces.filter((p) => p.kind === 'polygon')).toHaveLength(3)
    expect(r.pieces.filter((p) => p.kind === 'circle')).toHaveLength(2)
  })

  test('segment distances: parallel, crossing, skew', () => {
    expect(segmentDistance([0, 0, 0], [10, 0, 0], [0, 3, 0], [10, 3, 0])).toBeCloseTo(3, 12)
    expect(segmentDistance([0, 0, 0], [10, 0, 0], [5, -5, 0], [5, 5, 0])).toBeCloseTo(0, 12)
    expect(segmentDistance([0, 0, 0], [10, 0, 0], [5, -5, 2], [5, 5, 2])).toBeCloseTo(2, 12)
    expect(segmentDistance([0, 0, 0], [1, 0, 0], [4, 0, 0], [5, 0, 0])).toBeCloseTo(3, 12)
    expect(polylineDistance([[0, 0, 0]], [[3, 4, 0], [3, 10, 0]])).toBeCloseTo(5, 12)
  })

  test('a route’s length with its bends rounded: a 90° bend at R 2 takes 4 of straight, gives π', () => {
    const pts: V3[] = [[0, 0, 0], [10, 0, 0], [10, 10, 0]]
    expect(routeLength(pts, 2)!.length).toBeCloseTo(20 - 4 + Math.PI, 9)
    expect(routeLength([[0, 0, 0], [1, 0, 0], [1, 10, 0]], 2)).toBeNull()
  })
})

describe('router', () => {
  const base = { grid: 0.5, clearance: 1, bounds: [-20, -20, 20, 20] as [number, number, number, number], keepouts: [], obstacles: [] }
  const segsOk = (pts: V2[]) => pts.slice(1, -1).every((q, i) => {
    const a = Math.atan2(q[1] - pts[i][1], q[0] - pts[i][0]) / (Math.PI / 4)
    return Math.abs(a - Math.round(a)) < 1e-9
  })

  test('nothing in the way: straight across', () => {
    const r = routeOne({ net: 'A', from: [-10, 0], to: [10, 0], width: 1 }, base)
    expect('points' in r && r.points).toEqual([[-10, 0], [10, 0]])
  })

  test('a keep-out in the way: a detour of axis and 45° runs, clear of it by the clearance', () => {
    const keep = { rect: [-2, -5, 2, 5] as [number, number, number, number] }
    const r = routeOne({ net: 'A', from: [-10, 0], to: [10, 0], width: 1 }, { ...base, keepouts: [keep] })
    if (!('points' in r)) throw new Error(r.fail)
    expect(segsOk(r.points)).toBe(true)
    expect(L(r.points)).toBeGreaterThan(20)
    // Edge of the run to the keep-out: half the width and the clearance at least.
    const box: V3[] = [[-2, -5, 0], [2, -5, 0], [2, 5, 0], [-2, 5, 0], [-2, -5, 0]]
    expect(polylineDistance(r.points.map((p) => [p[0], p[1], 0] as V3), box)).toBeGreaterThan(1.5 - 1e-9)
  })

  test('a wall right across: reported, not forced', () => {
    const r = routeAll([{ net: 'A', from: [-10, 0], to: [10, 0], width: 1 }], { ...base, keepouts: [{ rect: [-1, -30, 1, 30] }] })
    expect(r.routed).toEqual([])
    expect(r.failed[0]).toMatchObject({ net: 'A' })
    expect(r.failed[0].why).toMatch(/no way through/)
  })

  test('a start inside a keep-out is said so', () => {
    const r = routeOne({ net: 'A', from: [0, 0], to: [10, 0], width: 1 }, { ...base, keepouts: [{ circle: [0, 0, 2] }] })
    expect('fail' in r && r.fail).toMatch(/start lies in a keep-out/)
  })

  test('the second net keeps the clearance from the first', () => {
    const r = routeAll([{ net: 'A', from: [-10, 0], to: [10, 0], width: 1 }, { net: 'B', from: [-10, -4], to: [10, 4], width: 1 }], { ...base, bounds: [-15, -15, 15, 15] })
    expect(r.failed).toEqual([])
    const [a, b] = r.routed.map((x) => x.points.map((p) => [p[0], p[1], 0] as V3))
    // B has to go round A's end: edge to edge, the clearance at least.
    expect(polylineDistance(a, b)).toBeGreaterThan(0.5 + 0.5 + 1 - 1e-9)
    expect(segsOk(r.routed[1].points)).toBe(true)
  })

  test('B’s start within A’s clearance is refused, saying which net', () => {
    const r = routeAll([{ net: 'A', from: [-10, 0], to: [10, 0], width: 1 }, { net: 'B', from: [0, 1], to: [0, 10], width: 1 }], base)
    expect(r.failed[0].why).toMatch(/start is within the clearance of net A/)
  })

  test('every run keeps the clearance as drawn — mitred corners and ends off the grid too', () => {
    // A seeded set of crowded boards: pads, a keep-out, four nets each.
    let seed = 11
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    let checked = 0
    for (let t = 0; t < 300; t++) {
      const grid = [0.25, 0.5, 1][t % 3]
      const clearance = 0.4 + rnd() * 0.6
      const w = 0.6 + rnd() * 2
      const obstacles = Array.from({ length: 4 }, (_, k) => ({ net: `P${k}`, center: [rnd() * 30 - 15, rnd() * 30 - 15] as V2, radius: 0.5 + rnd() * 2 }))
      const keepouts = [{ rect: [-3, -3, 3, 3] as [number, number, number, number] }]
      const asks = Array.from({ length: 4 }, (_, k) => ({ net: `N${k}`, from: [rnd() * 36 - 18, rnd() * 36 - 18] as V2, to: [rnd() * 36 - 18, rnd() * 36 - 18] as V2, width: w }))
      const r = routeAll(asks, { grid, clearance, bounds: [-20, -20, 20, 20], keepouts, obstacles })
      const all = [...obstacles, ...r.routed.map((x) => ({ net: x.net, points: x.points, width: w }))]
      for (const a of r.routed) {
        const mine = runPieces(a.points, w).pieces
        for (const o of [...all, ...keepouts]) {
          if ('net' in o && o.net === a.net) continue
          expect(piecesGap(mine, piecesOf(o)) >= clearance - 1e-6).toBe(true)
          checked++
        }
      }
    }
    expect(checked > 100).toBe(true)
  })

  test('a mitred corner reaches past the half width: the gap measured to it', () => {
    // An L of width 2: the outer corner of its mitre at (1, -1) from the bend.
    const run: V2[] = [[-10, 0], [0, 0], [0, 10]]
    const pad = { net: 'P', center: [2.2, -2.2] as V2, radius: 0.5 }
    const gap = piecesGap(runPieces(run, 2).pieces, piecesOf(pad))
    expect(gap).toBeCloseTo(Math.hypot(1.2, 1.2) - 0.5, 6)
    // The centreline's distance less the half width would say more.
    expect(Math.hypot(2.2, 2.2) - 1 - 0.5).toBeGreaterThan(gap + 0.4)
    expect(shortfall(run, 2, 'A', { clearance: 1.5, keepouts: [], obstacles: [pad] })).toMatchObject({ to: 'net P' })
    expect(shortfall(run, 2, 'A', { clearance: 1, keepouts: [], obstacles: [pad] })).toBe(null)
    // Overlap and containment are no gap.
    expect(pieceGap({ kind: 'circle', center: [0, 0], radius: 1 }, { kind: 'polygon', points: [[-5, -5], [5, -5], [5, 5], [-5, 5]] })).toBe(0)
  })

  test('too fine a grid for the bounds is refused', () => {
    const r = routeOne({ net: 'A', from: [0, 0], to: [10, 0], width: 1 }, { ...base, grid: 0.01, bounds: [-100, -100, 100, 100] })
    expect('fail' in r && r.fail).toMatch(/coarser grid/)
  })
})

const L = (p: V2[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0)

describe('features', () => {
  test('traces: one sketch, a new body named as the plan, cut out of the part keeping it', () => {
    const b = featuresOf({ method: 'trace', body: 'Block', name: 'Traces', depth: 1, thickness: 1, nets: [{ name: 'A', width: 2, points: [[0, 0], [10, 0]], pads: [{ at: [0, 0], shape: 'round', size: 4, hole: 1 }], vias: [] }] }, TOP, S, {})
    expect(b.names).toEqual(['Traces sketch', 'Traces pads sketch', 'Traces holes sketch', 'Traces', 'Traces pads', 'Traces cut', 'Traces holes', 'Traces holes in part'])
    const f = Object.fromEntries(b.features.map((x) => [x.name as string, x]))
    expect(f.Traces).toMatchObject({ kind: 'extrude', op: 'new', extent: { kind: 'distance', from: -1, to: -2 } })
    expect(f['Traces pads']).toMatchObject({ op: 'join', target: 'Traces', extent: { from: 0, to: -1.5 } })
    expect(f['Traces cut']).toEqual({ kind: 'boolean', name: 'Traces cut', op: 'cut', body: 'Block', tool: 'Traces', keep: true })
    expect(f['Traces holes']).toMatchObject({ op: 'cut', target: 'Traces', extent: { from: LEAD, to: -2 } })
    expect(b.traces).toBe('Traces')
  })

  test('a channel: cut into the part, open above the surface', () => {
    const b = featuresOf({ method: 'channel', body: 'Block', name: 'Channels', depth: 0, carrier: { kind: 'wire', awg: 22 }, nets: [{ name: 'W', width: 0.944, points: [[0, 0], [10, 0]], pads: [], vias: [] }] }, TOP, S, {})
    const ch = channelOf({ kind: 'wire', awg: 22 }, S, {})
    expect(b.features[1]).toMatchObject({ kind: 'extrude', name: 'Channels channels', op: 'cut', target: 'Block', extent: { from: LEAD } })
    expect((b.features[1].extent as { to: number }).to).toBeCloseTo(-ch.height, 6)
    expect(b.traces).toBeUndefined()
  })

  test('a routed channel laid at a pause: square sides to a flat top, not round', () => {
    const net = { name: 'W', width: 0.944, path: [[0, 0, 5], [10, 0, 5]] as V3[], pads: [], vias: [] }
    const prof = { W: { plane: { kind: 'world', axis: 'x', offset: 0 }, at: [0, 5] as V2, reversed: false } }
    const shapeOf = (over: Partial<PlanSpec>) => {
      const b = featuresOf({ method: 'channel', body: 'Block', name: 'C', depth: 1, carrier: { kind: 'wire', awg: 22 }, nets: [net], ...over }, null, S, prof)
      return ((b.features[0].sketch as { shapes: { kind: string }[] }).shapes[0]).kind
    }
    expect(shapeOf({})).toBe('polyline')
    expect(shapeOf({ lay: 'pause' })).toBe('polyline')
    // Threaded after: round, the wire pulled through.
    expect(shapeOf({ lay: 'thread' })).toBe('circle')
  })

  test('a closed channel’s top on a level face: where the pause goes', () => {
    expect(channelTop(TOP, 1, 2)).toBe(9)
    const bottom: Sheet = { ...TOP, origin: [0, 0, 0], normal: [0, 0, -1] }
    expect(channelTop(bottom, 1, 2)).toBe(3)
    expect(channelTop(SIDE, 1, 2)).toBeNull()
  })
})
