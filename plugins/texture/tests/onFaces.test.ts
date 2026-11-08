// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { onFaces, type ScanSurface } from '../app/regions'

// A 60 × 40 × 20 box with a 40 × 20 pocket 10 deep in its top, meshed
// finely as a scan would be: every face a grid of small triangles.
function grid(origin: number[], u: number[], v: number[], nu: number, nv: number, out: { p: number[]; ix: number[] }) {
  const base = out.p.length / 3
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) out.p.push(...[0, 1, 2].map((a) => origin[a] + (u[a] * i) / nu + (v[a] * j) / nv))
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i
      out.ix.push(a, a + 1, a + nu + 2, a, a + nu + 2, a + nu + 1)
    }
}

function scan(): { mesh: ScanSurface; outerWalls: Float32Array; wallVerts: (v: number) => boolean } {
  const out = { p: [] as number[], ix: [] as number[] }
  // Outer walls, normals outward.
  grid([30, -20, 0], [0, 40, 0], [0, 0, 20], 20, 10, out) // +X
  grid([-30, 20, 0], [0, -40, 0], [0, 0, 20], 20, 10, out) // -X
  grid([30, 20, 0], [-60, 0, 0], [0, 0, 20], 30, 10, out) // +Y
  grid([-30, -20, 0], [60, 0, 0], [0, 0, 20], 30, 10, out) // -Y
  const wallCount = out.p.length / 3
  // Pocket walls, 3 mm inside: facing inward, toward the pocket.
  grid([20, 10, 10], [0, -20, 0], [0, 0, 10], 10, 5, out) // facing -X
  grid([-20, -10, 10], [0, 20, 0], [0, 0, 10], 10, 5, out) // facing +X
  const positions = new Float32Array(out.p)
  // The CAD faces: the four outer walls as two triangles each.
  const quad = (o: number[], u: number[], v: number[]) => {
    const c = (s: number, t: number) => [0, 1, 2].map((a) => o[a] + u[a] * s + v[a] * t)
    return [...c(0, 0), ...c(1, 0), ...c(1, 1), ...c(0, 0), ...c(1, 1), ...c(0, 1)]
  }
  const outerWalls = new Float32Array([
    ...quad([30, -20, 0], [0, 40, 0], [0, 0, 20]),
    ...quad([-30, 20, 0], [0, -40, 0], [0, 0, 20]),
    ...quad([30, 20, 0], [-60, 0, 0], [0, 0, 20]),
    ...quad([-30, -20, 0], [60, 0, 0], [0, 0, 20]),
  ])
  return { mesh: { positions, indices: new Uint32Array(out.ix), normals: new Float32Array(positions.length) }, outerWalls, wallVerts: (v) => v < wallCount }
}

describe('CAD faces', () => {
  it('paints the outer walls and nothing of the pocket behind them', () => {
    const { mesh, outerWalls, wallVerts } = scan()
    const v = [...onFaces(mesh, outerWalls)]
    expect(v.length).toBeGreaterThan(0)
    expect(v.every(wallVerts)).toBe(true)
    expect(v.length).toBe(mesh.positions.length / 3 - 2 * 11 * 6)
  })

  it('a scan off the face by more than the tolerance is not on it; with more, it is', () => {
    const { mesh, outerWalls } = scan()
    const moved = new Float32Array(mesh.positions)
    for (let i = 0; i < moved.length; i += 3) moved[i] *= 1.02
    const off = { ...mesh, positions: moved }
    expect(onFaces(off, outerWalls, 0.25).length).toBeLessThan(onFaces(mesh, outerWalls, 0.25).length)
    expect(onFaces(off, outerWalls, 1).length).toBe(onFaces(mesh, outerWalls, 0.25).length)
  })
})
