// SPDX-License-Identifier: AGPL-3.0-only
// Flat undersides: a bridge or a ledge. Parts are stacked layers of shapes
// in plan, meshed on a fine grid: the groove under a Gridfinity 2×1 bin
// between its two feet, a deck on two pillars, a shelf off one column and
// one held at a corner only.
import { describe, expect, it } from 'vitest'
import { runChecks } from '../core/checks'
import { stack, type RulePack } from '../core/rules'
import pack from '../rules/fdm-default.json'

type Inside = (x: number, y: number) => boolean
/** Layers stacked from z = 0, each `height` tall and solid where `inside`,
 *  meshed in squares `pitch` across over x0…x1, y0…y1, welded, wound out. */
function layered(layers: { height: number; inside: Inside }[], box: [number, number, number, number], pitch: number) {
  const [x0, y0, x1, y1] = box
  const nx = Math.round((x1 - x0) / pitch), ny = Math.round((y1 - y0) / pitch)
  const zs = [0]
  for (const l of layers) zs.push(zs[zs.length - 1] + l.height)
  const solid = layers.map((l) => {
    const g = new Uint8Array(nx * ny)
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = l.inside(x0 + (i + 0.5) * pitch, y0 + (j + 0.5) * pitch) ? 1 : 0
    return g
  })
  const at = (L: number, i: number, j: number) => L >= 0 && L < layers.length && i >= 0 && j >= 0 && i < nx && j < ny && solid[L][j * nx + i] === 1
  const ids = new Map<string, number>(), pos: number[] = [], idx: number[] = []
  const v = (i: number, j: number, k: number) => {
    const key = `${i},${j},${k}`
    let n = ids.get(key)
    if (n === undefined) {
      n = ids.size
      ids.set(key, n)
      pos.push(x0 + i * pitch, y0 + j * pitch, zs[k])
    }
    return n
  }
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d)
  for (let L = 0; L < layers.length; L++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!at(L, i, j)) continue
        if (!at(L - 1, i, j)) quad(v(i, j, L), v(i, j + 1, L), v(i + 1, j + 1, L), v(i + 1, j, L))
        if (!at(L + 1, i, j)) quad(v(i, j, L + 1), v(i + 1, j, L + 1), v(i + 1, j + 1, L + 1), v(i, j + 1, L + 1))
        if (!at(L, i + 1, j)) quad(v(i + 1, j, L), v(i + 1, j + 1, L), v(i + 1, j + 1, L + 1), v(i + 1, j, L + 1))
        if (!at(L, i - 1, j)) quad(v(i, j, L), v(i, j, L + 1), v(i, j + 1, L + 1), v(i, j + 1, L))
        if (!at(L, i, j + 1)) quad(v(i, j + 1, L), v(i, j + 1, L + 1), v(i + 1, j + 1, L + 1), v(i + 1, j + 1, L))
        if (!at(L, i, j - 1)) quad(v(i, j, L), v(i + 1, j, L), v(i + 1, j, L + 1), v(i, j, L + 1))
      }
  return { positions: Float64Array.from(pos), indices: Uint32Array.from(idx) }
}
/** A rectangle w × d centred on cx cy, its corners rounded to `r`. */
const rounded = (cx: number, cy: number, w: number, d: number, r: number): Inside => (x, y) => {
  const dx = Math.abs(x - cx) - (w / 2 - r), dy = Math.abs(y - cy) - (d / 2 - r)
  if (Math.abs(x - cx) > w / 2 || Math.abs(y - cy) > d / 2) return false
  return dx <= 0 || dy <= 0 || Math.hypot(dx, dy) <= r
}
const rect = (xa: number, ya: number, xb: number, yb: number): Inside => (x, y) => x >= xa && x <= xb && y >= ya && y <= yb
const either = (...f: Inside[]): Inside => (x, y) => f.some((g) => g(x, y))
const rules = (maxBridge?: number) => stack(pack as RulePack, maxBridge ? [{ name: 'project', overrides: { bridge: { params: { maxMm: maxBridge } } } }] : []).filter((r) => r.check === 'overhang' || r.check === 'bridge')
const found = (part: ReturnType<typeof layered>, maxBridge?: number) => runChecks(part, rules(maxBridge)).findings.map((f) => [f.rule, f.value, f.areaMm2])

describe('a flat underside', () => {
  it('between the two feet of a Gridfinity 2×1 bin is a bridge, flared ends and all', () => {
    // Each foot 41.5 square with 3.75 corners, ±21 from the middle; the
    // bin over both from 4.75 mm: a groove 0.5 wide between the feet,
    // widening to about 8 where their corners round off.
    const bin = layered(
      [
        { height: 4.75, inside: either(rounded(-21, 0, 41.5, 41.5, 3.75), rounded(21, 0, 41.5, 41.5, 3.75)) },
        { height: 3, inside: rounded(0, 0, 83.5, 41.5, 3.75) },
      ],
      [-42, -21, 42, 21],
      0.25,
    )
    expect(found(bin)).toEqual([])
    // The longest bridge is across the flare, under the 10 mm limit — held
    // to 4, it is found as a bridge, still not as a ledge.
    const tight = runChecks(bin, rules(4)).findings
    expect(tight.map((f) => f.rule)).toEqual(['bridge'])
    expect(tight[0].value).toBeGreaterThan(4)
    expect(tight[0].value).toBeLessThan(8)
    // 32.8 mm² on the bin; the grid's squares round the corners off a little.
    expect(tight[0].areaMm2).toBeGreaterThan(31.5)
    expect(tight[0].areaMm2).toBeLessThan(34)
  })
  it('on two pillars is a bridge, by the gap between them', () => {
    const deck = layered(
      [
        { height: 10, inside: either(rect(0, 0, 5, 10), rect(15, 0, 20, 10)) },
        { height: 2, inside: rect(0, 0, 20, 10) },
      ],
      [-1, -1, 21, 11],
      0.5,
    )
    expect(found(deck)).toEqual([])
    expect(found(deck, 8)).toEqual([['bridge', 10, 100]])
  })
  it('off one column is a ledge', () => {
    const shelf = layered(
      [
        { height: 10, inside: rect(0, 0, 6, 6) },
        { height: 2, inside: rect(0, 0, 14, 6) },
      ],
      [-1, -1, 15, 7],
      0.5,
    )
    const f = runChecks(shelf, rules()).findings
    expect(f.map((x) => [x.rule, x.value, x.areaMm2])).toEqual([['overhang', 90, 48]])
    expect(f[0].at).toEqual([10, 3, 10])
    expect(f[0].says).toMatch(/no wall under it on the opposite side/)
  })
  it('held at a corner only is a ledge where no bridge reaches', () => {
    // An L of walls, 2 thick, under a 12 × 12 roof: the far corner hangs.
    const corner = layered(
      [
        { height: 10, inside: either(rect(0, 0, 12, 2), rect(0, 0, 2, 12)) },
        { height: 2, inside: rect(0, 0, 12, 12) },
      ],
      [-1, -1, 13, 13],
      0.5,
    )
    const over = runChecks(corner, rules()).findings.filter((f) => f.rule === 'overhang')
    expect(over).toHaveLength(1)
    expect(over[0].areaMm2).toBeGreaterThan(4)
    expect(over[0].areaMm2).toBeLessThan(100)
    expect(over[0].at[0]).toBeGreaterThan(6)
    expect(over[0].at[1]).toBeGreaterThan(6)
  })
})
