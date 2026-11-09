// SPDX-License-Identifier: AGPL-3.0-only
// A body's stamp: the same for the same mesh, rebuilt or not; another once a
// corner moves or a triangle is added.
import { expect, test } from 'vitest'
import { meshStamp } from '../core/meshStamp'

const mesh = (z: number, tris = 1) => ({ positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, z]), indices: Uint32Array.from(Array.from({ length: 3 * tris }, (_, i) => i % 3)) })

test('a mesh rebuilt the same keeps its stamp; one changed gets another', () => {
  const a = meshStamp(mesh(0))
  expect(a).toMatch(/^[0-9a-f]{8}$/)
  expect(meshStamp(mesh(0))).toBe(a)
  expect(meshStamp(mesh(0.001)) === a).toBe(false)
  expect(meshStamp(mesh(0, 2)) === a).toBe(false)
})
