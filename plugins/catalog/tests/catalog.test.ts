// SPDX-License-Identifier: AGPL-3.0-only
// The offline table and its matching: a 608 named from its three sizes,
// an M5 head from its diameter and key, a worn one loosely; search links
// built; lookups by name.
import { describe, expect, test } from 'vitest'
import { links } from '../core/links'
import { KINDS, lookup, match, PARTS } from '../core/standards'

describe('standards', () => {
  test('every part carries the dimensions its kind names', () => {
    for (const p of PARTS) expect(Object.keys(p.dims).sort()).toEqual(Object.keys(KINDS.find((k) => k.kind === p.kind)!.dims).sort())
  })
  test('a 608 bearing from its bore, outside and width', () => {
    const m = match({ d: 8.01, D: 21.98, B: 7.02 })
    expect(m[0].part.designation).toBe('608 bearing')
    expect(m[0].worst).toBeLessThan(0.01)
  })
  test('an M5 socket head from its head and key', () => {
    expect(match({ dk: 8.45, s: 4 }, 'socket-head-screw')[0].part.designation).toBe('M5 socket head cap screw')
  })
  test('a worn washer still finds its size, loosely', () => {
    const m = match({ d1: 6.6, d2: 11.6, h: 1.5 }, 'washer')
    expect(m[0].part.designation).toBe('M6 washer')
    expect(m[0].worst).toBeGreaterThan(0.03)
  })
  test('dimensions no kind has match nothing', () => {
    expect(match({ zz: 3 })).toEqual([])
  })
  test('lookup by name', () => {
    expect(lookup('608').map((p) => p.designation)).toEqual(['608 bearing'])
    expect(lookup('M4').length).toBeGreaterThanOrEqual(4)
  })
})

test('search links for every source, the query encoded', () => {
  const l = links('M5 x 16 socket head')
  expect(l.map((x) => x.source)).toEqual(['traceparts', 'mcmaster', 'misumi', 'printables', 'thangs', 'grabcad'])
  expect(l[0].url).toContain('Keywords=M5%20x%2016%20socket%20head')
  expect(l[1].url).toBe('https://www.mcmaster.com/M5-x-16-socket-head/')
  expect(links('608', ['printables'])).toHaveLength(1)
})
