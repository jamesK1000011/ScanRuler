// SPDX-License-Identifier: AGPL-3.0-only
// A part judged for basic CNC milling — no toolpaths: from which tool
// directions each face can be reached (a face turned away from every one,
// or under material along it, is an undercut), the inside corners standing
// along a tool direction that an end mill leaves its radius in, holes and
// floors deeper than the tool reaches or than about four diameters, and
// features narrower than the least tool. Read from the body's faces as
// reverse.body.describe lists them and each face's triangles; pure, so the
// tests need no kernel.

export type V3 = [number, number, number]

export interface FaceIn {
  index: number
  kind: string
  area: number
  centroid: V3
  normal?: V3
  axis?: V3
  radius?: number
  center?: V3
  side?: 'boss' | 'bore'
}

export interface EdgeIn {
  index: number
  kind: string
  length: number
  mid: V3
  dir?: V3
  faces: (number | null)[]
}

export interface Finding {
  severity: 'error' | 'warning' | 'info'
  rule: string
  says: string
  at?: V3
}

export interface Tool {
  /** The least end mill's diameter, mm. */
  minDiameter: number
  /** How far the longest tool reaches below the part's top, mm. */
  reach: number
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const lenV = (a: V3) => Math.hypot(a[0], a[1], a[2])
const norm = (a: V3): V3 => {
  const l = lenV(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0
const r3s = (p: V3): V3 => [r3(p[0]), r3(p[1]), r3(p[2])]

export const DIRECTIONS: Record<string, V3> = { '+z': [0, 0, 1], '-z': [0, 0, -1], '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0] }

/** A direction as a word (+z) or a vector, made unit; null for neither. */
export function directionOf(v: unknown): V3 | null {
  if (typeof v === 'string') return DIRECTIONS[v.trim().toLowerCase()] ?? null
  if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) && lenV(v as V3) > 1e-9) return norm(v as V3)
  return null
}

export const directionWord = (d: V3): string => Object.entries(DIRECTIONS).find(([, v]) => dot(v, d) > 1 - 1e-9)?.[0] ?? `[${d.map(r3).join(', ')}]`

/** A face's triangles: corners x y z after x y z. */
export type Tris = Float32Array | Float64Array | number[]

interface Tri {
  a: V3
  b: V3
  c: V3
  n: V3
  area: number
  center: V3
  face: number
}

/** The triangles of every face, each with its outward normal — the
 *  winding's, turned to agree with the flat faces' own normals when the
 *  mesh runs the other way. */
export function trianglesOf(faces: readonly FaceIn[], tris: ReadonlyMap<number, Tris>): Tri[] {
  const out: Tri[] = []
  let agree = 0
  let disagree = 0
  for (const f of faces) {
    const t = tris.get(f.index)
    if (!t) continue
    for (let i = 0; i + 8 < t.length; i += 9) {
      const a: V3 = [t[i], t[i + 1], t[i + 2]]
      const b: V3 = [t[i + 3], t[i + 4], t[i + 5]]
      const c: V3 = [t[i + 6], t[i + 7], t[i + 8]]
      const cr = crossV(sub(b, a), sub(c, a))
      const area = lenV(cr) / 2
      if (area < 1e-12) continue
      const n = norm(cr)
      if (f.kind === 'plane' && f.normal) dot(n, f.normal) >= 0 ? agree++ : disagree++
      out.push({ a, b, c, n, area, center: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3], face: f.index })
    }
  }
  if (disagree > agree) for (const t of out) t.n = [-t.n[0], -t.n[1], -t.n[2]]
  return out
}

/** Whether a ray from o along d meets a triangle past `from` (Möller–Trumbore). */
function hits(o: V3, d: V3, t: Tri, from: number): boolean {
  const e1 = sub(t.b, t.a)
  const e2 = sub(t.c, t.a)
  const p = crossV(d, e2)
  const det = dot(e1, p)
  if (Math.abs(det) < 1e-12) return false
  const inv = 1 / det
  const s = sub(o, t.a)
  const u = dot(s, p) * inv
  if (u < 0 || u > 1) return false
  const q = crossV(s, e1)
  const v = dot(d, q) * inv
  if (v < 0 || u + v > 1) return false
  return dot(e2, q) * inv > from
}

/** Whether the way from p along d is clear of the part. */
function clear(p: V3, d: V3, all: readonly Tri[]): boolean {
  for (const t of all) {
    // Behind the start along d: cannot be met.
    if (Math.max(dot(t.a, d), dot(t.b, d), dot(t.c, d)) < dot(p, d)) continue
    if (hits(p, d, t, 1e-5)) return false
  }
  return true
}

/** The lowest and highest of triangles along d. */
function extent(ts: readonly Tri[], d: V3): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const t of ts) {
    for (const p of [t.a, t.b, t.c]) {
      const x = dot(p, d)
      if (x < lo) lo = x
      if (x > hi) hi = x
    }
  }
  return [lo, hi]
}

