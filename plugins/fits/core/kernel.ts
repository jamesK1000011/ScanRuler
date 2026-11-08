// SPDX-License-Identifier: AGPL-3.0-only
// The kernel calls the Fits parts are built with — Open CASCADE through
// occt-wasm, in the plugin's worker or in Node under test — and the few
// solids they are built from.

export type H = unknown
/** A point as occt-wasm takes one. */
export type XYZ = { x: number; y: number; z: number }
export const P = (x: number, y: number, z: number): XYZ => ({ x, y, z })

export interface Kernel {
  makeBox(dx: number, dy: number, dz: number): H
  makeCylinder(r: number, h: number): H
  makeCone(r1: number, r2: number, h: number): H
  makeLineEdge(a: XYZ, b: XYZ): H
  makeArcEdge(start: XYZ, mid: XYZ, end: XYZ): H
  makeWire(edges: H[]): H
  makeFace(wire: H): H
  extrude(shape: H, dx: number, dy: number, dz: number): H
  translate(shape: H, dx: number, dy: number, dz: number): H
  rotate(shape: H, axis: { point: XYZ; direction: XYZ }, angleRad: number): H
  fuse(a: H, b: H): H
  fuseAll(shapes: H[]): H
  cut(a: H, b: H): H
  cutAll(shape: H, tools: H[]): H
  getVolume(shape: H): number
  getBoundingBox(shape: H): { xmin: number; ymin: number; zmin: number; xmax: number; ymax: number; zmax: number }
  exportStep(shape: H): string
}

/** A box between two corners. */
export const box = (k: Kernel, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): H => k.translate(k.makeBox(x1 - x0, y1 - y0, z1 - z0), x0, y0, z0)

/** An upright cylinder of radius r, centred on (x, y), from z0 to z1. */
export const cylZ = (k: Kernel, r: number, x: number, y: number, z0: number, z1: number): H => k.translate(k.makeCylinder(r, z1 - z0), x, y, z0)

/** An upright cone frustum, radius r0 at z0 to r1 at z1. */
export const coneZ = (k: Kernel, r0: number, r1: number, x: number, y: number, z0: number, z1: number): H => k.translate(k.makeCone(r0, r1, z1 - z0), x, y, z0)

/** A cylinder of radius r along X, from x0 to x1, its axis through (y, z). */
export function cylX(k: Kernel, r: number, x0: number, x1: number, y: number, z: number): H {
  // Turned a quarter about Y, Z goes onto X.
  const c = k.rotate(k.makeCylinder(r, x1 - x0), { point: P(0, 0, 0), direction: P(0, 1, 0) }, Math.PI / 2)
  return k.translate(c, x0, y, z)
}

/** A round pin from z0 to z1 with its ends chamfered by ch. */
export function chamferedPin(k: Kernel, r: number, x: number, y: number, z0: number, z1: number, ch: number): H {
  if (ch <= 1e-6) return cylZ(k, r, x, y, z0, z1)
  return k.fuseAll([coneZ(k, r - ch, r, x, y, z0, z0 + ch), cylZ(k, r, x, y, z0 + ch, z1 - ch), coneZ(k, r, r - ch, x, y, z1 - ch, z1)])
}

/** A closed polygon in the XZ plane at y = 0, through points [x, z], with
 *  arcs where a point carries a middle point: [x, z, mx, mz] is an arc from
 *  the point before through (mx, mz) to (x, z). */
export function profileXZ(k: Kernel, pts: number[][]): H {
  const edges: H[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    if (b.length === 4) edges.push(k.makeArcEdge(P(a[0], 0, a[1]), P(b[2], 0, b[3]), P(b[0], 0, b[1])))
    else edges.push(k.makeLineEdge(P(a[0], 0, a[1]), P(b[0], 0, b[1])))
  }
  return k.makeFace(k.makeWire(edges))
}

// ---- engraved labels: seven segments ---------------------------------------------------

/** Glyph height, width, stroke. */
export const GLYPH = { h: 3, w: 1.8, s: 0.45, gap: 0.45 } as const

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', '+': 'gp',
}

/** The rectangles [x0, y0, x1, y1] a glyph is drawn with, from its lower
 *  left corner; and its advance. */
function glyph(ch: string): { rects: number[][]; width: number } {
  const { h, w, s } = GLYPH
  if (ch === '.') return { rects: [[0, 0, s, s]], width: s }
  const segs = SEGMENTS[ch]
  if (segs === undefined) throw new RangeError(`No glyph for "${ch}".`)
  const R: Record<string, number[]> = {
    a: [0, h - s, w, h],
    b: [w - s, h / 2, w, h],
    c: [w - s, 0, w, h / 2],
    d: [0, 0, w, s],
    e: [0, 0, s, h / 2],
    f: [0, h / 2, s, h],
    g: [0, h / 2 - s / 2, w, h / 2 + s / 2],
    p: [w / 2 - s / 2, h / 4, w / 2 + s / 2, (3 * h) / 4],
  }
  return { rects: [...segs].map((k) => R[k]), width: w }
}

export function labelWidth(text: string): number {
  const ws = [...text].map((c) => glyph(c).width)
  return ws.reduce((a, b) => a + b, 0) + GLYPH.gap * Math.max(0, ws.length - 1)
}

/** A label's cutters: boxes centred on (cx, cy), from z0 up to z1. */
export function labelCutters(k: Kernel, text: string, cx: number, cy: number, z0: number, z1: number): H[] {
  let x = cx - labelWidth(text) / 2
  const y = cy - GLYPH.h / 2
  const out: H[] = []
  for (const c of text) {
    const g = glyph(c)
    for (const [a, b, e, f] of g.rects) out.push(box(k, x + a, y + b, z0, x + e, y + f, z1))
    x += g.width + GLYPH.gap
  }
  return out
}

/** A clearance as a label: "+.10", "-.05", "0", "+1.5". */
export function clearanceLabel(c: number): string {
  const v = Math.round(c * 100) / 100
  if (v === 0) return '0'
  const a = Math.abs(v)
  const body = a < 1 ? `.${String(Math.round(a * 100)).padStart(2, '0')}` : a.toFixed(a * 10 === Math.round(a * 10) ? 1 : 2)
  return `${v < 0 ? '-' : '+'}${body}`
}
