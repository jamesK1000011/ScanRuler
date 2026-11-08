// SPDX-License-Identifier: AGPL-3.0-only
// The Boards commands as an agent or the panel runs them, against a faked
// server, Reverse Engineer and Generate: a board opened and imported, its
// bodies named (the board after its file, connectors after their
// references, names that don't collide); the enclosure made through
// gen.make with the board measured, moved where the board came in off its
// place; settings checked against Generate's own; the fab package handed
// back as a zip; Stop ending an ask.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/commands/registry', () => import('./pcbFakes'))
vi.mock('../../../src/commands/schema', () => import('./pcbFakes'))
vi.mock('../../../src/commands/stateSections', () => import('./pcbFakes'))
vi.mock('../../../src/plugins/api', () => import('./pcbFakes'))
vi.mock('../app/pcbAsk', () => import('./pcbFakes'))

import { asked, calls, handlers, sections, server } from './pcbFakes'
import { pcbCommands } from '../app/pcbCommands'
import { usePcb } from '../state/pcbStore'

type Run = (input: Record<string, unknown>, ctx: unknown) => Promise<Record<string, any>> // eslint-disable-line @typescript-eslint/no-explicit-any
const ctx = { progress() {} }
const run = (name: string, input: Record<string, unknown> = {}) => (pcbCommands as unknown as { name: string; run: Run }[]).find((c) => c.name === name)!.run(input, ctx)

const PATH = '/boards/tiny.kicad_pcb'
const BOARD = {
  name: 'tiny',
  file: PATH,
  thickness: 1.6,
  origin: [125, 120],
  size: [50, 40],
  outline: [[-25, 20], [25, 20], [25, -20], [-25, -20]],
  holes: [{ ref: 'H1', x: -20, y: -15, d: 3.2, plated: false, from: 'footprint' }],
  connectors: [{ ref: 'J1', value: 'USB_C', footprint: 'Connector_USB:USB_C_Receptacle_X', kind: 'usb_c', label: 'USB-C receptacle', x: 0, y: 16.8, rot: 0, face: 'top', side: '+y', inset: -0.8, centre: 0, box: { min: [-5, 13.3], max: [5, 20.8] }, opening: { width: 8.94, height: 3.26, zc: 1.63, shape: 'rect', typical: true } }],
  footprints: { count: 3, top: 3, bottom: 0 },
  components: [{ ref: 'J1' }, { ref: 'H1' }, { ref: 'R1' }],
}
const STEP = new TextEncoder().encode('ISO-10303-21;')

interface Body { id: number; name: string; bounds: { min: number[]; max: number[] } }
let bodies: Body[] = []
let nextId = 1
let shift = [0, 0, 0]
sections.reverse = () => ({ bodies })
const PARTS: [string, number[], number[]][] = [
  ['PCB', [-25, -20, 0], [25, 20, 1.6]],
  ['USB', [-4.47, 15.5, 1.6], [4.47, 21, 4.86]],
  ['R', [-1, -1, 1.6], [1, 1, 2.2]],
]
handlers['reverse.import.step'] = async () => {
  for (const [name, min, max] of PARTS) bodies.push({ id: nextId++, name, bounds: { min: min.map((v, i) => v + shift[i]), max: max.map((v, i) => v + shift[i]) } })
  return {}
}
handlers['reverse.body.set'] = async (i: { body: number; name: string }) => {
  if (bodies.some((b) => b.name.toLowerCase() === i.name.toLowerCase() && b.id !== i.body)) throw new Error('Name taken.')
  bodies.find((b) => b.id === i.body)!.name = i.name
  return {}
}
const BOX_PARAMS = [
  { key: 'standoff', kind: 'num', min: 1, max: 50 },
  { key: 'inserts', kind: 'bool' },
]
handlers['gen.list'] = async () => ({ generators: [{ params: BOX_PARAMS, defaults: { standoff: 5, inserts: true } }] })
handlers['gen.make'] = async (i: { board: { name: string } }) => ({ bodies: [`${i.board.name} box`, `${i.board.name} lid`], plan: { standoffs: [] }, parts: [] })
handlers['gen.measure'] = async () => ({ parts: [{ name: 'tiny box' }], plan: { standoffs: [] } })
handlers['reverse.feature.add'] = async () => ({})

