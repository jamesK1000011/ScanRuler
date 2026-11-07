// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic scanned threads: points on a helical thread's surface about the
// Z axis, with the scan's scatter and its rounding of crests and roots.

export interface SynthThread {
  major: number
  pitch: number
  /** Included flank angle, degrees. */
  angle: number
  /** Profile depth as a share of the pitch. */
  depthShare: number
  internal?: boolean
  leftHanded?: boolean
  starts?: number
  /** Diameter change per mm along +Z. */
  taper?: number
  length: number
  noise: number
  /** How wide the scan's rounding is, mm. */
  blur?: number
  points?: number
  seed?: number
}

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

export function synthThread(t: SynthThread): { points: Float32Array; normals: Float32Array; radius: number } {
  const rand = rng(t.seed ?? 7)
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand())
  const P = t.pitch
  const h = t.depthShare * P
  const wf = Math.min(0.49 * P, h * Math.tan(((t.angle / 2) * Math.PI) / 180))
  const flat = (P - 2 * wf) / 2
  // Height of the material above the root, 0 to h, at phase u in [0, P):
  // root flat, rising flank, crest flat, falling flank.
  const tooth = (u: number) => {
    const x = ((u % P) + P) % P
    if (x < flat) return 0
    if (x < flat + wf) return ((x - flat) / wf) * h
    if (x < 2 * flat + wf) return h
    return h - ((x - 2 * flat - wf) / wf) * h
  }
  const blur = t.blur ?? 0
  const smooth = (u: number) => {
    if (blur <= 0) return tooth(u)
    let s = 0
    for (let k = -3; k <= 3; k++) s += tooth(u + (k / 6) * blur)
    return s / 7
  }
  const lead = (t.starts ?? 1) * P
  const sign = t.leftHanded ? -1 : 1
  const n = t.points ?? 15000
  const points = new Float32Array(3 * n), normals = new Float32Array(3 * n)
  const rRoot = t.internal ? t.major / 2 : t.major / 2 - h
  for (let i = 0; i < n; i++) {
    const th = (rand() * 2 - 1) * Math.PI
    const z = (rand() - 0.5) * t.length
    const u = z - (sign * lead * th) / (2 * Math.PI)
    // A bolt's material stands out from its root; a nut's wall reaches in
    // from its root, the major diameter.
    const f = smooth(u)
    let r = t.internal ? rRoot - f : rRoot + f
    r += ((t.taper ?? 0) / 2) * z
    const df = (smooth(u + 1e-3) - smooth(u - 1e-3)) / 2e-3
    // The normal in the (radial, axial) plane, out of the material.
    let nr = 1, nz = t.internal ? df : -df
    const l = Math.hypot(nr, nz)
    nr /= l
    nz /= l
    if (t.internal) {
      nr = -nr
      nz = -nz
    }
    r += gauss() * t.noise
    const c = Math.cos(th), s = Math.sin(th)
    points.set([r * c, r * s, z], 3 * i)
    normals.set([nr * c, nr * s, nz], 3 * i)
  }
  return { points, normals, radius: t.internal ? t.major / 2 - h / 2 : t.major / 2 - h / 2 }
}
