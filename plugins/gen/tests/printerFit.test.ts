// SPDX-License-Identifier: AGPL-3.0-only
// Generate's holes, gaps and margins follow the printer's fit calibration
// from Fits — read through Fits' part of the session — moved by its
// difference from the typical printer: a hole by the hole figure, a lid's
// gap by both walls' share, a gap round a bought board or connector by the
// printed wall's. A value set or given is kept; printerFit: false builds
// with the defaults; the answers say which calibration was used.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/commands/registry', () => import('./genFakes'))
vi.mock('../../../src/commands/schema', () => import('./genFakes'))
vi.mock('../../../src/commands/stateSections', () => import('./genFakes'))
vi.mock('../../../src/plugins/api', () => import('./genFakes'))
vi.mock('../app/genClient', () => import('./genFakes'))

import { builds, sections } from './genFakes'
import { genCommands } from '../app/genCommands'
import { boardBoxPlan, boardIn, BOARD_BOX_DEFAULTS } from '../core/boardBox'
import { generatorOf } from '../core/generators'
import { calibratedDefaults } from '../core/printerFit'
import { useGen } from '../state/genStore'
import { printerFitOf } from '../../_shared/printerFit'

type Run = (input: Record<string, unknown>, ctx: unknown) => Promise<Record<string, any>> // eslint-disable-line @typescript-eslint/no-explicit-any
const ctx = { progress() {} }
const run = (name: string, input: Record<string, unknown> = {}) => (genCommands as unknown as { name: string; run: Run }[]).find((c) => c.name === name)!.run(input, ctx)
const tick = () => new Promise((r) => setTimeout(r, 0))

// Fits' calibration as Fits holds it: holes print 0.3 small, shafts 0.2 big.
const CAL = { hole: 0.3, shaft: 0.2, source: 'print-fit', at: '2026-11-08', profile: 'MK4, PETG' }
const board = { name: 'tiny', outline: [[-25, -20], [25, -20], [25, 20], [-25, 20]], thickness: 1.6, above: 10, below: 2, holes: [{ x: -20, y: -15, d: 3.2 }], openings: [] }

/** The values the next build was asked with. */
async function asked(input: Record<string, unknown>) {
  const m = run('measure', input)
  await tick()
  const b = builds.shift()!
  b.done({ parts: [{ name: 'part', volume: 1, box: { min: [0, 0, 0], max: [1, 1, 1] } }] })
  return { params: b.ask.params as Record<string, number | boolean>, answer: await m }
}
function fresh(cal: Record<string, unknown> | null) {
  useGen.getState().reset()
  builds.length = 0
  sections.fits = () => (cal ? { calibration: cal } : {})
}

describe('the calibrated defaults', () => {
  it('move each hole, gap and margin by the calibration’s difference from the typical printer', () => {
    const f = printerFitOf(CAL)
    expect(calibratedDefaults(generatorOf('board_box')!, f)).toEqual({ clearance: 0.3, gap: 1.05, margin: 0.55, holes: 0.1 })
    expect(calibratedDefaults(generatorOf('gridfinity_bin')!, f)).toEqual({ holes: 0.1 })
    expect(calibratedDefaults(generatorOf('project_box')!, f)).toEqual({ clearance: 0.3, holes: 0.1 })
    expect(calibratedDefaults(generatorOf('board_box')!, null)).toEqual({})
  })
  it('stay within each parameter’s range', () => {
    const big = printerFitOf({ hole: 2, shaft: 2, source: 'entered' })
    expect(calibratedDefaults(generatorOf('project_box')!, big)).toEqual({ clearance: 1, holes: 1 })
  })
  it('a hole allowance opens the standoffs’ insert holes', () => {
    const b = boardIn(board)
    expect(boardBoxPlan({ ...BOARD_BOX_DEFAULTS }, b).standoffs[0]).toMatchObject({ hole: 4 })
    expect(boardBoxPlan({ ...BOARD_BOX_DEFAULTS, holes: 0.1 }, b).standoffs[0]).toMatchObject({ hole: 4.1 })
  })
})

describe('the gen.* commands', () => {
  it('build with the calibration and say which they used', async () => {
    fresh(null)
    const plain = await asked({ generator: 'board_box', board })
    expect(plain.params).toMatchObject({ clearance: 0.2, gap: 1, margin: 0.5, holes: 0 })
    expect(plain.answer.printerFit).toBe(undefined)
    fresh(CAL)
    const r = await asked({ generator: 'board_box', board })
    expect(r.params).toMatchObject({ clearance: 0.3, gap: 1.05, margin: 0.55, holes: 0.1 })
    expect(r.answer.printerFit).toBe('printer fits from 2026-11-08 (MK4, PETG)')
    expect(r.answer.plan.standoffs[0]).toMatchObject({ hole: 4.1 })
  })
  it('keep a value given or set by hand', async () => {
    fresh(CAL)
    const given = await asked({ generator: 'project_box', params: { clearance: 0.15 } })
    expect(given.params).toMatchObject({ clearance: 0.15, holes: 0.1 })
    expect(given.answer.calibrated).toEqual({ holes: 0.1 })
    await run('set', { generator: 'project_box', params: { holes: 0.4 } })
    // Only what was set by hand is kept: the calibration's values follow it.
    expect(useGen.getState().values.project_box).toEqual({ holes: 0.4 })
    expect((await asked({ generator: 'project_box' })).params).toMatchObject({ clearance: 0.3, holes: 0.4 })
  })
  it('printerFit: false builds with the defaults, on a call or as the setting', async () => {
    fresh(CAL)
    expect((await asked({ generator: 'gridfinity_bin', printerFit: false })).params.holes).toBe(0)
    await run('set', { generator: 'gridfinity_bin', printerFit: false })
    expect(useGen.getState().printerFit).toBe(false)
    const off = await asked({ generator: 'gridfinity_bin' })
    expect(off.params.holes).toBe(0)
    expect(off.answer.printerFit).toBe(undefined)
    const l = await run('list', { generator: 'gridfinity_bin' })
    expect(l.generators[0].values.holes).toBe(0)
  })
})
