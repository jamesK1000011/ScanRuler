// SPDX-License-Identifier: AGPL-3.0-only
// New parts kept clear of the bodies standing: past them in +Y with a gap
// where they'd meet in plan, left where they are otherwise.
import { describe, expect, it } from 'vitest'
import { clearOf, join, type Box3 } from '../../_shared/clear'

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box3 => ({ min: [x0, y0, z0], max: [x1, y1, z1] })

describe('clearOf', () => {
  const bin = box(-41.75, -20.75, 0, 41.75, 20.75, 25.4)
  it('nothing standing, or nothing made: no move', () => {
    expect(clearOf([box(0, 0, 0, 10, 10, 10)], null)).toBeNull()
    expect(clearOf([], bin)).toBeNull()
  })
  it('a coupon laid through the bin goes past it in +Y, 10 clear', () => {
    const coupon = box(-50, -8.8, 0, 50, 8.8, 4)
    const m = clearOf([coupon], bin)!
    expect(m).toEqual([0, 20.75 + 10 + 8.8, 0])
    expect(coupon.min[1] + m[1]).toBeCloseTo(bin.max[1] + 10, 9)
  })
  it('several parts move together, by their joint box', () => {
    const m = clearOf([box(-5, -5, 0, 5, 5, 2), box(20, -30, 0, 30, -20, 2)], bin)!
    expect(m[1]).toBeCloseTo(20.75 + 10 + 30, 9)
  })
  it('parts already clear in plan stay', () => {
    expect(clearOf([box(100, 0, 0, 110, 10, 5)], bin)).toBeNull()
    expect(clearOf([box(-10, 40, 0, 10, 50, 5)], bin)).toBeNull()
    // Within the gap of it: moved.
    expect(clearOf([box(-10, 25, 0, 10, 35, 5)], bin) !== null).toBe(true)
  })
  it('join', () => {
    expect(join(box(0, 0, 0, 1, 1, 1), box(-1, 2, 0, 0, 3, 5))).toEqual(box(-1, 0, 0, 1, 3, 5))
  })
})
