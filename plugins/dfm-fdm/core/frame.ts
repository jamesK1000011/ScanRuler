// SPDX-License-Identifier: AGPL-3.0-only
// The build frame: the reference part turned so the printer's Z is up. Only
// the six axis directions — a part is modelled square to its print bed far
// more often than not, and a permutation keeps every number exact. X and Y
// are the printer's, whatever the reference called them.

import type { Vec3 } from '../../../src/core/types'

export type Up = '+z' | '-z' | '+x' | '-x' | '+y' | '-y'

export const UPS: readonly Up[] = ['+z', '-z', '+x', '-x', '+y', '-y']

/** Rows of the rotation taking the reference's frame to the build frame;
 *  each a permutation with signs, determinant +1. */
const ROWS: Record<Up, [Vec3, Vec3, Vec3]> = {
  '+z': [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  '-z': [[1, 0, 0], [0, -1, 0], [0, 0, -1]],
  '+x': [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  '-x': [[0, 1, 0], [0, 0, -1], [-1, 0, 0]],
  '+y': [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  '-y': [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
}

export interface BuildFrame {
  up: Up
  rows: [Vec3, Vec3, Vec3]
}

export const buildFrame = (up: Up): BuildFrame => ({ up, rows: ROWS[up] })

export function toBuild(f: BuildFrame, x: number, y: number, z: number, out: Float64Array | number[], at = 0): void {
  const [a, b, c] = f.rows
  out[at] = a[0] * x + a[1] * y + a[2] * z
  out[at + 1] = b[0] * x + b[1] * y + b[2] * z
  out[at + 2] = c[0] * x + c[1] * y + c[2] * z
}

/** Back from the build frame: the transpose. */
export function fromBuild(f: BuildFrame, x: number, y: number, z: number, out: Float64Array | number[], at = 0): void {
  const [a, b, c] = f.rows
  out[at] = a[0] * x + b[0] * y + c[0] * z
  out[at + 1] = a[1] * x + b[1] * y + c[1] * z
  out[at + 2] = a[2] * x + b[2] * y + c[2] * z
}

/** Every vertex of a flat x y z array into the build frame. */
export function arrayToBuild(f: BuildFrame, src: ArrayLike<number>): Float64Array {
  const out = new Float64Array(src.length)
  for (let i = 0; i < src.length; i += 3) toBuild(f, src[i], src[i + 1], src[i + 2], out, i)
  return out
}
