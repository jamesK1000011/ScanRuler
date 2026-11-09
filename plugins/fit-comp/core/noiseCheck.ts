// SPDX-License-Identifier: AGPL-3.0-only
// A run judged against the scan noise to plan with (Scanner noise, read
// through plugins/_shared/scanNoise.ts — the larger of the scanner's usual
// noise and this scan's — raised to the run's own scatter on flat faces
// where that is larger):
//  - an offset worth changing by its standard errors but under three times
//    the noise is finer than the scan-to-CAD rule trusts: it rests on
//    averaging many points, and a second print or scan should confirm it
//    before the slicer changes;
//  - a poor fit on a scan whose flat faces scatter well above the scanner's
//    usual noise may be the scan's fault, not the printer's.
// The solve itself is untouched: its errors come from the points.

import { atLeastScanNoise, noiseFrom, TRUST_FACTOR, WELL_ABOVE, type ScanNoise } from '../../_shared/scanNoise'
import type { Correction, Quantity } from './suggest'

/** The offsets read in millimetres; the scales are ratios. */
const LENGTHS: readonly Quantity[] = ['contour', 'hole', 'foot']

export interface NoiseJudgement {
  /** The noise judged against, mm, and where it came from. */
  sigmaMm: number
  from: string
  /** Offsets worth changing by their errors but under 3 × the noise. */
  nearNoise: { quantity: Quantity; read: number }[]
  /** The run's flat-face scatter well above the scanner's usual noise. */
  scanWorse: { scatterMm: number; usualMm: number; scanner: string } | null
}

export function judgeNoise(cs: readonly Correction[], scatterMm: number, plan: ScanNoise | null): NoiseJudgement | null {
  if (!plan && !(scatterMm > 0)) return null
  const sigmaMm = atLeastScanNoise(scatterMm > 0 ? scatterMm : 0, plan)
  const from = plan && plan.sigmaMm >= scatterMm ? noiseFrom(plan) : 'the run’s scatter on flat faces'
  const nearNoise = cs.filter((c) => c.change && LENGTHS.includes(c.quantity) && Math.abs(c.read) < TRUST_FACTOR * sigmaMm).map((c) => ({ quantity: c.quantity, read: c.read }))
  const scanWorse = plan?.profile && scatterMm >= WELL_ABOVE * plan.profile.sigmaMm ? { scatterMm, usualMm: plan.profile.sigmaMm, scanner: plan.profile.name } : null
  return { sigmaMm, from, nearNoise, scanWorse }
}

const WORDS: Record<Quantity, string> = { contour: 'the contour offset', hole: 'the hole offset', foot: 'the elephant foot', scaleXY: 'the XY scale', scaleZ: 'the Z scale' }

/** The judgement in sentences, lengths through `fmt`. */
export function noiseNotes(j: NoiseJudgement | null, poor: boolean, fmt: (mm: number) => string): string[] {
  if (!j) return []
  const out: string[] = []
  if (j.nearNoise.length)
    out.push(
      `${j.nearNoise.map((n) => `${WORDS[n.quantity]} (${fmt(n.read)})`).join(', ')} ${j.nearNoise.length === 1 ? 'is' : 'are'} under three times the scan noise (${fmt(j.sigmaMm)}, ${j.from}): averaged over many points, but finer than this scan is trusted for. Confirm on a second print or scan before changing the slicer.`,
    )
  if (poor && j.scanWorse)
    out.push(`The scan's scatter on the flat faces (${fmt(j.scanWorse.scatterMm)}) is well above the ${fmt(j.scanWorse.usualMm)} ${j.scanWorse.scanner} usually gives: the scan may be what fits poorly. Rescan before blaming the printer.`)
  return out
}