/** Turned away from d further than this (the cosine) counts as facing away. */
const AWAY = -0.02
/** A face counts as reached from d when no more than this share of it
 *  faces away, and most of its samples see out along d. */
const AWAY_SHARE = 0.02

export interface FaceReach {
  face: number
  /** The directions (by index) the face is reached from. */
  from: number[]
  /** How deep it lies from each direction that reaches it: the part's top
   *  along it less the face's lowest point. */
  depth: Record<number, number>
}

/** Which directions reach each face. */
export function reachOf(faces: readonly FaceIn[], all: readonly Tri[], dirs: readonly V3[]): FaceReach[] {
  const byFace = new Map<number, Tri[]>()
  for (const t of all) {
    const l = byFace.get(t.face)
    if (l) l.push(t)
    else byFace.set(t.face, [t])
  }
  const top = dirs.map((d) => extent(all, d)[1])
  return faces.map((f) => {
    const ts = byFace.get(f.index) ?? []
    const total = ts.reduce((s, t) => s + t.area, 0) || 1
    const from: number[] = []
    const depth: Record<number, number> = {}
    dirs.forEach((d, k) => {
      const away = ts.filter((t) => dot(t.n, d) < AWAY).reduce((s, t) => s + t.area, 0)
      if (away / total > AWAY_SHARE) return
      // Samples: the largest triangles facing d, a hair off the skin.
      const samples = [...ts].filter((t) => dot(t.n, d) >= AWAY).sort((a, b) => b.area - a.area).slice(0, 5)
      const seen = samples.filter((t) => clear([t.center[0] + t.n[0] * 0.02, t.center[1] + t.n[1] * 0.02, t.center[2] + t.n[2] * 0.02], d, all)).length
      if (samples.length && seen * 2 < samples.length) return
      from.push(k)
      depth[k] = r3(top[k] - extent(ts, d)[0])
    })
    return { face: f.index, from, depth }
  })
}

/** How far round its axis a round face goes, radians: about 2π for a whole
 *  hole or boss, less for a fillet. */
function sweepOf(f: FaceIn, ts: readonly Tri[]): number {
  if (!f.axis || !f.center || !ts.length) return 2 * Math.PI
  const a = norm(f.axis)
  const u = norm(Math.abs(a[0]) < 0.9 ? crossV(a, [1, 0, 0]) : crossV(a, [0, 1, 0]))
  const v = crossV(a, u)
  const angles = ts.map((t) => {
    const p = sub(t.center, f.center!)
    return Math.atan2(dot(p, v), dot(p, u))
  })
  angles.sort((x, y) => x - y)
  let gap = angles[0] + 2 * Math.PI - angles[angles.length - 1]
  for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i] - angles[i - 1])
  return 2 * Math.PI - gap
}

/** The least width of a flat face: the narrowest of its box turned in
 *  steps of 5° in its own plane. */
function leastWidth(f: FaceIn, ts: readonly Tri[]): number {
  if (!f.normal || !ts.length) return Infinity
  const n = norm(f.normal)
  const u = norm(Math.abs(n[0]) < 0.9 ? crossV(n, [1, 0, 0]) : crossV(n, [0, 1, 0]))
  const v = crossV(n, u)
  const pts = ts.flatMap((t) => [t.a, t.b, t.c]).map((p) => [dot(p, u), dot(p, v)] as const)
  let least = Infinity
  for (let deg = 0; deg < 180; deg += 5) {
    const c = Math.cos((deg * Math.PI) / 180)
    const s = Math.sin((deg * Math.PI) / 180)
    let lo = Infinity
    let hi = -Infinity
    for (const [x, y] of pts) {
      const w = x * c + y * s
      lo = Math.min(lo, w)
      hi = Math.max(hi, w)
    }
    least = Math.min(least, hi - lo)
  }
  return least
}

