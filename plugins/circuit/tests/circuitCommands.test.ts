// SPDX-License-Identifier: AGPL-3.0-only
// The Circuit commands as an agent or the panel runs them, against a server,
// a worker and a Reverse Engineer faked in circuitFakes: a board opened and
// measured, the resistance for a printed conductor, settings, a project
// fitted to the Generate workspace's box, a build that opens its board and
// one that fails, the solids brought in and named, and a stop.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/commands/registry', () => import('./circuitFakes'))
vi.mock('../../../src/commands/schema', () => import('./circuitFakes'))
vi.mock('../../../src/commands/stateSections', () => import('./circuitFakes'))
vi.mock('../../../src/plugins/api', () => import('./circuitFakes'))
vi.mock('../app/circuitClient', () => import('./circuitFakes'))
vi.mock('../app/circuitAsk', () => import('./circuitFakes'))

import { answers, asked, calls, handlers, sections, setSolidsAnswer, solids } from './circuitFakes'
import { circuitCommands } from '../app/circuitCommands'
import { useCircuit } from '../state/circuitStore'

type Run = (input: Record<string, unknown>, ctx: unknown) => Promise<Record<string, any>> // eslint-disable-line @typescript-eslint/no-explicit-any
const ctx = { progress() {} }
const cmd = (name: string) => (circuitCommands as unknown as { name: string; run: Run }[]).find((c) => c.name === name)!
const run = (name: string, input: Record<string, unknown> = {}) => cmd(name).run(input, ctx)
for (const c of circuitCommands as unknown as { name: string; run: Run }[]) handlers[`circuit.${c.name}`] = ((i: Record<string, unknown>) => c.run(i, ctx)) as never
const text = readFileSync(new URL('./fixtures/two-layer.circuit.json', import.meta.url), 'utf8')
const tick = () => new Promise((r) => setTimeout(r, 0))
const fails = async (p: Promise<unknown>, re: RegExp) => {
  let m = ''
  await p.catch((e: Error) => (m = e.message))
  expect(re.test(m)).toBe(true)
}

function fresh() {
  useCircuit.getState().reset()
  asked.length = 0
  calls.length = 0
  solids.length = 0
  for (const k of Object.keys(answers)) delete answers[k]
}

