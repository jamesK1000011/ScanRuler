// SPDX-License-Identifier: AGPL-3.0-only
// Common standard parts by their nominal dimensions, offline: socket head
// cap screws (ISO 4762), button head screws (ISO 7380-1), hex nuts (ISO
// 4032), plain washers (ISO 7089) and deep-groove ball bearings (the
// ISO 15 boundary dimensions every maker uses). Dimensions only, in mm, the
// nominal values — the standards' tolerances and text are not here and are
// not needed to tell one size from another.

export type Kind = 'socket-head-screw' | 'button-head-screw' | 'hex-nut' | 'washer' | 'bearing'

export interface StandardPart {
  kind: Kind
  designation: string
  standard: string
  /** Named dimensions, mm. */
  dims: Record<string, number>
}

export interface KindInfo {
  kind: Kind
  label: string
  standard: string
  /** What each dimension is, for a person with calipers. */
  dims: Record<string, string>
}

export const KINDS: readonly KindInfo[] = [
  { kind: 'socket-head-screw', label: 'Socket head cap screw', standard: 'ISO 4762 (DIN 912)', dims: { d: 'thread diameter', dk: 'head diameter', k: 'head height', s: 'hex key size across flats' } },
  { kind: 'button-head-screw', label: 'Button head screw', standard: 'ISO 7380-1', dims: { d: 'thread diameter', dk: 'head diameter', k: 'head height', s: 'hex key size across flats' } },
  { kind: 'hex-nut', label: 'Hex nut', standard: 'ISO 4032', dims: { d: 'thread diameter', s: 'width across flats', m: 'height' } },
  { kind: 'washer', label: 'Plain washer', standard: 'ISO 7089', dims: { d1: 'hole diameter', d2: 'outside diameter', h: 'thickness' } },
  { kind: 'bearing', label: 'Deep-groove ball bearing', standard: 'ISO 15 boundary dimensions', dims: { d: 'bore', D: 'outside diameter', B: 'width' } },
]

const SHCS: [number, number, number, number][] = [
  [2, 3.8, 2, 1.5], [2.5, 4.5, 2.5, 2], [3, 5.5, 3, 2.5], [4, 7, 4, 3], [5, 8.5, 5, 4], [6, 10, 6, 5], [8, 13, 8, 6], [10, 16, 10, 8], [12, 18, 12, 10], [16, 24, 16, 14], [20, 30, 20, 17], [24, 36, 24, 19],
]
const BHCS: [number, number, number, number][] = [
  [3, 5.7, 1.65, 2], [4, 7.6, 2.2, 2.5], [5, 9.5, 2.75, 3], [6, 10.5, 3.3, 4], [8, 14, 4.4, 5], [10, 17.5, 5.5, 6], [12, 21, 6.6, 8],
]
const NUT: [number, number, number][] = [
  [2, 4, 1.6], [2.5, 5, 2], [3, 5.5, 2.4], [4, 7, 3.2], [5, 8, 4.7], [6, 10, 5.2], [8, 13, 6.8], [10, 16, 8.4], [12, 18, 10.8], [16, 24, 14.8], [20, 30, 18], [24, 36, 21.5],
]
const WASHER: [number, number, number, number][] = [
  [2, 2.2, 5, 0.3], [2.5, 2.7, 6, 0.5], [3, 3.2, 7, 0.5], [4, 4.3, 9, 0.8], [5, 5.3, 10, 1], [6, 6.4, 12, 1.6], [8, 8.4, 16, 1.6], [10, 10.5, 20, 2], [12, 13, 24, 2.5], [16, 17, 30, 3], [20, 21, 37, 3], [24, 25, 44, 4],
]
const BEARING: [string, number, number, number][] = [
  ['623', 3, 10, 4], ['624', 4, 13, 5], ['625', 5, 16, 5], ['626', 6, 19, 6], ['627', 7, 22, 7], ['608', 8, 22, 7], ['609', 9, 24, 7],
  ['6000', 10, 26, 8], ['6001', 12, 28, 8], ['6002', 15, 32, 9], ['6003', 17, 35, 10], ['6004', 20, 42, 12], ['6005', 25, 47, 12],
  ['6200', 10, 30, 9], ['6201', 12, 32, 10], ['6202', 15, 35, 11], ['6203', 17, 40, 12], ['6204', 20, 47, 14], ['6205', 25, 52, 15],
  ['683', 3, 7, 3], ['684', 4, 9, 4], ['685', 5, 11, 5], ['686', 6, 13, 5], ['688', 8, 16, 5], ['693', 3, 8, 4], ['694', 4, 11, 4], ['695', 5, 13, 4], ['696', 6, 15, 5], ['698', 8, 19, 6],
  ['6800', 10, 19, 5], ['6801', 12, 21, 5], ['6802', 15, 24, 5], ['6900', 10, 22, 6], ['6901', 12, 24, 6], ['6902', 15, 28, 7],
  ['MR63', 3, 6, 2.5], ['MR74', 4, 7, 2.5], ['MR85', 5, 8, 2.5], ['MR105', 5, 10, 4], ['MR115', 5, 11, 4], ['MR128', 8, 12, 3.5],
]