/** Every finding for the part: undercuts, inside corners, deep and narrow
 *  places, features under the least tool. */
export function checkMill(faces: readonly FaceIn[], edges: readonly EdgeIn[], tris: ReadonlyMap<number, Tris>, dirs: readonly V3[], tool: Tool): { findings: Finding[]; reach: FaceReach[] } {
  const out: Finding[] = []
  const all = trianglesOf(faces, tris)
  if (!all.length) return { findings: [{ severity: 'error', rule: 'mesh', says: 'the body has no triangles to read' }], reach: [] }
  const reach = reachOf(faces, all, dirs)
  const byIndex = new Map(faces.map((f) => [f.index, f]))
  const byFace = new Map<number, Tri[]>()
  for (const t of all) {
    const l = byFace.get(t.face)
    if (l) l.push(t)
    else byFace.set(t.face, [t])
  }
  const bottom = dirs.map((d) => extent(all, d)[0])
  const words = dirs.map(directionWord).join(', ')
  const R = tool.minDiameter / 2

  // Undercuts — the floor the stock stands on, facing straight down at the
  // part's lowest, is left as stock (or faced from the other side).
  const unreached = reach.filter((r) => !r.from.length)
  const stock: number[] = []
  const under: FaceReach[] = []
  for (const r of unreached) {
    const f = byIndex.get(r.face)!
    const floor = f.kind === 'plane' && f.normal && dirs.some((d, k) => dot(norm(f.normal!), d) < -1 + 1e-4 && Math.abs(dot(f.centroid, d) - bottom[k]) < 0.01)
    if (floor) stock.push(r.face)
    else under.push(r)
  }
  if (stock.length) out.push({ severity: 'info', rule: 'stock-floor', says: `face${stock.length === 1 ? '' : 's'} ${stock.join(', ')}: the part’s underside, left as the stock’s face or faced from the other side` })
  for (const r of under.slice(0, 8)) {
    const f = byIndex.get(r.face)!
    out.push({ severity: 'error', rule: 'undercut', says: `face ${r.face} (${f.kind}) is not reached from ${words}: turned away or under material — another setup direction, a 5-axis machine, or change the shape`, at: r3s(f.centroid) })
  }
  if (under.length > 8) out.push({ severity: 'error', rule: 'undercut', says: `and ${under.length - 8} more faces not reached` })

  // Square inside corners along a tool direction.
  const sharp: V3[] = []
  for (const e of edges) {
    if (e.kind !== 'line' || !e.dir || e.faces.length !== 2 || e.faces.some((x) => x === null)) continue
    if (!dirs.some((d) => Math.abs(dot(norm(e.dir!), d)) > 0.999)) continue
    const [f1, f2] = e.faces.map((i) => byIndex.get(i!))
    if (!f1 || !f2 || f1.kind !== 'plane' || f2.kind !== 'plane' || !f1.normal || !f2.normal) continue
    if (Math.abs(dot(norm(f1.normal), norm(f2.normal))) > 0.999) continue
    // Inside: each face lies on the outer side of the other's plane.
    if (dot(sub(f2.centroid, e.mid), norm(f1.normal)) > 1e-6) sharp.push(e.mid)
  }
  if (sharp.length) out.push({ severity: 'warning', rule: 'inside-corner', says: `${sharp.length} square inside corner${sharp.length === 1 ? '' : 's'} along the tool: an end mill leaves its radius, at least ${r3(R)} — round ${sharp.length === 1 ? 'it' : 'them'} to a little over that, or relieve`, at: r3s(sharp[0]) })

  // Round faces along a tool direction: holes and inside rounds.
  for (const f of faces) {
    if (f.kind !== 'cylinder' || f.side !== 'bore' || !f.axis || f.radius === undefined) continue
    const k = dirs.findIndex((d) => Math.abs(dot(norm(f.axis!), d)) > 0.999)
    if (k < 0) continue
    const ts = byFace.get(f.index) ?? []
    const whole = sweepOf(f, ts) > 2 * Math.PI - 0.3
    const d = 2 * f.radius
    const [lo, hi] = extent(ts, dirs[k])
    const depth = ts.length ? hi - lo : 0
    if (whole) {
      if (d < tool.minDiameter - 1e-6) out.push({ severity: 'warning', rule: 'small-hole', says: `face ${f.index}: a hole of ${r3(d)} is under the least tool, ${tool.minDiameter} — drill it (or ream), or a smaller tool`, at: r3s(f.centroid) })
      if (depth > 4 * d) out.push({ severity: 'warning', rule: 'deep-hole', says: `face ${f.index}: a hole ${r3(depth)} deep at ${r3(d)} across, ${r3(depth / d)} diameters — past about 4 a mill chatters: drill it, or a long-reach tool`, at: r3s(f.centroid) })
    } else if (f.radius < R - 1e-6) out.push({ severity: 'warning', rule: 'inside-corner', says: `face ${f.index}: an inside round of ${r3(f.radius)}, under the least tool’s radius ${r3(R)} — it comes out at the tool’s`, at: r3s(f.centroid) })
  }

  // Floors: their depth, and their width against the tool.
  for (const r of reach) {
    const f = byIndex.get(r.face)!
    if (f.kind !== 'plane' || !f.normal) continue
    for (const k of r.from) {
      const d = dirs[k]
      if (dot(norm(f.normal), d) < 1 - 1e-4) continue
      const depth = r.depth[k]
      if (depth < 0.01) continue
      const width = leastWidth(f, byFace.get(f.index) ?? [])
      if (width < tool.minDiameter - 1e-6) out.push({ severity: 'error', rule: 'narrow', says: `face ${f.index}: a floor ${r3(width)} wide, narrower than the least tool ${tool.minDiameter}`, at: r3s(f.centroid) })
      else if (depth > 4 * width) out.push({ severity: 'warning', rule: 'deep-pocket', says: `face ${f.index}: a floor ${r3(depth)} down and ${r3(width)} across (${r3(depth / width)} : 1) — past about 4 : 1 a tool long enough chatters`, at: r3s(f.centroid) })
    }
  }

  // Deeper than the tool reaches, from every direction that reaches it.
  const tooDeep = reach.filter((r) => r.from.length && r.from.every((k) => r.depth[k] > tool.reach + 1e-6))
  if (tooDeep.length) {
    const deepest = tooDeep.reduce((a, b) => (Math.min(...b.from.map((k) => b.depth[k])) > Math.min(...a.from.map((k) => a.depth[k])) ? b : a))
    const most = Math.min(...deepest.from.map((k) => deepest.depth[k]))
    const list = tooDeep.map((r) => r.face)
    out.push({ severity: 'error', rule: 'reach', says: `face${list.length === 1 ? '' : 's'} ${list.slice(0, 12).join(', ')}${list.length > 12 ? ' …' : ''} ${list.length === 1 ? 'lies' : 'lie'} up to ${most} down, past the tool’s reach of ${tool.reach}: a longer tool, or another direction`, at: r3s(byIndex.get(deepest.face)!.centroid) })
  }
  return { findings: out, reach }
}

