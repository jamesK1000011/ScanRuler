// SPDX-License-Identifier: AGPL-3.0-only
// Mass properties of a printed part from its closed triangle mesh: volume,
// surface, mass, centre of mass and inertia — for a solid part, or for one
// printed as walls round a sparse infill — and the ballast that brings a
// part to a target mass and balance point. The volume integrals are
// Eberly's (Polyhedral Mass Properties, 2002), over the signed tetrahedra
// each face makes with the origin; the walls are a layer inside the
// surface, each face's slab with the overlaps and gaps at its edges.

import { MATERIALS as SHARED_MATERIALS } from '../../_shared/materials'

export type V3 = [number, number, number]
/** Inertia tensor, row by row, kg·mm² (or g·mm² — the mass's unit ×mm²). */
export type M3 = [V3, V3, V3]

/** The integrals a solid's mass properties come from: ∫1, ∫x, ∫y, ∫z,
 *  ∫x², ∫y², ∫z², ∫xy, ∫yz, ∫zx over the volume (mm³ … mm⁵). */
export interface VolumeIntegrals {
  v: number
  m1: V3
  m2: [number, number, number, number, number, number]
}

/** The same over the surface (mm² … mm⁴), for the walls. */
export interface SurfaceIntegrals {
  a: number
  m1: V3
  m2: [number, number, number, number, number, number]
}

/** Read a binary (or ASCII) STL into a flat list of triangles, mm. A
 *  binary file may begin "solid" too, and some writers pad its end. */
export function readStl(bytes: Uint8Array): Float64Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const binary = (): Float64Array | null => {
    if (bytes.length < 84) return null
    const n = dv.getUint32(80, true)
    if (84 + n * 50 > bytes.length || bytes.length - (84 + n * 50) >= 50) return null
    const out = new Float64Array(n * 9)
    for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true)
    return out
  }
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 512)))
  let out: Float64Array | null = null
  if (/^\s*solid/.test(head)) {
    const nums = [...new TextDecoder().decode(bytes).matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap((m) => [Number(m[1]), Number(m[2]), Number(m[3])])
    if (nums.length && nums.length % 9 === 0) out = Float64Array.from(nums)
  }
  out ??= binary()
  if (!out) throw new Error(/^\s*solid/.test(head) ? 'The STL holds no whole triangles.' : 'Not an STL file.')
  if (!out.every(Number.isFinite)) throw new Error('The STL has a corner that is not a number.')
  return out
}

/** Eberly's subexpressions for one coordinate of a triangle. */
function sub(w0: number, w1: number, w2: number) {
  const t0 = w0 + w1
  const f1 = t0 + w2
  const t1 = w0 * w0
  const t2 = t1 + w1 * t0
  const f2 = t2 + w2 * f1
  const f3 = w0 * t1 + w1 * t2 + w2 * f2
  return { f1, f2, f3, g0: f2 + w0 * (f1 + w0), g1: f2 + w1 * (f1 + w1), g2: f2 + w2 * (f1 + w2) }
}

export function volumeIntegrals(tris: ArrayLike<number>): VolumeIntegrals {
  let i1 = 0, ix = 0, iy = 0, iz = 0, ixx = 0, iyy = 0, izz = 0, ixy = 0, iyz = 0, izx = 0
  for (let t = 0; t < tris.length; t += 9) {
    const x0 = tris[t], y0 = tris[t + 1], z0 = tris[t + 2]
    const x1 = tris[t + 3], y1 = tris[t + 4], z1 = tris[t + 5]
    const x2 = tris[t + 6], y2 = tris[t + 7], z2 = tris[t + 8]
    const a1 = x1 - x0, b1 = y1 - y0, c1 = z1 - z0
    const a2 = x2 - x0, b2 = y2 - y0, c2 = z2 - z0
    const d0 = b1 * c2 - b2 * c1, d1 = a2 * c1 - a1 * c2, d2 = a1 * b2 - a2 * b1
    const X = sub(x0, x1, x2), Y = sub(y0, y1, y2), Z = sub(z0, z1, z2)
    i1 += d0 * X.f1
    ix += d0 * X.f2
    iy += d1 * Y.f2
    iz += d2 * Z.f2
    ixx += d0 * X.f3
    iyy += d1 * Y.f3
    izz += d2 * Z.f3
    ixy += d0 * (y0 * X.g0 + y1 * X.g1 + y2 * X.g2)
    iyz += d1 * (z0 * Y.g0 + z1 * Y.g1 + z2 * Y.g2)
    izx += d2 * (x0 * Z.g0 + x1 * Z.g1 + x2 * Z.g2)
  }
  return { v: i1 / 6, m1: [ix / 24, iy / 24, iz / 24], m2: [ixx / 60, iyy / 60, izz / 60, ixy / 120, iyz / 120, izx / 120] }
}

