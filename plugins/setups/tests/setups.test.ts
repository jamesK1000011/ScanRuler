// SPDX-License-Identifier: AGPL-3.0-only
// Setups: added, changed and removed as an agent does — a body in one
// setup of a kind at most, settings checked by their type, each change one
// undo step and undone — read back by the workspaces through the shared
// readers (a print setup's settings, its printer calibration); kept with
// the project, a setup of a kind not in the build carried as it was; and
// an older project opening with the print setup made of what it printed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerStateSection } from '../../../src/commands/stateSections'
import { refused, run, startHeadless, undoLabels, type Headless } from '../../../tests/commandKit'
import { PRINT_SETUP } from '../../_shared/printSetup'
import { readPrinterFit } from '../../_shared/readPrinterFit'
import { machineTolerance, registerSetupType, setupFor, setupValue, sharedSetupValue, type Setup } from '../../_shared/setups'
import { setupsSection } from '../app/projectSection'
import { migrated, nameFor, nextId, readSetups, settingsOver } from '../core/setups'
import { useSetups } from '../state/setupsStore'
import plugin from '../plugin'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const bodies = [
  { id: 1, name: 'Grip', visible: true },
  { id: 2, name: 'Case', visible: true },
  { id: 3, name: 'Skin', visible: true, surface: true },
]
let calibration: Json | undefined
let headless: Headless

beforeAll(async () => {
  headless = await startHeadless()
  plugin.install?.()
  registerSetupType(PRINT_SETUP)
  registerStateSection('reverse', () => ({ bodies }))
  registerStateSection('fits', () => (calibration ? { calibration } : {}))
})
afterAll(() => headless.stop())

function fresh() {
  useSetups.getState().reset()
  calibration = undefined
}

describe('the rules', () => {
  it('numbers past the highest id, and names past the first', () => {
    expect(nextId([])).toBe('S1')
    expect(nextId([{ id: 'S2', type: 'print', name: 'a', bodies: [] }, { id: 'odd', type: 'print', name: 'b', bodies: [] }])).toBe('S3')
    expect(nameFor('Print', [])).toBe('Print')
    expect(nameFor('Print', [{ id: 'S1', type: 'print', name: 'print', bodies: [] }])).toBe('Print 2')
  })

  it('checks settings by their type: normalized, null dropped, the unknown refused', () => {
    expect(settingsOver(PRINT_SETUP, { walls: 3 }, { nozzle: 0.6, layerHeight: 0.123456, walls: null })).toEqual({ nozzle: '0.6', layerHeight: 0.1235 })
    expect(settingsOver(PRINT_SETUP, {}, { kerf: 0.1 })).toMatch(/no setting kerf/)
    expect(settingsOver(PRINT_SETUP, {}, { up: 'sideways' })).toMatch(/up is one of/)
    expect(settingsOver(PRINT_SETUP, {}, { bodies: [] })).toMatch(/setup’s own/)
    // A kind not in this build: kept as given.
    expect(settingsOver(undefined, {}, { kerf: 0.1 })).toEqual({ kerf: 0.1 })
  })

  it('reads a file’s setups: a setting that no longer checks let go, a kind not in the build kept whole', () => {
    const read = readSetups({ setups: [{ id: 'S1', type: 'print', name: ' Brackets ', bodies: ['Grip', 'Grip', 3], nozzle: 0.4, up: 'sideways' }, { id: 'S2', type: 'mill', name: 'Shafts', bodies: ['Case'], grade: 7 }] }, (id) => (id === 'print' ? PRINT_SETUP : undefined))
    expect(read).toEqual([
      { id: 'S1', type: 'print', name: 'Brackets', bodies: ['Grip'], nozzle: '0.4' },
      { id: 'S2', type: 'mill', name: 'Shafts', bodies: ['Case'], grade: 7 },
    ])
    expect(readSetups({ setups: [{ id: 'S1', type: 'print' }, { id: 'S1', type: 'print' }] }, () => undefined)).toMatch(/share the id S1/)
    expect(readSetups({}, () => undefined)).toMatch(/no list/)
  })

  it('an older project opens with a print setup of what it printed; one that printed nothing with none', () => {
    expect(migrated({ review: { spec: { processes: { Grip: 'fdm', Plate: 'laser-cut', Lid: 'print' } } }, 'dfm-fdm': { settings: { target: 'body', body: 'Case' } } })).toEqual([{ id: 'S1', type: 'print', name: 'Print', bodies: ['Grip', 'Lid', 'Case'] }])
    expect(migrated({ 'dfm-fdm': { settings: { target: 'scan', body: null } } })).toEqual([{ id: 'S1', type: 'print', name: 'Print', bodies: [] }])
    // Not the page it was saved on: New Project's blank file names the page on screen.
    expect(migrated({ workspace: 'slice' })).toEqual([])
    expect(migrated({ workspace: 'reverse', review: { spec: { processes: { Plate: 'laser-cut' } } } })).toEqual([])
  })
})

