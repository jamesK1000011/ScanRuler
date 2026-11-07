// SPDX-License-Identifier: AGPL-3.0-only
// scanner.*: the scanner a scan came from, and how noisy it is. Plugins
// that set thresholds as a multiple of the noise read it from the
// session's "scanner" part (noise.sigmaMm).

import { sceneOf } from '../../../src/commands/host'
import { bool, num, obj, str } from '../../../src/commands/schema'
import { type Command, CommandError } from '../../../src/plugins/api'
import { measureNoise } from '../core/noise'
import { noiseNow, useScanner } from '../state/scannerStore'

const list: Command<Record<string, never>> = {
  name: 'list',
  title: 'Scanner profiles',
  description: 'Your scanner profiles (name, noiseMm — one standard deviation of its surface noise — spacingMm, note), kept in this browser across projects; the one this project uses; and the noise measured from the scan, if read. noise is what plugins plan with: the profile\'s, else the measured. Changes nothing.',
  input: obj({}),
  readOnly: true,
  run: async () => {
    const s = useScanner.getState()
    return { profiles: s.profiles, using: s.using, measured: s.measured, noise: noiseNow() }
  },
}

const add: Command<{ name: string; noiseMm: number; spacingMm?: number; note?: string; use?: boolean }> = {
  name: 'add',
  title: 'Add a scanner profile',
  description: 'Add or replace a scanner profile by name: noiseMm (one standard deviation of its surface noise, mm — scanner.noise reads it off a scan of a flat, matte part), spacingMm, note (settings, mode, spray). Kept in this browser for every project. use: true makes it this project\'s.',
  input: obj({ name: str(undefined, { minLength: 1 }), noiseMm: num('mm.', { exclusiveMinimum: 0, maximum: 5 }), spacingMm: num('mm.', { exclusiveMinimum: 0 }), note: str(), use: bool() }, ['name', 'noiseMm']),
  run: async ({ use, ...p }) => {
    useScanner.getState().add(p)
    if (use) useScanner.getState().use(p)
    return { profiles: useScanner.getState().profiles, using: useScanner.getState().using }
  },
}

const remove: Command<{ name: string }> = {
  name: 'remove',
  title: 'Remove a scanner profile',
  description: 'Remove one of your scanner profiles. A project using it keeps its copy.',
  input: obj({ name: str() }, ['name']),
  run: async ({ name }) => {
    if (!useScanner.getState().remove(name)) throw new CommandError('invalid_input', `No profile "${name}".`)
    return { profiles: useScanner.getState().profiles }
  },
}

const use: Command<{ name?: string; measured?: boolean }> = {
  name: 'use',
  title: 'Use a scanner profile for this project',
  description: 'The profile this project plans with, by name — kept with the project — or measured: true to go by the noise read off the scan (scanner.noise).',
  input: obj({ name: str(), measured: bool() }),
  run: async ({ name, measured }) => {
    if (measured) useScanner.getState().use(null)
    else {
      const p = useScanner.getState().profiles.find((x) => x.name === name)
      if (!p) throw new CommandError('invalid_input', `No profile "${name}" — have ${useScanner.getState().profiles.map((x) => x.name).join(', ') || 'none'}.`)
      useScanner.getState().use(p)
    }
    return { using: useScanner.getState().using, noise: noiseNow() }
  },
}

const noise: Command<Record<string, never>> = {
  name: 'noise',
  title: 'Read the scan\'s noise',
  description: 'How noisy the open scan is, read off the scan itself: each vertex\'s distance along its normal from the centre of its neighbours, on flat ground only, taken robustly — sigmaMm (one standard deviation) and spacingMm (median point spacing). Best on a flat, matte part. Kept with the project as the measured noise; scanner.add saves it as a profile.',
  input: obj({}),
  run: async () => {
    const m = sceneOf()?.scanMesh()
    if (!m) throw new CommandError('invalid_state', 'There is no scan open.')
    const r = measureNoise(m)
    if (!(r.flat > 50)) throw new CommandError('failed', `Only ${r.flat} flat places to read (of ${r.sampled}); a scan with some flat faces reads better.`)
    const out = { sigmaMm: Number(r.sigmaMm.toFixed(4)), spacingMm: Number(r.spacingMm.toFixed(3)), at: new Date().toISOString() }
    useScanner.getState().setMeasured(out)
    return { ...out, readAt: r.flat, of: r.sampled, using: useScanner.getState().using?.name ?? 'measured', noise: noiseNow() }
  },
}

export const scannerCommands = [list, add, remove, use, noise]
