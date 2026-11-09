// SPDX-License-Identifier: AGPL-3.0-only
// The scan noise to plan with, as every plugin that reads a scan takes it:
// one rule, defined here and nowhere else. Scanner noise (plugins/
// scanner-profiles) keeps the two figures — the usual noise of the scanner
// the project names (its `profile` in the state; not the 2D Measure
// scanner profile, which is a flatbed's scale) and the noise read off this
// scan by the scan check (scan.qa) — and publishes them in its "scanner"
// state section;
// Wear repair, Calibrate from a scan and Thread identify read them through
// readScanNoise, never by importing Scanner noise, so a build without it
// stands and they go by their own readings alone.
//
// The rule: the larger of the two when both are known — a scan is never
// better than its scanner usually gives, and one that reads worse is worse
// — else whichever is known. It warns when this scan reads well above the
// scanner's (worse than it usually gives: a shiny part, a bad pass) and
// when no scanner is set (one scan's reading is all there is).
//
// Pure but for readScanNoise; the words take a length formatter, so a
// command says millimetres and a panel the display's units.

import { readStateSection } from '../../src/commands/stateSections'

/** A scan reading this many times its scanner's usual noise or more is
 *  worse than the scanner usually gives. */
export const WELL_ABOVE = 1.5

/** Upstream's scan-to-CAD rule: nothing finer than this many times the
 *  scan's noise is trustworthy. */
export const TRUST_FACTOR = 3

export interface ScanNoise {
  /** One standard deviation of the surface noise to plan with, mm. */
  sigmaMm: number
  /** Which figure it is: the scanner's usual or this scan's. */
  source: 'profile' | 'measured'
  /** The scanner the project names, with its usual noise. */
  profile: { name: string; sigmaMm: number } | null
  /** This scan's noise as the scan check read it, when read. */
  measured: { sigmaMm: number } | null
  /** Why to be careful with it, when there is a reason. */
  warning: { kind: 'worse-than-profile'; ratio: number } | { kind: 'no-profile' } | null
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0
const ok = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0

/** The noise to plan with from the scanner's usual and this scan's, or
 *  null with neither. */
export function planNoise(profile: { name: string; noiseMm: number } | null | undefined, measured: { sigmaMm: number } | null | undefined): ScanNoise | null {
  const p = profile && ok(profile.noiseMm) ? { name: profile.name, sigmaMm: r4(profile.noiseMm) } : null
  const m = measured && ok(measured.sigmaMm) ? { sigmaMm: r4(measured.sigmaMm) } : null
  if (!p && !m) return null
  const source = p && (!m || p.sigmaMm >= m.sigmaMm) ? 'profile' : 'measured'
  const sigmaMm = source === 'profile' ? p!.sigmaMm : m!.sigmaMm
  const warning = !p ? ({ kind: 'no-profile' } as const) : m && m.sigmaMm >= WELL_ABOVE * p.sigmaMm ? ({ kind: 'worse-than-profile', ratio: Math.round((10 * m.sigmaMm) / p.sigmaMm) / 10 } as const) : null
  return { sigmaMm, source, profile: p, measured: m, warning }
}

/** Where the noise came from, in a few words. */
export function noiseFrom(n: ScanNoise): string {
  return n.source === 'profile' ? `scanner ${n.profile!.name}` : 'measured on this scan'
}

/** The warning in a sentence, lengths through `fmt`; null without one. */
export function noiseWarningText(n: ScanNoise | null, fmt: (mm: number) => string): string | null {
  if (!n?.warning) return null
  if (n.warning.kind === 'no-profile')
    return `No scanner is set: planning with this scan's own noise (${fmt(n.sigmaMm)}). Name the scanner, with its usual noise, so a scan that reads too clean is not trusted past what the scanner gives.`
  return `This scan reads ${fmt(n.measured!.sigmaMm)}, ${n.warning.ratio}× the ${fmt(n.profile!.sigmaMm)} ${n.profile!.name} usually gives: worse than this scanner does (a shiny part, a poor pass). Planning with the scan's; rescan if the part allows.`
}

/** The finest difference worth trusting on this scan, mm: three times the
 *  noise, as the scan-to-CAD rule has it. */
export const finestMm = (n: ScanNoise) => r4(TRUST_FACTOR * n.sigmaMm)

/** The noise to plan with now, read from Scanner noise's state section;
 *  null without the plugin, or with no scanner set and nothing measured. */
export function readScanNoise(): ScanNoise | null {
  const s = readStateSection('scanner') as { profile?: { name?: unknown; noiseMm?: unknown } | null; measured?: { sigmaMm?: unknown } | null } | undefined
  if (!s || typeof s !== 'object') return null
  const p = s.profile && typeof s.profile.name === 'string' && ok(s.profile.noiseMm) ? { name: s.profile.name, noiseMm: s.profile.noiseMm } : null
  const m = s.measured && ok(s.measured.sigmaMm) ? { sigmaMm: s.measured.sigmaMm } : null
  return planNoise(p, m)
}

/** A reading's own noise, raised to the noise to plan with where that is
 *  larger: a scan is never surer than its scanner. */
export const atLeastScanNoise = (own: number, n: ScanNoise | null) => (n && n.sigmaMm > own ? n.sigmaMm : own)

/** The noise to plan with as a command's answer gives it — `scanNoise` in
 *  the answers of the plugins that read it — the warning's lengths through
 *  `fmt`. */
export function scanNoiseAnswer(n: ScanNoise, fmt: (mm: number) => string) {
  const warning = noiseWarningText(n, fmt)
  return { sigmaMm: n.sigmaMm, source: n.source, from: noiseFrom(n), finestMm: finestMm(n), ...(warning ? { warning } : {}) }
}
