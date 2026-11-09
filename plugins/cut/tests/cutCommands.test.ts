// SPDX-License-Identifier: AGPL-3.0-only
// cut.* against Reverse Engineer's commands faked by name, as part.review's
// tests fake them: a plate read as a sheet part through its faces and its
// section at mid-thickness, judged by its cut setup's figures (and the
// input's over them, and the material's where both leave one unset); a
// part that is not a sheet part; the file from a setup's parts, copies
// laid out, compensated or not; the review running cut.check on a part in
// a cut setup; and the setup's kerf as Fits takes it.
import { beforeAll, describe, expect, it } from 'vitest'
import { registerCommands, runCommand } from '../../../src/commands/registry'
import { registerStateSection } from '../../../src/commands/stateSections'
import type { Command } from '../../../src/commands/types'
import { useAssigned } from '../../_shared/materials/assigned'
import { machineTolerance, registerSetupType, type Setup } from '../../_shared/setups'
import { reviewCommands } from '../../review/app/reviewCommands'
import { cutCommands } from '../app/cutCommands'
import { CUT_SETUP } from '../app/cutSchemas'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const bodies = [
  { id: 1, name: 'Plate', visible: true },
  { id: 2, name: 'Block', visible: true },
]
let setups: Setup[] = []
let selected: string | null = null
const asked: Json[] = []

/** A 60 × 40 plate, 3 thick, a hole of 2 at (15, 20) and one of 8 at
 *  (40, 20) — as the kernel's section answers it, a sheet on z = 1.5. */
const plateSection = {
  plane: { origin: [0, 0, 1.5], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] },
  levels: [
    {
      chains: [
        { closed: true, pieces: [{ kind: 'circle', center: [15, 20], radius: 1 }] },
        {
          closed: true,
          pieces: [
            { kind: 'line', a: [0, 0], b: [60, 0] },
            { kind: 'line', a: [60, 0], b: [60, 40] },
            { kind: 'line', a: [60, 40], b: [0, 40] },
            { kind: 'line', a: [0, 40], b: [0, 0] },
          ],
        },
        { closed: true, pieces: [{ kind: 'circle', center: [40, 20], radius: 4 }] },
      ],
    },
  ],
}
const plateFaces = [
  { index: 0, kind: 'plane', area: 2400, centroid: [30, 20, 3], normal: [0, 0, 1] },
  { index: 1, kind: 'plane', area: 2400, centroid: [30, 20, 0], normal: [0, 0, -1] },
  { index: 2, kind: 'plane', area: 180, centroid: [30, 0, 1.5], normal: [0, -1, 0] },
  { index: 3, kind: 'cylinder', area: 19, centroid: [15, 20, 1.5], axis: [0, 0, 1] },
]
/** A block with a pocket: not a sheet part. */
const blockFaces = [...plateFaces, { index: 4, kind: 'plane', area: 100, centroid: [30, 20, 1], normal: [0, 0, 1] }]

function fake(full: string, run: (input: Json) => unknown): void {
  const [ns, ...rest] = full.split('.')
  const command: Command = { name: rest.join('.'), title: full, description: 'A fake.', input: { type: 'object' }, readOnly: true, headless: true, run: async (input) => run(input as Json) }
  registerCommands(ns, [command] as Command<never>[])
}

beforeAll(() => {
  registerCommands('cut', cutCommands)
  registerCommands('part', reviewCommands)
  registerSetupType(CUT_SETUP)
  registerStateSection('reverse', () => ({ bodies }))
  registerStateSection('setups', () => ({ setups, selected }))
  fake('reverse.body.describe', (i) => ({ bodies: [{ faceList: i.body === 2 ? blockFaces : plateFaces }] }))
  fake('reverse.body.section', (i) => {
    asked.push(i)
    return plateSection
  })
})

function fresh(): void {
  setups = []
  selected = null
  asked.length = 0
  useAssigned.setState({ assigned: {} })
}
const run = (name: string, input: Json = {}) => runCommand(`cut.${name}`, input) as Promise<Json>
async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  return 'no refusal'
}

describe('cut.check', () => {
  it('reads the plate as a sheet part through the middle of its sheet, by the material’s figures', async () => {
    fresh()
    useAssigned.setState({ assigned: { '1': 'steel-generic' } })
    const r = await run('check', { body: 'Plate' })
    expect(asked[0].plane).toEqual({ kind: 'oriented', point: [0, 0, 1.5], normal: [0, 0, 1] })
    expect(r).toMatchObject({ body: 'Plate', setup: null, machine: 'laser', thickness: 3, material: { category: 'metal' }, profile: { flat: true, pieces: 1, holes: 2, size: [[60, 40]] } })
    expect(r.figures).toMatchObject({ kerf: 0.15, minFeature: 3, assumed: ['kerf', 'minFeature'] })
    expect(r.findings.map((f: Json) => [f.severity, f.rule])).toEqual([
      ['warning', 'hole'],
      ['info', 'thickness'],
    ])
    expect(r.findings[0].at).toEqual([15, 20, 1.5])
    expect(r).toMatchObject({ errors: 0, warnings: 1 })
  })

  it('goes by its cut setup, the input over it', async () => {
    fresh()
    setups = [{ id: 'S1', type: 'cut', name: 'Plates', bodies: ['1'], machine: 'plasma', thickness: 2, sheet: [50, 100] }]
    const r = await run('check', { body: 1 })
    expect(r.setup).toBe('Plates (S1)')
    expect(r.machine).toBe('plasma')
    const rules = r.findings.map((f: Json) => f.rule)
    expect(rules).toContain('thickness')
    expect(rules).toContain('sheet')
    expect(r.findings.find((f: Json) => f.rule === 'sheet').says).toMatch(/turned 90°/)
    const over = await run('check', { body: 1, machine: 'laser', thickness: 3, minFeature: 1 })
    expect(over.findings.map((f: Json) => f.rule)).toEqual(['hole-thickness', 'sheet', 'material'])
  })

  it('a part that is not a sheet part: the pocket floor named', async () => {
    fresh()
    const r = await run('check', { body: 'Block' })
    expect(r.profile.flat).toBe(false)
    expect(r.findings[0]).toMatchObject({ severity: 'error', rule: 'flat', at: [30, 20, 1] })
    expect(r.findings[0].says).toMatch(/^face 4: a flat face 2 in from the top/)
  })

  it('refuses a body that is not there', async () => {
    fresh()
    expect(await refusal(run('check', { body: 'Nope' }))).toMatch(/No body "Nope"/)
  })
})

