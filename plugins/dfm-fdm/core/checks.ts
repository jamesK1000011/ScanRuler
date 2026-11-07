// SPDX-License-Identifier: AGPL-3.0-only
// The printability checks, each on the part's welded triangles in the build
// frame (Z up, the bed at the lowest point). A check returns its findings:
// where (a point on the part, mm), how much, against what limit — and,
// where it covers an area, how much of it. Regions are the connected
// triangles a check flags, so one ledge is one finding, not a thousand.

import type { EffectiveRule } from './rules'

export interface Part {
  positions: Float64Array
  indices: Uint32Array
  /** Wall thickness at each vertex, mm (0 or less: not measured). */
  thickness?: Float32Array | null
}

export interface Finding {
  rule: string
  check: string
  severity: 'error' | 'warning' | 'info'
  /** What was measured, and the limit it broke, in `unit`. */
  value: number
  limit: number
  unit: string
  at: [number, number, number]
  areaMm2?: number
  count?: number
  says: string
}

const BED = 0.1

interface Mesh {
  p: Float64Array
  idx: Uint32Array
  tris: number
  normal: Float64Array
  area: Float64Array
  zMin: number
  zMax: number
  /** Triangles by vertex. */
  around: number[][]
}

function prepare(part: Part): Mesh {
  const { positions: p, indices: idx } = part
  const tris = idx.length / 3
  const normal = new Float64Array(3 * tris), area = new Float64Array(tris)
  let zMin = Infinity, zMax = -Infinity
  for (let i = 2; i < p.length; i += 3) {
    zMin = Math.min(zMin, p[i])
    zMax = Math.max(zMax, p[i])
  }
  const around: number[][] = Array.from({ length: p.length / 3 }, () => [])
  for (let t = 0; t < tris; t++) {
    const a = 3 * idx[3 * t], b = 3 * idx[3 * t + 1], c = 3 * idx[3 * t + 2]
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz)
    area[t] = l / 2
    if (l > 0) normal.set([nx / l, ny / l, nz / l], 3 * t)
    for (let k = 0; k < 3; k++) around[idx[3 * t + k]].push(t)
  }
  return { p, idx, tris, normal, area, zMin, zMax, around }
}

const r = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d

/** The connected runs of the triangles `keep` picks. */
function regions(m: Mesh, keep: (t: number) => boolean): number[][] {
  const seen = new Uint8Array(m.tris)
  const out: number[][] = []
  for (let t0 = 0; t0 < m.tris; t0++) {
    if (seen[t0] || !keep(t0)) continue
    const run: number[] = []
    const stack = [t0]
    seen[t0] = 1
    while (stack.length) {
      const t = stack.pop()!
      run.push(t)
      for (let k = 0; k < 3; k++)
        for (const n of m.around[m.idx[3 * t + k]])
          if (!seen[n] && keep(n)) {
            seen[n] = 1
            stack.push(n)
          }
    }
    out.push(run)
  }
  return out
}

function centroid(m: Mesh, run: number[]): [number, number, number] {
  let x = 0, y = 0, z = 0, w = 0
  for (const t of run) {
    for (let k = 0; k < 3; k++) {
      const i = 3 * m.idx[3 * t + k]
      x += m.p[i] * m.area[t]
      y += m.p[i + 1] * m.area[t]
      z += m.p[i + 2] * m.area[t]
    }
    w += 3 * m.area[t]
  }
  return [r(x / w), r(y / w), r(z / w)]
}

const areaOf = (m: Mesh, run: number[]) => run.reduce((s, t) => s + m.area[t], 0)
const onBed = (m: Mesh, t: number) => [0, 1, 2].every((k) => m.p[3 * m.idx[3 * t + k] + 2] < m.zMin + BED)

/** A region's narrowest span in plan — the least width of its corners'
 *  convex hull — with the direction it is measured along and the middle of
 *  that width. */
function spread(m: Mesh, run: number[]): { span: number; axis: [number, number]; centre: [number, number] } {
  const xs: number[] = [], ys: number[] = []
  for (const t of run)
    for (let k = 0; k < 3; k++) {
      const i = 3 * m.idx[3 * t + k]
      xs.push(m.p[i])
      ys.push(m.p[i + 1])
    }
  const h = hullArea(xs, ys)
  return { span: h.width, axis: h.axis, centre: h.centre }
}

