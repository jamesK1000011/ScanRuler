// SPDX-License-Identifier: AGPL-3.0-only
// The thread's shape read off the scan's points, along the helix rather than
// straight down the axis: each point's height less the lead's advance at its
// angle round the axis lands every crest on the same phase, so the tooth
// folds sharp from every side of the turn, not washed out the way a profile
// taken over all angles at once is.
//
// From the points about an axis this reads:
//  - the pitch, refined to where the fold is sharpest, and the hand and the
//    number of starts — a lead of 1 to 4 pitches — the same way;
//  - the tooth as one profile, and from its flanks the included angle;
//  - the taper: the radius's change along the axis, with its standard
//    error, after the axis's offset, its tilt and the tooth are taken out.
//
// The angle is read off the middle of each flank, between a quarter and
// three quarters of the tooth's height, where a scan's rounding of crests
// and roots reaches least. On a small thread the rounding reaches the middle
// too and the angle reads wide; the answer says how sure it is.

import type { Vec3 } from '../../../src/core/types'

export interface ShapeInput {
  positions: ArrayLike<number>
  origin: Vec3
  /** The axis direction, unit length. */
  dir: Vec3
  radius: number
  band: number
  /** Along the axis from the origin, mm, the points are read over. */
  from: number
  to: number
  /** The pitch read so far, mm. */
  pitch: number
}

export interface ThreadShape {
  points: number
  pitch: number
  /** One standard deviation of the pitch, mm. */
  pitchSigma: number
  leftHanded: boolean
  starts: number
  lead: number
  /** How sharp the fold is: the folded profile's variance over all the
   *  points' variance, 0 to 1. */
  sharpness: number
  /** The tooth, folded: the radius about the mean wall at each phase, mm,
   *  from one root through the crest to the next root. */
  tooth: number[]
  /** The tooth's height, crest to root, as the fold reads it, mm. */
  depth: number
  depthShare: number
  /** Included flank angle, degrees, with each flank's half; null when the
   *  flanks are too short or too noisy to read. */
  flankAngle: number | null
  halfAngles: [number, number] | null
  /** high: both flanks fitted straight with room to spare; low: read, but
   *  near the limit of what the scan holds. */
  flankConfidence: 'high' | 'low' | null
  /** The diameter's change per mm along the axis — positive when it grows
   *  toward +dir — and its standard error. */
  taper: number
  taperSigma: number
  /** The wall's diameters at the middle of the length read, from the fold:
   *  where the crests and the roots lie. */
  crestDiameter: number
  rootDiameter: number
  noise: number
  length: number
}

const BINS_MIN = 16
const BINS_MAX = 64
const SEARCH = 0.03
const STEP = 0.0006
const FINE = 0.00005
const STARTS_MAX = 4
/** How much sharper a lead of n pitches must fold than one pitch to be read
 *  as n starts: a single start's fold at a wrong lead loses nearly all its
 *  sharpness, so this only guards against noise. */
const STARTS_GAIN = 1.25
/** Under this pitch a scanner's rounding reaches the middle of the flanks
 *  (its blur is typically 0.05–0.2 mm), so the angle is read but not
 *  trusted to tell one form from another. */
const FLANK_PITCH_MIN = 0.9

interface Prepared {
  z: Float64Array
  theta: Float64Array
  r: Float64Array
  n: number
}

