// SPDX-License-Identifier: AGPL-3.0-only
// The checks on parts with known faults, the rules stacked from profiles,
// and a broken mesh.
import { describe, expect, test } from 'vitest'
import { runChecks } from '../core/checks'
import { stack, validatePack, type Profile, type RulePack } from '../core/rules'
import pack from '../rules/fdm-default.json'
import petg from '../rules/materials/petg.json'
import n06 from '../rules/nozzles/0.6.json'
import { ball, pin, plate } from './part'

const rules = (layers: { name: string; overrides: Profile['overrides'] }[] = []) => stack(pack as RulePack, layers)

describe('the plate', () => {
  test('each fault found once, where it is', async () => {
    const p = await plate()
    const thickness = new Float32Array(p.positions.length / 3).fill(4)
    for (let i = 0; i < thickness.length; i++) if (p.positions[3 * i] >= 30 - 1e-6 && p.positions[3 * i] <= 30.5 + 1e-6 && p.positions[3 * i + 2] > 4) thickness[i] = 0.5
    const { findings, skipped } = runChecks({ ...p, thickness }, rules())
    expect(skipped).toEqual([])
    const by = (rule: string) => findings.filter((f) => f.rule === rule)
    expect(by('thin-wall')).toHaveLength(1)
    expect(by('thin-wall')[0].value).toBe(0.5)
    expect(by('bridge')).toHaveLength(1)
    expect(by('bridge')[0].value).toBeCloseTo(16, 1)
    expect(by('overhang')).toHaveLength(1)
    expect(by('overhang')[0].at[0]).toBeGreaterThan(46)
    expect(by('small-hole')).toHaveLength(1)
    expect(by('small-hole')[0].value).toBeCloseTo(1.5, 1)
    expect(by('trapped-volume')).toHaveLength(1)
    expect(by('trapped-volume')[0].value).toBeCloseTo(32, 0)
    expect(by('mesh-health')).toEqual([])
    expect(by('bed-contact')).toEqual([])
    expect(by('tall-thin')).toEqual([])
  })
  test('finely meshed, the ledge is still a ledge and the tunnel still a bridge', async () => {
    const { findings } = runChecks(await plate(0.6), rules())
    expect(findings.filter((f) => f.rule === 'overhang').map((f) => f.value)).toEqual([90])
    expect(findings.filter((f) => f.rule === 'bridge').map((f) => Math.round(f.value))).toEqual([16])
  })
  test('without a thickness map the thin-wall rule says it was skipped', async () => {
    const { skipped } = runChecks(await plate(), rules())
    expect(skipped.map((s) => s.rule)).toEqual(['thin-wall'])
  })
  test('a wider bridge limit lets the tunnel pass', async () => {
    const { findings } = runChecks(await plate(), rules([{ name: 'project', overrides: { bridge: { params: { maxMm: 20 } } } }]))
    expect(findings.filter((f) => f.rule === 'bridge')).toEqual([])
  })
})

test('a tall pin and a ball on the bed', async () => {
  const pinFound = runChecks(await pin(), rules()).findings
  expect(pinFound.find((f) => f.rule === 'tall-thin')?.value).toBeCloseTo(10, 0)
  const ballFound = runChecks(await ball(), rules()).findings
  expect(ballFound.find((f) => f.rule === 'bed-contact')).toBeTruthy()
})

test('a mesh with a hole in it', async () => {
  const p = await plate()
  const indices = p.indices.slice(3)
  const f = runChecks({ positions: p.positions, indices }, rules()).findings.find((x) => x.rule === 'mesh-health')
  expect(f?.count).toBe(3)
})

describe('rules', () => {
  test('profiles stack, and say which set each number', () => {
    const r = rules([
      { name: 'nozzle 0.6', overrides: (n06 as Profile).overrides },
      { name: 'material petg', overrides: (petg as Profile).overrides },
      { name: 'project', overrides: { overhang: { params: { maxDeg: 55 } }, 'tall-thin': { disabled: true } } },
    ])
    const get = (id: string) => r.find((x) => x.id === id)!
    expect(get('thin-wall').params.minMm).toBe(1.2)
    expect(get('thin-wall').setBy.minMm).toBe('nozzle 0.6')
    expect(get('overhang').params.maxDeg).toBe(55)
    expect(get('overhang').setBy.maxDeg).toBe('project')
    expect(get('bridge').setBy.maxMm).toBe('material petg')
    expect(get('tall-thin').disabled).toBe(true)
  })
  test('the default pack is valid; a broken one is refused', () => {
    expect(validatePack(pack)).toEqual([])
    expect(validatePack({ id: 'x', rules: [{ id: 'a', check: 'nope', severity: 'bad', params: { x: 'y' } }] }).length).toBeGreaterThan(2)
  })
})
