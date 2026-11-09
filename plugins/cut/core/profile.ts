// SPDX-License-Identifier: AGPL-3.0-only
// A flat part's profile on its sheet: the outline and its holes as the
// kernel's section gives them (reverse.body.section — lines, arcs, circles,
// sampled curves), read the way a sheet cut reads them. Pure 2D, no kernel,
// so the checks and the files are the same in the tests as in the app.
//
// Every loop is put to run with the material on its left — an outline
// counter-clockwise, a hole clockwise — so "inside the material" is one
// side for every edge, and a corner's turn says at once whether it is an
// outside corner (left) or an inside one (right).

export type Pt = [number, number]

export type Piece =
  | { kind: 'line'; a: Pt; b: Pt }
  /** start and sweep in radians counter-clockwise from +u; the sweep signed. */
  | { kind: 'arc'; center: Pt; radius: number; start: number; sweep: number; a: Pt; b: Pt }
  | { kind: 'circle'; center: Pt; radius: number }
  | { kind: 'curve'; points: Pt[]; a: Pt; b: Pt }

export interface Loop {
  pieces: Piece[]
  /** Signed area as the loop now runs: positive for an outline, negative
   *  for a hole. */
  area: number
}

/** One piece of material as cut: its outline and the holes in it. */
export interface Profile {
  outer: Loop
  holes: Loop[]
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0
export const round4 = r4
const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0]
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
const hyp = (a: Pt) => Math.hypot(a[0], a[1])
const unit = (a: Pt): Pt => {
  const l = hyp(a)
  return l > 0 ? [a[0] / l, a[1] / l] : [0, 0]
}

/** A piece as the section's answer gives it, or null for one it does not. */
export function pieceOf(p: Record<string, unknown>): Piece | null {
  const pt = (v: unknown): Pt | null => (Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === 'number') ? [v[0] as number, v[1] as number] : null)
  const a = pt(p.a)
  const b = pt(p.b)
  const center = pt(p.center)
  const radius = typeof p.radius === 'number' ? p.radius : null
  if (p.kind === 'line' && a && b) return { kind: 'line', a, b }
  if (p.kind === 'circle' && center && radius) return { kind: 'circle', center, radius }
  if (p.kind === 'arc' && center && radius && a && b && typeof p.start === 'number' && typeof p.sweep === 'number') return { kind: 'arc', center, radius, start: p.start, sweep: p.sweep, a, b }
  if (p.kind === 'curve' && a && b) {
    const points = Array.isArray(p.points) ? (p.points.map(pt).filter(Boolean) as Pt[]) : []
    return { kind: 'curve', points: points.length >= 2 ? points : [a, b], a, b }
  }
  return null
}

/** The same piece run the other way. */
export function reversed(p: Piece): Piece {
  switch (p.kind) {
    case 'line':
      return { kind: 'line', a: p.b, b: p.a }
    case 'arc':
      return { ...p, a: p.b, b: p.a, start: p.start + p.sweep, sweep: -p.sweep }
    case 'circle':
      return p
    case 'curve':
      return { kind: 'curve', points: [...p.points].reverse(), a: p.b, b: p.a }
  }
}

/** How a circle runs, in a loop: a piece of its own whose way is its
 *  loop's — +1 counter-clockwise, −1 clockwise. Kept beside the loop. */
const CIRCLE_WAY = new WeakMap<Piece, number>()

/** Points along a piece from its start to its end, an arc's or circle's to
 *  `chord` (how far a straight may stand off the curve); the end point is
 *  left off, so pieces chain without repeating their joints. */
