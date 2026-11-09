// SPDX-License-Identifier: AGPL-3.0-only
// The material commands as an agent runs them, against bodies the readout
// gives: the library listed and read, a material set on a body by name or
// id and kept by its id through a rename, one of the person's own, taken
// off again, and the project file's part round trip — a hostile one
// refused.
import { describe, expect, it } from 'vitest'
import { registerCommands, runCommand } from '../../../src/commands/registry'
import { registerStateSection } from '../../../src/commands/stateSections'
import { materialCommands } from '../app/materialCommands'
import { materialsSection } from '../app/projectSection'
import { materialOfBody, useAssigned } from '../../_shared/materials/assigned'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

registerCommands('material', materialCommands)
const bodies = [
  { id: 1, name: 'Grip' },
  { id: 2, name: 'Case' },
  { id: 3, name: 'Skin', surface: true },
]
registerStateSection('reverse', () => ({ bodies }))
let setups: unknown[] = []
registerStateSection('setups', () => setups)
const run = (name: string, input: Json = {}) => runCommand(`material.${name}`, input) as Promise<Json>
async function refused(p: Promise<unknown>, re: RegExp) {
  let message = ''
  try {
    await p
  } catch (e) {
    message = e instanceof Error ? e.message : String(e)
  }
  expect(message).toMatch(re)
}

describe('the material commands', () => {
  it('list the library briefly, filtered and paged', async () => {
    const all = await run('list')
    expect(all.total > 140).toBe(true)
    expect(all.materials.length).toBe(40)
    expect(all.categories.metal > 100).toBe(true)
    const metals = await run('list', { category: 'metal', q: 'stainless', limit: 5 })
    expect(metals.materials.every((m: Json) => m.category === 'metal')).toBe(true)
    expect(metals.categories).toBeUndefined()
    expect((await run('list', { q: 'pla' })).materials.find((m: Json) => m.id === 'pla')).toMatchObject({ density: 1.24, printable: true })
  })
  it('read a material whole, with its source and its printing figures', async () => {
    const m = (await run('get', { material: 'Steel-S235JR' })).material
    expect(m.source).toMatchObject({ from: 'FreeCAD', license: 'LGPL-2.0-or-later', author: 'M. Münch' })
    expect((await run('get', { material: 'tpu' })).material).toMatchObject({ id: 'tpu-95a', aliases: ['tpu'], printed: { Exy: 26 } })
    await refused(run('get', { material: 'unobtainium' }), /No material "unobtainium"/)
  })
  it('set a material by body name or id, kept by the id through a rename', async () => {
    useAssigned.getState().reset()
    setups = []
    const r = await run('set', { body: 'grip', material: 'aluminium' })
    expect(r.bodies[0]).toMatchObject({ body: 'Grip', id: 1, material: { id: 'aluminum-generic', density: 2.7 }, setup: null, as: 'solid' })
    expect(useAssigned.getState().assigned).toEqual({ '1': 'aluminum-generic' })
    bodies[0].name = 'Handle'
    expect((await run('get', { body: 'Handle' })).material.id).toBe('aluminum-generic')
    bodies[0].name = 'Grip'
    setups = [{ id: 'p', type: 'print', name: 'Plate', bodies: ['2'] }]
    expect((await run('set', { body: [2, 'Grip'], material: 'petg' })).bodies.map((b: Json) => b.as)).toEqual(['printed', 'solid'])
    await refused(run('set', { body: 'Skin', material: 'pla' }), /surface/)
    await refused(run('set', { body: 'Nope', material: 'pla' }), /no body "Nope"/)
    await refused(run('set', { body: 'Grip', material: 'kryptonite' }), /No material "kryptonite"/)
  })
  it('take one of the person’s own, checked', async () => {
    useAssigned.getState().reset()
    await run('set', { body: 'Case', material: { name: 'Bambu PC', base: 'pc', density: 1.19 } })
    expect(materialOfBody(2)).toMatchObject({ id: 'custom', name: 'Bambu PC', density: 1.19, youngsMPa: 2400 })
    await refused(run('set', { body: 'Case', material: { name: 'Foam' } }), /needs a density/)
    await refused(run('set', { body: 'Case', material: { name: 'Foam', density: 900 } }), /density must be a number from 0.01 to 25/)
    await refused(run('set', { body: 'Case', material: { name: 'Foam', density: 0.1, colour: 'red' } }), /colour: not a material figure/)
  })
  it('clear a body’s, or all', async () => {
    useAssigned.getState().reset()
    await run('set', { body: ['Grip', 'Case'], material: 'pom' })
    expect((await run('clear', { body: 'Grip' })).bodies[0].material).toBe(null)
    expect(useAssigned.getState().assigned).toEqual({ '2': 'pom' })
    expect((await run('clear', { all: true })).cleared).toBe(1)
    await refused(run('clear', {}), /Give the bodies, or all/)
  })
  it('round trip in the project file; a hostile one refused', () => {
    useAssigned.getState().reset()
    expect(materialsSection.collect({} as never)).toBeUndefined()
    useAssigned.getState().assign({ '1': 'steel-s235jr', '2': { custom: { name: 'Mine', density: 2 } } })
    const saved = materialsSection.collect({} as never)!
    useAssigned.getState().reset()
    materialsSection.prepare(JSON.parse(JSON.stringify(saved)), {} as never)()
    expect(useAssigned.getState().assigned).toEqual({ '1': 'steel-s235jr', '2': { custom: { name: 'Mine', density: 2 } } })
    expect(() => materialsSection.prepare({ version: 1, bodies: { Grip: 'pla' } }, {} as never)).toThrow(/not a body's id/)
    expect(() => materialsSection.prepare({ version: 1, bodies: { '1': { custom: {} } } }, {} as never)).toThrow(/does not read/)
    expect(() => materialsSection.prepare({ version: 2 }, {} as never)).toThrow()
    materialsSection.prepare(undefined, {} as never)()
    expect(useAssigned.getState().assigned).toEqual({})
  })
})
