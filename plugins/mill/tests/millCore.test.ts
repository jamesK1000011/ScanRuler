// SPDX-License-Identifier: AGPL-3.0-only
// The milling check's geometry without a kernel, on a block with a pocket
// and a block with an overhang built from triangles: which tool directions
// reach each face, the underside left as stock, an undercut, a square
// inside corner along the tool, a floor too narrow or too deep, a face past
// the tool's reach, small and deep holes; the stock round the part; and the
// setup sheet.
import { describe, expect, it } from 'vitest'
import { boxOfTris, checkMill, directionOf, directionWord, minWallFor, stockOf, type EdgeIn, type FaceIn, type V3 } from '../core/reach'
import { setupSheet } from '../core/sheet'

/** A quad as two triangles, its corners counter-clockwise seen from
 *  outside. */
const quad = (a: V3, b: V3, c: V3, d: V3) => [...a, ...b, ...c, ...a, ...c, ...d]

function part() {
  const faces: FaceIn[] = []
  const tris = new Map<number, number[]>()
  const add = (kind: string, normal: V3 | undefined, pts: number[], extra: Partial<FaceIn> = {}) => {
    const n = pts.length / 3
    const c: V3 = [0, 0, 0]
    for (let k = 0; k < n; k++) for (let j = 0; j < 3; j++) c[j] += pts[k * 3 + j] / n
    const index = faces.length
    faces.push({ index, kind, area: 1, centroid: c, ...(normal ? { normal } : {}), ...extra })
    tris.set(index, pts)
    return index
  }
  return { faces, tris, add }
}

/** A 40 × 40 × 20 block with a 10 × 10 pocket 15 deep in its top. */
function pocketed() {
  const p = part()
  p.add('plane', [0, 0, -1], quad([0, 0, 0], [0, 40, 0], [40, 40, 0], [40, 0, 0]))
  p.add('plane', [0, 0, 1], [...quad([0, 0, 20], [40, 0, 20], [40, 15, 20], [0, 15, 20]), ...quad([0, 25, 20], [40, 25, 20], [40, 40, 20], [0, 40, 20]), ...quad([0, 15, 20], [15, 15, 20], [15, 25, 20], [0, 25, 20]), ...quad([25, 15, 20], [40, 15, 20], [40, 25, 20], [25, 25, 20])])
  p.add('plane', [0, -1, 0], quad([0, 0, 0], [40, 0, 0], [40, 0, 20], [0, 0, 20]))
  p.add('plane', [0, 1, 0], quad([0, 40, 0], [0, 40, 20], [40, 40, 20], [40, 40, 0]))
  p.add('plane', [-1, 0, 0], quad([0, 0, 0], [0, 0, 20], [0, 40, 20], [0, 40, 0]))
  p.add('plane', [1, 0, 0], quad([40, 0, 0], [40, 40, 0], [40, 40, 20], [40, 0, 20]))
  p.add('plane', [0, 0, 1], quad([15, 15, 5], [25, 15, 5], [25, 25, 5], [15, 25, 5]))
  p.add('plane', [0, 1, 0], quad([15, 15, 5], [15, 15, 20], [25, 15, 20], [25, 15, 5]))
  p.add('plane', [0, -1, 0], quad([15, 25, 5], [25, 25, 5], [25, 25, 20], [15, 25, 20]))
  p.add('plane', [1, 0, 0], quad([15, 15, 5], [15, 25, 5], [15, 25, 20], [15, 15, 20]))
  p.add('plane', [-1, 0, 0], quad([25, 15, 5], [25, 15, 20], [25, 25, 20], [25, 25, 5]))
  const edges: EdgeIn[] = [
    // The pocket's corner between walls 7 and 9: inside. The block's own
    // corner between 2 and 4: outside.
    { index: 0, kind: 'line', length: 15, mid: [15, 15, 12.5], dir: [0, 0, 1], faces: [7, 9] },
    { index: 1, kind: 'line', length: 20, mid: [0, 0, 10], dir: [0, 0, 1], faces: [2, 4] },
  ]
  return { ...p, edges }
}

const UP: V3[] = [[0, 0, 1]]