function prepare(input: ShapeInput): Prepared {
  const { positions, origin, dir, radius, band, from, to } = input
  const a: Vec3 = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const k = a[0] * dir[0] + a[1] * dir[1] + a[2] * dir[2]
  let e1: Vec3 = [a[0] - k * dir[0], a[1] - k * dir[1], a[2] - k * dir[2]]
  const l = Math.hypot(...e1)
  e1 = [e1[0] / l, e1[1] / l, e1[2] / l]
  // e1, e2, dir right-handed, so the hand reads the same whichever way the
  // axis was given.
  const e2: Vec3 = [dir[1] * e1[2] - dir[2] * e1[1], dir[2] * e1[0] - dir[0] * e1[2], dir[0] * e1[1] - dir[1] * e1[0]]
  const count = Math.floor(positions.length / 3)
  const z = new Float64Array(count), theta = new Float64Array(count), r = new Float64Array(count)
  let n = 0
  for (let i = 0; i < count; i++) {
    const qx = positions[3 * i] - origin[0], qy = positions[3 * i + 1] - origin[1], qz = positions[3 * i + 2] - origin[2]
    const zz = qx * dir[0] + qy * dir[1] + qz * dir[2]
    if (zz < from || zz > to) continue
    const x = qx * e1[0] + qy * e1[1] + qz * e1[2]
    const y = qx * e2[0] + qy * e2[1] + qz * e2[2]
    const rr = Math.hypot(x, y)
    if (Math.abs(rr - radius) > band) continue
    z[n] = zz
    theta[n] = Math.atan2(y, x)
    r[n] = rr
    n++
  }
  return { z: z.subarray(0, n), theta: theta.subarray(0, n), r: r.subarray(0, n), n }
}

/** Least squares of r on the wall model: offset, the axis off centre
 *  (cos θ, sin θ), the axis aslant (z cos θ, z sin θ) and the taper (z).
 *  Returns the coefficients and the taper's standard error. */
function wallFit(p: Prepared, value: Float64Array): { c: number[]; taperSE: number; residual: Float64Array } {
  const m = 6
  const ata = Array.from({ length: m }, () => new Float64Array(m))
  const atb = new Float64Array(m)
  const row = new Float64Array(m)
  const fill = (i: number) => {
    const c = Math.cos(p.theta[i]), s = Math.sin(p.theta[i]), z = p.z[i]
    row[0] = 1; row[1] = c; row[2] = s; row[3] = z * c; row[4] = z * s; row[5] = z
  }
  for (let i = 0; i < p.n; i++) {
    fill(i)
    for (let a = 0; a < m; a++) {
      atb[a] += row[a] * value[i]
      for (let b = 0; b < m; b++) ata[a][b] += row[a] * row[b]
    }
  }
  const inv = invert(ata)
  const c = Array.from({ length: m }, (_, a) => inv[a].reduce((s, v, b) => s + v * atb[b], 0))
  const residual = new Float64Array(p.n)
  let ss = 0
  for (let i = 0; i < p.n; i++) {
    fill(i)
    let fit = 0
    for (let a = 0; a < m; a++) fit += row[a] * c[a]
    residual[i] = value[i] - fit
    ss += residual[i] ** 2
  }
  const sigma2 = ss / Math.max(1, p.n - m)
  return { c, taperSE: Math.sqrt(Math.max(0, sigma2 * inv[5][5])), residual }
}

function invert(a: Float64Array[]): number[][] {
  const n = a.length
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let col = 0; col < n; col++) {
    let best = col
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[best][col])) best = r
    ;[m[col], m[best]] = [m[best], m[col]]
    const pivot = m[col][col] || 1e-12
    for (let j = 0; j < 2 * n; j++) m[col][j] /= pivot
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = m[r][col]
      if (f !== 0) for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[col][j]
    }
  }
  return m.map((row) => row.slice(n))
}

/** The phase each point folds to, 0 to 1 of a pitch. */
function phases(p: Prepared, pitch: number, lead: number, left: boolean, out: Float64Array): void {
  const s = left ? -1 : 1
  for (let i = 0; i < p.n; i++) {
    const u = (p.z[i] - (s * lead * p.theta[i]) / (2 * Math.PI)) / pitch
    out[i] = u - Math.floor(u)
  }
}

/** The fold's sharpness: the bin means' variance over the values'. */
function sharpness(values: Float64Array, phase: Float64Array, bins: number, total: number): number {
  const sum = new Float64Array(bins), cnt = new Float64Array(bins)
  for (let i = 0; i < values.length; i++) {
    const b = Math.min(bins - 1, Math.floor(phase[i] * bins))
    sum[b] += values[i]
    cnt[b]++
  }
  let v = 0, w = 0
  for (let b = 0; b < bins; b++) {
    if (cnt[b] === 0) continue
    v += cnt[b] * (sum[b] / cnt[b]) ** 2
    w += cnt[b]
  }
  return w > 0 && total > 0 ? v / w / total : 0
}

