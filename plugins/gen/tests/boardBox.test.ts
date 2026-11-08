// SPDX-License-Identifier: AGPL-3.0-only
// The board enclosure, built with OCCT: standoffs under the mounting holes
// with an insert's or a pilot's hole, the board clear of the walls and the
// floor, openings through the walls where the connectors sit and wall
// beside them, a round opening for a barrel jack, the lid that drops in
// without touching, and the refusals.
import { beforeAll, describe, expect, it } from 'vitest'
import { boardBoxPlan, boardIn, BOARD_BOX_DEFAULTS, screwFor, type BoardSpec } from '../core/boardBox'
import { generatorOf, valuesOf } from '../core/generators'
import { prism, type GenKernel } from '../core/kernel'
import { setupIn } from '../app/projectSection'

type K = GenKernel & { common(a: unknown, b: unknown): unknown; makeBox(dx: number, dy: number, dz: number): unknown; isValid(s: unknown): boolean; mirror(s: unknown, p: { x: number; y: number; z: number }, n: { x: number; y: number; z: number }): unknown }
let k: K
beforeAll(async () => {
  k = (await (await import('occt-wasm')).OcctKernel.init()) as unknown as K
})

// The tiny board of the Boards tests: 50 × 40 mm, 1.6 thick, M3 holes at
// two corners, a USB-C at the +y edge and an upright 1×4 header at -x.
const T = 1.6
const BOARD: BoardSpec = {
  name: 'tiny',
  outline: [[-25, -20], [25, -20], [25, 17], [22, 20], [-25, 20]],
  thickness: T,
  above: 10,
  below: 2,
  holes: [{ x: -20, y: -15, d: 3.2 }, { x: 20, y: 15, d: 3.2 }],
  openings: [
    { side: '+y', centre: 0, width: 8.94, z0: T, z1: T + 3.26, label: 'J1 USB-C' },
    { side: '-x', centre: 0.2, width: 11.2, z0: T, z1: T + 8.5, label: 'J2 header' },
  ],
}
const P = { ...BOARD_BOX_DEFAULTS }

const g = generatorOf('board_box')!
const build = (given: Record<string, unknown> = {}, b: BoardSpec = BOARD) => g.build(k, valuesOf(g, given, g.defaults, b), b)
const vol = (s: unknown) => k.getVolume(s)
/** A small cube of the part at a point: > 0 where there is material. */
const at = (s: unknown, x: number, y: number, z: number, e = 0.2) => vol(k.common(s, k.translate(k.makeBox(e, e, e), x - e / 2, y - e / 2, z - e / 2)))

