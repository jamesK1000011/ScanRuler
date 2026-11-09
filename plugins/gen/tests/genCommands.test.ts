// SPDX-License-Identifier: AGPL-3.0-only
// The Generate commands as an agent or the panel runs them, against a
// Reverse Engineer and a worker faked in genFakes: builds one at a time,
// a stop that ends those waiting too, bodies named after the part that
// stands where they do whatever order the file gave them, names that
// don't collide, a name of spaces refused, and a bin's magnets recorded
// with the Hardware workspace for their pause.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/commands/registry', () => import('./genFakes'))
vi.mock('../../../src/commands/schema', () => import('./genFakes'))
vi.mock('../../../src/commands/stateSections', () => import('./genFakes'))
vi.mock('../../../src/plugins/api', () => import('./genFakes'))
vi.mock('../app/genClient', () => import('./genFakes'))

import { builds, calls, handlers, sections } from './genFakes'
import { genCommands } from '../app/genCommands'
import { useGen } from '../state/genStore'
import type { GenPart } from '../core/genWorker'

type Run = (input: Record<string, unknown>, ctx: unknown) => Promise<Record<string, any>> // eslint-disable-line @typescript-eslint/no-explicit-any
const ctx = { progress() {} }
const run = (name: string, input: Record<string, unknown> = {}) => (genCommands as unknown as { name: string; run: Run }[]).find((c) => c.name === name)!.run(input, ctx)
const tick = () => new Promise((r) => setTimeout(r, 0))

interface Body { id: number; name: string; bounds: { min: number[]; max: number[] } | null }
let bodies: Body[] = []
let nextId = 1
sections.reverse = () => ({ bodies })
const part = (name: string, x: number): GenPart => ({ name, volume: 1000, box: { min: [x, -30, 0], max: [x + 80, 30, 30] } })
// The import brings the file's solids in reversed, named as STEP files name them.
handlers['reverse.import.step'] = async () => {
  const made = (pending ?? []).slice().reverse()
  for (const p of made) bodies.push({ id: nextId++, name: 'Solid', bounds: { min: p.box.min, max: p.box.max } })
  return {}
}
handlers['reverse.body.set'] = async (i: { body: number; name: string }) => {
  if (bodies.some((b) => b.name.toLowerCase() === i.name.toLowerCase() && b.id !== i.body)) throw new Error('Name taken.')
  bodies.find((b) => b.id === i.body)!.name = i.name
  return {}
}
let pending: GenPart[] | null = null
function finish(parts: GenPart[], move?: [number, number, number]) {
  pending = parts
  builds.shift()!.done({ parts, step: 'ISO-10303-21;', ...(move ? { move } : {}) })
}
function fresh() {
  useGen.getState().reset()
  bodies = [{ id: 99, name: 'Box', bounds: null }]
  builds.length = 0
  calls.length = 0
}

