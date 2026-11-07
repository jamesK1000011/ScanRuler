// SPDX-License-Identifier: AGPL-3.0-only
// Hidden-line removal through OCCT's HLRBRep (occt-wasm's projectEdges): a
// solid seen from a camera as 2D polylines, visible and hidden apart. Takes
// the kernel as an argument, so it runs in a worker on the page and in Node
// under test alike.

import { type Camera, type V3 } from './views'

/** A polyline on the paper: x, y, x, y… in mm, part scale. */
export type Polyline = number[]

export interface Projection {
  visible: Polyline[]
  hidden: Polyline[]
  /** Visible silhouette lines of curved faces, a subset of visible. */
  outline: number
}

type H = unknown
type Vec = { x: number; y: number; z: number }

/** What of occt-wasm's OcctKernel this needs. */
export interface LineKernel {
  projectEdges(shape: H, origin: Vec, toward: Vec, right?: Vec): Record<string, H>
  wireframe(shape: H, deflection: number): { points: Float32Array; edgeGroups: Int32Array; edgeCount: number }
  isNull(shape: H): boolean
  release(shape: H): void
}

const vec = (v: V3): Vec => ({ x: v[0], y: v[1], z: v[2] })

function polylines(k: LineKernel, h: H, deflection: number): Polyline[] {
  if (!h || k.isNull(h)) return []
  const w = k.wireframe(h, deflection)
  const out: Polyline[] = []
  for (let g = 0; g < w.edgeGroups.length; g += 3) {
    const start = w.edgeGroups[g]
    const count = w.edgeGroups[g + 1]
    const line: Polyline = []
    for (let i = start; i < start + count; i += 3) line.push(w.points[i], w.points[i + 1])
    if (line.length >= 4) out.push(line)
  }
  return out
}

/** The shape seen from the camera. Smooth edges, where two faces meet
 *  tangent, are left out by default as patent and assembly drawings do. */
export function hlr(k: LineKernel, shape: H, c: Camera, opts: { deflection?: number; smooth?: boolean } = {}): Projection {
  const deflection = opts.deflection ?? 0.02
  const p = k.projectEdges(shape, { x: 0, y: 0, z: 0 }, vec(c.toward), vec(c.right))
  const outline = polylines(k, p.visibleOutline, deflection)
  const visible = [...polylines(k, p.visibleSharp, deflection), ...outline, ...(opts.smooth ? polylines(k, p.visibleSmooth, deflection) : [])]
  const hidden = [...polylines(k, p.hiddenSharp, deflection), ...polylines(k, p.hiddenOutline, deflection), ...(opts.smooth ? polylines(k, p.hiddenSmooth, deflection) : [])]
  for (const h of Object.values(p)) if (h) k.release(h)
  return { visible, hidden, outline: outline.length }
}

export interface Box2 {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function boxOf(lines: Polyline[]): Box2 {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const l of lines)
    for (let i = 0; i < l.length; i += 2) {
      b.minX = Math.min(b.minX, l[i])
      b.maxX = Math.max(b.maxX, l[i])
      b.minY = Math.min(b.minY, l[i + 1])
      b.maxY = Math.max(b.maxY, l[i + 1])
    }
  return b
}

/** The nearest point on any of the polylines to p, and how far. */
export function nearestOn(lines: Polyline[], p: [number, number]): { at: [number, number]; d: number } | null {
  let best: { at: [number, number]; d: number } | null = null
  for (const l of lines)
    for (let i = 0; i + 3 < l.length; i += 2) {
      const ax = l[i], ay = l[i + 1], bx = l[i + 2], by = l[i + 3]
      const dx = bx - ax, dy = by - ay
      const len2 = dx * dx + dy * dy
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0
      const q: [number, number] = [ax + t * dx, ay + t * dy]
      const d = Math.hypot(p[0] - q[0], p[1] - q[1])
      if (!best || d < best.d) best = { at: q, d }
    }
  return best
}

/** Total length of the polylines, mm. */
export function lengthOf(lines: Polyline[]): number {
  let s = 0
  for (const l of lines) for (let i = 0; i + 3 < l.length; i += 2) s += Math.hypot(l[i + 2] - l[i], l[i + 3] - l[i + 1])
  return s
}
