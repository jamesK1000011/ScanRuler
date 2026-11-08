// SPDX-License-Identifier: AGPL-3.0-only
// The answer on the stage: the part's outside as the solver meshed it,
// coloured by the field shown — the safety factor, a stress or the
// displacement — through the colour map chosen in the settings.

import * as THREE from 'three'
import { colormapById, rampColor } from '../../../src/core/field/colormap'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import type { SceneLayer, SceneLayerHost } from '../../../src/viewer/sceneLayers'
import type { Field } from '../state/feaStore'

/** The range a field is coloured over, and which way: a safety factor reads
 *  red at the bottom (weak), stresses and displacement red at the top. */
export function rangeOf(field: Field, values: ArrayLike<number>, target = 2): { lo: number; hi: number; flip: boolean } {
  if (field === 'safety') return { lo: 0, hi: Math.max(2 * target, 1), flip: true }
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < values.length; i++) {
    if (values[i] < lo) lo = values[i]
    if (values[i] > hi) hi = values[i]
  }
  if (field === 'across') {
    // Pulling apart is what fails a print: the range set by the largest pull.
    const m = Math.max(Math.abs(lo), Math.abs(hi), 1e-9)
    return { lo: -m, hi: m, flip: false }
  }
  return { lo: Math.min(0, lo), hi: hi > lo ? hi : lo + 1, flip: false }
}

export class FeaResultLayer {
  private host: SceneLayerHost
  private mesh: THREE.Mesh | null = null
  private removeLayer: () => void
  private planes: THREE.Plane[] | null = null

  constructor(scene: SceneManager) {
    this.host = scene.layerHost()
    this.removeLayer = scene.addLayer(this.layer())
  }

  private layer(): SceneLayer {
    return {
      order: 91,
      clippingChanged: (planes) => {
        this.planes = planes
        if (this.mesh) {
          const m = this.mesh.material as THREE.MeshStandardMaterial
          m.clippingPlanes = planes
          m.needsUpdate = true
        }
      },
      navTargets: () => (this.mesh ? [this.mesh] : []),
      frameBox: () => this.mesh?.geometry.boundingBox ?? null,
      dispose: () => this.clear(),
    }
  }

  private drawn: ArrayLike<number> | null = null

  show(positions: Float32Array, index: Uint32Array, values: ArrayLike<number>, field: Field, colormap: string, target: number): void {
    // The same part: only its colours change.
    if (this.mesh && this.drawn === positions) {
      this.mesh.geometry.setAttribute('color', new THREE.BufferAttribute(this.colours(values, field, colormap, target), 3))
      this.host.invalidate()
      return
    }
    this.clear()
    this.drawn = positions
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setIndex(new THREE.BufferAttribute(index, 1))
    g.setAttribute('color', new THREE.BufferAttribute(this.colours(values, field, colormap, target), 3))
    g.computeVertexNormals()
    g.computeBoundingSphere()
    g.computeBoundingBox()
    // A slice already cutting the part cuts this too.
    this.planes = this.host.clipPlanes()
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, flatShading: true })
    m.clippingPlanes = this.planes
    this.mesh = new THREE.Mesh(g, m)
    this.mesh.name = 'fea-result'
    this.host.partGroup.add(this.mesh)
    this.host.invalidate()
  }

  private colours(values: ArrayLike<number>, field: Field, colormap: string, target: number): Float32Array {
    const map = colormapById(colormap)
    const { lo, hi, flip } = rangeOf(field, values, target)
    const rgb = new Float32Array(values.length * 3)
    const c: [number, number, number] = [0, 0, 0]
    for (let i = 0; i < values.length; i++) {
      let t = (values[i] - lo) / (hi - lo)
      if (flip) t = 1 - t
      rampColor(map, t, c)
      rgb[i * 3] = c[0] / 255
      rgb[i * 3 + 1] = c[1] / 255
      rgb[i * 3 + 2] = c[2] / 255
    }
    return rgb
  }

  clear(): void {
    this.drawn = null
    if (!this.mesh) return
    this.host.partGroup.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh = null
    this.host.invalidate()
  }

  dispose(): void {
    this.clear()
    this.removeLayer()
  }
}
