// SPDX-License-Identifier: AGPL-3.0-only
// Gridfinity bins and baseplates, to the open system's published
// dimensions (Zack Freedman's Gridfinity: 42 mm grid, 7 mm height units).
// Dimensions are the system's, written here from its specification; no
// other generator's code is used.
//
// Bin base, per cell, from the bottom: a 0.8 mm 45° chamfer, 1.8 mm
// straight, a 2.15 mm 45° chamfer — 4.75 mm, ending 41.5 mm square with
// 3.75 mm corners (half a millimetre short of the grid for clearance).
// Stacking lip, inward from the top edge: 0.7 mm at 45°, 1.8 mm straight,
// 1.9 mm at 45° — 4.4 mm tall, on a 45° support out from the wall. Baseplate pockets are the base's mirror,
// 42 mm square with 4 mm corners at the top. Magnets 6 × 2 mm (6.5 × 2.4
// pockets) and M3 screws at ±13 mm from each cell's centre.

import { P, prism, stepped, type GenKernel, type H } from './kernel'

export const GRID = 42
export const UNIT = 7
const CLEAR = 0.5
/** The magnet pocket (6.5 for a 6 mm magnet) and the M3 screw hole, radii. */
const MAGNET_R = 3.25
const SCREW_R = 1.5
const BASE_H = 4.75
const LIP_H = 4.4
const OUTER_R = 3.75
/** How far in from the outside the lip's foot comes: 0.7 + 1.9 mm. */
const LIP_IN = 2.6
/** The magnets: 6 × 2 mm discs, in 6.5 × 2.4 mm holes ±13 mm from each
 *  cell's centre. */
export const MAGNET = { size: '6x2', t: 2, hole: 2 * MAGNET_R, depth: 2.4, at: 13 } as const
/** A baseplate's floor under its pockets, with magnets: 0.6 mm under each. */
const BASE_FLOOR = 3

/** The magnets a bin or baseplate takes, as built (centred on the origin,
 *  on z = 0): each one's centre, resting on the bottom of its hole, the
 *  holes' top and their width (with the fit's holes). A bin's holes open onto the bed, so a magnet dropped in at
 *  the pause sits on the bed and is printed over; a baseplate's open into
 *  the pockets above. None without magnets. */
export function magnetsOf(kind: 'bin' | 'baseplate', p: { x: number; y: number; magnets: boolean; holes?: number }): { centres: [number, number, number][]; top: number; span: number } | null {
  if (!p.magnets) return null
  const bottom = kind === 'bin' ? 0 : BASE_FLOOR - MAGNET.depth
  const centres: [number, number, number][] = []
  for (let i = 0; i < p.x; i++)
    for (let j = 0; j < p.y; j++)
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) centres.push([(i - (p.x - 1) / 2) * GRID + sx * MAGNET.at, (j - (p.y - 1) / 2) * GRID + sy * MAGNET.at, bottom + MAGNET.t / 2])
  return { centres, top: bottom + MAGNET.depth, span: MAGNET.hole + (p.holes ?? 0) }
}

export interface BinParams {
  /** Cells across (X) and deep (Y). */
  x: number
  y: number
  /** Height in 7 mm units, base included, lip not. */
  units: number
  lip: boolean
  /** Magnet pockets under each cell (6 × 2 mm magnets). */
  magnets: boolean
  /** M3 screw holes under each cell. */
  screws: boolean
  /** Hollow: walls this thick (mm); 0 for a solid block to cut your own. */
  wall: number
  /** The floor's thickness over the base, mm. */
  floor: number
  /** Compartments across and deep, by dividing walls. */
  dividersX: number
  dividersY: number
  /** A label ledge along the back, mm deep (0: none). */
  label: number
  /** Added to the magnet and screw holes' diameters, mm: printed holes
   *  come out small. 0 suits the typical printer; the printer's fit
   *  calibration sets it when there is one. */
  holes: number
}