export const PARTS: readonly StandardPart[] = [
  ...SHCS.map(([d, dk, k, s]): StandardPart => ({ kind: 'socket-head-screw', designation: `M${d} socket head cap screw`, standard: 'ISO 4762', dims: { d, dk, k, s } })),
  ...BHCS.map(([d, dk, k, s]): StandardPart => ({ kind: 'button-head-screw', designation: `M${d} button head screw`, standard: 'ISO 7380-1', dims: { d, dk, k, s } })),
  ...NUT.map(([d, s, m]): StandardPart => ({ kind: 'hex-nut', designation: `M${d} hex nut`, standard: 'ISO 4032', dims: { d, s, m } })),
  ...WASHER.map(([d, d1, d2, h]): StandardPart => ({ kind: 'washer', designation: `M${d} washer`, standard: 'ISO 7089', dims: { d1, d2, h } })),
  ...BEARING.map(([n, d, D, B]): StandardPart => ({ kind: 'bearing', designation: `${n} bearing`, standard: 'ISO 15', dims: { d, D, B } })),
]

export interface Match {
  part: StandardPart
  /** Each dimension given: nominal, measured, the difference. */
  agree: { dim: string; nominal: number; measured: number; off: number }[]
  /** The largest share any dimension is off by. */
  worst: number
  score: number
}

/** The standard parts whose dimensions fit the ones measured, best first.
 *  Only the dimensions given are compared, each as a share of its nominal
 *  size so a 0.3 mm washer and a 36 mm head weigh alike; parts of a kind
 *  that lacks a dimension given are left out. */
export function match(measured: Record<string, number>, kind?: Kind, limit = 5): Match[] {
  const names = Object.keys(measured)
  if (!names.length) return []
  const out: Match[] = []
  for (const part of PARTS) {
    if (kind && part.kind !== kind) continue
    if (!names.every((n) => n in part.dims)) continue
    const agree = names.map((dim) => ({ dim, nominal: part.dims[dim], measured: measured[dim], off: Math.round((measured[dim] - part.dims[dim]) * 1000) / 1000 }))
    const shares = agree.map((a) => Math.abs(a.off) / Math.max(part.dims[a.dim], 0.5))
    const worst = Math.max(...shares)
    out.push({ part, agree, worst: Math.round(worst * 1000) / 1000, score: Math.round(shares.reduce((s, v) => s + v * v, 0) * 1e6) / 1e6 })
  }
  return out.sort((a, b) => a.score - b.score).slice(0, limit)
}

export function lookup(designation: string): StandardPart[] {
  const q = designation.toLowerCase().replace(/\s+/g, ' ').trim()
  return PARTS.filter((p) => p.designation.toLowerCase().includes(q) || p.designation.toLowerCase().startsWith(q.split(' ')[0] + ' '))
}
