// SPDX-License-Identifier: AGPL-3.0-only
// The kernel's side: each part swept in along its move against what is
// already in place, and each step drawn — the parts already in grey, the
// new ones pulled out along their moves in black, with the path back to
// their place. Runs in the worker on the page, and in Node under test.

import { hlr, nearestOn, type LineKernel, type Polyline } from '../../_shared/lineart/hlr'
import { project, type Camera, type V3 } from '../../_shared/lineart/views'
import type { Step } from './model'

type H = unknown

export interface AsmKernel extends LineKernel {
  importStep(text: string): H
  makeCompound(shapes: H[]): H
  translate(shape: H, dx: number, dy: number, dz: number): H
  common(a: H, b: H): H
  getVolume(shape: H): number
  getBoundingBox(shape: H): { xmin: number; ymin: number; zmin: number; xmax: number; ymax: number; zmax: number }
}

export interface PartIn {
  name: string
  step: string
}

export interface Hit {
  step: number
  part: string
  hits: string
  /** How far short of its place it first touches, mm. */
  before: number
  at: V3
  move: V3
}

export interface Clash {
  step: number
  part: string
  with: string
  volume: number
}

type Box = { min: V3; max: V3 }
const boxOf = (k: AsmKernel, s: H): Box => {
  const b = k.getBoundingBox(s)
  return { min: [b.xmin, b.ymin, b.zmin], max: [b.xmax, b.ymax, b.zmax] }
}
const overlap = (a: Box, b: Box, pad = 0) => [0, 1, 2].every((i) => a.min[i] - pad < b.max[i] && b.min[i] - pad < a.max[i])
const shift = (b: Box, d: V3): Box => ({ min: [b.min[0] + d[0], b.min[1] + d[1], b.min[2] + d[2]], max: [b.max[0] + d[0], b.max[1] + d[1], b.max[2] + d[2]] })
const unit = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** How far a part must travel along d to clear where it ends up. */
export function travelOf(b: Box, d: V3): number {
  const u = unit(d)
  return Math.abs(u[0]) * (b.max[0] - b.min[0]) + Math.abs(u[1]) * (b.max[1] - b.min[1]) + Math.abs(u[2]) * (b.max[2] - b.min[2]) + 2
}

function load(k: AsmKernel, parts: PartIn[]): Map<string, { shape: H; box: Box; volume: number }> {
  const m = new Map<string, { shape: H; box: Box; volume: number }>()
  for (const p of parts) {
    const shape = k.importStep(p.step)
    m.set(p.name, { shape, box: boxOf(k, shape), volume: Math.abs(k.getVolume(shape)) })
  }
  return m
}

const touchVolume = (k: AsmKernel, a: H, b: H): number => {
  try {
    const c = k.common(a, b)
    const v = Math.abs(k.getVolume(c))
    k.release(c)
    return v
  } catch {
    return 0
  }
}

/** Each part moved in along its direction, from far enough out to clear its
 *  place, against the parts placed before it (earlier steps, and earlier in
 *  its own step): where it first runs into one, and parts that overlap in
 *  their places. */
export function sweep(k: AsmKernel, parts: PartIn[], steps: Step[], samples = 40): { hits: Hit[]; clashes: Clash[] } {
  const shapes = load(k, parts)
  const placed: string[] = []
  const hits: Hit[] = []
  const clashes: Clash[] = []
  steps.forEach((s, i) => {
    for (const pl of s.place) {
      const me = shapes.get(pl.part)
      if (!me) continue
      const d = unit(pl.move)
      const travel = pl.travel ?? travelOf(me.box, d)
      const tol = Math.max(1e-3, me.volume * 1e-6)
      for (const other of placed) {
        const o = shapes.get(other)!
        if (!overlap(me.box, o.box)) continue
        const v = touchVolume(k, me.shape, o.shape)
        if (v > tol) clashes.push({ step: i + 1, part: pl.part, with: other, volume: v })
      }
      let first: Hit | null = null
      for (let j = samples; j >= 1 && !first; j--) {
        const back = (travel * j) / samples
        const off: V3 = [-d[0] * back, -d[1] * back, -d[2] * back]
        const b = shift(me.box, off)
        for (const other of placed) {
          const o = shapes.get(other)!
          if (!overlap(b, o.box)) continue
          const moved = k.translate(me.shape, off[0], off[1], off[2])
          const v = touchVolume(k, moved, o.shape)
          if (v > tol) {
            const c = k.common(moved, o.shape)
            const cb = boxOf(k, c)
            k.release(c)
            first = { step: i + 1, part: pl.part, hits: other, before: Number(back.toFixed(2)), at: [0, 1, 2].map((a) => Number(((cb.min[a] + cb.max[a]) / 2).toFixed(2))) as V3, move: d }
          }
          k.release(moved)
          if (first) break
        }
      }
      if (first) {
        hits.push(first)
      }
      placed.push(pl.part)
    }
  })
  return { hits, clashes }
}

