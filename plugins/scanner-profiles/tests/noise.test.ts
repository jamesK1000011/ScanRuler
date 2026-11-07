// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { measureNoise } from '../core/noise'

function plate(sigma: number, step = 0.5, size = 60, seed = 3) {
  let s = seed
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  const k = Math.round(size / step) + 1
  const positions = new Float32Array(k * k * 3)
  const normals = new Float32Array(k * k * 3)
  for (let j = 0; j < k; j++)
    for (let i = 0; i < k; i++) {
      const v = j * k + i
      positions.set([i * step, j * step, sigma * gauss()], v * 3)
      normals.set([0, 0, 1], v * 3)
    }
  const idx: number[] = []
  for (let j = 0; j + 1 < k; j++)
    for (let i = 0; i + 1 < k; i++) {
      const a = j * k + i
      idx.push(a, a + 1, a + k, a + 1, a + k + 1, a + k)
    }
  return { positions, indices: new Uint32Array(idx), normals }
}

describe('scan noise', () => {
  it('reads a plate’s noise within 15 %', () => {
    for (const sigma of [0.01, 0.03, 0.08]) {
      const r = measureNoise(plate(sigma))
      expect(r.sigmaMm / sigma).toBeGreaterThan(0.85)
      expect(r.sigmaMm / sigma).toBeLessThan(1.15)
      expect(r.spacingMm).toBeCloseTo(0.5, 1)
    }
  })

  it('keeps edges out: a bent normal is not flat ground', () => {
    const m = plate(0.02)
    for (let v = 0; v < m.normals.length / 3; v += 2) m.normals.set([0.6, 0, 0.8], v * 3)
    expect(measureNoise(m).flat).toBe(0)
  })
})
