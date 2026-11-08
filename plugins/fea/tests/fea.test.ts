// SPDX-License-Identifier: AGPL-3.0-only
// The FEA study kept with a project — cleaned on the way in — and the
// range a field is coloured over.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { feaSection } from '../app/projectSection'
import { DEFAULT_SETUP, setupOf, useFea } from '../state/feaStore'
import { rangeOf } from '../viewer/resultLayer'
import { densityOf, MATERIAL_ALIASES, MATERIAL_IDS, materialId, MATERIALS } from '../../_shared/materials'

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
})

describe('the colour range', () => {
  test('safety red at the bottom, stress from zero, the pull across the layers about zero', () => {
    expect(rangeOf('safety', [0.5, 3], 2)).toEqual({ lo: 0, hi: 4, flip: true })
    expect(rangeOf('vonMises', [3, 40], 2)).toEqual({ lo: 0, hi: 40, flip: false })
    expect(rangeOf('across', [-5, 12], 2)).toEqual({ lo: -12, hi: 12, flip: false })
  })
})
