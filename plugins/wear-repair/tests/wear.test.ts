// SPDX-License-Identifier: AGPL-3.0-only
// wear-repair on a symmetric block worn on one side: the wear read against
// its mirrored other half, and repaired back to it; and a pre-warp that
// undoes a print's known distortion, with the stop rule over runs.
import Module from 'manifold-3d'
import { describe, expect, test } from 'vitest'
import { mirror, surface, type Mesh } from '../core/geometry'
import { prewarp, stopRule } from '../core/prewarp'
import { diff, rebuild, scatter, scatterNote } from '../core/repair'

async function block(): Promise<Mesh> {
  const w = await Module()
  w.setup()
  const g = w.Manifold.cube([40, 20, 10]).translate([-20, -10, 0]).refineToLength(0.5).getMesh()
  const n = g.vertProperties.length / g.numProp
  const positions = new Float64Array(3 * n)
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) positions[3 * i + k] = g.vertProperties[i * g.numProp + k]
  return { positions, indices: Uint32Array.from(g.triVerts) }
}

const WORN = { kind: 'box' as const, min: [11, -6, 8] as [number, number, number], max: [19, 6, 11] as [number, number, number] }

function worn(b: Mesh): Mesh {
  const p = Float64Array.from(b.positions)
  for (let i = 0; i < p.length; i += 3) if (p[i + 2] > 9.999 && p[i] > 12 && p[i] < 18 && Math.abs(p[i + 1]) < 5) p[i + 2] -= 0.5
  return { positions: p, indices: b.indices }
}

describe('repair from the mirrored other half', () => {
  test('the wear reads as material lost, and comes back', async () => {
    const scan = worn(await block())
    const ref = surface(mirror(scan, [0, 0, 0], [1, 0, 0]))
    const [stats] = diff(scan, ref, [{ name: 'top', region: WORN }], 0.05, 3)
    expect(stats.lost).toBeCloseTo(-0.5, 2)
    expect(stats.pointsLost).toBeGreaterThan(50)
    const fixed = rebuild(scan, ref, { worn: [WORN], keep: [], blendMm: 1, maxMm: 3, mode: 'add' })
    expect(fixed.moved).toBeGreaterThan(50)
    let worst = 0
    for (let i = 0; i < fixed.positions.length; i += 3) if (fixed.positions[i] > 12 && fixed.positions[i] < 18 && Math.abs(fixed.positions[i + 1]) < 5 && fixed.positions[i + 2] > 9) worst = Math.max(worst, Math.abs(fixed.positions[i + 2] - 10))
    expect(worst).toBeLessThan(0.01)
    const [after] = diff({ positions: fixed.positions, indices: scan.indices }, ref, [{ name: 'top', region: WORN }], 0.05, 3)
    expect(after.pointsLost).toBe(0)
  })
  test('outside the worn region and inside a kept one nothing moves', async () => {
    const scan = worn(await block())
    const ref = surface(mirror(scan, [0, 0, 0], [1, 0, 0]))
    const fixed = rebuild(scan, ref, { worn: [WORN], keep: [{ kind: 'sphere', center: [15, 0, 10], radius: 30 }], blendMm: 1, maxMm: 3, mode: 'add' })
    expect(fixed.moved).toBe(0)
  })
})

describe('scan scatter against the tolerance', () => {
  test('the spread off the worn region reads back, and a tolerance under twice it is flagged', async () => {
    const clean = await block()
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand())
    const p = Float64Array.from(clean.positions)
    for (let i = 0; i < p.length; i++) p[i] += 0.03 * gauss()
    const s = scatter({ positions: p, indices: clean.indices }, surface(clean), [WORN], 3)
    expect(s).not.toBeNull()
    expect(s!.mm).toBeGreaterThan(0.02)
    expect(s!.mm).toBeLessThan(0.04)
    expect(scatterNote(s, 0.05)).toMatch(/twice the scan's scatter/)
    expect(scatterNote(s, 0.1)).toBeNull()
    expect(scatter(clean, surface(clean), [WORN], 3)!.mm).toBeLessThan(0.001)
  })
})

describe('pre-warp', () => {
  test('a print 1 % long in X comes out true from the pre-warped model', async () => {
    const target = await block()
    const print = (m: Mesh): Mesh => ({ positions: m.positions.map((v, i) => (i % 3 === 0 ? v * 1.01 : v)), indices: m.indices })
    const first = print(target)
    const r = prewarp(target, surface(first), { gain: 1, smooth: 1, maxMm: 3 })
    expect(r.largest).toBeCloseTo(0.2, 2)
    const second = print({ positions: r.positions, indices: target.indices })
    const again = prewarp(target, surface(second), { gain: 1, smooth: 1, maxMm: 3 })
    expect(again.rms).toBeLessThan(0.2 * r.rms)
  })
  test('the stop rule', () => {
    expect(stopRule([], 0.05).stop).toBe(false)
    expect(stopRule([{ n: 1, rms: 0.3, at: '' }], 0.05).stop).toBe(false)
    expect(stopRule([{ n: 1, rms: 0.3, at: '' }, { n: 2, rms: 0.04, at: '' }], 0.05).why).toMatch(/within/)
    expect(stopRule([{ n: 1, rms: 0.3, at: '' }, { n: 2, rms: 0.28, at: '' }], 0.05).why).toMatch(/less than a fifth/)
  })
})