export function surfaceIntegrals(tris: ArrayLike<number>): SurfaceIntegrals {
  let a = 0
  const m1: V3 = [0, 0, 0]
  const m2: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0]
  for (let t = 0; t < tris.length; t += 9) {
    const p = [0, 1, 2].map((k) => [tris[t + k * 3], tris[t + k * 3 + 1], tris[t + k * 3 + 2]])
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]]
    const w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]
    const A = 0.5 * Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
    if (!(A > 0)) continue
    const s = [0, 1, 2].map((i) => p[0][i] + p[1][i] + p[2][i])
    a += A
    for (let i = 0; i < 3; i++) m1[i] += (A * s[i]) / 3
    // ∫ xi xj dA over a triangle = A/12 · (Σk pk,i pk,j + si sj)
    const pair = (i: number, j: number) => (A / 12) * (p[0][i] * p[0][j] + p[1][i] * p[1][j] + p[2][i] * p[2][j] + s[i] * s[j])
    m2[0] += pair(0, 0)
    m2[1] += pair(1, 1)
    m2[2] += pair(2, 2)
    m2[3] += pair(0, 1)
    m2[4] += pair(1, 2)
    m2[5] += pair(2, 0)
  }
  return { a, m1, m2 }
}

export interface Print {
  /** g/cm³. */
  density: number
  /** Infill, 0…1 (1: solid). */
  infill: number
  /** The walls' thickness, mm: walls × line width (0 for solid). */
  wallMm: number
}

export interface MassProps {
  volume: number
  area: number
  /** g. */
  mass: number
  /** mm. */
  com: V3
  /** About the centre of mass, g·mm². */
  inertia: M3
  /** Principal moments, g·mm², smallest first, and their axes. */
  principal: { moments: V3; axes: [V3, V3, V3] }
  /** Whether the mesh closes on itself, every face wound the same way (a
   *  volume to trust). */
  closed: boolean
}

type M6 = [number, number, number, number, number, number]
const PAIRS: [number, number][] = [[0, 0], [1, 1], [2, 2], [0, 1], [1, 2], [2, 0]]

/** A corner's place to a micron, as a key. */
const keyAt = (tris: ArrayLike<number>, i: number) => `${Math.round(tris[i] * 1000)},${Math.round(tris[i + 1] * 1000)},${Math.round(tris[i + 2] * 1000)}`

/** The walls' volume integrals: a layer t thick inside the surface, each
 *  face's slab taken inward along its normal, less the slabs' overlap
 *  along a convex edge (t² tan(θ/2) a millimetre, θ the turn between the
 *  faces) and plus the gap along a concave one (the same) — so a box's walls
 *  come out to the second order in t, and a smooth part's to its mean
 *  curvature — and at each corner Steiner's t³ term. `outward` is +1 when the faces are wound outward, −1 when
 *  inward. k2 is the t² coefficient of the volume. */
