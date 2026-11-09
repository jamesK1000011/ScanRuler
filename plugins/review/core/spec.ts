// SPDX-License-Identifier: AGPL-3.0-only
// A design spec a part is judged against — the least wall and gap, the
// mass, the least safety factor, the steepest overhang, the pauses — and
// the verdict a review comes to. Pure: no stores, no commands.

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
  /** The steepest overhang from vertical, degrees. */
  maxOverhang?: number
  /** How many pauses the print takes for parts encased. */
  pauses?: number
}

export const SPEC_KEYS = ['minWall', 'minClearance', 'massMin', 'massMax', 'massTarget', 'massTol', 'minSafety', 'maxOverhang', 'pauses'] as const

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
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) return `${k} is to be a number of 0 or more`
    if (k === 'pauses' && !Number.isInteger(x)) return 'pauses is a count'
    if (k === 'maxOverhang' && x > 90) return 'maxOverhang is in degrees from vertical, 0 to 90'
    out[k as keyof ReviewSpec] = x
  }
  if (out.massMin !== undefined && out.massMax !== undefined && out.massMin > out.massMax) return 'massMin is over massMax'
  if (out.massTol !== undefined && out.massTarget === undefined) return 'massTol goes with massTarget'
  return out
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
