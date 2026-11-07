// SPDX-License-Identifier: AGPL-3.0-only
// The named views a line drawing is taken from, and how a point in the part
// lands on the paper: x along screen-right, y along screen-up. Z is up in
// the part, as everywhere in ScanRuler.

export type V3 = [number, number, number]

export const VIEW_NAMES = ['front', 'back', 'top', 'bottom', 'left', 'right', 'iso', 'iso_back'] as const
export type ViewName = (typeof VIEW_NAMES)[number]

/** A camera: toward is the view-plane normal pointing from the part to the
 *  viewer, right is screen-right. */
export interface Camera {
  toward: V3
  right: V3
}

const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2])
  if (!(l > 0)) throw new Error('A view direction cannot be zero.')
  return [v[0] / l, v[1] / l, v[2] / l]
}
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

const NAMED: Record<ViewName, Camera> = {
  front: { toward: [0, -1, 0], right: [1, 0, 0] },
  back: { toward: [0, 1, 0], right: [-1, 0, 0] },
  top: { toward: [0, 0, 1], right: [1, 0, 0] },
  bottom: { toward: [0, 0, -1], right: [1, 0, 0] },
  right: { toward: [1, 0, 0], right: [0, 1, 0] },
  left: { toward: [-1, 0, 0], right: [0, -1, 0] },
  iso: { toward: unit([1, -1, 1]), right: unit([1, 1, 0]) },
  iso_back: { toward: unit([-1, 1, 1]), right: unit([-1, -1, 0]) },
}

/** A named view, or one looked at from `toward` with the part's up (Z, or Y
 *  when looking straight along Z) kept up on the paper. */
export function camera(view: ViewName | { toward: V3; up?: V3 }): Camera {
  if (typeof view === 'string') return NAMED[view]
  const toward = unit(view.toward)
  let up: V3 = view.up ? unit(view.up) : [0, 0, 1]
  if (Math.abs(dot(up, toward)) > 0.999) up = [0, 1, 0]
  const right = unit(cross(up, toward))
  return { toward, right }
}

/** Screen-up for a camera. */
export const upOf = (c: Camera): V3 => cross(c.toward, c.right)

/** Where a point of the part lands in the view's plane, mm. */
export function project(c: Camera, p: V3): [number, number] {
  return [dot(p, c.right), dot(p, upOf(c))]
}