export function samplePiece(p: Piece, chord: number): Pt[] {
  const arcPts = (c: Pt, r: number, start: number, sweep: number): Pt[] => {
    const step = 2 * Math.acos(Math.max(-1, 1 - Math.min(chord, r) / r)) || Math.PI / 8
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / Math.min(step, Math.PI / 8)))
    const out: Pt[] = []
    for (let i = 0; i < n; i++) {
      const t = start + (sweep * i) / n
      out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)])
    }
    return out
  }
  switch (p.kind) {
    case 'line':
      return [p.a]
    case 'arc':
      return arcPts(p.center, p.radius, p.start, p.sweep)
    case 'circle':
      return arcPts(p.center, p.radius, 0, (CIRCLE_WAY.get(p) ?? 1) * 2 * Math.PI)
    case 'curve':
      return p.points.slice(0, -1)
  }
}

/** A loop as a closed polygon (the first point not repeated). */
export function polygonOf(loop: Loop, chord = 0.02): Pt[] {
  return loop.pieces.flatMap((p) => samplePiece(p, chord))
}

export function polygonArea(poly: readonly Pt[]): number {
  let twice = 0
  for (let i = 0; i < poly.length; i++) twice += cross(poly[i], poly[(i + 1) % poly.length])
  return twice / 2
}

export function insidePolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** A loop made to run one way: +1 counter-clockwise, −1 clockwise. */
function runAs(pieces: Piece[], way: 1 | -1): Loop {
  if (pieces.length === 1 && pieces[0].kind === 'circle') {
    const c = { ...pieces[0] }
    CIRCLE_WAY.set(c, way)
    return { pieces: [c], area: way * Math.PI * c.radius * c.radius }
  }
  const area = polygonArea(pieces.flatMap((p) => samplePiece(p, 0.01)))
  if (Math.sign(area) === way || area === 0) return { pieces, area }
  return { pieces: [...pieces].reverse().map(reversed), area: -area }
}

/** The circle a one-piece loop is, else null. */
export const circleOf = (loop: Loop): (Piece & { kind: 'circle' }) | null => (loop.pieces.length === 1 && loop.pieces[0].kind === 'circle' ? loop.pieces[0] : null)

/** The closed chains of a section, sorted into pieces of material: a chain
 *  inside an odd number of others is a hole of the one it lies in most
 *  closely; at an even depth, an outline of its own (an island in a hole
 *  is a piece that falls out when cut). */
export function profilesOf(chains: readonly Piece[][]): Profile[] {
  const loops = chains.filter((c) => c.length > 0).map((c) => runAs(c, 1))
  const polys = loops.map((l) => polygonOf(l, 0.05))
  const order = loops.map((_, i) => i).sort((a, b) => Math.abs(loops[b].area) - Math.abs(loops[a].area))
  const parent = new Map<number, number>()
  const depth = new Map<number, number>()
  for (const i of order) {
    // The smallest loop already placed that holds this one.
    let best: number | null = null
    for (const j of order) {
      if (j === i || Math.abs(loops[j].area) <= Math.abs(loops[i].area)) continue
      if (!insidePolygon(polys[i][0], polys[j])) continue
      if (best === null || Math.abs(loops[j].area) < Math.abs(loops[best].area)) best = j
    }
    if (best !== null) parent.set(i, best)
    depth.set(i, best === null ? 0 : (depth.get(best) ?? 0) + 1)
  }
  const out: Profile[] = []
  const at = new Map<number, Profile>()
  for (const i of order) {
    if ((depth.get(i) ?? 0) % 2 === 0) {
      const p: Profile = { outer: loops[i], holes: [] }
      at.set(i, p)
      out.push(p)
    }
  }
  for (const i of order) {
    if ((depth.get(i) ?? 0) % 2 === 1) at.get(parent.get(i)!)?.holes.push(runAs(loops[i].pieces, -1))
  }
  return out
}

// ---- reading the profile --------------------------------------------------------------------

export interface Box2 {
  min: Pt
  max: Pt
}

export function boxOf(points: readonly Pt[]): Box2 {
  const min: Pt = [Infinity, Infinity]
  const max: Pt = [-Infinity, -Infinity]
  for (const p of points) {
    for (const k of [0, 1] as const) {
      min[k] = Math.min(min[k], p[k])
      max[k] = Math.max(max[k], p[k])
    }
  }
  return { min, max }
}

