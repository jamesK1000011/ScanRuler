// SPDX-License-Identifier: AGPL-3.0-only
// Fits between printed parts: a hole and a shaft sized for a class of fit,
// with what the printer does to each, and the tolerance stack of a chain of
// sizes. All lengths in millimetres, diametral unless said otherwise.
//
// The printer, as these figures see it:
//   a round hole modelled at d prints at   d − hole    (holes come out small)
//   a shaft modelled at d prints at        d + shaft   (outer walls stand out)
// each give or take the printer's tolerance. A fit class is a clearance
// between the hole and the shaft as printed: positive a gap, negative an
// interference. The model sizes add the printer's offsets back.

export const CLASSES = ['free', 'slip', 'close', 'press', 'tight_press'] as const
export type FitClass = (typeof CLASSES)[number]

export interface ClassDef {
  id: FitClass
  label: string
  /** Clearance as printed, diametral: base + perMm × nominal. */
  base: number
  perMm: number
  /** The ISO 286 fit it plays the part of — a reference only: a printer
   *  holds nothing near IT7. */
  iso: string
  use: string
}

// Starting points, not standards: a gap or interference that grows a
// little with size, as the strain a fit puts on the part is the
// interference over the diameter. fit.test prints them; fit.calibrate
// replaces them with what was felt.
export const CLASS_DEFS: Record<FitClass, ClassDef> = {
  free: { id: 'free', label: 'Free', base: 0.4, perMm: 0.004, iso: 'H9/d9 (free running)', use: 'turns or slides freely; print-in-place gaps' },
  slip: { id: 'slip', label: 'Slip', base: 0.2, perMm: 0.002, iso: 'H7/g6 (sliding)', use: 'slides and turns by hand with little play' },
  close: { id: 'close', label: 'Close', base: 0.1, perMm: 0.001, iso: 'H7/h6 (locational clearance)', use: 'locates; goes together by hand without rattle' },
  press: { id: 'press', label: 'Press', base: -0.05, perMm: -0.004, iso: 'H7/p6 (locational interference)', use: 'pushed in by hand or in a vise; holds' },
  tight_press: { id: 'tight_press', label: 'Tight press', base: -0.1, perMm: -0.006, iso: 'H7/s6 (medium drive)', use: 'pressed in with a vise or a mallet; stays' },
}

/** A class's clearance measured on a test print: `clearance` was right at
 *  nominal `at`. The class's growth with size is kept. */
export interface ClassOverride {
  clearance: number
  at: number
}

export interface Calibration {
  /** How much smaller a round hole prints than modelled, diametral. */
  hole: number
  /** How much bigger a shaft prints than modelled, diametral. */
  shaft: number
  source: 'default' | 'entered' | 'measured' | 'print-fit'
  /** Readings it came from, and their spread (standard deviation). */
  n?: number
  spread?: number
}

export const DEFAULT_CALIBRATION: Calibration = { hole: 0.2, shaft: 0.1, source: 'default' }
/** ± what a printed size lands within, typical of a tuned desktop FDM printer. */
export const DEFAULT_TOLERANCE = 0.15
/** ± a bought part's size: a dowel, a bearing bore, a shaft. */
export const BOUGHT_TOLERANCE = 0.01

const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0

export function classClearance(cls: FitClass, nominal: number, overrides: Partial<Record<FitClass, ClassOverride>> = {}): number {
  const d = CLASS_DEFS[cls]
  const o = overrides[cls]
  return o ? o.clearance + d.perMm * (nominal - o.at) : d.base + d.perMm * nominal
}

// ---- ISO 286 tolerance grades, as a reference --------------------------------------------

/** IT grades as multiples of the standard tolerance unit (ISO 286-1, IT5
 *  to IT18). */
const IT: [number, number][] = [[5, 7], [6, 10], [7, 16], [8, 25], [9, 40], [10, 64], [11, 100], [12, 160], [13, 250], [14, 400], [15, 640], [16, 1000], [17, 1600], [18, 2500]]

/** The standard tolerance unit, µm, for a size in mm: i = 0.45·∛D + 0.001·D.
 *  The standard takes D as the geometric mean of its size step; the size
 *  itself is used here, which moves the answer by a few percent. */
export const toleranceUnit = (d: number) => 0.45 * Math.cbrt(d) + 0.001 * d

/** The coarsest IT grade a ± tolerance at this size still meets — the
 *  grade whose zone is at least the printer's whole spread (2 × tol). */
export function itGrade(d: number, tol: number): { grade: number | null; units: number } {
  const units = (2 * tol * 1000) / toleranceUnit(d)
  const g = IT.find(([, k]) => k >= units - 1e-9)
  return { grade: g ? g[0] : null, units: Math.round(units) }
}

// ---- a hole and a shaft -----------------------------------------------------------------

