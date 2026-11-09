// SPDX-License-Identifier: AGPL-3.0-only
// A binary STL as its triangles' corners, x y z after x y z — what a body's
// mesh export hands back, read here so a body is checked as it stands.

export function readBinaryStl(bytes: Uint8Array): Float64Array {
  if (bytes.length < 84) throw new Error('The mesh is too short to hold a triangle.')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const n = dv.getUint32(80, true)
  if (84 + n * 50 > bytes.length) throw new Error(`The mesh says ${n} triangles and holds fewer.`)
  const out = new Float64Array(n * 9)
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true)
  if (!out.every(Number.isFinite)) throw new Error('The mesh has a corner that is not a number.')
  return out
}
