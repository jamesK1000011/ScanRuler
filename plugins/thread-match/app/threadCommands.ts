// SPDX-License-Identifier: AGPL-3.0-only
// thread.*: a scanned thread named against the standards — or the honest
// answer that two of them can't be told apart on this scan, with the one
// measurement that would. Reads through reverse.thread.read for the axis,
// the pitch and the diameters, then folds the scan's points along the helix
// for the flank angle, the taper, the hand and the starts (core/shape.ts).

import { commandHost } from '../../../src/commands/host'
import { runCommand } from '../../../src/commands/registry'
import { arr, bool, enumOf, int, num, obj, oneOf, str, vec3 } from '../../../src/commands/schema'
import { normalize } from '../../../src/core/vec'
import type { Vec3 } from '../../../src/core/types'
import { type Command, CommandError } from '../../../src/plugins/api'
import { useStore } from '../../../src/state/store'
import { decide, PITCH_FLOOR } from '../core/decide'
import { readingOf, type ReverseRead } from '../core/identify'
import { readShape } from '../core/shape'
import { FAMILIES, FAMILY_IDS, type Family, familyInfo, lookup, ROWS } from '../core/tables'
import { useThreadMatch } from '../state/threadStore'

type Json = Record<string, unknown>

/** The families the Thread feature can cut, so a match can be modelled. */
const MODELLED: readonly Family[] = ['metric', 'unc', 'unf', 'print45']

const POINTS = 20_000

const familyList = arr(enumOf(FAMILY_IDS), `Which families to try: ${FAMILY_IDS.join(', ')}. All of them by default (thread.settings changes the default).`, { minItems: 1 })

const axisInput = oneOf(
  [
    { ...obj({ kind: enumOf(['element']), id: int('A cylinder element of 3D Measure.') }, ['kind', 'id'], 'A cylinder fitted in the bore or on the boss (element.fit).'), title: 'element' },
    { ...obj({ kind: enumOf(['face']), body: oneOf([num(), str()], 'The body, by id or name.'), face: oneOf([int('The face index.', { minimum: 0 }), { type: 'object', description: 'A face fingerprint or a where-query, as reverse.thread.read takes it.' }], 'The round face.') }, ['kind', 'body', 'face'], 'A round face of a Reverse Engineer body.'), title: 'face' },
    {
      ...obj(
        { kind: enumOf(['line']), origin: vec3('A point on the axis, mm — the middle of the length read.'), dir: vec3('The axis direction.'), radius: num('The nominal radius, mm.', { exclusiveMinimum: 0 }), length: num('mm along the axis, centred on origin.', { exclusiveMinimum: 0 }) },
        ['kind', 'origin', 'dir', 'radius', 'length'],
        'An axis given outright.',
      ),
      title: 'line',
    },
  ],
  'The axis to read along, exactly as reverse.thread.read takes it.',
)

const fmt = (v: number) => String(Math.round(v * 1000) / 1000)

