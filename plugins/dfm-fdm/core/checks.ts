// SPDX-License-Identifier: AGPL-3.0-only
// The printability checks, each on the part's welded triangles in the build
// frame (Z up, the bed at the lowest point). A check returns its findings:
// where (a point on the part, mm), how much, against what limit — and,
// where it covers an area, how much of it. Regions are the connected
// triangles a check flags, so one ledge is one finding, not a thousand.

import type { EffectiveRule } from './rules'
import { sharpEdges, thinRuns, type WallSamples } from './wall'

export interface Part {
  positions: Float64Array
  indices: Uint32Array
  /** Wall thickness at each vertex, mm (0 or less: not measured). */
  thickness?: Float32Array | null
  /** Or, on a CAD mesh, the wall read at samples laid over its faces
   *  (wall.ts probeWalls). */
  wall?: WallSamples | null
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
  /** A trapped volume that is the pocket of a part encased at a pause
   *  (encased.ts): that part's id, E1 …. */
  encased?: string
}

const BED = 0.1

/** One extrusion line, mm: the thin-wall rule's lineMm (the nozzle, unless a
 *  profile gives its line width), never over its minimum wall. */
export const wallLine = (rule: { params: Record<string, number> }) => Math.min(rule.params.lineMm ?? rule.params.minMm / 2, rule.params.minMm)

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
  // A wall thinner than one extrusion line can't be laid down at all: the
  // rule's severity. From one line up to the minimum it prints, but as a
  // single line (or one and a gap): a warning at most.
  const thinWall = (rule: EffectiveRule, least: number, at: [number, number, number], area: number) => {
    const line = wallLine(rule)
    if (least < line)
      // units-ok: the agent's readout, in millimetres always
      add(rule, { value: r(least), limit: line, unit: 'mm', at, areaMm2: r(area, 1), says: `a wall ${r(least)} mm thick over ${r(area, 1)} mm² — thinner than one ${line} mm line, it can't be printed: thicken it to ${rule.params.minMm} mm, or print it with a finer nozzle` })
    else
      // units-ok: the agent's readout, in millimetres always
      add({ ...rule, severity: rule.severity === 'error' ? 'warning' : rule.severity }, { value: r(least), limit: rule.params.minMm, unit: 'mm', at, areaMm2: r(area, 1), says: `a wall ${r(least)} mm thick over ${r(area, 1)} mm² — under ${rule.params.minMm} mm, it prints as a single line: thicken it if it must be strong` })
  }
  for (const rule of rules) {
    if (rule.disabled) continue
    const P = rule.params
    switch (rule.check) {
      case 'overhang': {
        // Leaning past maxDeg from vertical, facing down, off the bed; and the
        // part of a flat ceiling no bridge reaches across — a ledge, at 90°.
        const limit = -Math.sin((P.maxDeg * Math.PI) / 180)
        for (const run of regions(m, (t) => m.normal[3 * t + 2] < limit && m.normal[3 * t + 2] > -FLAT && !onBed(m, t))) {
          const a = areaOf(m, run)
          if (a < (P.minAreaMm2 ?? 0)) continue
          let worst = 0
          for (const t of run) worst = Math.max(worst, (Math.asin(Math.min(1, -m.normal[3 * t + 2])) * 180) / Math.PI)
          // units-ok: the agent's readout, in millimetres always
          add(rule, { value: r(worst, 1), limit: P.maxDeg, unit: '° from vertical', at: centroid(m, run), areaMm2: r(a, 1), says: `${r(a, 1)} mm² facing down at up to ${r(worst, 1)}° from vertical — past ${P.maxDeg}°: support it, chamfer it, or turn the part` })
        }
        for (const c of ceilings(m)) {
          if (!c.loose || c.loose.area < (P.minAreaMm2 ?? 0)) continue
          const a = r(c.loose.area, 1)
          // units-ok: the agent's readout, in millimetres always
          add(rule, { value: 90, limit: P.maxDeg, unit: '° from vertical', at: c.loose.at, areaMm2: a, says: `a flat underside of ${a} mm² ${c.held ? 'with no wall under it on the opposite side' : 'held up on no side'} — it prints in air: support it, or chamfer it to ${P.maxDeg}° or less` })
        }
        break
      }
      case 'bridge': {
        for (const c of ceilings(m)) {
          if (c.area - (c.loose?.area ?? 0) < (P.minAreaMm2 ?? 0) || c.span <= P.maxMm) continue
          // units-ok: the agent's readout, in millimetres always
          add(rule, { value: r(c.span, 1), limit: P.maxMm, unit: 'mm', at: c.at, areaMm2: r(c.area, 1), says: `a flat ceiling bridging ${r(c.span, 1)} mm between its walls, ${r(c.area, 1)} mm² — over the ${P.maxMm} mm bridge limit: support it, add a rib, or arch it` })
        }
        break
      }
      case 'thinWall': {
        const th = part.thickness
        if ((!th || th.length !== m.p.length / 3) && part.wall) {
          // Both faces of a wall are within its thickness of each other, and
          // a sample within its spacing of the next: one run per wall.
          const link = 1.5 * Math.max(part.wall.spacing, P.minMm)
          for (const run of thinRuns(part.wall, P.minMm, link)) {
            if (run.area < (P.minAreaMm2 ?? 0)) continue
            thinWall(rule, run.least, [r(run.at[0]), r(run.at[1]), r(run.at[2])], run.area)
          }
          // A taper to a knife edge — a stacking lip, a chamfer — thickens
          // past the limit within a step or two of its edge: not a thin
          // wall, but worth knowing the tip prints as one line.
          for (const e of sharpEdges(part.wall, P.minMm, link)) {
            if (e.area < (P.minAreaMm2 ?? 0)) continue
            // units-ok: the agent's readout, in millimetres always
            add({ ...rule, severity: 'info' }, { value: r(e.length, 1), limit: P.minMm, unit: 'mm', at: [r(e.at[0]), r(e.at[1]), r(e.at[2])], areaMm2: r(e.area, 1), says: `a sharp edge about ${r(e.length, 1)} mm long: under ${P.minMm} mm only near the edge, it prints as a single line` })
          }
          break
        }
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
          thinWall(rule, least, centroid(m, run), a)
        }
        break
      }
      case 'smallHole': {
        for (const h of uprightHoles(m)) {
          if (2 * h.radius >= P.minDiameterMm) continue
          // units-ok: the agent's readout, in millimetres always
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
        // units-ok: the agent's readout, in millimetres always
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
        // units-ok: the agent's readout, in millimetres always
        if (ratio > P.maxRatio) add(rule, { value: r(ratio, 1), limit: P.maxRatio, unit: '× its base', at: [r(bx.reduce((s, v) => s + v, 0) / bx.length), r(by.reduce((s, v) => s + v, 0) / by.length), r(m.zMin)], says: `${r(height, 1)} mm tall on a base ${r(base, 1)} mm across at its narrowest (${r(ratio, 1)}×) — add a brim or a support fin, print several together, or lay it down` })
        break
      }
      case 'trappedVolume': {
        for (const shell of shells(m)) {
          if (shell.volume >= 0 || -shell.volume < (P.minVolumeMm3 ?? 0)) continue
          // units-ok: the agent's readout, in millimetres always
          add(rule, { value: r(-shell.volume, 1), limit: P.minVolumeMm3 ?? 0, unit: 'mm³', at: shell.at, says: `a closed cavity of ${r(-shell.volume, 1)} mm³ inside the part — it prints, but traps air; add a vent if anything must get out` })
        }
        break
      }
      case 'buildVolume': {
        if (!(P.xMm > 0 && P.yMm > 0 && P.zMm > 0)) break
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
        for (let i = 0; i < m.p.length; i += 3) {
          xMin = Math.min(xMin, m.p[i])
          xMax = Math.max(xMax, m.p[i])
          yMin = Math.min(yMin, m.p[i + 1])
          yMax = Math.max(yMax, m.p[i + 1])
        }
        const w = xMax - xMin, d = yMax - yMin, h = m.zMax - m.zMin
        const fits = (X: number) => (w <= X && d <= P.yMm) || (d <= X && w <= P.yMm)
        const at: [number, number, number] = [r((xMin + xMax) / 2), r((yMin + yMax) / 2), r(m.zMin)]
        // units-ok: the agent's readout, in millimetres always
        if (h > P.zMm) add(rule, { value: r(h, 1), limit: P.zMm, unit: 'mm tall', at, says: `${r(h, 1)} mm tall, over the ${P.zMm} mm the printer builds — lay it down, split it or scale it` })
        // units-ok: the agent's readout, in millimetres always
        else if (!fits(P.xMm)) add(rule, { value: r(Math.max(w, d), 1), limit: P.xMm, unit: 'mm across', at, says: `${r(w, 1)} × ${r(d, 1)} mm on the bed, over the ${P.xMm} × ${P.yMm} mm plate even turned — split it, scale it or stand it another way` })
        // units-ok: the agent's readout, in millimetres always
        else if (P.dualXMm > 0 && !fits(P.dualXMm)) add({ ...rule, severity: 'warning' }, { value: r(Math.max(w, d), 1), limit: P.dualXMm, unit: 'mm across', at, says: `${r(w, 1)} × ${r(d, 1)} mm fits printing from one nozzle, but not the ${P.dualXMm} mm both nozzles reach — print it in one material, or turn it` })
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
  /** The longest bridge it needs: through each place the shortest line
   *  across from a wall going down to the one opposite, the longest of
   *  those; 0 when no place has one. */
  span: number
  /** The part with no such line — held on one side, two adjacent sides or
   *  none: it prints in air. */
  loose: { area: number; at: [number, number, number] } | null
  /** Held up on any side at all. */
  held: boolean
}

/** Directions a line across is tried in, over half a turn. */
const ACROSS = 12

/** Flat ceilings off the bed. A place on one is bridged when some straight
 *  line through it, in plan, reaches a wall going down at both ends before
 *  it leaves the ceiling — the line the slicer lays a bridge along. A gap
 *  between two feet is a bridge however its ends flare; a shelf off one
 *  wall, or held at a corner only, is not. */
function ceilings(m: Mesh): Ceiling[] {
  const edgeTris = new Map<string, number[]>()
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`)
  for (let t = 0; t < m.tris; t++)
    for (let k = 0; k < 3; k++) {
      const kk = key(m.idx[3 * t + k], m.idx[3 * t + ((k + 1) % 3)])
      const l = edgeTris.get(kk)
      if (l) l.push(t)
      else edgeTris.set(kk, [t])
    }
  const out: Ceiling[] = []
  for (const run of regions(m, (t) => m.normal[3 * t + 2] <= -FLAT && !onBed(m, t))) {
    const inRun = new Set(run)
    const area = areaOf(m, run)
    // The ceiling's edge in plan, each piece held (a wall going down from
    // it) or free (a wall going up, or nothing).
    const seg: number[] = [], held: boolean[] = []
    for (const t of run)
      for (let k = 0; k < 3; k++) {
        const a = m.idx[3 * t + k], b = m.idx[3 * t + ((k + 1) % 3)]
        const others = (edgeTris.get(key(a, b)) ?? []).filter((n) => !inRun.has(n))
        if (others.length === 0 && (edgeTris.get(key(a, b)) ?? []).length > 1) continue
        const zEdge = (m.p[3 * a + 2] + m.p[3 * b + 2]) / 2
        const down = others.some((n) => {
          const third = [0, 1, 2].map((j) => m.idx[3 * n + j]).find((v) => v !== a && v !== b)
          return third !== undefined && m.p[3 * third + 2] < zEdge - 0.05
        })
        seg.push(m.p[3 * a], m.p[3 * a + 1], m.p[3 * b], m.p[3 * b + 1])
        held.push(down)
      }
    const grid = segmentGrid(seg)
    // Samples over the ceiling, at most a few thousand.
    const s = Math.max(0.2, Math.sqrt((3 * area) / 4000))
    const pts: number[] = [], wts: number[] = [], zs: number[] = []
    const split = (a: number[], b: number[], c: number[], depth: number) => {
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1])
      const most = Math.max(ab, bc, ca)
      if (most <= s || depth > 20) {
        pts.push((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3)
        zs.push((a[2] + b[2] + c[2]) / 3)
        wts.push(Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2)
        return
      }
      const mid = (u: number[], v: number[]) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2]
      if (most === ab) (split(a, mid(a, b), c, depth + 1), split(mid(a, b), b, c, depth + 1))
      else if (most === bc) (split(a, b, mid(b, c), depth + 1), split(a, mid(b, c), c, depth + 1))
      else (split(a, b, mid(c, a), depth + 1), split(mid(c, a), b, c, depth + 1))
    }
    const corner = (v: number) => [m.p[3 * v], m.p[3 * v + 1], m.p[3 * v + 2]]
    for (const t of run) split(corner(m.idx[3 * t]), corner(m.idx[3 * t + 1]), corner(m.idx[3 * t + 2]), 0)
    let span = 0, looseArea = 0, lx = 0, ly = 0, lz = 0
    for (let i = 0; i < wts.length; i++) {
      const x = pts[2 * i], y = pts[2 * i + 1]
      let best = Infinity
      for (let d = 0; d < ACROSS; d++) {
        const ang = (d * Math.PI) / ACROSS, dx = Math.cos(ang), dy = Math.sin(ang)
        const f = castSegments(grid, seg, x, y, dx, dy)
        if (f.i < 0 || !held[f.i]) continue
        const b = castSegments(grid, seg, x, y, -dx, -dy)
        if (b.i < 0 || !held[b.i]) continue
        best = Math.min(best, f.t + b.t)
      }
      if (best < Infinity) span = Math.max(span, best)
      else {
        looseArea += wts[i]
        lx += wts[i] * x
        ly += wts[i] * y
        lz += wts[i] * zs[i]
      }
    }
    const loose = looseArea > 0 ? { area: looseArea, at: [r(lx / looseArea), r(ly / looseArea), r(lz / looseArea)] as [number, number, number] } : null
    out.push({ area, at: centroid(m, run), span, loose, held: held.some(Boolean) })
  }
  return out
}

interface SegmentGrid {
  x0: number
  y0: number
  size: number
  nx: number
  ny: number
  cells: number[][]
}

/** Segments (x0 y0 x1 y1 …) binned in a grid of cells, about 64 across. */
function segmentGrid(seg: number[]): SegmentGrid {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < seg.length; i += 2) {
    x0 = Math.min(x0, seg[i])
    x1 = Math.max(x1, seg[i])
    y0 = Math.min(y0, seg[i + 1])
    y1 = Math.max(y1, seg[i + 1])
  }
  if (!(x1 >= x0)) return { x0: 0, y0: 0, size: 1, nx: 0, ny: 0, cells: [] }
  const size = Math.max(1e-3, Math.max(x1 - x0, y1 - y0) / 64)
  x0 -= size
  y0 -= size
  const nx = Math.ceil((x1 - x0) / size) + 2, ny = Math.ceil((y1 - y0) / size) + 2
  const cells: number[][] = Array.from({ length: nx * ny }, () => [])
  for (let s = 0; 4 * s < seg.length; s++) {
    const ax = seg[4 * s], ay = seg[4 * s + 1], bx = seg[4 * s + 2], by = seg[4 * s + 3]
    const i0 = Math.floor((Math.min(ax, bx) - x0) / size), i1 = Math.floor((Math.max(ax, bx) - x0) / size)
    const j0 = Math.floor((Math.min(ay, by) - y0) / size), j1 = Math.floor((Math.max(ay, by) - y0) / size)
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) cells[j * nx + i].push(s)
  }
  return { x0, y0, size, nx, ny, cells }
}

/** The first segment a ray in plan meets, cell by cell along it, and how
 *  far: i -1 when it meets none. */
function castSegments(g: SegmentGrid, seg: number[], ox: number, oy: number, dx: number, dy: number): { i: number; t: number } {
  let ci = Math.floor((ox - g.x0) / g.size), cj = Math.floor((oy - g.y0) / g.size)
  const stepI = dx > 0 ? 1 : -1, stepJ = dy > 0 ? 1 : -1
  const big = 1e30
  const dtx = Math.abs(dx) > 1e-12 ? g.size / Math.abs(dx) : big, dty = Math.abs(dy) > 1e-12 ? g.size / Math.abs(dy) : big
  let tx = Math.abs(dx) > 1e-12 ? ((dx > 0 ? ci + 1 : ci) * g.size + g.x0 - ox) / dx : big
  let ty = Math.abs(dy) > 1e-12 ? ((dy > 0 ? cj + 1 : cj) * g.size + g.y0 - oy) / dy : big
  const tried = new Set<number>()
  let best = Infinity, hit = -1
  while (ci >= 0 && cj >= 0 && ci < g.nx && cj < g.ny) {
    for (const s of g.cells[cj * g.nx + ci]) {
      if (tried.has(s)) continue
      tried.add(s)
      const ax = seg[4 * s], ay = seg[4 * s + 1], ex = seg[4 * s + 2] - ax, ey = seg[4 * s + 3] - ay
      const den = dx * ey - dy * ex
      if (Math.abs(den) < 1e-15) continue
      const wx = ax - ox, wy = ay - oy
      const t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den
      if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) {
        best = t
        hit = s
      }
    }
    // A hit inside this cell is the nearest there can be.
    if (hit >= 0 && best <= Math.min(tx, ty) + 1e-9) break
    if (tx < ty) {
      ci += stepI
      tx += dtx
    } else {
      cj += stepJ
      ty += dty
    }
  }
  return { i: hit, t: best }
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
