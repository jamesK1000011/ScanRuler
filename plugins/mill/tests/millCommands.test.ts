// SPDX-License-Identifier: AGPL-3.0-only
// mill.* against Reverse Engineer's commands (and dfm.wall) faked by name:
// a block read from its faces, edges and each face's triangles, judged from
// its mill setup's directions and tools (the input's over them, the
// defaults where both leave one unset); the wall against the material's
// least; a stock too small; the wall left unread where the build has no
// reader; the zip of STEP and setup sheet; and the setup's IT grade as
// Fits takes it.
import { beforeAll, describe, expect, it } from 'vitest'
import { registerCommands, runCommand } from '../../../src/commands/registry'
import { registerStateSection } from '../../../src/commands/stateSections'
import { CommandError, type Command } from '../../../src/commands/types'
import { useAssigned } from '../../_shared/materials/assigned'
import { machineTolerance, registerSetupType, type Setup } from '../../_shared/setups'
import { millCommands } from '../app/millCommands'
import { MILL_SETUP } from '../app/millSchemas'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const quad = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d]
/** A 40 × 40 × 20 block, a 10 × 10 pocket 15 deep in its top. */
const FACES: [Json, number[]][] = [
  [{ kind: 'plane', normal: [0, 0, -1], centroid: [20, 20, 0] }, quad([0, 0, 0], [0, 40, 0], [40, 40, 0], [40, 0, 0])],
  [{ kind: 'plane', normal: [0, 0, 1], centroid: [20, 20, 20] }, [...quad([0, 0, 20], [40, 0, 20], [40, 15, 20], [0, 15, 20]), ...quad([0, 25, 20], [40, 25, 20], [40, 40, 20], [0, 40, 20]), ...quad([0, 15, 20], [15, 15, 20], [15, 25, 20], [0, 25, 20]), ...quad([25, 15, 20], [40, 15, 20], [40, 25, 20], [25, 25, 20])]],
  [{ kind: 'plane', normal: [0, -1, 0], centroid: [20, 0, 10] }, quad([0, 0, 0], [40, 0, 0], [40, 0, 20], [0, 0, 20])],
  [{ kind: 'plane', normal: [0, 1, 0], centroid: [20, 40, 10] }, quad([0, 40, 0], [0, 40, 20], [40, 40, 20], [40, 40, 0])],
  [{ kind: 'plane', normal: [-1, 0, 0], centroid: [0, 20, 10] }, quad([0, 0, 0], [0, 0, 20], [0, 40, 20], [0, 40, 0])],
  [{ kind: 'plane', normal: [1, 0, 0], centroid: [40, 20, 10] }, quad([40, 0, 0], [40, 40, 0], [40, 40, 20], [40, 0, 20])],
  [{ kind: 'plane', normal: [0, 0, 1], centroid: [20, 20, 5] }, quad([15, 15, 5], [25, 15, 5], [25, 25, 5], [15, 25, 5])],
  [{ kind: 'plane', normal: [0, 1, 0], centroid: [20, 15, 12.5] }, quad([15, 15, 5], [15, 15, 20], [25, 15, 20], [25, 15, 5])],
  [{ kind: 'plane', normal: [0, -1, 0], centroid: [20, 25, 12.5] }, quad([15, 25, 5], [25, 25, 5], [25, 25, 20], [15, 25, 20])],
  [{ kind: 'plane', normal: [1, 0, 0], centroid: [15, 20, 12.5] }, quad([15, 15, 5], [15, 25, 5], [15, 25, 20], [15, 15, 20])],
  [{ kind: 'plane', normal: [-1, 0, 0], centroid: [25, 20, 12.5] }, quad([25, 15, 5], [25, 15, 20], [25, 25, 20], [25, 25, 5])],
]
const faceList = FACES.map(([f], index) => ({ index, area: 1, ...f }))
const edgeList = [{ index: 0, kind: 'line', length: 15, mid: [15, 15, 12.5], dir: [0, 0, 1], faces: [7, 9] }]

const bodies = [{ id: 4, name: 'Block', visible: true }]
let setups: Setup[] = []
let wall: Json | null = { least: 0.4, at: [1, 2, 3] }

function fake(full: string, run: (input: Json) => unknown): void {
  const [ns, ...rest] = full.split('.')
  const command: Command = { name: rest.join('.'), title: full, description: 'A fake.', input: { type: 'object' }, readOnly: true, headless: true, run: async (input) => run(input as Json) }
  registerCommands(ns, [command] as Command<never>[])
}