export const identify: Command<{ axis: Json; families?: Family[]; band?: number; length?: number; limit?: number; detail?: 'brief' | 'full' }> = {
  name: 'identify',
  title: 'Identify a scanned thread',
  description:
    'Name the thread on a bore or boss of the scan against ISO metric, UNC, UNF, UNEF, NPT, G (BSPP), R (BSPT), metric trapezoidal Tr, ACME and the 3D-printing 45° form. verdict: match (best, with confidence high or low), ambiguous (tied: the sizes this scan cannot tell apart, and deciding: what to measure by hand and what each would read, most telling first) or none. Beyond reverse.thread.read it folds the points along the helix for a sharper pitch (pitchSigma), the flank angle, the taper (tapered / parallel / unclear), the hand and the number of starts (a lead screw); ruledOut lists sizes whose pitch and diameter fit too but were set aside only by the flank angle, the taper or the tooth depth — name them to the person when the call matters. feature is the Reverse Engineer thread ready to add when the match is a form the Thread feature cuts (metric, UNC, UNF, print45); pipe, trapezoidal and ACME threads are named but not modelled. A scan reads diameters a little small; a match within tolerance is normal. Changes nothing.',
  input: obj(
    {
      axis: axisInput,
      families: familyList,
      band: num('mm either side of the radius a point still counts (reverse.thread.read’s default by default).', { exclusiveMinimum: 0 }),
      length: num('mm along the axis to read, centred.', { exclusiveMinimum: 0 }),
      limit: int(`Scan points to read at most; ${POINTS} by default.`, { minimum: 500, maximum: POINTS }),
      detail: enumOf(['brief', 'full'], 'brief (the default) or full: adds the folded tooth profile and six candidates with their scores.'),
    },
    ['axis'],
  ),
  readOnly: true,
  run: async ({ axis, families, band, length, limit = POINTS, detail = 'brief' }) => {
    if (!useStore.getState().fileName) throw new CommandError('no_scan', 'There is no scan to read a thread off.')
    const fams = families ?? useThreadMatch.getState().families
    let read: Json
    try {
      read = (await runCommand('reverse.thread.read', { axis, standard: 'any', ...(band ? { band } : {}), ...(length ? { length } : {}), limit })) as Json
    } catch (e) {
      if (e instanceof CommandError && e.code === 'unknown_command') throw new CommandError('unavailable', 'thread.identify reads through the Reverse Engineer plugin (reverse.thread.read), which this build does not have.')
      throw e
    }
    const r = read as unknown as ReverseRead & { axis: { origin: Vec3; dir: Vec3; radius: number; length: number }; band: number; feature?: Json; suggested?: { designation: string } | null; note: string }
    const base = { axis: r.axis, ...(read.body ? { body: read.body } : {}), ...(read.element ? { element: read.element } : {}) }
    if (!r.thread || r.pitch === null) {
      const out = { verdict: 'none', ...base, thread: false, note: r.note }
      useThreadMatch.getState().remember({ verdict: 'none', best: null, tied: [], at: r.axis.origin })
      return out
    }
    const worker = commandHost().session.clientRef.current
    if (!worker) throw new CommandError('unavailable', 'The mesh worker is not running.')
    const dir = normalize(r.axis.dir)!
    const range = r.threaded ?? r.span
    const half = Math.max(Math.abs(range[0]), Math.abs(range[1]))
    const reach = r.axis.radius + r.band
    const min = [0, 1, 2].map((k) => r.axis.origin[k] - Math.abs(dir[k]) * half - reach) as Vec3
    const max = [0, 1, 2].map((k) => r.axis.origin[k] + Math.abs(dir[k]) * half + reach) as Vec3
    const q = await worker.query({ min, max, limit })
    const shape = readShape({ positions: q.positions, origin: r.axis.origin, dir, radius: r.axis.radius, band: r.band, from: range[0], to: range[1], pitch: r.pitch })
    const reading = readingOf(r, shape)!
    const v = decide(reading, fams, useThreadMatch.getState().pitchFloor)
    const best = v.best
    const info = best ? familyInfo(best.family) : null
    const feature = best && r.feature && r.suggested?.designation === best.designation && v.verdict === 'match' ? r.feature : undefined
    const out: Json = {
      verdict: v.verdict,
      ...(v.confidence ? { confidence: v.confidence } : {}),
      ...base,
      best: best
        ? { designation: best.designation, family: best.family, form: info!.label, major: best.major, pitch: best.pitch, ...(best.tpi ? { tpi: best.tpi } : {}), angle: best.angle, taper: best.taper ? '1:16' : 'parallel', source: info!.source, pitchOff: best.pitchOff, diameterOff: best.diameterOff, ...(best.note ? { note: best.note } : {}) }
        : null,
      ...(v.verdict === 'ambiguous' ? { tied: v.tied, deciding: v.deciding } : {}),
      ...(v.ruledOut.length ? { ruledOut: v.ruledOut } : {}),
      reads: {
        pitch: reading.pitch,
        pitchSigma: reading.pitchSigma,
        tpi: Math.round((25.4 / reading.pitch) * 100) / 100,
        major: r.major,
        minor: r.minor,
        internal: r.internal,
        leftHanded: shape ? shape.leftHanded : r.leftHanded,
        ...(shape ? { starts: shape.starts, lead: shape.lead } : {}),
        flankAngle: reading.flankAngle,
        flankConfidence: reading.flankConfidence,
        taper: v.taperRead,
        ...(shape ? { taperPerMm: shape.taper, taperSigma: shape.taperSigma, depthShare: shape.depthShare, foldSharpness: shape.sharpness } : {}),
        noise: reading.noise,
        length: fmt(reading.length),
      },
      tolerance: v.tolerance,
      canModel: best ? MODELLED.includes(best.family) : false,
      ...(feature ? { feature } : {}),
      ...(detail === 'full'
        ? { candidates: v.candidates.map((c) => ({ designation: c.designation, score: c.score, pitchOff: c.pitchOff, diameterOff: c.diameterOff, consistent: c.consistent, ...(c.against.length ? { against: c.against } : {}) })), ...(shape ? { tooth: shape.tooth } : {}) }
        : {}),
      note: noteFor(v, reading.internal, shape?.flankConfidence ?? null),
    }
    useThreadMatch.getState().remember({ verdict: v.verdict, best: best?.designation ?? null, tied: v.tied, at: r.axis.origin })
    return out
  },
}