describe('setup.*', () => {
  it('adds, changes and removes — a step each, all undone', async () => {
    fresh()
    const before = undoLabels().length
    const a = await run<Json>('setup.add', { type: 'print', bodies: ['Grip', 2], settings: { nozzle: 0.6, layerHeight: 0.28 } })
    expect(a.added).toEqual({ id: 'S1', type: 'print', name: 'Print', bodies: ['Grip', 'Case'], settings: { nozzle: '0.6', layerHeight: 0.28 } })
    expect(useSetups.getState().selected).toBe('S1')
    await run('setup.set', { id: 'Print', name: 'PETG print', remove: ['case'], settings: { layerHeight: null, walls: 3 } })
    expect(useSetups.getState().setups).toEqual([{ id: 'S1', type: 'print', name: 'PETG print', bodies: ['Grip'], nozzle: '0.6', walls: 3 }])
    await run('setup.add', { type: 'print', name: 'Case print', bodies: ['Case'] })
    await run('setup.remove', { id: 'S1' })
    expect(useSetups.getState().setups.map((s) => s.id)).toEqual(['S2'])
    expect(undoLabels().length - before).toBe(4)
    await run('history.undo')
    expect(useSetups.getState().setups.map((s) => s.id)).toEqual(['S1', 'S2'])
    await run('history.undo')
    await run('history.undo')
    expect(useSetups.getState().setups).toEqual([{ id: 'S1', type: 'print', name: 'Print', bodies: ['Grip', 'Case'], nozzle: '0.6', layerHeight: 0.28 }])
    await run('history.undo')
    expect(useSetups.getState().setups).toEqual([])
    await run('history.redo')
    expect(useSetups.getState().setups.map((s) => s.name)).toEqual(['Print'])
  })

  it('a body is in one setup of a kind at most; the rest refused with the reason', async () => {
    fresh()
    await run('setup.add', { type: 'print', bodies: ['Grip'] })
    expect((await refused('setup.add', { type: 'print', bodies: ['grip'] })).message).toMatch(/Grip is in Print \(S1\)/)
    expect((await refused('setup.add', { type: 'print', bodies: ['Nope'] })).code).toBe('invalid_input')
    expect((await refused('setup.add', { type: 'print', bodies: ['Skin'] })).message).toMatch(/surface/)
    expect((await refused('setup.add', { type: 'weld' })).code).toBe('not_found')
    expect((await refused('setup.add', { type: 'print', settings: { infill: 120 } })).message).toMatch(/infill/)
    expect((await refused('setup.set', { id: 'S9', name: 'x' })).code).toBe('not_found')
    expect((await refused('setup.set', { id: 'S1' })).message).toMatch(/Give something to change/)
    expect((await refused('setup.set', { id: 'S1', bodies: ['Case'], add: ['Grip'] })).message).toMatch(/not both/)
    expect((await refused('setup.add', { type: 'print', name: 'print' })).message).toMatch(/named print already/)
  })

  it('setup.of and setup.list say how a body is made and what kinds there are', async () => {
    fresh()
    await run('setup.add', { type: 'print', bodies: ['Grip'], settings: { up: '-z' } })
    expect(await run('setup.of', { body: 1 })).toEqual({ body: 'Grip', setups: [{ id: 'S1', type: 'print', name: 'Print', bodies: ['Grip'], settings: { up: '-z' } }] })
    expect((await run<Json>('setup.of', { body: 'Case' })).none).toMatch(/in no setup/)
    const l = await run<Json>('setup.list')
    expect(l.selected).toBe('S1')
    const print = l.types.find((t: Json) => t.id === 'print')
    expect(print.pages).toEqual(['dfm', 'slice', 'print'])
    expect(print.checks).toEqual(['dfm.check', 'hw.pauses'])
    expect(Object.keys(print.settings)).toEqual(['printer', 'nozzle', 'up', 'layerHeight', 'firstLayer', 'walls', 'infill', 'lineMm', 'fit'])
  })
})

