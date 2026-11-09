// SPDX-License-Identifier: AGPL-3.0-only
// The app run headless (src/headless/engine.ts), as scanruler-mcp runs it
// with --engine: started in this process with no page, it offers only the
// commands marked to run so, runs them, and turns any other away as
// needing the page — naming what does its work headless, where something
// does — whatever plugins the build has. And the design and build
// pipelines run there end to end: a part generated, a magnet encased in it,
// weighed, checked for printing, and measured against another part.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HeadlessEngine } from '../src/headless/engine'
import { listCommands, runsHeadless } from '../src/commands/registry'
import { CommandError } from '../src/commands/types'

vi.setConfig({ testTimeout: 60_000 })

let engine: HeadlessEngine

beforeAll(async () => {
  engine = await (await import('../src/headless/engine')).startEngine()
}, 120_000)
afterAll(() => engine?.stop())

describe('the app headless', () => {
  it('offers the commands marked to run without a page, and those alone', () => {
    const offered = engine.listCommands().map((c) => c.name)
    expect(offered).toEqual(expect.arrayContaining(['session.state', 'history.undo', 'history.redo']))
    expect(offered.every((name) => runsHeadless(name))).toBe(true)
    expect(offered).not.toContain('view.render')
    expect(offered).not.toContain('scan.open')
    // Every command is one or the other.
    expect(new Set([...offered, ...engine.pageCommands()])).toEqual(new Set(listCommands().map((c) => c.name)))
    expect(engine.app).toBe('ScanRuler')
  })

  it('runs them, and turns a command that needs the page away, naming it', async () => {
    const state = (await engine.run('session.state', {})) as { app: { viewport: boolean }; scan: unknown }
    expect(state.app.viewport).toBe(false)
    expect(state.scan).toBeNull()
    const refused = await engine.run('view.render', {}).then(
      () => null,
      (e: unknown) => e,
    )
    expect(refused).toBeInstanceOf(CommandError)
    expect((refused as CommandError).code).toBe('unavailable')
    expect((refused as CommandError).message).toMatch(/^view\.render needs the ScanRuler page .*headless/)
    const unknown = await engine.run('no.such', {}).then(
      () => null,
      (e: unknown) => e,
    )
    expect((unknown as CommandError).code).toBe('unknown_command')
  })

  it('names what does a page command’s work headless, where something does', async () => {
    const refused = (await engine.run('deviation.open_reference', { bytes: new Uint8Array(1), name: 'part.stl' }).then(
      () => null,
      (e: unknown) => e,
    )) as CommandError
    expect(refused.code).toBe('unavailable')
    expect(refused.message).toMatch(/Headless: .*reverse\.import\.step.*dfm\.settings \{ target: "body" \}/)
    expect(engine.insteadOf('deviation.open_reference')).toMatch(/reverse\.import\.step/)
    expect(engine.insteadOf('view.render')).toBeNull()
  })

  it('is one engine a process', async () => {
    expect(await (await import('../src/headless/engine')).startEngine()).toBe(engine)
  })
})

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const run = async (name: string, input: Json = {}) => (await engine.run(name, input)) as Json
const refusal = (name: string, input: Json = {}) =>
  engine.run(name, input).then(
    () => null,
    (e: unknown) => e as CommandError,
  )

/** Whatever plugins the build has: each step runs where its plugin is. */
const has = (...ids: string[]) => ids.every((id) => engine.plugins.includes(id))

