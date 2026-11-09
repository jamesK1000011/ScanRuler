// SPDX-License-Identifier: AGPL-3.0-only
// What each Fits part is to be, from what was asked and the printer as
// calibrated: the sizes to print and to model, the clearances, notes on
// how it will go — and the resolved sizes parts.ts builds from. Pure, so
// the commands, the panel and the tests share it.

import { classClearance, itTolerance, pair, type Calibration, type ClassOverride, type FitClass, type PairOut } from './fits'
import { couponPitch, hingeSegments, SEAT_GAP, type CouponGeo, type HingeGeo, type Layout, type PinGeo, type SnapGeo } from './parts'
import { materialOf, snap, type SnapIn, type SnapOut } from './snap'

export interface Settings {
  /** ± a printed size lands within. */
  tolerance: number
  /** The material parts are printed in, by id (snap.ts). */
  material: string
  /** Fit classes as a test print found them. */
  classes: Partial<Record<FitClass, ClassOverride>>
  /** The setup whose machine the fits are sized for, by id; Fits' own
   *  calibration when absent. */
  machine?: string
}

export interface Ctx {
  settings: Settings
  cal: Calibration
}

const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0
const need = (ok: boolean, m: string) => {
  if (!ok) throw new RangeError(m)
}

/** The printer's offsets, or none where the part is asked uncompensated. */
const offsets = (ctx: Ctx, compensate: boolean | undefined) => (compensate === false ? { hole: 0, shaft: 0 } : { hole: ctx.cal.hole, shaft: ctx.cal.shaft })

// ---- the test coupon ----------------------------------------------------------------------

export interface TestIn {
  nominal?: number
  clearances?: number[]
  compensate?: boolean
  thickness?: number
  pegHeight?: number
}

export const TEST_DEFAULTS = { nominal: 8, clearances: [-0.15, -0.1, -0.05, 0, 0.1, 0.2, 0.3, 0.4], thickness: 4, pegHeight: 8 }

export interface TestPlan {
  part: 'coupon'
  label: string
  geo: CouponGeo
  compensated: boolean
  rows: { label: number; hole: { printed: number; model: number }; peg: { printed: number; model: number } }[]
  gauges: { pin: { printed: number; model: number }; ring: { printed: number; model: number } }
  size: [number, number]
  notes: string[]
}

export function planTest(i: TestIn, ctx: Ctx): TestPlan {
  const D = i.nominal ?? TEST_DEFAULTS.nominal
  need(D >= 2 && D <= 30, 'nominal: 2 to 30.')
  const cs = [...new Set((i.clearances ?? TEST_DEFAULTS.clearances).map((c) => Math.round(c * 100) / 100))].sort((a, b) => a - b)
  need(cs.length >= 2 && cs.length <= 12, 'clearances: 2 to 12 different values (to the hundredth).')
  need(cs.every((c) => c >= -1 && c <= 2), 'clearances: each from −1 to 2.')
  need(D - cs[cs.length - 1] >= 1, `A clearance of ${cs[cs.length - 1]} leaves a peg under 1 across.`)
  const T = i.thickness ?? TEST_DEFAULTS.thickness
  const H = i.pegHeight ?? TEST_DEFAULTS.pegHeight
  need(T >= 2 && T <= 20, 'thickness: 2 to 20.')
  need(H >= 3 && H <= 30, 'pegHeight: 3 to 30.')
  const o = offsets(ctx, i.compensate)
  const rows = cs.map((c) => ({ label: c, hole: { printed: r3(D + c), model: r3(D + c + o.hole) }, peg: { printed: r3(D - c), model: r3(D - c - o.shaft) } }))
  const geo: CouponGeo = { nominal: D, holes: rows.map((r) => ({ clearance: r.label, d: r.hole.model })), pegs: rows.map((r) => ({ clearance: r.label, d: r.peg.model })), pin: r3(D - o.shaft), ring: r3(D + o.hole), thickness: T, pegHeight: H }
  need(geo.pegs.every((p) => p.d >= 0.8), 'A peg would model under 0.8 across: a larger nominal, or a smaller largest clearance.')
  const p = couponPitch(geo)
  need(cs.length * p <= 250, `The coupon would be ${r3(cs.length * p)} long: fewer clearances or a smaller nominal (up to 250).`)
  const notes = [
    'Try the gauge pin in each hole and the gauge ring over each peg. Note the clearance at which each fit class feels right, and give them to fit.calibrate { classes }.',
    'Or measure holes and pegs with calipers and give fit.calibrate { readings } their model and measured sizes.',
  ]
  if (i.compensate === false) notes.push('Modelled with no printer offsets: the sizes measured show what the printer does uncorrected.')
  return {
    part: 'coupon',
    label: `fit test ${D}`,
    geo,
    compensated: i.compensate !== false,
    rows,
    gauges: { pin: { printed: D, model: geo.pin }, ring: { printed: D, model: geo.ring } },
    size: [r3(cs.length * p), r3(Math.max(...geo.holes.map((h) => h.d), ...geo.pegs.map((q) => q.d)) + 10)],
    notes,
  }
}

