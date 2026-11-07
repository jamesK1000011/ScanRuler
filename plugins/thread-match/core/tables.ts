// SPDX-License-Identifier: AGPL-3.0-only
// The thread families thread-match knows, as rows of facts: each size's
// major diameter, pitch, minor diameters, flank angle and taper, and the
// standard the numbers come from. Only dimensions are kept here — the
// standards' text is not, and is not needed.
//
// Minor diameters are the basic ones, the profile with no tolerance:
//   60° V (ISO 68-1, ASME B1.1)  nut D1 = d − 1.082532 P, bolt d3 = d − 1.226869 P
//   NPT (ASME B1.20.1)           truncated height 0.8 P, so d − 1.6 P at the gauge diameter
//   Whitworth 55° (ISO 228, ISO 7) height 0.640327 P, so d − 1.280654 P
//   Trapezoidal 30° (ISO 2904)   bolt d3 = d − 2 (P/2 + ac), nut D1 = d − P
//   ACME 29° (ASME B1.5)         basic height P/2, so d − P
//   print45 (ScanRuler's own)     0.3 P deep, so d − 0.6 P

export type Family = 'metric' | 'unc' | 'unf' | 'unef' | 'npt' | 'bspp' | 'bspt' | 'tr' | 'acme' | 'print45'

export interface FamilyInfo {
  id: Family
  label: string
  /** The included angle between the flanks, degrees. */
  angle: number
  /** How much the diameter changes per unit of length: 1/16 for the pipe
   *  tapers, 0 for parallel threads. */
  taper: number
  /** Inch-based: sizes named in inches, pitch given as threads per inch. */
  inch: boolean
  source: string
}

export const FAMILIES: readonly FamilyInfo[] = [
  { id: 'metric', label: 'ISO metric', angle: 60, taper: 0, inch: false, source: 'ISO 261 sizes, ISO 68-1 profile' },
  { id: 'unc', label: 'Unified coarse (UNC)', angle: 60, taper: 0, inch: true, source: 'ASME B1.1' },
  { id: 'unf', label: 'Unified fine (UNF)', angle: 60, taper: 0, inch: true, source: 'ASME B1.1' },
  { id: 'unef', label: 'Unified extra fine (UNEF)', angle: 60, taper: 0, inch: true, source: 'ASME B1.1' },
  { id: 'npt', label: 'American taper pipe (NPT)', angle: 60, taper: 1 / 16, inch: true, source: 'ASME B1.20.1' },
  { id: 'bspp', label: 'British parallel pipe (G / BSPP)', angle: 55, taper: 0, inch: true, source: 'ISO 228-1' },
  { id: 'bspt', label: 'British taper pipe (R / BSPT)', angle: 55, taper: 1 / 16, inch: true, source: 'ISO 7-1' },
  { id: 'tr', label: 'Metric trapezoidal (Tr)', angle: 30, taper: 0, inch: false, source: 'ISO 2904 (DIN 103)' },
  { id: 'acme', label: 'ACME, general purpose', angle: 29, taper: 0, inch: true, source: 'ASME B1.5' },
  { id: 'print45', label: '3D printing, 45° flanks', angle: 90, taper: 0, inch: false, source: 'ScanRuler print form (the Thread feature)' },
]

export const FAMILY_IDS: readonly Family[] = FAMILIES.map((f) => f.id)

export const familyInfo = (id: Family): FamilyInfo => FAMILIES.find((f) => f.id === id)!

export interface ThreadRow {
  family: Family
  designation: string
  /** The size as the family names it: M6, 1/4, #10, 1/2, Tr16. */
  size: string
  /** Major diameter, mm. For the tapers: at the gauge plane (NPT: the
   *  pipe's outside diameter). */
  major: number
  pitch: number
  /** Threads per inch, for the inch families. */
  tpi?: number
  /** Basic minor diameter of a bolt (external) and a nut (internal), mm. */
  minorExternal: number
  minorInternal: number
  angle: number
  taper: number
  /** The basic profile's depth as a share of the pitch, bolt side. */
  depthShare: number
  /** A word on how the size is met in practice, where it helps. */
  note?: string
}