describe('board enclosure', () => {
  it('box and lid, named after the board; the lid beside, on the same plane', () => {
    const [box, lid] = build()
    expect(box.name).toBe('tiny box')
    expect(lid.name).toBe('tiny lid')
    const q = boardBoxPlan(P, BOARD)
    const bb = k.getBoundingBox(box.shape)
    expect(Math.round(bb.zmin * 100) / 100).toBe(-(P.standoff + P.floor))
    expect(Math.round(bb.zmax * 100) / 100).toBe(T + 10 + Math.max(P.headroom, P.lip))
    expect(Math.round((bb.xmax - bb.xmin) * 100) / 100).toBe(50 + 2 * P.gap + 2 * P.wall)
    expect(Math.round((bb.ymax - bb.ymin) * 100) / 100).toBe(40 + 2 * P.gap + 2 * P.wall)
    const lb = k.getBoundingBox(lid.shape)
    expect(lb.xmin).toBeGreaterThan(bb.xmax)
    expect(Math.round(lb.zmin * 100) / 100).toBe(q.bottom)
    expect(k.isValid(box.shape)).toBe(true)
  })
  it('the board clears the walls, the floor and the standoffs’ sides', () => {
    const [box] = build()
    const board = prism(k, 0, 0, 50, 40, 0, 0, T)
    expect(vol(k.common(box.shape, board))).toBeLessThan(0.001)
    // With no gap it touches the walls only: the inside corners go square, so a square board corner still fits.
    const [tight] = build({ gap: 0 })
    expect(vol(k.common(tight.shape, board))).toBeLessThan(0.001)
  })
  it('standoffs stand under the holes, up to the board’s bottom, with the insert’s hole', () => {
    const [box] = build()
    const s = screwFor(3.2)!
    expect(s.size).toBe('M3')
    for (const h of BOARD.holes) {
      // Material in the standoff's ring just under the board, none above it.
      expect(at(box.shape, h.x + (s.insert.hole / 2 + 0.8), h.y, -0.3)).toBeGreaterThan(0)
      expect(at(box.shape, h.x + (s.insert.hole / 2 + 0.8), h.y, 0.3)).toBe(0)
      // The insert's 4 mm hole, its length and half a millimetre deep.
      expect(at(box.shape, h.x + 1.8, h.y, -1)).toBe(0)
      expect(at(box.shape, h.x, h.y, -(s.insert.length + 0.5) + 0.2)).toBe(0)
      expect(at(box.shape, h.x, h.y, -(s.insert.length + 0.5) - 0.3)).toBeGreaterThan(0)
      // Nothing where there is no hole.
      expect(at(box.shape, 0, 0, -0.3)).toBe(0)
    }
  })
  it('self-tapping: a 2.5 mm pilot down to the floor, never through it', () => {
    const [box] = build({ inserts: false })
    const h = BOARD.holes[0]
    expect(at(box.shape, h.x + 1.0, h.y, -2)).toBe(0)
    expect(at(box.shape, h.x + 1.5, h.y, -2)).toBeGreaterThan(0)
    expect(at(box.shape, h.x, h.y, -(P.standoff + P.floor) + 0.3)).toBeGreaterThan(0)
  })
  it('openings through the walls where the connectors are, wall beside and above', () => {
    const [box] = build()
    const q = boardBoxPlan(P, BOARD)
    const yWall = q.D / 2 - P.wall / 2
    const zc = T + 3.26 / 2
    expect(at(box.shape, 0, yWall, zc)).toBe(0)
    expect(at(box.shape, 8.94 / 2 + P.margin - 0.2, yWall, zc)).toBe(0)
    expect(at(box.shape, 8.94 / 2 + P.margin + 0.3, yWall, zc)).toBeGreaterThan(0)
    expect(at(box.shape, 0, yWall, T + 3.26 + P.margin + 0.3)).toBeGreaterThan(0)
    expect(at(box.shape, 0, yWall, T - P.margin - 0.3)).toBeGreaterThan(0)
    // The header's, on the other wall, its middle off the origin.
    const xWall = -(q.W / 2 - P.wall / 2)
    expect(at(box.shape, xWall, 0.2 + 11.2 / 2 + P.margin - 0.2, T + 4)).toBe(0)
    expect(at(box.shape, xWall, 0.2 + 11.2 / 2 + P.margin + 0.3, T + 4)).toBeGreaterThan(0)
    // Without openings, wall all round.
    const [shut] = build({ cutouts: false })
    expect(at(shut.shape, 0, yWall, zc)).toBeGreaterThan(0)
  })
  it('a round opening for a barrel jack', () => {
    const b: BoardSpec = { ...BOARD, above: 12, openings: [{ side: '+x', centre: 5, width: 9, z0: T + 2, z1: T + 11, shape: 'round' }] }
    const [box] = build({}, b)
    const q = boardBoxPlan(P, b)
    const x = q.W / 2 - P.wall / 2
    const zc = T + 6.5
    expect(at(box.shape, x, 5, zc)).toBe(0)
    expect(at(box.shape, x, 5 + 4.5 + P.margin - 0.3, zc)).toBe(0)
    // Round: its square's corner is wall.
    expect(at(box.shape, x, 5 + 4.2, zc + 4.2)).toBeGreaterThan(0)
    expect(k.isValid(box.shape)).toBe(true)
  })
  it('the lid, turned over onto the box, sits on its rim without touching inside', () => {
    const [box, lid] = build()
    const q = boardBoxPlan(P, BOARD)
    const over = k.translate(k.mirror(lid.shape, { x: 0, y: 0, z: q.bottom }, { x: 0, y: 0, z: 1 }), -(q.W + 10), 0, q.top - q.bottom + P.lid)
    const lb = k.getBoundingBox(over)
    expect(lb.zmin).toBeCloseTo(q.top - P.lip, 3)
    expect(vol(k.common(box.shape, over))).toBeLessThan(0.5)
    // The lip stays above the tallest part.
    expect(lb.zmin).toBeGreaterThan(T + BOARD.above - 0.001)
  })
  it('refuses a standoff the parts underneath would hit, a hole off the board, no board', () => {
    expect(() => valuesOf(g, { standoff: 2 }, g.defaults, BOARD)).toThrow(/too short for the parts under the board.*2\.5/)
    expect(() => valuesOf(g, {}, g.defaults, { ...BOARD, holes: [{ x: 40, y: 0, d: 3.2 }] })).toThrow(/outside the board/)
    expect(() => g.build(k, valuesOf(g, {}), null)).toThrow(/No board/)
    // The values alone check without a board (the project file's reading).
    expect(valuesOf(g, { standoff: 2 })).toMatchObject({ standoff: 2 })
  })
  it('a hole too small for M2 gets no standoff, said so', () => {
    const q = boardBoxPlan(P, { ...BOARD, holes: [{ x: 0, y: 0, d: 1.5 }] })
    expect(q.standoffs[0]).toMatchObject({ screw: null })
    expect(screwFor(2.7)?.size).toBe('M2.5')
    expect(screwFor(2.2)?.size).toBe('M2')
    expect(screwFor(4.3)?.size).toBe('M4')
  })
  it('a board as given is checked', () => {
    expect(() => boardIn(null)).toThrow(/board: an object/)
    expect(() => boardIn({ ...BOARD, outline: [[0, 0]] })).toThrow(/outline/)
    expect(() => boardIn({ ...BOARD, thickness: 0 })).toThrow(/thickness/)
    expect(() => boardIn({ ...BOARD, holes: [{ x: 0, y: 0 }] })).toThrow(/holes\[0\]/)
    expect(() => boardIn({ ...BOARD, openings: [{ side: 'up', centre: 0, width: 1, z0: 0, z1: 1 }] })).toThrow(/openings\[0\]/)
    expect(() => boardIn({ ...BOARD, openings: [{ side: '+x', centre: 0, width: 1, z0: 2, z1: 1 }] })).toThrow(/z1 above z0/)
    expect(boardIn(JSON.parse(JSON.stringify(BOARD)))).toEqual(BOARD)
  })
  it('the project file keeps the board, and drops one it cannot read', () => {
    expect(setupIn({ generator: 'board_box', board: BOARD }).board).toEqual(BOARD)
    expect(setupIn({ generator: 'board_box', board: { outline: 'x' } }).board).toBe(null)
  })
  it('red team: an L-shaped board off the origin, openings on the -y wall and under the board, standoffs under each hole', () => {
    // KiCad's frame need not be centred: an L 60 × 50 from (100, 20).
    const L: BoardSpec = {
      name: 'ell',
      outline: [[100, 20], [160, 20], [160, 40], [130, 40], [130, 70], [100, 70]],
      thickness: T,
      above: 8,
      below: 4,
      holes: [{ x: 104, y: 24, d: 3.2 }, { x: 156, y: 36, d: 2.7 }, { x: 104, y: 66, d: 2.2 }],
      openings: [
        { side: '-y', centre: 140, width: 8.94, z0: T, z1: T + 3.26, label: 'J1 USB-C' },
        // On the bottom face: below the board, above the floor.
        { side: '+x', centre: 30, width: 7.5, z0: -2.6, z1: 0, label: 'J2 micro-USB under' },
      ],
    }
    const [box] = build({ standoff: 5 }, L)
    expect(k.isValid(box.shape)).toBe(true)
    const q = boardBoxPlan(P, L)
    expect([q.cx, q.cy]).toEqual([130, 45])
    // Each standoff under its hole, the screw the hole takes, its hole open.
    for (const h of L.holes) {
      const s = screwFor(h.d)!
      expect(at(box.shape, h.x + s.insert.hole / 2 + 0.5, h.y, -0.3)).toBeGreaterThan(0)
      expect(at(box.shape, h.x, h.y, -0.5)).toBe(0)
      expect(at(box.shape, h.x, h.y, 0.3)).toBe(0)
    }
    // The -y opening at x 140, through the wall.
    const yWall = q.cy - (q.D / 2 - P.wall / 2)
    expect(at(box.shape, 140, yWall, T + 1.63)).toBe(0)
    expect(at(box.shape, 140 + 8.94 / 2 + P.margin + 0.3, yWall, T + 1.63)).toBeGreaterThan(0)
    // The one under the board: open at z -1.3, the floor still whole under it.
    const xWall = q.cx + (q.W / 2 - P.wall / 2)
    expect(at(box.shape, xWall, 30, -1.3)).toBe(0)
    expect(at(box.shape, xWall, 30, q.bottom + P.floor / 2)).toBeGreaterThan(0)
    // The board (as its outline) clears the box.
    const a = prism(k, 115, 30, 30, 20, 0, 0, T)
    const b2 = prism(k, 145, 30, 30, 20, 0, 0, T)
    const c = prism(k, 115, 55, 30, 30, 0, 0, T)
    for (const part of [a, b2, c]) expect(vol(k.common(box.shape, part))).toBeLessThan(0.001)
  })
})
