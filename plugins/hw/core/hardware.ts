// SPDX-License-Identifier: AGPL-3.0-only
// The hardware a printed part takes, by size, from the published standards:
// ISO 273 clearance holes; ISO 4762 socket cap, ISO 7380 button and
// ISO 10642 countersunk heads (largest head diameter and height); ISO 4032
// hex nuts (across flats, largest thickness). Heat-set inserts, pilots for
// thread-forming screws, disc magnets and the bearings are typical figures
// for FDM parts, not a standard: every one is adjustable through the
// allowances and a depth given. All figures in millimetres.

export type Fit = 'fine' | 'medium' | 'coarse'
export type Head = 'socket' | 'button' | 'countersunk' | 'none'
export type Kind = 'screw' | 'nut' | 'insert' | 'pilot' | 'magnet' | 'bearing'

export const KINDS: readonly Kind[] = ['screw', 'nut', 'insert', 'pilot', 'magnet', 'bearing']
export const HEADS: readonly Head[] = ['socket', 'button', 'countersunk', 'none']
export const FITS: readonly Fit[] = ['fine', 'medium', 'coarse']

export interface Metric {
  size: string
  /** Nominal (major) diameter. */
  d: number
  /** ISO 273 clearance holes. */
  clearance: Record<Fit, number>
  /** ISO 4762 socket cap: head diameter and height (max). */
  socket: { dk: number; k: number }
  /** ISO 7380-1 button head; the standard starts at M3. */
  button: { dk: number; k: number } | null
  /** ISO 10642 countersunk, 90°: dk the theoretical sharp-edge diameter,
   *  k the head height; the standard starts at M3. */
  countersunk: { dk: number; k: number } | null
  /** ISO 4032 hex nut: across flats and thickness (max). */
  nut: { s: number; m: number }
  /** Pilot hole for a thread-forming screw in PLA, PETG or ABS (typical). */
  pilot: number
}

export const METRIC: readonly Metric[] = [
  { size: 'M2', d: 2, clearance: { fine: 2.2, medium: 2.4, coarse: 2.6 }, socket: { dk: 3.8, k: 2 }, button: null, countersunk: null, nut: { s: 4, m: 1.6 }, pilot: 1.7 },
  { size: 'M2.5', d: 2.5, clearance: { fine: 2.7, medium: 2.9, coarse: 3.1 }, socket: { dk: 4.5, k: 2.5 }, button: null, countersunk: null, nut: { s: 5, m: 2 }, pilot: 2.1 },
  { size: 'M3', d: 3, clearance: { fine: 3.2, medium: 3.4, coarse: 3.6 }, socket: { dk: 5.5, k: 3 }, button: { dk: 5.7, k: 1.65 }, countersunk: { dk: 6.72, k: 1.86 }, nut: { s: 5.5, m: 2.4 }, pilot: 2.5 },
  { size: 'M4', d: 4, clearance: { fine: 4.3, medium: 4.5, coarse: 4.8 }, socket: { dk: 7, k: 4 }, button: { dk: 7.6, k: 2.2 }, countersunk: { dk: 8.96, k: 2.48 }, nut: { s: 7, m: 3.2 }, pilot: 3.4 },
  { size: 'M5', d: 5, clearance: { fine: 5.3, medium: 5.5, coarse: 5.8 }, socket: { dk: 8.5, k: 5 }, button: { dk: 9.5, k: 2.75 }, countersunk: { dk: 11.2, k: 3.1 }, nut: { s: 8, m: 4.7 }, pilot: 4.2 },
  { size: 'M6', d: 6, clearance: { fine: 6.4, medium: 6.6, coarse: 7 }, socket: { dk: 10, k: 6 }, button: { dk: 10.5, k: 3.3 }, countersunk: { dk: 13.44, k: 3.72 }, nut: { s: 10, m: 5.2 }, pilot: 5 },
  { size: 'M8', d: 8, clearance: { fine: 8.4, medium: 9, coarse: 10 }, socket: { dk: 13, k: 8 }, button: { dk: 14, k: 4.4 }, countersunk: { dk: 17.92, k: 4.96 }, nut: { s: 13, m: 6.8 }, pilot: 6.8 },
]

export interface Insert {
  size: string
  /** The hole it is pressed into. */
  hole: number
  /** The insert's length. */
  length: number
  /** The least wall round the hole. */
  wall: number
  /** Its outside diameter, over the knurl: the cavity for one dropped in
   *  mid-print rather than pressed in hot. */
  od: number
}