export const BIN_DEFAULTS: BinParams = { x: 1, y: 1, units: 3, lip: true, magnets: false, screws: false, wall: 1.2, floor: 1, dividersX: 0, dividersY: 0, label: 0, holes: 0 }

export interface BaseParams {
  x: number
  y: number
  /** Magnet pockets under each cell's corners, in a thicker plate. */
  magnets: boolean
  /** Added to the magnet holes' diameters, mm, as a bin's. */
  holes: number
}

export const BASE_DEFAULTS: BaseParams = { x: 3, y: 3, magnets: false, holes: 0 }

export function checkBin(p: BinParams): string | null {
  if (!(Number.isInteger(p.x) && p.x >= 1 && p.x <= 10 && Number.isInteger(p.y) && p.y >= 1 && p.y <= 10)) return 'x and y are whole cells, 1 to 10.'
  if (!(p.units >= 2 && p.units <= 30)) return 'units: 2 to 30, base included.'
  if (p.wall !== 0 && !(p.wall >= 0.8 && p.wall <= 5)) return 'wall: 0 (solid) or 0.8 to 5.'
  if (!(p.floor >= 0.4 && p.floor <= p.units * UNIT - BASE_H - 1)) return 'floor: 0.4 up to what the height leaves.'
  for (const k of ['dividersX', 'dividersY'] as const) if (!(Number.isInteger(p[k]) && p[k] >= 0 && p[k] <= 10)) return `${k}: 0 to 10 walls.`
  if (!(p.label >= 0 && p.label <= 20)) return 'label: 0 to 20.'
  return null
}

/** A bin, centred on the origin in X and Y, standing on z = 0. */
export function bin(k: GenKernel, p: BinParams): H {
  const why = checkBin(p)
  if (why) throw new Error(why)
  const W = p.x * GRID - CLEAR
  const D = p.y * GRID - CLEAR
  const H = p.units * UNIT
  const cell = GRID - CLEAR
  const centres: [number, number][] = []
  for (let i = 0; i < p.x; i++) for (let j = 0; j < p.y; j++) centres.push([(i - (p.x - 1) / 2) * GRID, (j - (p.y - 1) / 2) * GRID])
  // One foot per cell, stepped to the base profile.
  const feet = centres.map(([cx, cy]) =>
    stepped(k, cx, cy, cell, cell, [
      [0, 2.95, 0.8],
      [0.8, 2.15, 1.6],
      [2.6, 2.15, 1.6],
      [BASE_H, 0, OUTER_R],
    ]),
  )
  let body = k.fuseAll([...feet, prism(k, 0, 0, W, D, OUTER_R, BASE_H, H)])
  if (p.lip) {
    const ring = k.cut(
      prism(k, 0, 0, W, D, OUTER_R, H, H + LIP_H),
      stepped(k, 0, 0, W, D, [
        [H - 0.01, 2.6, Math.max(0.5, OUTER_R - 2.6)],
        [H + LIP_H - 0.7 - 1.8, 0.7, Math.max(0.5, OUTER_R - 0.7)],
        [H + LIP_H - 0.7, 0.7, Math.max(0.5, OUTER_R - 0.7)],
        [H + LIP_H + 0.01, 0, OUTER_R],
      ]),
    )
    body = k.fuse(body, ring)
  }
  if (p.wall > 0) {
    const floorZ = BASE_H + p.floor
    // Up to the lip's ledge (the lip shapes the opening above it), or out
    // through the top without one.
    const inR = Math.max(0.5, OUTER_R - p.wall)
    let inner: H
    if (p.lip && p.wall < LIP_IN) {
      // Under the lip, a 45° support from the wall in to the lip's foot, so
      // nothing overhangs flat; above it, up through the lip's opening.
      const z = Math.max(floorZ + 0.01, H - (LIP_IN - p.wall))
      const lipR = Math.max(0.5, OUTER_R - LIP_IN)
      inner = stepped(k, 0, 0, W, D, [
        [floorZ, p.wall, inR],
        [z, p.wall, inR],
        [H, LIP_IN, lipR],
        [H + 1, LIP_IN, lipR],
      ])
    } else inner = prism(k, 0, 0, W - 2 * p.wall, D - 2 * p.wall, inR, floorZ, p.lip ? H : H + 1)
    body = k.cut(body, inner)
    // Dividing walls, then the label ledge, built back into the hollow.
    const adds: H[] = []
    const iw = W - 2 * p.wall, id = D - 2 * p.wall
    for (let i = 1; i <= p.dividersX; i++) {
      const x = -iw / 2 + (iw * i) / (p.dividersX + 1)
      adds.push(prism(k, x, 0, p.wall, id, 0, floorZ - 0.01, H))
    }
    for (let j = 1; j <= p.dividersY; j++) {
      const y = -id / 2 + (id * j) / (p.dividersY + 1)
      adds.push(prism(k, 0, y, iw, p.wall, 0, floorZ - 0.01, H))
    }
    if (p.label > 0) {
      // A ledge along the back wall, its top 1 mm below the rim, a 45°
      // underside so it prints without support.
      const t = 1.2
      const top = H - 1
      const back = id / 2 + 0.01
      const y0 = back - p.label
      const pts: [number, number, number][] = [
        [-iw / 2, back, top],
        [-iw / 2, y0, top],
        [-iw / 2, y0, top - t],
        [-iw / 2, back, top - t - p.label],
      ]
      const wire = k.makeWire(pts.map((a, i) => k.makeLineEdge(P(a), P(pts[(i + 1) % pts.length]))))
      adds.push(k.extrude(k.makeFace(wire), iw, 0, 0))
    }
    if (adds.length) body = k.fuseAll([body, ...adds])
  }
  const holes: H[] = []
  for (const [cx, cy] of centres)
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        if (p.magnets) holes.push(k.translate(k.makeCylinder(MAGNET_R + (p.holes ?? 0) / 2, MAGNET.depth + 0.01), cx + sx * MAGNET.at, cy + sy * MAGNET.at, -0.01))
        if (p.screws) holes.push(k.translate(k.makeCylinder(SCREW_R + (p.holes ?? 0) / 2, 6.01), cx + sx * 13, cy + sy * 13, -0.01))
      }
  if (holes.length) body = k.cutAll(body, holes)
  return body
}

