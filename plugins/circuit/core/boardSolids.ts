// SPDX-License-Identifier: AGPL-3.0-only
// The board as solids, with Open CASCADE (occt-wasm): the outline extruded
// to the board's thickness standing on z = 0, its holes, slots and cutouts
// cut through; the copper of the top and bottom layers as thin solids on
// the faces they lie on — the top's from the board's top up by the copper's
// thickness, the bottom's from its underside down — drilled where the board
// is; and each component's footprint box as a keep-out above or below it.
// The copper is solids of its own so it can be shown, exported, or printed
// in another material — a conductive filament — on its own. Inner layers
// are inside the board and are not built.

import type { Board, CircuitBoard, Component, Layer, Outline, Pt } from './circuitJson'
import { areaOf, piecesOf, shapeOf, type Shape } from './geometry'

export type H = unknown
export type XYZ = { x: number; y: number; z: number }

export interface BoardKernel {
  makeLineEdge(a: XYZ, b: XYZ): H
  makeArcEdge(start: XYZ, mid: XYZ, end: XYZ): H
  makeWire(edges: H[]): H
  makeFace(wire: H): H
  extrude(shape: H, dx: number, dy: number, dz: number): H
  makeCylinder(r: number, h: number): H
  translate(shape: H, dx: number, dy: number, dz: number): H
  rotate(shape: H, axis: { point: XYZ; direction: XYZ }, angleRad: number): H
  makeBox(dx: number, dy: number, dz: number): H
  fuseAll(shapes: H[]): H
  cutAll(shape: H, tools: H[]): H
  getSubShapes(shape: H, type: 'solid'): H[]
  getVolume(shape: H): number
  getBoundingBox(shape: H): { xmin: number; ymin: number; zmin: number; xmax: number; ymax: number; zmax: number }
  exportStep(shape: H): string
  makeCompound(shapes: H[]): H
}

export interface SolidOptions {
  /** The copper's thickness, mm: 0.035 for 1 oz, or a printed trace's. */
  copper: number
  /** How tall a keep-out stands where the file gives no 3D size, mm. */
  keepoutHeight: number
  board: boolean
  copperTop: boolean
  copperBottom: boolean
  keepouts: boolean
}

export const SOLID_DEFAULTS: SolidOptions = { copper: 0.035, keepoutHeight: 3, board: true, copperTop: true, copperBottom: true, keepouts: true }

export interface Part {
  name: string
  kind: 'board' | 'copper top' | 'copper bottom' | 'keep-out'
  volume: number
  box: { min: [number, number, number]; max: [number, number, number] }
}

export interface Made {
  parts: { name: string; kind: Part['kind']; shape: H }[]
  /** Pieces left out, with why. */
  notes: string[]
}

const P = (x: number, y: number, z: number): XYZ => ({ x, y, z })

/** The closed outline of a shape (core grown by its radius) as a wire at z.
 *  A polygon with a radius must be convex (a rounded rectangle). */
function wireOf(k: BoardKernel, s: Shape, z: number): H {
  const c = s.core.filter((p, i) => i === 0 || Math.hypot(p.x - s.core[i - 1].x, p.y - s.core[i - 1].y) > 1e-9)
  if (c.length > 2 && Math.hypot(c[0].x - c[c.length - 1].x, c[0].y - c[c.length - 1].y) <= 1e-9) c.pop()
  if (c.length === 2) {
    const [a, b] = c
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L
    const nx = -uy * s.r, ny = ux * s.r
    return k.makeWire([
      k.makeLineEdge(P(a.x - nx, a.y - ny, z), P(b.x - nx, b.y - ny, z)),
      k.makeArcEdge(P(b.x - nx, b.y - ny, z), P(b.x + ux * s.r, b.y + uy * s.r, z), P(b.x + nx, b.y + ny, z)),
      k.makeLineEdge(P(b.x + nx, b.y + ny, z), P(a.x + nx, a.y + ny, z)),
      k.makeArcEdge(P(a.x + nx, a.y + ny, z), P(a.x - ux * s.r, a.y - uy * s.r, z), P(a.x - nx, a.y - ny, z)),
    ])
  }
  const poly = areaOf(c) < 0 ? [...c].reverse() : c
  if (s.r <= 1e-9) return k.makeWire(poly.map((p, i) => k.makeLineEdge(P(p.x, p.y, z), P(poly[(i + 1) % poly.length].x, poly[(i + 1) % poly.length].y, z))))
  // Each edge pushed out by r, and an arc round each corner.
  const n = poly.length
  const out = (i: number) => {
    const a = poly[i], b = poly[(i + 1) % n]
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    return { x: ((b.y - a.y) / L) * s.r, y: (-(b.x - a.x) / L) * s.r }
  }
  const edges: H[] = []
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n]
    const o = out(i)
    const o2 = out((i + 1) % n)
    edges.push(k.makeLineEdge(P(a.x + o.x, a.y + o.y, z), P(b.x + o.x, b.y + o.y, z)))
    const mx = o.x + o2.x, my = o.y + o2.y
    const ml = Math.hypot(mx, my)
    edges.push(k.makeArcEdge(P(b.x + o.x, b.y + o.y, z), P(b.x + (mx / ml) * s.r, b.y + (my / ml) * s.r, z), P(b.x + o2.x, b.y + o2.y, z)))
  }
  return k.makeWire(edges)
}

/** A shape as a prism from z0 to z1. */
export function prismOf(k: BoardKernel, s: Shape, z0: number, z1: number): H {
  if (s.core.length === 1) return k.translate(k.makeCylinder(s.r, z1 - z0), s.core[0].x, s.core[0].y, z0)
  return k.extrude(k.makeFace(wireOf(k, s, z0)), 0, 0, z1 - z0)
}