// ---- a hole and a shaft ---------------------------------------------------------------------

export interface PairArgs {
  nominal: number
  cls?: FitClass
  clearance?: number
  basis?: 'hole' | 'shaft'
  bought?: 'hole' | 'shaft'
  wall?: number
}

export function planPair(a: PairArgs, ctx: Ctx): PairOut & { tolerance: number } {
  const m = materialOf(ctx.settings.material)
  const out = pair(a, ctx.cal, ctx.settings.tolerance, ctx.settings.classes, m?.strain)
  // The ± the sizes were held to: a milled part's grade at this size, a
  // cut's, else Fits' own.
  const tolerance = ctx.cal.grade !== undefined ? Math.round(itTolerance(a.nominal, ctx.cal.grade) * 1e4) / 1e4 : (ctx.cal.tolerance ?? ctx.settings.tolerance)
  return { ...out, tolerance }
}

// ---- the snap-fit hook ----------------------------------------------------------------------

export interface SnapArgs extends SnapIn {
  /** Window clearance each side, as printed. */
  clearance?: number
  /** Play under the ledge, assembled. */
  play?: number
  /** The catch's thickness. */
  plate?: number
  fillet?: number
  base?: number
  layout?: Layout
  compensate?: boolean
}

export const SNAP_DEFAULTS = { length: 15, thickness: 1.5, width: 6, undercut: 1, leadAngle: 30, retainAngle: 90, clearance: 0.2, play: 0.2, plate: 2 }

export interface SnapPlan {
  part: 'snap'
  label: string
  calc: SnapOut
  geo: SnapGeo
  /** How far the ledge stands over the catch, assembled. */
  engagement: number
  notes: string[]
}

export function planSnap(a: Partial<SnapArgs>, ctx: Ctx): SnapPlan {
  const s = { ...SNAP_DEFAULTS, material: ctx.settings.material, ...a }
  const calc = snap(s)
  const o = offsets(ctx, a.compensate)
  const window = r3(s.clearance + (o.hole + o.shaft) / 2)
  need(s.clearance >= 0 && s.clearance <= 2, 'clearance: 0 to 2.')
  need(s.play >= 0 && s.play <= 2, 'play: 0 to 2.')
  need(s.plate >= 0.8 && s.plate <= 10, 'plate: 0.8 to 10.')
  const fillet = a.fillet ?? r3(0.5 * s.thickness)
  const base = a.base ?? r3(Math.max(2, 1.5 * s.thickness))
  need(fillet >= 0 && fillet <= 2 * s.thickness, 'fillet: 0 to twice the thickness.')
  need(base >= 1 && base <= 20, 'base: 1 to 20.')
  const engagement = r3(s.undercut - window)
  need(engagement >= 0.2, `The window’s clearance (${window} modelled) leaves the ledge ${engagement} over the catch: take a deeper undercut or less clearance.`)
  need(s.length - s.play - s.plate >= fillet + 0.3, `The catch (${s.plate} thick, ${s.play} under the ledge) doesn’t fit above the root fillet on a ${s.length} beam: lengthen the beam or thin the catch.`)
  // The beam is an outer wall both sides: modelled thinner by the shaft
  // offset it prints at the thickness the strain was worked for.
  const beam = r3(s.thickness - o.shaft)
  need(beam >= 0.4, `The beam would be modelled ${beam} thick: thicker, or calibrate.`)
  const geo: SnapGeo = { name: `Snap hook ${s.length}×${s.thickness}×${s.width}`, length: s.length, thickness: beam, width: s.width, undercut: s.undercut, leadAngle: s.leadAngle, retainAngle: s.retainAngle, fillet, base, window, play: s.play, plate: s.plate, margin: 3, layout: a.layout ?? 'print' }
  const notes = [...calc.notes]
  if (fillet < 0.5 * s.thickness) notes.push('A root fillet under half the beam’s thickness concentrates the strain at the root: the formulas take it as spread.')
  return { part: 'snap', label: `snap hook ${s.length}×${s.thickness}×${s.width}`, calc, geo, engagement, notes }
}

// ---- the print-in-place hinge -----------------------------------------------------------------

export interface HingeArgs {
  length?: number
  knuckles?: number
  leaf?: number
  thickness?: number
  knuckle?: number
  pin?: number
  clearance?: number
  gap?: number
  compensate?: boolean
}

export const HINGE_DEFAULTS = { length: 30, knuckles: 5, leaf: 12, thickness: 2, knuckle: 6, pin: 3, clearance: 0.2, gap: 0.3 }

export interface HingePlan {
  part: 'hinge'
  label: string
  geo: HingeGeo
  segment: number
  /** As printed and as modelled. */
  radial: { printed: number; model: number }
  axial: { printed: number; model: number }
  wall: number
  bore: number
  leaves: { a: number; b: number }
  notes: string[]
}

