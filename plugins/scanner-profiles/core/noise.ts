// SPDX-License-Identifier: AGPL-3.0-only
// How noisy a scan is, read off the scan itself: each vertex's distance
// along its normal from the centre of its neighbours, on flat ground only
// (where the neighbours' normals agree), taken robustly (1.4826 × the
// median) and corrected for the neighbours' own noise. Curvature adds a
// little on a fine mesh; the flat-only filter keeps edges out.

export interface MeshIn {
  positions: Float32Array
  indices: Uint32Array
  normals: Float32Array
}

export interface Noise {
  /** One standard deviation of the surface noise, mm. */
  sigmaMm: number
  /** Median distance between neighbouring vertices, mm. */
  spacingMm: number
  sampled: number
  flat: number
}

export function measureNoise(m: MeshIn, opts: { maxSamples?: number; flatDeg?: number } = {}): Noise {
  const n = m.positions.length / 3
  const nbr: number[][] = Array.from({ length: n }, () => [])
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t], b = m.indices[t + 1], c = m.indices[t + 2]
    nbr[a].push(b, c)
    nbr[b].push(a, c)
    nbr[c].push(a, b)
  }
  const step = Math.max(1, Math.floor(n / (opts.maxSamples ?? 20000)))
  const cosFlat = Math.cos(((opts.flatDeg ?? 8) * Math.PI) / 180)
  const d: number[] = []
  const spacing: number[] = []
  let sampled = 0
  const P = m.positions
  const N = m.normals
  for (let i = 0; i < n; i += step) {
    const ring = [...new Set(nbr[i])]
    if (ring.length < 4) continue
    sampled++
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2]
    if (ring.some((j) => N[j * 3] * nx + N[j * 3 + 1] * ny + N[j * 3 + 2] * nz < cosFlat)) continue
    let cx = 0, cy = 0, cz = 0
    for (const j of ring) {
      cx += P[j * 3]
      cy += P[j * 3 + 1]
      cz += P[j * 3 + 2]
      spacing.push(Math.hypot(P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2]))
    }
    cx /= ring.length
    cy /= ring.length
    cz /= ring.length
    const dist = Math.abs((P[i * 3] - cx) * nx + (P[i * 3 + 1] - cy) * ny + (P[i * 3 + 2] - cz) * nz)
    d.push(dist / Math.sqrt(1 + 1 / ring.length))
  }
  const median = (a: number[]) => {
    if (!a.length) return NaN
    const s = [...a].sort((x, y) => x - y)
    return s[Math.floor(s.length / 2)]
  }
  return { sigmaMm: 1.4826 * median(d), spacingMm: median(spacing), sampled, flat: d.length }
}