beforeAll(() => {
  registerCommands('mill', millCommands)
  registerSetupType(MILL_SETUP)
  registerStateSection('reverse', () => ({ bodies }))
  registerStateSection('setups', () => ({ setups, selected: null }))
  fake('reverse.body.describe', () => ({ bodies: [{ faceList, edgeList }] }))
  fake('reverse.body.face_triangles', (i) => ({ triangles: new Float32Array(FACES[i.faces[0]][1]) }))
  fake('reverse.export.step', () => ({ file: { name: 'x.step', bytes: new TextEncoder().encode('ISO-10303-21;') } }))
  fake('dfm.wall', () => {
    if (!wall) throw new CommandError('unknown_command', 'No command dfm.wall.')
    return wall
  })
})

function fresh(): void {
  setups = []
  wall = { least: 0.4, at: [1, 2, 3] }
  useAssigned.setState({ assigned: {} })
}
const run = (name: string, input: Json = {}) => runCommand(`mill.${name}`, input) as Promise<Json>

describe('mill.check', () => {
  it('by the defaults: from above, the inside corner, the wall under the least, the stock round the part', async () => {
    fresh()
    useAssigned.setState({ assigned: { '4': 'aluminum-6061-t6' } })
    const r = await run('check', { body: 'Block' })
    expect(r).toMatchObject({ body: 'Block', setup: null, axes: '3', directions: ['+z'], tool: { minDiameter: 3, reach: 30 }, grade: 8, material: { category: 'metal' } })
    expect(r.stock).toMatchObject({ size: [44, 44, 24], fits: true, margin: 2 })
    expect(r.part.size).toEqual([40, 40, 20])
    expect(r.defaulted).toEqual(['axes', 'directions', 'minTool', 'reach', 'margin'])
    expect(r.findings.map((f: Json) => [f.severity, f.rule])).toEqual([
      ['info', 'stock-floor'],
      ['warning', 'inside-corner'],
      ['warning', 'thin-wall'],
    ])
    expect(r.wall).toEqual({ least: 0.4, min: 0.5, at: [1, 2, 3] })
    expect(r).toMatchObject({ errors: 0, warnings: 2 })
  })

  it('by its mill setup, the input over it: flipped, a stock too small, no wall reader', async () => {
    fresh()
    wall = null
    setups = [{ id: 'S1', type: 'mill', name: 'Machined', bodies: ['4'], directions: ['-z'], stock: [30, 30, 30], grade: 7 }]
    const r = await run('check', { body: 4, minTool: 12 })
    expect(r.setup).toBe('Machined (S1)')
    expect(r.grade).toBe(7)
    const rules = r.findings.map((f: Json) => f.rule)
    expect(rules[0]).toBe('stock')
    expect(rules.filter((x: string) => x === 'undercut')).toHaveLength(5)
    expect(r.findings.find((f: Json) => f.rule === 'thin-wall').says).toMatch(/^the wall was not read/)
    const both = await run('check', { body: 4, directions: ['+z', [0, 0, -1]], axes: '3' })
    expect(both.findings.find((f: Json) => f.rule === 'setups').says).toMatch(/refixtured 1 time/)
  })
})

describe('mill.export', () => {
  it('a zip of the STEP and the setup sheet, from the setup', async () => {
    fresh()
    setups = [{ id: 'S1', type: 'mill', name: 'Machined', bodies: ['4'], note: 'Datum A: underside' }]
    const r = await run('export', { setup: 'S1' })
    expect(r.file.name).toBe('Machined-mill.zip')
    expect(r.files).toEqual(['Machined.step', 'setup.json', 'setup.md'])
    expect(r.parts).toEqual([{ body: 'Block', errors: 0, warnings: 2 }])
    const bytes = r.file.bytes as Uint8Array
    expect(bytes[0]).toBe(0x50)
    const text = new TextDecoder().decode(bytes)
    expect(text).toMatch(/ISO-10303-21;/)
    expect(text).toMatch(/> Datum A: underside/)
  })
})

describe('the mill setup', () => {
  it('gives Fits its IT grade, IT8 unless set; its settings checked', () => {
    fresh()
    setups = [
      { id: 'S1', type: 'mill', name: 'A', bodies: [] },
      { id: 'S2', type: 'mill', name: 'B', bodies: [], grade: 6 },
    ]
    expect(machineTolerance({ setup: 'S1' })).toEqual({ kind: 'it', grade: 8 })
    expect(machineTolerance({ setup: 'S2' })).toEqual({ kind: 'it', grade: 6 })
    expect(MILL_SETUP.settings.directions.check(['+z', [0, 1, 0]])).toBe(null)
    expect(MILL_SETUP.settings.directions.check(['up'])).toMatch(/directions is a list/)
    expect(MILL_SETUP.settings.directions.normalize!(['+Z', [0, 0, -2], [1, 1, 0]])).toEqual(['+z', '-z', [0.707, 0.707, 0]])
    expect(MILL_SETUP.settings.grade.check(4)).toMatch(/grade is a whole number/)
  })
})