/** The convex hull of points in plan: its area, its least width, the
 *  direction across that width and the middle of it. */
function hullArea(xs: number[], ys: number[]): { area: number; width: number; axis: [number, number]; centre: [number, number] } {
  const pts = xs.map((x, i) => [x, ys[i]] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const none = { area: 0, width: 0, axis: [1, 0] as [number, number], centre: [xs[0] ?? 0, ys[0] ?? 0] as [number, number] }
  if (pts.length < 3) return none
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = [], upper: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
  if (hull.length < 3) return none
  let a = 0
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i], [x2, y2] = hull[(i + 1) % hull.length]
    a += x1 * y2 - x2 * y1
  }
  // Rotating calipers, simply: for each edge, the hull's extent along the
  // edge's normal; the least of them is the width.
  let best = { width: Infinity, axis: [1, 0] as [number, number], centre: [0, 0] as [number, number] }
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i], [x2, y2] = hull[(i + 1) % hull.length]
    const l = Math.hypot(x2 - x1, y2 - y1)
    if (l === 0) continue
    const nx = -(y2 - y1) / l, ny = (x2 - x1) / l
    let lo = Infinity, hi = -Infinity
    for (const [x, y] of hull) {
      const d = x * nx + y * ny
      lo = Math.min(lo, d)
      hi = Math.max(hi, d)
    }
    if (hi - lo < best.width) {
      // The middle of the width, on the line through the hull's mean.
      const mx = hull.reduce((s, p) => s + p[0], 0) / hull.length, my = hull.reduce((s, p) => s + p[1], 0) / hull.length
      const shift = (lo + hi) / 2 - (mx * nx + my * ny)
      best = { width: hi - lo, axis: [nx, ny], centre: [mx + shift * nx, my + shift * ny] }
    }
  }
  return { area: Math.abs(a) / 2, ...best }
}

