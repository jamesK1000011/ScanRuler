// SPDX-License-Identifier: AGPL-3.0-only
// The draft text. Numerals are written as tokens, [[10]] for "housing 10"
// and [[10#]] for the bare 10, so renaming a part rewrites every paragraph
// that names it. Nothing here leaves the project.

import { DRAFT_MARK, SECTIONS, type Figure, type Numeral, type Section } from './model'

const TOKEN = /\[\[(\d+)(#?)\]\]/g

/** Numerals the text names, as tokens or as a bare number after a word. */
export function numeralsIn(draft: Partial<Record<Section, string>>): Set<number> {
  const out = new Set<number>()
  for (const [key, text] of Object.entries(draft)) {
    if (!text || key === 'drawings' || key === 'claims' || key === 'title') continue
    for (const m of text.matchAll(TOKEN)) out.add(Number(m[1]))
  }
  return out
}

/** Tokens that name no numeral. */
export function unknownTokens(text: string, numerals: Numeral[]): number[] {
  const known = new Set(numerals.map((n) => n.n))
  return [...new Set([...text.matchAll(TOKEN)].map((m) => Number(m[1])))].filter((n) => !known.has(n))
}

export function expand(text: string, numerals: Numeral[]): string {
  const by = new Map(numerals.map((n) => [n.n, n]))
  return text.replace(TOKEN, (all, n: string, bare: string) => {
    const nm = by.get(Number(n))
    if (!nm) return all
    return bare ? n : `${nm.label} ${n}`
  })
}

const VIEW_WORDS: Record<string, string> = {
  front: 'a front elevation view',
  back: 'a rear elevation view',
  top: 'a top plan view',
  bottom: 'a bottom plan view',
  left: 'a left side elevation view',
  right: 'a right side elevation view',
  iso: 'a perspective view',
  iso_back: 'a rear perspective view',
}

/** The brief description of the drawings, from the figure list. */
export function briefDescription(figures: Figure[], title: string): string {
  return figures
    .map((f, i) => {
      const n = i + 1
      let what: string
      if (f.kind === 'section') {
        const from = f.section?.from ? figures.findIndex((g) => g.id === f.section!.from) + 1 : 0
        what = from ? `a cross-sectional view taken along line ${n}–${n} of FIG. ${from}` : 'a cross-sectional view'
      } else if (f.kind === 'exploded') what = `an exploded ${typeof f.view === 'string' && !f.view.startsWith('iso') ? VIEW_WORDS[f.view].replace(/^an? /, '') : 'perspective view'}`
      else what = typeof f.view === 'string' ? VIEW_WORDS[f.view] : 'a view'
      return `FIG. ${n} is ${what} of ${title}${f.caption ? `, ${f.caption}` : ''}${i === figures.length - 1 ? '.' : ';'}`
    })
    .join('\n')
}

const HEADINGS: Record<Section, string> = {
  title: 'Title',
  field: 'Field',
  background: 'Background',
  summary: 'Summary',
  drawings: 'Brief description of the drawings',
  detailed: 'Detailed description',
  claims: 'Claims (suggested language only)',
  abstract: 'Abstract',
}

/** The whole draft as Markdown, every section marked a draft. */
export function toMarkdown(draft: Partial<Record<Section, string>>, numerals: Numeral[], figures: Figure[], title: string): string {
  const parts = [`# ${draft.title ? expand(draft.title, numerals) : 'Untitled invention'}`, '', `> ${DRAFT_MARK}. Written with an AI assistant from a 3D model and the inventor's notes. Not legal advice. Inventorship is decided by people, not tools.`, '']
  for (const s of SECTIONS) {
    if (s === 'title') continue
    const text = s === 'drawings' ? (draft.drawings ?? briefDescription(figures, title)) : draft[s]
    if (!text) continue
    parts.push(`## ${HEADINGS[s]}`, '', `> ${DRAFT_MARK}`, '', expand(text, numerals), '')
  }
  parts.push('## Reference numerals', '', '| Numeral | Part |', '|---|---|', ...numerals.map((n) => `| ${n.n} | ${n.label} |`), '')
  return parts.join('\n')
}

export function numeralsCsv(numerals: Numeral[]): string {
  return ['numeral,part', ...numerals.map((n) => `${n.n},"${n.label.replace(/"/g, '""')}"`)].join('\n') + '\n'
}
