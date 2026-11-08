// SPDX-License-Identifier: AGPL-3.0-only
// A planned cut as Reverse Engineer features: one sketch per step on a plane
// square to the hole's axis, every copy of a pattern in it, then one
// extrude cut per sketch into the body alone — all the sketches first, so
// a sketch on the body's face finds the face as it stood before the cuts.
// Profiles are drawn on the sketch's sheet ([u, v]) — circles, a teardrop
// (a circle and two lines tangent to it meeting above it), a hex sized
// across flats, a hex run out into a slot — locked where they are drawn.
// Pure: the command works out the planes and the sheet.

import type { Cut, Step } from './plan'

export type V2 = [number, number]
export type V3 = [number, number, number]
type Json = Record<string, unknown>

/** Where the cut goes, as the command found it. */
export interface Placement {
  /** The sketch plane at a depth into the part, as reverse.feature.add
   *  takes a plane. */
  planeAt(depth: number): Json
  /** +1 where the planes' normal runs into the part, −1 where it runs out. */
  sign: 1 | -1
  /** Each copy's centre on the sheet. */
  centres: V2[]
  /** World +Z on the sheet, made unit length: where a teardrop points.
   *  null where the hole stands near upright. */
  up: V2 | null
  /** The body cut. */
  body: string | number
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0
const at = (c: V2, r: number, a: number): V2 => [r6(c[0] + r * Math.cos(a)), r6(c[1] + r * Math.sin(a))]
const deg = (rad: number) => (rad * 180) / Math.PI

/** The teardrop's two lines: from where they leave the circle, 45° either
 *  side of up, to the point r·√2 above the centre — tangent there. */
export function teardropLines(c: V2, r: number, up: V2): V2[] {
  const phi = Math.atan2(up[1], up[0])
  return [at(c, r, phi - Math.PI / 4), at(c, r * Math.SQRT2, phi), at(c, r, phi + Math.PI / 4)]
}

/** A hex sized across flats `s`, run out along `angleDeg` to `length` from
 *  its centre as a slot as wide as the flats: one closed outline. */
export function hexSlotOutline(c: V2, s: number, angleDeg: number, length: number): V2[] {
  const t = (angleDeg * Math.PI) / 180
  const R = s / 2 / Math.cos(Math.PI / 6)
  const corners = [60, 120, 180, 240, 300].map((k) => at(c, R, t + (k * Math.PI) / 180))
  const end: V2 = [c[0] + length * Math.cos(t), c[1] + length * Math.sin(t)]
  const side = (sgn: number): V2 => [r6(end[0] + sgn * (s / 2) * Math.cos(t + Math.PI / 2)), r6(end[1] + sgn * (s / 2) * Math.sin(t + Math.PI / 2))]
  return [...corners, side(-1), side(1)]
}

/** A rectangle w along its own u, l along its v, turned angleDeg on the
 *  sheet about its centre: its four corners. */
export function rectOutline(c: V2, w: number, l: number, angleDeg: number): V2[] {
  const t = (angleDeg * Math.PI) / 180
  return [[w, l], [-w, l], [-w, -l], [w, -l]].map(([a, b]) => [r6(c[0] + (a / 2) * Math.cos(t) - (b / 2) * Math.sin(t)), r6(c[1] + (a / 2) * Math.sin(t) + (b / 2) * Math.cos(t))] as V2)
}

/** One step's shapes at every centre. */
export function shapesOf(step: Step, p: Placement): Json[] {
  const out: Json[] = []
  const r = step.diameter / 2
  for (const c of p.centres) {
    if (step.profile === 'circle') {
      out.push({ kind: 'circle', center: c, radius: r6(r), fixed: true })
      if (step.teardrop && p.up) out.push({ kind: 'polyline', points: teardropLines(c, r, p.up), fixed: true })
    } else if (step.profile === 'hex') {
      // Stood on a corner where the hole is level: its roof two 60° slopes.
      const angleDeg = p.up ? r6(deg(Math.atan2(p.up[1], p.up[0])) + 30) : 0
      out.push({ kind: 'polygon', center: c, sides: 6, radius: r6(r), fit: 'circumscribed', angleDeg, fixed: true })
    } else if (step.profile === 'rect') {
      out.push({ kind: 'polyline', points: rectOutline(c, step.diameter, step.length ?? step.diameter, step.angleDeg ?? 0), closed: true, fixed: true })
    } else {
      out.push({ kind: 'polyline', points: hexSlotOutline(c, step.diameter, step.slot!.angleDeg, step.slot!.length), closed: true, fixed: true })
    }
  }
  return out
}

/** The extent of a step, as offsets along its sketch plane's normal. */
export function extentOf(step: Step, sign: 1 | -1): Json {
  const plane = step.sketchAt ?? 0
  const off = (t: number) => r6(sign * (t - plane))
  if (step.to === null) return { kind: 'toLast', from: off(step.from), ...(sign < 0 ? { reverse: true } : {}) }
  return { kind: 'distance', from: off(step.from), to: off(step.to) }
}

const ROLE_WORD: Record<Step['role'], string> = { head: 'head', countersink: 'countersink', shaft: 'shaft', nut: 'nut', bore: 'hole', pocket: 'pocket', relief: 'relief' }

/** The features for a cut, named from `base`: "<base> head sketch" and
 *  "<base> head", and so on. */
export function featuresOf(cut: Cut, p: Placement, base: string): { features: Json[]; names: string[] } {
  const sketches: Json[] = []
  const cuts: Json[] = []
  for (const step of cut.steps) {
    const name = `${base} ${ROLE_WORD[step.role]}`
    sketches.push({ kind: 'sketch', name: `${name} sketch`, plane: p.planeAt(step.sketchAt ?? 0), sketch: { shapes: shapesOf(step, p) } })
    cuts.push({ kind: 'extrude', name, sketchId: `${name} sketch`, regions: 'all', extent: extentOf(step, p.sign), ...(step.draftDeg ? { draftDeg: step.draftDeg } : {}), op: 'cut', target: p.body })
  }
  const features = [...sketches, ...cuts]
  return { features, names: features.map((f) => f.name as string) }
}

export type Pattern =
  | { kind: 'circle'; count: number; diameter: number; startDeg?: number }
  | { kind: 'rectangle'; width: number; height: number }
  | { kind: 'grid'; countU: number; countV: number; stepU: number; stepV: number }

/** A pattern's offsets on the sheet from the centre it is laid about. */
export function patternOffsets(pattern: Pattern | undefined): V2[] {
  if (!pattern) return [[0, 0]]
  switch (pattern.kind) {
    case 'circle': {
      const a0 = ((pattern.startDeg ?? 0) * Math.PI) / 180
      return Array.from({ length: pattern.count }, (_, i) => at([0, 0], pattern.diameter / 2, a0 + (2 * Math.PI * i) / pattern.count))
    }
    case 'rectangle': {
      const w = pattern.width / 2
      const h = pattern.height / 2
      return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([u, v]) => [r6(u), r6(v)] as V2)
    }
    case 'grid': {
      const out: V2[] = []
      for (let j = 0; j < pattern.countV; j++)
        for (let i = 0; i < pattern.countU; i++) out.push([r6((i - (pattern.countU - 1) / 2) * pattern.stepU), r6((j - (pattern.countV - 1) / 2) * pattern.stepV)])
      return out
    }
  }
}

/** Two copies closer than their widest step: they would run into each other. */
export function overlapping(cut: Cut, offsets: V2[]): number | null {
  const widest = Math.max(...cut.steps.map((s) => (s.profile === 'circle' ? s.diameter : s.profile === 'rect' ? Math.hypot(s.diameter, s.length ?? s.diameter) : s.diameter / Math.cos(Math.PI / 6))))
  let least = Infinity
  for (let i = 0; i < offsets.length; i++)
    for (let j = i + 1; j < offsets.length; j++) least = Math.min(least, Math.hypot(offsets[i][0] - offsets[j][0], offsets[i][1] - offsets[j][1]))
  return least < widest ? least : null
}
