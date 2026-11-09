// SPDX-License-Identifier: AGPL-3.0-only
// The wall read on a CAD mesh from samples over its faces: a magnet sealed
// under a thin skin found where the block's few big triangles have no vertex
// over it, a solid block with no thin wall, a mesh wound inside out read the
// same, the spacing widened on a part too large for the samples, and a lip
// tapering to a knife edge read as a sharp edge, not a thin wall; and a
// wall's severity by the nozzle: under one line an error, from one line up
// to the minimum a warning, at the minimum or over nothing.
import { describe, expect, it } from 'vitest'
import { runChecks } from '../core/checks'
import { stack, type RulePack } from '../core/rules'
import { leastWall, probeWalls, sharpEdges } from '../core/wall'
import pack from '../rules/fdm-default.json'

function box(min: number[], max: number[], inward = false): number[] {
  const [x0, y0, z0] = min, [x1, y1, z1] = max
  const q = (a: number[], b: number[], c: number[], d: number[]) => (inward ? [...a, ...d, ...c, ...a, ...c, ...b] : [...a, ...b, ...c, ...a, ...c, ...d])
  return [
    ...q([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]),
    ...q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]),
    ...q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]),
    ...q([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]),
    ...q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]),
    ...q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]),
  ]
}
const mesh = (soup: number[]) => ({ positions: Float64Array.from(soup), indices: Uint32Array.from({ length: soup.length / 3 }, (_, i) => i) })
/** A 30 × 20 × 6 block, a 10 × 10 magnet pocket sealed in it 0.4 under the top. */
const magnetBlock = (inward = false) => mesh([...box([0, 0, 0], [30, 20, 6], inward), ...box([5, 5, 2], [15, 15, 5.6], !inward)])
const rules = () => stack(pack as RulePack, [])
/** A triangle soup with its shared corners made one vertex. */
function welded(m: { positions: Float64Array; indices: Uint32Array }) {
  const ids = new Map<string, number>(), pos: number[] = []
  const indices = Uint32Array.from(m.indices, (i) => {
    const key = `${m.positions[3 * i]},${m.positions[3 * i + 1]},${m.positions[3 * i + 2]}`
    let n = ids.get(key)
    if (n === undefined) {
      n = ids.size
      ids.set(key, n)
      pos.push(m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2])
    }
    return n
  })
  return { positions: Float64Array.from(pos), indices }
}
/** A convex profile in y z run `length` along x, each face wound outward. */
function prism(profile: number[][], length: number): number[] {
  const cy = profile.reduce((s, q) => s + q[0], 0) / profile.length, cz = profile.reduce((s, q) => s + q[1], 0) / profile.length
  const c = [length / 2, cy, cz]
  const tri = (a: number[], b: number[], d: number[]) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const out = n[0] * (a[0] - c[0]) + n[1] * (a[1] - c[1]) + n[2] * (a[2] - c[2]) > 0
    return out ? [...a, ...b, ...d] : [...a, ...d, ...b]
  }
  const at = (x: number, q: number[]) => [x, q[0], q[1]]
  const soup: number[] = []
  for (let i = 1; i + 1 < profile.length; i++) soup.push(...tri(at(0, profile[0]), at(0, profile[i]), at(0, profile[i + 1])), ...tri(at(length, profile[0]), at(length, profile[i]), at(length, profile[i + 1])))
  for (let i = 0; i < profile.length; i++) {
    const q = profile[i], w = profile[(i + 1) % profile.length]
    soup.push(...tri(at(0, q), at(0, w), at(length, w)), ...tri(at(0, q), at(length, w), at(length, q)))
  }
  return soup
}
/** A 2 mm wall 6 tall, 40 long, its top chamfered at 45° to a knife edge
 *  on its outer face — the profile of a bin's stacking lip. */
const lip = () => mesh(prism([[0, 0], [2, 0], [2, 4], [0, 6]], 40))

