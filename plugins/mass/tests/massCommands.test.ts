// SPDX-License-Identifier: AGPL-3.0-only
// The Mass commands as an agent or the panel runs them, against a Reverse
// Engineer faked in massFakes: a body weighed once however often it is
// named, a calibration that is one step and stays in range, a target with
// a part dropped, a plan made again when the body changed, the walls round
// the pocket counted, a pocket too narrow for BBs, feature names that don't
// collide, a stale plan refused, weighings that overlap, the parts
// encased in the print counted, and each body weighed in its own material —
// solid, or as printed only in a print setup.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/commands/registry', () => import('./massFakes'))
vi.mock('../../../src/commands/schema', () => import('./massFakes'))
vi.mock('../../../src/commands/stateSections', () => import('./massFakes'))
vi.mock('../../../src/plugins/api', () => import('./massFakes'))

import { calls, handlers, sections } from './massFakes'
import { describeMass, massCommands } from '../app/massCommands'
import { useMass } from '../state/massStore'
import { useAssigned } from '../../_shared/materials/assigned'

type Run = (input: Record<string, unknown>, ctx: unknown) => Promise<Record<string, any>> // eslint-disable-line @typescript-eslint/no-explicit-any
const run = (name: string, input: Record<string, unknown> = {}) => (massCommands as unknown as { name: string; run: Run }[]).find((c) => c.name === name)!.run(input, { progress() {} })

function box(min: number[], max: number[]): number[] {
  const [x0, y0, z0] = min, [x1, y1, z1] = max
  const q = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d]
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

interface Body { id: number; name: string; visible: boolean; volume: number; faces: number }
let bodies: Body[] = []
let features: { name: string }[] = []
const geo: Record<number, number[]> = {}
let delay = 0
sections.reverse = () => ({ bodies, features })
handlers['reverse.export.stl'] = async (i: { bodies: number[] }) => {
  if (delay) await new Promise((r) => setTimeout(r, delay))
  return { file: { bytes: stl(geo[i.bodies[0]]) } }
}
handlers['reverse.feature.add'] = async (i: { features: { name: string }[] }) => {
  features.push(...i.features.map((f) => ({ name: f.name })))
  return { ok: true }
}
let encased: unknown = null
sections.hw = () => ({ encased })
let setups: unknown[] = []
sections.setups = () => setups
function fresh() {
  setups = []
  useAssigned.getState().reset()
  delete handlers['hw.masses']
  encased = null
  useMass.getState().reset()
  bodies = [{ id: 1, name: 'Grip', visible: true, volume: 48000, faces: 6 }]
  geo[1] = box([-20, -15, 0], [20, 15, 40])
  features = []
  calls.length = 0
  delay = 0
}
async function refused(p: Promise<unknown>, re: RegExp) {
  let message = ''
  try {
    await p
  } catch (e) {
    message = e instanceof Error ? e.message : String(e)
  }
  expect(message).toMatch(re)
}