export function shellIntegrals(tris: ArrayLike<number>, t: number, outward = 1): VolumeIntegrals & { k2: number } {
  let v = 0, k2 = 0
  const m1: V3 = [0, 0, 0]
  const m2: M6 = [0, 0, 0, 0, 0, 0]
  const normals: V3[] = []
  const edges = new Map<string, { faces: number[]; a: V3; b: V3; far: V3[] }>()
  const corners = new Map<string, { at: V3; angle: number; n: V3 }>()
  for (let f = 0, ti = 0; ti + 8 < tris.length; f++, ti += 9) {
    const p = [0, 1, 2].map((k) => [tris[ti + k * 3], tris[ti + k * 3 + 1], tris[ti + k * 3 + 2]] as V3)
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]]
    const w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]
    const cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    const len = Math.hypot(cr[0], cr[1], cr[2])
    const n = (len > 0 ? cr.map((x) => (outward * x) / len) : [0, 0, 0]) as V3
    normals.push(n)
    if (!(len > 0)) continue
    const A = len / 2
    const s = [0, 1, 2].map((i) => p[0][i] + p[1][i] + p[2][i])
    const f1 = s.map((x) => (A * x) / 3)
    v += A * t
    for (let i = 0; i < 3; i++) m1[i] += t * f1[i] - ((t * t) / 2) * A * n[i]
    PAIRS.forEach(([i, j], q) => {
      const F2 = (A / 12) * (p[0][i] * p[0][j] + p[1][i] * p[1][j] + p[2][i] * p[2][j] + s[i] * s[j])
      m2[q] += t * F2 - ((t * t) / 2) * (n[i] * f1[j] + n[j] * f1[i]) + ((t * t * t) / 3) * A * n[i] * n[j]
    })
    const keys = [keyAt(tris, ti), keyAt(tris, ti + 3), keyAt(tris, ti + 6)]
    for (let k = 0; k < 3; k++) {
      // The face's angle at each corner, for the corners' own term.
      const o = p[k], e1 = p[(k + 1) % 3].map((x, i) => x - o[i]), e2 = p[(k + 2) % 3].map((x, i) => x - o[i])
      const ang = Math.acos(Math.max(-1, Math.min(1, (e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]) / (Math.hypot(e1[0], e1[1], e1[2]) * Math.hypot(e2[0], e2[1], e2[2]) || 1))))
      const c = corners.get(keys[k]) ?? { at: o, angle: 0, n: [0, 0, 0] as V3 }
      c.angle += ang
      for (let i = 0; i < 3; i++) c.n[i] += ang * n[i]
      corners.set(keys[k], c)
    }
    for (let k = 0; k < 3; k++) {
      const a = keys[k], b = keys[(k + 1) % 3]
      if (a === b) continue
      const e = a < b ? `${a}|${b}` : `${b}|${a}`
      const row = edges.get(e) ?? { faces: [], a: p[k], b: p[(k + 1) % 3], far: [] }
      row.faces.push(f)
      row.far.push(p[(k + 2) % 3])
      edges.set(e, row)
    }
  }
  for (const { faces, a, b, far } of edges.values()) {
    if (faces.length !== 2) continue
    const [n1, n2] = [normals[faces[0]], normals[faces[1]]]
    const th = Math.acos(Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2])))
    if (!(th > 1e-6)) continue
    // Convex where the second face's far corner lies behind the first's plane.
    const q = far[1]
    const convex = (q[0] - a[0]) * n1[0] + (q[1] - a[1]) * n1[1] + (q[2] - a[2]) * n1[2] < 0
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    // Mitred, as a slicer offsets its walls; a knife edge's mitre is cut
    // short, at four t² a millimetre.
    const c = (convex ? -1 : 1) * Math.min(Math.tan(th / 2), 4)
    k2 += c * L
    const dv = c * L * t * t
    // Along the edge, at the middle of the rhombus the two slabs share:
    // half way to the mitre's inner corner, t / cos(θ/2) in.
    const bis = [n1[0] + n2[0], n1[1] + n2[1], n1[2] + n2[2]]
    const bl = Math.hypot(bis[0], bis[1], bis[2])
    const sh = bl > 1e-9 ? bis.map((x) => (-x / bl) * Math.min(t / (2 * Math.cos(th / 2)), 2 * t)) : [0, 0, 0]
    const A2 = [a[0] + sh[0], a[1] + sh[1], a[2] + sh[2]]
    const B2 = [b[0] + sh[0], b[1] + sh[1], b[2] + sh[2]]
    v += dv
    for (let i = 0; i < 3; i++) m1[i] += (dv * (A2[i] + B2[i])) / 2
    PAIRS.forEach(([i, j], qq) => (m2[qq] += dv * ((A2[i] * A2[j] + B2[i] * B2[j]) / 3 + (A2[i] * B2[j] + B2[i] * A2[j]) / 6)))
  }
  // At a corner the surface turns by its angle deficit (2π less the faces'
  // angles there): t³/3 of it — Steiner's term, exact for a smooth part,
  // half a box corner's t³.
  for (const { at, angle, n } of corners.values()) {
    const d = 2 * Math.PI - angle
    if (!(Math.abs(d) > 1e-9)) continue
    const nl = Math.hypot(n[0], n[1], n[2])
    const P3 = nl > 1e-12 ? at.map((x, i) => x - (n[i] / nl) * t * (Math.sqrt(3) / 2)) : at
    const dv = (d * t * t * t) / 3
    v += dv
    for (let i = 0; i < 3; i++) m1[i] += dv * P3[i]
    PAIRS.forEach(([i, j], q) => (m2[q] += dv * P3[i] * P3[j]))
  }
  return { v, m1, m2, k2 }
}

