// SPDX-License-Identifier: AGPL-3.0-only
// The shapes of a run on a sheet: a trace or channel of width w along a
// polyline drawn as one closed outline with mitred corners — its area
// exactly the centreline's length times w — or, where a bend is too tight
// for the run on either side of it, as a rectangle per segment and a disc
// at each bend, overlapping (the sketch joins them). Distances between
// runs in 3D for clearance. Pure, millimetres.

export type V2 = [number, number]
export type V3 = [number, number, number]

const sub2 = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]]
const len2 = (a: V2) => Math.hypot(a[0], a[1])
const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0
const p6 = (p: V2): V2 => [r6(p[0]), r6(p[1])]

/** Points closer than this are one, mm. */
export const TINY = 1e-6

/** The polyline with repeated points and straight-through corners taken
 *  out. */
export function tidy<T extends number[]>(pts: T[]): T[] {
  const out: T[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.hypot(...p.map((x, i) => x - last[i])) < TINY) continue
    out.push(p)
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1]
    const d1 = b.map((x, k) => x - a[k]), d2 = c.map((x, k) => x - b[k])
    const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2)
    const dotp = d1.reduce((s, x, k) => s + x * d2[k], 0) / (l1 * l2)
    if (dotp > 1 - 1e-12) out.splice(i, 1)
  }
  return out
}

export function polylineLength(pts: number[][]): number {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += Math.hypot(...pts[i].map((x, k) => x - pts[i - 1][k]))
  return s
}

/** The turn at each inner corner, radians (0 straight on, π back). */
export function turns(pts: number[][]): number[] {
  const out: number[] = []
  for (let i = 1; i < pts.length - 1; i++) {
    const d1 = pts[i].map((x, k) => x - pts[i - 1][k]), d2 = pts[i + 1].map((x, k) => x - pts[i][k])
    const c = d1.reduce((s, x, k) => s + x * d2[k], 0) / (Math.hypot(...d1) * Math.hypot(...d2))
    out.push(Math.acos(Math.max(-1, Math.min(1, c))))
  }
  return out
}

/** The sharpest bend a run takes, radians: past it a mitre reaches too
 *  far and the run is refused. */
export const MAX_TURN = (135 * Math.PI) / 180 + 1e-9

/**
 * One closed outline round a polyline of width w, its corners mitred:
 * the left offset forward and the right offset back. Null where it can't
 * be one simple outline — a segment too short for the mitres at its ends
 * on one side, or the run crossing itself.
 */
export function mitredOutline(pts: V2[], w: number): V2[] | null {
  const n = pts.length
  if (n < 2) return null
  const h = w / 2
  const dir = (i: number): V2 => {
    const d = sub2(pts[i + 1], pts[i])
    const l = len2(d)
    return [d[0] / l, d[1] / l]
  }
  const left = (d: V2): V2 => [-d[1], d[0]]
  // Each segment shortened at an end on the side that end's bend is
  // inside by (w/2)·tan(turn/2): that has to leave something.
  const tn = turns(pts)
  const short = (i: number) => {
    const l = len2(sub2(pts[i + 1], pts[i]))
    let inL = 0, inR = 0
    for (const [k, at] of [[i - 1, i], [i, i + 1]] as const) {
      if (k < 0 || k >= tn.length) continue
      const t = tn[k]
      const a = dir(at - 1), b = dir(at)
      const cr = a[0] * b[1] - a[1] * b[0]
      const back = h * Math.tan(t / 2)
      // A left turn has its inside on the left.
      if (cr > 0) inL += back
      else inR += back
    }
    return l <= inL + TINY || l <= inR + TINY
  }
  for (let i = 0; i < n - 1; i++) if (short(i)) return null
  const side = (s: 1 | -1): V2[] => {
    const out: V2[] = []
    for (let i = 0; i < n; i++) {
      if (i === 0 || i === n - 1) {
        const d = dir(i === 0 ? 0 : n - 2)
        const L = left(d)
        out.push([pts[i][0] + s * h * L[0], pts[i][1] + s * h * L[1]])
        continue
      }
      const a = dir(i - 1), b = dir(i)
      const la = left(a), lb = left(b)
      // The mitre: along the bisector of the two normals, h / cos(turn/2).
      const m: V2 = [la[0] + lb[0], la[1] + lb[1]]
      const ml = len2(m)
      const k = h / ((ml / 2) || 1e-12)
      out.push([pts[i][0] + (s * k * m[0]) / ml, pts[i][1] + (s * k * m[1]) / ml])
    }
    return out
  }
  const poly = [...side(1), ...side(-1).reverse()].map(p6)
  return simple(poly) ? poly : null
}

/** The area of a closed outline (positive anticlockwise). */
export function area(poly: V2[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    s += a[0] * b[1] - a[1] * b[0]
  }
  return s / 2
}

function cross(o: V2, a: V2, b: V2) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

