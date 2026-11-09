// SPDX-License-Identifier: AGPL-3.0-only
// The sheet cut's geometry without a kernel: a profile sorted into its
// outline and holes and run with the material on the left; its narrow webs
// and slots, inside corners and round holes; fitting a sheet, turned if
// need be; the cutter's path off the part by half a kerf; parts laid out in
// rows over sheets; a body read as a sheet part (or the faces that say it
// is not); the rules by machine and material; the findings; and the file,
// as the app's own DXF and SVG writers draw it.
import { describe, expect, it } from 'vitest'
import { buildFlatDxf } from '../../../src/core/flat/dxf'
import { buildFlatSvg } from '../../../src/core/flat/svg'
import { checkCut, thicknessMatches, type CutFigures } from '../core/check'
import { fitOf, layOut } from '../core/drawing'
import { readFlat, type FaceIn } from '../core/flat'
import { fitOnSheet, insideCorners, narrowPlaces, offsetLoop, pieceOf, polygonOf, profilesOf, roundHoles, rowPack, type Piece, type Pt } from '../core/profile'
import { cutRules, kindOf, unsuited } from '../core/rules'

const L = (a: Pt, b: Pt): Piece => ({ kind: 'line', a, b })
/** A 100 × 50 plate drawn clockwise, a slot 1 wide and 20 deep from its
 *  lower edge at x 59–60, holes of 2 and 4. */
const plate = (): Piece[][] => [
  [{ kind: 'circle', center: [20, 25], radius: 1 }],
  [L([0, 0], [0, 50]), L([0, 50], [100, 50]), L([100, 50], [100, 0]), L([100, 0], [60, 0]), L([60, 0], [60, 20]), L([60, 20], [59, 20]), L([59, 20], [59, 0]), L([59, 0], [0, 0])],
  [{ kind: 'circle', center: [40, 25], radius: 2 }],
]
const flatFaces = (extra: FaceIn[] = []): FaceIn[] => [
  { index: 0, kind: 'plane', area: 5000, centroid: [50, 25, 3], normal: [0, 0, 1] },
  { index: 1, kind: 'plane', area: 5000, centroid: [50, 25, 0], normal: [0, 0, -1] },
  { index: 2, kind: 'plane', area: 150, centroid: [0, 25, 1.5], normal: [-1, 0, 0] },
  { index: 3, kind: 'cylinder', area: 19, centroid: [20, 25, 1.5], axis: [0, 0, 1] },
  ...extra,
]
const on = (p: Pt): [number, number, number] => [p[0], p[1], 1.5]
const laser = (over: Partial<CutFigures> = {}): CutFigures => ({ kind: 'laser', sheetThickness: 3, kerf: 0.15, minFeature: 3, tool: null, holePerThickness: 1, sheet: null, ...over })

