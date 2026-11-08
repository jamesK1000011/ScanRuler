// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { distanceToTriangle, shapeVertices, type ScanSurface } from '../app/regions'

// A coarse CAD-style wall at x = 30 (two long triangles) and a small face
// just behind it at x = 26, as a pocket wall sits behind an outer wall.
function wallAndPocket(): ScanSurface {
  const positions = new Float32Array([
    // the outer wall, 0–3
    30, -20, 0, 30, 20, 0, 30, 20, 20, 30, -20, 20,
    // the pocket face, 4–6
    26, -1, 9, 26, 1, 9, 26, 0, 12,
  ])
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6])
  return { positions, indices, normals: new Float32Array(positions.length) }
}

describe('the fill from a point', () => {
  it('starts on the face the point is on, not the one whose centre is nearest', () => {
    const v = [...shapeVertices(wallAndPocket(), { near: [30, 0, 10] })]
    expect(v).toEqual([0, 1, 2, 3])
  })

  it('distance to a triangle: inside, past an edge and past a corner', () => {
    const p = [0, 0, 0, 10, 0, 0, 0, 10, 0]
    expect(distanceToTriangle(p, 0, 1, 2, [2, 2, 3])).toBeCloseTo(9, 9)
    expect(distanceToTriangle(p, 0, 1, 2, [5, -4, 0])).toBeCloseTo(16, 9)
    expect(distanceToTriangle(p, 0, 1, 2, [-3, -4, 0])).toBeCloseTo(25, 9)
    expect(distanceToTriangle(p, 0, 1, 2, [10, 10, 0])).toBeCloseTo(50, 9)
  })
})
