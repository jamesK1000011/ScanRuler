// SPDX-License-Identifier: AGPL-3.0-only
// The solids Fits makes, from sizes already resolved — every length here is
// the one to model, the printer's offsets added by plans.ts: the tolerance
// test coupon, the snap-fit hook and its catch, the print-in-place hinge,
// and the pin and its socket. Each is laid out to print, or assembled
// (the parts where they meet, for checking the clearances between them).

import { box, chamferedPin, clearanceLabel, coneZ, cylX, cylZ, GLYPH, labelCutters, P, profileXZ, type H, type Kernel } from './kernel'

export type Layout = 'print' | 'assembled'

export interface CouponGeo {
  nominal: number
  /** Each hole and peg: its label's clearance and its model diameter. */
  holes: { clearance: number; d: number }[]
  pegs: { clearance: number; d: number }[]
  /** The gauge pin's and the gauge ring's model diameters. */
  pin: number
  ring: number
  thickness: number
  pegHeight: number
}

export interface SnapGeo {
  /** The hook's body's name. */
  name: string
  length: number
  thickness: number
  width: number
  undercut: number
  leadAngle: number
  retainAngle: number
  /** Root fillet radius. */
  fillet: number
  /** Height of the block the beam stands on. */
  base: number
  /** The catch: its window's clearance each side, the play under the
   *  ledge, its thickness and its margin round the window. */
  window: number
  play: number
  plate: number
  margin: number
  layout: Layout
}

export interface HingeGeo {
  length: number
  knuckles: number
  leaf: number
  thickness: number
  knuckle: number
  pin: number
  /** Model clearances: radial round the pin and the knuckles, axial
   *  between knuckles. */
  radial: number
  axial: number
}

export interface PinGeo {
  nominal: number
  /** Model diameters; pin null for a bought one (socket only). */
  pin: number | null
  hole: number
  length: number
  depth: number
  wall: number
  floor: number
  chamfer: number
  layout: Layout
}

export interface Built {
  name: string
  shape: H
}

const fmt = (x: number) => String(Math.round(x * 100) / 100)

/** Laid out to print: each on the bed (z from 0), in a row along X, 5 apart. */
export function arrange(k: Kernel, parts: Built[], gap = 5): Built[] {
  let x = 0
  return parts.map((p) => {
    const b = k.getBoundingBox(p.shape)
    const shape = k.translate(p.shape, x - b.xmin, -b.ymin, -b.zmin)
    x += b.xmax - b.xmin + gap
    return { name: p.name, shape }
  })
}

// ---- the tolerance test coupon -----------------------------------------------------------

/** Centre to centre, holes and pegs: room for a label and the wall
 *  between. */
export const couponPitch = (g: Pick<CouponGeo, 'holes' | 'pegs' | 'nominal'>) => {
  const widest = Math.max(...g.holes.map((h) => h.d), ...g.pegs.map((p) => p.d))
  return Math.max(widest + 4, 10)
}

