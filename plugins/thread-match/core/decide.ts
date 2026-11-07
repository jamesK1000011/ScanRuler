// SPDX-License-Identifier: AGPL-3.0-only
// From a reading to an answer: the sizes the reading fits, scored, and the
// verdict — a match, two or more the scan can't tell apart, or none. Where
// it can't tell, it says which one measurement would, and what each
// candidate would read.
//
// A size is scored as reverse.thread.read scores it — twice the pitch's
// share off plus the diameter's — and then marked down for what the fold
// read that contradicts it: a flank angle well away from the family's, a
// taper where the family is parallel, or none where it tapers. A size is
// consistent with the reading when its pitch and diameter both lie within
// what the scan can resolve and nothing contradicts it. Two consistent
// sizes with different names are ambiguous, however good the best one's
// score looks.

import { type Family, type ThreadRow, familyInfo, rowsOf } from './tables'

export interface Reading {
  pitch: number
  /** One standard deviation of the pitch, mm. */
  pitchSigma: number
  major: number
  minor: number
  internal: boolean | null
  noise: number
  /** Threaded length read, mm. */
  length: number
  flankAngle: number | null
  flankConfidence: 'high' | 'low' | null
  /** Diameter change per mm and its standard error. */
  taper: number | null
  taperSigma: number | null
  /** The folded tooth's height over the pitch, null without a fold. */
  depthShare: number | null
}

export interface Scored {
  family: Family
  designation: string
  major: number
  pitch: number
  tpi?: number
  angle: number
  taper: number
  pitchOff: number
  diameterOff: number
  /** What the fold read against it, if anything. */
  against: string[]
  score: number
  consistent: boolean
  note?: string
}

export interface RuledOut {
  designation: string
  /** Why: what the fold read against it. Its pitch and diameter fit. */
  by: string[]
}

export interface Deciding {
  /** What to measure, in words a person with calipers or a gauge follows. */
  measure: string
  /** What each candidate would read. */
  expect: { designation: string; value: string }[]
  /** How far apart they read, in the measurement's own unit. */
  separation: string
}

export interface Verdict {
  verdict: 'match' | 'ambiguous' | 'none'
  confidence: 'high' | 'low' | null
  best: Scored | null
  candidates: Scored[]
  /** The sizes the scan can't tell from the best, with it. */
  tied: string[]
  deciding: Deciding[]
  /** Sizes whose pitch and diameter fit as well, set aside only by the
   *  flank angle or the taper the fold read — worth one look to confirm. */
  ruledOut: RuledOut[]
  taperRead: 'tapered' | 'parallel' | 'unclear'
  /** The limits a size had to fall within to be consistent. */
  tolerance: { pitch: number; diameter: number }
}

/** The near-enough limits reverse.thread.read suggests a size within. */
const NEAR_PITCH = 0.12
const NEAR_DIAMETER = 0.08
/** The least share a pitch and a diameter can be resolved to on any scan. */
/** The least share a pitch can be resolved to: a scanner's own scale is
 *  seldom truer than this. */
export const PITCH_FLOOR = 0.01
const DIAMETER_FLOOR = 0.05
/** How many degrees a flank angle may read from the family's before it is
 *  held against it: a scan's rounding reaches the middle of small flanks
 *  and reads them wide, so the finer the pitch the more slack. */
export const flankSlack = (pitch: number): number => (pitch >= 1.5 ? 4 : pitch >= 0.9 ? 6 : 12)
const PIPE_TAPER = 1 / 16
/** How much deeper than a form's basic depth a tooth may read before it is
 *  held against the form: the basic profile is a little shallower than a
 *  real thread's root allows. */
const DEPTH_SLACK = 1.15

const r3 = (v: number) => Math.round(v * 1000) / 1000
const fmt = (v: number) => String(Math.round(v * 100) / 100)

/** Whether the fold reads a taper, a parallel wall, or can't say. */
export function taperState(reading: Reading): 'tapered' | 'parallel' | 'unclear' {
  if (reading.taper === null || reading.taperSigma === null) return 'unclear'
  const s = Math.max(reading.taperSigma, 0.003)
  const fromZero = Math.abs(reading.taper) / s
  const fromPipe = Math.abs(Math.abs(reading.taper) - PIPE_TAPER) / s
  if (fromZero >= 3 && fromPipe < 3) return 'tapered'
  if (fromZero < 3 && fromPipe >= 3) return 'parallel'
  return 'unclear'
}