describe('the design and build pipelines headless', () => {
  const BIN = { x: 2, y: 1, units: 3, magnets: true, floor: 5 }
  const bodies: string[] = []

  it('offers the workspaces’ commands that need no page, and keeps those that do to the page', () => {
    const offered = new Set(engine.listCommands().map((c) => c.name))
    const want = [
      ...(has('gen') ? ['gen.list', 'gen.measure', 'gen.make', 'gen.export', 'gen.set', 'gen.stop'] : []),
      ...(has('hw') ? ['hw.list', 'hw.set', 'hw.plan', 'hw.pattern', 'hw.embed', 'hw.apply', 'hw.check', 'hw.record', 'hw.pauses', 'hw.masses', 'hw.unembed'] : []),
      ...(has('mass') ? ['mass.materials', 'mass.setup', 'mass.properties', 'mass.target', 'mass.ballast', 'mass.apply'] : []),
      ...(has('dfm-fdm') ? ['dfm.settings', 'dfm.check', 'dfm.report', 'dfm.waive'] : []),
      ...(has('fea') ? ['fea.tools', 'fea.setup', 'fea.hold', 'fea.load', 'fea.solve', 'fea.results'] : []),
      ...(has('fits') ? ['fit.list', 'fit.pair', 'fit.calibrate', 'fit.snap', 'fit.apply'] : []),
      ...(has('pcb') ? ['pcb.open', 'pcb.import', 'pcb.plan', 'pcb.enclosure', 'pcb.drc', 'pcb.fab'] : []),
      ...(has('circuit') ? ['circuit.tools', 'circuit.new', 'circuit.build', 'circuit.bodies'] : []),
      ...(has('reverse') ? ['reverse.body.clearance', 'reverse.body.set'] : []),
    ]
    expect(want.filter((name) => !offered.has(name))).toEqual([])
    // What reads the scan or draws stays the page's.
    for (const name of ['fea.show', 'fit.measure', 'reverse.body.review', 'reverse.body.compare']) if (listCommands().some((c) => c.name === name)) expect(offered.has(name)).toBe(false)
  })

  it('makes a Gridfinity bin in Reverse Engineer, its magnets recorded for their pause', async () => {
    if (!has('gen', 'reverse')) return
    const sized = await run('gen.measure', { generator: 'gridfinity_bin', params: BIN })
    expect(sized.parts[0].volume).toBeGreaterThan(0)
    const made = await run('gen.make', { generator: 'gridfinity_bin', params: BIN, name: 'Headless bin' })
    expect(made.bodies).toEqual(['Headless bin'])
    bodies.push(made.bodies[0])
    const described = await run('reverse.body.describe', { body: 'Headless bin', edges: false, limit: 1 })
    expect(described.bodies[0].name).toBe('Headless bin')
    if (has('hw')) expect(made.encased?.length).toBeGreaterThan(0)
  }, 300_000)

  it('encases a magnet under the bin’s floor, and plans its pause', async () => {
    if (!has('hw') || !bodies.length) return
    const floor = (await run('reverse.body.describe', { body: bodies[0], edges: false, where: { kind: 'plane', between: [[0, 0, 1]], withinDeg: 3 }, sort: 'largest', limit: 1 })).bodies[0].faceList[0]
    await run('hw.set', { layerHeight: 0.2, firstLayer: 0.2 })
    const planned = await run('hw.embed', { kind: 'magnet', size: '6x2', at: { body: bodies[0], face: floor.index }, what: '6x2 magnet' })
    expect(planned.steps.length).toBeGreaterThan(0)
    const cut = await run('hw.apply', {})
    expect(cut.cut.body).toBe(bodies[0])
    expect(cut.encased.length).toBe(1)
    const pauses = await run('hw.pauses', { layerHeight: 0.2, firstLayer: 0.2 })
    expect(pauses.pauses.length).toBeGreaterThan(0)
    const checked = await run('reverse.body.check', { body: bodies[0] })
    expect(JSON.stringify(checked)).toMatch(/void/i)
  }, 300_000)

  it('weighs the bin, the encased parts counted', async () => {
    if (!has('mass') || !bodies.length) return
    await run('mass.setup', { material: 'pla', infill: 15, walls: 2, lineMm: 0.42 })
    const weighed = await run('mass.properties', { bodies: [bodies[0]] })
    expect(weighed.bodies[0].body).toBe(bodies[0])
    expect(weighed.bodies[0].mass).toBeGreaterThan(0)
    if (has('hw')) expect(weighed.embeddedMass).toBeGreaterThan(0)
  }, 300_000)

  it('checks the bin for printing as a body, and turns the scan away naming the body', async () => {
    if (!has('dfm-fdm') || !bodies.length) return
    await run('dfm.settings', { target: 'scan' })
    const scan = await refusal('dfm.check')
    expect(scan?.code).toBe('unavailable')
    expect(scan?.message).toMatch(/target: "body"/)
    await run('dfm.settings', { target: 'body', body: bodies[0] })
    const checked = await run('dfm.check', {})
    expect(checked.target).toBe('body')
    expect(checked.part).toBe(bodies[0])
    expect(typeof checked.verdict).toBe('string')
  }, 300_000)

  it('measures the bin against a second part made clear of it', async () => {
    if (!has('gen', 'reverse') || !bodies.length) return
    const other = await run('gen.make', { generator: 'gridfinity_bin', params: { x: 1, y: 1, units: 2 }, name: 'Headless cup' })
    bodies.push(other.bodies[0])
    const clearance = await run('reverse.body.clearance', { body: bodies[0], against: [bodies[1]] })
    expect(clearance.against[0].name).toBe(bodies[1])
    expect(clearance.against[0].gap).toBeGreaterThan(0)
    expect(clearance.pass).toBe(true)
  }, 300_000)
})

describe('the agent’s server the engine runs in', () => {
  it('is asked what the page asks it — the FEA tools here — and its answer taken as the page takes it', async () => {
    if (!has('fea')) return
    const asked: { kind: string; data: Json }[] = []
    const detach = engine.attach({
      version: '9.9.9',
      features: ['fea.solve'],
      notice: (kind, data) => {
        asked.push({ kind, data })
        if (kind === 'fea.solve' && data.action === 'tools') void engine.run('fea.answer', { req: data.req, ok: true, result: { gmsh: { found: true }, ccx: { found: true } } })
      },
    })
    try {
      const tools = await run('fea.tools', {})
      expect(tools.gmsh.found).toBe(true)
      expect(asked.map((a) => a.kind)).toEqual(['fea.solve'])
    } finally {
      detach()
    }
    // Unlinked: asked of no server, refused as a page with no agent is.
    const alone = await refusal('fea.tools')
    expect(alone?.message).toMatch(/agent connection/)
  })
})