export function buildCoupon(k: Kernel, g: CouponGeo): Built[] {
  const p = couponPitch(g)
  const n = g.holes.length
  const W = n * p
  const widest = Math.max(...g.holes.map((h) => h.d), ...g.pegs.map((q) => q.d))
  const top = widest / 2 + 2.5
  const labelY = -(widest / 2 + 1.5 + GLYPH.h / 2)
  const bottom = labelY - GLYPH.h / 2 - 2
  const engrave = 0.6
  const T = g.thickness
  // Holes through a plate, each labelled with its clearance below it.
  const plate = box(k, 0, bottom, 0, W, top, T)
  const cutters: H[] = []
  g.holes.forEach((h, i) => {
    const x = p / 2 + i * p
    cutters.push(cylZ(k, h.d / 2, x, 0, -1, T + 1))
    cutters.push(...labelCutters(k, clearanceLabel(h.clearance), x, labelY, T - engrave, T + 1))
  })
  const holes = k.cutAll(plate, cutters)
  // Pegs on a bar, labelled the same way.
  const bar = 2.5
  const pegsBase = box(k, 0, bottom, 0, W, top, bar)
  const pegLabels: H[] = []
  const pegs: H[] = [pegsBase]
  g.pegs.forEach((q, i) => {
    const x = p / 2 + i * p
    pegs.push(chamferedPinTop(k, q.d / 2, x, 0, bar - 0.01, bar + g.pegHeight, Math.min(0.4, q.d / 8)))
    pegLabels.push(...labelCutters(k, clearanceLabel(q.clearance), x, labelY, bar - engrave, bar + 1))
  })
  const pegBar = k.cutAll(k.fuseAll(pegs), pegLabels)
  // The gauges: a pin at the nominal for the holes, a ring at the nominal
  // for the pegs.
  const pin = chamferedPin(k, g.pin / 2, 0, 0, 0, T + 6, Math.min(0.4, g.pin / 8))
  const ringOuter = g.nominal / 2 + 2.5
  const ring = k.cut(cylZ(k, ringOuter, 0, 0, 0, 4), cylZ(k, g.ring / 2, 0, 0, -1, 5))
  const D = fmt(g.nominal)
  return arrange(k, [
    { name: `Fit test holes ${D}`, shape: holes },
    { name: `Fit test pegs ${D}`, shape: pegBar },
    { name: `Gauge pin ${D}`, shape: pin },
    { name: `Gauge ring ${D}`, shape: ring },
  ])
}

/** A peg with only its top chamfered: its foot runs into the bar. */
function chamferedPinTop(k: Kernel, r: number, x: number, y: number, z0: number, z1: number, ch: number): H {
  return k.fuse(cylZ(k, r, x, y, z0, z1 - ch), coneZ(k, r, r - ch, x, y, z1 - ch, z1))
}

// ---- the snap-fit hook and its catch -----------------------------------------------------

/** Where the catch plate stands, assembled: under the hook's ledge by the
 *  play, its window round the beam. */
export function catchPlace(g: SnapGeo) {
  const top = g.length - g.play
  return { z0: top - g.plate, z1: top }
}

export function buildSnap(k: Kernel, g: SnapGeo): Built[] {
  const { length: L, thickness: t, width: b, undercut: y, fillet: r, base: hb, window: cw, margin: m } = g
  const rad = (d: number) => (d * Math.PI) / 180
  const riseRet = g.retainAngle >= 90 ? 0 : y / Math.tan(rad(g.retainAngle))
  const land = Math.min(0.5, 0.3 * y)
  const zLand = L + riseRet + land
  const zTop = zLand + y / Math.tan(rad(g.leadAngle))
  const xl = -(y + cw + m)
  const xr = t + y + cw + m
  const c45 = Math.SQRT1_2
  // The beam and its hook drawn on XZ, the block it stands on under it,
  // a fillet each side of the root; drawn out along Y by its width.
  const pts: number[][] = [
    [xl, -hb],
    [xr, -hb],
    [xr, 0],
    ...(r > 0 ? [[t + r, 0], [t, r, t + r - r * c45, r - r * c45]] : [[t, 0]]),
    [t, L],
    [t + y, L + riseRet],
    [t + y, zLand],
    [t, zTop],
    [0, zTop],
    ...(r > 0 ? [[0, r], [-r, 0, -r + r * c45, r - r * c45]] : [[0, 0]]),
    [xl, 0],
  ]
  const hook = k.extrude(profileXZ(k, pts), 0, b, 0)
  // The catch: a plate with a window the head passes through, its top
  // under the ledge.
  const { z0, z1 } = catchPlace(g)
  const plate = k.cut(box(k, xl, -m, z0, xr, b + m, z1), box(k, -y - cw, -cw, z0 - 1, t + cw, b + cw, z1 + 1))
  const name = g.name
  if (g.layout === 'assembled') return [{ name, shape: hook }, { name: 'Snap catch', shape: plate }]
  // To print, the hook lies on its side — its width up, so the beam bends
  // in the plane of its layers — and the catch lies flat.
  const lying = k.rotate(hook, { point: P(0, 0, 0), direction: P(1, 0, 0) }, Math.PI / 2)
  return arrange(k, [{ name, shape: lying }, { name: 'Snap catch', shape: plate }])
}