export const profileBox = (p: Profile, chord = 0.02): Box2 => boxOf(polygonOf(p.outer, chord))

/** A segment of a loop's polygon, with the loop it is of. */
interface Seg {
  a: Pt
  b: Pt
  loop: number
}

function segmentsOf(p: Profile, chord: number): { segs: Seg[]; polys: Pt[][] } {
  const polys = [p.outer, ...p.holes].map((l) => polygonOf(l, chord))
  const segs: Seg[] = []
  polys.forEach((poly, loop) => poly.forEach((a, i) => segs.push({ a, b: poly[(i + 1) % poly.length], loop })))
  return { segs, polys }
}

/** Where a ray from `o` along unit `d` first meets a segment, past `from`,
 *  and that segment's left normal (into its material). */
function firstHit(o: Pt, d: Pt, segs: readonly Seg[], from: number): { t: number; normal: Pt } | null {
  let best: { t: number; normal: Pt } | null = null
  for (const s of segs) {
    const e = sub(s.b, s.a)
    const den = cross(d, e)
    if (Math.abs(den) < 1e-12) continue
    const w = sub(s.a, o)
    const t = cross(w, e) / den
    const u = cross(w, d) / den
    if (t <= from || u < 0 || u > 1) continue
    if (!best || t < best.t) best = { t, normal: unit([-e[1], e[0]]) }
  }
  return best
}

export interface Narrow {
  /** web: material narrower than this across; gap: a slot or a hole
   *  narrower across. */
  kind: 'web' | 'gap'
  width: number
  /** The middle of the narrowest reading, on the sheet. */
  at: Pt
}

/** The narrow places of a profile: rays square off its edges, into the
 *  material (a web, a bridge, a tab) and out of it (a slot, a notch, a hole
 *  that is no circle), read only where they meet an edge facing back —
 *  two sides of one wall or gap, not a corner's neighbour run into
 *  sideways. Readings under `under` are gathered into places, each its
 *  narrowest. Circles are left to the hole rule. */
export function narrowPlaces(p: Profile, under: number, opts: { spacing?: number; chord?: number } = {}): Narrow[] {
  const chord = opts.chord ?? 0.02
  const spacing = opts.spacing ?? Math.max(under / 3, 0.05)
  const { segs } = segmentsOf(p, chord)
  const facing = Math.cos((35 * Math.PI) / 180)
  const found: Narrow[] = []
  const loops = [p.outer, ...p.holes]
  for (const s of segs) {
    if (circleOf(loops[s.loop])) continue
    const e = sub(s.b, s.a)
    const L = hyp(e)
    if (L < 1e-9) continue
    const dir = unit(e)
    const left: Pt = [-dir[1], dir[0]]
    const n = Math.max(1, Math.round(L / spacing))
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n
      const o: Pt = [s.a[0] + e[0] * f, s.a[1] + e[1] * f]
      for (const [kind, d] of [
        ['web', left],
        ['gap', [-left[0], -left[1]] as Pt],
      ] as const) {
        const hit = firstHit(o, d, segs, 1e-6)
        if (!hit || hit.t >= under) continue
        // Facing back: the far edge's material lies towards us for a web
        // (its left normal against the ray), away from us for a gap.
        const back = kind === 'web' ? -(hit.normal[0] * d[0] + hit.normal[1] * d[1]) : hit.normal[0] * d[0] + hit.normal[1] * d[1]
        if (back < facing) continue
        found.push({ kind, width: hit.t, at: [o[0] + (d[0] * hit.t) / 2, o[1] + (d[1] * hit.t) / 2] })
      }
    }
  }
  return gather(found, Math.max(under, 1))
}

/** Readings gathered into places — a kind's readings chained by any two
 *  within `near` — each place its narrowest reading. */
