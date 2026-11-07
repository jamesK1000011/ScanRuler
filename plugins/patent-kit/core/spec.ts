// SPDX-License-Identifier: AGPL-3.0-only
// The draft laid out as a specification the way 37 CFR 1.52 and 1.77 ask:
// portrait letter or A4, margins of at least 2.0 cm top, right and bottom
// and 2.5 cm left, one column, lines 1½ spaced, capitals 3.2 mm high, the
// pages numbered from 1 below the text, the paragraphs [0001] on in bold —
// not the claims or the abstract — the claims and the abstract each from a
// new page, the abstract 150 words at most. As sheets, so the PDF writer the
// drawings use writes it too. A draft for an attorney: the top margin says
// so.

import { textWidth, type Mark, type Sheet } from '../../_shared/lineart/sheet'
import { briefDescription, expand } from './draft'
import { DRAFT_MARK, type Figure, type Numeral, type PatentSettings, type Section } from './model'

const PAPER = { letter: { w: 215.9, h: 279.4 }, a4: { w: 210, h: 297 } }

/** 1.52(a)(1)(ii) margins, with a little to spare. */
export const SPEC_MARGIN = { top: 25, left: 27, right: 22, bottom: 25 }
/** Capitals 3.2 mm: 1.52(b)(2)(ii) asks at least 0.3175 cm. */
const CAP = 3.2
const FONT = CAP / 0.718
/** 1½ spacing: one and a half single lines of 1.2 × the type size. */
const LINE = FONT * 1.2 * 1.5
const GAP = '    '

export interface SpecFinding {
  rule: string
  level: 'error' | 'warn' | 'note'
  message: string
}

const HEADINGS: Partial<Record<Section, string>> = {
  field: 'TECHNICAL FIELD',
  background: 'BACKGROUND',
  summary: 'SUMMARY',
  drawings: 'BRIEF DESCRIPTION OF THE DRAWINGS',
  detailed: 'DETAILED DESCRIPTION',
}

/** Words to lines no wider than w; the first line `first` mm narrower. */
function wrap(text: string, w: number, first = 0): string[] {
  const out: string[] = []
  let line = ''
  let room = w - first
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && textWidth(next, CAP) > room) {
      out.push(line)
      line = word
      room = w
    } else line = next
  }
  if (line) out.push(line)
  return out
}

const paragraphs = (text: string) =>
  text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

const words = (text: string) => text.split(/\s+/).filter(Boolean).length

export function specification(draft: Partial<Record<Section, string>>, numerals: Numeral[], figures: Figure[], s: PatentSettings): { sheets: Sheet[]; findings: SpecFinding[]; paragraphs: number } {
  const { w, h } = PAPER[s.paper]
  const M = SPEC_MARGIN
  const width = w - M.left - M.right
  const sheets: Sheet[] = []
  const findings: SpecFinding[] = []
  let marks: Mark[] = []
  let y = 0
  let n = 0

  const newPage = () => {
    marks = []
    sheets.push({ w, h, marks })
    marks.push({ k: 'text', x: w / 2, y: 12, h: 2.2, text: `${DRAFT_MARK} — not for filing as is`, anchor: 'middle', rgb: '#777777' })
    y = M.top + CAP
  }
  const room = (lines: number) => {
    if (y + (lines - 1) * LINE > h - M.bottom) newPage()
  }
  const heading = (text: string) => {
    room(3)
    if (y > M.top + CAP) y += LINE * 0.5
    marks.push({ k: 'text', x: w / 2, y, h: CAP, text, anchor: 'middle', bold: true })
    y += LINE * 1.5
  }
  const para = (text: string, numbered: boolean) => {
    const tag = numbered ? `[${String(++n).padStart(4, '0')}]` : ''
    const lead = numbered ? textWidth(tag + GAP, CAP) : 0
    const lines = wrap(text, width, lead)
    room(Math.min(2, lines.length))
    lines.forEach((line, i) => {
      if (y > h - M.bottom) newPage()
      if (i === 0 && numbered) marks.push({ k: 'text', x: M.left, y, h: CAP, text: tag, bold: true })
      marks.push({ k: 'text', x: M.left + (i === 0 ? lead : 0), y, h: CAP, text: line })
      y += LINE
    })
    y += LINE * 0.35
  }

  newPage()
  const title = draft.title ? expand(draft.title, numerals).trim() : ''
  if (!title) findings.push({ rule: '1.72(a)', level: 'warn', message: 'No title yet: the specification begins with the title of the invention.' })
  for (const line of wrap((title || 'Untitled invention').toUpperCase(), width)) {
    marks.push({ k: 'text', x: w / 2, y, h: CAP, text: line, anchor: 'middle', bold: true })
    y += LINE
  }
  y += LINE

  for (const sec of ['field', 'background', 'summary', 'drawings', 'detailed'] as const) {
    const text = sec === 'drawings' ? (draft.drawings ?? (figures.length ? briefDescription(figures, s.title) : '')) : draft[sec]
    if (!text?.trim()) {
      if (sec === 'detailed' || sec === 'drawings') findings.push({ rule: '1.77(b)', level: 'warn', message: `No ${HEADINGS[sec]!.toLowerCase()} yet.` })
      continue
    }
    heading(HEADINGS[sec]!)
    for (const p of paragraphs(expand(text, numerals))) para(p, true)
  }

  const claims = draft.claims?.trim() ? expand(draft.claims, numerals) : ''
  newPage()
  heading('CLAIMS')
  marks.push({ k: 'text', x: M.left, y, h: CAP, text: 'What is claimed is:' })
  y += LINE * 1.35
  if (claims) for (const p of paragraphs(claims)) para(p, false)
  else {
    findings.push({ rule: '1.75', level: 'warn', message: 'No claims yet: the page is left for the attorney to write them.' })
    para('[Claims to be written with your patent attorney.]', false)
  }

  const abstract = draft.abstract?.trim() ? expand(draft.abstract, numerals) : ''
  newPage()
  heading('ABSTRACT')
  if (abstract) {
    const count = words(abstract)
    if (count > 150) findings.push({ rule: '1.72(b)', level: 'error', message: `The abstract is ${count} words; it may be at most 150.` })
    for (const p of paragraphs(abstract)) para(p, false)
  } else findings.push({ rule: '1.72(b)', level: 'warn', message: 'No abstract yet.' })

  sheets.forEach((sheet, i) => sheet.marks.push({ k: 'text', x: w / 2, y: h - M.bottom + 11, h: CAP * 0.85, text: String(i + 1), anchor: 'middle' }))
  return { sheets, findings, paragraphs: n }
}
