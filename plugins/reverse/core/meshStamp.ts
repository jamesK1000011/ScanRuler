// SPDX-License-Identifier: AGPL-3.0-only
// A body's stamp: a short hash of its mesh, the same for as long as the body
// is and another once it changes. A copy made of a body — the reference part
// Compare in Deviation makes, say — keeps the stamp it was made at, so what
// reads the copy later can tell it is of an older body. Hashed from the
// mesh, not counted per build: a rebuild that comes out the same is the
// same body, and a project opened again stamps its bodies as before.

const stamps = new WeakMap<Float32Array, string>()

/** FNV-1a over the positions' bits and the triangle count, as 8 hex. */
export function meshStamp(mesh: { positions: Float32Array; indices: Uint32Array }): string {
  const held = stamps.get(mesh.positions)
  if (held) return held
  const p = mesh.positions
  const bits = new Uint32Array(p.buffer, p.byteOffset, p.length)
  let h = 0x811c9dc5
  for (let i = 0; i < bits.length; i++) h = Math.imul(h ^ bits[i], 0x01000193)
  h = Math.imul(h ^ mesh.indices.length, 0x01000193)
  const stamp = (h >>> 0).toString(16).padStart(8, '0')
  stamps.set(p, stamp)
  return stamp
}