export interface PairIn {
  nominal: number
  cls?: FitClass
  /** A clearance as printed, diametral, in place of a class. */
  clearance?: number
  /** Which side keeps the nominal: the hole (the hole is the size, the
   *  shaft is made to fit it) or the shaft. */
  basis?: 'hole' | 'shaft'
  /** One side is bought, not printed — a steel dowel, a bearing: it keeps
   *  the nominal and gets no printer offset. */
  bought?: 'hole' | 'shaft'
  /** The hub round the hole: its wall, for the strain a press puts on it. */
  wall?: number
}

export interface PairOut {
  nominal: number
  cls: FitClass | null
  clearance: number
  /** As it should print. */
  printed: { hole: number; shaft: number }
  /** What to model to get it. */
  model: { hole: number; shaft: number }
  basis: 'hole' | 'shaft'
  bought: 'hole' | 'shaft' | null
  /** The clearance as prints will land: every size at its extreme, and
   *  the root sum of squares. */
  range: { worst: [number, number]; rss: [number, number] }
  iso: { like: string | null; grade: number | null; units: number }
  /** A press: the strain it puts on the hub, and the material's limit. */
  strain?: { value: number; limit: number }
  notes: string[]
}

export function pair(p: PairIn, cal: Calibration, tol: number, overrides: Partial<Record<FitClass, ClassOverride>> = {}, strainLimit?: number): PairOut {
  const D = p.nominal
  if (!(D >= 0.5 && D <= 500)) throw new RangeError('nominal: 0.5 to 500.')
  if (p.cls === undefined && p.clearance === undefined) throw new RangeError('Give a class or a clearance.')
  const c = p.clearance ?? classClearance(p.cls!, D, overrides)
  const basis = p.bought ?? p.basis ?? 'hole'
  if (p.bought && p.basis && p.basis !== p.bought) throw new RangeError(`basis: a bought ${p.bought} keeps its size, so the basis is the ${p.bought}.`)
  const hole = basis === 'hole' ? D : D + c
  const shaft = basis === 'hole' ? D - c : D
  if (shaft <= 0.2) throw new RangeError(`A clearance of ${r4(c)} leaves no shaft at ${D}.`)
  const tolH = p.bought === 'hole' ? BOUGHT_TOLERANCE : tol
  const tolS = p.bought === 'shaft' ? BOUGHT_TOLERANCE : tol
  const model = { hole: hole + (p.bought === 'hole' ? 0 : cal.hole), shaft: shaft - (p.bought === 'shaft' ? 0 : cal.shaft) }
  if (model.shaft <= 0.2) throw new RangeError('The shaft modelled would be next to nothing: check the calibration.')
  const wc = tolH + tolS
  const rss = Math.hypot(tolH, tolS)
  const notes: string[] = []
  const worst: [number, number] = [r4(c - wc), r4(c + wc)]
  if (c > 0 && c - wc < 0) notes.push(`A clearance fit that can bind: with every size at its worst the gap closes to ${worst[0]}. Calibrate (fit.test, fit.calibrate) or take a looser class.`)
  if (c < 0 && c + wc > 0) notes.push(`A press that can come out loose: with every size at its worst it opens to ${worst[1]}. Calibrate, or take a tighter class.`)
  let strain: PairOut['strain']
  if (c < 0 && strainLimit !== undefined) {
    // The hub is stretched by the interference over its bore: δ/D at the
    // bore of a thick hub (Lamé, a shaft much stiffer or alike: the bore
    // takes about all of it). A thin wall stretches as much and is weaker.
    const value = -c / D
    strain = { value: r4(value), limit: strainLimit }
    if (value > strainLimit) notes.push(`The press stretches the hole’s rim ${r4(value * 100)} %, past the material’s ${r4(strainLimit * 100)} %: it may split. Take a looser class, a ductile material, or relieve the hub.`)
    if (p.wall !== undefined && p.wall < 0.4 * D) notes.push(`A hub wall of ${p.wall} round a ${D} hole is thin for a press (under 0.4 × the bore): it will spread the rim more than the hole.`)
  }
  if (c > 0 && c < 0.1) notes.push('Under 0.1 as printed is tighter than most printers hold: expect to sand or ream.')
  const def = p.cls ? CLASS_DEFS[p.cls] : null
  const it = itGrade(D, tol)
  return {
    nominal: D,
    cls: p.cls ?? null,
    clearance: r4(c),
    printed: { hole: r4(hole), shaft: r4(shaft) },
    model: { hole: r4(model.hole), shaft: r4(model.shaft) },
    basis,
    bought: p.bought ?? null,
    range: { worst, rss: [r4(c - rss), r4(c + rss)] },
    iso: { like: def?.iso ?? null, grade: it.grade, units: it.units },
    ...(strain ? { strain } : {}),
    notes,
  }
}

// ---- calibration -------------------------------------------------------------------------

export interface Reading {
  kind: 'hole' | 'shaft'
  /** As modelled. */
  model: number
  /** As measured on the print. */
  measured: number
}