export function decide(reading: Reading, families: readonly Family[], pitchFloor = PITCH_FLOOR): Verdict {
  const taperRead = taperState(reading)
  const pitchTol = Math.max((3 * reading.pitchSigma) / reading.pitch, pitchFloor)
  const scored: Scored[] = rowsOf(families).map((row) => score(row, reading, taperRead, pitchTol))
  scored.sort((a, b) => a.score - b.score)
  const best = scored[0] ?? null
  const tolerance = { pitch: r3(pitchTol), diameter: r3(diameterTol(reading, best?.major ?? reading.major)) }
  const consistent = scored.filter((s) => s.consistent)
  const tiedRows = dedupe(consistent)
  const near = best && best.pitchOff <= NEAR_PITCH && best.diameterOff <= NEAR_DIAMETER ? best : null
  let verdict: Verdict['verdict'], confidence: Verdict['confidence'], top: Scored | null
  if (tiedRows.length >= 2) {
    verdict = 'ambiguous'
    confidence = null
    top = tiedRows[0]
  } else if (tiedRows.length === 1) {
    verdict = 'match'
    confidence = 'high'
    top = tiedRows[0]
  } else if (near) {
    verdict = 'match'
    confidence = 'low'
    top = near
  } else {
    verdict = 'none'
    confidence = null
    top = null
  }
  const deciding = verdict === 'ambiguous' ? decidingFor(tiedRows.slice(0, 4), reading) : []
  const ruledOut =
    verdict === 'match'
      ? dedupe(scored.filter((s) => !s.consistent && s.against.length > 0 && s.pitchOff <= pitchTol && s.diameterOff <= diameterTol(reading, s.major)))
          .filter((s) => s.designation !== top?.designation)
          .slice(0, 3)
          .map((s) => ({ designation: s.designation, by: s.against }))
      : []
  return {
    verdict,
    confidence,
    best: top,
    candidates: scored.slice(0, 6),
    tied: verdict === 'ambiguous' ? tiedRows.map((s) => s.designation) : [],
    deciding,
    ruledOut,
    taperRead,
    tolerance,
  }
}

const diameterTol = (reading: Reading, d: number) => Math.max((6 * reading.noise) / d, DIAMETER_FLOOR)

function score(row: ThreadRow, reading: Reading, taperRead: 'tapered' | 'parallel' | 'unclear', pitchTol: number): Scored {
  const pitchOff = Math.abs(row.pitch - reading.pitch) / row.pitch
  const readD = reading.internal === true ? reading.minor : reading.internal === false ? reading.major : null
  const rowD = reading.internal === true ? row.minorInternal : row.major
  // On a taper the diameter runs over the length read; the reading's
  // extreme can lie anywhere along it.
  const slack = row.taper * reading.length
  const off = (a: number, b: number) => Math.max(0, Math.abs(a - b) - slack) / row.major
  const diameterOff = readD === null ? Math.min(off(row.major, reading.major), off(row.minorInternal, reading.minor)) : off(rowD, readD)
  const against: string[] = []
  let penalty = 0
  if (reading.flankAngle !== null && reading.flankConfidence === 'high') {
    const dev = Math.abs(reading.flankAngle - row.angle)
    const slack = flankSlack(reading.pitch)
    if (dev > slack) {
      against.push(`flank reads ${fmt(reading.flankAngle)}°, the ${familyInfo(row.family).label} form is ${row.angle}°`)
      penalty += (dev - slack) / 60
    }
  }
  // A scan rounds a tooth and reads it shallower, never deeper: a tooth
  // that reads clearly deeper than a form cuts is not that form.
  if (reading.depthShare !== null && reading.depthShare - reading.noise / reading.pitch > row.depthShare * DEPTH_SLACK) {
    against.push(`the tooth reads ${fmt(reading.depthShare)} of the pitch deep, deeper than the ${familyInfo(row.family).label} form's ${fmt(row.depthShare)}`)
    penalty += 0.3
  }
  if (taperRead === 'tapered' && row.taper === 0) {
    against.push('the wall tapers; this thread is parallel')
    penalty += 0.3
  }
  if (taperRead === 'parallel' && row.taper > 0) {
    against.push('the wall is parallel; this thread tapers 1:16')
    penalty += 0.3
  }
  const dTol = diameterTol(reading, row.major)
  return {
    family: row.family,
    designation: row.designation,
    major: row.major,
    pitch: row.pitch,
    ...(row.tpi ? { tpi: row.tpi } : {}),
    angle: row.angle,
    taper: row.taper,
    pitchOff: r3(pitchOff),
    diameterOff: r3(diameterOff),
    against,
    score: r3(2 * pitchOff + diameterOff + penalty),
    consistent: pitchOff <= pitchTol && diameterOff <= dTol && against.length === 0,
    ...(row.note ? { note: row.note } : {}),
  }
}

