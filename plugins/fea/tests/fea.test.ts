// SPDX-License-Identifier: AGPL-3.0-only
// The FEA study kept with a project — cleaned on the way in — the range a
// field is coloured over, and the material a study solves in: the body's
// own, as printed only in a print setup.
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import { feaSection } from '../app/projectSection'
import { DEFAULT_SETUP, setupOf, useFea } from '../state/feaStore'
import { rangeOf } from '../viewer/resultLayer'
import { densityOf, ensureMaterials, libraryMaterial, MATERIAL_ALIASES, MATERIAL_IDS, materialId, MATERIALS, resetMaterialLibrary } from '../../_shared/materials'
import { PRINTED } from '../../_shared/materials/printed'
import { useAssigned } from '../../_shared/materials/assigned'
import { registerStateSection } from '../../../src/commands/stateSections'
import { isotropicFigures, materialKeyOf, studyMaterial, studyMaterialReady } from '../app/feaMaterial'

describe('the study in a project', () => {
  test('round trip, and a hostile file cleaned', () => {
    useFea.getState().reset()
    expect(feaSection.collect({} as never)).toBeUndefined()
    useFea.getState().set({ body: 'Bracket', build: [1, 0, 0], holds: [{ name: 'Hold 1', faces: [2] }], loads: [{ name: 'Load 1', faces: [5], force: [0, 0, -10] }] })
    const saved = feaSection.collect({} as never)!
    useFea.getState().reset()
    feaSection.prepare(JSON.parse(JSON.stringify(saved)), {} as never)()
    expect(setupOf(useFea.getState())).toEqual(saved.setup)
    feaSection.prepare({ version: 1, setup: { body: 7, build: 'up', holds: [{ name: 'x' }, null, { name: 'ok', faces: [1] }], loads: [{ name: 'l', faces: [1] }], target: -3 } }, {} as never)()
    const s = setupOf(useFea.getState())
    expect(s.body).toBeNull()
    expect(s.build).toEqual(DEFAULT_SETUP.build)
    expect(s.holds).toEqual([{ name: 'ok', faces: [1] }])
    expect(s.loads).toEqual([])
    expect(s.target).toBe(DEFAULT_SETUP.target)
    expect(() => feaSection.prepare({ version: 2 }, {} as never)).toThrow()
  })
  test('own weight kept; an old material name read as its id now; a broken weight dropped', () => {
    useFea.getState().reset()
    useFea.getState().set({ body: 'Arm', gravity: { direction: [0, 0, -1], g: 3, from: 'material' } })
    const saved = feaSection.collect({} as never)!
    useFea.getState().reset()
    feaSection.prepare(JSON.parse(JSON.stringify(saved)), {} as never)()
    expect(useFea.getState().gravity).toEqual({ direction: [0, 0, -1], g: 3, from: 'material' })
    feaSection.prepare({ version: 1, setup: { material: 'tpu', gravity: { direction: [0, 0, 0] } } }, {} as never)()
    expect(useFea.getState().material).toBe('tpu-95a')
    expect(useFea.getState().gravity).toBeUndefined()
    feaSection.prepare({ version: 1, setup: { gravity: { direction: [0, 2, 0], g: -1, from: 'x' } } }, {} as never)()
    expect(useFea.getState().gravity).toEqual({ direction: [0, 1, 0], g: 1, from: 'mass' })
    useFea.getState().reset()
    expect(useFea.getState().gravity).toBeUndefined()
  })
})

describe('the shared materials', () => {
  test('one table: ids, aliases and densities', () => {
    expect(MATERIAL_IDS).toEqual(['pla', 'petg', 'abs', 'asa', 'petg-cf', 'pa6-cf', 'tpu-95a'])
    expect(materialId('tpu')).toBe('tpu-95a')
    expect(materialId('toString')).toBeUndefined()
    expect(densityOf('pla')).toBe(1.24)
  })
  test('the agent server’s copy matches: ids, labels, densities, aliases', () => {
    // mcp/src/extras/fea.js is plain JS and ships on its own: read as text.
    const js = readFileSync(new URL('../../../mcp/src/extras/fea.js', import.meta.url), 'utf8')
    const block = js.slice(js.indexOf('export const MATERIALS = {'), js.indexOf('\n}\n', js.indexOf('export const MATERIALS = {')))
    const server: Record<string, { label: string; density: number }> = {}
    for (const m of block.matchAll(/^\s*'?([a-z0-9-]+)'?: \{ label: '([^']+)', density: ([0-9.]+),/gm)) server[m[1]] = { label: m[2], density: Number(m[3]) }
    expect(server).toEqual(MATERIALS)
    const aliases = /export const MATERIAL_ALIASES = (\{[^}]*\})/.exec(js)?.[1]
    expect(aliases && Object.fromEntries([...aliases.matchAll(/'?([a-z0-9-]+)'?: '([a-z0-9-]+)'/g)].map((m) => [m[1], m[2]]))).toEqual(MATERIAL_ALIASES)
  })
  test('the server’s printing figures are the page’s print-process table', () => {
    const js = readFileSync(new URL('../../../mcp/src/extras/fea.js', import.meta.url), 'utf8')
    const block = js.slice(js.indexOf('export const MATERIALS = {'), js.indexOf('\n}\n', js.indexOf('export const MATERIALS = {')))
    const server: Record<string, Record<string, number>> = {}
    for (const m of block.matchAll(/^\s*'?([a-z0-9-]+)'?: \{(.*)\},?$/gm)) {
      const figures: Record<string, number> = {}
      for (const f of m[2].matchAll(/(Exy|Ez|nuXY|nuZ|Xt|Xc|Zt|Zc|S): ([0-9.]+)/g)) figures[f[1]] = Number(f[2])
      server[m[1]] = figures
    }
    expect(server).toEqual(PRINTED)
  })
})