/** Mass properties as printed: walls of wallMm inside the surface at full
 *  density, the inside at the infill's share of it — so the part is the
 *  solid at the infill's density plus the walls at the rest. Walls thick
 *  enough to fill the part make it solid. Densities g/cm³, lengths mm. */
export function massOf(tris: ArrayLike<number>, print: Print): MassProps {
  let V = volumeIntegrals(tris)
  // Faces wound inward give a negative volume: the same part, inside out.
  const outward = V.v < 0 ? -1 : 1
  if (outward < 0) V = { v: -V.v, m1: V.m1.map((x) => -x) as V3, m2: V.m2.map((x) => -x) as M6 }
  const S = surfaceIntegrals(tris)
  const rho = print.density / 1000 // g/mm³
  const f = Math.min(1, Math.max(0, print.infill))
  const t = Math.max(0, print.wallMm)
  let W: VolumeIntegrals = { v: 0, m1: [0, 0, 0], m2: [0, 0, 0, 0, 0, 0] }
  if (t > 0 && f < 1) {
    const sh = shellIntegrals(tris, t, outward)
    // The walls cannot hold more than the part, nor thin as they thicken:
    // past either, the part is solid.
    W = sh.v >= V.v || !(S.a + 2 * sh.k2 * t > 0) ? V : sh
  }
  const m0 = rho * (f * V.v + (1 - f) * W.v)
  const m1 = [0, 1, 2].map((i) => rho * (f * V.m1[i] + (1 - f) * W.m1[i])) as V3
  const m2 = [0, 1, 2, 3, 4, 5].map((i) => rho * (f * V.m2[i] + (1 - f) * W.m2[i]))
  const com: V3 = m0 > 0 ? [m1[0] / m0, m1[1] / m0, m1[2] / m0] : [0, 0, 0]
  const [xx, yy, zz, xy, yz, zx] = m2
  // About the origin, then to the centre of mass (parallel axes).
  const Ixx = yy + zz - m0 * (com[1] ** 2 + com[2] ** 2)
  const Iyy = xx + zz - m0 * (com[0] ** 2 + com[2] ** 2)
  const Izz = xx + yy - m0 * (com[0] ** 2 + com[1] ** 2)
  const Ixy = -(xy - m0 * com[0] * com[1])
  const Iyz = -(yz - m0 * com[1] * com[2])
  const Izx = -(zx - m0 * com[2] * com[0])
  const inertia: M3 = [
    [Ixx, Ixy, Izx],
    [Ixy, Iyy, Iyz],
    [Izx, Iyz, Izz],
  ]
  return { volume: V.v, area: S.a, mass: m0, com, inertia, principal: eigen(inertia), closed: closedMesh(tris) }
}