/** One per designation, the best scored first. */
function dedupe(list: Scored[]): Scored[] {
  const seen = new Set<string>()
  return list.filter((s) => (seen.has(s.designation) ? false : (seen.add(s.designation), true)))
}

/** The measurements that tell the tied sizes apart, the most telling first. */
function decidingFor(tied: Scored[], reading: Reading): Deciding[] {
  const out: { d: Deciding; weight: number }[] = []
  const all = (f: (s: Scored) => string) => tied.map((s) => ({ designation: s.designation, value: f(s) }))
  const pitches = new Set(tied.map((s) => s.pitch.toFixed(4)))
  if (pitches.size > 1) {
    const spread = Math.max(...tied.map((s) => s.pitch)) - Math.min(...tied.map((s) => s.pitch))
    const inch = tied.some((s) => s.tpi)
    out.push({
      d: {
        measure: inch
          ? 'Count the crests over 25.4 mm (1 inch) with a ruler or a thread pitch gauge, or measure across 10 crests with calipers'
          : 'Measure across 10 crests with calipers (11 crests, 10 gaps), or try a thread pitch gauge',
        expect: all((s) => `${fmt(10 * s.pitch)} mm over 10 pitches${s.tpi ? `, ${s.tpi} per inch` : ''}`),
        separation: `${fmt(10 * spread)} mm over 10 pitches`,
      },
      weight: 10 * spread,
    })
  }
  const dOf = (s: Scored) => (reading.internal === true ? minorOf(s) : s.major)
  const ds = tied.map(dOf)
  const dSpread = Math.max(...ds) - Math.min(...ds)
  if (dSpread > 0.01) {
    const where = reading.internal === true ? 'the bore across its crests (the minor diameter) with pin gauges or the calipers’ inside jaws' : 'the crests (the major diameter) with calipers, square across the thread'
    out.push({
      d: { measure: `Measure ${where}`, expect: tied.map((s) => ({ designation: s.designation, value: `${fmt(dOf(s))} mm` })), separation: `${fmt(dSpread)} mm` },
      // Calipers read to about 0.02 mm; under a tenth the reading is close.
      weight: dSpread < 0.1 ? dSpread / 2 : dSpread,
    })
  }
  const angles = new Set(tied.map((s) => s.angle))
  if (angles.size > 1) {
    const spread = Math.max(...tied.map((s) => s.angle)) - Math.min(...tied.map((s) => s.angle))
    out.push({
      d: { measure: 'Hold a 55°/60° thread gauge (a screw pitch gauge marked for both, or a centre gauge) against the flanks and look for light', expect: all((s) => `${s.angle}°`), separation: `${spread}°` },
      weight: spread / 20,
    })
  }
  const tapers = new Set(tied.map((s) => s.taper))
  if (tapers.size > 1) {
    const L = Math.max(reading.length, 10)
    out.push({
      d: {
        measure: `Measure the ${reading.internal === true ? 'bore' : 'crests'} at each end of the thread, ${fmt(L)} mm apart, and compare`,
        expect: all((s) => (s.taper > 0 ? `${fmt(L / 16)} mm larger at one end` : 'the same at both ends')),
        separation: `${fmt(L / 16)} mm`,
      },
      weight: L / 16,
    })
  }
  return out.sort((x, y) => y.weight - x.weight).map((x) => x.d)
}

function minorOf(s: Scored): number {
  const row = rowsOf([s.family]).find((r) => r.designation === s.designation)
  return row ? row.minorInternal : s.major
}
