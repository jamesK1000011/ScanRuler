// SPDX-License-Identifier: AGPL-3.0-only
// The fit.* commands as an agent runs them, through the registry, against a
// stand-in Reverse Engineer (import.step makes a body per part, where the
// part stands; body.set renames) and building with OCCT in Node in place of
// the worker. The coupon made, its bodies named and kept clear of names
// taken; a hook planned then made; the plan refused before one; the
// calibration from readings, from Print fit and from classes felt; the
// settings; inputs refused.
import { beforeAll, describe, expect, it } from 'vitest'
import { registerCommands, runCommand } from '../../../src/commands/registry'
import { registerStateSection } from '../../../src/commands/stateSections'
import type { Command } from '../../../src/plugins/api'
import { build, type FitsAnswer } from '../core/build'
import type { Kernel } from '../core/kernel'
import { fitsCommands, refreshAnswers } from '../app/fitsCommands'
import { setBuilder } from '../app/fitsClient'
import { useFits } from '../state/fitsStore'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

interface Body { id: number; name: string; bounds: { min: number[]; max: number[] } }
let bodies: Body[] = []
let nextId = 1
let last: FitsAnswer | null = null
let printFit: Json | undefined

const fake = (name: string, run: (i: Json) => unknown, readOnly = false): Command => ({ name, title: name, description: name, input: { type: 'object' }, readOnly, run: async (i) => run(i as Json) })

beforeAll(async () => {
  const k = (await (await import('occt-wasm')).OcctKernel.init()) as unknown as Kernel & { releaseAll(): void }
  setBuilder(async (ask) => {
    try {
      last = build(k, ask)
      return last
    } finally {
      k.releaseAll()
    }
  })
  registerCommands('fit', fitsCommands)
  registerCommands('reverse', [
    // The file's solids come in reversed and named as a STEP file names them.
    fake('import.step', () => {
      for (const p of [...(last?.parts ?? [])].reverse()) bodies.push({ id: nextId++, name: 'Solid', bounds: { min: p.box.min, max: p.box.max } })
      return {}
    }),
    fake('body.set', (i) => {
      if (bodies.some((b) => b.name.toLowerCase() === String(i.name).toLowerCase() && b.id !== i.body)) throw new Error('Name taken.')
      bodies.find((b) => b.id === i.body)!.name = i.name
      return {}
    }),
  ])
  registerStateSection('reverse', () => ({ bodies }))
  registerStateSection('fit', () => (printFit ? { last: printFit } : {}))
})

const run = (name: string, input: Json = {}) => runCommand(`fit.${name}`, input) as Promise<Json>
async function refused(name: string, input: Json, re: RegExp) {
  let m = ''
  await run(name, input).catch((e: Error) => (m = e.message))
  if (!re.test(m)) throw new Error(`fit.${name} answered "${m}", wanted ${re}`)
}
function fresh() {
  useFits.getState().reset()
  bodies = [{ id: 99, name: 'Fit test holes 8', bounds: { min: [0, 0, 0], max: [1, 1, 1] } }]
  last = null
  printFit = undefined
}