const INCH = 25.4
const r4 = (v: number) => Math.round(v * 1e4) / 1e4
const trim = (v: number) => String(Math.round(v * 1e4) / 1e4)

/** ISO 261, first and second choice to M64: diameter and pitches, coarse first. */
const METRIC: [number, number[]][] = [
  [1, [0.25, 0.2]], [1.2, [0.25, 0.2]], [1.4, [0.3, 0.2]], [1.6, [0.35, 0.2]], [2, [0.4, 0.25]], [2.5, [0.45, 0.35]],
  [3, [0.5, 0.35]], [3.5, [0.6, 0.35]], [4, [0.7, 0.5]], [5, [0.8, 0.5]], [6, [1, 0.75]], [7, [1, 0.75]],
  [8, [1.25, 1, 0.75]], [10, [1.5, 1.25, 1, 0.75]], [12, [1.75, 1.5, 1.25, 1]], [14, [2, 1.5, 1.25, 1]], [16, [2, 1.5, 1]],
  [18, [2.5, 2, 1.5, 1]], [20, [2.5, 2, 1.5, 1]], [22, [2.5, 2, 1.5, 1]], [24, [3, 2, 1.5, 1]], [27, [3, 2, 1.5, 1]],
  [30, [3.5, 3, 2, 1.5, 1]], [33, [3.5, 3, 2, 1.5]], [36, [4, 3, 2, 1.5]], [39, [4, 3, 2, 1.5]], [42, [4.5, 4, 3, 2, 1.5]],
  [45, [4.5, 4, 3, 2, 1.5]], [48, [5, 4, 3, 2, 1.5]], [52, [5, 4, 3, 2, 1.5]], [56, [5.5, 4, 3, 2, 1.5]], [60, [5.5, 4, 3, 2, 1.5]],
  [64, [6, 4, 3, 2, 1.5]],
]

/** ASME B1.1: size, major diameter in inches, threads per inch. */
const UNC: [string, number, number][] = [
  ['#1', 0.073, 64], ['#2', 0.086, 56], ['#3', 0.099, 48], ['#4', 0.112, 40], ['#5', 0.125, 40], ['#6', 0.138, 32],
  ['#8', 0.164, 32], ['#10', 0.19, 24], ['#12', 0.216, 24], ['1/4', 0.25, 20], ['5/16', 0.3125, 18], ['3/8', 0.375, 16],
  ['7/16', 0.4375, 14], ['1/2', 0.5, 13], ['9/16', 0.5625, 12], ['5/8', 0.625, 11], ['3/4', 0.75, 10], ['7/8', 0.875, 9],
  ['1', 1, 8], ['1-1/8', 1.125, 7], ['1-1/4', 1.25, 7], ['1-3/8', 1.375, 6], ['1-1/2', 1.5, 6], ['1-3/4', 1.75, 5], ['2', 2, 4.5],
]

const UNF: [string, number, number][] = [
  ['#0', 0.06, 80], ['#1', 0.073, 72], ['#2', 0.086, 64], ['#3', 0.099, 56], ['#4', 0.112, 48], ['#5', 0.125, 44],
  ['#6', 0.138, 40], ['#8', 0.164, 36], ['#10', 0.19, 32], ['#12', 0.216, 28], ['1/4', 0.25, 28], ['5/16', 0.3125, 24],
  ['3/8', 0.375, 24], ['7/16', 0.4375, 20], ['1/2', 0.5, 20], ['9/16', 0.5625, 18], ['5/8', 0.625, 18], ['3/4', 0.75, 16],
  ['7/8', 0.875, 14], ['1', 1, 12], ['1-1/8', 1.125, 12], ['1-1/4', 1.25, 12], ['1-3/8', 1.375, 12], ['1-1/2', 1.5, 12],
]

const UNEF: [string, number, number][] = [
  ['#12', 0.216, 32], ['1/4', 0.25, 32], ['5/16', 0.3125, 32], ['3/8', 0.375, 32], ['7/16', 0.4375, 28], ['1/2', 0.5, 28],
  ['9/16', 0.5625, 24], ['5/8', 0.625, 24], ['11/16', 0.6875, 24], ['3/4', 0.75, 20], ['13/16', 0.8125, 20], ['7/8', 0.875, 20],
  ['15/16', 0.9375, 20], ['1', 1, 20], ['1-1/16', 1.0625, 18], ['1-1/8', 1.125, 18], ['1-1/4', 1.25, 18], ['1-3/8', 1.375, 18],
  ['1-1/2', 1.5, 18], ['1-5/8', 1.625, 18],
]

