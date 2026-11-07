// SPDX-License-Identifier: AGPL-3.0-only
// fit-comp on a test plate printed with known errors: the features found on
// the CAD, each error read back within its standard error, the corrections
// and slicer values that follow, and a compensated model that prints true.
import { describe, expect, test } from 'vitest'
import { compensate } from '../core/compensate'
import { findFeatures } from '../core/features'
import { buildFrame, fromBuild, toBuild } from '../core/frame'
import { measure } from '../core/measure'
import { solve } from '../core/solve'
import { corrections, iniFragment, slicerChanges, type Keymap } from '../core/suggest'
import orca from '../keymaps/orcaslicer.json'
import prusa from '../keymaps/prusaslicer.json'
import bambu from '../keymaps/bambustudio.json'
import { cad, printed, type Distortion } from './synth'

const TRUE: Distortion = { sx: 1, sy: 1, sz: 1, contour: 0, hole: 0, foot: 0, noise: 0.02 }
const BAD: Distortion = { sx: 0.995, sy: 0.997, sz: 1.002, contour: 0.08, hole: 0.12, foot: 0.15, footBand: 0.2, noise: 0.03 }

async function read(d: Distortion) {
  const c = await cad()
  const f = findFeatures(c.positions, c.indices)
  const s = await printed(d)
  return { f, readings: measure(f, s.positions, { band: 1, footBand: 0.2, footAbove: 2.5 }, s.normals) }
}

describe('features', () => {
  test('the plate’s walls, floors, holes and boss', async () => {
    const c = await cad()
    const f = findFeatures(c.positions, c.indices)
    expect(f.planes.map((p) => p.id).sort()).toEqual(['+X1', '+Y1', '+Z1', '+Z2', '-X1', '-Y1', '-Z1'].sort())
    expect(f.circles.map((x) => `${x.kind}:${x.radius}`).sort()).toEqual(['boss:4', 'hole:2.5', 'hole:5'])
  })
  test('the build frame turns and back', () => {
    for (const up of ['+z', '-z', '+x', '-x', '+y', '-y'] as const) {
      const f = buildFrame(up)
      const a = [0, 0, 0], b = [0, 0, 0]
      toBuild(f, 1, 2, 3, a)
      fromBuild(f, a[0], a[1], a[2], b)
      expect(b).toEqual([1, 2, 3])
    }
    const a = [0, 0, 0]
    toBuild(buildFrame('+x'), 5, 0, 0, a)
    expect(a[2]).toBe(5)
  })
})

describe('reading the print', () => {
  test('a true print reads true and changes nothing', async () => {
    const { readings } = await read(TRUE)
    const sol = solve(readings)
    expect(Math.abs(sol.scale.x.value - 1)).toBeLessThan(0.0005)
    expect(Math.abs(sol.contour.value)).toBeLessThan(0.01)
    expect(Math.abs(sol.hole.value)).toBeLessThan(0.01)
    expect(corrections(sol).filter((c) => c.change)).toEqual([])
  })

  test('every error injected is read back', async () => {
    const { readings } = await read(BAD)
    expect(readings.missed).toEqual([])
    expect(readings.noise).toBeGreaterThan(0.02)
    const sol = solve(readings)
    expect(sol.scale.x.value).toBeCloseTo(0.995, 4)
    expect(sol.scale.y.value).toBeCloseTo(0.997, 4)
    expect(sol.scale.z.value).toBeCloseTo(1.002, 3)
    expect(sol.contour.value).toBeCloseTo(0.08, 2)
    expect(sol.hole.value).toBeCloseTo(0.12, 2)
    expect(sol.foot!.value).toBeGreaterThan(0.1)
    expect(sol.foot!.value).toBeLessThan(0.17)
    expect(sol.fit).toBeLessThan(4)
    expect(corrections(sol).filter((c) => c.change).map((c) => c.quantity).sort()).toEqual(['contour', 'foot', 'hole', 'scaleXY', 'scaleZ'])
  })

  test('scale and hole offset cannot be told apart from one hole radius alone', () => {
    const readings = { planes: [], circles: [{ id: 'H1', kind: 'hole' as const, nominal: { center: [0, 0] as [number, number], radius: 5 }, center: [0, 0] as [number, number], radius: 4.9, seRadius: 0.002, seCenter: 0.003, scatter: 0.02, points: 500 }], noise: 0.02, missed: [] }
    const sol = solve(readings)
    expect(sol.hole.determined && sol.scale.x.determined).toBe(false)
    expect(corrections(sol).find((c) => c.quantity === 'scaleXY')!.why).toMatch(/not separable/)
  })

  test('a warped part fits badly and says so', async () => {
    const { readings } = await read(TRUE)
    readings.planes.find((p) => p.id === '+X1')!.offset += 0.6
    readings.planes.find((p) => p.id === '-Y1')!.offset -= 0.5
    const sol = solve(readings)
    expect(sol.fit).toBeGreaterThan(4)
    expect(sol.outliers.length).toBeGreaterThan(0)
  })
})

