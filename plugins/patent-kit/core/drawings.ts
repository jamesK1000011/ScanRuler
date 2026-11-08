// SPDX-License-Identifier: AGPL-3.0-only
// Each figure drawn in part millimetres from the bodies' STEP: hidden lines
// removed through OCCT, sections cut and their cut faces found for hatching,
// exploded views pulled apart, and where each numeral's lead line should end.
// Runs wherever a kernel is: the page's worker, or Node under test.

import { boxOf, hlr, nearestOn, type LineKernel, type Polyline } from '../../_shared/lineart/hlr'
import { camera, dot, project, type Camera, type V3 } from '../../_shared/lineart/views'
import type { Axis, Figure, Numeral } from './model'

type H = unknown

/** What of occt-wasm's kernel the drawings need beyond the line kernel. */
export interface DrawKernel extends LineKernel {
  importStep(text: string): H
  makeCompound(shapes: H[]): H
  translate(shape: H, dx: number, dy: number, dz: number): H
  cut(a: H, b: H): H
  makeBoxFromCorners(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): H
  getSubShapes(shape: H, type: 'face'): H[]
  getBoundingBox(shape: H): { xmin: number; ymin: number; zmin: number; xmax: number; ymax: number; zmax: number }
  makeLineEdge(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): H
  distanceBetween(a: H, b: H): number
}

export interface BodyIn {
  name: string
  step: string
}

export interface Anchor {
  n: number
  /** Where the lead line ends, part mm in the view's plane. */
  at: [number, number]
}

export interface Drawing {
  figure: string
  visible: Polyline[]
  hidden: Polyline[]
  /** Each body's cut faces' edges, for hatching: even-odd inside is
   *  material; neighbours are hatched the other way. */
  hatch: Polyline[][]
  anchors: Anchor[]
  /** Numerals asked for that this view can't show, and why. */
  missed: { n: number; why: string }[]
  /** A section's cut drawn on the figure it is taken from. */
  cuts: { section: string; a: [number, number]; b: [number, number]; look: [number, number] }[]
  /** Length of the shortest visible edge, part mm: what has to survive a 2/3 reduction. */
  shortestEdge: number
}

const AX: Record<Axis, number> = { x: 0, y: 1, z: 2 }
const BB = ['xmin', 'ymin', 'zmin'] as const
const BBX = ['xmax', 'ymax', 'zmax'] as const

type Box = { min: V3; max: V3 }
const boxOfShape = (k: DrawKernel, s: H): Box => {
  const b = k.getBoundingBox(s)
  return { min: [b.xmin, b.ymin, b.zmin], max: [b.xmax, b.ymax, b.zmax] }
}
const center = (b: Box): V3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]
const union = (a: Box, b: Box): Box => ({ min: [0, 1, 2].map((i) => Math.min(a.min[i], b.min[i])) as V3, max: [0, 1, 2].map((i) => Math.max(a.max[i], b.max[i])) as V3 })

/** The camera a section is looked at with: from the side cut away. */
export function sectionCamera(axis: Axis, keep: 'above' | 'below'): Camera {
  const t: V3 = [0, 0, 0]
  t[AX[axis]] = keep === 'above' ? -1 : 1
  return camera(axis === 'z' ? { toward: t, up: [0, 1, 0] } : { toward: t })
}

export function figureCamera(f: Figure): Camera {
  if (f.kind === 'section' && f.section) return sectionCamera(f.section.axis, f.section.keep)
  return camera(f.view)
}

interface Placed {
  name: string
  shape: H
  box: Box
}

function place(k: DrawKernel, f: Figure, bodies: Map<string, H>): { placed: Placed[]; sectionFaces: H[][] } {
  const names = f.bodies?.length ? f.bodies : [...bodies.keys()]
  let placed: Placed[] = names.map((name) => {
    const shape = bodies.get(name)
    if (!shape) throw new Error(`There is no body named ${name}.`)
    return { name, shape, box: boxOfShape(k, shape) }
  })
  const sectionFaces: H[][] = []
  if (f.kind === 'exploded' && placed.length > 1) {
    const all = placed.map((p) => p.box).reduce(union)
    const c = center(all)
    const factor = f.explode?.factor ?? 1
    placed = placed.map((p) => {
      const pc = center(p.box)
      const d: V3 = [(pc[0] - c[0]) * factor, (pc[1] - c[1]) * factor, (pc[2] - c[2]) * factor]
      const shape = k.translate(p.shape, d[0], d[1], d[2])
      return { name: p.name, shape, box: boxOfShape(k, shape) }
    })
  }
  if (f.kind === 'section' && f.section) {
    const { axis, offset, keep } = f.section
    const i = AX[axis]
    placed = placed.flatMap((p) => {
      const pad = 1 + Math.max(...[0, 1, 2].map((j) => p.box.max[j] - p.box.min[j]))
      const lo: V3 = [p.box.min[0] - pad, p.box.min[1] - pad, p.box.min[2] - pad]
      const hi: V3 = [p.box.max[0] + pad, p.box.max[1] + pad, p.box.max[2] + pad]
      if (keep === 'above') hi[i] = offset
      else lo[i] = offset
      if (keep === 'above' ? p.box.max[i] <= offset : p.box.min[i] >= offset) return []
      const shape = k.cut(p.shape, k.makeBoxFromCorners({ x: lo[0], y: lo[1], z: lo[2] }, { x: hi[0], y: hi[1], z: hi[2] }))
      const faces = k.getSubShapes(shape, 'face').filter((face) => {
        const b = k.getBoundingBox(face)
        return Math.abs(b[BB[i]] - offset) < 1e-4 && Math.abs(b[BBX[i]] - offset) < 1e-4
      })
      if (faces.length) sectionFaces.push(faces)
      return [{ name: p.name, shape, box: boxOfShape(k, shape) }]
    })
  }
  return { placed, sectionFaces }
}

