// SPDX-License-Identifier: AGPL-3.0-only
// A project box and its lid: a rounded box with walls and a floor, and a
// lid with a lip that drops inside it at a set clearance — screwed down at
// the corners into bosses, or held by the lip alone. The lid is laid out
// beside the box, upside down, to print flat on its top.

import { prism, type GenKernel, type H } from './kernel'

export interface BoxParams {
  /** Outside size, mm. */
  width: number
  depth: number
  height: number
  /** Corner radius outside, mm. */
  corner: number
  wall: number
  floor: number
  /** The lid's plate, mm. */
  lid: number
  /** How deep the lid's lip drops into the box, mm (0: a flat lid). */
  lip: number
  /** The gap between the lip and the wall, each side, mm. */
  clearance: number
  /** Corner bosses for M3 screws through the lid. */
  screws: boolean
}

export const BOX_DEFAULTS: BoxParams = { width: 80, depth: 60, height: 30, corner: 4, wall: 2, floor: 2, lid: 2, lip: 3, clearance: 0.2, screws: true }

/** M3: the pilot hole a self-tapping screw cuts into, the clearance hole in
 *  the lid, and the boss around it. */
const PILOT = 1.25
const PASS = 1.7
const BOSS = 3.5

export function checkBox(p: BoxParams): string | null {
  const fin = (x: number) => Number.isFinite(x)
  if (![p.width, p.depth, p.height, p.corner, p.wall, p.floor, p.lid, p.lip, p.clearance].every(fin)) return 'Every size is a number.'
  if (p.width < 20 || p.depth < 20 || p.width > 400 || p.depth > 400) return 'width and depth: 20 to 400.'
  if (p.height < 8 || p.height > 300) return 'height: 8 to 300.'
  if (p.wall < 0.8 || p.wall > 10) return 'wall: 0.8 to 10.'
  if (p.floor < 0.6 || p.floor > p.height - 4) return 'floor: 0.6 up to what the height leaves.'
  if (p.lid < 0.6 || p.lid > 10) return 'lid: 0.6 to 10.'
  if (p.lip < 0 || p.lip > p.height - p.floor - 1) return 'lip: 0 up to the inside height.'
  if (p.clearance < 0 || p.clearance > 1) return 'clearance: 0 to 1.'
  if (p.corner < 0 || p.corner > Math.min(p.width, p.depth) / 2 - 1) return 'corner: 0 up to just under half the smaller side.'
  const inside = Math.min(p.width, p.depth) - 2 * p.wall
  if (inside < 6) return 'wall: too thick for the size — it leaves next to no room inside.'
  if (p.lip > 0 && inside - 2 * p.clearance - 2 * Math.min(1.6, p.wall) < 2) return 'Too small inside for the lid’s lip: make it bigger, or the lip 0.'
  if (p.screws && inside < 4 * BOSS + 4) return 'Too small inside for corner screw bosses: turn screws off or make it bigger.'
  return null
}

/** Where the bosses stand: inside each corner, 0.4 mm into both walls —
 *  or, where the inside corner is rounded wider than a boss, into the
 *  round, on the diagonal, so no boss stands out through it. */
export function bossCentres(p: BoxParams): [number, number][] {
  const inR = Math.max(0, p.corner - p.wall)
  const cx = p.width / 2 - p.wall - inR
  const cy = p.depth / 2 - p.wall - inR
  // From the round's centre to the boss's: square in the corner, or along
  // the diagonal to 0.4 mm into the round.
  const off = inR > BOSS - 0.4 ? (inR - BOSS + 0.4) / Math.SQRT2 : inR - BOSS + 0.4
  const ox = cx + off
  const oy = cy + off
  return [[-ox, -oy], [ox, -oy], [ox, oy], [-ox, oy]]
}

/** The box, centred on the origin, standing on z = 0. */
export function box(k: GenKernel, p: BoxParams): H {
  const why = checkBox(p)
  if (why) throw new Error(why)
  const inR = Math.max(0, p.corner - p.wall)
  let body = k.cut(prism(k, 0, 0, p.width, p.depth, p.corner, 0, p.height), prism(k, 0, 0, p.width - 2 * p.wall, p.depth - 2 * p.wall, inR, p.floor, p.height + 1))
  if (p.screws) {
    // Bosses up to where the lip stops, so the lip rests on them too.
    const top = p.height - p.lip
    const bosses = bossCentres(p).map(([x, y]) => k.translate(k.makeCylinder(BOSS, top - p.floor + 0.01), x, y, p.floor - 0.01))
    body = k.fuseAll([body, ...bosses])
    body = k.cutAll(body, bossCentres(p).map(([x, y]) => k.translate(k.makeCylinder(PILOT, top - p.floor), x, y, p.floor + 0.6)))
  }
  return body
}

/** The lid, laid out beside the box (to +x), its top down on z = 0. */
export function lid(k: GenKernel, p: BoxParams): H {
  const why = checkBox(p)
  if (why) throw new Error(why)
  const dx = p.width + 10
  let plate = prism(k, dx, 0, p.width, p.depth, p.corner, 0, p.lid)
  if (p.lip > 0) {
    const iw = p.width - 2 * p.wall - 2 * p.clearance
    const id = p.depth - 2 * p.wall - 2 * p.clearance
    const r = Math.max(0, p.corner - p.wall - p.clearance)
    const t = Math.min(1.6, p.wall)
    let ring = k.cut(prism(k, dx, 0, iw, id, r, p.lid - 0.01, p.lid + p.lip), prism(k, dx, 0, iw - 2 * t, id - 2 * t, Math.max(0, r - t), p.lid, p.lid + p.lip + 1))
    if (p.screws) {
      // Notches in the lip where it would meet the bosses.
      ring = k.cutAll(ring, bossCentres(p).map(([x, y]) => k.translate(k.makeCylinder(BOSS + p.clearance, p.lip + 1), dx + x, y, p.lid)))
    }
    plate = k.fuse(plate, ring)
  }
  if (p.screws) plate = k.cutAll(plate, bossCentres(p).map(([x, y]) => k.translate(k.makeCylinder(PASS, p.lid + 0.02), dx + x, y, -0.01)))
  return plate
}