/** ASME B1.20.1: nominal pipe size, threads per inch, pipe outside diameter in inches. */
const NPT: [string, number, number][] = [
  ['1/16', 27, 0.3125], ['1/8', 27, 0.405], ['1/4', 18, 0.54], ['3/8', 18, 0.675], ['1/2', 14, 0.84], ['3/4', 14, 1.05],
  ['1', 11.5, 1.315], ['1-1/4', 11.5, 1.66], ['1-1/2', 11.5, 1.9], ['2', 11.5, 2.375], ['2-1/2', 8, 2.875], ['3', 8, 3.5],
  ['3-1/2', 8, 4], ['4', 8, 4.5],
]

/** ISO 228-1 / ISO 7-1: size, threads per inch, major diameter in mm; the
 *  last column marks sizes ISO 7 (the taper) has too. */
const BSP: [string, number, number, boolean][] = [
  ['1/16', 28, 7.723, true], ['1/8', 28, 9.728, true], ['1/4', 19, 13.157, true], ['3/8', 19, 16.662, true],
  ['1/2', 14, 20.955, true], ['5/8', 14, 22.911, false], ['3/4', 14, 26.441, true], ['7/8', 14, 30.201, false],
  ['1', 11, 33.249, true], ['1-1/8', 11, 37.897, false], ['1-1/4', 11, 41.91, true], ['1-1/2', 11, 47.803, true],
  ['1-3/4', 11, 53.746, false], ['2', 11, 59.614, true], ['2-1/2', 11, 75.184, true], ['3', 11, 87.884, true], ['4', 11, 113.03, true],
]

/** ISO 2904: diameter and pitches, the preferred first. */
const TR: [number, number[]][] = [
  [8, [1.5, 2]], [9, [2, 1.5]], [10, [2, 1.5]], [11, [2, 3]], [12, [3, 2]], [14, [3, 2]], [16, [4, 2]], [18, [4, 2]],
  [20, [4, 2]], [22, [5, 3, 8]], [24, [5, 3, 8]], [26, [5, 3, 8]], [28, [5, 3, 8]], [30, [6, 3, 10]], [32, [6, 3, 10]],
  [36, [6, 3, 10]], [40, [7, 3, 10]], [44, [7, 3, 12]], [48, [8, 3, 12]], [50, [8, 3, 12]], [52, [8, 3, 12]], [60, [9, 3, 14]],
]

/** ASME B1.5, general purpose: size, major diameter in inches, threads per inch. */
const ACME: [string, number, number][] = [
  ['1/4', 0.25, 16], ['5/16', 0.3125, 14], ['3/8', 0.375, 12], ['7/16', 0.4375, 12], ['1/2', 0.5, 10], ['5/8', 0.625, 8],
  ['3/4', 0.75, 6], ['7/8', 0.875, 6], ['1', 1, 5], ['1-1/8', 1.125, 5], ['1-1/4', 1.25, 5], ['1-3/8', 1.375, 4],
  ['1-1/2', 1.5, 4], ['1-3/4', 1.75, 4], ['2', 2, 4], ['2-1/4', 2.25, 3], ['2-1/2', 2.5, 3], ['2-3/4', 2.75, 3], ['3', 3, 2],
  ['3-1/2', 3.5, 2], ['4', 4, 2], ['4-1/2', 4.5, 2], ['5', 5, 2],
]

/** The printing form's pitch for an ISO coarse one, as the Thread feature
 *  sizes it: as deep as the coarse thread (0.5413 P against 0.3 P), on a
 *  quarter-millimetre step under 3 mm and a half from 3 mm up. */
function printPitch(coarse: number): number {
  const p = (coarse * (5 / 8) * (Math.sqrt(3) / 2)) / 0.3
  const step = p < 3 ? 0.25 : 0.5
  return Math.round(p / step) * step
}