/** Offsets from features measured on a print: holes' shortfall and shafts'
 *  excess, each the mean of its readings; the spread is the readings'
 *  standard deviation about their own offset. */
export function fromReadings(readings: Reading[], was: Calibration): Calibration & { holes: number; shafts: number } {
  const holes = readings.filter((r) => r.kind === 'hole').map((r) => r.model - r.measured)
  const shafts = readings.filter((r) => r.kind === 'shaft').map((r) => r.measured - r.model)
  if (!holes.length && !shafts.length) throw new RangeError('No readings.')
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
  const h = holes.length ? mean(holes) : was.hole
  const s = shafts.length ? mean(shafts) : was.shaft
  const far = readings.find((r) => Math.abs(r.model - r.measured) > 2)
  if (far) throw new RangeError(`A ${far.kind} modelled ${far.model} measured ${far.measured}: that far off is a misreading or another unit, not the printer.`)
  if (h < -1 || h > 2 || s < -1 || s > 2) throw new RangeError('Those readings give offsets past −1 to 2: check them.')
  const dev = [...holes.map((x) => x - h), ...shafts.map((x) => x - s)]
  const dof = readings.length - (holes.length ? 1 : 0) - (shafts.length ? 1 : 0)
  const spread = dof > 0 ? Math.sqrt(dev.reduce((t, x) => t + x * x, 0) / dof) : undefined
  return { hole: r4(h), shaft: r4(s), source: 'measured', n: readings.length, ...(spread !== undefined ? { spread: r4(spread) } : {}), holes: holes.length, shafts: shafts.length }
}

/** fit-comp's radial offsets (material standing into holes, outer walls
 *  standing out) as diametral ones. */
export const fromPrintFit = (holeOffset: number, contourOffset: number): Calibration => ({ hole: r4(2 * holeOffset), shaft: r4(2 * contourOffset), source: 'print-fit' })

// ---- tolerance stack ----------------------------------------------------------------------

export interface StackItem {
  name?: string
  nominal: number
  /** +1 adds to the gap, −1 takes from it. */
  sign?: 1 | -1
  /** ± — or plus and minus, each ≥ 0. */
  tol?: number
  plus?: number
  minus?: number
}

export interface StackOut {
  nominal: number
  mean: number
  worst: { min: number; max: number; spread: number }
  rss: { min: number; max: number; spread: number }
  /** The share of the variance each size brings, largest first. */
  contributions: { name: string; share: number; tol: number }[]
  /** With each tolerance taken as ±3σ, the chance the gap falls under
   *  `min` (0 by default). */
  below?: { min: number; chance: number }
  items: { name: string; sign: 1 | -1; nominal: number; plus: number; minus: number; defaulted: boolean }[]
}

/** The standard normal's distribution function (Abramowitz & Stegun
 *  7.1.26 for erf, |error| < 1.5e-7). */
export function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf)
}

export function stack(items: StackItem[], defaultTol: number, min = 0): StackOut {
  if (items.length === 0) throw new RangeError('items: at least one size.')
  const rows = items.map((it, i) => {
    const defaulted = it.tol === undefined && it.plus === undefined && it.minus === undefined
    if ((it.plus === undefined) !== (it.minus === undefined)) throw new RangeError(`items[${i}]: plus and minus together (+0.2 −0 is plus 0.2, minus 0).`)
    const plus = it.plus ?? it.tol ?? defaultTol
    const minus = it.minus ?? it.tol ?? defaultTol
    if (!(plus >= 0 && minus >= 0)) throw new RangeError(`items[${i}]: plus and minus are ≥ 0 (a minus of 0.1 is 0.1).`)
    return { name: it.name?.trim() || `#${i + 1}`, sign: (it.sign ?? 1) as 1 | -1, nominal: it.nominal, plus, minus, defaulted }
  })
  let nominal = 0, mean = 0, wc = 0, v = 0
  for (const r of rows) {
    const half = (r.plus + r.minus) / 2
    nominal += r.sign * r.nominal
    // A sign of −1 turns the size's plus into the gap's minus; the mid
    // of its zone moves the gap's mean either way.
    mean += r.sign * (r.nominal + (r.plus - r.minus) / 2)
    wc += half
    v += half * half
  }
  const rss = Math.sqrt(v)
  const sigma = rss / 3
  const contributions = rows
    .map((r) => ({ name: r.name, tol: r4((r.plus + r.minus) / 2), share: v > 0 ? r4(((r.plus + r.minus) / 2) ** 2 / v) : 0 }))
    .sort((a, b) => b.share - a.share)
  return {
    nominal: r4(nominal),
    mean: r4(mean),
    worst: { min: r4(mean - wc), max: r4(mean + wc), spread: r4(wc) },
    rss: { min: r4(mean - rss), max: r4(mean + rss), spread: r4(rss) },
    contributions,
    ...(sigma > 0 ? { below: { min, chance: r4(phi((min - mean) / sigma)) } } : {}),
    items: rows,
  }
}