describe('fit.* commands', () => {
  it('fit.test makes the coupon: four bodies, each named after the part where it stands, clear of names taken', async () => {
    fresh()
    const r = await run('test', { clearances: [-0.1, 0, 0.2] })
    expect(r.rows.length).toBe(3)
    expect(r.bodies).toEqual(['Fit test holes 8 2', 'Fit test pegs 8', 'Gauge pin 8', 'Gauge ring 8'])
    // The gauge pin's body is the one standing where the pin was built.
    const pin = bodies.find((b) => b.name === 'Gauge pin 8')!
    const part = last!.parts.find((p) => p.name === 'Gauge pin 8')!
    expect(pin.bounds.min).toEqual(part.box.min)
    expect(useFits.getState().made?.part).toBe('coupon')
    expect(useFits.getState().busy).toBe(false)
  })
  it('fit.apply wants a plan; fit.snap plans one; fit.apply makes it', async () => {
    fresh()
    await refused('apply', {}, /Plan one first/)
    const s = await run('snap', { length: 18, material: 'petg' })
    expect(s.ok).toBe(true)
    expect(s.locks).toBe(true)
    expect(useFits.getState().planned?.part).toBe('snap')
    const r = await run('apply')
    expect(r.bodies).toEqual(['Snap hook 18×1.5×6', 'Snap catch'])
  })
  it('fit.apply takes a part and params of its own', async () => {
    fresh()
    const r = await run('apply', { part: 'hinge', params: { knuckles: 3 } })
    expect(r.bodies).toEqual(['Hinge leaf A', 'Hinge leaf B'])
    await refused('apply', { params: { knuckles: 3 } }, /give the part/)
    await refused('apply', { part: 'hinge', params: { knuckles: 3, pin: 5 } }, /wall/)
  })
  it('fit.file hands back the STEP', async () => {
    fresh()
    const r = await run('file', { part: 'pin', params: { nominal: 4 } })
    expect(r.file.name).toBe('pin and socket 4.step')
    expect(r.parts.length).toBe(2)
  })
  it('fit.calibrate from readings, then the plan is stale and fit.pair sizes with the new offsets', async () => {
    fresh()
    await run('snap', {})
    const c = await run('calibrate', { readings: [{ kind: 'hole', model: 8.2, measured: 7.9 }, { kind: 'shaft', model: 8, measured: 8.05 }] })
    expect(c.calibration).toMatchObject({ hole: 0.3, shaft: 0.05, source: 'measured' })
    expect(useFits.getState().planned?.stale).toBe(true)
    const p = await run('pair', { nominal: 8, class: 'close' })
    expect(p.model).toEqual({ hole: 8.3, shaft: 7.842 })
  })
  it('fit.calibrate from Print fit doubles its offsets, and says when there is no run', async () => {
    fresh()
    await refused('calibrate', { from: 'print-fit' }, /no run/)
    printFit = { run: 3, holeOffset: 0.08, contourOffset: 0.03, scaleXY: 1.004 }
    const c = await run('calibrate', { from: 'print-fit' })
    expect(c.calibration).toEqual({ hole: 0.16, shaft: 0.06, source: 'print-fit' })
    expect(c.note).toBeTruthy()
  })
  it('fit.calibrate { classes } at the coupon’s nominal; fit.list shows them; null forgets', async () => {
    fresh()
    await refused('calibrate', { classes: { slip: 0.1 } }, /at:/)
    await run('test', { nominal: 6, clearances: [0, 0.1] })
    await run('calibrate', { classes: { slip: 0.1, press: -0.05 } })
    expect(useFits.getState().settings.classes.slip).toEqual({ clearance: 0.1, at: 6 })
    const l = await run('list', { nominal: 6 })
    expect(l.classes.find((c: Json) => c.id === 'slip').clearance).toBe(0.1)
    await run('calibrate', { classes: { slip: null } })
    expect(useFits.getState().settings.classes.slip).toBe(undefined)
    await refused('calibrate', { classes: { snug: 0.1 }, at: 6 }, /no class/)
    await refused('calibrate', { hole: 0.1, at: 6 }, /classes only/)
    // An uncompensated coupon's labels are model clearances: less the offsets as printed.
    await run('test', { nominal: 6, clearances: [0, 0.3], compensate: false })
    const c = await run('calibrate', { classes: { slip: 0.3 } })
    expect(c.classes.slip).toEqual({ clearance: 0, at: 6 })
    expect(c.converted).toBeTruthy()
    await refused('calibrate', { hole: 0.1, reset: true }, /One of/)
  })
  it('fit.set changes the tolerance and material; fit.stack takes the tolerance as its default', async () => {
    fresh()
    await refused('set', {}, /Give a setting/)
    await refused('set', { reset: true, tolerance: 0.1 }, /on its own/)
    await run('set', { tolerance: 0.05, material: 'pla' })
    const s = await run('stack', { items: [{ nominal: 10 }, { nominal: 9.8, sign: -1 }] })
    expect(s.worst).toEqual({ min: 0.1, max: 0.3, spread: 0.1 })
    expect(s.verdict).toMatch(/holds/)
    await refused('stack', { items: [{ nominal: 1, tol: 0.1, plus: 0.2 }] }, /not both/)
  })
  it('the answers on show follow the calibration', async () => {
    fresh()
    await run('pair', { nominal: 8, class: 'close' })
    expect(useFits.getState().answers.pair?.model.hole).toBe(8.2)
    await run('calibrate', { hole: 0.4, shaft: 0.1 })
    refreshAnswers()
    expect(useFits.getState().answers.pair?.model.hole).toBe(8.4)
  })
  it('fit.pair refuses a class with a clearance, and neither', async () => {
    fresh()
    await refused('pair', { nominal: 5, class: 'slip', clearance: 0.1 }, /not both/)
    await refused('pair', { nominal: 5 }, /class or a clearance/)
  })
  it('red team: a material by its old name is taken and kept by its id; the list says where each strain comes from', async () => {
    await runCommand('fit.set', { material: 'tpu' })
    expect(useFits.getState().settings.material).toBe('tpu-95a')
    const p = (await runCommand('fit.pair', { nominal: 6, class: 'press', material: 'abs', wall: 2 })) as Json
    expect(p.strain.limit).toBe(0.016)
    const l = (await runCommand('fit.list', {})) as Json
    expect(l.materials.find((m: Json) => m.id === 'abs')).toMatchObject({ strain: 0.016, upright: 0.3, basis: 'printed' })
    await expect(runCommand('fit.set', { material: 'wood' })).rejects.toThrow()
    await runCommand('fit.set', { reset: true })
  })
})
