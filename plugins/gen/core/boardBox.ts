// SPDX-License-Identifier: AGPL-3.0-only
// A box for a circuit board: the board held on standoffs under its
// mounting holes (with holes for heat-set inserts or for self-tapping
// screws), room above and below for its parts, openings in the walls where
// its connectors sit at the edge, and a lid that drops in on a lip. The box
// is built in the board's own frame — the board's bottom face at z = 0, as
// Electronics › KiCad brings a KiCad board in — so it stands round the
// board where it is; the lid is laid out beside it, top down, to print
// flat.
//
// The board comes as plain numbers (BoardSpec): its outline, thickness,
// holes, how far its parts reach, and the openings. Electronics › KiCad
// makes one from a KiCad board; any other source can too.

import { prism, type GenKernel, type H, type XYZ } from './kernel'

export type Side = '+x' | '-x' | '+y' | '-y'

export interface BoardOpening {
  /** The wall it goes through. */
  side: Side
  /** Where along that wall its middle is: x for a ±y wall, y for a ±x one, mm. */
  centre: number
  /** Its width along the wall, mm, before the margin. */
  width: number
  /** Its bottom and top, mm, in the board's frame (bottom face z = 0). */
  z0: number
  z1: number
  shape?: 'rect' | 'round'
  /** What it is for: "J1 USB-C receptacle". */
  label?: string
}

export interface BoardSpec {
  name?: string
  /** The outline, mm, x right and y up: the box goes round its extent. */
  outline: [number, number][]
  thickness: number
  /** How far the parts reach above the board's top face and below its bottom, mm. */
  above: number
  below: number
  /** Mounting holes: centre and diameter, mm. */
  holes: { x: number; y: number; d: number; ref?: string }[]
  openings: BoardOpening[]
}

export interface BoardBoxParams {
  wall: number
  floor: number
  lid: number
  lip: number
  clearance: number
  corner: number
  /** Between the board's edge and the wall, each side. */
  gap: number
  /** The board's bottom above the floor. */
  standoff: number
  /** Above the tallest part, to the lid. */
  headroom: number
  /** Heat-set insert holes in the standoffs; else pilots for self-tapping screws. */
  inserts: boolean
  /** Openings cut in the walls for the connectors. */
  cutouts: boolean
  /** Added round each opening, each side. */
  margin: number
  /** Added to the insert and pilot holes' diameters: printed holes come
   *  out small. 0 suits the typical printer; the fit calibration sets it. */
  holes: number
}

export const BOARD_BOX_DEFAULTS: BoardBoxParams = { wall: 2, floor: 2, lid: 2, lip: 3, clearance: 0.2, corner: 3, gap: 1, standoff: 5, headroom: 2, inserts: true, cutouts: true, margin: 0.5, holes: 0 }

/** The screws a mounting hole takes, with the pilot a thread-forming screw
 *  cuts into and the heat-set insert's hole, length and least wall —
 *  copied from the hardware plugin's table (plugins/hw/core/hardware.ts):
 *  typical figures for FDM prints, check your parts' sheets. */
export const SCREWS = [
  { size: 'M2', d: 2, pilot: 1.7, insert: { hole: 3.2, length: 3, wall: 1.3 } },
  { size: 'M2.5', d: 2.5, pilot: 2.1, insert: { hole: 4, length: 4, wall: 1.6 } },
  { size: 'M3', d: 3, pilot: 2.5, insert: { hole: 4, length: 5.7, wall: 1.6 } },
  { size: 'M4', d: 4, pilot: 3.4, insert: { hole: 5.6, length: 8.1, wall: 2.1 } },
] as const

/** The biggest screw that passes a hole of diameter d (0.1 mm to spare). */
export const screwFor = (d: number) => [...SCREWS].reverse().find((s) => s.d <= d - 0.1) ?? null

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const SIDES: Side[] = ['+x', '-x', '+y', '-y']

/** A board as given, checked: every number finite and in reason. Throws
 *  saying what is wrong. */
