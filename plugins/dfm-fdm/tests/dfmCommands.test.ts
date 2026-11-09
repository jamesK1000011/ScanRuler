// SPDX-License-Identifier: AGPL-3.0-only
// The dfm commands against a stage and app faked in dfmFakes: a part not on
// the stage told apart from a session with no viewport; a body checked as it
// stands after an edit, picked by name or as the one shown; and a reference
// part made from a body that has changed since, checked as an older copy;
// and a body's walls read, a magnet's thin skin found.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/commands/host', () => import('./dfmFakes'))
vi.mock('../../../src/commands/schema', () => import('./dfmFakes'))
vi.mock('../../../src/commands/registry', () => import('./dfmFakes'))
vi.mock('../../../src/commands/stateSections', () => import('./dfmFakes'))
vi.mock('../../../src/plugins/api', () => import('./dfmFakes'))
vi.mock('../../../src/state/store', () => import('./dfmFakes'))
vi.mock('../../../src/state/deviationStore', () => import('./dfmFakes'))
vi.mock('../../../src/state/thicknessStore', () => import('./dfmFakes'))

import { app, calls, deviation, handlers, sections, stage } from './dfmFakes'
import { dfmCommands } from '../app/dfmCommands'
import { useDfm } from '../state/dfmStore'

type Run = (input: Record<string, unknown>, ctx: unknown) => Promise<Record<string, any>> // eslint-disable-line @typescript-eslint/no-explicit-any
const run = (name: string, input: Record<string, unknown> = {}) => (dfmCommands as unknown as { name: string; run: Run }[]).find((c) => c.name === name)!.run(input, { progress() {} })

function box(min: number[], max: number[], inward = false): number[] {
  const [x0, y0, z0] = min, [x1, y1, z1] = max
  const q = (a: number[], b: number[], c: number[], d: number[]) => (inward ? [...a, ...d, ...c, ...a, ...c, ...b] : [...a, ...b, ...c, ...a, ...c, ...d])
  return [
    ...q([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]),
    ...q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]),
    ...q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]),
    ...q([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]),
    ...q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]),
    ...q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]),
  ]
}
function stl(t: number[]): Uint8Array {
  const n = t.length / 9
  const b = new Uint8Array(84 + n * 50)
  const dv = new DataView(b.buffer)
  dv.setUint32(80, n, true)
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + i * 50 + 12 + k * 4, t[i * 9 + k], true)
  return b
}

interface Body { id: number; name: string; visible: boolean; surface?: boolean; stamp?: string }
let bodies: Body[] = []
const geo: Record<number, number[]> = {}
sections.reverse = () => ({ bodies })
handlers['reverse.export.stl'] = async (i: { bodies: number[] }) => ({ file: { bytes: stl(geo[i.bodies[0]]) }, bodies: bodies.filter((b) => b.id === i.bodies[0]).map((b) => ({ id: b.id, name: b.name, stamp: b.stamp })) })

function fresh() {
  bodies = [{ id: 1, name: 'Grip', visible: true, stamp: 'a1' }]
  geo[1] = box([-20, -15, 0], [20, 15, 40])
  useDfm.getState().reset()
  Object.assign(stage, { scene: true, scan: null, reference: null })
  Object.assign(app, { fileName: null, busy: false, statusText: '' })
  Object.assign(deviation, { nominalName: null, nominalBusy: false, nominalMadeFrom: null })
  calls.length = 0
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return (e as { code?: string }).code ?? 'none'
  }
  return 'ok'
}

describe('a part that is not there to check', () => {
  it('needs the page when there is no viewport, and is not on the stage otherwise', async () => {
    fresh()
    app.fileName = 'part.stl'
    stage.scene = false
    expect(await codeOf(run('check'))).toBe('unavailable')
    stage.scene = true
    expect(await codeOf(run('check'))).toBe('invalid_state')
    app.busy = true
    expect(await codeOf(run('check'))).toBe('busy')
  })
  it('the same for the reference part', async () => {
    fresh()
    useDfm.getState().set({ target: 'reference' })
    expect(await codeOf(run('check'))).toBe('invalid_state')
    deviation.nominalName = 'bracket.stl'
    stage.scene = false
    expect(await codeOf(run('check'))).toBe('unavailable')
    stage.scene = true
    expect(await codeOf(run('check'))).toBe('invalid_state')
    deviation.nominalBusy = true
    expect(await codeOf(run('check'))).toBe('busy')
  })
})