export function runChecks(part: Part, rules: readonly EffectiveRule[]): { findings: Finding[]; skipped: { rule: string; why: string }[] } {
  const m = prepare(part)
  const findings: Finding[] = []
  const skipped: { rule: string; why: string }[] = []
  const add = (rule: EffectiveRule, f: Omit<Finding, 'rule' | 'check' | 'severity'>) => findings.push({ rule: rule.id, check: rule.check, severity: rule.severity, ...f })
  for (const rule of rules) {
    if (rule.disabled) continue
    const P = rule.params
    switch (rule.check) {
      case 'overhang': {
        // Leaning past maxDeg from vertical, facing down, off the bed; and a
        // flat ceiling held up on one side only — a ledge, at 90°.
        const limit = -Math.sin((P.maxDeg * Math.PI) / 180)
        for (const run of regions(m, (t) => m.normal[3 * t + 2] < limit && m.normal[3 * t + 2] > -FLAT && !onBed(m, t))) {
          const a = areaOf(m, run)
          if (a < (P.minAreaMm2 ?? 0)) continue
          let worst = 0
          for (const t of run) worst = Math.max(worst, (Math.asin(Math.min(1, -m.normal[3 * t + 2])) * 180) / Math.PI)
          add(rule, { value: r(worst, 1), limit: P.maxDeg, unit: '° from vertical', at: centroid(m, run), areaMm2: r(a, 1), says: `${r(a, 1)} mm² facing down at up to ${r(worst, 1)}° from vertical — past ${P.maxDeg}°: support it, chamfer it, or turn the part` })
        }
        for (const c of ceilings(m)) {
          if (c.bridged || c.area < (P.minAreaMm2 ?? 0)) continue
          add(rule, { value: 90, limit: P.maxDeg, unit: '° from vertical', at: c.at, areaMm2: r(c.area, 1), says: `a flat underside of ${r(c.area, 1)} mm² held up on ${c.held ? 'one side only' : 'no side'} — it prints in air: support it, or chamfer it to ${P.maxDeg}° or less` })
        }
        break
      }
      case 'bridge': {
        for (const c of ceilings(m)) {
          if (!c.bridged || c.area < (P.minAreaMm2 ?? 0) || c.span <= P.maxMm) continue
          add(rule, { value: r(c.span, 1), limit: P.maxMm, unit: 'mm', at: c.at, areaMm2: r(c.area, 1), says: `a flat ceiling bridging ${r(c.span, 1)} mm between its walls, ${r(c.area, 1)} mm² — over the ${P.maxMm} mm bridge limit: support it, add a rib, or arch it` })
        }
        break
      }
      case 'thinWall': {
        const th = part.thickness
        if (!th || th.length !== m.p.length / 3) {
          skipped.push({ rule: rule.id, why: 'no wall thickness measured for this mesh' })
          break
        }
        const thin = (v: number) => th[v] > 0 && th[v] < P.minMm
        for (const run of regions(m, (t) => [0, 1, 2].filter((k) => thin(m.idx[3 * t + k])).length >= 2)) {
          const a = areaOf(m, run)
          if (a < (P.minAreaMm2 ?? 0)) continue
          let least = Infinity
          for (const t of run) for (let k = 0; k < 3; k++) if (thin(m.idx[3 * t + k])) least = Math.min(least, th[m.idx[3 * t + k]])
          add(rule, { value: r(least), limit: P.minMm, unit: 'mm', at: centroid(m, run), areaMm2: r(a, 1), says: `a wall ${r(least)} mm thick over ${r(a, 1)} mm² — under ${P.minMm} mm: thicken it, or print it with a finer nozzle` })
        }
        break
      }
      case 'smallHole': {
        for (const h of uprightHoles(m)) {
          if (2 * h.radius >= P.minDiameterMm) continue
          add(rule, { value: r(2 * h.radius), limit: P.minDiameterMm, unit: 'mm Ø', at: [r(h.cx), r(h.cy), r((h.z0 + h.z1) / 2)], says: `an upright hole Ø${r(2 * h.radius)} mm — under Ø${P.minDiameterMm} mm it closes up: drill or ream it after printing, or model it larger` })
        }
        break
      }
      case 'bedContact': {
        let contact = 0
        const bx: number[] = [], by: number[] = []
        for (let t = 0; t < m.tris; t++)
          if (m.normal[3 * t + 2] < -FLAT && onBed(m, t)) {
            contact += m.area[t]
            for (let k = 0; k < 3; k++) {
              bx.push(m.p[3 * m.idx[3 * t + k]])
              by.push(m.p[3 * m.idx[3 * t + k] + 1])
            }
          }
        const xs: number[] = [], ys: number[] = []
        for (let i = 0; i < m.p.length; i += 3) {
          xs.push(m.p[i])
          ys.push(m.p[i + 1])
        }
        const foot = hullArea(xs, ys).area
        const share = foot > 0 ? contact / foot : 0
        if (share < P.minShare) add(rule, { value: r(share, 3), limit: P.minShare, unit: 'of the footprint', at: [r(xs.reduce((s, v) => s + v, 0) / xs.length), r(ys.reduce((s, v) => s + v, 0) / ys.length), r(m.zMin)], areaMm2: r(contact, 1), says: `${r(contact, 1)} mm² on the bed of a ${r(foot, 1)} mm² footprint (${r(100 * share, 1)} %) — add a brim, or turn the part onto a larger face` })
        break
      }
      case 'tallThin': {
        const bx: number[] = [], by: number[] = []
        for (let t = 0; t < m.tris; t++)
          if (m.normal[3 * t + 2] < -FLAT && onBed(m, t))
            for (let k = 0; k < 3; k++) {
              bx.push(m.p[3 * m.idx[3 * t + k]])
              by.push(m.p[3 * m.idx[3 * t + k] + 1])
            }
        const base = hullArea(bx, by).width
        const height = m.zMax - m.zMin
        if (base <= 0) {
          skipped.push({ rule: rule.id, why: 'nothing of the part lies flat on the bed' })
          break
        }
        const ratio = height / base
        if (ratio > P.maxRatio) add(rule, { value: r(ratio, 1), limit: P.maxRatio, unit: '× its base', at: [r(bx.reduce((s, v) => s + v, 0) / bx.length), r(by.reduce((s, v) => s + v, 0) / by.length), r(m.zMin)], says: `${r(height, 1)} mm tall on a base ${r(base, 1)} mm across at its narrowest (${r(ratio, 1)}×) — add a brim or a support fin, print several together, or lay it down` })
        break
      }
      case 'trappedVolume': {
        for (const shell of shells(m)) {
          if (shell.volume >= 0 || -shell.volume < (P.minVolumeMm3 ?? 0)) continue
          add(rule, { value: r(-shell.volume, 1), limit: P.minVolumeMm3 ?? 0, unit: 'mm³', at: shell.at, says: `a closed cavity of ${r(-shell.volume, 1)} mm³ inside the part — it prints, but traps air; add a vent if anything must get out` })
        }
        break
      }
      case 'meshHealth': {
        const edges = new Map<string, number>()
        let degenerate = 0
        for (let t = 0; t < m.tris; t++) {
          if (m.area[t] < 1e-12) degenerate++
          for (let k = 0; k < 3; k++) {
            const a = m.idx[3 * t + k], b = m.idx[3 * t + ((k + 1) % 3)]
            const key = a < b ? `${a},${b}` : `${b},${a}`
            edges.set(key, (edges.get(key) ?? 0) + 1)
          }
        }
        let open = 0, over = 0
        let at: [number, number, number] | null = null
        for (const [key, n] of edges) {
          if (n === 2) continue
          if (n === 1) open++
          else over++
          if (!at) {
            const v = Number(key.split(',')[0])
            at = [r(m.p[3 * v]), r(m.p[3 * v + 1]), r(m.p[3 * v + 2])]
          }
        }
        if (open + over > 0) add(rule, { value: open + over, limit: 0, unit: 'edges', at: at!, count: open + over, says: `${open} open and ${over} non-manifold edges${degenerate ? `, ${degenerate} degenerate triangles` : ''} — repair the mesh (mesh.fill_holes, or the slicer's repair) before slicing` })
        break
      }
    }
  }
  return { findings, skipped }
}