function gather(all: Narrow[], near: number): Narrow[] {
  const group = all.map((_, i) => i)
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i])))
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      if (all[i].kind === all[j].kind && hyp(sub(all[i].at, all[j].at)) < near) group[root(i)] = root(j)
  const least = new Map<number, Narrow>()
  all.forEach((x, i) => {
    const k = root(i)
    const was = least.get(k)
    if (!was || x.width < was.width) least.set(k, x)
  })
  return [...least.values()].sort((a, b) => a.width - b.width).map((x) => ({ ...x, width: r4(x.width), at: [r4(x.at[0]), r4(x.at[1])] }))
}

export interface InsideCorner {
  /** The radius there: 0 for a sharp corner. */
  radius: number
  at: Pt
}

/** The inside corners of the material — where a round tool cannot reach
 *  into: sharp ones where two pieces meet turning right (the material on
 *  the left), and arcs turning right, under `under` in radius. A curve's
 *  bends are not read. */
export function insideCorners(p: Profile, under: number): InsideCorner[] {
  const out: InsideCorner[] = []
  const tangentAt = (q: Piece, end: 'a' | 'b'): Pt => {
    if (q.kind === 'line') return unit(sub(q.b, q.a))
    if (q.kind === 'arc') {
      const t = end === 'a' ? q.start : q.start + q.sweep
      const s = Math.sign(q.sweep)
      return [-Math.sin(t) * s, Math.cos(t) * s]
    }
    if (q.kind === 'curve') return end === 'a' ? unit(sub(q.points[1], q.points[0])) : unit(sub(q.points[q.points.length - 1], q.points[q.points.length - 2]))
    return [1, 0]
  }
  for (const loop of [p.outer, ...p.holes]) {
    if (circleOf(loop)) continue
    const ps = loop.pieces
    ps.forEach((q, i) => {
      if (q.kind === 'arc' && q.sweep < 0 && q.radius < under) {
        const t = q.start + q.sweep / 2
        out.push({ radius: r4(q.radius), at: [r4(q.center[0] + q.radius * Math.cos(t)), r4(q.center[1] + q.radius * Math.sin(t))] })
      }
      const next = ps[(i + 1) % ps.length]
      if (q.kind === 'circle' || next.kind === 'circle') return
      const tin = tangentAt(q, 'b')
      const tout = tangentAt(next, 'a')
      const turn = cross(tin, tout)
      // Tangent (a fillet running on) or turning left (an outside corner).
      if (turn > -Math.sin((2 * Math.PI) / 180)) return
      out.push({ radius: 0, at: [r4(q.b[0]), r4(q.b[1])] })
    })
  }
  return out
}

/** The round holes, by diameter, with their centres. */
export function roundHoles(p: Profile): { diameter: number; at: Pt }[] {
  return p.holes.flatMap((h) => {
    const c = circleOf(h)
    return c ? [{ diameter: r4(2 * c.radius), at: [r4(c.center[0]), r4(c.center[1])] as Pt }] : []
  })
}

/** The holes that are no circle: each its width across, least. */
export function otherHoles(p: Profile, chord = 0.02): { least: number; at: Pt }[] {
  return p.holes.flatMap((h) => {
    if (circleOf(h)) return []
    const poly = polygonOf(h, chord)
    const b = boxOf(poly)
    return [{ least: r4(Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1])), at: [r4((b.min[0] + b.max[0]) / 2), r4((b.min[1] + b.max[1]) / 2)] as Pt }]
  })
}

// ---- fitting on a sheet -------------------------------------------------------------------

/** The convex hull, counter-clockwise (monotone chain). */
export function hull(points: readonly Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const half = (list: Pt[]) => {
    const h: Pt[] = []
    for (const p of list) {
      while (h.length >= 2 && cross(sub(h[h.length - 1], h[h.length - 2]), sub(p, h[h.length - 2])) <= 0) h.pop()
      h.push(p)
    }
    h.pop()
    return h
  }
  return [...half(pts), ...half([...pts].reverse())]
}

/** Whether a part fits a sheet, and turned how: square to the sheet as
 *  modelled (0) or a quarter turn (90), else at the angle of one of its
 *  hull's edges — the turns a smallest box is found at. */