describe('the Circuit commands', () => {
  it('open a circuit.json given as text, and measure it', async () => {
    fresh()
    const r = await run('open', { json: text, name: 'blinky.circuit.json' })
    expect(r.stats.nets).toBe(3)
    expect(r.stats.minClearance.mm).toBe(0.7)
    expect(r.errors.length).toBe(1)
    expect(useCircuit.getState().loaded?.name).toBe('blinky.circuit.json')
    const s = await run('stats')
    expect(s.traces.count).toBe(3)
    await fails(run('open', { json: text, job: 'x' }), /one of job, path or json/)
    await fails(run('open', { json: '{}' }), /not a list/)
  })
  it('refuse figures with no board open', async () => {
    fresh()
    await fails(run('stats'), /No board is open/)
    await fails(run('resistance'), /No board is open/)
    await fails(run('bodies'), /No board is open/)
  })
  it('estimate the resistance for a printed conductor, at its own thickness or one set', async () => {
    fresh()
    await run('open', { json: text })
    const pp = await run('resistance', { conductor: 'protopasta' })
    expect(pp.thickness).toBe(0.6)
    expect(pp.conductor.typical).toBe(true)
    const t2 = pp.nets.flatMap((n: { traces: { trace: string; ohms: number }[] }) => n.traces).find((t: { trace: string }) => t.trace === 'trace_2')
    expect(t2.ohms).toBe(14000)
    await run('set', { conductor: 'electrifi', thickness: 1.2 })
    const el = await run('resistance')
    expect(el.thickness).toBe(1.2)
    expect(el.nets.flatMap((n: { traces: { trace: string; ohms: number }[] }) => n.traces).find((t: { trace: string }) => t.trace === 'trace_2').ohms).toBe(1.4)
    await run('set', { thickness: 0 })
    expect(useCircuit.getState().settings.thickness).toBe(null)
  })
  it('settings: parts merged, reset', async () => {
    fresh()
    await run('set', { parts: { keepouts: false }, copper: 0.6 })
    expect(useCircuit.getState().settings.parts).toEqual({ board: true, copperTop: true, copperBottom: true, keepouts: false })
    expect(useCircuit.getState().settings.copper).toBe(0.6)
    await run('set', { reset: true })
    expect(useCircuit.getState().settings.copper).toBe(0.035)
  })
  it('a board to fit the Generate workspace’s box: its inside, and its bosses where gen puts them', async () => {
    fresh()
    handlers['gen.list'] = (() => ({ generators: [{ values: { width: 80, depth: 60, height: 30, corner: 4, wall: 2, screws: true } }] })) as never
    answers.new = (a) => ({ project: `/home/me/.scanruler/circuits/${a.name}`, entry: 'index.circuit.tsx', values: a.params, files: [] })
    await run('new', { name: 'boxed', template: 'enclosure', fromBox: true, params: { clearance: 0.3 } })
    const p = asked.find((a) => a.action === 'new')!.args.params as Record<string, unknown>
    expect(p).toMatchObject({ inside_width: 76, inside_depth: 56, corner: 2, clearance: 0.3 })
    // inside corner 2 < 3.1: 0.4 mm into both walls, (36 − 1.1, 26 − 1.1).
    const ko = p.keepouts as { x: number; y: number; r: number }[]
    expect(ko.map((k) => [Math.round(k.x * 1e9) / 1e9, Math.round(k.y * 1e9) / 1e9, k.r])).toEqual([[-34.9, -24.9, 3.5], [34.9, -24.9, 3.5], [34.9, 24.9, 3.5], [-34.9, 24.9, 3.5]])
    expect(useCircuit.getState().project).toEqual({ folder: '/home/me/.scanruler/circuits/boxed', entry: 'index.circuit.tsx' })
    await fails(run('new', { name: 'x', template: 'led', fromBox: true }), /fromBox goes with the enclosure/)
  })
  it('build, then open the board built; a failed build is still the last', async () => {
    fresh()
    await fails(run('build'), /No project/)
    useCircuit.setState({ project: { folder: '/p/blinky', entry: null } })
    answers.build = () => ({ job: 'j1', folder: '/b/j1', ok: true, files: { 'circuit.json': '/b/j1/circuit.json', 'bom.csv': '/b/j1/bom.csv' }, summary: { errorCount: 0, warningCount: 2, errors: [] } })
    answers.read = () => ({ path: '/b/j1/circuit.json', text })
    const r = await run('build', { outputs: ['bom'] })
    expect(asked.find((a) => a.action === 'build')!.args).toEqual({ project: '/p/blinky', outputs: ['bom'] })
    expect(r.opened.stats.nets).toBe(3)
    expect(useCircuit.getState().lastBuild).toMatchObject({ job: 'j1', ok: true, files: ['circuit.json', 'bom.csv'], warnings: 2 })
    expect(useCircuit.getState().loaded?.from).toEqual({ job: 'j1' })
    answers.build = () => Promise.reject(Object.assign(new Error('tsci build wrote no circuit.json'), { result: { job: 'j2', folder: '/b/j2', ok: false } }))
    await fails(run('build'), /wrote no circuit\.json/)
    expect(useCircuit.getState().lastBuild).toMatchObject({ job: 'j2', ok: false })
    expect(useCircuit.getState().busy).toBe(false)
  })
  it('a build whose circuit.json holds errors has failed: said, kept as the last, its board not opened', async () => {
    fresh()
    useCircuit.setState({ project: { folder: '/p/blinky', entry: null } })
    const failure = 'The build has 1 error, so it failed. The first: close. Fix the board file and build again.'
    answers.build = () => ({ job: 'j3', folder: '/b/j3', ok: false, failure, files: { 'circuit.json': '/b/j3/circuit.json' }, errors: [{ type: 'pcb_trace_error', message: 'close' }], summary: { errorCount: 1, warningCount: 1, errors: [{ type: 'pcb_trace_error', message: 'close' }] } })
    answers.read = () => ({ path: '/b/j3/circuit.json', text })
    const r = await run('build')
    expect(r.ok).toBe(false)
    expect(r.failure).toBe(failure)
    expect(r.opened).toBe(undefined)
    expect(useCircuit.getState().loaded).toBe(null)
    expect(useCircuit.getState().lastBuild).toMatchObject({ job: 'j3', ok: false, failure, warnings: 1, errors: [{ type: 'pcb_trace_error', message: 'close' }] })
    // An older server that called such a build ok: judged failed all the same.
    answers.build = () => ({ job: 'j4', folder: '/b/j4', ok: true, files: { 'circuit.json': '/b/j4/circuit.json' }, summary: { errorCount: 2, warningCount: 0, errors: [] } })
    const old = await run('build')
    expect(old.ok).toBe(false)
    expect(old.failure).toMatch(/^The build has 2 errors, so it failed\./)
    expect(useCircuit.getState().lastBuild).toMatchObject({ job: 'j4', ok: false })
    expect(useCircuit.getState().loaded).toBe(null)
  })
  it('bring the solids in, each body named after the part standing where it does', async () => {
    fresh()
    await run('open', { json: text, name: 'blinky.circuit.json' })
    const part = (name: string, kind: string, x: number) => ({ name, kind, volume: 1, box: { min: [x, 0, 0], max: [x + 1, 1, 1] } as never })
    setSolidsAnswer({ parts: [part('Board', 'board', 0), part('Copper top 1', 'copper top', 10), part('Keep-out R1', 'keep-out', 20)] as never, notes: ['a note'], step: 'ISO-10303-21;' })
    let bodies = [{ id: 1, name: 'Board', bounds: null as unknown }]
    let next = 2
    sections.reverse = () => ({ bodies })
    // The import brings the solids in reversed, named as STEP files name them.
    handlers['reverse.import.step'] = (() => {
      for (const x of [20, 10, 0]) bodies.push({ id: next++, name: 'Solid', bounds: { min: [x, 0, 0], max: [x + 1, 1, 1] } })
      return {}
    }) as never
    handlers['reverse.body.set'] = ((i: { body: number; name: string }) => {
      bodies = bodies.map((b) => (b.id === i.body ? { ...b, name: i.name } : b))
      return {}
    }) as never
    const r = await run('bodies', { copper: 0.6 })
    expect(solids[0].ask.options).toMatchObject({ copper: 0.6, keepoutHeight: 3, board: true, keepouts: true })
    expect(r.bodies).toEqual(['Keep-out R1', 'Copper top 1', 'Board (2)'])
    expect(bodies.map((b) => b.name)).toEqual(['Board', 'Keep-out R1', 'Copper top 1', 'Board (2)'])
    expect(calls.find((c) => c.name === 'reverse.import.step')!.input.name).toBe('blinky.circuit.step')
    expect(useCircuit.getState().made?.notes).toEqual(['a note'])
    await fails(run('bodies', { parts: { board: false, copperTop: false, copperBottom: false, keepouts: false } }), /every part is off/)
  })
  it('stop a build waiting on the server', async () => {
    fresh()
    useCircuit.setState({ project: { folder: '/p/x', entry: null } })
    const b = run('build').catch((e: Error) => e.message)
    await tick()
    expect(useCircuit.getState().busy).toBe(true)
    const s = await run('stop')
    expect(s.stopped).toBe(true)
    expect(await b).toBe('Stopped.')
    expect(useCircuit.getState().busy).toBe(false)
  })
})
