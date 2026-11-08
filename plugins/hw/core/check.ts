// SPDX-License-Identifier: AGPL-3.0-only
// What a round hole fits: its modelled diameter against the hole each piece
// of hardware in the table would be cut at (with the allowances set), and
// against the hardware itself as it will print — the diameter less the
// allowance, since FDM holes come out small by about that much.

import { BEARINGS, INSERTS, MAGNETS, METRIC, type Kind } from './hardware'
import type { Settings } from './plan'

export interface Match {
  kind: Kind | 'head'
  size: string
  /** What the hole would be for: a screw's clearance, an insert, … */
  role: string
  /** The diameter the Hardware workspace would cut for it. */
  cut: number
  /** The hole given less that: positive is larger. */
  off: number
  /** The hole as it should print, less the hardware's own diameter:
   *  negative is interference. */
  gap: number
  fit: string
  /** Shallower than it needs, when the hole's depth is known. */
  shallow?: string
}

const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0

/** Within this of the cut size a size is listed. */
export const CHECK_WINDOW = 0.5

export function fitsOf(diameter: number, s: Settings, depth?: number): Match[] {
  const out: Match[] = []
  const push = (m: Omit<Match, 'off' | 'gap'> & { part: number; allow: number }) => {
    const off = diameter - m.cut
    if (Math.abs(off) > CHECK_WINDOW) return
    const { part, allow, ...rest } = m
    out.push({ ...rest, off: r3(off), gap: r3(diameter - allow - part), cut: r3(m.cut) })
  }
  for (const m of METRIC) {
    const a = s.allowance.screw
    const printed = diameter - a
    const classes = (['fine', 'medium', 'coarse'] as const).map((c) => ({ c, off: Math.abs(printed - m.clearance[c]) })).sort((x, y) => x.off - y.off)
    const clear = printed < m.d ? 'too tight: the screw binds' : printed < m.clearance.fine - 0.1 ? 'close: under ISO fine' : printed > m.clearance.coarse + 0.3 ? 'loose: past ISO coarse' : `ISO ${classes[0].c}`
    push({ kind: 'screw', size: m.size, role: `${s.fit} clearance`, cut: m.clearance[s.fit] + a, part: m.d, allow: a, fit: clear })
    const p = s.allowance.pilot
    const bite = diameter - p - m.pilot
    push({ kind: 'pilot', size: m.size, role: 'thread-forming pilot', cut: m.pilot + p, part: m.pilot, allow: p, fit: bite < -0.15 ? 'tight: hard to drive, may split' : bite > 0.15 ? 'weak bite' : 'bites', ...(depth !== undefined && depth < 2 * m.d ? { shallow: `${r3(depth)} deep; ${2 * m.d} at least to hold` } : {}) })
    const heads: [string, number | undefined][] = [['socket cap', m.socket.dk], ['button', m.button?.dk]]
    for (const [word, dk] of heads) {
      if (dk === undefined) continue
      const g = printed - dk
      push({ kind: 'head', size: m.size, role: `${word} head counterbore`, cut: dk + s.headMargin + a, part: dk, allow: a, fit: g < 0 ? 'too tight for the head' : g > 1.2 ? 'loose round the head' : 'head fits' })
    }
  }
  for (const ins of INSERTS) {
    const a = s.allowance.insert
    const g = diameter - a - ins.hole
    push({ kind: 'insert', size: ins.size, role: 'heat-set insert', cut: ins.hole + a, part: ins.hole, allow: a, fit: g < -0.1 ? 'tight: pushes out more plastic' : g > 0.1 ? 'loose: may spin or pull out' : 'right size', ...(depth !== undefined && depth < ins.length ? { shallow: `${r3(depth)} deep; the insert is ${ins.length} long` } : {}) })
  }
  for (const mg of MAGNETS) {
    const a = s.allowance.magnet
    const g = diameter - a - mg.d
    push({ kind: 'magnet', size: mg.size, role: 'disc magnet', cut: mg.d + a, part: mg.d, allow: a, fit: g < 0 ? 'too tight' : g <= 0.15 ? 'snug: press in' : 'loose: glue it', ...(depth !== undefined && depth < mg.t ? { shallow: `${r3(depth)} deep; the magnet is ${mg.t} thick` } : {}) })
  }
  for (const b of BEARINGS) {
    const a = s.allowance.bearing
    const g = diameter - a - b.od
    push({ kind: 'bearing', size: b.size, role: 'bearing seat', cut: b.od + a, part: b.od, allow: a, fit: g < -0.05 ? 'too tight' : g <= 0.05 ? 'press fit' : g <= 0.15 ? 'slip fit' : 'loose', ...(depth !== undefined && depth < b.width ? { shallow: `${r3(depth)} deep; the bearing is ${b.width} wide` } : {}) })
  }
  return out.sort((x, y) => Math.abs(x.off) - Math.abs(y.off))
}