server.read = () => ({ result: BOARD })
server.import = () => ({ result: { board: BOARD, kicad: '9.0.2', warnings: ['Could not add 3D model to R1.'] }, bytes: STEP })
server.fab = (d) => ({ result: { board: 'tiny', zip: '/h/boards/x/tiny-fab.zip', gerberZip: '/h/boards/x/tiny-gerbers.zip', job: '/h/boards/x', files: ['tiny.GTL'], naming: d.naming, drc: null, notes: [] }, bytes: new Uint8Array([0x50, 0x4b]) })
server.tools = () => ({ result: { found: true, ready: true, version: '9.0.2', path: '/k' } })

beforeEach(() => {
  bodies = [{ id: 99, name: 'tiny', bounds: { min: [100, 0, 0], max: [110, 10, 10] } }]
  nextId = 1
  shift = [0, 0, 0]
  calls.length = 0
  asked.length = 0
  usePcb.getState().reset()
})

describe('pcb commands', () => {
  it('open reads the board and keeps it without its parts list', async () => {
    const r = await run('open', { path: PATH })
    expect(r.board.holes.length).toBe(1)
    expect(usePcb.getState().path).toBe(PATH)
    expect((usePcb.getState().board as unknown as { components?: unknown }).components).toBe(undefined)
    await expect(run('open', { path: '/boards/tiny.step' })).rejects.toThrow(/not a KiCad board/)
  })
  it('import: bodies named, a taken name not reused, the reach measured', async () => {
    const r = await run('import', { path: PATH })
    expect(asked[0]).toMatchObject({ action: 'import', data: { path: PATH, components: true, subst: true, dnp: false } })
    expect(calls.find((c) => c.name === 'reverse.import.step')!.input).toMatchObject({ name: 'tiny.step' })
    // "tiny" was taken by a body already there.
    expect(r.board).toBe('tiny 2')
    expect(r.connectors).toEqual({ J1: 'tiny J1' })
    expect(r.above).toBe(3.26)
    expect(r.bodies).toBe(3)
    expect(r.warnings).toEqual(['Could not add 3D model to R1.'])
    const im = usePcb.getState().imported!
    expect(im.boxes.J1.max[2]).toBe(4.86)
    expect(calls.find((c) => c.name === 'reverse.body.set' && (c.input as { color?: string }).color)!.input).toMatchObject({ color: '#2e7d32' })
  })
  it('enclosure: through gen.make with the board measured, settings merged', async () => {
    await run('import', { path: PATH })
    await run('set', { enclosure: { standoff: 7 } })
    const r = await run('enclosure', { params: { inserts: false } })
    const make = calls.find((c) => c.name === 'gen.make')!.input as { generator: string; params: Record<string, unknown>; board: { above: number; openings: { side: string; z0: number; z1: number }[] } }
    expect(make.generator).toBe('board_box')
    expect(make.params).toEqual({ standoff: 7, inserts: false })
    expect(make.board.above).toBe(3.26)
    expect(make.board.openings[0]).toMatchObject({ side: '+y', z0: 1.6, z1: 4.86 })
    expect(r.bodies).toEqual(['tiny box', 'tiny lid'])
    expect(calls.some((c) => c.name === 'reverse.feature.add')).toBe(false)
    expect(usePcb.getState().enclosureMade?.bodies).toEqual(['tiny box', 'tiny lid'])
  })
  it('a board that came in off its place: the enclosure moved to it', async () => {
    shift = [0, 0, -1.6]
    await run('import', { path: PATH })
    await run('enclosure')
    expect(calls.find((c) => c.name === 'reverse.feature.add')!.input).toMatchObject({ kind: 'moveBody', bodies: ['tiny box', 'tiny lid'], translate: [0, 0, -1.6] })
  })
  it('set: checked against Generate’s own parameters; reset; skip', async () => {
    await expect(run('set', { enclosure: { floor2: 1 } })).rejects.toThrow(/no "floor2" \(it has standoff, inserts\)/)
    await expect(run('set', { enclosure: { standoff: 99 } })).rejects.toThrow(/standoff: a number, 1 to 50/)
    await expect(run('set', { enclosure: { inserts: 1 } })).rejects.toThrow(/true or false/)
    await run('set', { enclosure: { standoff: 6 }, skip: ['J1', ' J1 ', ''] })
    expect(usePcb.getState().skip).toEqual(['J1'])
    await run('set', { reset: true })
    expect(usePcb.getState().enclosure).toEqual({})
    // No Generate in this build: said so.
    const keep = handlers['gen.list']
    delete handlers['gen.list']
    await expect(run('set', { enclosure: { standoff: 6 } })).rejects.toThrow(/Generate workspace/)
    handlers['gen.list'] = keep
  })
  it('enclosure and plan without a board are refused', async () => {
    await expect(run('enclosure')).rejects.toThrow(/No board/)
    await expect(run('plan')).rejects.toThrow(/No board/)
    await run('open', { path: PATH })
    const p = await run('plan')
    expect(p.board.openings.length).toBe(1)
    expect(p.notes.some((n: string) => /guess/.test(n))).toBe(true)
  })
  it('fab: the zip handed back, the naming as set', async () => {
    await run('set', { path: PATH, naming: 'kicad' })
    const r = await run('fab')
    expect(asked[0]).toMatchObject({ action: 'fab', data: { naming: 'kicad', drc: true } })
    expect(r.file).toMatchObject({ name: 'tiny-fab.zip', mimeType: 'application/zip' })
    expect(r.file.bytes[0]).toBe(0x50)
    expect(usePcb.getState().fab?.files).toEqual(['tiny.GTL'])
  })
  it('stop ends the ask running', async () => {
    server.drc = () => new Promise(() => {})
    const going = run('drc', { path: PATH })
    await new Promise((r) => setTimeout(r, 10))
    const s = await run('stop')
    expect(s.stopped).toBe(true)
    await expect(going).rejects.toThrow(/Stopped/)
    expect(usePcb.getState().busy).toBe(null)
  })
  it('stop while the enclosure builds stops Generate’s build', async () => {
    await run('open', { path: PATH })
    let release: (v: unknown) => void = () => {}
    const keep = handlers['gen.make']
    handlers['gen.make'] = () => new Promise((r) => (release = r))
    handlers['gen.stop'] = async () => (release({ bodies: [] }), { stopped: true })
    const going = run('enclosure')
    await new Promise((r) => setTimeout(r, 10))
    expect((await run('stop')).stopped).toBe(true)
    expect(calls.some((c) => c.name === 'gen.stop')).toBe(true)
    await going
    handlers['gen.make'] = keep
  })
  it('a path pasted in quotes, and a board name a file cannot carry', async () => {
    await run('open', { path: `"${PATH}"` })
    expect(usePcb.getState().path).toBe(PATH)
    const keep = server.import
    server.import = () => ({ result: { board: { ...BOARD, name: 'a:b/c' }, warnings: [] }, bytes: STEP })
    const r = await run('import')
    expect(calls.find((c) => c.name === 'reverse.import.step')!.input).toMatchObject({ name: 'a b c.step' })
    expect(r.board).toBe('a b c')
    server.import = keep
  })
  it('close forgets the board, keeps the settings', async () => {
    await run('open', { path: PATH })
    await run('set', { naming: 'kicad' })
    await run('close')
    expect(usePcb.getState().board).toBe(null)
    expect(usePcb.getState().naming).toBe('kicad')
  })
})