describe('the Mass commands', () => {
  it('weigh a body named twice once, by its id', async () => {
    fresh()
    const a = await run('properties', { bodies: ['Grip'] })
    const b = await run('properties', { bodies: ['Grip', 'Grip'] })
    expect(b.total.mass).toBe(a.total.mass)
    expect(b.bodies.length).toBe(1)
    expect((calls[0].input.bodies as number[])[0]).toBe(1)
  })
  it('calibrate in one step, from the figures uncalibrated, within range, for one body', async () => {
    fresh()
    const worked = (await run('properties')).total.mass
    let steps = 0
    const stop = useMass.subscribe((s, p) => void (s.scale !== p.scale && steps++))
    await run('calibrate', { grams: worked * 1.1 })
    stop()
    expect(steps).toBe(1)
    expect(useMass.getState().reading).toBe(null)
    expect(useMass.getState().scale).toBeCloseTo(1.1, 3)
    await run('calibrate', { grams: worked * 1.1 })
    expect(useMass.getState().scale).toBeCloseTo(1.1, 3)
    await refused(run('calibrate', { grams: worked * 9 }), /5 times off/)
    bodies.push({ id: 2, name: 'Magnet', visible: true, volume: 1, faces: 6 })
    geo[2] = box([0, 0, 0], [1, 1, 1])
    await refused(run('calibrate', { grams: 10 }), /say which was printed/)
    await run('setup', { infill: 0, walls: 0 })
    await refused(run('calibrate', { grams: 10, body: 'Grip' }), /no mass/)
  })
  it('take a material picked alone as its own density', async () => {
    fresh()
    await run('setup', { density: 2 })
    expect(useMass.getState().density).toBe(2)
    await run('setup', { material: 'petg' })
    expect(useMass.getState().density).toBe(undefined)
  })
  it('take the shared materials, and tpu as tpu-95a', async () => {
    fresh()
    await run('setup', { material: 'tpu' })
    expect(useMass.getState().material).toBe('tpu-95a')
    expect((await run('materials')).materials['tpu-95a']).toEqual({ label: 'TPU 95A', density: 1.21 })
  })
  it('drop a part of the target given as null, and the target with both gone', async () => {
    fresh()
    await run('target', { mass: 100, com: [1, 2, 3] })
    await run('target', { mass: 120, com: null })
    expect(useMass.getState().target).toEqual({ mass: 120 })
    await run('target', { mass: null })
    expect(useMass.getState().target).toBe(null)
  })
  it('plan again on a body changed since it was weighed, its walls counted', async () => {
    fresh()
    await run('properties')
    await run('target', { mass: 60, com: [0, 0, 20] })
    geo[1] = box([-20, -15, 0], [20, 15, 60])
    bodies = [{ ...bodies[0], volume: 72000 }]
    const r = await run('ballast')
    expect(useMass.getState().reading!.total.com[2]).toBe(30)
    expect(r.pocket.fits).toBe(true)
    expect(r.pocket.wallMass).toBeGreaterThan(0)
  })
  it('size a pocket from its depth alone; refuse one too narrow for BBs; leave none when a plan fails', async () => {
    fresh()
    await run('target', { mass: 25 })
    const w = await run('ballast', { depth: 2 })
    expect(w.pocket.size[1]).toBe(2)
    expect(w.pocket.fits).toBe(false)
    expect(w.pocket.why).toContain('too narrow')
    await run('target', { mass: 1 })
    await refused(run('ballast'), /ballast only adds/)
    expect(useMass.getState().pocket).toBe(null)
  })
  it('cut under a name not taken, into the body by id, once; refuse a stale plan', async () => {
    fresh()
    await run('target', { mass: 30 })
    features = [{ name: 'Ballast' }]
    await run('ballast')
    const a = await run('apply')
    expect(a.cut.extrude).toBe('Ballast 2')
    expect((calls.at(-1)!.input.features as { target?: number }[])[1].target).toBe(1)
    expect(useMass.getState().pocket).toBe(null)
    await run('ballast')
    bodies = [{ ...bodies[0], volume: 47000 }]
    await refused(run('apply'), /changed since/)
  })
  it('count the parts encased in the body: in the total, its balance point and inertia, listed apart', async () => {
    fresh()
    const plain = await run('properties')
    const m = plain.total.mass
    const I = (x: number) => [
      [x, 0, 0],
      [0, x, 0],
      [0, 0, x],
    ]
    handlers['hw.masses'] = async (i: { bodies: string[] }) => ({
      parts: i.bodies.includes('Grip') ? [{ id: 'E1', body: 'Grip', what: 'a 10x5 magnet', material: 'NdFeB', mass: 3, centres: [[10, 0, 35], [-10, 0, 35]], inertia: I(50) }] : [],
      uncounted: [{ id: 'E2', body: 'Grip', what: 'a tag' }],
    })
    encased = [{ id: 'E1' }, { id: 'E2' }]
    const r = await run('properties')
    expect(r.bodies[0].mass).toBe(plain.bodies[0].mass)
    expect(r.embeddedMass).toBe(6)
    expect(r.total.mass).toBeCloseTo(m + 6, 3)
    expect(r.total.com[2]).toBeCloseTo((m * 20 + 6 * 35) / (m + 6), 3)
    expect(r.embedded).toEqual([{ id: 'E1', body: 'Grip', what: 'a 10x5 magnet', count: 2, material: 'NdFeB', mass: 6, com: [0, 0, 35], inertia: [[100, 0, 0], [0, 700, 0], [0, 0, 700]] }])
    // Two 3 g magnets 10 off the axis, 15 above the plastic's centre.
    const d = 35 - r.total.com[2]
    const dp = r.total.com[2] - 20
    expect(r.total.inertia[1][1]).toBeCloseTo(plain.total.inertia[1][1] + m * dp * dp + 700 + 6 * d * d, 1)
    expect(r.note).toContain('a tag in Grip (E2)')
    expect(describeMass().reading!.stale).toBe(undefined)
    // Another part encased since: the reading is stale.
    encased = [{ id: 'E1' }]
    expect(describeMass().reading!.stale).toBe(true)
    // Weighed on the scales with its magnets in: they come off the grams.
    await run('calibrate', { grams: m * 1.1 + 6 })
    expect(useMass.getState().scale).toBeCloseTo(1.1, 3)
    await refused(run('calibrate', { grams: 5 }), /no more than the parts encased/)
  })
  it('stay busy while any weighing runs, and keep no reading of a setup since changed', async () => {
    fresh()
    delay = 30
    const a = run('properties')
    const b = new Promise((r) => setTimeout(r, 10)).then(() => run('properties'))
    await a
    expect(useMass.getState().busy).not.toBe(null)
    await b
    expect(useMass.getState().busy).toBe(null)
    const c = run('properties')
    await run('setup', { infill: 50 })
    await c
    expect(useMass.getState().reading).toBe(null)
  })
  it('weigh each body in its own material: a metal solid, a filament as printed only in a print setup', async () => {
    fresh()
    bodies.push({ id: 2, name: 'Plate', visible: true, volume: 1000, faces: 6 })
    geo[2] = box([30, 0, 0], [40, 10, 10])
    // None set: as before, printed in the Mass setup's material, said so.
    const none = await run('properties')
    expect(none.note).toMatch(/No material set on Grip, Plate — assumed PLA as printed/)
    expect(none.bodies[0].assumed).toBe(true)
    useAssigned.getState().assign({ '2': 'steel-s235jr', '1': 'pla' })
    const solid = await run('properties')
    expect(solid.bodies[1]).toMatchObject({ body: 'Plate', material: 'S235JR', as: 'solid', density: 7.8 })
    expect(solid.bodies[1].mass).toBeCloseTo(7.8, 3)
    expect(solid.bodies[0]).toMatchObject({ material: 'PLA', as: 'solid' })
    expect(solid.bodies[0].mass).toBeCloseTo(48000 * 1.24e-3, 2)
    expect(solid.note).toBeUndefined()
    expect(solid.density).toBeUndefined()
    // In a print setup: walls and infill — the setup's where it gives them.
    setups = [{ id: 'p1', type: 'print', name: 'Plate 1', bodies: ['1'], infill: 15, walls: 2 }]
    const printed = await run('properties')
    expect(printed.bodies[0].as).toBe('printed')
    expect(printed.bodies[0].mass < solid.bodies[0].mass * 0.6).toBe(true)
    expect(printed.bodies[1].mass).toBeCloseTo(7.8, 3)
    // A body moved to a setup that does not print it weighs solid again.
    setups = [{ id: 'c1', type: 'cut', name: 'Laser', bodies: ['1', '2'] }]
    expect((await run('properties')).bodies[0].mass).toBeCloseTo(48000 * 1.24e-3, 2)
    // A calibration is for a printed part.
    await refused(run('calibrate', { grams: 9, body: 'Plate' }), /calibration scales a printed part/)
  })
  it('weigh a body with no material, in a print setup, with the setup’s walls and infill', async () => {
    fresh()
    const own = await run('properties')
    setups = [{ id: 'S1', type: 'print', name: 'Grip print', bodies: ['1'], infill: 100 }]
    const solid = await run('properties')
    expect(solid.bodies[0]).toMatchObject({ as: 'printed', assumed: true })
    expect(solid.total.mass).toBeCloseTo(48000 * 1.24e-3, 1)
    expect(solid.total.mass > own.total.mass).toBe(true)
    // Its name kept from an older project counts the same.
    setups = [{ id: 'S1', type: 'print', name: 'Grip print', bodies: ['Grip'], infill: 100 }]
    expect((await run('properties')).total.mass).toBe(solid.total.mass)
  })
  it('keep no reading once a body’s material changes', async () => {
    fresh()
    await run('properties')
    expect(describeMass().reading?.stale).toBeUndefined()
    useAssigned.getState().assign({ '1': 'aluminum-generic' })
    expect(describeMass().reading?.stale).toBe(true)
  })
})
