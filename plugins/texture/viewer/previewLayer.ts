// SPDX-License-Identifier: AGPL-3.0-only
// The textured mesh on the stage, in the scan's frame: what a preview or a
// full run made, drawn in place of the scan while the workspace shows it.

import * as THREE from 'three'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import type { SceneLayer, SceneLayerHost } from '../../../src/viewer/sceneLayers'
import { applyFinish } from '../../../src/viewer/viewThemes'
import { setSurfaceOpacity } from '../../../src/viewer/surfaceModes'

export class TexturePreview {
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
      order: 90,
      themeChanged: (theme) => {
        if (!this.mesh) return
        const m = this.mesh.material as THREE.MeshStandardMaterial
        m.color.setHex(theme.nominal)
        applyFinish(m, theme)
      },
      clippingChanged: (planes) => {
        this.planes = planes
        if (this.mesh) {
          const m = this.mesh.material as THREE.MeshStandardMaterial
          m.clippingPlanes = planes
          m.needsUpdate = true
        }
      },
      opacityChanged: (opacity) => {
        if (this.mesh) setSurfaceOpacity(this.mesh.material as THREE.MeshStandardMaterial, opacity)
      },
      scanReplaced: () => this.clear(),
      navTargets: () => (this.mesh ? [this.mesh] : []),
      dispose: () => this.clear(),
    }
  }

  show(positions: Float32Array, normals: Float32Array | null): void {
    this.clear()
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    if (normals) g.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    else g.computeVertexNormals()
    g.computeBoundingSphere()
    const theme = this.host.theme()
    const m = new THREE.MeshStandardMaterial({ color: theme.nominal, flatShading: !normals, side: THREE.DoubleSide })
    applyFinish(m, theme)
    m.clippingPlanes = this.planes
    setSurfaceOpacity(m, this.host.scanOpacity())
    this.mesh = new THREE.Mesh(g, m)
    this.mesh.name = 'texture-preview'
    this.host.partGroup.add(this.mesh)
    this.host.invalidate()
  }

  shown(): boolean {
    return this.mesh !== null
  }

  clear(): void {
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