export function boardIn(u: unknown): BoardSpec {
  const o = u && typeof u === 'object' ? (u as Record<string, unknown>) : null
  if (!o) throw new Error('board: an object — outline, thickness, above, below, holes, openings.')
  const outline = Array.isArray(o.outline) ? o.outline : null
  // units-ok: the board's numbers are an API in mm, answered to the agent in mm.
  if (!outline || outline.length < 3 || outline.length > 20000 || !outline.every((p) => Array.isArray(p) && p.length === 2 && fin(p[0]) && fin(p[1]) && Math.abs(p[0]) < 1e4 && Math.abs(p[1]) < 1e4)) throw new Error('board.outline: 3 or more [x, y] points, mm.')
  const num = (k: string, lo: number, hi: number) => {
    const v = o[k]
    // units-ok: the board's numbers are an API in mm, answered to the agent in mm.
    if (!fin(v) || v < lo || v > hi) throw new Error(`board.${k}: a number, ${lo} to ${hi} mm.`)
    return v
  }
  const thickness = num('thickness', 0.1, 10)
  const above = num('above', 0, 200)
  const below = num('below', 0, 100)
  const holes = Array.isArray(o.holes) ? o.holes : o.holes === undefined ? [] : null
  if (!holes || holes.length > 64) throw new Error('board.holes: a list of up to 64 { x, y, d }.')
  const openings = Array.isArray(o.openings) ? o.openings : o.openings === undefined ? [] : null
  if (!openings || openings.length > 64) throw new Error('board.openings: a list of up to 64 { side, centre, width, z0, z1 }.')
  const spec: BoardSpec = {
    ...(typeof o.name === 'string' ? { name: o.name.slice(0, 60) } : {}),
    outline: outline.map((p) => [p[0], p[1]] as [number, number]),
    thickness,
    above,
    below,
    holes: holes.map((h, i) => {
      const x = h as Record<string, unknown>
      // units-ok: the board's numbers are an API in mm, answered to the agent in mm.
      if (!x || !fin(x.x) || !fin(x.y) || !fin(x.d) || x.d <= 0 || x.d > 20) throw new Error(`board.holes[${i}]: { x, y, d } in mm, d up to 20.`)
      return { x: x.x, y: x.y, d: x.d, ...(typeof x.ref === 'string' ? { ref: x.ref.slice(0, 20) } : {}) }
    }),
    openings: openings.map((h, i) => {
      const x = h as Record<string, unknown>
      // units-ok: the board's numbers are an API in mm, answered to the agent in mm.
      if (!x || !SIDES.includes(x.side as Side) || !fin(x.centre) || !fin(x.width) || !fin(x.z0) || !fin(x.z1) || x.width <= 0 || x.width > 300 || x.z1 <= x.z0 || x.z1 - x.z0 > 300) throw new Error(`board.openings[${i}]: { side (${SIDES.join(', ')}), centre, width, z0, z1 } in mm, z1 above z0.`)
      return { side: x.side as Side, centre: x.centre, width: x.width, z0: x.z0, z1: x.z1, ...(x.shape === 'round' ? { shape: 'round' as const } : {}), ...(typeof x.label === 'string' ? { label: x.label.slice(0, 60) } : {}) }
    }),
  }
  return spec
}

/** Where everything goes, worked out without the kernel: the box's sides
 *  and heights, each standoff and its hole, each opening. */