/** Whether the mesh closes on itself: every edge, by its corners' places
 *  to a micron, run once each way by the two triangles either side of it
 *  (which also means every face is wound the same way). A triangle with a
 *  corner twice is left out. */
export function closedMesh(tris: ArrayLike<number>): boolean {
  const edges = new Map<string, number>()
  for (let t = 0; t + 8 < tris.length; t += 9) {
    const v = [keyAt(tris, t), keyAt(tris, t + 3), keyAt(tris, t + 6)]
    if (v[0] === v[1] || v[1] === v[2] || v[2] === v[0]) continue
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3]
      // +1 for a → b, +1000 for b → a, by the pair in order.
      const e = a < b ? `${a}|${b}` : `${b}|${a}`
      edges.set(e, (edges.get(e) ?? 0) + (a < b ? 1 : 1000))
    }
  }
  for (const n of edges.values()) if (n !== 1001) return false
  return edges.size > 0
}

/** Eigenvalues and vectors of a symmetric 3×3 (Jacobi), smallest first. */
export function eigen(m: M3): { moments: V3; axes: [V3, V3, V3] } {
  const a = m.map((r) => [...r])
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2])
    if (off < 1e-12 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + 1e-300)) break
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(a[p][q]) < 1e-300) continue
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q])
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1))
      const c = 1 / Math.sqrt(t * t + 1)
      const s = t * c
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q]
        a[k][p] = c * akp - s * akq
        a[k][q] = s * akp + c * akq
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k]
        a[p][k] = c * apk - s * aqk
        a[q][k] = s * apk + c * aqk
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q]
        v[k][p] = c * vkp - s * vkq
        v[k][q] = s * vkp + c * vkq
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j])
  return { moments: order.map((i) => a[i][i]) as V3, axes: order.map((i) => [v[0][i], v[1][i], v[2][i]] as V3) as [V3, V3, V3] }
}

/** Parts together: total mass, the common centre and the inertia about it. */
export function combine(parts: { mass: number; com: V3; inertia: M3 }[]): { mass: number; com: V3; inertia: M3 } {
  const mass = parts.reduce((s, p) => s + p.mass, 0)
  const com: V3 = [0, 1, 2].map((i) => (mass > 0 ? parts.reduce((s, p) => s + p.mass * p.com[i], 0) / mass : 0)) as V3
  const I: M3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (const p of parts) {
    const d = [p.com[0] - com[0], p.com[1] - com[1], p.com[2] - com[2]]
    const d2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i][j] += p.inertia[i][j] + p.mass * ((i === j ? d2 : 0) - d[i] * d[j])
  }
  return { mass, com, inertia: I }
}

/** Ballast to bring a part to a target mass and balance point: a pocket
 *  cut into the part at the point that balances it, filled with a denser
 *  filler. The pocket's volume V and centre p solve
 *    m + V (ρf − ρp) + w(V) = M        (the mass), and
 *    m c + (V (ρf − ρp) + w(V)) p = M C (the balance point),
 *  ρp the part's density where the pocket is cut (its infill), ρf the
 *  filler's as packed, w the walls the slicer lays round the pocket, at
 *  the rest of the material's density (none given, none counted). Returns
 *  what the pocket must be, and why not where it cannot be. */
