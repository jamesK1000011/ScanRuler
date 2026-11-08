// SPDX-License-Identifier: AGPL-3.0-only
// One calibration: a run of fit.measure that fits well becomes the Fits
// tab's calibration, through fit.calibrate { from: "print-fit" } inside the
// same change; a poor fit, or offsets the part cannot separate, leave it be.
// Fits stands in here as a fake fit.calibrate.
import { beforeAll, describe, expect, it } from 'vitest'
import { registerCommands, runCommand } from '../../../src/commands/registry'
import type { Command } from '../../../src/plugins/api'
import { shareCalibration } from '../app/shareCalibration'
import type { Solution } from '../core/solve'

const calls: unknown[] = []
let solution: Solution
const est = (value: number, determined = true) => ({ value, se: 0.001, determined })
const sol = (fit: number, determined = true): Solution => ({ scale: { x: est(1), y: est(1), z: est(1) }, contour: est(0.03, determined), hole: est(0.08, determined), foot: null, fit, dof: 10 }) as Solution

beforeAll(() => {
  const calibrate: Command = { name: 'calibrate', title: '', description: '', input: { type: 'object' }, history: false, run: async (i) => (calls.push(i), { calibration: { hole: 0.16, shaft: 0.06, source: 'print-fit' } }) }
  const probe: Command = { name: 'probe', title: '', description: '', input: { type: 'object' }, history: false, run: async () => shareCalibration(solution) }
  registerCommands('fitshare', [probe])
  registerCommands('fit', [calibrate])
})

const share = async (s: Solution) => {
  solution = s
  calls.length = 0
  return (await runCommand('fitshare.probe')) as Record<string, unknown>
}

describe('one calibration', () => {
  it('a good run becomes the calibration, within the same change', async () => {
    const r = await share(sol(1.2))
    expect(calls).toEqual([{ from: 'print-fit' }])
    expect(r.calibration).toEqual({ hole: 0.16, shaft: 0.06, source: 'print-fit' })
  })

  it('a poor fit, or offsets not separated, keep the calibration', async () => {
    expect((await share(sol(6))).calibrationKept).toMatch(/poor/)
    expect((await share(sol(1, false))).calibrationKept).toMatch(/separate/)
    expect(calls).toEqual([])
  })
})
