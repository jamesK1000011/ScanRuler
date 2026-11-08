// SPDX-License-Identifier: AGPL-3.0-only
// Electronics › tscircuit's core against a hand-written Circuit JSON
// (fixtures/two-layer.circuit.json, written from circuit-json's schemas): a
// 40 × 30 × 1.6 mm two-layer board with an 0603 resistor and LED, a 2-pin
// header in plated holes, two mounting holes, a via, and three traces — one
// changing layer through the via. Checked: the reading and its refusals,
// units, the figures (lengths, nets, the least clearance) worked by hand,
// the resistance arithmetic worked by hand, and the solids in OCCT —
// volumes against their closed forms, holes through, copper on the faces
// it belongs on.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { buildSolids, partOf, SOLID_DEFAULTS, type BoardKernel } from '../core/boardSolids'
import { angleOf, CircuitJsonError, lengthOf, readCircuitJson } from '../core/circuitJson'
import { gap, netsOf, piecesOf, shapeOf, statsOf } from '../core/geometry'
import { conductorOf, PLATING, resistanceByNet, segmentOhms, traceOhms, viaOhms } from '../core/resistance'
import { settingsIn } from '../app/projectSection'

const text = readFileSync(new URL('./fixtures/two-layer.circuit.json', import.meta.url), 'utf8')
const doc = () => JSON.parse(text) as Record<string, unknown>[]
const c = readCircuitJson(text)
const near = (a: number, b: number, tol = 1e-9) => {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${a} is not ${b} (± ${tol})`)
}

describe('reading Circuit JSON', () => {
  test('every element of the fixture, nothing left out', () => {
    expect(c.problems).toEqual([])
    expect(c.boards.length).toBe(1)
    expect(c.boards[0]).toMatchObject({ width: 40, height: 30, thickness: 1.6, layers: 2, outline: null })
    expect([c.pads.length, c.platedHoles.length, c.holes.length, c.vias.length, c.traces.length, c.components.length]).toEqual([4, 2, 2, 1, 3, 3])
    expect(c.components.map((x) => x.name)).toEqual(['R1', 'LED1', 'J1'])
    expect(c.components[1].tall).toBe(1.2)
    expect(c.errors).toEqual([{ type: 'pcb_trace_error', message: 'Trace st_3 runs close to J1' }])
    expect(c.unbuilt).toEqual({ pcb_silkscreen_text: 1, pcb_silkscreen_line: 1 })
  })
  test('a route through a via: segments on each layer, the via between', () => {
    const t3 = c.traces[2]
    expect(t3.segments.map((s) => s.layer)).toEqual(['top', 'top', 'bottom', 'bottom'])
    expect(t3.segments.map((s) => s.w0)).toEqual([0.25, 0.25, 0.4, 0.4])
    expect(t3.vias).toEqual([{ x: 5, y: -5, from: 'top', to: 'bottom', drill: 0.3, outer: 0.6 }])
  })
  test('units: numbers are mm, strings carry theirs', () => {
    expect(lengthOf(1.6)).toBe(1.6)
    expect(lengthOf('1.6mm')).toBe(1.6)
    near(lengthOf('10mil')!, 0.254)
    expect(lengthOf('0.1in')).toBe(2.54)
    expect(lengthOf('35um')).toBe(0.035)
    expect(lengthOf('3 furlongs')).toBe(null)
    expect(angleOf('90deg')).toBe(90)
    near(angleOf(`${Math.PI}rad`)!, 180)
    const d = doc()
    ;(d[3] as Record<string, unknown>).width = '1.5in'
    near(readCircuitJson(d).boards[0].width, 38.1, 1e-12)
  })
  test('an element that does not check is left out, and said why', () => {
    const d = doc()
    delete (d[8] as Record<string, unknown>).layer
    ;(d[12] as Record<string, unknown>).hole_diameter = 2
    ;(d[17] as Record<string, unknown>).route = [{ route_type: 'teleport' }]
    d.push({ type: 'pcb_smtpad', shape: 'hexagon', x: 0, y: 0, layer: 'top' }, 42 as never)
    const r = readCircuitJson(d)
    expect(r.pads.length).toBe(3)
    expect(r.platedHoles.length).toBe(1)
    expect(r.traces.length).toBe(2)
    expect(r.problems.map((p) => p.why)).toEqual(['layer is not a layer (top, bottom, inner1–8)', 'hole_diameter must be less than outer_diameter', 'route[0].route_type "teleport" is not wire, via or through_pad', 'shape "hexagon" is not an smtpad shape', 'not an element (no type)'])
  })
  test('what is no Circuit JSON at all is refused', () => {
    expect(() => readCircuitJson('{"type":"pcb_board"}')).toThrow(/not a list/)
    expect(() => readCircuitJson('nope')).toThrow(/Not JSON/)
    expect(() => readCircuitJson('[{"a":1}]')).toThrow(/has a type/)
    let e: unknown
    try {
      readCircuitJson('[]')
    } catch (x) {
      e = x
    }
    expect(e instanceof CircuitJsonError).toBe(true)
  })
  test('an outline board, a polygon pour, a slot cutout', () => {
    const r = readCircuitJson([
      { type: 'pcb_board', center: { x: 0, y: 0 }, outline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }], thickness: '1mm' },
      { type: 'pcb_copper_pour', shape: 'polygon', layer: 'bottom', points: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }] },
      { type: 'pcb_copper_pour', shape: 'brep', layer: 'top', brep_shape: {} },
      { type: 'pcb_cutout', shape: 'path', route: [{ x: 2, y: 2 }, { x: 8, y: 2 }], slot_width: 1 },
    ])
    expect(r.boards[0]).toMatchObject({ width: 20, height: 10, thickness: 1 })
    expect(r.pours.length).toBe(1)
    expect(r.unbuilt).toEqual({ 'pcb_copper_pour (brep)': 1 })
    expect(r.cutouts).toEqual([{ kind: 'pill', x: 5, y: 2, w: 7, h: 1, rot: 0 }])
  })
})

describe('the board’s figures', () => {
  const pieces = piecesOf(c)
  const nets = netsOf(pieces)
  const s = statsOf(c, pieces, nets)
  test('trace lengths by hand', () => {
    // T1: √(5² + 3.73²) + 9.2; T2: 8.4; T3: 10 + 5.8 on top, 20 + 3.73 under.
    const t1 = Math.sqrt(25 + 3.73 * 3.73) + 9.2
    near(s.traces.length, t1 + 8.4 + 39.53, 1e-9)
    near(s.traces.byLayer.top, t1 + 8.4 + 15.8, 1e-9)
    near(s.traces.byLayer.bottom, 23.73, 1e-9)
    expect(s.traces.count).toBe(3)
    expect(s.traces.segments).toBe(7)
    expect(s.traces.minWidth).toBe(0.25)
  })
  test('the nets the copper makes: header pin 1 to R1, R1 to the LED, the LED back to pin 2 through the via', () => {
    expect(s.nets).toBe(3)
    const netOf = (ref: string) => nets[pieces.findIndex((p) => p.ref === ref)]
    expect(netOf('ph_J1_1')).toBe(netOf('pad_R1_1'))
    expect(netOf('pad_R1_2')).toBe(netOf('pad_LED1_1'))
    expect(netOf('pad_LED1_2')).toBe(netOf('ph_J1_2'))
    expect(netOf('via_0')).toBe(netOf('ph_J1_2'))
    expect(netOf('pad_R1_1') === netOf('pad_R1_2')).toBe(false)
  })
  test('the least clearance: 0603 pads 1.6 apart, 0.9 wide — 0.7 mm', () => {
    near(s.minClearance!.mm, 0.7, 1e-9)
    expect(s.minClearance!.layer).toBe('top')
    expect([s.minClearance!.a.kind, s.minClearance!.b.kind]).toEqual(['pad', 'pad'])
    // The header's rings: 2.54 apart, 1.7 across — 0.84, more.
    near(gap(shapeOf(c.platedHoles[0].pad), shapeOf(c.platedHoles[1].pad)), 0.84, 1e-12)
  })
  test('the rest', () => {
    expect(s.board).toMatchObject({ width: 40, height: 30, thickness: 1.6, area: 1200, shaped: false })
    expect(s.layers).toEqual({ declared: 2, withCopper: ['top', 'bottom'] })
    expect(s.minDrill).toBe(0.3)
    expect([s.pads, s.platedHoles, s.holes, s.vias, s.components, s.errors]).toEqual([4, 2, 2, 1, 3, 1])
  })
  test('gaps between the shapes, exactly', () => {
    const rect = shapeOf({ kind: 'rect', x: 0, y: 0, w: 2, h: 2, rot: 45, r: 0 })
    const dot = shapeOf({ kind: 'circle', x: 3, y: 0, r: 0.5 })
    near(gap(rect, dot), 3 - Math.SQRT2 - 0.5, 1e-12)
    const rounded = shapeOf({ kind: 'rect', x: 0, y: 0, w: 4, h: 2, rot: 0, r: 0.5 })
    near(gap(rounded, shapeOf({ kind: 'circle', x: 4, y: 3, r: 0 })), Math.hypot(2.5, 2.5) - 0.5, 1e-12)
    const pill = shapeOf({ kind: 'pill', x: 0, y: 0, w: 1, h: 4, rot: 0 })
    near(gap(pill, shapeOf({ kind: 'circle', x: 0, y: 3, r: 0.1 })), 3 - 1.5 - 0.5 - 0.1, 1e-12)
    expect(gap(rect, shapeOf({ kind: 'circle', x: 0.2, y: 0.1, r: 0.01 }))).toBe(0)
  })
})

describe('resistance, worked by hand', () => {
  const cu = conductorOf('copper')!
  const pp = conductorOf('protopasta')!
  const el = conductorOf('electrifi')!
  const o = { conductor: cu, boardThickness: 1.6 }
  test('the conductors’ figures', () => {
    near(cu.rhoPlane, 1.7241379310e-5, 1e-14) // Ω·mm: 1 / 5.8e7 S/m
    expect([pp.rhoPlane, pp.rhoThrough]).toEqual([300, 1150]) // 30 and 115 Ω·cm
    near(el.rhoPlane, 0.06, 1e-15)
    expect(cu.thickness).toBe(0.035)
  })
  test('T2 in 1 oz copper: ρ·8.4 / (0.3 × 0.035) = 800ρ = 13.79 mΩ', () => {
    near(traceOhms(c.traces[1], c, o).ohms, 800 / 5.8e4, 1e-12)
  })
  test('T2 printed in Protopasta, 0.6 mm thick: 300 × 8.4 / (0.3 × 0.6) = 14 kΩ; in Electrifi 2.8 Ω', () => {
    near(traceOhms(c.traces[1], c, { conductor: pp, thickness: 0.6, boardThickness: 1.6 }).ohms, 14000, 1e-6)
    near(traceOhms(c.traces[1], c, { conductor: el, thickness: 0.6, boardThickness: 1.6 }).ohms, 2.8, 1e-9)
  })
  test('the via: copper’s barrel, 25 µm wall in a 0.3 mm drill; Protopasta’s filled column across the layers', () => {
    expect(PLATING).toBe(0.025)
    const barrel = Math.PI * (0.15 * 0.15 - 0.125 * 0.125) // 0.0215984 mm²
    near(viaOhms(0.3, o), (1.6 / barrel) / 5.8e4, 1e-12)
    near(viaOhms(0.3, { conductor: pp, boardThickness: 1.6 }), (1150 * 1.6) / (Math.PI * 0.0225), 1e-6) // 26 031 Ω
  })
  test('T3: 15.8 mm at 0.25 on top, the via, 23.73 mm at 0.4 under', () => {
    const r = traceOhms(c.traces[2], c, o)
    const runs = (15.8 / (0.25 * 0.035) + 23.73 / (0.4 * 0.035)) / 5.8e4
    near(r.ohms, runs + viaOhms(0.3, o), 1e-12)
    expect([r.segments, r.vias]).toEqual([4, 1])
    near(r.length, 39.53, 1e-12)
  })
  test('a taper: ρL·ln(w1/w0) / (t·(w1 − w0)); level, ρL/(w·t)', () => {
    near(segmentOhms({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, w0: 0.2, w1: 0.4 }, 1, 1), (10 * Math.LN2) / 0.2, 1e-12)
    near(segmentOhms({ a: { x: 0, y: 0 }, b: { x: 0, y: 3 }, w0: 0.5, w1: 0.5 }, 2, 0.1), 120, 1e-12)
  })
  test('by net: three nets, each one trace here; the series figure their sum', () => {
    const nets = resistanceByNet(c, o)
    expect(nets.length).toBe(3)
    expect(nets.map((n) => n.traces.length)).toEqual([1, 1, 1])
    for (const n of nets) near(n.seriesOhms, n.traces[0].ohms, 1e-15)
    // Largest first: T3's net, joining the LED's pad 2 and the header's pin 2.
    expect(nets[0].traces[0].trace).toBe('trace_3')
    expect(nets[0].joins.sort()).toEqual(['pad_LED1_2', 'ph_J1_2'])
  })
})

describe('saved settings', () => {
  test('what still reads is kept, the rest are the defaults', () => {
    expect(settingsIn({ conductor: 'protopasta', thickness: 0.6, copper: -1, keepoutHeight: 5, parts: { keepouts: false, board: 'yes' } })).toEqual({ conductor: 'protopasta', thickness: 0.6, copper: 0.035, keepoutHeight: 5, parts: { board: true, copperTop: true, copperBottom: true, keepouts: false } })
    expect(settingsIn({ conductor: 'gold' }).conductor).toBe('copper')
    expect(settingsIn(null).thickness).toBe(null)
  })
})

// ---- the solids, in OCCT -------------------------------------------------------------

let occt: Promise<BoardKernel & { containsPoint(s: unknown, p: { x: number; y: number; z: number }): boolean; releaseAll(): void }> | null = null
const kernel = () => (occt ??= import('occt-wasm').then((m) => m.OcctKernel.init() as never))

describe('the board as solids, in OCCT', () => {
  test('the board: 40 × 30 × 1.6 less its holes, the vias’ and the header’s drills', async () => {
    const k = await kernel()
    const made = buildSolids(k, c, { ...SOLID_DEFAULTS, copperTop: false, copperBottom: false, keepouts: false })
    expect(made.parts.map((p) => p.name)).toEqual(['Board'])
    const b = partOf(k, made.parts[0])
    const drills = 2 * Math.PI * 1.6 * 1.6 + 2 * Math.PI * 0.5 * 0.5 + Math.PI * 0.15 * 0.15
    near(b.volume, (1200 - drills) * 1.6, 1e-3)
    expect(b.box.min.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([-20, -15, 0])
    expect(b.box.max.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([20, 15, 1.6])
    const board = made.parts[0].shape
    expect(k.containsPoint(board, { x: 16, y: 11, z: 0.8 })).toBe(false) // the mounting hole, through
    expect(k.containsPoint(board, { x: -15, y: 1.27, z: 0.8 })).toBe(false) // the header's drill
    expect(k.containsPoint(board, { x: 5, y: -5, z: 0.8 })).toBe(false) // the via
    expect(k.containsPoint(board, { x: 0, y: 0, z: 0.8 })).toBe(true)
    k.releaseAll()
  })
  test('the copper: each layer’s islands on its own face, drilled', async () => {
    const k = await kernel()
    const made = buildSolids(k, c, { ...SOLID_DEFAULTS, board: false, keepouts: false })
    const top = made.parts.filter((p) => p.kind === 'copper top')
    const bottom = made.parts.filter((p) => p.kind === 'copper bottom')
    // Top: pin 2's ring alone, pin 1 + T1 + R1's pad 1, R1's pad 2 + T2 + the LED's pad 1, the LED's pad 2 + T3 + the via.
    expect(top.length).toBe(4)
    expect(top.map((p) => p.name)).toEqual(['Copper top 1', 'Copper top 2', 'Copper top 3', 'Copper top 4'])
    // Bottom: pin 1's ring alone; pin 2's ring + T3 + the via.
    expect(bottom.length).toBe(2)
    for (const p of top) {
      const f = partOf(k, p)
      near(f.box.min[2], 1.6, 1e-6)
      near(f.box.max[2], 1.635, 1e-6)
    }
    for (const p of bottom) {
      const f = partOf(k, p)
      near(f.box.min[2], -0.035, 1e-6)
      near(f.box.max[2], 0, 1e-6)
    }
    // Pin 2's ring on top: π(0.85² − 0.5²) × 0.035.
    near(partOf(k, top[0]).volume, Math.PI * (0.85 * 0.85 - 0.25) * 0.035, 1e-6)
    // R1's pad 2, T2 and the LED's pad 1: 2 × 0.855 + 8.4 × 0.3 − 2 × 0.45 × 0.3 (the trace's ends inside the pads; its round ends make one disc, in and out) = 3.96 mm², × 0.035.
    near(partOf(k, top[2]).volume, 3.96 * 0.035, 1e-6)
    // T2 is on the top face, not under; T3's bottom run is under, not on top.
    const at = (parts: typeof top, p: { x: number; y: number; z: number }) => parts.some((x) => k.containsPoint(x.shape, p))
    expect(at(top, { x: 5, y: 5, z: 1.6175 })).toBe(true)
    expect(at(bottom, { x: 5, y: 5, z: -0.0175 })).toBe(false)
    expect(at(bottom, { x: -5, y: -5, z: -0.0175 })).toBe(true)
    expect(at(top, { x: -5, y: -5, z: 1.6175 })).toBe(false)
    // Drilled: no copper in the via's or the header's drill.
    expect(at(top, { x: 5, y: -5, z: 1.6175 })).toBe(false)
    expect(at(bottom, { x: -15, y: -1.27, z: -0.0175 })).toBe(false)
    expect(at(bottom, { x: -15, y: -1.27 - 0.7, z: -0.0175 })).toBe(true)
    k.releaseAll()
  })
  test('keep-outs: each part’s footprint box, its 3D height or the default, turned with it', async () => {
    const k = await kernel()
    const made = buildSolids(k, c, { ...SOLID_DEFAULTS, board: false, copperTop: false, copperBottom: false })
    expect(made.parts.map((p) => p.name)).toEqual(['Keep-out R1', 'Keep-out LED1', 'Keep-out J1'])
    const [r1, led, j1] = made.parts.map((p) => partOf(k, p))
    near(r1.volume, 2.6 * 1 * 3, 1e-6)
    near(r1.box.min[2], 1.635, 1e-6)
    near(r1.box.max[2], 4.635, 1e-6)
    near(led.box.max[2], 1.635 + 1.2, 1e-6)
    // J1 turned 90°: 5.08 along x, 2.54 along y.
    near(j1.box.max[0] - j1.box.min[0], 5.08, 1e-6)
    near(j1.box.max[1] - j1.box.min[1], 2.54, 1e-6)
    k.releaseAll()
  })
  test('copper as thick as a printed trace; a board with no pcb_board refused; inner layers said', async () => {
    const k = await kernel()
    const thick = buildSolids(k, c, { ...SOLID_DEFAULTS, board: false, keepouts: false, copperBottom: false, copper: 0.6 })
    near(partOf(k, thick.parts[2]).volume, 3.96 * 0.6, 1e-5)
    expect(() => buildSolids(k, readCircuitJson([{ type: 'pcb_smtpad', shape: 'circle', x: 0, y: 0, radius: 1, layer: 'top' }]))).toThrow(/no pcb_board/)
    const d = doc()
    ;(d[8] as Record<string, unknown>).layer = 'inner1'
    const inner = buildSolids(k, readCircuitJson(d), { ...SOLID_DEFAULTS, board: false, keepouts: false })
    expect(inner.notes).toEqual(['1 piece of copper on inner layers, inside the board: not built.'])
    // A pad that folds on itself is left out and said; the rest are made.
    const bad = doc()
    bad.push({ type: 'pcb_smtpad', pcb_smtpad_id: 'pad_bowtie', shape: 'polygon', layer: 'bottom', points: [{ x: 0, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 10 }] })
    const some = buildSolids(k, readCircuitJson(bad), { ...SOLID_DEFAULTS, board: false, keepouts: false, copperTop: false })
    expect(some.notes).toEqual(['Copper bottom: 1 piece could not be made and is left out (pad_bowtie).'])
    expect(some.parts.length).toBe(2)
    // A STEP comes out of it.
    expect(/^ISO-10303-21;/.test(k.exportStep(k.makeCompound(inner.parts.map((p) => p.shape))))).toBe(true)
    k.releaseAll()
  })
})