export function ballast(part: { mass: number; com: V3 }, target: { mass?: number; com?: V3 }, fill: { density: number }, partDensityThere: number, walls?: { density: number; area(volume: number): number; edge?(volume: number): number; t: number }) {
  const gain = (fill.density - partDensityThere) / 1000 // g/mm³ per mm³ of pocket
  if (!(gain > 0)) return { ok: false as const, why: 'The filler is no denser than the part where the pocket goes: it can add no mass.' }
  const M = target.mass ?? part.mass
  const add = M - part.mass
  if (!(add > 0))
    return {
      ok: false as const,
      why: target.mass !== undefined ? `The part is already ${part.mass.toFixed(1)} g, at or over the ${M} g wanted: ballast only adds.` : 'Ballast adds mass, so a balance point alone cannot be reached: give the mass wanted too.',
    }
  // The pocket's own walls, g, for a pocket of volume v: its faces' slabs
  // and, mitred, t² a millimetre along each square edge.
  const wallMass = (v: number) => (walls && walls.t > 0 ? (walls.density / 1000) * (walls.area(v) * walls.t + (walls.edge?.(v) ?? 0) * walls.t * walls.t) : 0)
  if (wallMass(0) >= add) return { ok: false as const, why: 'The walls round even the smallest pocket would add more than is wanted.' }
  // Mass gained rises with the volume: halve the interval.
  let lo = 0, hi = add / gain
  for (let i = 0; i < 100 && hi - lo > 1e-9 * hi; i++) {
    const mid = (lo + hi) / 2
    if (mid * gain + wallMass(mid) < add) lo = mid
    else hi = mid
  }
  const volume = (lo + hi) / 2
  const C = target.com ?? part.com
  const at: V3 = [0, 1, 2].map((i) => (M * C[i] - part.mass * part.com[i]) / add) as V3
  return { ok: true as const, volume, at, fillerMass: (volume * fill.density) / 1000, removedMass: (volume * partDensityThere) / 1000, wallMass: wallMass(volume) }
}

/** A pocket's size for a volume: as given, or a cube; with a width or a
 *  depth, the other two sides alike; with both, the height follows. */
export function pocketSize(volume: number, w?: number, d?: number): V3 {
  if (w && d) return [w, d, volume / (w * d)]
  if (w) return [w, Math.sqrt(volume / w), Math.sqrt(volume / w)]
  if (d) return [Math.sqrt(volume / d), d, Math.sqrt(volume / d)]
  const s = Math.cbrt(volume)
  return [s, s, s]
}

/** Whether a box lies wholly inside a closed mesh: its centre inside, and
 *  no triangle meeting it. */
export function boxInside(tris: ArrayLike<number>, min: V3, max: V3): boolean {
  const c: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const h: V3 = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2]
  for (let t = 0; t + 8 < tris.length; t += 9) if (triMeetsBox(tris, t, c, h)) return false
  return inside(tris, c)
}

/** Whether a triangle meets a box (centre c, half sizes h): the separating
 *  axis test — the box's axes, the triangle's normal, and the nine cross
 *  products of their edges. */
export function triMeetsBox(tris: ArrayLike<number>, t: number, c: V3, h: V3): boolean {
  const v = [0, 1, 2].map((k) => [tris[t + k * 3] - c[0], tris[t + k * 3 + 1] - c[1], tris[t + k * 3 + 2] - c[2]])
  for (let i = 0; i < 3; i++) if (Math.min(v[0][i], v[1][i], v[2][i]) > h[i] || Math.max(v[0][i], v[1][i], v[2][i]) < -h[i]) return false
  const e = [0, 1, 2].map((k) => [0, 1, 2].map((i) => v[(k + 1) % 3][i] - v[k][i]))
  const axes: number[][] = []
  for (const ed of e) for (const u of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) axes.push([ed[1] * u[2] - ed[2] * u[1], ed[2] * u[0] - ed[0] * u[2], ed[0] * u[1] - ed[1] * u[0]])
  axes.push([e[0][1] * e[1][2] - e[0][2] * e[1][1], e[0][2] * e[1][0] - e[0][0] * e[1][2], e[0][0] * e[1][1] - e[0][1] * e[1][0]])
  for (const a of axes) {
    if (Math.abs(a[0]) + Math.abs(a[1]) + Math.abs(a[2]) < 1e-12) continue
    const p = v.map((x) => x[0] * a[0] + x[1] * a[1] + x[2] * a[2])
    const r = h[0] * Math.abs(a[0]) + h[1] * Math.abs(a[1]) + h[2] * Math.abs(a[2])
    if (Math.min(...p) > r || Math.max(...p) < -r) return false
  }
  return true
}