export function boardBoxPlan(p: BoardBoxParams, b: BoardSpec) {
  const xs = b.outline.map((q) => q[0])
  const ys = b.outline.map((q) => q[1])
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys)
  const cx = (bx0 + bx1) / 2
  const cy = (by0 + by1) / 2
  const inW = bx1 - bx0 + 2 * p.gap
  const inD = by1 - by0 + 2 * p.gap
  const W = inW + 2 * p.wall
  const D = inD + 2 * p.wall
  const bottom = -(p.standoff + p.floor)
  const top = b.thickness + b.above + Math.max(p.headroom, p.lip)
  const standoffs = b.holes.map((h) => {
    const s = screwFor(h.d)
    // units-ok: the board's numbers are an API in mm, answered to the agent in mm.
    if (!s) return { ...h, screw: null, note: `a ${h.d} mm hole is too small for an M2 screw: no standoff` }
    // The table's holes suit the typical printer; holes moves them to this one.
    const hole = Math.round(((p.inserts ? s.insert.hole : s.pilot) + (p.holes ?? 0)) * 1000) / 1000
    const outer = Math.max(p.inserts ? s.insert.hole + 2 * s.insert.wall : s.pilot + 3, s.d + 2.4)
    // Into the floor too where the standoff is short, never through it.
    const room = p.standoff + p.floor - 0.6
    const depth = p.inserts ? Math.min(room, s.insert.length + 0.5) : room
    // units-ok: the board's numbers are an API in mm, answered to the agent in mm.
    return { ...h, screw: s.size, hole, outer, depth, ...(p.inserts && depth < s.insert.length ? { note: `the ${s.size} insert is ${s.insert.length} mm long; only ${Math.round(depth * 10) / 10} mm of standoff and floor` } : {}) }
  })
  const openings = p.cutouts
    ? b.openings.map((o) => {
        const m = p.margin
        const round = o.shape === 'round'
        const d = Math.max(o.width, o.z1 - o.z0) + 2 * m
        return { ...o, w: round ? d : o.width + 2 * m, lo: round ? (o.z0 + o.z1) / 2 - d / 2 : o.z0 - m, hi: round ? (o.z0 + o.z1) / 2 + d / 2 : o.z1 + m, round }
      })
    : []
  // The inside corners no rounder than lets a square board corner in: a
  // corner of radius r reaches r(1 − 1/√2) in along the diagonal.
  const inR = Math.max(0, Math.min(p.corner - p.wall, p.gap / (1 - Math.SQRT1_2)))
  return { cx, cy, inW, inD, W, D, bottom, top, height: top - bottom, inR, standoffs, openings, board: { min: [bx0, by0], max: [bx1, by1] } }
}

/** Why these values and this board won't do, or null; without a board,
 *  the values alone. */
export function checkBoardBox(p: BoardBoxParams, b?: BoardSpec | null): string | null {
  const nums = [p.wall, p.floor, p.lid, p.lip, p.clearance, p.corner, p.gap, p.standoff, p.headroom, p.margin]
  if (!nums.every(fin)) return 'Every size is a number.'
  if (p.wall < 0.8 || p.wall > 10) return 'wall: 0.8 to 10.'
  if (p.floor < 0.6 || p.floor > 20) return 'floor: 0.6 to 20.'
  if (p.lid < 0.6 || p.lid > 10) return 'lid: 0.6 to 10.'
  if (p.lip < 0 || p.lip > 50) return 'lip: 0 to 50.'
  if (p.clearance < 0 || p.clearance > 1) return 'clearance: 0 to 1.'
  if (p.gap < 0 || p.gap > 20) return 'gap: 0 to 20.'
  if (p.standoff < 1 || p.standoff > 50) return 'standoff: 1 to 50.'
  if (p.headroom < 0 || p.headroom > 100) return 'headroom: 0 to 100.'
  if (p.margin < 0 || p.margin > 5) return 'margin: 0 to 5.'
  if (!fin(p.holes ?? 0) || (p.holes ?? 0) < -0.5 || (p.holes ?? 0) > 1) return 'holes: −0.5 to 1.'
  if (p.corner < 0 || p.corner > 50) return 'corner: 0 to 50.'
  if (!b) return null
  const k = boardBoxPlan(p, b)
  if (k.board.max[0] - k.board.min[0] < 3 || k.board.max[1] - k.board.min[1] < 3) return 'The board is too small to box.'
  if (k.W > 450 || k.D > 450) return 'The box would be over 450 across: a smaller gap or wall, or a smaller board.'
  if (k.height > 300) return 'The box would be over 300 tall: less standoff or headroom.'
  if (p.standoff < b.below + 0.5) return `standoff: too short for the parts under the board, which reach ${Math.round(b.below * 10) / 10} below it — ${Math.ceil((b.below + 0.5) * 10) / 10} or more.`
  if (p.corner > Math.min(k.W, k.D) / 2 - 1) return 'corner: too round for the box’s size.'
  if (p.lip > 0 && Math.min(k.inW, k.inD) - 2 * p.clearance - 2 * Math.min(1.6, p.wall) < 2) return 'Too small inside for the lid’s lip: set lip to 0.'
  for (const s of k.standoffs) {
    if (!('outer' in s) || s.outer === undefined) continue
    if (Math.abs(s.x - k.cx) > k.inW / 2 || Math.abs(s.y - k.cy) > k.inD / 2) return `The hole at (${s.x}, ${s.y}) lies outside the board’s box.`
  }
  return null
}

