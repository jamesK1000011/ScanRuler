// SPDX-License-Identifier: AGPL-3.0-only
// Mass properties of a printed part from its closed triangle mesh: volume,
// surface, mass, centre of mass and inertia — for a solid part, or for one
// printed as walls round a sparse infill — and the ballast that brings a
// part to a target mass and balance point. The volume integrals are
// Eberly's (Polyhedral Mass Properties, 2002), over the signed tetrahedra
// each face makes with the origin; the walls are a thin layer on the
// surface, integrated over its triangles.

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

/** Read a binary (or ASCII) STL into a flat list of triangles, mm. */
export function readStl(bytes: Uint8Array): Float64Array {
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 512)))
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 84) {
    const n = dv.getUint32(80, true)
    if (84 + n * 50 === bytes.length) {
      const out = new Float64Array(n * 9)
      for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true)
      return out
    }
  }
  if (!/^\s*solid/.test(head)) throw new Error('Not an STL file.')
  const nums = [...new TextDecoder().decode(bytes).matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap((m) => [Number(m[1]), Number(m[2]), Number(m[3])])
  if (!nums.length || nums.length % 9 !== 0) throw new Error('The STL holds no whole triangles.')
  return Float64Array.from(nums)
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
  /** Whether the mesh closes on itself (a volume to trust). */
  closed: boolean
}

/** Mass properties as printed: walls of wallMm on the surface at full
 *  density, the inside at the infill's share of it — the walls taken as a
 *  thin layer of the surface's integrals, so the inside is the solid less
 *  them. Densities g/cm³, lengths mm. */
export function massOf(tris: ArrayLike<number>, print: Print): MassProps {
  let V = volumeIntegrals(tris)
  // Faces wound inward give a negative volume: the same part, inside out.
  if (V.v < 0) V = { v: -V.v, m1: V.m1.map((x) => -x) as V3, m2: V.m2.map((x) => -x) as VolumeIntegrals['m2'] }
  const S = surfaceIntegrals(tris)
  const rho = print.density / 1000 // g/mm³
  const f = Math.min(1, Math.max(0, print.infill))
  const t = Math.max(0, print.wallMm)
  // The walls cannot hold more than the part: past that it is solid.
  const shellShare = Math.min(1, (S.a * t) / Math.max(V.v, 1e-12))
  const k = shellShare < 1 ? t : V.v / Math.max(S.a, 1e-12)
  // Moments: walls (density ρ) + inside (ρ f) = ρ f · solid + ρ (1 − f) · walls.
  const m0 = rho * (f * V.v + (1 - f) * k * S.a)
  const m1 = [0, 1, 2].map((i) => rho * (f * V.m1[i] + (1 - f) * k * S.m1[i])) as V3
  const m2 = [0, 1, 2, 3, 4, 5].map((i) => rho * (f * V.m2[i] + (1 - f) * k * S.m2[i]))
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

/** Whether every edge of the mesh is shared by exactly two triangles, by
 *  their corners' places to a micron. */
export function closedMesh(tris: ArrayLike<number>): boolean {
  const key = (i: number) => `${Math.round(tris[i] * 1000)},${Math.round(tris[i + 1] * 1000)},${Math.round(tris[i + 2] * 1000)}`
  const edges = new Map<string, number>()
  for (let t = 0; t < tris.length; t += 9) {
    const v = [key(t), key(t + 3), key(t + 6)]
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3]
      const e = a < b ? `${a}|${b}` : `${b}|${a}`
      edges.set(e, (edges.get(e) ?? 0) + 1)
    }
  }
  for (const n of edges.values()) if (n !== 2) return false
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
 *    m + V (ρf − ρp) = M        (the mass), and
 *    m c + V (ρf − ρp) p = M C  (the balance point),
 *  ρp the part's density where the pocket is cut (its infill), ρf the
 *  filler's as packed. Returns what the pocket must be, and why not where
 *  it cannot be. */
export function ballast(part: { mass: number; com: V3 }, target: { mass?: number; com?: V3 }, fill: { density: number }, partDensityThere: number) {
  const gain = (fill.density - partDensityThere) / 1000 // g/mm³ per mm³ of pocket
  if (!(gain > 0)) return { ok: false as const, why: 'The filler is no denser than the part where the pocket goes: it can add no mass.' }
  const M = target.mass ?? part.mass
  const add = M - part.mass
  if (!(add > 0)) return { ok: false as const, why: target.mass !== undefined ? `The part is already ${part.mass.toFixed(1)} g, at or over the ${M} g wanted: ballast only adds.` : 'Give the mass wanted, or a balance point with more mass than the part has.' }
  const volume = add / gain
  const C = target.com ?? part.com
  const at: V3 = [0, 1, 2].map((i) => (M * C[i] - part.mass * part.com[i]) / add) as V3
  return { ok: true as const, volume, at, fillerMass: (volume * fill.density) / 1000, removedMass: (volume * partDensityThere) / 1000 }
}

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

/** Printed materials' densities, g/cm³ (typical, from makers' datasheets). */
export const MATERIALS: Record<string, { label: string; density: number }> = {
  pla: { label: 'PLA', density: 1.24 },
  petg: { label: 'PETG', density: 1.27 },
  abs: { label: 'ABS', density: 1.04 },
  asa: { label: 'ASA', density: 1.07 },
  'petg-cf': { label: 'PETG-CF', density: 1.3 },
  'pa6-cf': { label: 'PA6-CF', density: 1.17 },
  tpu: { label: 'TPU', density: 1.21 },
}

/** Fillers as packed into a pocket: the bulk density, g/cm³. Spheres pack
 *  randomly to about 62 %; putty fills the pocket whole. */
export const FILLERS: Record<string, { label: string; density: number; note: string }> = {
  'steel-bb': { label: 'Steel BBs (4.5 mm)', density: 7.85 * 0.62, note: 'Loose; seal the lid. 4.5 mm BBs weigh about 0.35 g each.' },
  'lead-shot': { label: 'Lead shot', density: 11.34 * 0.62, note: 'Toxic to handle; seal it in.' },
  'tungsten-putty': { label: 'Tungsten putty', density: 10, note: 'Fills the pocket whole; mould it in.' },
  'tungsten-cubes': { label: 'Tungsten cubes', density: 19.25 * 0.95, note: 'Pack the pocket to the cubes’ size.' },
  'steel-slug': { label: 'Steel slug or rod', density: 7.85, note: 'Cut to fill the pocket.' },
  epoxy: { label: 'Epoxy (cast)', density: 1.15, note: 'Barely heavier than the part.' },
}
