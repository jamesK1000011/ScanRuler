// SPDX-License-Identifier: AGPL-3.0-only
// The wall read on a CAD mesh from samples over its faces: a magnet sealed
// under a thin skin found where the block's few big triangles have no vertex
// over it, a solid block with no thin wall, a mesh wound inside out read the
// same, and the spacing widened on a part too large for the samples.
import { describe, expect, it } from 'vitest'
import { runChecks } from '../core/checks'
import { stack, type RulePack } from '../core/rules'
import { leastWall, probeWalls } from '../core/wall'
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
})
