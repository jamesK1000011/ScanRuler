// SPDX-License-Identifier: AGPL-3.0-only
// A run whose fit is poor — over 4, where the guide says not to suggest
// offsets — is refused by everything that turns its offsets into slicer
// settings or a model, with what to do instead; a run that fits well is
// suggested from as before.
import { describe, expect, it } from 'vitest'
import { exportCommand, profiles, suggest } from '../app/fitCommands'
import type { Readings } from '../core/measure'
import type { Solution } from '../core/solve'
import { DEFAULT_SETTINGS, useFit } from '../state/fitStore'
import { POOR_FIT } from '../../_shared/printerFit'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const ctx = { progress() {} } as never
const est = (value: number) => ({ value, se: 0.001, determined: true })
const sol = (fit: number): Solution => ({ scale: { x: est(0.996), y: est(0.996), z: est(1) }, contour: est(0.08), hole: est(0.12), foot: null, fit, dof: 40 }) as Solution
const readings = { planes: [], circles: [], noise: 0.02, missed: [] } as unknown as Readings

function measured(fit: number) {
  useFit.getState().reset()
  return useFit.getState().addRun({ at: '2026-11-08T00:00:00Z', reference: 'plate.step', settings: { ...DEFAULT_SETTINGS }, readings, solution: sol(fit) })
}
async function refusal(p: Promise<unknown>): Promise<string> {
  let m = ''
  await p.catch((e: Error) => (m = e.message))
  return m
}

describe('a poor fit', () => {
  it('fit.suggest refuses it, plainly, with what to do', async () => {
    const run = measured(7.3)
    const m = await refusal(suggest.run({}, ctx))
    expect(m).toMatch(new RegExp(`Run ${run.n} fits poorly \\(7\\.3, over ${POOR_FIT}\\)`))
    expect(m).toMatch(/measure again/)
  })
  it('so do the .ini, a saved profile and a run named', async () => {
    const run = measured(5)
    expect(await refusal(exportCommand.run({}, ctx))).toMatch(/fits poorly/)
    expect(await refusal(profiles.run({ action: 'save', name: 'PETG' }, ctx))).toMatch(/fits poorly/)
    expect(useFit.getState().profiles).toEqual([])
    expect(await refusal(suggest.run({ run: run.n }, ctx))).toMatch(/fits poorly/)
  })
  it('at the threshold and under, the run is suggested from', async () => {
    measured(POOR_FIT)
    const r = (await suggest.run({}, ctx)) as Json
    expect(r.run).toBe(1)
    expect(r.changes.length > 0).toBe(true)
    expect(r.warning).toBe(undefined)
  })
})
