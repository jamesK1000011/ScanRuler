// SPDX-License-Identifier: AGPL-3.0-only
// The two parts fit-comp reads, in the build frame: the reference as the
// Deviation workspace opened it (welded, so a wall and the face it meets
// share their corner), and the scan carried onto it by the alignment.

import { sceneOf } from '../../../src/commands/host'
import { rigidApply, rigidRotate } from '../../../src/core/deviation/rigid'
import { CommandError } from '../../../src/plugins/api'
import { useDeviation } from '../../../src/state/deviationStore'
import { useStore } from '../../../src/state/store'
import { findFeatures, type Features } from '../core/features'
import { arrayToBuild, buildFrame, type BuildFrame, type Up } from '../core/frame'

export interface Reference {
  name: string
  frame: BuildFrame
  /** Welded vertices in the build frame, and the triangles over them. */
  positions: Float64Array
  indices: Uint32Array
  features: Features
}

let cached: { geometry: unknown; version: number; up: Up; ref: Reference } | null = null

/** Merge the vertices a triangle soup repeats. */
export function weld(src: ArrayLike<number>, index: ArrayLike<number> | null): { positions: Float64Array; indices: Uint32Array } {
  const count = index ? index.length : src.length / 3
  const map = new Map<string, number>()
  const pos: number[] = []
  const indices = new Uint32Array(count)
  for (let k = 0; k < count; k++) {
    const i = index ? index[k] : k
    const x = src[3 * i], y = src[3 * i + 1], z = src[3 * i + 2]
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`
    let v = map.get(key)
    if (v === undefined) {
      v = map.size
      map.set(key, v)
      pos.push(x, y, z)
    }
    indices[k] = v
  }
  return { positions: Float64Array.from(pos), indices }
}

export function requireAligned(): void {
  if (!useStore.getState().fileName) throw new CommandError('no_scan', 'There is no scan open — open the scanned print with scan.open.')
  const d = useDeviation.getState()
  if (!d.nominalName) throw new CommandError('invalid_state', 'No reference part is open — open the CAD the part was printed from with deviation.open_reference.')
  if (!d.align) throw new CommandError('invalid_state', 'The scan is not aligned to the reference — run deviation.align first.')
}

export function reference(up: Up): Reference {
  requireAligned()
  const scene = sceneOf()
  const g = scene?.nominalGeometry()
  if (!g) throw new CommandError('unavailable', 'The reference part is not on the stage — fit-comp reads it from the viewport.')
  const version = useDeviation.getState().nominalName ? (g as { version?: number }).version ?? 0 : 0
  if (cached && cached.geometry === g && cached.version === version && cached.up === up) return cached.ref
  const pos = g.getAttribute('position').array as ArrayLike<number>
  const idx = g.getIndex()?.array ?? null
  const welded = weld(pos, idx)
  const frame = buildFrame(up)
  const positions = arrayToBuild(frame, welded.positions)
  const ref: Reference = { name: useDeviation.getState().nominalName ?? 'reference', frame, positions, indices: welded.indices, features: findFeatures(positions, welded.indices) }
  cached = { geometry: g, version, up, ref }
  return ref
}

/** The scan's points and normals, carried onto the reference by the
 *  alignment, in the build frame. */
export function alignedScan(frame: BuildFrame): { positions: Float64Array; normals: Float64Array } {
  requireAligned()
  const mesh = sceneOf()?.scanMesh()
  if (!mesh) throw new CommandError('unavailable', 'The scan is not on the stage.')
  const align = useDeviation.getState().align!.transform
  const n = mesh.positions.length / 3
  const tmp = new Float64Array(3)
  const p = new Float64Array(3 * n), q = new Float64Array(3 * n)
  for (let i = 0; i < n; i++) {
    rigidApply(align, mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2], tmp)
    p.set(tmp, 3 * i)
    rigidRotate(align, mesh.normals[3 * i], mesh.normals[3 * i + 1], mesh.normals[3 * i + 2], tmp)
    q.set(tmp, 3 * i)
  }
  return { positions: arrayToBuild(frame, p), normals: arrayToBuild(frame, q) }
}