describe('the material a study solves in', () => {
  // The bodies and setups as the readout gives them, read through the
  // shared readers.
  let setups: unknown[] = []
  registerStateSection('reverse', () => ({ bodies: [{ id: 4, name: 'Bracket' }, { id: 9, name: 'Clip' }] }))
  registerStateSection('setups', () => setups)
  const study = { material: 'petg', overrides: {} }
  // FreeCAD's cards are loaded at run time; studyMaterial reads them once
  // they are, as fea.solve has them (studyMaterialReady).
  beforeAll(() => ensureMaterials())

  test('a steel body: solid, the same every way, its figures sent whole', () => {
    setups = []
    useAssigned.setState({ assigned: { '4': 'steel-s235jr' } })
    const m = studyMaterial(4, study)
    expect(m.as).toBe('solid')
    expect(m.label).toBe('S235JR')
    expect(m.density).toBe(7.8)
    expect(m.job.bulk).toEqual({ id: 'steel-s235jr', label: 'S235JR', density: 7.8 })
    expect(m.job.overrides.Exy).toBe(210000)
    expect(m.job.overrides.Ez).toBe(210000)
    expect(m.job.overrides.Gxy).toBe(81000)
    expect(m.job.overrides.Xt).toBe(235)
    expect(m.job.overrides.Zt).toBe(235)
    expect(m.job.overrides.Sz).toBeCloseTo(235 / Math.sqrt(3), 6)
    expect(m.assumed).toBeUndefined()
  })
  test('a PLA body: solid out of a setup, as printed in a print setup', () => {
    useAssigned.setState({ assigned: { '9': 'pla' } })
    setups = []
    expect(studyMaterial(9, study).as).toBe('solid')
    expect(studyMaterial(9, study).job.bulk?.id).toBe('pla')
    setups = [{ id: 's1', type: 'print', name: 'Plate 1', bodies: ['9'] }]
    const printed = studyMaterial(9, study)
    expect(printed.as).toBe('printed')
    expect(printed.job).toEqual({ id: 'pla', overrides: {} })
    setups = [{ id: 's2', type: 'cut', name: 'Laser', bodies: [9] }]
    expect(studyMaterial(9, study).as).toBe('solid')
  })
  test('no material set: the study’s, as printed, said so', () => {
    setups = []
    useAssigned.setState({ assigned: {} })
    const m = studyMaterial(4, study)
    expect(m.assumed).toBe(true)
    expect(m.job).toEqual({ id: 'petg', overrides: {} })
    expect(m.note).toMatch(/No material set on the body — assumed PETG as printed/)
  })
  test('a material without strength asks for it, and takes it from the overrides', () => {
    useAssigned.setState({ assigned: { '4': { custom: { name: 'Mystery', density: 2, youngsMPa: 5000 } } } })
    expect(() => studyMaterial(4, study)).toThrow(/Mystery has no strength/)
    const m = studyMaterial(4, { material: 'pla', overrides: { Xt: 40, Xc: 40, Zt: 40, Zc: 40, S: 20, Sz: 20 } })
    expect(m.job.overrides.Exy).toBe(5000)
    expect(m.job.overrides.Zt).toBe(40)
    expect(isotropicFigures({ youngsMPa: 1000, poisson: 0.25 }).missing).toEqual(['strength (Xt, Xc, Zt, Zc, S, Sz)'])
  })
  test('a steel body before the cards are loaded: the solve waits for them, never solving it as unset', async () => {
    setups = []
    resetMaterialLibrary()
    useAssigned.setState({ assigned: { '4': 'steel-s235jr' } })
    // Not loaded: the card is not found, and the body would read as unset.
    expect(libraryMaterial('steel-s235jr')).toBeUndefined()
    const m = await studyMaterialReady(4, study)
    expect(m).toMatchObject({ label: 'S235JR', density: 7.8, as: 'solid' })
    expect(m.assumed).toBeUndefined()
    expect(m.job.overrides.Exy).toBe(210000)
    useAssigned.setState({ assigned: {} })
  })
  test('a result solved in another material is stale', () => {
    setups = []
    useAssigned.setState({ assigned: { '4': 'pla' } })
    const before = materialKeyOf('Bracket')
    useAssigned.setState({ assigned: { '4': 'aluminum-6061-t6' } })
    expect(materialKeyOf('bracket') === before).toBe(false)
    useAssigned.setState({ assigned: {} })
  })
})

describe('the colour range', () => {
  test('safety red at the bottom, stress from zero, the pull across the layers about zero', () => {
    expect(rangeOf('safety', [0.5, 3], 2)).toEqual({ lo: 0, hi: 4, flip: true })
    expect(rangeOf('vonMises', [3, 40], 2)).toEqual({ lo: 0, hi: 40, flip: false })
    expect(rangeOf('across', [-5, 12], 2)).toEqual({ lo: -12, hi: 12, flip: false })
  })
})