/** The bin medians of a fold. */
function foldMedians(values: Float64Array, phase: Float64Array, bins: number): number[] {
  const lists: number[][] = Array.from({ length: bins }, () => [])
  for (let i = 0; i < values.length; i++) lists[Math.min(bins - 1, Math.floor(phase[i] * bins))].push(values[i])
  const med = lists.map((l) => {
    if (l.length === 0) return NaN
    l.sort((a, b) => a - b)
    return l[l.length >> 1]
  })
  // An empty bin takes its neighbours' mean.
  for (let b = 0; b < bins; b++) if (Number.isNaN(med[b])) med[b] = (med[(b + bins - 1) % bins] + med[(b + 1) % bins]) / 2 || 0
  return med
}

/** Each flank's slope, radius over axial phase in mm, fitted where the
 *  tooth stands between a quarter and three quarters of its height. */
function flanks(tooth: number[], pitch: number): { half: [number, number]; ok: boolean; fit: number } | null {
  const n = tooth.length
  let hi = 0, lo = 0
  for (let i = 1; i < n; i++) {
    if (tooth[i] > tooth[hi]) hi = i
    if (tooth[i] < tooth[lo]) lo = i
  }
  const depth = tooth[hi] - tooth[lo]
  if (depth <= 0) return null
  const a = tooth[lo] + 0.25 * depth, b = tooth[lo] + 0.75 * depth
  const run = (start: number, end: number) => {
    const xs: number[] = [], ys: number[] = []
    let k = start, x = 0
    while (true) {
      const v = tooth[k]
      if (v >= a && v <= b) {
        xs.push((x * pitch) / n)
        ys.push(v)
      }
      if (k === end) break
      k = (k + 1) % n
      x++
    }
    if (xs.length < 3) return null
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length
    let sxy = 0, sxx = 0, syy = 0
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my)
      sxx += (xs[i] - mx) ** 2
      syy += (ys[i] - my) ** 2
    }
    if (sxx === 0 || syy === 0) return null
    return { slope: sxy / sxx, r2: (sxy * sxy) / (sxx * syy), count: xs.length }
  }
  const rise = run(lo, hi), fall = run(hi, lo)
  if (!rise || !fall) return null
  const halfOf = (s: number) => (Math.atan(1 / Math.abs(s)) * 180) / Math.PI
  const fit = Math.min(rise.r2, fall.r2)
  return { half: [halfOf(rise.slope), halfOf(fall.slope)], ok: fit > 0.9 && Math.min(rise.count, fall.count) >= 4, fit }
}