// ---- the print-in-place hinge ------------------------------------------------------------

export function hingeSegments(g: Pick<HingeGeo, 'length' | 'knuckles' | 'axial'>): [number, number][] {
  const s = (g.length - (g.knuckles - 1) * g.axial) / g.knuckles
  return Array.from({ length: g.knuckles }, (_, i) => [i * (s + g.axial), i * (s + g.axial) + s] as [number, number])
}

/**
 * Two leaves lying flat, joined at a line of knuckles along X. Leaf A's
 * knuckles carry a pin the whole length; leaf B's are bored over it with
 * the radial clearance. Each leaf is cut clear of the other's knuckles by
 * the radial clearance, and the axial one past their ends.
 */
export function buildHinge(k: Kernel, g: HingeGeo): Built[] {
  const Ro = g.knuckle / 2
  const zc = Ro
  const seg = hingeSegments(g)
  const own = (leaf: 0 | 1) => seg.filter((_, i) => i % 2 === leaf)
  const knuckles = (leaf: 0 | 1) => own(leaf).map(([a, b]) => cylX(k, Ro, a, b, 0, zc))
  const envelope = (leaf: 0 | 1) => own(leaf).map(([a, b]) => cylX(k, Ro + g.radial, a - g.axial, b + g.axial, 0, zc))
  const plateA = box(k, 0, -g.leaf, 0, g.length, 0, g.thickness)
  const plateB = box(k, 0, 0, 0, g.length, g.leaf, g.thickness)
  const A0 = k.cutAll(k.fuseAll([plateA, ...knuckles(0)]), envelope(1))
  const A = k.fuse(A0, cylX(k, g.pin / 2, 0, g.length, 0, zc))
  const B = k.cutAll(k.fuseAll([plateB, ...knuckles(1)]), [...envelope(0), cylX(k, g.pin / 2 + g.radial, -1, g.length + 1, 0, zc)])
  return [
    { name: 'Hinge leaf A', shape: A },
    { name: 'Hinge leaf B', shape: B },
  ]
}

// ---- the pin and its socket ----------------------------------------------------------------

/** How far the pin stands off the socket's floor, assembled: the fit is on
 *  the diameter only. */
export const SEAT_GAP = 0.2

export function buildPin(k: Kernel, g: PinGeo): Built[] {
  const rh = g.hole / 2
  const half = rh + g.wall
  const top = g.floor + g.depth
  const lead = Math.min(0.4, g.wall / 2)
  const socket = k.cutAll(box(k, -half, -half, 0, half, half, top), [cylZ(k, rh, 0, 0, g.floor, top + 1), coneZ(k, rh, rh + lead, 0, 0, top - lead, top + 1e-3)])
  const D = fmt(g.nominal)
  const parts: Built[] = [{ name: `Socket ${D}`, shape: socket }]
  if (g.pin !== null) {
    const z0 = g.layout === 'assembled' ? g.floor + SEAT_GAP : 0
    parts.push({ name: `Pin ${D}`, shape: chamferedPin(k, g.pin / 2, 0, 0, z0, z0 + g.length, g.chamfer) })
  }
  return g.layout === 'assembled' ? parts : arrange(k, parts)
}

// ---- by id -----------------------------------------------------------------------------------

export const PART_IDS = ['coupon', 'snap', 'hinge', 'pin'] as const
export type PartId = (typeof PART_IDS)[number]
export type Geo = { part: 'coupon'; geo: CouponGeo } | { part: 'snap'; geo: SnapGeo } | { part: 'hinge'; geo: HingeGeo } | { part: 'pin'; geo: PinGeo }

export function buildPart(k: Kernel, a: Geo): Built[] {
  switch (a.part) {
    case 'coupon':
      return buildCoupon(k, a.geo)
    case 'snap':
      return buildSnap(k, a.geo)
    case 'hinge':
      return buildHinge(k, a.geo)
    case 'pin':
      return buildPin(k, a.geo)
  }
}