describe('cut.export', () => {
  it('a setup’s parts as DXF, copies laid out; SVG; compensated', async () => {
    fresh()
    setups = [{ id: 'S1', type: 'cut', name: 'Plates', bodies: ['1'], kerf: 0.2 }]
    const d = await run('export', { setup: 'Plates' })
    expect(d.file.name).toBe('Plate-cut.dxf')
    const text = new TextDecoder().decode(d.file.bytes)
    expect(text.split('\nCIRCLE\n')).toHaveLength(3)
    expect(text.split('\nLINE\n')).toHaveLength(5)
    expect(d).toMatchObject({ sheets: 1, compensated: false, kerf: 0.2, gap: 3 })
    const two = await run('export', { bodies: [{ body: 'Plate', count: 2 }], format: 'svg', compensate: true, gap: 10 })
    expect(two.file.name).toBe('Plate-cut.svg')
    expect(two.placed.map((p: Json) => p.name)).toEqual(['Plate 1', 'Plate 2'])
    const svg = new TextDecoder().decode(two.file.bytes)
    expect(svg).toMatch(/r="0.9"/)
    expect(svg).toMatch(/r="3.9"/)
    expect(two.compensated).toBe(true)
  })

  it('takes the setup the Make tab shows; says what to name without one', async () => {
    fresh()
    expect(await refusal(run('export', {}))).toMatch(/no cut setup/)
    setups = [
      { id: 'S1', type: 'cut', name: 'A', bodies: ['1'] },
      { id: 'S2', type: 'cut', name: 'B', bodies: [] },
    ]
    expect(await refusal(run('export', {}))).toMatch(/Say which parts/)
    selected = 'S2'
    expect(await refusal(run('export', {}))).toMatch(/B \(S2\) has no parts/)
    selected = 'S1'
    expect((await run('export', {})).placed).toHaveLength(1)
  })

  it('a part that is not a sheet part is drawn by its section, and said', async () => {
    fresh()
    const r = await run('export', { bodies: ['Block'] })
    expect(r.notes[0]).toMatch(/^Block is not a sheet part/)
  })
})

describe('part.review', () => {
  it('judges a part in a cut setup by cut.check, under made', async () => {
    fresh()
    setups = [{ id: 'S1', type: 'cut', name: 'Plates', bodies: ['1'], thickness: 2 }]
    const r = (await runCommand('part.review', { body: 'Plate' })) as Json
    expect(r.process).toBe('cut')
    expect(r.made).toEqual({ setup: 'Plates (S1)', checks: { 'cut.check': 'ran' } })
    expect(r.findings.find((f: Json) => f.source === 'cut.check' && f.severity === 'error').says).toBe('the part is 3 thick; the setup’s sheet is 2')
    expect(r.verdict).toBe('fix')
  })
})

describe('the cut setup', () => {
  it('cut.rules answers the figures by machine, material and thickness', async () => {
    expect(await run('rules', { machine: 'waterjet', material: 'glass', thickness: 10 })).toMatchObject({ kerf: 0.9, minFeature: 5 })
  })

  it('gives Fits its kerf: its own, else its machine’s in its first part’s material; and whether compensated', () => {
    fresh()
    setups = [
      { id: 'S1', type: 'cut', name: 'A', bodies: ['1'], kerf: 0.3, compensate: true },
      { id: 'S2', type: 'cut', name: 'B', bodies: ['2'], machine: 'waterjet' },
    ]
    expect(machineTolerance({ setup: 'S1' })).toEqual({ kind: 'kerf', kerf: 0.3, compensated: true, tolerance: 0.1 })
    expect(machineTolerance({ setup: 'S2' })).toEqual({ kind: 'kerf', kerf: 0.9, compensated: false, tolerance: 0.1 })
    expect(CUT_SETUP.settings.machine.check('saw')).toMatch(/machine is one of/)
    expect(CUT_SETUP.settings.sheet.normalize!([100.00001, 50])).toEqual([100, 50])
    expect(CUT_SETUP.checks![0].input!({ id: 7, name: 'X' })).toEqual({ body: 7 })
  })
})
