// SPDX-License-Identifier: AGPL-3.0-only
// The least wall a spec judges when the check's least is waived — a
// Gridfinity bin's stacking lip waived on purpose must not fail minWall.
import { describe, expect, it } from 'vitest'
import { wallForSpec, type WallFinding } from '../core/spec'

const lip: WallFinding = { id: 'F1', rule: 'thin-wall', value: 0.7, limit: 0.8, unit: 'mm', at: [-40.5, -19.8, 30.9], waived: 'Gridfinity lip' }
const edge: WallFinding = { id: 'F2', rule: 'thin-wall', value: 226.3, limit: 0.8, unit: 'mm', at: [39.2, 1.4, 28], edge: true }

describe('wallForSpec', () => {
  it('stands as read when nothing at the least wall is waived', () => {
    expect(wallForSpec(0.7, [-40.5, -19.8, 30.9], [{ ...lip, waived: undefined }, edge], 0.8)).toEqual({ least: 0.7, at: [-40.5, -19.8, 30.9] })
  })
  it('passes over a waived least wall when no other wall is under the minimum looked for', () => {
    const w = wallForSpec(0.7, [-40.54, -19.76, 30.93], [lip, edge], 0.8)
    expect(w).toMatchObject({ least: null, covered: true })
    expect(w.waived?.id).toBe('F1')
  })
  it('judges the thinnest wall not waived, never a sharp edge’s length', () => {
    const other: WallFinding = { id: 'F3', rule: 'thin-wall', value: 0.6, limit: 0.8, unit: 'mm', at: [0, 0, 5] }
    expect(wallForSpec(0.55, [-40.5, -19.8, 30.9], [{ ...lip, value: 0.55 }, edge, other], 0.8)).toMatchObject({ least: 0.6, at: [0, 0, 5] })
  })
  it('says the rest is unread when the spec asks more than the check looked for', () => {
    expect(wallForSpec(0.7, lip.at, [lip, edge], 1.2)).toMatchObject({ least: null, covered: false })
  })
  it('a waiver elsewhere does not cover the least wall', () => {
    expect(wallForSpec(0.7, [10, 10, 10], [lip], 0.8)).toEqual({ least: 0.7, at: [10, 10, 10] })
  })
})
