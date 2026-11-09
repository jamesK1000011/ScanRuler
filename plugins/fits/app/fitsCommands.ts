// SPDX-License-Identifier: AGPL-3.0-only
// The Fits workspace's commands — fit.*, beside Print fit's (fit-comp: a
// scanned print measured against its CAD) under the same name. The fit
// classes, materials and parts; the printer's tolerance and material; its
// calibration (measured sizes, what was felt on a test print, or Print
// fit's last run); a hole and shaft pair; a tolerance stack; a snap-fit
// hook, a print-in-place hinge, a pin and socket, each planned without
// changing anything and made in Reverse Engineer by fit.apply; the test
// coupon made there at once; any of them as a file.

import { bodiesBox } from '../../_shared/bodiesBox'
import { POOR_FIT, printerFitOf } from '../../_shared/printerFit'
import { machineTolerance, setupsOf } from '../../_shared/setups'
import type { Box3 } from '../../_shared/clear'
import { runWithin } from '../../../src/commands/registry'
import { anyObject, arr, bool, enumOf, int, num, obj, str, type JsonSchema } from '../../../src/commands/schema'
import { readStateSections } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import type { FitsPart } from '../core/build'
import { CLASS_DEFS, CLASSES, DEFAULT_CALIBRATION, fromPrintFit, fromReadings, itGrade, stack, type Calibration, type ClassOverride, type FitClass, type Reading, type StackItem } from '../core/fits'
import { PART_IDS, type Geo, type PartId } from '../core/parts'
import { clearanceOf, HINGE_DEFAULTS, PIN_DEFAULTS, planHinge, planPair, planPin, planSnap, planTest, SNAP_DEFAULTS, TEST_DEFAULTS, type Ctx, type HingeArgs, type PairArgs, type PinArgs, type SnapArgs, type TestIn } from '../core/plans'
import { MATERIAL_NAMES, MATERIALS, materialOf } from '../core/snap'
import { DEFAULT_SETTINGS, TOOLS, useFits, type Planned, type Tool } from '../state/fitsStore'
import { build, stopBuild } from './fitsClient'

type Json = Record<string, unknown>

const st = () => useFits.getState()
const ctx = (): Ctx => ({ settings: st().settings, cal: calibrationNow() })

/** The calibration fits are sized with: the tolerance of the machine of
 *  the setup chosen (fit.set { setup }) — a print setup's printer
 *  calibration — else Fits' own. A setup of a kind Fits has no sizing for
 *  yet (a cut's kerf, a milled part's IT grade) is refused, not guessed:
 *  that sizing plugs in here, from the setup type's tolerance. */
function calibrationNow(): Calibration {
  const id = st().settings.machine
  if (!id) return st().calibration
  if (!setupsOf().some((x) => x.id === id)) throw new CommandError('invalid_state', `There is no setup ${id} to size the fits for now: fit.set { setup: null } sizes them with Fits’ calibration, or choose another.`)
  const t = machineTolerance({ setup: id })
  if (!t) throw new CommandError('unavailable', `Setup ${id} gives no tolerance to size fits with (its kind is not in this build, or has none): fit.set { setup: null } sizes them with Fits’ calibration.`)
  if (t.kind !== 'print') throw new CommandError('unavailable', `Fits sizes for a printer so far: setup ${id}’s ${t.kind === 'kerf' ? 'kerf' : 'IT grade'} is not taken yet.`)
  if (!t.fit) return st().calibration
  return { hole: t.fit.hole, shaft: t.fit.shaft, source: t.fit.source, ...(t.fit.at ? { at: t.fit.at } : {}), ...(t.fit.profile ? { profile: t.fit.profile } : {}) }
}