function noteFor(v: ReturnType<typeof decide>, internal: boolean | null, flank: 'high' | 'low' | null): string {
  const what = internal === true ? 'bore' : internal === false ? 'boss' : 'thread'
  if (v.verdict === 'none') return `The ${what} repeats, but no size in the families tried fits within tolerance — see candidates (detail: full), or try other families. A worn, printed or non-standard thread reads this way.`
  if (v.verdict === 'ambiguous') return `This scan cannot tell ${v.tied.join(' from ')} apart. Ask the person for the first measurement in deciding; it separates them by ${v.deciding[0]?.separation ?? 'a little'}.`
  const best = v.best!
  const flankWord = flank === 'high' ? '' : ' The flank angle was not trusted on this pitch, so the form rests on pitch and diameter.'
  const one = v.ruledOut.length === 1
  const ruled = v.ruledOut.length ? ` ${v.ruledOut.map((r) => r.designation).join(', ')} ${one ? 'fits' : 'fit'} by pitch and diameter too and ${one ? 'was' : 'were'} set aside by ${[...new Set(v.ruledOut.flatMap((r) => r.by.map((b) => b.split(' ')[0] === 'flank' ? 'the flank angle' : b.includes('taper') ? 'the taper' : 'the tooth depth')))].join(' and ')}.` : ''
  return `${best.designation} (${v.confidence} confidence).${flankWord}${ruled}`
}

export const standards: Command<{ families?: Family[]; query?: string; limit?: number }> = {
  name: 'standards',
  title: 'List thread families and sizes',
  description: 'The thread families thread.identify knows, with their flank angle, taper and source standard, and their designations — filtered by family and by a search string (query matches designation text, e.g. "1/2" or "M6"). Changes nothing.',
  input: obj({ families: familyList, query: str('Text a designation contains.'), limit: int('How many designations at most; 60 by default.', { minimum: 1, maximum: 500 }) }),
  readOnly: true,
  run: async ({ families, query, limit = 60 }) => {
    const fams = families ?? FAMILY_IDS
    const q = query?.toLowerCase().replace(/x/g, '×')
    const rows = ROWS.filter((r) => fams.includes(r.family) && (!q || r.designation.toLowerCase().includes(q)))
    return {
      families: FAMILIES.filter((f) => fams.includes(f.id)).map((f) => ({ id: f.id, label: f.label, angle: f.angle, taper: f.taper ? '1:16' : 'parallel', source: f.source, sizes: ROWS.filter((r) => r.family === f.id).length })),
      designations: rows.slice(0, limit).map((r) => r.designation),
      ...(rows.length > limit ? { more: rows.length - limit } : {}),
    }
  },
}

export const lookupCommand: Command<{ designation: string }> = {
  name: 'lookup',
  title: 'Look up a thread size',
  description: 'A thread size’s basic dimensions by designation (M6x1, 1/4-20 UNC, 1/2-14 NPT, G 1/2, R 1/2, Tr16x4, 1/2-10 ACME, Ø6×1.75 print): major diameter, pitch and threads per inch, basic minor diameters for the bolt and the nut, flank angle, taper, profile depth, the source standard, and whether the Thread feature can model it. Changes nothing.',
  input: obj({ designation: str('The designation; x and × both work, case and spaces are ignored.', { minLength: 1 }) }, ['designation']),
  readOnly: true,
  run: async ({ designation }) => {
    const row = lookup(designation)
    if (!row) {
      const near = ROWS.filter((r) => r.designation.toLowerCase().includes(designation.toLowerCase().split(/[x×-\s]/)[0])).slice(0, 8).map((r) => r.designation)
      throw new CommandError('not_found', `No size "${designation}".${near.length ? ` Near: ${near.join(', ')}.` : ' See thread.standards.'}`)
    }
    const info = familyInfo(row.family)
    return { ...row, taper: row.taper ? '1:16' : 'parallel', form: info.label, source: info.source, tapDrillApprox: Math.round(row.minorInternal * 10) / 10, canModel: MODELLED.includes(row.family) }
  },
}

export const settings: Command<{ families?: Family[]; pitchFloor?: number; reset?: boolean }> = {
  name: 'settings',
  title: 'Thread-match settings',
  description: `The defaults thread.identify uses: families (which to try when a call names none) and pitchFloor (the least share a pitch is resolved to — your scanner's scale error; ${PITCH_FLOOR} by default, raise it for a scanner you trust less). Kept with the session. Call with nothing to read them. reset: back to the defaults.`,
  input: obj({ families: familyList, pitchFloor: num('Share of the pitch, 0.002 to 0.05.', { minimum: 0.002, maximum: 0.05 }), reset: bool('Back to the defaults.') }),
  history: false,
  run: async ({ families, pitchFloor, reset }) => {
    const st = useThreadMatch.getState()
    if (reset) st.reset()
    if (families || pitchFloor !== undefined) st.set({ ...(families ? { families } : {}), ...(pitchFloor !== undefined ? { pitchFloor } : {}) })
    const now = useThreadMatch.getState()
    return { families: now.families, pitchFloor: now.pitchFloor }
  },
}

export const threadCommands = [identify, standards, lookupCommand, settings] as Command<never>[]