describe('reach', () => {
  it('from above: every face reached but the underside, which is the stock’s', () => {
    const b = pocketed()
    const r = checkMill(b.faces, b.edges, b.tris, UP, { minDiameter: 3, reach: 30 })
    expect(r.reach.filter((x) => !x.from.length).map((x) => x.face)).toEqual([0])
    expect(r.reach[6].depth).toEqual({ 0: 15 })
    expect(r.findings.map((f) => [f.severity, f.rule])).toEqual([
      ['info', 'stock-floor'],
      ['warning', 'inside-corner'],
    ])
    expect(r.findings[1].at).toEqual([15, 15, 12.5])
  })

  it('from below only: the pocket is out of reach, the top the stock’s floor', () => {
    const b = pocketed()
    const r = checkMill(b.faces, b.edges, b.tris, [[0, 0, -1]], { minDiameter: 3, reach: 30 })
    expect(r.findings.filter((f) => f.rule === 'undercut').map((f) => f.says.split(' (')[0])).toEqual(['face 6', 'face 7', 'face 8', 'face 9', 'face 10'])
    expect(r.findings[0].says).toMatch(/^face 1: the part’s underside/)
    // Both ways: nothing out of reach.
    expect(checkMill(b.faces, b.edges, b.tris, [UP[0], [0, 0, -1]], { minDiameter: 3, reach: 30 }).findings.filter((f) => f.rule === 'undercut' || f.rule === 'stock-floor')).toEqual([])
  })

  it('a floor narrower than the least tool, deeper than four widths, and past the reach', () => {
    const b = pocketed()
    expect(checkMill(b.faces, b.edges, b.tris, UP, { minDiameter: 12, reach: 30 }).findings.find((f) => f.rule === 'narrow')?.says).toBe('face 6: a floor 10 wide, narrower than the least tool 12')
    const reach = checkMill(b.faces, b.edges, b.tris, UP, { minDiameter: 3, reach: 12 }).findings.find((f) => f.rule === 'reach')!
    expect(reach.says).toBe('faces 2, 3, 4, 5, 6, 7, 8, 9, 10 lie up to 20 down, past the tool’s reach of 12: a longer tool, or another direction')
  })

  it('an overhang: the face under it is not reached from above', () => {
    // A ledge's top at z 10 under a shelf from z 15 to 20 that covers it,
    // and the shelf's underside: both hidden from above.
    const p = part()
    p.add('plane', [0, 0, 1], quad([0, 0, 10], [10, 0, 10], [10, 30, 10], [0, 30, 10]))
    p.add('plane', [0, 0, -1], quad([0, 0, 15], [0, 30, 15], [12, 30, 15], [12, 0, 15]))
    p.add('plane', [0, 0, 1], quad([0, 0, 20], [12, 0, 20], [12, 30, 20], [0, 30, 20]))
    const r = checkMill(p.faces, [], p.tris, UP, { minDiameter: 3, reach: 30 })
    expect(r.findings.filter((f) => f.rule === 'undercut').map((f) => f.says.split(' is')[0])).toEqual(['face 0 (plane)', 'face 1 (plane)'])
  })

  it('a hole under the least tool, and one too deep for its width', () => {
    const p = part()
    // A bore of 2 across, 20 long, along z: its wall as a ring of quads.
    const ring: number[] = []
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 2 * Math.PI
      const b = ((i + 1) / 16) * 2 * Math.PI
      const at = (t: number, z: number): V3 => [Math.cos(t), Math.sin(t), z]
      ring.push(...quad(at(a, 0), at(a, 20), at(b, 20), at(b, 0)))
    }
    p.add('cylinder', undefined, ring, { axis: [0, 0, 1], radius: 1, center: [0, 0, 0], side: 'bore' })
    const says = checkMill(p.faces, [], p.tris, UP, { minDiameter: 3, reach: 30 }).findings.map((f) => f.rule)
    expect(says).toContain('small-hole')
    expect(says).toContain('deep-hole')
  })
})

describe('the stock, and the words', () => {
  it('the part’s box and a margin, or a size given — too small said', () => {
    const b = pocketed()
    const box = boxOfTris(b.tris)
    expect(stockOf(box, {})).toEqual({ size: [44, 44, 24], min: [-2, -2, -2], max: [42, 42, 22], fits: true })
    expect(stockOf(box, { size: [30, 50, 25] }).fits).toBe(false)
  })

  it('directions as words and vectors', () => {
    expect(directionOf('-Z')).toEqual([0, 0, -1])
    expect(directionOf([0, 3, 4])).toEqual([0, 0.6, 0.8])
    expect(directionOf([0, 0, 0])).toBe(null)
    expect(directionWord([1, 0, 0])).toBe('+x')
    expect(minWallFor('metal')).toBe(0.5)
  })

  it('the setup sheet: a part’s figures and findings, as JSON and Markdown', () => {
    const sheet = setupSheet(
      [
        {
          body: 'Bracket',
          setup: 'Machined (S2)',
          material: { id: 'aluminum-6061-t6', name: 'Aluminum 6061-T6', category: 'metal' },
          axes: '3',
          directions: ['+z', '-z'],
          tool: { minDiameter: 3, reach: 30 },
          grade: 8,
          stock: { size: [44, 44, 24], min: [-2, -2, -2], max: [42, 42, 22], fits: true, margin: 2 },
          part: { size: [40, 40, 20] },
          wall: { least: 2, min: 0.5 },
          machining: { speedCarbide: 300 },
          findings: [{ severity: 'warning', rule: 'inside-corner', says: '1 square inside corner', at: [15, 15, 12.5] }],
          errors: 0,
          warnings: 1,
        },
      ],
      { title: 'Machined (S2)', note: 'Datum A is the underside.', step: 'Machined.step' },
    )
    expect(sheet.json).toMatchObject({ title: 'Machined (S2)', units: 'millimetres', file: 'Machined.step', note: 'Datum A is the underside.', parts: [{ body: 'Bracket', grade: 'IT8' }] })
    expect(sheet.markdown).toMatch(/^# Setup sheet: Machined \(S2\)/)
    expect(sheet.markdown).toMatch(/\| Stock \| 44 × 44 × 24 from \(-2, -2, -2\), 2 round the part \|/)
    expect(sheet.markdown).toMatch(/- \*\*warning\*\* \(inside-corner\): 1 square inside corner — at \(15, 15, 12.5\)/)
  })
})
