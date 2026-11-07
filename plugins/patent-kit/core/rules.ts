// SPDX-License-Identifier: AGPL-3.0-only
// A checklist against 37 CFR 1.84, the USPTO's rules for drawings. A
// target, not a guarantee: each line says what it looked at, and the
// attorney judges.

import { nearestOn } from '../../_shared/lineart/hlr'
import { textWidth } from '../../_shared/lineart/sheet'
import { MARGIN, PAPER, segmentsCross, type Layout } from './layout'
import { numeralsIn } from './draft'
import type { Figure, Numeral, Section } from './model'

export interface Finding {
  rule: string
  level: 'error' | 'warn' | 'note'
  ok: boolean
  message: string
  figure?: number
  sheet?: number
}

export function check(l: Layout, figures: Figure[], numerals: Numeral[], draft: Partial<Record<Section, string>>, missed: { figure: number; n: number; why: string }[]): Finding[] {
  const out: Finding[] = []
  const s = l.settings
  const paper = PAPER[s.paper]
  const push = (f: Finding) => out.push(f)
  push({ rule: '1.84(f)', level: 'error', ok: true, message: `Sheets are ${s.paper === 'letter' ? '21.6 × 27.9 cm (letter)' : '21.0 × 29.7 cm (A4)'}, one of the two sizes allowed.` })
  l.extents.forEach((e, i) => {
    const inside = e.minX >= MARGIN.left - 0.01 && e.minY >= MARGIN.top - 0.01 && e.maxX <= paper.w - MARGIN.right + 0.01 && e.maxY <= paper.h - MARGIN.bottom + 0.01
    push({ rule: '1.84(g)', level: 'error', ok: inside, sheet: i + 1, message: inside ? `Sheet ${i + 1}: everything is inside the margins (top and left 2.5 cm, right 1.5 cm, bottom 1.0 cm).` : `Sheet ${i + 1}: something crosses a margin (marks span ${e.minX.toFixed(1)}–${e.maxX.toFixed(1)} × ${e.minY.toFixed(1)}–${e.maxY.toFixed(1)} mm).` })
  })
  const tinted = l.sheets.flatMap((sh, i) => (sh.marks.some((m) => (m.rgb && m.rgb.toLowerCase() !== '#000000') || ('grey' in m && m.grey)) ? [i + 1] : []))
  push({ rule: '1.84(a),(m)', level: 'error', ok: !tinted.length, message: tinted.length ? `Sheet ${tinted.join(', ')}: something is in colour or grey; the drawings must be black on white.` : 'Black lines on white only: no colour, grey or shading.' })
  const numOk = s.numeralMm >= 3.2
  push({ rule: '1.84(p)(3)', level: 'error', ok: numOk, message: numOk ? `Reference numerals are ${s.numeralMm} mm high (3.2 mm, 1/8 inch, or more).` : `Reference numerals are ${s.numeralMm} mm high; they must be at least 3.2 mm (1/8 inch). patent.settings { numeralMm: 3.5 }.` })
  const figOk = s.figLabelMm > s.numeralMm
  push({ rule: '1.84(u)(2)', level: 'error', ok: figOk, message: figOk ? `"FIG." labels (${s.figLabelMm} mm) are larger than the numerals.` : `"FIG." labels (${s.figLabelMm} mm) must be larger than the numerals (${s.numeralMm} mm).` })
  push({ rule: '1.84(u)(1)', level: 'error', ok: true, message: `Figures are numbered FIG. 1 to FIG. ${figures.length} in order.` })
  if (l.sheets.length > 1) push({ rule: '1.84(t)', level: 'error', ok: figOk, message: `Sheets are numbered 1/${l.sheets.length} to ${l.sheets.length}/${l.sheets.length} at the top centre, larger than the numerals.` })
  let crossings = 0
  for (let i = 0; i < l.leaders.length; i++)
    for (let j = i + 1; j < l.leaders.length; j++) {
      const a = l.leaders[i]
      const b = l.leaders[j]
      if (a.figure === b.figure && segmentsCross(a.line, b.line)) {
        crossings++
        push({ rule: '1.84(q)', level: 'warn', ok: false, figure: a.figure, message: `FIG. ${a.figure}: the lead lines of ${a.n} and ${b.n} cross.` })
      }
    }
  for (const a of l.leaders)
    for (const b of l.leaders) {
      if (a === b || a.figure !== b.figure) continue
      const { x, y, w, h } = b.box
      const edges: [number, number, number, number][] = [
        [x, y, x + w, y],
        [x + w, y, x + w, y + h],
        [x + w, y + h, x, y + h],
        [x, y + h, x, y],
      ]
      if (edges.some((e) => segmentsCross(a.line, e))) push({ rule: '1.84(q)', level: 'warn', ok: false, figure: a.figure, message: `FIG. ${a.figure}: the lead line of ${a.n} runs through numeral ${b.n}.` })
    }
  if (crossings === 0 && l.leaders.length) push({ rule: '1.84(q)', level: 'warn', ok: true, message: 'No lead lines cross.' })
  for (const a of l.leaders) {
    const len = Math.hypot(a.line[2] - a.line[0], a.line[3] - a.line[1])
    if (len > 60) push({ rule: '1.84(q)', level: 'note', ok: false, figure: a.figure, message: `FIG. ${a.figure}: the lead line of ${a.n} is ${len.toFixed(0)} mm; lead lines should be as short as possible. A point target (patent.numerals at) nearer the edge shortens it.` })
    const p = l.placements.find((x) => x.figure === a.figure)
    const near = p ? nearestOn(p.lines, [a.line[2], a.line[3]]) : null
    if (!near || near.d > 0.5) push({ rule: '1.84(q)', level: 'warn', ok: false, figure: a.figure, message: `FIG. ${a.figure}: the lead line of ${a.n} may not end on the part.` })
  }
  for (const p of l.placements) {
    if (p.scale === 0) {
      push({ rule: '1.84(h)', level: 'error', ok: false, figure: p.figure, message: `FIG. ${p.figure} draws nothing: none of its bodies are there, or the section misses them.` })
      continue
    }
    const at23 = p.shortestEdge * (2 / 3)
    if (at23 < 0.8) push({ rule: '1.84(k)(1)', level: 'warn', ok: false, figure: p.figure, message: `FIG. ${p.figure}: its shortest edge comes to ${at23.toFixed(2)} mm at a 2/3 reduction; add an enlarged partial view (a figure of the detail alone) if it matters.` })
    const f = figures[p.figure - 1]
    if (f.kind === 'section') {
      push({ rule: '1.84(h)(3)', level: 'error', ok: p.hatched, figure: p.figure, message: p.hatched ? `FIG. ${p.figure}: the cut faces are hatched with oblique parallel lines.` : `FIG. ${p.figure}: the section found no cut face to hatch.` })
      const from = f.section?.from ? figures.findIndex((g) => g.id === f.section!.from) + 1 : 0
      const drawn = from > 0 && l.placements.find((x) => x.figure === from)?.cutsDrawn.includes(f.id)
      push({
        rule: '1.84(h)(3)',
        level: 'warn',
        ok: Boolean(drawn),
        figure: p.figure,
        message: drawn ? `FIG. ${p.figure}: the cut is shown on FIG. ${from} as a broken line, its ends marked ${p.figure} with arrows the way it is seen.` : from ? `FIG. ${p.figure}: FIG. ${from} looks along the cut, so the cut line can't be shown there; take the section from a view across it.` : `FIG. ${p.figure}: name the figure it is taken from (section.from), so the cut is shown there.`,
      })
    }
    if (p.bracketed) push({ rule: '1.84(h)(1)', level: 'note', ok: true, figure: p.figure, message: `FIG. ${p.figure} is exploded and shares its sheet, so it is put in brackets.` })
  }
  for (const m of missed) push({ rule: '1.84(p)(5)', level: 'note', ok: false, figure: m.figure, message: `FIG. ${m.figure}: ${m.n} is not shown — ${m.why}.` })
  const shown = new Set(l.leaders.map((x) => x.n))
  const said = numeralsIn(draft)
  for (const n of shown) if (!said.has(n)) push({ rule: '1.84(p)(5)', level: 'warn', ok: false, message: `${n} is in the drawings but not in the description.` })
  for (const n of said) if (!shown.has(n)) push({ rule: '1.84(p)(5)', level: 'warn', ok: false, message: `${n} is in the description but in no drawing.` })
  for (const nm of numerals) if (!shown.has(nm.n) && !said.has(nm.n)) push({ rule: '1.84(p)(4)', level: 'note', ok: false, message: `${nm.n} (${nm.label}) is in neither the drawings nor the description.` })
  const byLabel = new Map<string, number[]>()
  for (const nm of numerals) byLabel.set(nm.label.toLowerCase(), [...(byLabel.get(nm.label.toLowerCase()) ?? []), nm.n])
  for (const [label, ns] of byLabel) if (ns.length > 1) push({ rule: '1.84(p)(4)', level: 'warn', ok: false, message: `"${label}" has ${ns.length} numerals (${ns.join(', ')}); the same part takes the same numeral, different parts different ones.` })
  if (s.hidden === 'dashed') push({ rule: '1.84(l)', level: 'note', ok: true, message: 'Hidden lines are drawn as broken lines; many attorneys leave them out to keep figures clean.' })
  const widest = Math.max(0, ...l.leaders.map((x) => textWidth(String(x.n), s.numeralMm)))
  if (widest > 0) push({ rule: '1.84(p)(1)', level: 'note', ok: true, message: 'Numerals are plain, not circled, bracketed or in quotes.' })
  return out
}