export function fitOnSheet(points: readonly Pt[], sheet: readonly [number, number]): { fits: boolean; turnDeg: number | null; size: [number, number] } {
  const b = boxOf(points)
  const size: [number, number] = [r4(b.max[0] - b.min[0]), r4(b.max[1] - b.min[1])]
  const [W, H] = sheet
  const ok = (w: number, h: number) => w <= W + 1e-9 && h <= H + 1e-9
  if (ok(size[0], size[1])) return { fits: true, turnDeg: 0, size }
  if (ok(size[1], size[0])) return { fits: true, turnDeg: 90, size }
  const hl = hull(points)
  for (let i = 0; i < hl.length; i++) {
    const e = sub(hl[(i + 1) % hl.length], hl[i])
    const ang = Math.atan2(e[1], e[0])
    const c = Math.cos(-ang)
    const s = Math.sin(-ang)
    const rb = boxOf(hl.map((p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c] as Pt))
    const w = rb.max[0] - rb.min[0]
    const h = rb.max[1] - rb.min[1]
    const deg = r4((((-ang * 180) / Math.PI) % 180) + 180) % 180
    if (ok(w, h)) return { fits: true, turnDeg: deg, size }
    if (ok(h, w)) return { fits: true, turnDeg: (deg + 90) % 180, size }
  }
  return { fits: false, turnDeg: null, size }
}

// ---- the cutter's path: kerf compensation ----------------------------------------------------

/** A loop's path moved off the material by `d` — half the kerf, so the
 *  cut edge lands on the drawn one: out round an outline, in round a hole.
 *  A circle stays a circle, its radius moved; any other loop comes back as
 *  a polygon (sampled to `chord`), its outside corners rounded about the
 *  corner and its inside ones mitred. Good while d is small against the
 *  features — a slot narrower than the kerf closes up, as it would on the
 *  machine. */
export function offsetLoop(loop: Loop, d: number, chord = 0.02): { circle: { center: Pt; radius: number } } | { polygon: Pt[] } {
  const c = circleOf(loop)
  if (c) return { circle: { center: c.center, radius: loop.area > 0 ? c.radius + d : Math.max(c.radius - d, 0) } }
  const poly = dedupe(polygonOf(loop, chord))
  const n = poly.length
  const out: Pt[] = []
  const right = (a: Pt, b: Pt): Pt => {
    const u = unit(sub(b, a))
    return [u[1], -u[0]]
  }
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n]
    const p = poly[i]
    const next = poly[(i + 1) % n]
    const n1 = right(prev, p)
    const n2 = right(p, next)
    const turn = cross(sub(p, prev), sub(next, p))
    if (turn > 1e-12) {
      // Turning left: an outside corner of the material — the path goes
      // round it.
      const a1 = Math.atan2(n1[1], n1[0])
      let a2 = Math.atan2(n2[1], n2[0])
      while (a2 > a1) a2 -= 2 * Math.PI
      const steps = Math.max(1, Math.ceil((a1 - a2) / (2 * Math.acos(Math.max(-1, 1 - Math.min(chord, d) / d)) || 1)))
      for (let k = 0; k <= steps; k++) {
        const t = a1 + ((a2 - a1) * k) / steps
        out.push([p[0] + d * Math.cos(t), p[1] + d * Math.sin(t)])
      }
    } else {
      const m: Pt = [n1[0] + n2[0], n1[1] + n2[1]]
      const k = 1 + n1[0] * n2[0] + n1[1] * n2[1]
      const s = k > 0.1 ? d / k : d / 0.1
      out.push([p[0] + m[0] * s, p[1] + m[1] * s])
    }
  }
  return { polygon: out }
}

function dedupe(poly: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of poly) if (!out.length || hyp(sub(p, out[out.length - 1])) > 1e-9) out.push(p)
  while (out.length > 2 && hyp(sub(out[0], out[out.length - 1])) <= 1e-9) out.pop()
  return out
}