describe('slicer settings', () => {
  test('OrcaSlicer: added to the values in use, shrink as measured %', async () => {
    const { readings } = await read(BAD)
    const cs = corrections(solve(readings))
    const ch = slicerChanges(cs, orca as Keymap, { xy_hole_compensation: 0.05 })
    const by = Object.fromEntries(ch.map((c) => [c.key, c.to]))
    expect(by.xy_contour_compensation).toBeCloseTo(-0.08, 2)
    expect(by.xy_hole_compensation).toBeCloseTo(0.17, 2)
    expect(by.filament_shrink).toBeCloseTo(99.6, 1)
    expect(by.elefant_foot_compensation).toBeGreaterThan(0.1)
    expect(iniFragment(ch, orca as Keymap, 'test')).toMatch(/filament_shrink = 99\.\d+%/)
  })
  test('PrusaSlicer: shrinkage % and no hole setting', async () => {
    const { readings } = await read(BAD)
    const ch = slicerChanges(corrections(solve(readings)), prusa as Keymap, {})
    expect(ch.find((c) => c.key === 'filament_shrinkage_compensation_xy')!.to).toBeCloseTo(0.4, 1)
    const hole = ch.find((c) => c.quantity === 'hole')!
    expect(hole.key).toBeNull()
    expect(hole.note).toMatch(/compensated_mesh/)
  })
  test('Bambu Studio: scale the object', async () => {
    const { readings } = await read(BAD)
    const ch = slicerChanges(corrections(solve(readings)), bambu as Keymap, {})
    const xy = ch.find((c) => c.quantity === 'scaleXY')!
    expect(xy.unit).toMatch(/object scale/)
    expect(xy.to!).toBeCloseTo(100.4, 1)
  })
})

describe('compensated model', () => {
  test('printing the compensated model with the same errors comes out true', async () => {
    const c = await cad()
    const f = findFeatures(c.positions, c.indices)
    const { readings } = await read(BAD)
    const sol = solve(readings)
    const comp = compensate(c.positions, c.indices, f, { sx: sol.scale.x.value, sy: sol.scale.y.value, sz: sol.scale.z.value, contour: sol.contour.value, hole: sol.hole.value, foot: 0, footFade: 0.4 })
    // Print it: offset the walls by the same errors, then scale.
    let maxX = -Infinity
    for (let i = 0; i < comp.length; i += 3) maxX = Math.max(maxX, comp[i])
    expect((maxX + sol.contour.value) * sol.scale.x.value).toBeCloseTo(60, 4)
    // A hole's wall: the model's hole is the true one unscaled, opened by the
    // hole offset the print will close it by.
    const h = f.circles.find((x) => x.kind === 'hole' && x.radius === 5)!
    const s = (sol.scale.x.value + sol.scale.y.value) / 2
    let rMin = Infinity
    for (let i = 0; i < comp.length; i += 3) {
      if (comp[i + 2] > 6.01) continue
      const rr = Math.hypot(comp[i] - h.center[0] / sol.scale.x.value, comp[i + 1] - h.center[1] / sol.scale.y.value)
      if (rr < 7) rMin = Math.min(rMin, rr)
    }
    expect(Math.abs((rMin - sol.hole.value) * s - 5)).toBeLessThan(0.01)
  })
})