interface Ceiling {
  area: number
  at: [number, number, number]
  /** Across, at its narrowest. */
  span: number
  /** Held up by walls going down on both sides across its span. */
  bridged: boolean
  /** Held up on any side at all. */
  held: boolean
}

/** Flat ceilings off the bed, and whether walls going down hold them on
 *  both sides of their narrowest span — a bridge — or not — a ledge. */
function ceilings(m: Mesh): Ceiling[] {
  const edgeTris = new Map<string, number[]>()
  for (let t = 0; t < m.tris; t++)
    for (let k = 0; k < 3; k++) {
      const a = m.idx[3 * t + k], b = m.idx[3 * t + ((k + 1) % 3)]
      const key = a < b ? `${a},${b}` : `${b},${a}`
      const l = edgeTris.get(key)
      if (l) l.push(t)
      else edgeTris.set(key, [t])
    }
  const out: Ceiling[] = []
  for (const run of regions(m, (t) => m.normal[3 * t + 2] <= -FLAT && !onBed(m, t))) {
    const inRun = new Set(run)
    const area = areaOf(m, run)
    const { span, axis, centre } = spread(m, run)
    // The edges where the ceiling meets a wall going down from it.
    const sides: number[] = []
    for (const t of run)
      for (let k = 0; k < 3; k++) {
        const a = m.idx[3 * t + k], b = m.idx[3 * t + ((k + 1) % 3)]
        const key = a < b ? `${a},${b}` : `${b},${a}`
        for (const n of edgeTris.get(key) ?? []) {
          if (inRun.has(n)) continue
          const third = [0, 1, 2].map((j) => m.idx[3 * n + j]).find((v) => v !== a && v !== b)
          if (third === undefined) continue
          const zEdge = (m.p[3 * a + 2] + m.p[3 * b + 2]) / 2
          // A wall that holds a side of the span runs across it: an edge
          // running along the span (a ledge's one wall, cut in pieces)
          // holds neither side.
          const ex = m.p[3 * b] - m.p[3 * a], ey = m.p[3 * b + 1] - m.p[3 * a + 1], el = Math.hypot(ex, ey)
          if (m.p[3 * third + 2] < zEdge - 0.05 && el > 0 && Math.abs((ex * axis[0] + ey * axis[1]) / el) < 0.5) {
            const mx = (m.p[3 * a] + m.p[3 * b]) / 2 - centre[0], my = (m.p[3 * a + 1] + m.p[3 * b + 1]) / 2 - centre[1]
            sides.push(mx * axis[0] + my * axis[1])
          }
        }
      }
    const reach = span / 2
    const lowSide = sides.some((d) => d < -0.7 * reach), highSide = sides.some((d) => d > 0.7 * reach)
    out.push({ area, at: centroid(m, run), span, bridged: lowSide && highSide, held: sides.length > 0 })
  }
  return out
}