/** Trapezoidal crest clearance ac by pitch (ISO 2904). */
const trClearance = (p: number) => (p <= 1.5 ? 0.15 : p <= 5 ? 0.25 : p <= 12 ? 0.5 : 1)

const V60_DEPTH = (5 / 8) * (Math.sqrt(3) / 2)

function build(): ThreadRow[] {
  const rows: ThreadRow[] = []
  const v60 = (family: Family, size: string, d: number, p: number, designation: string, tpi?: number) =>
    rows.push({ family, size, designation, major: r4(d), pitch: r4(p), ...(tpi ? { tpi } : {}), minorExternal: r4(d - 1.226869 * p), minorInternal: r4(d - 1.082532 * p), angle: 60, taper: 0, depthShare: r4(V60_DEPTH) })
  for (const [d, pitches] of METRIC) for (const p of pitches) v60('metric', `M${d}`, d, p, `M${d}×${trim(p)}`)
  for (const [family, table] of [['unc', UNC], ['unf', UNF], ['unef', UNEF]] as const)
    for (const [size, din, tpi] of table) v60(family, size, din * INCH, INCH / tpi, `${size}-${tpi} ${family.toUpperCase()}`, tpi)
  for (const [size, tpi, odIn] of NPT) {
    const d = odIn * INCH, p = INCH / tpi
    rows.push({ family: 'npt', size, designation: `${size}-${tpi} NPT`, major: r4(d), pitch: r4(p), tpi, minorExternal: r4(d - 1.6 * p), minorInternal: r4(d - 1.6 * p), angle: 60, taper: 1 / 16, depthShare: 0.8 })
  }
  for (const [size, tpi, d, tapered] of BSP) {
    const p = INCH / tpi
    const common = { size, major: r4(d), pitch: r4(p), tpi, minorExternal: r4(d - 1.280654 * p), minorInternal: r4(d - 1.280654 * p), angle: 55, depthShare: 0.6403 }
    rows.push({ family: 'bspp', designation: `G ${size}`, taper: 0, ...common })
    if (tapered) rows.push({ family: 'bspt', designation: `R ${size}`, taper: 1 / 16, note: 'R external, Rc tapered internal, Rp parallel internal (ISO 7-1)', ...common })
  }
  for (const [d, pitches] of TR)
    for (const p of pitches) {
      const ac = trClearance(p)
      rows.push({ family: 'tr', size: `Tr${d}`, designation: `Tr${d}×${trim(p)}`, major: d, pitch: p, minorExternal: r4(d - 2 * (p / 2 + ac)), minorInternal: r4(d - p), angle: 30, taper: 0, depthShare: r4(0.5 + ac / p), ...(d === 8 && p === 2 ? { note: 'Common on 3D-printer lead screws as Tr8×8 (P2): 4 starts, 8 mm lead' } : {}) })
    }
  for (const [size, din, tpi] of ACME) {
    const d = din * INCH, p = INCH / tpi
    rows.push({ family: 'acme', size, designation: `${size}-${tpi} ACME`, major: r4(d), pitch: r4(p), tpi, minorExternal: r4(d - p), minorInternal: r4(d - p), angle: 29, taper: 0, depthShare: 0.5 })
  }
  for (const [d, [coarse]] of METRIC.filter(([d]) => d >= 3))
    for (const p of [printPitch(coarse), coarse])
      rows.push({ family: 'print45', size: `Ø${d}`, designation: `Ø${d}×${trim(p)} print`, major: d, pitch: p, minorExternal: r4(d - 0.6 * p), minorInternal: r4(d - 0.6 * p), angle: 90, taper: 0, depthShare: 0.3 })
  return rows
}

export const ROWS: readonly ThreadRow[] = build()

export const rowsOf = (families: readonly Family[]): ThreadRow[] => ROWS.filter((r) => families.includes(r.family))

/** A row by its designation, forgiving case, spaces and x for ×. */
export function lookup(designation: string): ThreadRow | null {
  const key = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/x/g, '×')
  const k = key(designation)
  return ROWS.find((r) => key(r.designation) === k) ?? null
}