describe('what the workspaces read', () => {
  it('a body’s setup and its settings; several bodies’ only when they agree', async () => {
    fresh()
    await run('setup.add', { type: 'print', name: 'A', bodies: ['Grip'], settings: { layerHeight: 0.2, walls: 2 } })
    await run('setup.add', { type: 'print', name: 'B', bodies: ['Case'], settings: { layerHeight: 0.2, walls: 4 } })
    expect(setupFor('grip')?.name).toBe('A')
    expect(setupFor(2)?.name).toBe('B')
    expect(setupFor('Grip', 'cut')).toBe(null)
    expect(setupValue('Grip', 'walls')?.value).toBe(2)
    expect(setupValue('Grip', 'infill')).toBe(null)
    expect(setupValue('Nobody', 'walls')).toBe(null)
    expect(sharedSetupValue(['Grip', 'Case'], 'layerHeight')?.value).toBe(0.2)
    expect(sharedSetupValue(['Grip', 'Case'], 'walls')).toBe(null)
    expect(sharedSetupValue(['Grip', 'Lid'], 'layerHeight')).toBe(null)
  })

  it('the printer calibration: a print setup’s own, else Fits’; the machine’s tolerance', async () => {
    fresh()
    calibration = { hole: 0.3, shaft: 0.1, source: 'measured', at: '2026-01-02' }
    await run('setup.add', { type: 'print', name: 'A', bodies: ['Grip'] })
    expect(readPrinterFit('Grip')?.at).toBe('2026-01-02')
    expect(machineTolerance({ body: 'Grip' })).toMatchObject({ kind: 'print', fit: { hole: 0.3 } })
    // Fits' calibration kept with the setup: it stays when Fits' moves on.
    await run('setup.set', { id: 'A', settings: { fit: 'fits' } })
    calibration = { hole: 0.5, shaft: 0.2, source: 'entered' }
    expect(readPrinterFit('Grip')).toMatchObject({ hole: 0.3, at: '2026-01-02' })
    expect(readPrinterFit('Case')).toMatchObject({ hole: 0.5 })
    expect(readPrinterFit()).toMatchObject({ hole: 0.5 })
    expect(machineTolerance({ setup: 'a' })).toMatchObject({ kind: 'print', fit: { hole: 0.3 } })
    expect(machineTolerance({ setup: 'gone' })).toBe(null)
    calibration = undefined
    expect((await refused('setup.add', { type: 'print', settings: { fit: 'fits' } })).message).toMatch(/Fits has no calibration/)
  })
})

describe('the project file', () => {
  it('keeps the setups and the one shown, and reads them back', () => {
    fresh()
    // Written with none too: taken away, they do not come back as an older project's.
    const none = setupsSection.collect({} as never)!
    expect(none).toEqual({ version: 1, setups: [], selected: null })
    expect(setupsSection.hasContent!(none)).toBe(false)
    setupsSection.prepare(none, { manifest: { 'dfm-fdm': { settings: {} } } } as never)()
    expect(useSetups.getState().setups).toEqual([])
    const s: Setup[] = [{ id: 'S1', type: 'print', name: 'Print', bodies: ['Grip'], walls: 3 }, { id: 'S2', type: 'mill', name: 'Shafts', bodies: [], grade: 7 }]
    useSetups.getState().replace(s, 'S2')
    const saved = setupsSection.collect({} as never)
    expect(saved).toEqual({ version: 1, setups: s, selected: 'S2' })
    useSetups.getState().reset()
    setupsSection.prepare(saved, { manifest: {} } as never)()
    expect(useSetups.getState().setups).toEqual(s)
    expect(useSetups.getState().selected).toBe('S2')
    let why = ''
    try {
      setupsSection.prepare({ version: 2 }, { manifest: {} } as never)
    } catch (e) {
      why = (e as Error).message
    }
    expect(why).toMatch(/not one this ScanRuler reads/)
  })

  it('a project from before setups opens with the print setup of what it printed, shown', () => {
    fresh()
    setupsSection.prepare(undefined, { manifest: { review: { version: 1, spec: { processes: { Grip: 'fdm' } } } } } as never)()
    expect(useSetups.getState().setups).toEqual([{ id: 'S1', type: 'print', name: 'Print', bodies: ['Grip'] }])
    expect(useSetups.getState().selected).toBe('S1')
    setupsSection.prepare(undefined, { manifest: { workspace: 'elements' } } as never)()
    expect(useSetups.getState().setups).toEqual([])
  })
})
