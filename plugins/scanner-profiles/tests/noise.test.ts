// SPDX-License-Identifier: AGPL-3.0-only
// The one reading Scanner noise makes itself: the point spacing, which the
// scan check gives only for a CAD tessellation. The noise is the scan
// check's (scannerCommands.test.ts).
import { describe, expect, it } from 'vitest'
import { pointSpacing } from '../core/noise'

function plate(step: number, size = 20) {
  const k = Math.round(size / step) + 1
  const positions = new Float32Array(k * k * 3)
  for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) positions.set([i * step, j * step, 0.01 * Math.sin(i + j)], (j * k + i) * 3)
  const idx: number[] = []
  for (let j = 0; j + 1 < k; j++)
    for (let i = 0; i + 1 < k; i++) {
      const a = j * k + i
      idx.push(a, a + 1, a + k, a + 1, a + k + 1, a + k)
    }
  return { positions, indices: new Uint32Array(idx) }
}

describe('point spacing', () => {
  it('reads a grid’s step', () => {
    for (const step of [0.2, 0.5, 1]) expect(pointSpacing(plate(step))).toBeCloseTo(step, 2)
  })

  it('is NaN on a mesh with no triangles', () => {
    expect(pointSpacing({ positions: new Float32Array(9), indices: new Uint32Array(0) })).toBeNaN()
  })
})
