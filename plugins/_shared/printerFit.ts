// SPDX-License-Identifier: AGPL-3.0-only
// The printer's fit calibration, as every workspace that sizes a printed
// hole reads it: one figure per side, one sign, defined here and nowhere
// else. Fits holds the calibration (fit.calibrate, or Calibrate from a
// scan's fit.measure); Hardware, Generate and Boards read it through
// Fits' state section, never by importing Fits, so a build without Fits
// stands and they fall back to their own defaults.
//
// The convention:
//   hole  — clearance added to a printed hole's modelled diameter so it
//           prints at size, mm, diametral. Positive: the hole is modelled
//           bigger (holes print small). Fits' "holes print small by".
//   shaft — taken off a printed shaft's (or outer wall's) modelled
//           diameter, mm, diametral. Positive: the shaft is modelled
//           smaller (outer walls stand out). Fits' "shafts print big by".
//
// The other ways the same figure is written, and the converters from them:
//   a printed change (printed − modelled, "holes −0.2"): the sign flips;
//   Print fit's hole offset (material standing into a hole, per side, +
//   is too small): doubled, sign kept;
//   Print fit's contour offset (outer walls standing out, per side): the
//   shaft figure, doubled.
// Copying a figure across from one to another by hand flips or halves it
// without a word; convert here.
//
// Pure: the workers' cores take it too. readPrinterFit.ts reads it from
// the session.

export interface PrinterFit {
  /** Clearance added to a hole's modelled diameter, mm; + the hole grows. */
  hole: number
  /** Taken off a shaft's modelled diameter, mm; + the shaft shrinks. */
  shaft: number
  source: 'entered' | 'measured' | 'print-fit'
  /** The day it was set, YYYY-MM-DD; none in projects saved before. */
  at?: string
  /** What it was measured on — printer, material — where known. */
  profile?: string
  /** What a result says it used: "printer fits from 2026-11-08 (MK4, PETG)". */
  label: string
}

/** The printer the built-in sizes assume, and Fits' default calibration:
 *  holes print 0.2 small, shafts 0.1 big, diametral. A calibration moves
 *  the built-in sizes by its difference from this. */
export const TYPICAL_FIT = { hole: 0.2, shaft: 0.1 } as const

/** Over this χ² per degree of freedom a scanned run's offsets are not
 *  trusted: warping, a lifted corner or a poor alignment (Print fit's
 *  guide: "over about 4, don't suggest offsets"). */
export const POOR_FIT = 4

const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0

// ---- converters, into the convention ----------------------------------------------------

/** How much smaller a hole prints than modelled → the hole clearance: the same figure. */
export const holeFromShrink = (shrink: number) => r4(shrink)
/** A hole's printed change, printed − modelled (−0.2: prints 0.2 small) → the hole clearance: the sign flips. */
export const holeFromPrintedChange = (change: number) => r4(-change)
/** Print fit's hole offset, per side (+: material stands into the hole) → the hole clearance, diametral. */
export const holeFromRadialOffset = (offset: number) => r4(2 * offset)
/** How much bigger a shaft prints than modelled → the shaft figure: the same. */
export const shaftFromGrowth = (growth: number) => r4(growth)
/** Print fit's contour offset, per side (+: outer walls stand out) → the shaft figure, diametral. */
export const shaftFromRadialOffset = (offset: number) => r4(2 * offset)

// ---- and out of it --------------------------------------------------------------------

/** The hole clearance as a printed change (printed − modelled). */
export const printedChangeOfHole = (hole: number) => r4(-hole)

/** What to add to a built-in hole size or hole allowance — one chosen for
 *  the typical printer — so it suits this one; diametral. */
export const holeShift = (f: Pick<PrinterFit, 'hole'>) => r4(f.hole - TYPICAL_FIT.hole)

/** What to add to a built-in gap, each side, between a printed pocket and
 *  a printed part in it (a lid's lip in its box): both walls move. */
export const gapShift = (f: Pick<PrinterFit, 'hole' | 'shaft'>) => r4((f.hole + f.shaft - TYPICAL_FIT.hole - TYPICAL_FIT.shaft) / 2)

/** What to add to a built-in gap, each side, round a bought part in a
 *  printed pocket (a board in its box, a connector in its opening): the
 *  printed wall alone moves. */
export const pocketShift = (f: Pick<PrinterFit, 'hole'>) => r4((f.hole - TYPICAL_FIT.hole) / 2)

// ---- reading it -------------------------------------------------------------------------

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The label a result carries. */
export function fitLabel(f: Pick<PrinterFit, 'source' | 'at' | 'profile'>): string {
  const how = f.source === 'print-fit' ? 'a scanned print' : f.source === 'measured' ? 'a measured coupon' : 'values entered'
  return `printer fits from ${f.at ?? how}${f.profile ? ` (${f.profile})` : f.at ? ` (${how})` : ''}`
}

/** Fits' calibration as it holds it ({ hole, shaft, source, at?, profile? }:
 *  hole how much smaller a hole prints, shaft how much bigger a shaft) in
 *  the convention; null for the defaults, or anything it cannot read. */
export function printerFitOf(c: unknown): PrinterFit | null {
  if (!c || typeof c !== 'object') return null
  const o = c as Record<string, unknown>
  const source = (['entered', 'measured', 'print-fit'] as const).find((s) => s === o.source)
  if (!source || !isNum(o.hole, -1, 2) || !isNum(o.shaft, -1, 2)) return null
  const at = typeof o.at === 'string' && DAY.test(o.at) ? o.at : undefined
  const profile = typeof o.profile === 'string' && o.profile.trim() ? o.profile.trim().slice(0, 80) : undefined
  const f = { hole: holeFromShrink(o.hole), shaft: shaftFromGrowth(o.shaft), source, ...(at ? { at } : {}), ...(profile ? { profile } : {}) }
  return { ...f, label: fitLabel(f) }
}