/** What the fits are sized for, in the readout. */
function sizedFor(): string {
  const id = st().settings.machine
  if (!id) return 'Fits’ calibration'
  const s = setupsOf().find((x) => x.id === id)
  try {
    const cal = calibrationNow()
    return `${s ? `${s.name} (${s.id})` : id}: ${printerFitOf(cal)?.label ?? 'the typical printer'}`
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0
const invalid = (m: string): never => {
  throw new CommandError('invalid_input', m)
}
/** A plan's own refusal, as the caller's mistake. */
function checked<T>(f: () => T): T {
  try {
    return f()
  } catch (e) {
    if (e instanceof RangeError) invalid(e.message)
    throw e
  }
}
const today = () => new Date().toISOString().slice(0, 10)
const remember = (tool: Tool, input: object) => useFits.setState((s) => ({ inputs: { ...s.inputs, [tool]: JSON.parse(JSON.stringify(input)) as Json } }))

// ---- the readout ------------------------------------------------------------------------

export function describeFits() {
  const s = st()
  return {
    settings: s.settings,
    calibration: s.calibration,
    sizedFor: sizedFor(),
    // The same calibration in the convention Hardware, Generate and Boards
    // read (hole: added to a hole's diameter); null on the defaults.
    printerFit: printerFitOf(s.calibration),
    tool: s.tool,
    ...(s.planned ? { planned: { part: s.planned.part, label: s.planned.label, input: s.planned.input, ...(s.planned.stale ? { stale: 'the settings or calibration changed since: fit.apply plans it again with them' } : {}) } } : {}),
    ...(s.made ? { made: { part: s.made.part, label: s.made.label, bodies: s.made.bodies } } : {}),
  }
}

// ---- input --------------------------------------------------------------------------------

const len = (d: string, extra: Json = {}) => num(`${d}, mm.`, extra)
const classIn = enumOf(CLASSES, 'free (turns freely), slip (slides by hand), close (locates, no rattle), press (pushed in, holds), tight_press (pressed in, stays).')
const compensateIn = bool('Add the printer’s calibrated offsets to the modelled sizes (default true).')
const layoutIn = enumOf(['print', 'assembled'], 'print: laid out on the bed (default); assembled: the parts where they meet, to check clearances in Reverse Engineer.')

const pairFields: Record<string, JsonSchema> = {
  nominal: len('The size the two meet at', { minimum: 0.5, maximum: 500 }),
  class: classIn,
  clearance: len('Diametral clearance as printed, in place of a class; negative for interference', { minimum: -2, maximum: 5 }),
  basis: enumOf(['hole', 'shaft'], 'Which keeps the nominal: hole (the default; the shaft is made to fit) or shaft.'),
  bought: enumOf(['hole', 'shaft'], 'One side is bought, not printed (a steel dowel, a bearing): it keeps the nominal and gets no printer offset.'),
  wall: len('The hub’s wall round the hole, for a press', { exclusiveMinimum: 0 }),
  material: enumOf(MATERIAL_NAMES, 'For a press’s strain limit; the setting’s by default.'),
}

const snapFields: Record<string, JsonSchema> = {
  length: len(`Beam, root to the hook’s retaining face (${SNAP_DEFAULTS.length})`, { exclusiveMinimum: 0, maximum: 200 }),
  thickness: len(`Beam, in the way it bends (${SNAP_DEFAULTS.thickness})`, { exclusiveMinimum: 0, maximum: 20 }),
  width: len(`Beam width (${SNAP_DEFAULTS.width})`, { exclusiveMinimum: 0, maximum: 100 }),
  undercut: len(`The hook’s overhang: how far the beam deflects (${SNAP_DEFAULTS.undercut})`, { exclusiveMinimum: 0, maximum: 20 }),
  leadAngle: num('Lead-in face to the way it goes in, degrees (30).', { exclusiveMinimum: 0, maximum: 89 }),
  retainAngle: num('Retaining face to the way it comes out, degrees; 90 square, locks (90).', { exclusiveMinimum: 0, maximum: 90 }),
  material: enumOf(MATERIAL_NAMES, 'The setting’s by default.'),
  modulus: num('Secant modulus, MPa, in place of the material’s.', { exclusiveMinimum: 0, maximum: 20000 }),
  strain: num('Permissible strain (0.02 for 2 %), in place of the material’s.', { exclusiveMinimum: 0, maximum: 0.5 }),
  friction: num('Friction coefficient, in place of the material’s.', { minimum: 0, maximum: 2 }),
  uses: enumOf(['once', 'repeated'], 'repeated allows 60 % of the strain (default once).'),
  printed: enumOf(['flat', 'upright'], 'upright (bending across layers) allows the material’s share of the strain, 30–50 % (default flat).'),
  clearance: len('The catch window’s clearance each side, as printed (0.2)', { minimum: 0, maximum: 2 }),
  play: len('Play under the ledge, assembled (0.2)', { minimum: 0, maximum: 2 }),
  plate: len('The catch’s thickness (2)', { minimum: 0.8, maximum: 10 }),
  fillet: len('Root fillet radius (half the thickness)', { minimum: 0 }),
  base: len('Block the beam stands on', { minimum: 1, maximum: 20 }),
  layout: layoutIn,
  compensate: compensateIn,
}

const hingeFields: Record<string, JsonSchema> = {
  length: len(`Along the pin (${HINGE_DEFAULTS.length})`, { minimum: 8, maximum: 300 }),
  knuckles: int(`How many, both leaves together (${HINGE_DEFAULTS.knuckles})`, { minimum: 2, maximum: 15 }),
  leaf: len(`Each leaf, from the pin (${HINGE_DEFAULTS.leaf})`, { exclusiveMinimum: 0, maximum: 300 }),
  thickness: len(`Leaf (${HINGE_DEFAULTS.thickness})`, { minimum: 0.8, maximum: 30 }),
  knuckle: len(`Knuckle diameter (${HINGE_DEFAULTS.knuckle})`, { exclusiveMinimum: 0, maximum: 60 }),
  pin: len(`Pin diameter (${HINGE_DEFAULTS.pin})`, { minimum: 1.2, maximum: 50 }),
  clearance: len(`Radial, round the pin and knuckles, as printed (${HINGE_DEFAULTS.clearance})`, { minimum: 0.05, maximum: 1.5 }),
  gap: len(`Axial, between knuckles, as printed (${HINGE_DEFAULTS.gap})`, { minimum: 0.05, maximum: 1.5 }),
  compensate: compensateIn,
}

const pinFields: Record<string, JsonSchema> = {
  nominal: len(`Pin diameter (${PIN_DEFAULTS.nominal})`, { minimum: 1.5, maximum: 30 }),
  class: classIn,
  clearance: len('Diametral clearance as printed, in place of a class', { minimum: -2, maximum: 5 }),
  length: len(`The pin (${PIN_DEFAULTS.length})`, { exclusiveMinimum: 0, maximum: 120 }),
  depth: len(`The socket (${PIN_DEFAULTS.depth})`, { minimum: 1, maximum: 60 }),
  wall: len(`Round the socket (${PIN_DEFAULTS.wall})`, { minimum: 0.8, maximum: 20 }),
  floor: len(`Under the socket (${PIN_DEFAULTS.floor})`, { minimum: 0.6, maximum: 20 }),
  bought: bool('A bought pin (a steel dowel at the nominal): the socket alone, sized for it.'),
  layout: layoutIn,
}

const testFields: Record<string, JsonSchema> = {
  nominal: len(`The size tested (${TEST_DEFAULTS.nominal})`, { minimum: 2, maximum: 30 }),
  clearances: arr(num('', { minimum: -1, maximum: 2 }), `Diametral clearances to print, as printed, mm; negative for interference (${TEST_DEFAULTS.clearances.join(', ')}).`, { minItems: 2, maxItems: 12 }),
  thickness: len(`The hole plate (${TEST_DEFAULTS.thickness})`, { minimum: 2, maximum: 20 }),
  pegHeight: len(`The pegs (${TEST_DEFAULTS.pegHeight})`, { minimum: 3, maximum: 30 }),
  compensate: bool('Add the calibrated offsets (default true); false shows what the printer does uncorrected — measure that and give it to fit.calibrate.'),
}

// ---- the plans ----------------------------------------------------------------------------

/** A class given as `class` in a command, `cls` in the core. */
function pairArgs(a: Json): PairArgs {
  const { class: cls, ...rest } = a as Json & { class?: FitClass }
  if (cls !== undefined && rest.clearance !== undefined) invalid('Give a class or a clearance, not both.')
  if (cls === undefined && rest.clearance === undefined) invalid('Give a class or a clearance.')
  return { ...(rest as unknown as PairArgs), ...(cls ? { cls } : {}) }
}

function planOf(part: PartId, input: Json) {
  return checked(() => {
    switch (part) {
      case 'coupon':
        return planTest(input as TestIn, ctx())
      case 'snap':
        return planSnap(input as Partial<SnapArgs>, ctx())
      case 'hinge':
        return planHinge(input as HingeArgs, ctx())
      case 'pin': {
        const { class: cls, ...rest } = input as Json & { class?: FitClass }
        if (cls !== undefined && rest.clearance !== undefined) invalid('Give a class or a clearance, not both.')
        return planPin({ ...(rest as PinArgs), ...(cls ? { cls } : {}) }, ctx())
      }
    }
  })
}

const geoOf = (plan: ReturnType<typeof planOf>): Geo => ({ part: plan.part, geo: plan.geo }) as Geo
const keep = (part: PartId, input: Json, label: string) => useFits.setState({ planned: { part, input: JSON.parse(JSON.stringify(input)) as Json, label } satisfies Planned })

// ---- building, one at a time ---------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve()
let waitingTurn = 0
let stops = 0
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const asked = stops
  waitingTurn++
  useFits.setState({ busy: true })
  const mine = queue.then(async () => {
    if (stops !== asked) throw new CommandError('failed', 'Stopped.')
    return job()
  })
  const settle = () => {
    if (--waitingTurn === 0) useFits.setState({ busy: false, status: '' })
  }
  queue = mine.then(settle, settle)
  return mine
}

async function run(geo: Geo, label: string, out: 'step' | 'stl' | 'info', signal?: AbortSignal, chord?: number, avoid?: Box3 | null) {
  useFits.setState({ busy: true, status: `Building ${label}…` })
  try {
    return await build({ ...geo, out, ...(chord ? { chord } : {}), ...(avoid ? { avoid } : {}) }, signal)
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    throw new CommandError('failed', m === 'Stopped.' ? 'Stopped.' : `The ${label} could not be built: ${m}`)
  }
}

interface ReverseBody {
  id: number
  name: string
  bounds?: { min: number[]; max: number[] } | null
}
const reverseBodies = () => (readStateSections().reverse as { bodies?: ReverseBody[] } | undefined)?.bodies ?? []

/** Each new body to the part standing where it does, nearest first. */
function matchParts(parts: FitsPart[], bodies: ReverseBody[]): (FitsPart | undefined)[] {
  const left = new Set(parts.map((_, i) => i))
  return bodies.map((b, i) => {
    let best = -1
    let far = Infinity
    if (b.bounds)
      for (const j of left) {
        const p = parts[j]
        const d = [0, 1, 2].reduce((s, q) => s + Math.abs(p.box.min[q] - b.bounds!.min[q]) + Math.abs(p.box.max[q] - b.bounds!.max[q]), 0)
        if (d < far) [best, far] = [j, d]
      }
    if (best < 0) best = left.has(i) ? i : ([...left][0] ?? -1)
    if (best < 0) return undefined
    left.delete(best)
    return parts[best]
  })
}

/** The part built and brought into Reverse Engineer as named bodies. */
async function make(plan: ReturnType<typeof planOf>, c: { progress(t: string): void; signal?: AbortSignal }) {
  return inTurn(async () => {
    c.progress(`Building the ${plan.label}…`)
    // Clear of the bodies standing, where it would land in them.
    const a = await run(geoOf(plan), plan.label, 'step', c.signal, undefined, bodiesBox())
    if (!a.step) throw new CommandError('failed', `The ${plan.label} gave no STEP.`)
    c.signal?.throwIfAborted()
    const before = reverseBodies()
    const had = new Set(before.map((b) => b.id))
    try {
      await runWithin('reverse.import.step', { bytes: new TextEncoder().encode(a.step), name: `${plan.label.replace(/[\\/:*?"<>|×]+/g, ' ').trim()}.step` })
    } catch (e) {
      if (e instanceof CommandError && e.code === 'unknown_command') throw new CommandError('invalid_state', 'Reverse Engineer is not in this build: Fits makes its parts there. fit.file gives the file alone.')
      throw e
    }
    const fresh = reverseBodies().filter((b) => !had.has(b.id))
    const partOf = matchParts(a.parts, fresh)
    const taken = new Set([...before, ...fresh].map((b) => b.name.toLowerCase()))
    const named: { at: number; name: string }[] = []
    for (const [i, b] of fresh.entries()) {
      const want0 = partOf[i]?.name ?? b.name
      taken.delete(b.name.toLowerCase())
      let want = want0
      for (let n = 2; taken.has(want.toLowerCase()); n++) want = `${want0} ${n}`
      if (want !== b.name) await runWithin('reverse.body.set', { body: b.id, name: want }).catch(() => (want = b.name))
      taken.add(want.toLowerCase())
      const at = partOf[i] ? a.parts.indexOf(partOf[i]!) : a.parts.length + i
      named.push({ at, name: want })
    }
    // In the parts' order, whatever order the file brought them in.
    const bodies = named.sort((x, y) => x.at - y.at).map((x) => x.name)
    useFits.setState({ made: { part: plan.part, label: plan.label, bodies, parts: a.parts } })
    return { bodies, parts: a.parts.map(partOut) }
  })
}

const partOut = (p: FitsPart) => ({ name: p.name, volume: Math.round(p.volume), size: p.box.max.map((x, i) => r4(x - p.box.min[i])) })

/** The answers on show worked again with the settings and calibration as
 *  they stand — after a change, an undo or a project opened. One that no
 *  longer works out is put away. */
export function refreshAnswers(): void {
  const s = st()
  const next = { ...s.answers }
  const again = <T,>(tool: 'pair' | 'snap' | 'hinge' | 'pin' | 'stack', f: (i: Json) => T) => {
    if (!next[tool]) return
    try {
      ;(next as Record<string, unknown>)[tool] = f((s.inputs[tool] ?? {}) as Json)
    } catch {
      delete next[tool]
    }
  }
  again('pair', (i) => {
    const { material, ...rest } = i as Json & { material?: string }
    const c = ctx()
    return planPair(pairArgs(rest), material ? { ...c, settings: { ...c.settings, material } } : c)
  })
  again('snap', (i) => planOf('snap', i))
  again('hinge', (i) => planOf('hinge', i))
  again('pin', (i) => planOf('pin', i))
  again('stack', (i) => stack(i.items as StackItem[], (i.tolerance as number | undefined) ?? s.settings.tolerance, (i.min as number | undefined) ?? 0))
  useFits.setState({ answers: next })
}

// ---- the commands -------------------------------------------------------------------------

const list: Command<{ nominal?: number }> = {
  name: 'list',
  title: 'Fit classes, materials and parts',
  description: 'The fit classes (what each is for, the ISO 286 fit it stands in for — a reference only — and its diametral clearance as printed at nominal, 10 by default), the materials with their secant modulus, permissible strain (and the share of it printed upright), friction and where the strain comes from, the parts Fits makes, and the settings and calibration in use. Changes nothing.',
  input: obj({ nominal: len('The size the clearances are given at (10)', { minimum: 0.5, maximum: 500 }) }),
  readOnly: true,
  run: async ({ nominal = 10 }) => ({
    nominal,
    classes: CLASSES.map((c) => ({ id: c, label: CLASS_DEFS[c].label, use: CLASS_DEFS[c].use, like: CLASS_DEFS[c].iso, clearance: clearanceOf(c, nominal, st().settings), ...(st().settings.classes[c] ? { tested: st().settings.classes[c] } : {}) })),
    printer: { tolerance: st().settings.tolerance, holdsAbout: itGrade(nominal, st().settings.tolerance).grade ? `IT${itGrade(nominal, st().settings.tolerance).grade}` : 'coarser than IT18' },
    materials: MATERIALS.map((m) => ({ id: m.id, label: m.label, modulusMPa: m.modulus, strain: m.strain, upright: m.upright, friction: m.friction, basis: m.basis })),
    parts: { coupon: 'fit.test', snap: 'fit.snap, then fit.apply', hinge: 'fit.hinge, then fit.apply', pin: 'fit.pin, then fit.apply' },
    settings: st().settings,
    calibration: st().calibration,
    printerFit: printerFitOf(st().calibration),
  }),
}

interface SetIn {
  tolerance?: number
  material?: string
  setup?: string | null
  tool?: Tool
  reset?: boolean
}

const set: Command<SetIn> = {
  name: 'set',
  title: 'Fits settings',
  description: 'tolerance: ± a printed size lands within, mm (0.15) — the stack’s default and the pair’s range. material: what parts are printed in (pla, petg, abs, asa, nylon, tpu-95a) — the snap hook’s and a press’s strain limit. setup: the setup (setup.list, by id or name) whose machine the fits are sized for — a print setup’s printer calibration, its own or else Fits’; null for Fits’ own calibration (the default); sizedFor in the answer says which. tool: the panel’s page. reset: true for the defaults (the calibration stays; fit.calibrate { reset } for that). Saved with the project.',
  input: obj({
    tolerance: len('± a printed size lands within', { minimum: 0.005, maximum: 2 }),
    material: enumOf(MATERIAL_NAMES),
    setup: { oneOf: [str(undefined, { minLength: 1 }), { type: 'null' }], description: 'The setup whose machine the fits are sized for; null for Fits’ calibration.' },
    tool: enumOf(TOOLS, 'The panel’s page.'),
    reset: bool('Back to the defaults.'),
  }),
  history: false,
  run: async ({ tolerance, material, setup, tool, reset }) => {
    if (reset && (tolerance !== undefined || material !== undefined || setup !== undefined)) invalid('reset: on its own, or give the settings.')
    let machine: string | undefined | null = undefined
    if (setup !== undefined && setup !== null) {
      const found = setupsOf().find((x) => x.id === setup || x.name.toLowerCase() === setup.toLowerCase())
      if (!found) invalid(`No setup "${setup}" — there are ${setupsOf().map((x) => `${x.id} ${x.name}`).join(', ') || 'none'} (setup.add makes one).`)
      machine = found!.id
    } else if (setup === null) machine = null
    if (tool) useFits.setState({ tool })
    if (reset) st().set({ settings: { ...DEFAULT_SETTINGS } })
    else if (tolerance !== undefined || material !== undefined || machine !== undefined) {
      const { machine: _was, ...rest } = st().settings
      void _was
      const kept = machine === undefined ? st().settings.machine : machine
      st().set({ settings: { ...rest, ...(tolerance !== undefined ? { tolerance } : {}), ...(material ? { material: materialOf(material)!.id } : {}), ...(kept ? { machine: kept } : {}) } })
    } else if (!tool) invalid('Give a setting to change, or reset: true.')
    return describeFits()
  },
}

interface CalibrateIn {
  readings?: Reading[]
  hole?: number
  shaft?: number
  from?: 'print-fit'
  classes?: Partial<Record<FitClass, number | null>>
  at?: number
  reset?: boolean
}

const calibrate: Command<CalibrateIn> = {
  name: 'calibrate',
  title: 'Calibrate to the printer',
  description:
    'What the printer does to holes and shafts, from one of: readings (features measured on a print: kind hole or shaft, its model size and the size measured — fit.test’s coupon gives every model size); hole and shaft (how much smaller a round hole prints and how much bigger a shaft, diametral, mm, entered); from: "print-fit" (the last print measured from a scan, fit.measure: its hole and contour offsets, doubled to diametral; refused when that run fits poorly, over 4 — fit.measure makes a good run the calibration itself). classes: the clearance at which each class felt right on fit.test’s coupon ({ slip: 0.1, press: -0.05 }; null forgets one), at the coupon’s nominal (or at). reset: back to the default offsets and untested classes. Dated; Hardware, Generate and Boards size their holes with it (printerFit in the answer: the same figures as they read them). Saved with the project; one undo step.',
  input: obj({
    readings: arr(obj({ kind: enumOf(['hole', 'shaft']), model: len('As modelled', { exclusiveMinimum: 0 }), measured: len('As measured', { exclusiveMinimum: 0 }) }, ['kind', 'model', 'measured']), 'Features measured on a print.', { minItems: 1, maxItems: 100 }),
    hole: len('How much smaller holes print, diametral', { minimum: -1, maximum: 2 }),
    shaft: len('How much bigger shafts print, diametral', { minimum: -1, maximum: 2 }),
    from: enumOf(['print-fit'], 'The last print measured from a scan (fit.measure).'),
    classes: anyObject('Class → clearance as printed that felt right (mm), or null to forget it: { "slip": 0.1 }.'),
    at: len('The nominal the classes were felt at (the last coupon’s)', { minimum: 0.5, maximum: 500 }),
    reset: bool('Default offsets, untested classes.'),
  }),
  history: false,
  run: async ({ readings, hole, shaft, from, classes, at, reset }) => {
    const sources = [readings !== undefined, hole !== undefined || shaft !== undefined, from !== undefined, reset === true].filter(Boolean).length
    if (sources > 1) invalid('One of readings, hole and shaft, from, or reset.')
    if (sources === 0 && classes === undefined) invalid('Give readings, hole and shaft, from: "print-fit", classes, or reset: true.')
    if (at !== undefined && classes === undefined) invalid('at: with classes only.')
    let cal: Calibration | undefined
    const out: Json = {}
    if (reset) cal = { ...DEFAULT_CALIBRATION }
    if (readings) {
      const r = checked(() => fromReadings(readings, st().calibration))
      const { holes, shafts, ...c } = r
      cal = c
      out.readings = { holes, shafts }
      if (!holes || !shafts) out.note = `No ${holes ? 'shaft' : 'hole'} readings: that offset stays as it was.`
    }
    if (hole !== undefined || shaft !== undefined) cal = { hole: hole ?? st().calibration.hole, shaft: shaft ?? st().calibration.shaft, source: 'entered' }
    if (from) {
      const pf = readStateSections().fit as { last?: { run: number; fit?: number; holeOffset: number; contourOffset: number; scaleXY: number }; settings?: { printer?: string; material?: string } } | undefined
      const last = pf?.last
      if (!last) throw new CommandError('invalid_state', 'There is no run to read from a scan: measure a print first (fit.measure, Calibrate from a scan), or give readings.')
      if (typeof last.fit === 'number' && last.fit > POOR_FIT) throw new CommandError('invalid_state', `The last scanned print fits poorly (${r4(last.fit)}), so its offsets are not the printer's: fix the warping or the alignment and measure again, or calibrate with a coupon.`)
      const profile = [pf?.settings?.printer, pf?.settings?.material].filter((x): x is string => typeof x === 'string' && x.trim() !== '').join(', ')
      cal = { ...fromPrintFit(last.holeOffset, last.contourOffset), ...(profile ? { profile } : {}) }
      out.printFit = { run: last.run, holeOffset: last.holeOffset, contourOffset: last.contourOffset }
      if (Math.abs(last.scaleXY - 1) > 0.002) out.note = `That print was scaled ${r4((last.scaleXY - 1) * 100)} % in XY too: put that right in the slicer (fit.suggest) — these offsets leave it out.`
    }
    let settings = st().settings
    if (reset) settings = { ...settings, classes: {} }
    if (classes) {
      if (typeof classes !== 'object' || Array.isArray(classes)) invalid('classes: an object of class → clearance.')
      const coupon = st().answers.test
      const nominal = at ?? coupon?.geo.nominal
      if (nominal === undefined) invalid('at: the nominal the classes were felt at (no coupon was made here).')
      // An uncompensated coupon's labels are model clearances: as printed
      // they are less by what the printer takes off both sides.
      const shift = at === undefined && coupon && !coupon.compensated ? (cal ?? st().calibration).hole + (cal ?? st().calibration).shaft : 0
      if (shift) out.converted = `The last coupon was modelled without offsets: each label taken as ${r4(shift)} less as printed, by the calibration.`
      const next: Partial<Record<FitClass, ClassOverride>> = { ...settings.classes }
      for (const [k, v] of Object.entries(classes)) {
        if (!(CLASSES as readonly string[]).includes(k)) invalid(`classes: no class "${k}" (${CLASSES.join(', ')}).`)
        if (v === null) delete next[k as FitClass]
        else if (typeof v !== 'number' || !Number.isFinite(v) || v < -2 || v > 5) invalid(`classes.${k}: a clearance from −2 to 5, or null.`)
        else next[k as FitClass] = { clearance: r4(v - shift), at: nominal! }
      }
      const order = CLASSES.filter((c) => next[c]).map((c) => [c, classClearanceAt(next, c, nominal!)] as const)
      for (let i = 1; i < order.length; i++) if (order[i][1] >= order[i - 1][1]) out.warning = `${order[i][0]} is as loose as ${order[i - 1][0]} or looser: check the readings.`
      settings = { ...settings, classes: next }
    }
    // Dated, so the workspaces that size holes with it can say which they used.
    if (cal && !reset) cal = { ...cal, at: today() }
    st().set({ ...(cal ? { calibration: cal } : {}), ...(settings !== st().settings ? { settings } : {}) })
    return { ...out, calibration: st().calibration, printerFit: printerFitOf(st().calibration), classes: st().settings.classes }
  },
}

const classClearanceAt = (o: Partial<Record<FitClass, ClassOverride>>, c: FitClass, d: number) => o[c]!.clearance + CLASS_DEFS[c].perMm * (d - o[c]!.at)

const pairCmd: Command<Json> = {
  name: 'pair',
  title: 'Size a hole and a shaft',
  description: 'A hole and a shaft that fit, from the nominal and a class (or a clearance): the sizes they should print at, the sizes to model them at (the calibrated offsets added), the clearance’s range with every size at its worst and as a root sum of squares, the ISO 286 fit it stands in for and the IT grade the printer holds at that size (references only), and for a press the strain it puts on the hub against the material’s limit. basis: which keeps the nominal; bought: a side that is not printed. Changes nothing.',
  input: obj(pairFields, ['nominal']),
  readOnly: true,
  run: async (a) => {
    const { material, ...rest } = a as Json & { material?: string }
    const p = pairArgs(rest)
    const c = ctx()
    const out = checked(() => planPair(p, material ? { ...c, settings: { ...c.settings, material } } : c))
    remember('pair', a)
    useFits.setState((s) => ({ answers: { ...s.answers, pair: out } }))
    return out
  },
}

const stackCmd: Command<{ items: StackItem[]; min?: number; tolerance?: number }> = {
  name: 'stack',
  title: 'Tolerance stack',
  description: 'A gap made by a chain of sizes: each item a nominal with sign +1 (adds to the gap) or −1 (takes from it), and ± tol, or plus and minus (each ≥ 0); an item without one takes the printer’s tolerance (or tolerance here). Returns the nominal and mean gap, worst case (every tolerance at its limit), RSS (root sum of squares), each item’s share of the variance, and — taking each tolerance as ±3σ — the chance the gap falls under min (0). Changes nothing.',
  input: obj(
    {
      items: arr(obj({ name: str('What it is.'), nominal: len('Its size', {}), sign: enumOf([1, -1], '+1 adds to the gap, −1 takes from it (+1).'), tol: len('±', { minimum: 0 }), plus: len('Over', { minimum: 0 }), minus: len('Under (as a positive number)', { minimum: 0 }) }, ['nominal']), 'The chain, in any order.', { minItems: 1, maxItems: 50 }),
      min: len('The least gap that works (0)', {}),
      tolerance: len('± for items given none (the setting)', { minimum: 0, maximum: 5 }),
    },
    ['items'],
  ),
  readOnly: true,
  run: async ({ items, min = 0, tolerance }) => {
    for (const [i, it] of items.entries()) if (it.tol !== undefined && (it.plus !== undefined || it.minus !== undefined)) invalid(`items[${i}]: tol, or plus and minus — not both.`)
    const out = checked(() => stack(items, tolerance ?? st().settings.tolerance, min))
    remember('stack', { items, min, ...(tolerance !== undefined ? { tolerance } : {}) })
    useFits.setState((s) => ({ answers: { ...s.answers, stack: out } }))
    const worst = out.contributions[0]
    return { ...out, ...(out.worst.min < min ? { verdict: `Worst case the gap reaches ${out.worst.min}, under ${min}${out.rss.min >= min ? ' — though RSS keeps it above' : ''}. ${worst.name} brings ${Math.round(worst.share * 100)} % of the variance: tighten it first.` } : { verdict: `The gap holds at or above ${min} worst case.` }) }
  },
}

const snapCmd: Command<Partial<SnapArgs>> = {
  name: 'snap',
  title: 'Design a snap-fit hook',
  description: 'One cantilever snap-fit hook of constant section (forces are per hook), from the standard beam formulas: strain at the root ε = 1.5·t·y/L² against the material’s permissible strain (60 % of it for repeated use, the material’s share printed upright), deflection force P = b·t²·E·ε/(6L), mating and separation force W = P·(µ + tan α)/(1 − µ·tan α) with the lead-in and retaining angles (null where it locks), the most undercut and the shortest beam that stay within the strain; and the hook with its catch window as fit.apply would build them (window clearance, engagement). Values default as listed. Changes nothing; kept for fit.apply.',
  input: obj(snapFields),
  readOnly: true,
  run: async (a) => {
    const plan = planOf('snap', a as Json) as ReturnType<typeof planSnap>
    remember('snap', a)
    keep('snap', a as Json, plan.label)
    useFits.setState((s) => ({ answers: { ...s.answers, snap: plan } }))
    return { label: plan.label, ...plan.calc, notes: plan.notes, engagement: plan.engagement, window: plan.geo.window, fillet: plan.geo.fillet, layout: plan.geo.layout }
  },
}

const hingeCmd: Command<HingeArgs> = {
  name: 'hinge',
  title: 'Design a print-in-place hinge',
  description: 'A knuckle hinge printed in one go, both leaves flat on the bed: leaf A’s knuckles carry a pin the whole length, leaf B’s are bored over it. The radial clearance (round the pin and knuckles) and the axial gap (between knuckles) are as printed; the modelled ones add the calibrated offsets. Returns each knuckle’s length, the knuckles per leaf, the bore, the wall round it, the clearances printed and modelled, and notes. Changes nothing; kept for fit.apply.',
  input: obj(hingeFields),
  readOnly: true,
  run: async (a) => {
    const plan = planOf('hinge', a as Json) as ReturnType<typeof planHinge>
    remember('hinge', a)
    keep('hinge', a as Json, plan.label)
    useFits.setState((s) => ({ answers: { ...s.answers, hinge: plan } }))
    const { geo, part: _part, ...rest } = plan
    return { ...rest, length: geo.length, knuckles: geo.knuckles, knuckle: geo.knuckle, pin: geo.pin }
  },
}

const pinCmd: Command<PinArgs & { class?: FitClass }> = {
  name: 'pin',
  title: 'Design a pin and socket',
  description: `A pin and the socket it goes into, sized as fit.pair sizes them (class ${PIN_DEFAULTS.cls} by default): the pin chamfered both ends, the socket a block with a blind hole and a lead-in. bought: a steel dowel at the nominal — the socket alone. layout assembled seats the pin 0.2 off the socket’s floor, to check the fit in Reverse Engineer. Returns the fit (printed and modelled sizes, range, strain) and notes. Changes nothing; kept for fit.apply.`,
  input: obj(pinFields),
  readOnly: true,
  run: async (a) => {
    const plan = planOf('pin', a as Json) as ReturnType<typeof planPin>
    remember('pin', a)
    keep('pin', a as Json, plan.label)
    useFits.setState((s) => ({ answers: { ...s.answers, pin: plan } }))
    return { label: plan.label, fit: plan.fit, socket: { hole: plan.geo.hole, depth: plan.geo.depth, wall: plan.geo.wall, floor: plan.geo.floor }, ...(plan.geo.pin !== null ? { pin: { diameter: plan.geo.pin, length: plan.geo.length, chamfer: plan.geo.chamfer } } : {}), notes: plan.notes }
  },
}

const test: Command<TestIn> = {
  name: 'test',
  title: 'Make a tolerance test coupon',
  description:
    'A coupon to print and try, made in Reverse Engineer: a plate of holes and a bar of pegs, each labelled (engraved) with its diametral clearance against the nominal (+.10, -.05 …), a gauge pin at the nominal for the holes and a gauge ring for the pegs. The modelled sizes add the calibrated offsets unless compensate is false. Returns every hole’s and peg’s printed and modelled size — measure them and give fit.calibrate { readings }, or the clearance each class felt right at as fit.calibrate { classes } — and the bodies made. One undo step.',
  input: obj(testFields),
  long: true,
  timeoutMs: 300_000,
  label: (a) => `fit test ${a.nominal ?? TEST_DEFAULTS.nominal}`,
  run: async (a, c) => {
    const plan = planOf('coupon', a as Json) as ReturnType<typeof planTest>
    remember('test', a)
    useFits.setState((s) => ({ answers: { ...s.answers, test: plan } }))
    const made = await make(plan, c)
    return { label: plan.label, compensated: plan.compensated, rows: plan.rows, gauges: plan.gauges, ...made, notes: plan.notes }
  },
}

const partIn = enumOf(PART_IDS, 'coupon, snap, hinge or pin; the one planned last by default.')
const paramsIn = anyObject('Its values, as fit.test, fit.snap, fit.hinge or fit.pin take them.')

function chosen(part: PartId | undefined, params: Json | undefined): { part: PartId; input: Json } {
  if (part === undefined) {
    if (params !== undefined) invalid('params: give the part too.')
    const p = st().planned
    if (!p) invalid('Plan one first (fit.snap, fit.hinge or fit.pin), or give part and params.')
    return { part: p!.part, input: p!.input }
  }
  return { part, input: params ?? (st().inputs[part === 'coupon' ? 'test' : part] as Json | undefined) ?? {} }
}

const apply: Command<{ part?: PartId; params?: Json }> = {
  name: 'apply',
  title: 'Make the part',
  description: 'Build the part fit.snap, fit.hinge or fit.pin planned last — or the part and params given here — and bring it into Reverse Engineer as named bodies (an Import feature, saved with the project), to place, cut into a part and export there. Planned again with the settings and calibration as they stand. One undo step. Returns the bodies and each part’s volume (mm³) and size (mm).',
  input: obj({ part: partIn, params: paramsIn }),
  long: true,
  timeoutMs: 300_000,
  label: (a) => `make ${a.part ?? st().planned?.label ?? 'fit part'}`,
  run: async ({ part, params }, c) => {
    const ch = chosen(part, params)
    const plan = planOf(ch.part, ch.input)
    keep(ch.part, ch.input, plan.label)
    const made = await make(plan, c)
    return { label: plan.label, ...made, notes: plan.notes }
  },
}

const file: Command<{ part?: PartId; params?: Json; format?: 'step' | 'stl'; chord?: number }> = {
  name: 'file',
  title: 'The part as a file',
  description: 'Build the part planned last — or the part and params given — and hand back the file alone, STEP (the default) or binary STL in mm meshed to chord (0.02), without bringing it into the project. Returns the file and each part’s volume and size.',
  input: obj({ part: partIn, params: paramsIn, format: enumOf(['step', 'stl'], 'step (the default) or stl.'), chord: len('How far a triangle may stand off a curved face (0.02)', { exclusiveMinimum: 0, maximum: 1 }) }),
  readOnly: true,
  long: true,
  returnsFile: true,
  timeoutMs: 300_000,
  run: async ({ part, params, format = 'step', chord }, c) => {
    const ch = chosen(part, params)
    const plan = planOf(ch.part, ch.input)
    c.progress(`Building the ${plan.label}…`)
    const a = await inTurn(() => run(geoOf(plan), plan.label, format, c.signal, chord))
    const base = plan.label.replace(/[\\/:*?"<>|×]+/g, ' ').replace(/\s+/g, ' ').trim()
    const out = format === 'stl' ? { name: `${base}.stl`, mimeType: 'model/stl', bytes: a.stl as Uint8Array } : { name: `${base}.step`, mimeType: 'model/step', bytes: new TextEncoder().encode(a.step ?? '') }
    if (!out.bytes?.length) throw new CommandError('failed', `The ${plan.label} gave an empty file.`)
    return { file: out, parts: a.parts.map(partOut) }
  },
}

const stopCmd: Command<Record<string, never>> = {
  name: 'stop',
  title: 'Stop the build',
  description: 'Stop the part being built, and any waiting their turn. Nothing is brought in.',
  input: obj({}),
  interrupts: true,
  history: false,
  run: async () => {
    const was = st().busy
    stops++
    stopBuild('Stopped.')
    return { stopped: was }
  },
}

/** Every one runs without the page (Command.headless): the sizes are
 *  worked out from numbers, the parts built in this thread headless
 *  (plugin.ts headless) and brought into Reverse Engineer's bodies. */
export const fitsCommands = ([list, set, calibrate, pairCmd, stackCmd, snapCmd, hingeCmd, pinCmd, test, apply, file, stopCmd] as Command<never>[]).map((c) => ({ ...c, headless: true }))