describe('the Generate commands', () => {
  it('build one at a time, busy until the last', async () => {
    fresh()
    const a = run('measure')
    const b = run('measure')
    await tick()
    expect(builds.length).toBe(1)
    expect(useGen.getState().busy).toBe(true)
    builds.shift()!.done({ parts: [part('Gridfinity bin 1x1x3', 0)] })
    await a
    await tick()
    expect(builds.length).toBe(1)
    expect(useGen.getState().busy).toBe(true)
    builds.shift()!.done({ parts: [part('Gridfinity bin 1x1x3', 0)] })
    await b
    await tick()
    expect(useGen.getState().busy).toBe(false)
  })
  it('stop the build running and those waiting their turn', async () => {
    fresh()
    const a = run('measure').catch((e: Error) => e.message)
    const b = run('measure').catch((e: Error) => e.message)
    await tick()
    await run('stop')
    expect(await a).toBe('Stopped.')
    expect(await b).toBe('Stopped.')
    expect(builds.length).toBe(0)
    await tick()
    expect(useGen.getState().busy).toBe(false)
  })
  it('name each body after the part standing where it does, clear of names taken', async () => {
    fresh()
    const m = run('make', { generator: 'project_box' })
    await tick()
    finish([part('Box', 0), part('Lid', 90)])
    const r = await m
    // The body at x = 90 is the lid, though the file listed it first; a Box was there already.
    const lid = bodies.find((b) => b.bounds?.min[0] === 90)!
    const box = bodies.find((b) => b.bounds?.min[0] === 0)!
    expect(lid.name).toBe('Lid')
    expect(box.name).toBe('Box 2')
    expect(r.bodies.length).toBe(2)
  })
  it('refuse a name of spaces', async () => {
    fresh()
    let message = ''
    await run('make', { name: '   ' }).catch((e: Error) => (message = e.message))
    expect(message).toMatch(/name/)
    expect(builds.length).toBe(0)
  })
  it('a board enclosure takes its board: given, kept for the next, refused when none or for another part', async () => {
    fresh()
    const board = { name: 'tiny', outline: [[-25, -20], [25, -20], [25, 20], [-25, 20]], thickness: 1.6, above: 10, below: 2, holes: [{ x: -20, y: -15, d: 3.2 }], openings: [] }
    let message = ''
    await run('measure', { generator: 'board_box' }).catch((e: Error) => (message = e.message))
    expect(message).toMatch(/No board/)
    await run('make', { generator: 'project_box', board }).catch((e: Error) => (message = e.message))
    expect(message).toMatch(/takes no board/)
    await run('make', { generator: 'board_box', board: { ...board, thickness: -1 } }).catch((e: Error) => (message = e.message))
    expect(message).toMatch(/board\.thickness/)
    await run('make', { generator: 'board_box', board, params: { standoff: 2 } }).catch((e: Error) => (message = e.message))
    expect(message).toMatch(/too short for the parts under the board/)
    const m = run('make', { generator: 'board_box', board })
    await tick()
    expect(builds[0].ask.board).toEqual(board)
    finish([part('tiny box', 0), part('tiny lid', 90)])
    const r = await m
    expect(r.plan.standoffs[0]).toMatchObject({ screw: 'M3', hole: 4 })
    expect(useGen.getState().board).toEqual(board)
    // The board kept: the next needs none.
    const again = run('measure', { generator: 'board_box' })
    await tick()
    expect(builds[0].ask.board).toEqual(board)
    builds.shift()!.done({ parts: [part('tiny box', 0)] })
    expect((await again).plan.openings).toEqual([])
  })
  it('record a bin’s magnets with the Hardware workspace, in the same step, where it stands', async () => {
    fresh()
    const asked: Record<string, any>[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
    handlers['hw.record'] = async (i: Record<string, unknown>) => {
      asked.push(i)
      return { recorded: { id: `E${asked.length}` } }
    }
    const m = run('make', { generator: 'gridfinity_bin', params: { x: 2, y: 1, magnets: true } })
    await tick()
    finish([part('Gridfinity bin 2x1x3', 0)], [0, 50, 0])
    const r = await m
    expect(asked.length).toBe(1)
    const a = asked[0]
    expect([a.body, a.top, a.kind, a.size, a.what, a.span]).toEqual(['Gridfinity bin 2x1x3', 2.4, 'magnet', '6x2', '8 6x2 magnets', 6.5])
    // Four a cell, 13 off its centre, resting on the bed (2 thick); moved 50 in Y clear of what stood there.
    expect(a.at.length).toBe(8)
    expect(a.at.map((c: number[]) => c.join(',')).sort()).toEqual(['-34,37,1', '-34,63,1', '-8,37,1', '-8,63,1', '34,37,1', '34,63,1', '8,37,1', '8,63,1'])
    expect(r.encased).toEqual([{ id: 'E1', body: 'Gridfinity bin 2x1x3', what: '8 6x2 magnets', count: 8 }])
    expect(r.note).toContain('hw.pauses')
    // A baseplate's sit on its 0.6 floor, their holes' top at 3.
    const b = run('make', { generator: 'gridfinity_baseplate', params: { x: 1, y: 1, magnets: true } })
    await tick()
    finish([part('Gridfinity baseplate 1x1', 0)])
    await b
    expect([asked[1].top, asked[1].at[0][2], asked[1].at.length]).toEqual([3, 1.6, 4])
    // Without magnets, nothing recorded; without the Hardware workspace, said so.
    const c = run('make', { generator: 'gridfinity_bin', params: { x: 1, y: 1, magnets: false } })
    await tick()
    finish([part('Gridfinity bin 1x1x3', 0)])
    expect((await c).encased).toBe(undefined)
    expect(asked.length).toBe(2)
    delete handlers['hw.record']
    const d = run('make', { generator: 'gridfinity_bin', params: { x: 1, y: 1, magnets: true } })
    await tick()
    finish([part('Gridfinity bin 1x1x3', 0)])
    expect((await d).note).toContain('Hardware workspace is not in this build')
  })
})
