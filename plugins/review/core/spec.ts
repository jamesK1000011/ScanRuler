// SPDX-License-Identifier: AGPL-3.0-only
// A design spec a part is judged against — in what it must do, not how it
// is made: the least wall and gap, the mass, the least safety factor — and
// how each part is made, by body, which says whether the checks for 3D
// printing judge it. The verdict a review comes to. Pure: no stores, no
// commands.

export interface ReviewSpec {
  /** The least wall, mm. */
  minWall?: number
  /** The least gap to the other bodies shown, mm. */
  minClearance?: number
  /** Mass bounds, g; or a target with its ± tolerance, g. */
  massMin?: number
  massMax?: number
  massTarget?: number
  massTol?: number
  /** The least safety factor of the last strength solve. */
  minSafety?: number
  /** How each body is made, by its name: "fdm" or "print" for 3D printed;
   *  anything else (laser-cut, machined, bought) is not printed. */
  processes?: Record<string, string>
}

const NUMBERS = ['minWall', 'minClearance', 'massMin', 'massMax', 'massTarget', 'massTol', 'minSafety'] as const
export const SPEC_KEYS = [...NUMBERS, 'processes'] as const

/** A spec as given or read from a file, checked: the reason it is not one,
 *  or the spec with only the keys it sets. */
export function specOf(value: unknown): ReviewSpec | string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'a spec is an object of numbers'
  const v = value as Record<string, unknown>
  const out: ReviewSpec = {}
  for (const k of Object.keys(v)) {
    if (!(SPEC_KEYS as readonly string[]).includes(k)) return `${k} is not part of a spec — it takes ${SPEC_KEYS.join(', ')}`
    const x = v[k]
    if (x === undefined || x === null) continue
    if (k === 'processes') {
      if (typeof x !== 'object' || Array.isArray(x)) return 'processes is an object: a body’s name to how it is made'
      const p: Record<string, string> = {}
      for (const [body, how] of Object.entries(x as Record<string, unknown>)) {
        if (typeof how !== 'string') return `processes.${body} is to be a word such as "fdm", "laser-cut" or "bought"`
        if (how.trim()) p[body] = how.trim()
      }
      if (Object.keys(p).length) out.processes = p
      continue
    }
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) return `${k} is to be a number of 0 or more`
    out[k as (typeof NUMBERS)[number]] = x
  }
  if (out.massMin !== undefined && out.massMax !== undefined && out.massMin > out.massMax) return 'massMin is over massMax'
  if (out.massTol !== undefined && out.massTarget === undefined) return 'massTol goes with massTarget'
  return out
}

/** A spec over another: the numbers given replace those kept, and the
 *  processes are merged body by body — an empty one drops the body's. */
export function specOver(kept: ReviewSpec, given: ReviewSpec, raw?: Record<string, unknown>): ReviewSpec {
  const out: ReviewSpec = { ...kept, ...given }
  const dropped = Object.entries((raw?.processes as Record<string, unknown> | undefined) ?? {}).filter(([, how]) => typeof how === 'string' && !how.trim()).map(([b]) => b)
  const processes = { ...(kept.processes ?? {}), ...(given.processes ?? {}) }
  for (const b of dropped) delete processes[b]
  if (Object.keys(processes).length) out.processes = processes
  else delete out.processes
  return out
}

/** How a part is made, as the review reads it: printed ("fdm", "print" and
 *  their like), unknown (not said), or other — the word given. */
export type Process = { kind: 'printed' } | { kind: 'unknown' } | { kind: 'other'; as: string }

export function processOf(word: string | undefined | null): Process {
  const w = (word ?? '').trim().toLowerCase()
  if (!w || w === 'unknown') return { kind: 'unknown' }
  if (/^(fdm|fff|print|printed|3d[- ]?print(ed)?)$/.test(w)) return { kind: 'printed' }
  return { kind: 'other', as: (word ?? '').trim() }
}

/** The mass a spec allows, g, or null when it says none. A target without
 *  its tolerance is held to ±5 %. */
export function massBounds(s: ReviewSpec): { min: number; max: number } | null {
  let min = s.massMin ?? -Infinity
  let max = s.massMax ?? Infinity
  if (s.massTarget !== undefined) {
    const tol = s.massTol ?? s.massTarget * 0.05
    min = Math.max(min, s.massTarget - tol)
    max = Math.min(max, s.massTarget + tol)
  }
  return Number.isFinite(min) || Number.isFinite(max) ? { min, max } : null
}

export type Severity = 'error' | 'warning' | 'info'

export interface Finding {
  /** The command whose answer it is from. */
  source: string
  severity: Severity
  says: string
  /** Where on the part: a point, mm, or words. */
  at?: number[] | string
}

export type Verdict = 'pass' | 'fix' | 'unknown'

/** The verdict: fix on any error; unknown while a check that must run did
 *  not, or a part of the spec could not be judged; pass otherwise. */
export function verdictOf(findings: readonly Finding[], missing: readonly string[], unjudged: readonly string[]): Verdict {
  if (findings.some((f) => f.severity === 'error')) return 'fix'
  return missing.length > 0 || unjudged.length > 0 ? 'unknown' : 'pass'
}

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

/** The findings worst first, at most `limit`; how many more there are. */
export function worstFirst(findings: readonly Finding[], limit: number): { findings: Finding[]; more: number } {
  const sorted = [...findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
  return { findings: sorted.slice(0, limit), more: Math.max(0, sorted.length - limit) }
}

/** A sentence cut to a line. */
export const line = (text: string, max = 160): string => {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export const r1 = (v: number) => Math.round(v * 10) / 10 + 0
export const r2 = (v: number) => Math.round(v * 100) / 100 + 0

/** A thin-wall finding of the printability check, as the review reads it. */
export interface WallFinding {
  id?: string
  rule?: string
  value?: number
  limit?: number
  unit?: string
  at?: number[]
  waived?: string
  /** A taper to a knife edge: value is its length, not a thickness. */
  edge?: boolean
}

/** How near a waived finding must be to the least wall to cover it, mm: a
 *  waiver matches to the millimetre (dfm.waive), and the two readings are
 *  of one wall, so half as much again. */
const WAIVED_NEAR = 1.5

/** The least wall a spec judges: the check's least, unless that place is
 *  waived — a stacking lip, a wall thinned on purpose — then the thinnest
 *  thin-wall finding not waived. The check reports walls only under its own
 *  minimum, so past that `covered` is false: what lies between is unread. */
export function wallForSpec(
  least: number,
  at: number[] | undefined,
  findings: readonly WallFinding[],
  minWall: number,
): { least: number; at?: number[]; waived?: WallFinding } | { least: null; waived: WallFinding; covered: boolean } {
  const thin = findings.filter((f) => f.rule === 'thin-wall' && !f.edge && typeof f.value === 'number')
  const near = (p?: number[]) => !!at && !!p && Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]) <= WAIVED_NEAR
  const waived = least < minWall ? thin.find((f) => f.waived && near(f.at)) : undefined
  if (!waived) return { least, at }
  const open = thin.filter((f) => !f.waived).sort((a, b) => a.value! - b.value!)[0]
  if (open) return { least: open.value!, at: open.at, waived }
  // Every thin-wall finding carries the rule's minimum as its limit (a
  // sharp edge's too); the warnings', the larger, is the one that bounds
  // what was looked for.
  const reported = Math.max(0, ...findings.filter((f) => f.rule === 'thin-wall' && typeof f.limit === 'number').map((f) => f.limit!))
  return { least: null, waived, covered: minWall <= reported + 1e-9 }
}