describe('the profile', () => {
  it('sorts the chains into an outline and its holes, the material on the left of each', () => {
    const [p] = profilesOf(plate())
    expect(profilesOf(plate())).toHaveLength(1)
    expect(p.outer.area).toBeCloseTo(4980, 6)
    expect(p.holes.map((h) => h.area).sort((a, b) => a - b)).toEqual([-4 * Math.PI, -Math.PI])
    expect(roundHoles(p).map((h) => h.diameter).sort()).toEqual([2, 4])
  })

  it('takes the pieces as reverse.body.section answers them', () => {
    expect(pieceOf({ kind: 'arc', center: [0, 0], radius: 2, start: 0, sweep: -1, a: [2, 0], b: [1, -1], length: 2 })).toEqual({ kind: 'arc', center: [0, 0], radius: 2, start: 0, sweep: -1, a: [2, 0], b: [1, -1] })
    expect(pieceOf({ kind: 'bogus' })).toBe(null)
  })

  it('an island in a hole is a piece of its own', () => {
    const square = (o: number, s: number): Piece[] => [L([o, o], [o + s, o]), L([o + s, o], [o + s, o + s]), L([o + s, o + s], [o, o + s]), L([o, o + s], [o, o])]
    const ps = profilesOf([square(0, 100), square(10, 80), square(30, 40)])
    expect(ps.map((p) => p.holes.length)).toEqual([1, 0])
  })

  it('finds the slot narrower than the least feature, once, and its two square inside corners', () => {
    const [p] = profilesOf(plate())
    const narrow = narrowPlaces(p, 3)
    expect(narrow).toHaveLength(1)
    expect(narrow[0]).toMatchObject({ kind: 'gap', width: 1 })
    expect(insideCorners(p, 1.6).map((c) => c.at)).toEqual([
      [59, 20],
      [60, 20],
    ])
  })

  it('a thin web reads as material, and an inside round under the cutter by its radius', () => {
    // A bar 1 wide, and an L whose inside corner is a round of 0.5.
    const bar = profilesOf([[L([0, 0], [30, 0]), L([30, 0], [30, 1]), L([30, 1], [0, 1]), L([0, 1], [0, 0])]])[0]
    expect(narrowPlaces(bar, 2)).toEqual([{ kind: 'web', width: 1, at: [0.3333, 0.5] }])
    const arc: Piece = { kind: 'arc', center: [10.5, 10.5], radius: 0.5, start: Math.PI, sweep: Math.PI / 2, a: [10, 10.5], b: [10.5, 10] }
    const ell = profilesOf([[L([0, 0], [30, 0]), L([30, 0], [30, 10]), L([30, 10], [10.5, 10]), { ...arc, a: [10.5, 10], b: [10, 10.5], start: (3 * Math.PI) / 2, sweep: -Math.PI / 2 }, L([10, 10.5], [10, 30]), L([10, 30], [0, 30]), L([0, 30], [0, 0])]])[0]
    expect(insideCorners(ell, 1.5)).toEqual([{ radius: 0.5, at: [10.1464, 10.1464] }])
  })

  it('fits a sheet as modelled, turned a quarter, turned at a slant, or not at all', () => {
    const [p] = profilesOf(plate())
    const pts = polygonOf(p.outer)
    expect(fitOnSheet(pts, [120, 60])).toEqual({ fits: true, turnDeg: 0, size: [100, 50] })
    expect(fitOnSheet(pts, [60, 120])).toMatchObject({ fits: true, turnDeg: 90 })
    expect(fitOnSheet(pts, [40, 120])).toMatchObject({ fits: false, turnDeg: null })
    // A long thin bar at 45° fits a narrow sheet laid along it.
    const bar: Pt[] = [
      [0, 0],
      [70.71, 70.71],
      [69.3, 72.12],
      [-1.41, 1.41],
    ]
    expect(fitOnSheet(bar, [101, 3]).fits).toBe(true)
  })

  it('moves the cutter’s path half a kerf off the material: out round an outline, in round a hole', () => {
    const [p] = profilesOf(plate())
    const hole = p.holes.find((h) => h.pieces[0].kind === 'circle' && h.pieces[0].radius === 2)!
    expect(offsetLoop(hole, 0.1)).toEqual({ circle: { center: [40, 25], radius: 1.9 } })
    const out = offsetLoop(p.outer, 0.1)
    expect('polygon' in out).toBe(true)
    const poly = (out as { polygon: Pt[] }).polygon
    expect(Math.min(...poly.map((q) => q[0]))).toBeCloseTo(-0.1, 9)
    expect(Math.max(...poly.map((q) => q[1]))).toBeCloseTo(50.1, 9)
    // The slot narrows by the kerf: its sides at 59.1 and 59.9.
    expect(poly.some((q) => Math.abs(q[0] - 59.1) < 1e-9)).toBe(true)
    expect(poly.some((q) => Math.abs(q[0] - 59.9) < 1e-9)).toBe(true)
  })

  it('lays parts out in rows, onto further sheets when one fills, turning a part wider than the sheet', () => {
    const r = rowPack(
      [
        [100, 50],
        [30, 30],
        [30, 30],
        [90, 10],
      ],
      5,
      [120, 60],
    )
    expect(r.placed.map((p) => [p.sheet, p.at])).toEqual([
      [1, [0, 0]],
      [2, [140, 0]],
      [2, [175, 0]],
      [2, [140, 35]],
    ])
    expect(rowPack([[80, 20]], 5, [50, 100]).placed[0]).toMatchObject({ turned: true, sheet: 1 })
  })
})

describe('a sheet part, read from its faces', () => {
  it('two sides apart and square edges: flat, and how thick', () => {
    expect(readFlat(flatFaces())).toEqual({ flat: true, normal: [0, 0, 1], thickness: 3, top: 3, bottom: 0, offenders: [] })
  })

  it('a step, a chamfer, a rounded edge and a side hole each named', () => {
    const r = readFlat(
      flatFaces([
        { index: 4, kind: 'plane', area: 20, centroid: [80, 25, 2], normal: [0, 0, 1] },
        { index: 5, kind: 'plane', area: 5, centroid: [100, 25, 2.9], normal: [0.7071, 0, 0.7071] },
        { index: 6, kind: 'torus', area: 5, centroid: [0, 0, 2.9], normal: [-0.5, -0.5, 0.7] },
        { index: 7, kind: 'cylinder', area: 5, centroid: [50, 0, 1.5], axis: [0, 1, 0] },
        { index: 8, kind: 'cone', area: 5, centroid: [40, 25, 2.5], axis: [0, 0, 1] },
      ]),
    )
    expect(r.flat).toBe(false)
    expect(r.thickness).toBe(3)
    expect(r.offenders.map((o) => [o.face, o.why.split(':')[0]])).toEqual([
      [4, 'a flat face 1 in from the top'],
      [5, 'a flat face leaning 45° off the sheet’s sides'],
      [6, 'a torus face'],
      [7, 'a round face across the thickness'],
      [8, 'a cone'],
    ])
  })

  it('no two flat faces apart: not a sheet part', () => {
    expect(readFlat([{ index: 0, kind: 'sphere', area: 10, centroid: [0, 0, 0], normal: [0, 0, 1] }])).toMatchObject({ flat: false, normal: null, thickness: null })
  })
})

