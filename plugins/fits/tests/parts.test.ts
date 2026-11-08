// SPDX-License-Identifier: AGPL-3.0-only
// The Fits parts built with OCCT: their sizes, and the clearance between
// parts that mate measured by booleans — one cut by the other keeps its
// whole volume where they clear, loses the interference where they press —
// and by the least distance between them.
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_CALIBRATION } from '../core/fits'
import type { H, Kernel } from '../core/kernel'
import { buildCoupon, buildHinge, buildPin, buildSnap, catchPlace, couponPitch, SEAT_GAP } from '../core/parts'
import { planHinge, planPin, planSnap, planTest, type Ctx } from '../core/plans'
import { build } from '../core/build'

type K = Kernel & { distanceBetween(a: H, b: H): number; isValid(s: H): boolean; common(a: H, b: H): H }
let k: K
beforeAll(async () => {
  k = (await (await import('occt-wasm')).OcctKernel.init()) as unknown as K
})

const ctx: Ctx = { settings: { tolerance: 0.15, material: 'petg', classes: {} }, cal: DEFAULT_CALIBRATION }
const size = (s: H) => {
  const b = k.getBoundingBox(s)
  return [b.xmax - b.xmin, b.ymax - b.ymin, b.zmax - b.zmin].map((x) => Math.round(x * 1000) / 1000)
}
const near = (a: number, b: number, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(tol)
/** The volume of a lost to b: 0 where they don't overlap. */
const overlap = (a: H, b: H) => k.getVolume(a) - k.getVolume(k.cut(a, b))

describe('the test coupon', () => {
  it('four parts: holes, pegs, gauge pin and ring, each valid, laid side by side', () => {
    const plan = planTest({}, ctx)
    const parts = buildCoupon(k, plan.geo)
    expect(parts.map((p) => p.name)).toEqual(['Fit test holes 8', 'Fit test pegs 8', 'Gauge pin 8', 'Gauge ring 8'])
    for (const p of parts) expect(k.isValid(p.shape)).toBe(true)
    const p = couponPitch(plan.geo)
    expect(size(parts[0].shape)[0]).toBe(8 * p)
    expect(size(parts[0].shape)[2]).toBe(4)
    // The bar 2.5, the pegs 8 over it.
    expect(size(parts[1].shape)[2]).toBe(10.5)
    expect(size(parts[2].shape)).toEqual([7.9, 7.9, 10])
    for (let i = 1; i < parts.length; i++) expect(k.getBoundingBox(parts[i].shape).xmin).toBeGreaterThan(k.getBoundingBox(parts[i - 1].shape).xmax)
  })
  it('each hole takes a pin at the nominal by its label: clear above 0, pressed below', () => {
    const plan = planTest({ compensate: false, clearances: [-0.1, 0.1, 0.3] }, ctx)
    const [{ shape: holes }] = buildCoupon(k, plan.geo)
    const p = couponPitch(plan.geo)
    const widest = Math.max(...plan.geo.holes.map((h) => h.d), ...plan.geo.pegs.map((q) => q.d))
    // Hole i's centre: along X a pitch apart; across, the plate's bottom edge
    // moved to y = 0.
    const cy = widest / 2 + 6.5
    plan.rows.forEach((r, i) => {
      const pin = k.translate(k.makeCylinder(4, 4), p / 2 + i * p, cy, 0)
      const lost = overlap(pin, holes)
      if (r.label > 0) near(lost, 0, 1e-3)
      // The ring of interference: π/4·(8² − 7.9²)·4.
      else near(lost, (Math.PI / 4) * (64 - 7.9 ** 2) * 4, 0.05)
    })
  })
  it('engraves every label: the plate lighter than its holes alone make it', () => {
    const plan = planTest({ compensate: false }, ctx)
    const [{ shape: holes }] = buildCoupon(k, plan.geo)
    const [w, d, t] = size(holes)
    const bare = w * d * t - plan.geo.holes.reduce((s, h) => s + (Math.PI / 4) * h.d * h.d * t, 0)
    const engraved = bare - k.getVolume(holes)
    expect(engraved).toBeGreaterThan(8 * 1)
    expect(engraved).toBeLessThan(8 * 12)
  })
})

describe('the snap hook', () => {
  const plan = planSnap({ material: 'pla', layout: 'assembled' }, ctx)
  it('assembled, the hook clears its catch: no overlap, the least gap the window’s or the play', () => {
    const [hook, plate] = buildSnap(k, plan.geo)
    expect(k.isValid(hook.shape)).toBe(true)
    expect(k.isValid(plate.shape)).toBe(true)
    near(overlap(hook.shape, plate.shape), 0)
    near(k.distanceBetween(hook.shape, plate.shape), Math.min(plan.geo.window, plan.geo.play))
  })
  it('pulled back past the play, the ledge lands on the catch by the engagement', () => {
    const [hook, plate] = buildSnap(k, plan.geo)
    const back = k.translate(hook.shape, 0, 0, -(plan.geo.play + 0.1))
    // The ledge over the plate: engagement × width × 0.1 deep.
    near(overlap(back, plate.shape), plan.engagement * plan.geo.width * 0.1, 1e-3)
  })
  it('its sizes: the beam’s width across, the plate where catchPlace says', () => {
    const [hook, plate] = buildSnap(k, plan.geo)
    const g = plan.geo
    expect(size(hook.shape)[1]).toBe(g.width)
    const { z0, z1 } = catchPlace(g)
    const b = k.getBoundingBox(plate.shape)
    near(b.zmin, z0)
    near(b.zmax, z1)
    near(k.getBoundingBox(hook.shape).zmin, -g.base)
  })
  it('to print, the hook lies on its side, its width up', () => {
    const p = planSnap({ material: 'pla' }, ctx)
    const [hook, plate] = buildSnap(k, p.geo)
    expect(size(hook.shape)[2]).toBe(p.geo.width)
    expect(size(plate.shape)[2]).toBe(p.geo.plate)
    near(k.getBoundingBox(hook.shape).zmin, 0)
  })
})

describe('the hinge', () => {
  const plan = planHinge({}, ctx)
  it('two leaves that never touch: no overlap, the least gap the radial or axial clearance', () => {
    const [a, b] = buildHinge(k, plan.geo)
    expect(k.isValid(a.shape)).toBe(true)
    expect(k.isValid(b.shape)).toBe(true)
    near(overlap(a.shape, b.shape), 0)
    near(k.distanceBetween(a.shape, b.shape), Math.min(plan.geo.radial, plan.geo.axial))
  })
  it('its size: the length, both leaves, the knuckle’s height', () => {
    const [a, b] = buildHinge(k, plan.geo)
    const all = [k.getBoundingBox(a.shape), k.getBoundingBox(b.shape)]
    near(Math.min(...all.map((x) => x.xmin)), 0)
    near(Math.max(...all.map((x) => x.xmax)), 30)
    near(Math.min(...all.map((x) => x.ymin)), -12)
    near(Math.max(...all.map((x) => x.ymax)), 12)
    near(Math.max(...all.map((x) => x.zmax)), 6)
  })
  it('the pin is caught: leaf A moved across lands in leaf B', () => {
    const [a, b] = buildHinge(k, plan.geo)
    expect(overlap(k.translate(a.shape, 0, 0, plan.geo.radial + 0.2), b.shape)).toBeGreaterThan(0.1)
    expect(overlap(k.translate(a.shape, plan.geo.axial + 0.2, 0, 0), b.shape)).toBeGreaterThan(0.1)
  })
  it('leaf B swings about the pin clear of leaf A, to folded flat over it', () => {
    const [a, b] = buildHinge(k, plan.geo)
    for (const deg of [45, 90, 135, 180]) {
      const turned = k.rotate(b.shape, { point: { x: 0, y: 0, z: plan.geo.knuckle / 2 }, direction: { x: 1, y: 0, z: 0 } }, (deg * Math.PI) / 180)
      near(overlap(a.shape, turned), 0)
    }
  })
  it('an even count builds too', () => {
    const p = planHinge({ knuckles: 4 }, ctx)
    const [a, b] = buildHinge(k, p.geo)
    near(overlap(a.shape, b.shape), 0)
  })
})

describe('the pin and socket', () => {
  it('a slip pin seated clears its socket by half the clearance all round', () => {
    const plan = planPin({ cls: 'slip', layout: 'assembled' }, ctx)
    const [socket, pin] = buildPin(k, plan.geo)
    expect(k.isValid(socket.shape)).toBe(true)
    near(overlap(pin.shape, socket.shape), 0)
    near(k.distanceBetween(pin.shape, socket.shape), Math.min((plan.geo.hole - plan.geo.pin!) / 2, SEAT_GAP))
  })
  it('a press pin overlaps its socket by the interference, over the depth it goes in', () => {
    // Uncalibrated: the model is the print, the pin 0.2 over the hole.
    const plan = planPin({ clearance: -0.2, layout: 'assembled' }, { ...ctx, cal: { hole: 0, shaft: 0, source: 'entered' } })
    expect(plan.geo.pin! - plan.geo.hole).toBeCloseTo(0.2, 6)
    const [socket, pin] = buildPin(k, plan.geo)
    const annulus = (Math.PI / 4) * (plan.geo.pin! ** 2 - plan.geo.hole ** 2)
    const lost = overlap(pin.shape, socket.shape)
    // Less the chamfer at its foot and the lead-in at the mouth.
    expect(lost).toBeGreaterThan(annulus * (plan.geo.depth - SEAT_GAP - 1))
    expect(lost).toBeLessThan(annulus * (plan.geo.depth - SEAT_GAP))
  })
  it('a bought dowel: the socket alone', () => {
    const plan = planPin({ bought: true }, ctx)
    expect(buildPin(k, plan.geo).map((p) => p.name)).toEqual(['Socket 5'])
  })
  it('built as the worker builds it: STEP with every part', () => {
    const plan = planPin({}, ctx)
    const a = build(k, { part: 'pin', geo: plan.geo, out: 'step' })
    expect(a.parts.map((p) => p.name)).toEqual(['Socket 5', 'Pin 5'])
    expect(/^ISO-10303-21;/.test(a.step!)).toBe(true)
  })
})