export interface Line {
  /** The part it belongs to, and whether that part is new in this step. */
  part: string
  fresh: boolean
  pts: Polyline
}

export interface StepDrawing {
  step: number
  lines: Line[]
  /** Each new part's path, from where it is drawn to its place, and a point
   *  on it for its balloon. */
  paths: { part: string; from: [number, number]; to: [number, number]; anchor: [number, number] }[]
}

/** Each step drawn: parts from earlier steps in place, the step's own parts
 *  pulled back along their moves by `explode` of their travel. */
export function drawSteps(k: AsmKernel, parts: PartIn[], steps: Step[], cameras: Camera[], explode: number): StepDrawing[] {
  const shapes = load(k, parts)
  const out: StepDrawing[] = []
  const before: string[] = []
  steps.forEach((s, i) => {
    const c = cameras[i]
    const scene: { part: string; fresh: boolean; shape: H; off: V3 }[] = before.filter((n) => shapes.has(n)).map((n) => ({ part: n, fresh: false, shape: shapes.get(n)!.shape, off: [0, 0, 0] as V3 }))
    for (const pl of s.place) {
      const me = shapes.get(pl.part)
      if (!me) continue
      const d = unit(pl.move)
      const back = (pl.travel ?? travelOf(me.box, d)) * explode
      const off: V3 = [-d[0] * back, -d[1] * back, -d[2] * back]
      scene.push({ part: pl.part, fresh: true, shape: k.translate(me.shape, ...off), off })
    }
    if (!scene.length) {
      out.push({ step: i + 1, lines: [], paths: [] })
      return
    }
    const whole = scene.length === 1 ? scene[0].shape : k.makeCompound(scene.map((x) => x.shape))
    const view = hlr(k, whole, c)
    const solo = scene.map((x) => ({ ...x, lines: hlr(k, x.shape, c).visible }))
    const lines: Line[] = []
    for (const l of view.visible) {
      let cur: Line | null = null
      for (let j = 0; j + 3 < l.length; j += 2) {
        const mid: [number, number] = [(l[j] + l[j + 2]) / 2, (l[j + 1] + l[j + 3]) / 2]
        let owner = solo[0]
        let best = Infinity
        for (const x of solo) {
          const n = nearestOn(x.lines, mid)
          if (n && n.d < best) {
            best = n.d
            owner = x
          }
        }
        if (!cur || cur.part !== owner.part) {
          if (cur) lines.push(cur)
          cur = { part: owner.part, fresh: owner.fresh, pts: [l[j], l[j + 1]] }
        }
        cur.pts.push(l[j + 2], l[j + 3])
      }
      if (cur) lines.push(cur)
    }
    const paths = scene
      .filter((x) => x.fresh)
      .map((x) => {
        const b = shapes.get(x.part)!.box
        const center: V3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]
        const from = project(c, [center[0] + x.off[0], center[1] + x.off[1], center[2] + x.off[2]])
        const to = project(c, center)
        const mine = lines.filter((l) => l.part === x.part).map((l) => l.pts)
        const far = nearestOn(mine, [from[0] + (from[0] - to[0]), from[1] + (from[1] - to[1])])
        return { part: x.part, from, to, anchor: far?.at ?? from }
      })
    out.push({ step: i + 1, lines, paths })
    for (const pl of s.place) before.push(pl.part)
  })
  return out
}