/** Polylines of the faces' edges seen flat by the camera. */
function flat(k: DrawKernel, faces: H[], c: Camera): Polyline[] {
  const out: Polyline[] = []
  for (const face of faces) {
    const w = k.wireframe(face, 0.02)
    for (let g = 0; g < w.edgeGroups.length; g += 3) {
      const line: Polyline = []
      for (let i = w.edgeGroups[g]; i < w.edgeGroups[g] + w.edgeGroups[g + 1]; i += 3) line.push(...project(c, [w.points[i], w.points[i + 1], w.points[i + 2]]))
      if (line.length >= 4) out.push(line)
    }
  }
  return out
}

/** Points along the lines, about `step` apart. */
function samples(lines: Polyline[], step: number): [number, number][] {
  const out: [number, number][] = []
  for (const l of lines)
    for (let i = 0; i + 3 < l.length; i += 2) {
      const len = Math.hypot(l[i + 2] - l[i], l[i + 3] - l[i + 1])
      const n = Math.max(1, Math.ceil(len / step))
      for (let j = 0; j < n; j++) out.push([l[i] + ((l[i + 2] - l[i]) * (j + 0.5)) / n, l[i + 1] + ((l[i + 3] - l[i + 1]) * (j + 0.5)) / n])
    }
  return out
}

function shortest(lines: Polyline[]): number {
  let s = Infinity
  for (const l of lines) {
    let len = 0
    for (let i = 0; i + 3 < l.length; i += 2) len += Math.hypot(l[i + 2] - l[i], l[i + 3] - l[i + 1])
    if (len > 1e-6) s = Math.min(s, len)
  }
  return s
}