/** A name not taken (case aside), with each of the endings after it: the
 *  one wanted, else with 2, 3 … after it. */
export function freeName(want: string, taken: Iterable<string>, endings: readonly string[] = ['']): string {
  const t = new Set([...taken].map((n) => n.toLowerCase()))
  let out = want
  for (let n = 2; endings.some((e) => t.has(`${out}${e}`.toLowerCase())); n++) out = `${want} ${n}`
  return out
}

/** A 4.5 mm steel BB, g: 4/3 π 2.25³ mm³ of steel at 7.85 g/cm³. */
export const BB_GRAMS = ((4 / 3) * Math.PI * 2.25 ** 3 * 7.85) / 1000

/** A point's place in a closed mesh: inside when a ray from it crosses the
 *  surface an odd number of times (three rays, the majority). */
export function inside(tris: ArrayLike<number>, p: V3): boolean {
  const dirs: V3[] = [
    [0.5773, 0.5774, 0.5774],
    [-0.7071, 0.0101, 0.7070],
    [0.1, -0.995, 0.01],
  ]
  let votes = 0
  for (const d of dirs) {
    let hits = 0
    for (let t = 0; t < tris.length; t += 9) if (rayHits(tris, t, p, d)) hits++
    if (hits % 2 === 1) votes++
  }
  return votes >= 2
}

function rayHits(tris: ArrayLike<number>, t: number, o: V3, d: V3): boolean {
  const e1 = [tris[t + 3] - tris[t], tris[t + 4] - tris[t + 1], tris[t + 5] - tris[t + 2]]
  const e2 = [tris[t + 6] - tris[t], tris[t + 7] - tris[t + 1], tris[t + 8] - tris[t + 2]]
  const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]]
  const a = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2]
  if (Math.abs(a) < 1e-12) return false
  const f = 1 / a
  const s = [o[0] - tris[t], o[1] - tris[t + 1], o[2] - tris[t + 2]]
  const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2])
  if (u < 0 || u > 1) return false
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]]
  const v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2])
  if (v < 0 || u + v > 1) return false
  return f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) > 1e-9
}

/** Printed materials' densities, g/cm³: the table every workspace shares
 *  (plugins/_shared/materials/), by id. */
export const MATERIALS: Readonly<Record<string, { label: string; density: number }>> = SHARED_MATERIALS

/** Fillers as packed into a pocket: the bulk density, g/cm³. Spheres pack
 *  randomly to about 62 %; putty fills the pocket whole. */
export const FILLERS: Record<string, { label: string; density: number; note: string; /** The smallest pocket side it packs into, mm. */ grain?: number }> = {
  'steel-bb': { label: 'Steel BBs (4.5 mm)', density: 7.85 * 0.62, note: 'Loose; seal the lid. 4.5 mm BBs weigh about 0.37 g each.', grain: 4.5 }, // units-ok: the BBs' size as sold.
  'lead-shot': { label: 'Lead shot', density: 11.34 * 0.62, note: 'Toxic to handle; seal it in.' },
  'tungsten-putty': { label: 'Tungsten putty', density: 10, note: 'Fills the pocket whole; mould it in.' },
  'tungsten-cubes': { label: 'Tungsten cubes', density: 19.25 * 0.95, note: 'Pack the pocket to the cubes’ size.' },
  'steel-slug': { label: 'Steel slug or rod', density: 7.85, note: 'Cut to fill the pocket.' },
  epoxy: { label: 'Epoxy (cast)', density: 1.15, note: 'Barely heavier than the part.' },
}
