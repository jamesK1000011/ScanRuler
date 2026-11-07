// SPDX-License-Identifier: AGPL-3.0-only
// Giving out reference numerals, and keeping them with their parts.

import type { Numeral, PatentSettings } from './model'

export interface BodyInfo {
  id: number
  name: string
}

/** The next free numeral after the ones taken. */
export function nextNumeral(taken: Numeral[], s: Pick<PatentSettings, 'numeralStart' | 'numeralStep'>): number {
  let n = s.numeralStart
  const used = new Set(taken.map((x) => x.n))
  while (used.has(n)) n += s.numeralStep
  return n
}

/** A numeral for each body that has none yet, in the bodies' order. */
export function assignBodies(numerals: Numeral[], bodies: BodyInfo[], s: Pick<PatentSettings, 'numeralStart' | 'numeralStep'>): { numerals: Numeral[]; added: Numeral[] } {
  const out = [...numerals]
  const added: Numeral[] = []
  for (const b of bodies) {
    if (out.some((n) => 'body' in n.target && !('at' in n.target) && (n.target.id === b.id || n.target.body === b.name))) continue
    const nm: Numeral = { n: nextNumeral(out, s), label: b.name, auto: true, target: { body: b.name, id: b.id } }
    out.push(nm)
    added.push(nm)
  }
  return { numerals: out, added }
}

/** Bodies renamed since: their numerals follow, and the auto labels with them. */
export function syncBodies(numerals: Numeral[], bodies: BodyInfo[]): { numerals: Numeral[]; renamed: { n: number; from: string; to: string }[]; lost: number[] } {
  const byId = new Map(bodies.map((b) => [b.id, b]))
  const names = new Set(bodies.map((b) => b.name))
  const renamed: { n: number; from: string; to: string }[] = []
  const lost: number[] = []
  const out = numerals.map((nm) => {
    const t = nm.target
    if ('at' in t) return nm
    const b = t.id !== undefined ? byId.get(t.id) : undefined
    if (b && b.name !== t.body) {
      renamed.push({ n: nm.n, from: t.body, to: b.name })
      return { ...nm, label: nm.auto ? b.name : nm.label, target: { body: b.name, id: b.id } }
    }
    if (!b && !names.has(t.body)) lost.push(nm.n)
    return nm
  })
  return { numerals: out, renamed, lost }
}

/** Numbers them again from the start, in order; returns old → new. */
export function renumber(numerals: Numeral[], s: Pick<PatentSettings, 'numeralStart' | 'numeralStep'>): { numerals: Numeral[]; map: Map<number, number> } {
  const sorted = [...numerals].sort((a, b) => a.n - b.n)
  const map = new Map<number, number>()
  const out = sorted.map((nm, i) => {
    const n = s.numeralStart + i * s.numeralStep
    map.set(nm.n, n)
    return { ...nm, n }
  })
  return { numerals: out, map }
}

/** The text with its numeral tokens moved to their new numbers. */
export function retoken(text: string, map: Map<number, number>): string {
  return text.replace(/\[\[(\d+)(#?)\]\]/g, (all, n: string, bare: string) => (map.has(Number(n)) ? `[[${map.get(Number(n))}${bare}]]` : all))
}