/** A disc in the plane of a wall, extruded through it: for a ±x wall in
 *  the yz plane, for a ±y wall in the xz plane. */
function roundThrough(k: GenKernel, side: Side, at: number, along: number, zc: number, r: number, len: number): H {
  const onX = side === '+x' || side === '-x'
  const P = (u: number, v: number): XYZ => (onX ? { x: at, y: along + u, z: zc + v } : { x: along + u, y: at, z: zc + v })
  const a = k.makeArcEdge(P(r, 0), P(0, r), P(-r, 0))
  const b = k.makeArcEdge(P(-r, 0), P(0, -r), P(r, 0))
  const face = k.makeFace(k.makeWire([a, b]))
  return onX ? k.extrude(face, len, 0, 0) : k.extrude(face, 0, len, 0)
}

/** The box, in the board's frame. */
export function boardBox(k: GenKernel, p: BoardBoxParams, b: BoardSpec): H {
  const why = checkBoardBox(p, b)
  if (why) throw new Error(why)
  const q = boardBoxPlan(p, b)
  let body = k.cut(prism(k, q.cx, q.cy, q.W, q.D, p.corner, q.bottom, q.top), prism(k, q.cx, q.cy, q.inW, q.inD, q.inR, q.bottom + p.floor, q.top + 1))
  const posts = q.standoffs.filter((s): s is typeof s & { outer: number; hole: number; depth: number } => 'outer' in s && s.outer !== undefined)
  if (posts.length) {
    // Up to the board's bottom, from just into the floor.
    body = k.fuseAll([body, ...posts.map((s) => k.translate(k.makeCylinder(s.outer / 2, p.standoff + 0.01), s.x, s.y, -p.standoff - 0.01))])
    body = k.cutAll(body, posts.map((s) => k.translate(k.makeCylinder(s.hole / 2, s.depth + 0.01), s.x, s.y, -s.depth)))
  }
  if (q.openings.length) {
    const tools = q.openings.map((o) => {
      // Through the wall from 1 mm inside it to 1 mm outside.
      const len = p.wall + 2
      const out = o.side === '+x' ? q.cx + q.W / 2 + 1 : o.side === '-x' ? q.cx - q.W / 2 - 1 : o.side === '+y' ? q.cy + q.D / 2 + 1 : q.cy - q.D / 2 - 1
      const from = o.side === '+x' || o.side === '+y' ? out - len : out
      if (o.round) return roundThrough(k, o.side, from, o.centre, (o.lo + o.hi) / 2, o.w / 2, len)
      const onX = o.side === '+x' || o.side === '-x'
      return onX ? prism(k, from + len / 2, o.centre, len, o.w, 0, o.lo, o.hi) : prism(k, o.centre, from + len / 2, o.w, len, 0, o.lo, o.hi)
    })
    body = k.cutAll(body, tools)
  }
  return body
}

/** The lid, beside the box (to +x), top down on the box's bottom plane. */
export function boardLid(k: GenKernel, p: BoardBoxParams, b: BoardSpec): H {
  const why = checkBoardBox(p, b)
  if (why) throw new Error(why)
  const q = boardBoxPlan(p, b)
  const x = q.cx + q.W + 10
  const z = q.bottom
  let plate = prism(k, x, q.cy, q.W, q.D, p.corner, z, z + p.lid)
  if (p.lip > 0) {
    const iw = q.inW - 2 * p.clearance
    const id = q.inD - 2 * p.clearance
    const r = Math.max(0, q.inR - p.clearance)
    const t = Math.min(1.6, p.wall)
    const ring = k.cut(prism(k, x, q.cy, iw, id, r, z + p.lid - 0.01, z + p.lid + p.lip), prism(k, x, q.cy, iw - 2 * t, id - 2 * t, Math.max(0, r - t), z + p.lid, z + p.lid + p.lip + 1))
    plate = k.fuse(plate, ring)
  }
  return plate
}