export function drawFigures(k: DrawKernel, bodiesIn: BodyIn[], figures: Figure[], numerals: Numeral[], opts: { hidden: boolean }): Drawing[] {
  const bodies = new Map<string, H>()
  for (const b of bodiesIn) bodies.set(b.name, k.importStep(b.step))
  const drawings: Drawing[] = []
  const placedBy = new Map<string, Placed[]>()
  for (const f of figures) {
    const c = figureCamera(f)
    const { placed, sectionFaces } = place(k, f, bodies)
    placedBy.set(f.id, placed)
    if (placed.length === 0) {
      drawings.push({ figure: f.id, visible: [], hidden: [], hatch: [], anchors: [], missed: [], cuts: [], shortestEdge: Infinity })
      continue
    }
    const whole = placed.length === 1 ? placed[0].shape : k.makeCompound(placed.map((p) => p.shape))
    const view = hlr(k, whole, c)
    const partBox = placed.map((p) => p.box).reduce(union)
    const box = boxOf(view.visible)
    const size = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-6)
    const step = size / 200
    const tol = size / 400
    const own = new Map(placed.map((p) => [p.name, hlr(k, p.shape, c).visible]))
    const anchors: Anchor[] = []
    const missed: { n: number; why: string }[] = []
    const wanted = numerals.filter((nm) => (f.numerals ? f.numerals.includes(nm.n) : true)).sort((a, b) => Number('at' in b.target) - Number('at' in a.target))
    const pts = samples(view.visible, step)
    const edgeDist = (p: [number, number]) => Math.min(p[0] - box.minX, box.maxX - p[0], p[1] - box.minY, box.maxY - p[1])
    const taken: [number, number][] = []
    for (const nm of wanted) {
      const t = nm.target
      if ('at' in t) {
        if (t.body && !own.has(t.body)) {
          if (f.numerals) missed.push({ n: nm.n, why: `${t.body} is not in this figure` })
          continue
        }
        const offset = t.body ? placedOffset(k, f, placed, t.body, bodies) : ([0, 0, 0] as V3)
        const q: V3 = [t.at[0] + offset[0], t.at[1] + offset[1], t.at[2] + offset[2]]
        const p = project(c, q)
        const near = nearestOn(view.visible, p)
        const span = Math.max(...[0, 1, 2].map((j) => partBox.max[j] - partBox.min[j]))
        if (!q.every(Number.isFinite) || [0, 1, 2].some((j) => q[j] < partBox.min[j] - span || q[j] > partBox.max[j] + span)) {
          missed.push({ n: nm.n, why: 'the point is far off the part' })
          continue
        }
        const eps = span * 1e-3
        const ray = k.makeLineEdge({ x: q[0] + c.toward[0] * eps, y: q[1] + c.toward[1] * eps, z: q[2] + c.toward[2] * eps }, { x: q[0] + c.toward[0] * span * 3, y: q[1] + c.toward[1] * span * 3, z: q[2] + c.toward[2] * span * 3 })
        let clear = false
        try {
          clear = k.distanceBetween(ray, whole) > eps / 4
        } catch {
          clear = false
        } finally {
          k.release(ray)
        }
        const onPart = p[0] >= box.minX - tol && p[0] <= box.maxX + tol && p[1] >= box.minY - tol && p[1] <= box.maxY + tol
        if (!clear || !onPart || !near) {
          missed.push({ n: nm.n, why: 'the point is hidden or off the part in this view' })
          continue
        }
        const at = near.d < tol * 2 ? near.at : p
        anchors.push({ n: nm.n, at })
        taken.push(at)
        continue
      }
      const mine = own.get(t.body)
      if (!mine) {
        if (f.numerals) missed.push({ n: nm.n, why: `${t.body} is not in this figure` })
        continue
      }
      let best: [number, number] | null = null
      let score = Infinity
      for (const p of pts) {
        const d = nearestOn(mine, p)
        if (!d || d.d > tol) continue
        const crowd = taken.reduce((m, q) => Math.min(m, Math.hypot(q[0] - p[0], q[1] - p[1])), Infinity)
        const corner = Math.min(...[box.minX, box.maxX].flatMap((x) => [box.minY, box.maxY].map((y) => Math.hypot(p[0] - x, p[1] - y))))
        const s = edgeDist(p) + (crowd < size / 4 ? size * (1 - crowd / (size / 4)) : 0) + Math.max(0, size * 0.12 - corner)
        if (s < score) {
          score = s
          best = p
        }
      }
      if (!best) {
        missed.push({ n: nm.n, why: `${t.body} is hidden behind the other parts in this view` })
        continue
      }
      anchors.push({ n: nm.n, at: best })
      taken.push(best)
    }
    drawings.push({
      figure: f.id,
      visible: view.visible,
      hidden: opts.hidden ? view.hidden : [],
      hatch: f.kind === 'section' ? sectionFaces.map((faces) => flat(k, faces, c)) : [],
      anchors,
      missed,
      cuts: [],
      shortestEdge: shortest(view.visible),
    })
  }
  for (const f of figures) {
    if (f.kind !== 'section' || !f.section?.from) continue
    const src = figures.find((g) => g.id === f.section!.from)
    const d = drawings.find((g) => g.figure === f.section!.from)
    const placed = placedBy.get(f.section.from)
    if (!src || !d || !placed?.length) continue
    const sc = figureCamera(src)
    const i = AX[f.section.axis]
    const box = placed.map((p) => p.box).reduce(union)
    const normal: V3 = [0, 0, 0]
    normal[i] = 1
    if (Math.abs(dot(normal, sc.toward)) > 0.2) continue
    const corners: [number, number][] = []
    for (const a of [box.min, box.max])
      for (const b of [box.min, box.max]) {
        const p: V3 = [0, 0, 0]
        const others = [0, 1, 2].filter((j) => j !== i)
        p[i] = f.section.offset
        p[others[0]] = a[others[0]]
        p[others[1]] = b[others[1]]
        corners.push(project(sc, p))
      }
    let a = corners[0]
    let b = corners[1]
    let far = -1
    for (const p of corners)
      for (const q of corners) {
        const dd = Math.hypot(p[0] - q[0], p[1] - q[1])
        if (dd > far) {
          far = dd
          a = p
          b = q
        }
      }
    const look = sectionCamera(f.section.axis, f.section.keep).toward
    const l = project(sc, [-look[0], -look[1], -look[2]])
    const ll = Math.hypot(l[0], l[1]) || 1
    d.cuts.push({ section: f.id, a, b, look: [l[0] / ll, l[1] / ll] })
  }
  return drawings
}

/** How far a body was moved in a figure (exploded), so a point picked on
 *  it moves with it. */
function placedOffset(k: DrawKernel, f: Figure, placed: Placed[], body: string, bodies: Map<string, H>): V3 {
  if (f.kind !== 'exploded') return [0, 0, 0]
  const p = placed.find((x) => x.name === body)
  const orig = bodies.get(body)
  if (!p || !orig) return [0, 0, 0]
  const a = center(boxOfShape(k, orig))
  const b = center(p.box)
  return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
}