export function readShape(input: ShapeInput): ThreadShape | null {
  const p = prepare(input)
  if (p.n < 200 || !(input.pitch > 0)) return null
  const length = input.to - input.from
  const turns = length / input.pitch
  if (turns < 2) return null
  const bins = Math.max(BINS_MIN, Math.min(BINS_MAX, Math.floor(p.n / 40)))

  const first = wallFit(p, p.r)
  let rho = first.residual
  const total = rho.reduce((s, v) => s + v * v, 0) / p.n
  const phase = new Float64Array(p.n)

  // Search the pitch about the one read, both hands, 1 to 4 starts.
  let best = { score: -1, pitch: input.pitch, left: false, starts: 1 }
  const scoreAt = (pitch: number, left: boolean, starts: number) => {
    phases(p, pitch, starts * pitch, left, phase)
    return sharpness(rho, phase, bins, total)
  }
  const singleBest: Record<string, number> = {}
  for (let starts = 1; starts <= STARTS_MAX; starts++) {
    for (const left of [false, true]) {
      let local = -1
      for (let k = -SEARCH; k <= SEARCH + 1e-12; k += STEP) {
        const pitch = input.pitch * (1 + k)
        const s = scoreAt(pitch, left, starts)
        if (s > local) local = s
        // More starts only where they fold clearly sharper than one.
        const need = starts === 1 ? best.score : Math.max(best.score, (singleBest.one ?? 0) * STARTS_GAIN)
        if (s > need) best = { score: s, pitch, left, starts }
      }
      if (starts === 1) singleBest.one = Math.max(singleBest.one ?? 0, local)
    }
  }
  // Refine finely, and read how far the pitch can move before the fold
  // loses a tenth of its sharpness.
  const curve: [number, number][] = []
  for (let k = -STEP * 2; k <= STEP * 2 + 1e-12; k += FINE) {
    const pitch = best.pitch * (1 + k)
    const s = scoreAt(pitch, best.left, best.starts)
    curve.push([pitch, s])
    if (s > best.score) best = { ...best, score: s, pitch }
  }
  const keep = curve.filter(([, s]) => s >= 0.9 * best.score).map(([q]) => q)
  const width = keep.length > 1 ? Math.max(...keep) - Math.min(...keep) : FINE * best.pitch
  const pitchSigma = Math.max(width / 2, best.pitch * 2e-4)

  // The tooth from the first fold, then the wall fitted again with the
  // tooth taken out, for the taper and its error.
  phases(p, best.pitch, best.starts * best.pitch, best.left, phase)
  let tooth = foldMedians(rho, phase, bins)
  const toothAt = (i: number) => {
    const x = phase[i] * bins - 0.5
    const b0 = Math.floor(x), f = x - b0
    return tooth[((b0 % bins) + bins) % bins] * (1 - f) + tooth[(b0 + 1) % bins] * f
  }
  const flat = new Float64Array(p.n)
  for (let i = 0; i < p.n; i++) flat[i] = p.r[i] - toothAt(i)
  const second = wallFit(p, flat)
  // The tooth again, against the better wall.
  const zMid = (input.from + input.to) / 2
  const c = second.c
  rho = new Float64Array(p.n)
  for (let i = 0; i < p.n; i++) {
    const cs = Math.cos(p.theta[i]), sn = Math.sin(p.theta[i]), z = p.z[i]
    rho[i] = p.r[i] - (c[0] + c[1] * cs + c[2] * sn + c[3] * z * cs + c[4] * z * sn + c[5] * z)
  }
  tooth = foldMedians(rho, phase, bins)
  let noiseSum = 0
  const dev: number[] = []
  for (let i = 0; i < p.n; i++) dev.push(Math.abs(rho[i] - toothAt(i)))
  dev.sort((a, b) => a - b)
  noiseSum = 1.4826 * dev[dev.length >> 1]

  // Roll the tooth so it starts at a root.
  let lo = 0
  for (let i = 1; i < bins; i++) if (tooth[i] < tooth[lo]) lo = i
  const rolled = tooth.map((_, i) => tooth[(i + lo) % bins])
  const hiV = Math.max(...rolled), loV = Math.min(...rolled)
  const depth = hiV - loV
  const f = depth > 3 * noiseSum ? flanks(rolled, best.pitch) : null
  const wall = c[0] + c[5] * zMid
  const round3 = (v: number) => Math.round(v * 1000) / 1000
  const round4 = (v: number) => Math.round(v * 10000) / 10000
  return {
    points: p.n,
    pitch: round4(best.pitch),
    pitchSigma: round4(pitchSigma),
    leftHanded: best.left,
    starts: best.starts,
    lead: round4(best.starts * best.pitch),
    sharpness: round3(best.score),
    tooth: rolled.map(round3),
    depth: round3(depth),
    depthShare: round3(depth / best.pitch),
    flankAngle: f ? Math.round((f.half[0] + f.half[1]) * 10) / 10 : null,
    halfAngles: f ? [Math.round(f.half[0] * 10) / 10, Math.round(f.half[1] * 10) / 10] : null,
    flankConfidence: f ? (f.ok && depth > 6 * noiseSum && best.pitch >= FLANK_PITCH_MIN ? 'high' : 'low') : null,
    taper: round4(2 * c[5]),
    taperSigma: round4(Math.max(2 * second.taperSE, 1e-4)),
    crestDiameter: round3(2 * (wall + hiV)),
    rootDiameter: round3(2 * (wall + loV)),
    noise: round4(noiseSum),
    length: round3(length),
  }
}