/** Facing down this squarely is a flat ceiling: cos 10°. */
const FLAT = Math.cos((10 * Math.PI) / 180)

/** Each closed shell of the mesh and its signed volume: negative for a
 *  shell turned inward — a cavity. */
function shells(m: Mesh): { volume: number; at: [number, number, number] }[] {
  const out: { volume: number; at: [number, number, number] }[] = []
  for (const run of regions(m, () => true)) {
    let v = 0
    for (const t of run) {
      const a = 3 * m.idx[3 * t], b = 3 * m.idx[3 * t + 1], c = 3 * m.idx[3 * t + 2]
      const p = m.p
      v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6
    }
    out.push({ volume: v, at: centroid(m, run) })
  }
  return out
}

/** Upright round holes: connected runs of upright triangles whose corners
 *  lie on a circle most of the way round, facing in. */
function uprightHoles(m: Mesh): { cx: number; cy: number; radius: number; z0: number; z1: number }[] {
  const out: { cx: number; cy: number; radius: number; z0: number; z1: number }[] = []
  for (const run of regions(m, (t) => Math.abs(m.normal[3 * t + 2]) < 0.1)) {
    if (run.length < 6) continue
    const xs: number[] = [], ys: number[] = []
    let z0 = Infinity, z1 = -Infinity
    for (const t of run)
      for (let k = 0; k < 3; k++) {
        const i = 3 * m.idx[3 * t + k]
        xs.push(m.p[i])
        ys.push(m.p[i + 1])
        z0 = Math.min(z0, m.p[i + 2])
        z1 = Math.max(z1, m.p[i + 2])
      }
    const c = circle(xs, ys)
    if (!c || c.rms > 0.01 + 0.03 * c.radius) continue
    const ang = xs.map((x, i) => Math.atan2(ys[i] - c.cy, x - c.cx)).sort((a, b) => a - b)
    let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1]
    for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1])
    if (gap > Math.PI / 2) continue
    let facing = 0
    for (const t of run) {
      const i = 3 * m.idx[3 * t]
      facing += m.normal[3 * t] * (m.p[i] - c.cx) + m.normal[3 * t + 1] * (m.p[i + 1] - c.cy)
    }
    if (facing < 0) out.push({ cx: c.cx, cy: c.cy, radius: c.radius, z0, z1 })
  }
  return out
}

/** Least-squares circle (Kåsa). */
function circle(xs: number[], ys: number[]): { cx: number; cy: number; radius: number; rms: number } | null {
  const n = xs.length
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0
  for (let i = 0; i < n; i++) {
    const u = xs[i] - mx, v = ys[i] - my
    suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u
  }
  const det = suu * svv - suv * suv
  if (Math.abs(det) < 1e-12) return null
  const b1 = (suuu + suvv) / 2, b2 = (svvv + svuu) / 2
  const cx = mx + (b1 * svv - b2 * suv) / det, cy = my + (b2 * suu - b1 * suv) / det
  let rad = 0
  for (let i = 0; i < n; i++) rad += Math.hypot(xs[i] - cx, ys[i] - cy)
  rad /= n
  let ss = 0
  for (let i = 0; i < n; i++) ss += (Math.hypot(xs[i] - cx, ys[i] - cy) - rad) ** 2
  return { cx, cy, radius: rad, rms: Math.sqrt(ss / n) }
}
