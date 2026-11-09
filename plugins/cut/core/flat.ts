// SPDX-License-Identifier: AGPL-3.0-only
// Whether a body is a sheet part — a profile cut straight through a sheet
// of one thickness — read from its faces as reverse.body.describe lists
// them: two parallel flat faces facing apart (the sheet's two sides), and
// every other face square to them (a flat edge face, or a round one whose
// axis runs through the sheet). A flat face between the two sides is a
// step or a pocket; a face leaning across the thickness a bevel, a
// chamfer or a round over an edge: none of them a straight cut makes.

export type V3 = [number, number, number]

/** A face as reverse.body.describe gives it. */
export interface FaceIn {
  index: number
  kind: string
  area: number
  centroid: V3
  normal?: V3
  axis?: V3
}

export interface Offender {
  face: number
  kind: string
  why: string
  at: V3
}

export interface FlatRead {
  /** A sheet part: its sides found, every other face square to them. */
  flat: boolean
  /** The sides' normal (the way the sheet's top faces), or null when no
   *  two flat faces face apart. */
  normal: V3 | null
  thickness: number | null
  /** The sides' places along the normal. */
  top: number | null
  bottom: number | null
  /** The faces a straight cut does not make. */
  offenders: Offender[]
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Parallel within this (the cosine's shortfall from 1): about 0.8°. */
const PARALLEL = 1e-4
/** Square within this cosine: about 0.6°. */
const SQUARE = 0.01

/** The body's sides and thickness, and what is not straight-cut. Of the
 *  directions its flat faces point, the one whose faces facing that way
 *  and the other at the two extremes have the most area is the sheet's. */
export function readFlat(faces: readonly FaceIn[], tol = 0.01): FlatRead {
  const planes = faces.filter((f) => f.kind === 'plane' && f.normal).map((f) => ({ f, n: norm(f.normal!) }))
  let best: { n: V3; score: number } | null = null
  for (const { n } of planes) {
    const along = planes.filter((p) => Math.abs(dot(p.n, n)) >= 1 - PARALLEL)
    if (!along.some((p) => dot(p.n, n) < 0)) continue
    const at = along.map((p) => ({ ...p, o: dot(p.f.centroid, n) }))
    const top = Math.max(...at.filter((p) => dot(p.n, n) > 0).map((p) => p.o))
    const bottom = Math.min(...at.filter((p) => dot(p.n, n) < 0).map((p) => p.o))
    const score = at.filter((p) => (dot(p.n, n) > 0 && Math.abs(p.o - top) <= tol) || (dot(p.n, n) < 0 && Math.abs(p.o - bottom) <= tol)).reduce((s, p) => s + p.f.area, 0)
    if (!best || score > best.score + 1e-9) best = { n, score }
  }
  if (!best) return { flat: false, normal: null, thickness: null, top: null, bottom: null, offenders: [] }
  // The normal made canonical: its largest part positive, so a plate on
  // the XY plane reads +Z.
  const big = [0, 1, 2].reduce((k, i) => (Math.abs(best!.n[i]) > Math.abs(best!.n[k]) ? i : k), 0)
  const n: V3 = best.n[big] < 0 ? [-best.n[0] + 0, -best.n[1] + 0, -best.n[2] + 0] : best.n
  const sides = planes.filter((p) => Math.abs(dot(p.n, n)) >= 1 - PARALLEL).map((p) => ({ ...p, o: dot(p.f.centroid, n), up: dot(p.n, n) > 0 }))
  const top = Math.max(...sides.filter((p) => p.up).map((p) => p.o))
  const bottom = Math.min(...sides.filter((p) => !p.up).map((p) => p.o))
  const offenders: Offender[] = []
  for (const f of faces) {
    const say = (why: string) => offenders.push({ face: f.index, kind: f.kind, why, at: f.centroid.map(r4) as V3 })
    if (f.kind === 'plane' && f.normal) {
      const c = dot(norm(f.normal), n)
      if (Math.abs(c) >= 1 - PARALLEL) {
        const o = dot(f.centroid, n)
        const onSide = c > 0 ? Math.abs(o - top) <= tol : Math.abs(o - bottom) <= tol
        if (!onSide) say(`a flat face ${r4(c > 0 ? top - o : o - bottom)} in from the ${c > 0 ? 'top' : 'bottom'}: a step or a pocket, not cut through`)
      } else if (Math.abs(c) > SQUARE) say(`a flat face leaning ${r4((Math.acos(Math.min(1, Math.abs(c))) * 180) / Math.PI)}° off the sheet’s sides: a bevel or a chamfer`)
    } else if ((f.kind === 'cylinder' || f.kind === 'cone') && f.axis) {
      const c = Math.abs(dot(norm(f.axis), n))
      if (f.kind === 'cone') say('a cone: a countersink or a taper, not a straight cut')
      else if (c < 1 - PARALLEL) say('a round face across the thickness: a rounded edge or a side hole')
    } else if (f.normal && Math.abs(dot(norm(f.normal), n)) <= SQUARE) {
      // A free-form edge face (a spline profile drawn through): read square
      // to the sides at its middle — taken as cut straight, which only its
      // middle says.
    } else say(`a ${f.kind} face: a round over an edge, not a straight cut`)
  }
  return { flat: offenders.length === 0, normal: n.map(r4) as V3, thickness: r4(top - bottom), top: r4(top), bottom: r4(bottom), offenders }
}
