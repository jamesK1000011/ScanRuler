// SPDX-License-Identifier: AGPL-3.0-only
// import-plus's reader on a block made in three.js: the formats' units and
// up axes turned into mm, Z up; parts kept by name; a mirrored node wound
// back; a size that says the units are wrong flagged; and the STL written.
import * as THREE from 'three'
import { describe, expect, test } from 'vitest'
import { flatten, formatOf, toStl } from '../core/convert'

function block(sx: number, sy: number, sz: number, name = 'Block') {
  const g = new THREE.BoxGeometry(sx, sy, sz).translate(sx / 2, sy / 2, sz / 2)
  const m = new THREE.Mesh(g)
  m.name = name
  return m
}

describe('flatten', () => {
  test('glTF metres, Y up, become mm, Z up', () => {
    const scene = new THREE.Group()
    scene.add(block(0.03, 0.01, 0.02))
    const f = flatten(scene, 'glb')
    expect(f.units).toBe('m')
    expect(f.max.map((v, i) => v - f.min[i])).toEqual([30, 20, 10])
    expect(f.positions.length / 9).toBe(12)
  })
  test('3DS millimetres, Z up, stay as they are', () => {
    const scene = new THREE.Group()
    scene.add(block(30, 20, 10))
    const f = flatten(scene, '3ds')
    expect(f.min).toEqual([0, 0, 0])
    expect(f.max).toEqual([30, 20, 10])
  })
  test('parts by name, transforms applied', () => {
    const scene = new THREE.Group()
    const a = block(10, 10, 10, 'Bracket')
    a.position.set(100, 0, 0)
    scene.add(a, block(500, 1, 500, 'Floor'))
    const f = flatten(scene, '3ds', { parts: ['Bracket'] })
    expect(f.parts).toEqual([{ name: 'Bracket', triangles: 12 }])
    expect(f.min[0]).toBe(100)
    expect(() => flatten(scene, '3ds', { parts: ['Nope'] })).toThrow(/None of the parts/)
  })
  test('a mirrored node is wound back', () => {
    const scene = new THREE.Group()
    const m = block(10, 10, 10)
    m.scale.set(-1, 1, 1)
    scene.add(m)
    const f = flatten(scene, '3ds')
    // Outward normals: the face at x = 0 (mirrored from x = 10) faces -X.
    let outward = 0
    for (let t = 0; t < f.positions.length / 9; t++) {
      const p = f.positions.subarray(9 * t, 9 * t + 9)
      const n = new THREE.Vector3().crossVectors(new THREE.Vector3(p[3] - p[0], p[4] - p[1], p[5] - p[2]), new THREE.Vector3(p[6] - p[0], p[7] - p[1], p[8] - p[2]))
      const c = new THREE.Vector3((p[0] + p[3] + p[6]) / 3 + 5, (p[1] + p[4] + p[7]) / 3 - 5, (p[2] + p[5] + p[8]) / 3 - 5)
      if (n.dot(c) > 0) outward++
    }
    expect(outward).toBe(12)
  })
  test('a size that says the units are wrong is flagged', () => {
    const scene = new THREE.Group()
    scene.add(block(0.03, 0.01, 0.02))
    expect(flatten(scene, 'glb', { units: 'mm' }).unitsWarning).toMatch(/units m/)
    const big = new THREE.Group()
    big.add(block(300, 100, 200))
    expect(flatten(big, 'glb').unitsWarning).toMatch(/units mm/)
  })
})

test('formats by extension', () => {
  expect(formatOf('a.GLB')?.id).toBe('glb')
  expect(formatOf('a.vrml')?.id).toBe('wrl')
  expect(formatOf('a.stl')).toBeNull()
  expect(formatOf('a.blend')).toBeNull()
})

test('STL out', () => {
  const scene = new THREE.Group()
  scene.add(block(30, 20, 10))
  const stl = toStl(flatten(scene, '3ds').positions)
  expect(stl.length).toBe(84 + 50 * 12)
  expect(new DataView(stl.buffer).getUint32(80, true)).toBe(12)
})