describe('the rules', () => {
  it('by machine and material, and what a machine cannot cut', () => {
    expect(cutRules('laser', 'metal', 3)).toMatchObject({ kerf: 0.15, minFeature: 3, holePerThickness: 1 })
    expect(cutRules('laser', 'thermoplast', 3)).toMatchObject({ kerf: 0.2, minFeature: 1.5, holePerThickness: 0.5 })
    expect(cutRules('plasma', 'metal', 6)).toMatchObject({ kerf: 1.5, minFeature: 9, holePerThickness: 1.5 })
    expect(cutRules('router', 'wood', 12)).toMatchObject({ kerf: 3.175, holePerThickness: 0 })
    expect(unsuited('plasma', 'wood', 6)).toMatchObject({ severity: 'error' })
    expect(unsuited('laser', 'metal', 3)).toBe(null)
    expect(kindOf({ machine: 'waterjet' })).toBe('waterjet')
    expect(kindOf(null)).toBe('laser')
    expect(thicknessMatches(3.04, 3)).toBe(true)
    expect(thicknessMatches(3.2, 3)).toBe(false)
  })
})

describe('the check', () => {
  it('a laser: the slot and the small hole under the least feature, the hole under the thickness, a sheet too small', () => {
    const f = checkCut(readFlat(flatFaces()), profilesOf(plate()), laser({ sheet: [40, 120] }), on)
    expect(f.map((x) => [x.severity, x.rule])).toEqual([
      ['warning', 'hole'],
      ['warning', 'gap'],
      ['error', 'sheet'],
    ])
    expect(f[1].at).toEqual([59.5, 0.5, 1.5])
    expect(checkCut(readFlat(flatFaces()), profilesOf(plate()), laser({ minFeature: 1, holePerThickness: 1 }), on).map((x) => x.says)).toEqual(['a hole of 2 in 3 thick: under the thickness it comes out tapered or not round — drill or ream it to size'])
  })

  it('a router: what is narrower than the cutter cannot be cut, and its inside corners are rounded', () => {
    const f = checkCut(readFlat(flatFaces()), profilesOf(plate()), { kind: 'router', sheetThickness: null, kerf: 3.175, minFeature: 3.175, tool: 3.175, holePerThickness: 0, sheet: null }, on)
    expect(f.map((x) => [x.severity, x.rule])).toEqual([
      ['error', 'hole'],
      ['error', 'gap'],
      ['warning', 'inside-corner'],
    ])
  })

  it('the wrong thickness, a step, and no profile at all are errors', () => {
    const f = checkCut(readFlat(flatFaces([{ index: 4, kind: 'plane', area: 20, centroid: [80, 25, 2], normal: [0, 0, 1] }])), [], laser({ sheetThickness: 2 }), on)
    expect(f.map((x) => x.rule)).toEqual(['flat', 'thickness', 'profile'])
    expect(f[1].says).toBe('the part is 3 thick; the setup’s sheet is 2')
  })
})

describe('the file', () => {
  it('lines, arcs and circles as the drawing’s own, an arc made counter-clockwise', () => {
    expect(fitOf({ kind: 'arc', center: [0, 0], radius: 1, start: 1, sweep: -0.5, a: [0, 0], b: [0, 0] })).toEqual([{ kind: 'arc', center: [0, 0], radius: 1, start: 0.5, sweep: 0.5, sigma: 0, usedPoints: 0 }])
    expect(fitOf({ kind: 'line', a: [0, 0], b: [0, 0] })).toEqual([])
  })

  it('two parts laid out as DXF and SVG: circles stay circles, the outline its lines', () => {
    const ps = profilesOf(plate())
    const laid = layOut(
      [
        { name: 'A', profiles: ps },
        { name: 'B', profiles: ps },
      ],
      { gap: 5, sheet: [120, 200], compensate: false, kerf: 0.2, labels: true, title: 'Plates', note: 'drawn edges' },
    )
    expect(laid.placed.map((p) => [p.name, p.sheet, p.at])).toEqual([
      ['A', 1, [0, 0]],
      ['B', 1, [0, 55]],
    ])
    const dxf = buildFlatDxf({ ...laid.input, origin: null, edgeTolerance: 0, units: 'mm' })
    expect(dxf.split('\nCIRCLE\n')).toHaveLength(5)
    expect(dxf.split('\nLINE\n')).toHaveLength(17)
    expect(dxf).toMatch(/\$INSUNITS\n 70\n4/)
    const svg = buildFlatSvg(laid.input)
    expect(svg.split('<circle')).toHaveLength(5)
    expect(svg).toMatch(/width="110mm"/)
  })

  it('compensated: the hole’s circle half a kerf smaller, the outline a polyline half a kerf out', () => {
    const laid = layOut([{ name: 'A', profiles: profilesOf(plate()) }], { gap: 5, compensate: true, kerf: 0.2, labels: false, title: 't', note: 'n' })
    const circles = laid.input.edgePieces!.filter((p) => p.kind === 'circle').map((p) => (p as { radius: number }).radius)
    expect(circles.sort()).toEqual([0.9, 1.9])
    expect(laid.size).toEqual([100.2, 50.2])
  })
})