/** A baseplate, centred on the origin, standing on z = 0: a frame of
 *  pockets the bins' feet drop into, open beneath (or, with magnets, on a
 *  floor that holds them). */
export function baseplate(k: GenKernel, p: BaseParams): H {
  if (!(Number.isInteger(p.x) && p.x >= 1 && p.x <= 20 && Number.isInteger(p.y) && p.y >= 1 && p.y <= 20)) throw new Error('x and y are whole cells, 1 to 20.')
  // The plate is the grid itself; the bins carry the clearance.
  const W = p.x * GRID
  const D = p.y * GRID
  const T = 4.65
  // With magnets, a floor under the pockets holds them, 0.6 mm under each.
  const floor = p.magnets ? BASE_FLOOR : 0
  let plate = prism(k, 0, 0, W, D, 4, 0, T + floor)
  const pockets: H[] = []
  for (let i = 0; i < p.x; i++)
    for (let j = 0; j < p.y; j++) {
      const cx = (i - (p.x - 1) / 2) * GRID
      const cy = (j - (p.y - 1) / 2) * GRID
      pockets.push(
        stepped(k, cx, cy, GRID, GRID, [
          [floor - (p.magnets ? 0 : 0.01), 2.85, 1.15],
          [floor + 0.7, 2.15, 1.85],
          [floor + 2.5, 2.15, 1.85],
          [floor + T + 0.01, 0, 4],
        ]),
      )
      if (p.magnets) for (const sx of [-1, 1]) for (const sy of [-1, 1]) pockets.push(k.translate(k.makeCylinder(MAGNET_R + (p.holes ?? 0) / 2, MAGNET.depth + 0.01), cx + sx * MAGNET.at, cy + sy * MAGNET.at, floor - MAGNET.depth))
    }
  plate = k.cutAll(plate, pockets)
  return plate
}