/** The board's outline: its own corners, or its rectangle. */
export function outlineOf(b: Board): Pt[] {
  if (b.outline) return b.outline
  const { x, y } = b.center
  const hw = b.width / 2, hh = b.height / 2
  return [{ x: x - hw, y: y - hh }, { x: x + hw, y: y - hh }, { x: x + hw, y: y + hh }, { x: x - hw, y: y + hh }]
}

/** Every opening through the board: holes, the drills of plated holes and
 *  vias, and cutouts. */
export function drillsOf(c: CircuitBoard): Outline[] {
  return [
    ...c.holes.map((h) => h.drill),
    ...c.platedHoles.map((h) => h.drill),
    ...c.vias.map((v): Outline => ({ kind: 'circle', x: v.x, y: v.y, r: v.drill / 2 })),
    ...c.traces.flatMap((t) => t.vias.filter((v) => !c.vias.some((x) => Math.hypot(x.x - v.x, x.y - v.y) < 1e-6)).map((v): Outline => ({ kind: 'circle', x: v.x, y: v.y, r: (v.drill ?? 0.25) / 2 }))),
    ...c.cutouts,
  ]
}

const nameOf = (cmp: Component) => cmp.name ?? cmp.source ?? cmp.id

/** Build the solids asked for. Throws when the document has no board. */
export function buildSolids(k: BoardKernel, c: CircuitBoard, o: SolidOptions = SOLID_DEFAULTS): Made {
  const b = c.boards[0]
  if (!b) throw new Error('The Circuit JSON has no pcb_board: there is no board to build.')
  if (!(o.copper > 0)) throw new Error('The copper’s thickness must be above 0.')
  const T = b.thickness
  const parts: Made['parts'] = []
  const notes: string[] = []
  if (c.boards.length > 1) notes.push(`${c.boards.length} boards in the file: the first is built.`)
  const drillTools = (z0: number, z1: number) => drillsOf(c).map((d) => prismOf(k, shapeOf(d), z0, z1))
  if (o.board) {
    let board = prismOf(k, { core: outlineOf(b), r: 0 }, 0, T)
    const tools = drillTools(-1, T + 1)
    if (tools.length) board = k.cutAll(board, tools)
    parts.push({ name: 'Board', kind: 'board', shape: board })
  }
  const pieces = piecesOf(c)
  const inner = pieces.filter((p) => p.layer !== 'top' && p.layer !== 'bottom').length
  if (inner) notes.push(`${inner} piece${inner > 1 ? 's' : ''} of copper on inner layers, inside the board: not built.`)
  const layer = (l: Layer, z0: number, z1: number, kind: 'copper top' | 'copper bottom', label: string) => {
    const on = pieces.filter((p) => p.layer === l)
    if (!on.length) return
    // A piece the kernel cannot make (a pad outline that folds on itself)
    // is left out and said, not the whole layer.
    const prisms: H[] = []
    const failed: string[] = []
    for (const p of on) {
      try {
        prisms.push(prismOf(k, p.shape, z0, z1))
      } catch {
        failed.push(p.ref)
      }
    }
    if (failed.length) notes.push(`${label}: ${failed.length} piece${failed.length > 1 ? 's' : ''} could not be made and ${failed.length > 1 ? 'are' : 'is'} left out (${[...new Set(failed)].slice(0, 5).join(', ')}).`)
    if (!prisms.length) return
    let cu = prisms.length === 1 ? prisms[0] : k.fuseAll(prisms)
    const tools = drillTools(z0 - 1, z1 + 1)
    if (tools.length) cu = k.cutAll(cu, tools)
    // An island of copper is a solid of its own: one each, left to right.
    const solids = k.getSubShapes(cu, 'solid')
    const at = solids.map((s) => ({ s, bb: k.getBoundingBox(s) })).sort((p, q) => p.bb.xmin - q.bb.xmin || p.bb.ymin - q.bb.ymin)
    at.forEach(({ s }, i) => parts.push({ name: at.length > 1 ? `${label} ${i + 1}` : label, kind, shape: s }))
  }
  if (o.copperTop) layer('top', T, T + o.copper, 'copper top', 'Copper top')
  if (o.copperBottom) layer('bottom', -o.copper, 0, 'copper bottom', 'Copper bottom')
  if (o.keepouts) {
    const seen = new Map<string, number>()
    for (const cmp of c.components) {
      if (!(cmp.width > 0 && cmp.height > 0)) {
        notes.push(`${nameOf(cmp)} has no footprint size: no keep-out.`)
        continue
      }
      const h = cmp.tall ?? o.keepoutHeight
      const top = cmp.layer !== 'bottom'
      const z0 = top ? T + o.copper : -o.copper - h
      let box = k.translate(k.makeBox(cmp.width, cmp.height, h), cmp.center.x - cmp.width / 2, cmp.center.y - cmp.height / 2, z0)
      if (cmp.rotation % 360 !== 0) box = k.rotate(box, { point: P(cmp.center.x, cmp.center.y, 0), direction: P(0, 0, 1) }, (cmp.rotation * Math.PI) / 180)
      const base = `Keep-out ${nameOf(cmp)}`
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      parts.push({ name: n > 1 ? `${base} ${n}` : base, kind: 'keep-out', shape: box })
    }
  }
  return { parts, notes }
}

/** A made part's figures: its volume and bounding box. */
export function partOf(k: BoardKernel, p: Made['parts'][number]): Part {
  const bb = k.getBoundingBox(p.shape)
  return { name: p.name, kind: p.kind, volume: k.getVolume(p.shape), box: { min: [bb.xmin, bb.ymin, bb.zmin], max: [bb.xmax, bb.ymax, bb.zmax] } }
}