// ---- laying parts out ----------------------------------------------------------------------

export interface Placed {
  /** Which part, as given. */
  index: number
  /** A quarter turn before placing. */
  turned: boolean
  /** Where the part's box's lower-left lands. */
  at: Pt
  /** Which sheet, from 1. */
  sheet: number
}

/** Parts laid out in rows: tallest first, left to right with `gap`
 *  between, a row wrapping at the sheet's width (or a width found from
 *  the parts' area when no sheet is given), a sheet full starting the next
 *  beside it. A part wider than the sheet but not taller is turned. Row
 *  packing, not nesting: shapes are boxes here. */
export function rowPack(sizes: readonly [number, number][], gap: number, sheet?: readonly [number, number] | null): { placed: Placed[]; width: number; height: number } {
  const area = sizes.reduce((s, [w, h]) => s + (w + gap) * (h + gap), 0)
  const widest = Math.max(0, ...sizes.map(([w]) => w))
  const W = sheet ? sheet[0] : Math.max(widest, Math.sqrt(area) * 1.2)
  const H = sheet ? sheet[1] : Infinity
  const items = sizes.map(([w, h], index) => {
    const turn = sheet ? w > W + 1e-9 && h <= W + 1e-9 : false
    return { index, turned: turn, w: turn ? h : w, h: turn ? w : h }
  })
  items.sort((a, b) => b.h - a.h || b.w - a.w)
  const placed: Placed[] = []
  let sheetNo = 1
  let x = 0
  let y = 0
  let rowH = 0
  let maxX = 0
  let maxY = 0
  const sheetDx = () => (sheetNo - 1) * (W + 4 * gap)
  for (const it of items) {
    if (x > 0 && x + it.w > W + 1e-9) {
      x = 0
      y += rowH + gap
      rowH = 0
    }
    if (y > 0 && y + it.h > H + 1e-9) {
      sheetNo += 1
      x = 0
      y = 0
      rowH = 0
    }
    placed.push({ index: it.index, turned: it.turned, at: [r4(sheetDx() + x), r4(y)], sheet: sheetNo })
    maxX = Math.max(maxX, sheetDx() + x + it.w)
    maxY = Math.max(maxY, y + it.h)
    x += it.w + gap
    rowH = Math.max(rowH, it.h)
  }
  placed.sort((a, b) => a.index - b.index)
  return { placed, width: r4(maxX), height: r4(maxY) }
}

// ---- moving pieces -----------------------------------------------------------------------------

/** A rigid move on the sheet: a quarter turn or none about the origin,
 *  then a shift. */
export interface Move {
  turned: boolean
  shift: Pt
}

export const movePt = (p: Pt, m: Move): Pt => (m.turned ? [-p[1] + m.shift[0], p[0] + m.shift[1]] : [p[0] + m.shift[0], p[1] + m.shift[1]])

export function movePiece(p: Piece, m: Move): Piece {
  const dA = m.turned ? Math.PI / 2 : 0
  switch (p.kind) {
    case 'line':
      return { kind: 'line', a: movePt(p.a, m), b: movePt(p.b, m) }
    case 'arc':
      return { ...p, center: movePt(p.center, m), a: movePt(p.a, m), b: movePt(p.b, m), start: p.start + dA }
    case 'circle':
      return { ...p, center: movePt(p.center, m) }
    case 'curve':
      return { kind: 'curve', points: p.points.map((q) => movePt(q, m)), a: movePt(p.a, m), b: movePt(p.b, m) }
  }
}

/** The move that puts a part's box (as turned) with its lower-left at `at`. */
export function moveTo(box: Box2, turned: boolean, at: Pt): Move {
  // A quarter turn takes (x, y) to (−y, x): the box's lower-left becomes
  // (−max y, min x).
  const ll: Pt = turned ? [-box.max[1], box.min[0]] : box.min
  return { turned, shift: [at[0] - ll[0], at[1] - ll[1]] }
}
