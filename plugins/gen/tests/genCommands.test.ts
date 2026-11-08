// SPDX-License-Identifier: AGPL-3.0-only
// The Generate commands as an agent or the panel runs them, against a
// Reverse Engineer and a worker faked in genFakes: builds one at a time,
// a stop that ends those waiting too, bodies named after the part that
// stands where they do whatever order the file gave them, names that
// don't collide, and a name of spaces refused.
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
function finish(parts: GenPart[]) {
  pending = parts
  builds.shift()!.done({ parts, step: 'ISO-10303-21;' })
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
})