export function planHinge(a: HingeArgs, ctx: Ctx): HingePlan {
  const h = { ...HINGE_DEFAULTS, ...a }
  need(Number.isInteger(h.knuckles) && h.knuckles >= 2 && h.knuckles <= 15, 'knuckles: 2 to 15.')
  need(h.length >= 8 && h.length <= 300, 'length: 8 to 300.')
  need(h.clearance >= 0.05 && h.clearance <= 1.5, 'clearance: 0.05 to 1.5.')
  need(h.gap >= 0.05 && h.gap <= 1.5, 'gap: 0.05 to 1.5.')
  need(h.pin >= 1.2, 'pin: at least 1.2.')
  need(h.thickness >= 0.8 && h.thickness <= h.knuckle, 'thickness: 0.8 up to the knuckle’s diameter.')
  const o = offsets(ctx, a.compensate)
  const radial = r3(h.clearance + (o.hole + o.shaft) / 2)
  const axial = r3(h.gap + o.shaft)
  const wall = r3(h.knuckle / 2 - h.pin / 2 - radial)
  need(wall >= 0.8, `The knuckle’s wall round the bore is ${wall} (under 0.8): a larger knuckle or a smaller pin.`)
  need(h.leaf >= h.knuckle / 2 + radial + 2, `leaf: at least ${r3(h.knuckle / 2 + radial + 2)} to stand clear of the other leaf’s knuckles.`)
  const geo: HingeGeo = { length: h.length, knuckles: h.knuckles, leaf: h.leaf, thickness: h.thickness, knuckle: h.knuckle, pin: h.pin, radial, axial }
  const seg = hingeSegments(geo)
  const segment = r3(seg[0][1] - seg[0][0])
  need(segment >= 2, `Knuckles ${segment} long: fewer knuckles or a longer hinge.`)
  const notes: string[] = ['Prints as it lies, both leaves on the bed. The bore is level: its top bridges, so a radial clearance under about 0.3 as printed may fuse there.']
  if (h.clearance < 0.15) notes.push('A radial clearance under 0.15 as printed fuses on most printers.')
  if (h.knuckles % 2 === 0) notes.push('An even number of knuckles: the leaves take as many each, and leaf B ends the hinge.')
  return { part: 'hinge', label: `hinge ${h.length} ×${h.knuckles}`, geo, segment, radial: { printed: h.clearance, model: radial }, axial: { printed: h.gap, model: axial }, wall, bore: r3(h.pin + 2 * radial), leaves: { a: Math.ceil(h.knuckles / 2), b: Math.floor(h.knuckles / 2) }, notes }
}

// ---- the pin and its socket ---------------------------------------------------------------

export interface PinArgs {
  nominal?: number
  cls?: FitClass
  clearance?: number
  length?: number
  depth?: number
  wall?: number
  floor?: number
  /** The pin is bought (a steel dowel): only the socket is made. */
  bought?: boolean
  layout?: Layout
}

export const PIN_DEFAULTS = { nominal: 5, cls: 'press' as FitClass, length: 12, depth: 6, wall: 2.5, floor: 1.5 }

export interface PinPlan {
  part: 'pin'
  label: string
  geo: PinGeo
  fit: PairOut & { tolerance: number }
  notes: string[]
}

export function planPin(a: PinArgs, ctx: Ctx): PinPlan {
  const p = { ...PIN_DEFAULTS, ...a }
  need(p.nominal >= 1.5 && p.nominal <= 30, 'nominal: 1.5 to 30.')
  need(p.depth >= 1 && p.depth <= 60, 'depth: 1 to 60.')
  need(p.wall >= 0.8 && p.wall <= 20, 'wall: 0.8 to 20.')
  need(p.floor >= 0.6 && p.floor <= 20, 'floor: 0.6 to 20.')
  const fit = planPair({ nominal: p.nominal, ...(a.clearance !== undefined ? { clearance: a.clearance } : { cls: p.cls }), ...(p.bought ? { bought: 'shaft' as const } : {}), wall: p.wall }, ctx)
  if (!p.bought) need(p.length > p.depth + SEAT_GAP && p.length <= 120, `length: more than the depth and its seat (${r3(p.depth + SEAT_GAP)}), up to 120.`)
  const geo: PinGeo = { nominal: p.nominal, pin: p.bought ? null : fit.model.shaft, hole: fit.model.hole, length: p.length, depth: p.depth, wall: p.wall, floor: p.floor, chamfer: r3(Math.min(0.5, p.nominal / 8)), layout: p.layout ?? 'print' }
  const notes = [...fit.notes]
  if (!p.bought) notes.push('Print the pin standing up: it comes out roundest that way.')
  return { part: 'pin', label: `${p.bought ? 'socket' : 'pin and socket'} ${p.nominal}`, geo, fit, notes }
}

/** A class's clearance at a size, with the overrides — for the panel. */
export const clearanceOf = (cls: FitClass, d: number, s: Settings) => r3(classClearance(cls, d, s.classes))
