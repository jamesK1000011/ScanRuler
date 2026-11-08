// SPDX-License-Identifier: AGPL-3.0-only
// The few kernel calls the generators make — Open CASCADE through
// occt-wasm, in the generators' worker or in Node under test.

export type H = unknown
export type V3 = [number, number, number]
/** A point as occt-wasm takes one. */
export type XYZ = { x: number; y: number; z: number }
export const P = (v: V3): XYZ => ({ x: v[0], y: v[1], z: v[2] })

export interface GenKernel {
  makeLineEdge(a: XYZ, b: XYZ): H
  makeArcEdge(start: XYZ, mid: XYZ, end: XYZ): H
  makeWire(edges: H[]): H
  makeFace(wire: H): H
  extrude(shape: H, dx: number, dy: number, dz: number): H
  loft(wires: H[], solid: boolean, ruled: boolean): H
  makeCylinder(r: number, h: number): H
  translate(shape: H, dx: number, dy: number, dz: number): H
  fuse(a: H, b: H): H
  fuseAll(shapes: H[]): H
  cut(a: H, b: H): H
  cutAll(shape: H, tools: H[]): H
  getVolume(shape: H): number
  getBoundingBox(shape: H): { xmin: number; ymin: number; zmin: number; xmax: number; ymax: number; zmax: number }
  exportStep(shape: H): string
  exportStl?(shape: H, ...rest: unknown[]): unknown
}

/** A rounded rectangle as a closed wire at height z, centred on (cx, cy):
 *  w × d, corners of radius r (0: sharp). */
export function roundRect(k: GenKernel, cx: number, cy: number, w: number, d: number, r: number, z: number): H {
  const hw = w / 2, hd = d / 2
  const R = Math.max(0, Math.min(r, hw - 1e-3, hd - 1e-3))
  if (R < 1e-3) {
    const p: V3[] = [[cx - hw, cy - hd, z], [cx + hw, cy - hd, z], [cx + hw, cy + hd, z], [cx - hw, cy + hd, z]]
    return k.makeWire(p.map((a, i) => k.makeLineEdge(P(a), P(p[(i + 1) % 4]))))
  }
  const e: H[] = []
  const x0 = cx - hw, x1 = cx + hw, y0 = cy - hd, y1 = cy + hd
  const c = R * (1 - Math.SQRT1_2)
  // Each corner by three points on it — start, middle, end — so nothing
  // hangs on which way an angle is counted.
  e.push(k.makeLineEdge(P([x0 + R, y0, z]), P([x1 - R, y0, z])))
  e.push(k.makeArcEdge(P([x1 - R, y0, z]), P([x1 - c, y0 + c, z]), P([x1, y0 + R, z])))
  e.push(k.makeLineEdge(P([x1, y0 + R, z]), P([x1, y1 - R, z])))
  e.push(k.makeArcEdge(P([x1, y1 - R, z]), P([x1 - c, y1 - c, z]), P([x1 - R, y1, z])))
  e.push(k.makeLineEdge(P([x1 - R, y1, z]), P([x0 + R, y1, z])))
  e.push(k.makeArcEdge(P([x0 + R, y1, z]), P([x0 + c, y1 - c, z]), P([x0, y1 - R, z])))
  e.push(k.makeLineEdge(P([x0, y1 - R, z]), P([x0, y0 + R, z])))
  e.push(k.makeArcEdge(P([x0, y0 + R, z]), P([x0 + c, y0 + c, z]), P([x0 + R, y0, z])))
  return k.makeWire(e)
}

/** A rounded-rectangle prism from z0 to z1. */
export function prism(k: GenKernel, cx: number, cy: number, w: number, d: number, r: number, z0: number, z1: number): H {
  return k.extrude(k.makeFace(roundRect(k, cx, cy, w, d, r, z0)), 0, 0, z1 - z0)
}

/** A ruled solid through rounded rectangles stacked up: each [z, inset, r]
 *  of a w × d outline (inset taken from each side). */
export function stepped(k: GenKernel, cx: number, cy: number, w: number, d: number, stations: [number, number, number][]): H {
  return k.loft(stations.map(([z, inset, r]) => roundRect(k, cx, cy, w - 2 * inset, d - 2 * inset, r, z)), true, true)
}