describe('a body', () => {
  it('is checked as it stands now, edits and all', async () => {
    fresh()
    await run('settings', { target: 'body' })
    const before = await run('check')
    expect(before.part).toBe('Grip')
    expect(before.stamp).toBe('a1')
    expect((calls[0].input.bodies as number[])[0]).toBe(1)
    expect(before.findings.filter((f: { rule: string }) => f.rule === 'tall-thin')).toEqual([])
    geo[1] = box([-2, -2, 0], [2, 2, 60])
    bodies = [{ ...bodies[0], stamp: 'b2' }]
    const after = await run('check')
    expect(after.stamp).toBe('b2')
    expect(after.findings.find((f: { rule: string }) => f.rule === 'tall-thin')?.value).toBe(15)
    expect(useDfm.getState().checked).toEqual({ target: 'body', part: 'Grip', stamp: 'b2', wall: { least: 4, limit: 0.8 } })
  })
  it('is the one shown, or the one named; a body not there is refused', async () => {
    fresh()
    bodies.push({ id: 2, name: 'Cap', visible: true, stamp: 'c3' }, { id: 3, name: 'Skin', visible: true, surface: true })
    geo[2] = box([0, 0, 0], [10, 10, 5])
    await run('settings', { target: 'body' })
    expect(await codeOf(run('check'))).toBe('invalid_input')
    expect(await codeOf(run('settings', { body: 'Lid' }))).toBe('not_found')
    await run('settings', { body: 'Cap' })
    expect((await run('check')).part).toBe('Cap')
    expect(await codeOf(run('settings', { body: 3 }))).toBe('invalid_input')
    bodies = [{ id: 2, name: 'Cap', visible: true }, { id: 1, name: 'Grip', visible: false }]
    await run('settings', { body: null })
    expect((await run('check')).part).toBe('Cap')
  })
  it('needs Reverse engineer in the build', async () => {
    fresh()
    const was = sections.reverse
    sections.reverse = undefined
    await run('settings', { target: 'body' })
    expect(await codeOf(run('check'))).toBe('unavailable')
    sections.reverse = was
  })
})

describe('a reference part made from a body', () => {
  it('is an older copy once the body has changed', async () => {
    fresh()
    const t = box([-20, -15, 0], [20, 15, 40])
    stage.reference = { positions: Float32Array.from(t), indices: Uint32Array.from(t.map((_, i) => i).slice(0, t.length / 3)) }
    Object.assign(deviation, { nominalName: 'Bodies.stl', nominalMadeFrom: { by: 'reverse', parts: [{ id: 1, name: 'Grip', stamp: 'a1' }] } })
    await run('settings', { target: 'reference' })
    const same = await run('check')
    expect(same.part).toBe('Bodies.stl')
    expect(same.stale).toBe(undefined)
    bodies = [{ ...bodies[0], stamp: 'b2' }]
    const older = await run('check')
    expect(older.stale).toMatch(/^Checked an older copy: Grip changed/)
    expect(useDfm.getState().checked?.stale).toBe(older.stale)
    const md = new TextDecoder().decode((await run('report')).file.bytes)
    expect(md).toContain('Checked an older copy')
    bodies = []
    expect((await run('check')).stale).toMatch(/Grip changed/)
  })
  it('a body not meshed yet is not taken as changed, nor is a file opened as the reference', async () => {
    fresh()
    const t = box([-20, -15, 0], [20, 15, 40])
    stage.reference = { positions: Float32Array.from(t), indices: Uint32Array.from(t.map((_, i) => i).slice(0, t.length / 3)) }
    Object.assign(deviation, { nominalName: 'Bodies.stl', nominalMadeFrom: { by: 'reverse', parts: [{ id: 1, name: 'Grip', stamp: 'a1' }] } })
    bodies = [{ id: 1, name: 'Grip', visible: true }]
    await run('settings', { target: 'reference' })
    expect((await run('check')).stale).toBe(undefined)
    deviation.nominalMadeFrom = null
    bodies = [{ id: 1, name: 'Grip', visible: true, stamp: 'zz' }]
    expect((await run('check')).stale).toBe(undefined)
  })
})

describe('the walls of a body', () => {
  it('are read, and a magnet sealed under a thin skin is found', async () => {
    fresh()
    await run('settings', { target: 'body' })
    const solid = await run('check')
    expect([solid.wall.least, solid.wall.over, solid.wall.limit]).toEqual([null, 6.4, 0.8])
    expect(solid.wall.spacing).toBeGreaterThanOrEqual(0.4)
    expect(solid.wall.samples).toBeLessThanOrEqual(150_000)
    expect(useDfm.getState().checked?.wall).toEqual({ least: null, limit: 0.8 })
    geo[1] = [...box([0, 0, 0], [30, 20, 6]), ...box([5, 5, 2], [15, 15, 5.6], true)]
    const r = await run('check')
    expect(r.wall.least).toBe(0.4)
    expect(r.wall.thin).toBe(true)
    const thin = r.findings.filter((f: { rule: string }) => f.rule === 'thin-wall')
    expect(thin).toHaveLength(1)
    expect(thin[0].value).toBe(0.4)
    expect(r.skipped?.some((x: { rule: string }) => x.rule === 'thin-wall') ?? false).toBe(false)
  })
  it('are not read when the rule is off or not asked for', async () => {
    fresh()
    await run('settings', { target: 'body' })
    expect((await run('check', { only: ['overhang'] })).wall).toBe(undefined)
    await run('rules', { action: 'set', rule: 'thin-wall', disabled: true })
    expect((await run('check')).wall).toBe(undefined)
  })
})