/** The part's box along the world axes. */
export function boxOfTris(tris: ReadonlyMap<number, Tris>): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity]
  const max: V3 = [-Infinity, -Infinity, -Infinity]
  for (const t of tris.values()) {
    for (let i = 0; i + 2 < t.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], t[i + k])
        max[k] = Math.max(max[k], t[i + k])
      }
    }
  }
  return { min: r3s(min), max: r3s(max) }
}

/** The stock: the part's box grown by a margin each side, or a size given
 *  (centred on the part's box) — and whether the part fits in it. */
export function stockOf(box: { min: V3; max: V3 }, given: { margin?: number; size?: V3 }): { size: V3; min: V3; max: V3; fits: boolean } {
  const part: V3 = [0, 1, 2].map((k) => box.max[k] - box.min[k]) as V3
  const size: V3 = given.size ?? (part.map((s) => s + 2 * (given.margin ?? 2)) as V3)
  const c: V3 = [0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2) as V3
  return {
    size: size.map(r3) as V3,
    min: c.map((x, k) => r3(x - size[k] / 2)) as V3,
    max: c.map((x, k) => r3(x + size[k] / 2)) as V3,
    fits: part.every((s, k) => s <= size[k] + 1e-6),
  }
}

/** The least wall worth milling, mm, by the material's category. */
export const minWallFor = (category: string | undefined | null): number => (category === 'metal' ? 0.5 : category === 'wood' ? 2 : category === 'thermoplast' ? 1 : 1)
