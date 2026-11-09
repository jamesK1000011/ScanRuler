// SPDX-License-Identifier: AGPL-3.0-only
// scanner.*: Scanner noise — the scanner a scan came from, with its usual
// noise, and this scan's noise as the scan check (scan.qa) reads it. The
// noise to plan with is the larger (plugins/_shared/scanNoise.ts); plugins
// that read scans take it from the session's "scanner" part through
// readScanNoise. Not the 2D Measure scanner profile, a flatbed's scale.

import { sceneOf } from '../../../src/commands/host'
import { runCommand } from '../../../src/commands/registry'
import { bool, num, obj, str } from '../../../src/commands/schema'
import { type Command, CommandError } from '../../../src/plugins/api'
import { useStore } from '../../../src/state/store'
import { scanNoiseAnswer, type ScanNoise } from '../../_shared/scanNoise'
import { pointSpacing } from '../core/noise'
import { noiseNow, useScanner } from '../state/scannerStore'

/** A length as the agent's answers give it: millimetres, always. */
export const mmText = (v: number) => `${v} mm`

/** The noise to plan with as answers and the session give it. */
export function noiseOut(n: ScanNoise | null = noiseNow()) {
  return n ? { ...scanNoiseAnswer(n, mmText), profile: n.profile, measured: n.measured } : null
}

/** The session's "scanner" part: what readScanNoise reads (profile,
 *  measured) and what the agent plans with (noise). */
export function scannerState() {
  const s = useScanner.getState()
  return {
    using: s.using?.name ?? null,
    profiles: s.profiles.map((p) => p.name),
    profile: s.using ? { name: s.using.name, noiseMm: s.using.noiseMm } : null,
    measured: s.measured,
    noise: noiseOut(),
  }
}

const PLAN = 'noise is what to plan with: the larger of the scanner\'s usual noise and this scan\'s, with a warning when the scan reads well above its scanner or no scanner is set; finestMm is three times it, the finest difference to trust.'

const list: Command<Record<string, never>> = {
  name: 'list',
  title: 'Scanners and scan noise',
  description: `Your scanners (name, noiseMm — one standard deviation of its usual surface noise — spacingMm, note), kept in this browser across projects; the one this project names (using); and this scan's noise as scanner.noise read it (measured). ${PLAN} Changes nothing.`,
  input: obj({}),
  readOnly: true,
  run: async () => {
    const s = useScanner.getState()
    return { profiles: s.profiles, using: s.using, measured: s.measured, noise: noiseOut() }
  },
}

const add: Command<{ name: string; noiseMm: number; spacingMm?: number; note?: string; use?: boolean }> = {
  name: 'add',
  title: 'Add a scanner',
  description: 'Add or replace a scanner by name, with its usual noise: noiseMm (one standard deviation, mm — scanner.noise reads it off a scan of a flat, matte part), spacingMm, note (settings, mode, spray). Kept in this browser for every project. use: true names it for this project.',
  input: obj({ name: str(undefined, { minLength: 1 }), noiseMm: num('mm.', { exclusiveMinimum: 0, maximum: 5 }), spacingMm: num('mm.', { exclusiveMinimum: 0 }), note: str(), use: bool() }, ['name', 'noiseMm']),
  run: async ({ use, ...p }) => {
    useScanner.getState().add(p)
    if (use) useScanner.getState().use(p)
    return { profiles: useScanner.getState().profiles, using: useScanner.getState().using, noise: noiseOut() }
  },
}

const remove: Command<{ name: string }> = {
  name: 'remove',
  title: 'Remove a scanner',
  description: 'Remove one of your scanners. A project naming it keeps its copy.',
  input: obj({ name: str() }, ['name']),
  run: async ({ name }) => {
    if (!useScanner.getState().remove(name)) throw new CommandError('invalid_input', `No scanner "${name}".`)
    return { profiles: useScanner.getState().profiles }
  },
}

const use: Command<{ name?: string; measured?: boolean }> = {
  name: 'use',
  title: 'Name the scanner for this project',
  description: `The scanner this project's scan came from, by name — kept with the project — or measured: true for none, going by this scan's own noise (scanner.noise). ${PLAN}`,
  input: obj({ name: str(), measured: bool() }),
  run: async ({ name, measured }) => {
    if (measured) useScanner.getState().use(null)
    else {
      const p = useScanner.getState().profiles.find((x) => x.name === name)
      if (!p) throw new CommandError('invalid_input', `No scanner "${name}" — have ${useScanner.getState().profiles.map((x) => x.name).join(', ') || 'none'}.`)
      useScanner.getState().use(p)
    }
    return { using: useScanner.getState().using, noise: noiseOut() }
  },
}

/** What scan.qa answers that this reads. */
interface QaNoise {
  noise?: { median?: number; p90?: number; sampled?: number }
  tessellation?: { cad?: boolean }
}

const noise: Command<Record<string, never>> = {
  name: 'noise',
  title: 'Read the scan\'s noise',
  description: `This scan's noise, read by the scan check (scan.qa: its noise.median, the median scatter of small plane fits — the noise the scan-to-CAD guide's three-times rule is written against), as sigmaMm, with p90 and spacingMm (the median distance between neighbouring points, which the check gives only for a CAD tessellation). Kept with the project as the measured noise; scanner.add keeps it as a scanner's usual noise. ${PLAN}`,
  input: obj({}),
  run: async () => {
    if (!useStore.getState().fileName) throw new CommandError('invalid_state', 'There is no scan open.')
    const qa = (await runCommand('scan.qa', {})) as QaNoise
    if (qa.tessellation?.cad) throw new CommandError('failed', 'This is a CAD tessellation, not a scan: it has no scan noise to read.')
    const sigma = qa.noise?.median
    if (!(typeof sigma === 'number' && sigma > 0)) throw new CommandError('failed', 'The scan check read no noise on this scan.')
    const m = sceneOf()?.scanMesh()
    const spacing = m ? pointSpacing(m) : NaN
    const out = { sigmaMm: Number(sigma.toFixed(4)), spacingMm: Number.isFinite(spacing) ? Number(spacing.toFixed(3)) : 0, at: new Date().toISOString() }
    useScanner.getState().setMeasured(out)
    return { ...out, p90: qa.noise?.p90, sampled: qa.noise?.sampled, readBy: 'scan.qa', using: useScanner.getState().using?.name ?? null, noise: noiseOut() }
  },
}

export const scannerCommands = [list, add, remove, use, noise]