describe('walls read on a CAD mesh', () => {
  it('find the skin over a sealed magnet, and where it is', () => {
    const part = magnetBlock()
    const wall = probeWalls(part.positions, part.indices, { spacing: 0.4, reach: 6.4 })
    const thin = runChecks({ ...part, wall }, rules()).findings.filter((f) => f.rule === 'thin-wall')
    expect(thin).toHaveLength(1)
    expect(thin[0].value).toBeCloseTo(0.4, 3)
    expect(thin[0].at[2]).toBeGreaterThanOrEqual(5.6)
    expect(thin[0].at[0]).toBeGreaterThanOrEqual(5)
    expect(thin[0].at[0]).toBeLessThanOrEqual(15)
    expect(thin[0].areaMm2).toBeGreaterThan(150)
    expect(leastWall(wall)?.least).toBeCloseTo(0.4, 3)
  })
  it('find no thin wall on a solid block, and its least wall across', () => {
    const part = mesh(box([0, 0, 0], [30, 20, 6]))
    const wall = probeWalls(part.positions, part.indices, { spacing: 0.4, reach: 6.4 })
    expect(runChecks({ ...part, wall }, rules()).findings.filter((f) => f.rule === 'thin-wall')).toEqual([])
    expect(leastWall(wall)?.least).toBeCloseTo(6, 3)
  })
  it('read a mesh wound inside out the same', () => {
    const part = magnetBlock(true)
    const wall = probeWalls(part.positions, part.indices, { spacing: 0.4, reach: 6.4 })
    expect(leastWall(wall)?.least).toBeCloseTo(0.4, 3)
  })
  it('widen the spacing on a part too large for the samples', () => {
    const part = magnetBlock()
    const wall = probeWalls(part.positions, part.indices, { spacing: 0.4, reach: 6.4, most: 5000 })
    expect(wall.spacing).toBeGreaterThan(0.4)
    expect(wall.thickness.length).toBeLessThanOrEqual(5000)
    expect(leastWall(wall)?.least).toBeCloseTo(0.4, 3)
  })
  it('read a lip tapering to a knife edge as a sharp edge, not a thin wall', () => {
    const part = lip()
    const wall = probeWalls(part.positions, part.indices, { spacing: 0.4, reach: 6.4 })
    const found = runChecks({ ...part, wall }, rules()).findings.filter((f) => f.rule === 'thin-wall')
    expect(found.filter((f) => f.severity === 'error')).toEqual([])
    expect(found.map((f) => f.severity)).toEqual(['info'])
    expect(found[0].value).toBeGreaterThan(30)
    expect(found[0].value).toBeLessThan(50)
    expect(found[0].at[2]).toBeGreaterThan(5)
    expect(found[0].says).toMatch(/single line/)
    const edges = sharpEdges(wall, 0.8, 1.2)
    expect(edges).toHaveLength(1)
    expect(edges[0].at[1]).toBeLessThan(0.8)
    expect(leastWall(wall, { edges: false })?.least).toBeCloseTo(2, 3)
  })
  it('still find the skin over a magnet with the edge rule in force', () => {
    const part = magnetBlock()
    const wall = probeWalls(part.positions, part.indices, { spacing: 0.4, reach: 6.4 })
    const found = runChecks({ ...part, wall }, rules()).findings.filter((f) => f.rule === 'thin-wall')
    expect(found.map((f) => f.severity)).toEqual(['warning'])
    expect(sharpEdges(wall, 0.8, 1.2)).toEqual([])
    expect(leastWall(wall, { edges: false })?.least).toBeCloseTo(0.4, 3)
  })
})

describe('a wall against a 0.4 mm nozzle', () => {
  /** A fin `t` thick standing on nothing: 20 long, 10 tall. */
  const fin = (t: number) => mesh(box([0, 0, 0], [20, t, 10]))
  const read = (t: number) => {
    const part = fin(t)
    const wall = probeWalls(part.positions, part.indices, { spacing: 0.4, reach: 6.4 })
    return runChecks({ ...part, wall }, rules()).findings.filter((f) => f.rule === 'thin-wall')
  }
  /** The same fin welded, as a scan is, with its thickness map: `t` at
   *  every vertex. */
  const scanned = (t: number) => {
    const part = welded(fin(t))
    return runChecks({ ...part, thickness: new Float32Array(part.positions.length / 3).fill(t) }, rules()).findings.filter((f) => f.rule === 'thin-wall')
  }
  const cases: [number, [string, number, number][]][] = [
    [0.3, [['error', 0.3, 0.4]]],
    [0.7, [['warning', 0.7, 0.8]]],
    [1, []],
  ]
  for (const [t, want] of cases)
    it(`${t} mm: read on a body and on a scan alike`, () => {
      expect(read(t).map((f) => [f.severity, f.value, f.limit])).toEqual(want)
      expect(scanned(t).map((f) => [f.severity, f.value, f.limit])).toEqual(want)
    })
  it('say why in plain words', () => {
    expect(read(0.3)[0].says).toMatch(/thinner than one 0.4 mm line/)
    expect(read(0.7)[0].says).toMatch(/prints as a single line/)
  })
  it('take one line from the profile when it gives its line width', () => {
    const wide = stack(pack as RulePack, [{ name: 'printer', overrides: { 'thin-wall': { params: { lineMm: 0.45 } } } }])
    const part = fin(0.42)
    const wall = probeWalls(part.positions, part.indices, { spacing: 0.4, reach: 6.4 })
    expect(runChecks({ ...part, wall }, wide).findings.filter((f) => f.rule === 'thin-wall').map((f) => [f.severity, f.limit])).toEqual([['error', 0.45]])
  })
  it('never come out worse than the rule allows', () => {
    const soft = stack(pack as RulePack, [{ name: 'project', overrides: { 'thin-wall': { severity: 'info' } } }])
    const part = fin(0.7)
    const wall = probeWalls(part.positions, part.indices, { spacing: 0.4, reach: 6.4 })
    expect(runChecks({ ...part, wall }, soft).findings.filter((f) => f.rule === 'thin-wall').map((f) => f.severity)).toEqual(['info'])
  })
})
