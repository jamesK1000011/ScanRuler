// SPDX-License-Identifier: AGPL-3.0-only
// The Texture workspace's part of session.state (plugins.texture): each
// layer — its texture, its main settings and the surface it covers — the
// output, and where a run stands.

import { useTexture } from '../state/textureStore'
import { regionStats } from './regions'
import { defaultRefineLength, lastMesh, scanSurface } from './textureSession'

/** The marking's colour for a layer's paint: BumpMesh's orange. */
export const MASK_COLOR = '#ff6a00'

const MODE_NAMES: Record<number, string> = { 0: 'planar XY', 1: 'planar XZ', 2: 'planar YZ', 3: 'cylindrical', 4: 'spherical', 5: 'triplanar', 6: 'cubic', 7: 'surface normal', 8: 'outline wrap' }

export function describeLayer(i: number, withRegion: boolean): Record<string, unknown> {
  const st = useTexture.getState()
  const L = st.layers[i]
  const s = L.settings
  const surface = scanSurface()
  return {
    layer: i + 1,
    active: i === st.active,
    texture: L.texture ? { name: L.texture.name, kind: L.texture.kind } : null,
    mapping: `${MODE_NAMES[s.mappingMode] ?? s.mappingMode} (${s.mappingMode})`,
    depthMm: s.textureHeight,
    direction: s.symmetricDisplacement ? 'both ways' : s.invertDisplacement ? 'into the surface' : 'out of the surface',
    tileMm: [s.scaleU, s.scaleV],
    rotation: s.rotation,
    ...(s.stampOnce ? { stamp: { center: [s.stampCenterX, s.stampCenterY, s.stampCenterZ] } } : {}),
    ...(s.boundaryFalloff ? { boundaryFalloffMm: s.boundaryFalloff } : {}),
    mask: {
      mode: L.maskMode,
      means: L.maskMode === 'include' ? 'only the painted surface is textured' : 'the painted surface stays plain',
      ...(withRegion && surface ? regionStats(surface, L.mask) : { vertices: L.mask?.length ?? 0 }),
    },
    visible: L.visible,
    ...(i > 0 ? { blend: L.blend } : {}),
  }
}

export function describeTexture(): Record<string, unknown> {
  const st = useTexture.getState()
  const s = scanSurface()
  return {
    layers: st.layers.map((_, i) => describeLayer(i, false)),
    active: st.active + 1,
    output: { ...st.output, refineLength: st.refineChosen || !s ? st.output.refineLength : defaultRefineLength(s), refineChosen: st.refineChosen },
    status: st.status,
    ...(st.progress ? { progress: st.progress } : {}),
    ...(st.result ? { result: { ...st.result, key: undefined, current: !!lastMesh(st.result.kind) } } : {}),
    resultShown: st.previewShown,
    ...(st.error ? { error: st.error } : {}),
  }
}

/** The short form, for the readout's brief. */
export function briefTexture(): Record<string, unknown> {
  const st = useTexture.getState()
  return {
    layers: st.layers.map((L) => `${L.texture?.name ?? 'no texture'}${L.mask ? ` (${L.maskMode} ${L.mask.length} v)` : ''}`),
    status: st.status,
  }
}