/** Heat-set inserts: typical figures of the common brass ranges for 3D
 *  prints. Check the maker's sheet for yours. */
export const INSERTS: readonly Insert[] = [
  { size: 'M2', hole: 3.2, length: 3, wall: 1.3, od: 3.6 },
  { size: 'M2.5', hole: 4, length: 4, wall: 1.6, od: 4.6 },
  { size: 'M3', hole: 4, length: 5.7, wall: 1.6, od: 4.6 },
  { size: 'M3 short', hole: 4, length: 3, wall: 1.6, od: 4.6 },
  { size: 'M4', hole: 5.6, length: 8.1, wall: 2.1, od: 6.3 },
  { size: 'M5', hole: 6.4, length: 9.5, wall: 2.6, od: 7.1 },
]

export interface Magnet {
  size: string
  d: number
  t: number
}

/** Disc magnets in common stock sizes, diameter × thickness. */
export const MAGNETS: readonly Magnet[] = [
  [3, 2], [4, 2], [5, 2], [5, 3], [6, 2], [6, 3], [8, 2], [8, 3], [10, 2], [10, 3], [10, 5], [12, 3], [15, 3], [20, 3],
].map(([d, t]) => ({ size: `${d}x${t}`, d, t }))

export interface Bearing {
  size: string
  bore: number
  od: number
  width: number
}

/** Deep-groove ball bearings: bore, outside diameter and width. */
export const BEARINGS: readonly Bearing[] = [
  { size: '623', bore: 3, od: 10, width: 4 },
  { size: '624', bore: 4, od: 13, width: 5 },
  { size: '625', bore: 5, od: 16, width: 5 },
  { size: '688', bore: 8, od: 16, width: 5 },
  { size: '608', bore: 8, od: 22, width: 7 },
  { size: '6800', bore: 10, od: 19, width: 5 },
  { size: '6801', bore: 12, od: 21, width: 5 },
  { size: '6802', bore: 15, od: 24, width: 5 },
  { size: '6803', bore: 17, od: 26, width: 5 },
  { size: '6804', bore: 20, od: 32, width: 7 },
  { size: '6805', bore: 25, od: 37, width: 7 },
  { size: '6806', bore: 30, od: 42, width: 7 },
]

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/×|\*/g, 'x')

export const metricOf = (size: string) => METRIC.find((m) => norm(m.size) === norm(size))
export const insertOf = (size: string) => INSERTS.find((m) => norm(m.size) === norm(size))
export const magnetOf = (size: string) => MAGNETS.find((m) => norm(m.size) === norm(size).replace(/\s*x\s*/, 'x'))
export const bearingOf = (size: string) => BEARINGS.find((m) => norm(m.size) === norm(size).replace(/-?(2rs|zz|rs|2z)$/, ''))

/** The sizes a kind comes in, in the table's order. */
export function sizesOf(kind: Kind): string[] {
  switch (kind) {
    case 'screw':
    case 'nut':
    case 'pilot':
      return METRIC.map((m) => m.size)
    case 'insert':
      return INSERTS.map((m) => m.size)
    case 'magnet':
      return MAGNETS.map((m) => m.size)
    case 'bearing':
      return BEARINGS.map((m) => m.size)
  }
}

/** The heads a size takes: button and countersunk start at M3. */
export const headsOf = (m: Metric): Head[] => HEADS.filter((h) => h === 'socket' || h === 'none' || m[h] !== null)

/** The whole table, as hw.list gives it. */
export function table() {
  return JSON.parse(JSON.stringify({
    metric: METRIC.map((m) => ({ ...m, nut: { ...m.nut, e: Math.round((m.nut.s / Math.cos(Math.PI / 6)) * 100) / 100 } })),
    inserts: INSERTS,
    magnets: MAGNETS,
    bearings: BEARINGS,
    sources: {
      clearance: 'ISO 273 (fine, medium, coarse)',
      socket: 'ISO 4762, dk and k max',
      button: 'ISO 7380-1, dk and k max (M3 up)',
      countersunk: 'ISO 10642, theoretical dk and k max, 90° (M3 up)',
      nut: 'ISO 4032, s and m max; e across corners from s',
      typical: 'inserts, pilots, magnets and bearing figures are typical for FDM prints — adjust to your parts',
    },
  })) as {
    metric: (Metric & { nut: { s: number; m: number; e: number } })[]
    inserts: Insert[]
    magnets: Magnet[]
    bearings: Bearing[]
    sources: Record<string, string>
  }
}