/** Two closed segments meet (touching counts). */
export function segmentsMeet(a: V2, b: V2, c: V2, d: V2): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
  if (((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12))) return true
  const on = (p: V2, q: V2, r: V2) => Math.abs(cross(p, q, r)) <= 1e-12 && Math.min(p[0], q[0]) - 1e-12 <= r[0] && r[0] <= Math.max(p[0], q[0]) + 1e-12 && Math.min(p[1], q[1]) - 1e-12 <= r[1] && r[1] <= Math.max(p[1], q[1]) + 1e-12
  return on(c, d, a) || on(c, d, b) || on(a, b, c) || on(a, b, d)
}

/** An outline whose sides cross nowhere but at the corners they share. */
export function simple(poly: V2[]): boolean {
  const n = poly.length
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      if (segmentsMeet(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false
    }
  return true
}

/** A rectangle of width w round the segment a–b, as four corners. */
export function segmentRect(a: V2, b: V2, w: number): V2[] {
  const d = sub2(b, a)
  const l = len2(d)
  const L: V2 = [(-d[1] / l) * (w / 2), (d[0] / l) * (w / 2)]
  return ([[a[0] + L[0], a[1] + L[1]], [b[0] + L[0], b[1] + L[1]], [b[0] - L[0], b[1] - L[1]], [a[0] - L[0], a[1] - L[1]]] as V2[]).map(p6)
}

export type Piece = { kind: 'polygon'; points: V2[] } | { kind: 'circle'; center: V2; radius: number }

/** A run's outline on its sheet: mitred as one where it can be, else a
 *  rectangle per segment and a disc at each bend. */
export function runPieces(pts: V2[], w: number): { pieces: Piece[]; mitred: boolean } {
  const m = mitredOutline(pts, w)
  if (m) return { pieces: [{ kind: 'polygon', points: m }], mitred: true }
  const pieces: Piece[] = []
  for (let i = 0; i < pts.length - 1; i++) pieces.push({ kind: 'polygon', points: segmentRect(pts[i], pts[i + 1], w) })
  for (let i = 1; i < pts.length - 1; i++) pieces.push({ kind: 'circle', center: p6(pts[i]), radius: r6(w / 2) })
  return { pieces, mitred: false }
}

// ---- distances --------------------------------------------------------------------------

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** The least distance between segments p1–q1 and p2–q2, in 3D. */
export function segmentDistance(p1: V3, q1: V3, p2: V3, q2: V3): number {
  const d1 = sub3(q1, p1), d2 = sub3(q2, p2), r = sub3(p1, p2)
  const a = dot3(d1, d1), e = dot3(d2, d2), f = dot3(d2, r)
  let s: number, t: number
  if (a <= 1e-18 && e <= 1e-18) return Math.sqrt(dot3(r, r))
  if (a <= 1e-18) {
    s = 0
    t = Math.min(1, Math.max(0, f / e))
  } else {
    const c = dot3(d1, r)
    if (e <= 1e-18) {
      t = 0
      s = Math.min(1, Math.max(0, -c / a))
    } else {
      const b = dot3(d1, d2)
      const den = a * e - b * b
      s = den > 1e-18 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = Math.min(1, Math.max(0, -c / a))
      } else if (t > 1) {
        t = 1
        s = Math.min(1, Math.max(0, (b - c) / a))
      }
    }
  }
  const c1: V3 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s]
  const c2: V3 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t]
  return Math.sqrt(dot3(sub3(c1, c2), sub3(c1, c2)))
}

/** The least distance between two polylines in 3D (a single point is a
 *  polyline of one). */
export function polylineDistance(a: V3[], b: V3[]): number {
  const segs = (p: V3[]) => (p.length === 1 ? [[p[0], p[0]]] : p.slice(1).map((q, i) => [p[i], q]))
  let best = Infinity
  for (const [p1, q1] of segs(a)) for (const [p2, q2] of segs(b)) best = Math.min(best, segmentDistance(p1, q1, p2, q2))
  return best
}

/** Distance from point p to segment a–b on the sheet. */
export function pointSegment2(p: V2, a: V2, b: V2): number {
  return segmentDistance([p[0], p[1], 0], [p[0], p[1], 0], [a[0], a[1], 0], [b[0], b[1], 0])
}

// ---- bends of a swept route -------------------------------------------------------------

/** A route's centreline length with every corner rounded at radius R:
 *  each corner of turn θ takes 2R·tan(θ/2) of straight and gives R·θ of
 *  arc. Null where a straight is too short for the bends at its ends. */
export function routeLength(pts: V3[], R: number): { length: number; tightest: number } | null {
  const tn = turns(pts)
  let L = polylineLength(pts)
  let tight = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.hypot(...sub3(pts[i + 1], pts[i]))
    const need = (i > 0 ? R * Math.tan(tn[i - 1] / 2) : 0) + (i < tn.length ? R * Math.tan(tn[i] / 2) : 0)
    if (need > 0) tight = Math.min(tight, seg / need)
    if (need > seg + 1e-9) return null
  }
  for (const t of tn) L += R * t - 2 * R * Math.tan(t / 2)
  return { length: L, tightest: tight }
}
