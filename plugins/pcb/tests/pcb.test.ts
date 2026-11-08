// SPDX-License-Identifier: AGPL-3.0-only
// The board's bodies told apart after an import (the board by its size,
// each edge connector by where it stands), the parts' reach measured, and
// the board as the enclosure takes it: openings at a kind's typical size,
// or a 3D box's, or a guess said so; the project section's reading.
import { describe, expect, it } from 'vitest'
import { boardIn, boardSpecOf, connectorBoxes, placeBodies, type KicadBoard } from '../core/boardSpec'
import { setupIn } from '../app/projectSection'

// The tiny board as the server reads it (mcp/tests/fixtures/tiny.kicad_pcb).
const BOARD: KicadBoard = {
  name: 'tiny',
  thickness: 1.6,
  origin: [125, 120],
  size: [50, 40],
  outline: [[-25, 20], [25, 20], [25, -17], [22, -20], [-25, -20]],
  holes: [{ ref: 'H1', x: -20, y: -15, d: 3.2, plated: false, from: 'footprint' }, { ref: 'H2', x: 20, y: 15, d: 3.2, plated: false, from: 'footprint' }],
  connectors: [
    { ref: 'J2', value: 'Conn_01x04', footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical', kind: 'pin_header', label: 'Pin header', x: -22, y: 4, rot: 0, face: 'top', side: '-x', inset: 1.2, centre: 0.2, box: { min: [-23.8, -5.4], max: [-20.2, 5.8] }, opening: { width: 11.2, height: 8.5, zc: 4.25, shape: 'rect', typical: true } },
    { ref: 'J1', value: 'USB_C', footprint: 'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12', kind: 'usb_c', label: 'USB-C receptacle', x: 0, y: 16.8, rot: 0, face: 'top', side: '+y', inset: -0.8, centre: 0, box: { min: [-5, 13.3], max: [5, 20.8] }, opening: { width: 8.94, height: 3.26, zc: 1.63, shape: 'rect', typical: true } },
    { ref: 'J3', value: 'Screw', footprint: 'Connector_Phoenix:Thing', kind: 'other', label: 'Connector', x: 20, y: 0, rot: 0, face: 'top', side: '+x', inset: 0.5, centre: 0, box: { min: [18, -3], max: [24.5, 3] }, opening: { width: 6, height: null, zc: null, shape: 'rect', typical: false } },
  ],
  footprints: { count: 6, top: 6, bottom: 0 },
}

const body = (id: number, name: string, min: [number, number, number], max: [number, number, number]) => ({ id, name, bounds: { min, max } })
const BODIES = [
  body(1, 'R1', [-1, -0.5, 1.6], [1, 0.5, 2.1]),
  body(2, 'tiny_PCB', [-25, -20, 0], [25, 20, 1.6]),
  body(3, 'USB_C_Receptacle', [-4.47, 15.5, 1.6], [4.47, 21, 4.86]),
  body(4, 'PinHeader', [-23.27, -4.12, -3], [-20.73, 5.12, 10.1]),
  body(5, 'Terminal', [18.5, -2.5, 1.6], [24.6, 2.5, 11.6]),
]

describe('the bodies an import made', () => {
  it('the board by its size, connectors by where they stand, the reach of the parts', () => {
    const p = placeBodies(BOARD, BODIES)
    expect(p.board?.id).toBe(2)
    expect(p.connectors.J1.id).toBe(3)
    expect(p.connectors.J2.id).toBe(4)
    expect(p.connectors.J3.id).toBe(5)
    expect(p.offset).toEqual([0, 0, 0])
    expect(Math.round(p.above * 100) / 100).toBe(10)
    // The header's pins 3 mm under the board.
    expect(p.below).toBe(3)
  })
  it('a board that came in off where it was asked: offset, and boxes in the board’s frame', () => {
    const moved = BODIES.map((b) => ({ ...b, bounds: { min: [b.bounds.min[0] + 10, b.bounds.min[1], b.bounds.min[2] - 1.6] as [number, number, number], max: [b.bounds.max[0] + 10, b.bounds.max[1], b.bounds.max[2] - 1.6] as [number, number, number] } }))
    const p = placeBodies(BOARD, moved)
    expect(p.offset).toEqual([10, 0, -1.6])
    expect(connectorBoxes(p).J1.min).toEqual([-4.47, 15.5, 1.6])
  })
  it('no body the board’s size: none called the board, nothing matched to a part far away', () => {
    const p = placeBodies(BOARD, [body(9, 'x', [-100, -100, 0], [-90, -90, 1])])
    expect(p.board).toBe(null)
    expect(p.connectors).toEqual({})
  })
})

describe('the board for the enclosure', () => {
  it('typical openings for known kinds, placed on their 3D boxes; others by their box', () => {
    const p = placeBodies(BOARD, BODIES)
    const { spec, notes } = boardSpecOf(BOARD, { measured: { above: p.above, below: p.below }, boxes: connectorBoxes(p) })
    const by = Object.fromEntries(spec.openings.map((o) => [o.label!.split(' ')[0], o]))
    expect(by.J1).toMatchObject({ side: '+y', centre: 0, width: 8.94, z0: 1.6, z1: 4.86 })
    expect(by.J2).toMatchObject({ side: '-x', width: 11.2, z0: 1.6, z1: 10.1 })
    expect(by.J2.centre).toBe(0.5)
    // The terminal: its 3D box, from the board's top up.
    expect(by.J3).toMatchObject({ side: '+x', centre: 0, width: 5, z0: 1.6, z1: 11.6 })
    expect(spec.above).toBe(10)
    expect(spec.below).toBe(3)
    expect(spec.holes).toEqual([{ x: -20, y: -15, d: 3.2, ref: 'H1' }, { x: 20, y: 15, d: 3.2, ref: 'H2' }])
    expect(notes.filter((n) => /typical/.test(n)).length).toBe(2)
  })
  it('nothing imported: the reach guessed and the unknown connector’s height too, each said', () => {
    const { spec, notes } = boardSpecOf(BOARD)
    expect(spec.above).toBe(12)
    expect(spec.below).toBe(2.5)
    expect(notes.some((n) => /above the board is a guess/.test(n))).toBe(true)
    expect(notes.some((n) => /J3.*guessed/.test(n))).toBe(true)
    expect(spec.openings.find((o) => o.label?.startsWith('J3'))).toMatchObject({ z0: 1.6, z1: 6.6, width: 6 })
  })
  it('the reach set by hand wins; a connector skipped gets no opening; a tall opening raises the reach', () => {
    const { spec } = boardSpecOf(BOARD, { above: 2, below: 0, skip: ['J3'] })
    expect(spec.openings.map((o) => o.label?.split(' ')[0])).toEqual(['J2', 'J1'])
    // The header's 8.5 mm opening needs more than the 2 mm set.
    expect(spec.above).toBe(8.5)
    expect(spec.below).toBe(0)
  })
  it('a connector under the board opens below it', () => {
    const under = { ...BOARD, connectors: [{ ...BOARD.connectors[1], face: 'bottom' as const }] }
    const { spec } = boardSpecOf(under, { above: 1, below: 1 })
    expect(spec.openings[0]).toMatchObject({ z0: -3.26, z1: 0 })
    expect(spec.below).toBe(3.26)
  })
  it('a board without mounting holes: no standoffs, said so', () => {
    expect(boardSpecOf({ ...BOARD, holes: [] }).notes.some((n) => /no mounting holes/.test(n))).toBe(true)
  })
  it('a board the server sent that is not one is refused', () => {
    expect(() => boardIn({ name: 'x' })).toThrow(/not a board this page reads/)
  })
})

describe('project section', () => {
  it('keeps what reads, drops what does not', () => {
    const s = setupIn({ path: '/b/tiny.kicad_pcb', naming: 'kicad', enclosure: { standoff: 6, inserts: false, bad: 'x', 'no-way': 1 }, above: -1, below: 2, skip: ['J3', 4], board: BOARD, imported: { at: 't', body: 'tiny', bodies: 5, components: true, above: 10, below: 3, offset: [0, 0, 0], boxes: {}, kicad: '9.0.2', warnings: ['a', 5] } })
    expect(s.naming).toBe('kicad')
    expect(s.enclosure).toEqual({ standoff: 6, inserts: false })
    expect(s.above).toBe(null)
    expect(s.below).toBe(2)
    expect(s.skip).toEqual(['J3'])
    expect(s.board?.name).toBe('tiny')
    expect(s.imported?.warnings).toEqual(['a'])
    expect(setupIn({ imported: { above: 1 } }).imported).toBe(null)
    expect(setupIn(null).path).toBe('')
  })
})
