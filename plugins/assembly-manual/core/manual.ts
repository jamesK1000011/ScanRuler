// SPDX-License-Identifier: AGPL-3.0-only
// The manual's pages: a cover with the bill of materials, then a page a
// step — its drawing, the parts and tools it takes, and its instructions —
// as sheets (SVG, PDF, PNG), and the whole as one self-contained HTML file
// laid out for a screen and for print. The theme (themes.ts) sets the
// accent and balloons on the sheets and the type, colours and layout of the
// HTML.

import { boxOf } from '../../_shared/lineart/hlr'
import { textWidth, type Mark, type Sheet } from '../../_shared/lineart/sheet'
import { bom, itemOf, type BomRow } from './assembly'
import type { StepDrawing } from './geometry'
import type { AsmSettings, Part, Step } from './model'
import { sheetAccent, themeOf, type Theme } from './themes'

const PAPER = { letter: { w: 215.9, h: 279.4 }, a4: { w: 210, h: 297 } }
const M = 12

export function pageSize(s: AsmSettings) {
  const p = PAPER[s.paper]
  return s.orientation === 'landscape' ? { w: p.h, h: p.w } : p
}

/** Lines of text no wider than w at cap height h. */
export function wrap(text: string, h: number, w: number): string[] {
  const out: string[] = []
  for (const para of text.split(/\n+/)) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (line && textWidth(next, h) > w) {
        out.push(line)
        line = word
      } else line = next
    }
    if (line) out.push(line)
  }
  return out
}

const circle = (cx: number, cy: number, r: number): number[] => {
  const pts: number[] = []
  for (let i = 0; i <= 32; i++) pts.push(cx + r * Math.cos((i / 32) * 2 * Math.PI), cy + r * Math.sin((i / 32) * 2 * Math.PI))
  return pts
}

function balloon(marks: Mark[], cx: number, cy: number, n: number, t: Theme) {
  const rgb = sheetAccent(t)
  if (t.balloon === 'filled') {
    marks.push({ k: 'fill', pts: circle(cx, cy, 3.6), rgb })
    marks.push({ k: 'text', x: cx, y: cy + 1.3, h: 2.6, text: String(n), anchor: 'middle', rgb: '#ffffff', bold: true })
  } else {
    marks.push({ k: 'line', pts: circle(cx, cy, 3.6), w: 0.3, rgb })
    marks.push({ k: 'text', x: cx, y: cy + 1.3, h: 2.6, text: String(n), anchor: 'middle', rgb })
  }
}

/** A step's number at the head of its page, as the theme stands it. */
function stepHead(marks: Mark[], i: number, t: Theme) {
  const rgb = sheetAccent(t)
  if (t.badge === 'box') {
    marks.push({ k: 'fill', pts: [M, M - 1, M + 13, M - 1, M + 13, M + 11, M, M + 11], rgb })
    marks.push({ k: 'text', x: M + 6.5, y: M + 8, h: 6.5, text: String(i + 1), anchor: 'middle', rgb: '#ffffff', bold: true })
    marks.push({ k: 'text', x: M + 17, y: M + 8, h: 5, text: 'Step', bold: true })
  } else if (t.badge === 'big') {
    marks.push({ k: 'text', x: M, y: M + 13, h: 13, text: String(i + 1), bold: true, rgb })
  } else {
    marks.push({ k: 'text', x: M, y: M + 7, h: 7, text: `Step ${i + 1}`, rgb })
  }
}

export function cover(parts: Part[], steps: Step[], s: AsmSettings): Sheet {
  const t = themeOf(s)
  const { w, h } = pageSize(s)
  const marks: Mark[] = []
  marks.push({ k: 'fill', pts: [M, M - 2, M + 30, M - 2, M + 30, M - 0.8, M, M - 0.8], rgb: sheetAccent(t) })
  marks.push({ k: 'text', x: M, y: M + 8, h: 8, text: s.title, bold: true })
  marks.push({ k: 'text', x: M, y: M + 18, h: 3.5, text: `${steps.length} step${steps.length === 1 ? '' : 's'}, ${parts.length} part${parts.length === 1 ? '' : 's'}` })
  marks.push({ k: 'text', x: M, y: M + 32, h: 5, text: 'Bill of materials', bold: true, rgb: sheetAccent(t) })
  const cols = [M, M + 14, M + 26, M + 96, M + 160]
  const heads = ['Item', 'Qty', 'Name', 'Designation', 'Source']
  let y = M + 42
  heads.forEach((x, i) => marks.push({ k: 'text', x: cols[i], y, h: 3, text: x, bold: true }))
  marks.push({ k: 'line', pts: [M, y + 2, w - M, y + 2], w: 0.3 })
  for (const r of bom(parts)) {
    y += 7
    if (y > h - M) break
    const cells = ['', String(r.qty), r.name, r.designation ?? '', r.source ?? '']
    balloon(marks, cols[0] + 3.6, y - 1.3, r.item, t)
    cells.forEach((t, i) => {
      const room = (cols[i + 1] ?? w - M) - cols[i] - 2
      let txt = t
      while (txt.length > 1 && textWidth(txt, 3) > room) txt = txt.slice(0, -2) + '…'
      marks.push({ k: 'text', x: cols[i], y, h: 3, text: txt })
    })
  }
  return { w, h, marks }
}

/** A step's drawing fitted into area: the parts in place in grey, the
 *  step's own in black, their paths in and a balloon on each new item. */
function drawFigure(marks: Mark[], d: StepDrawing | undefined, parts: Part[], area: { x: number; y: number; w: number; h: number }, t: Theme) {
  const lines = d?.lines ?? []
  if (!lines.length) return
  const accent = sheetAccent(t)
  const b = boxOf(lines.map((l) => l.pts))
  const bw = Math.max(b.maxX - b.minX, 1e-6)
  const bh = Math.max(b.maxY - b.minY, 1e-6)
  const sc = Math.min(area.w / bw, area.h / bh)
  const ox = area.x + (area.w - bw * sc) / 2
  const oy = area.y + (area.h - bh * sc) / 2
  const X = (x: number) => ox + (x - b.minX) * sc
  const Y = (y: number) => oy + (b.maxY - y) * sc
  for (const l of lines) marks.push({ k: 'line', pts: l.pts.map((v, j) => (j % 2 === 0 ? X(v) : Y(v))), w: l.fresh ? 0.4 : 0.25, ...(l.fresh ? {} : { grey: 0.6 }) })
  const c: [number, number] = [ox + (bw * sc) / 2, oy + (bh * sc) / 2]
  const taken: [number, number][] = []
  const ballooned = new Set<number>()
  for (const p of d!.paths) {
    const a: [number, number] = [X(p.from[0]), Y(p.from[1])]
    const z: [number, number] = [X(p.to[0]), Y(p.to[1])]
    const len = Math.hypot(z[0] - a[0], z[1] - a[1])
    if (len > 4) {
      const u = [(z[0] - a[0]) / len, (z[1] - a[1]) / len]
      const s0: [number, number] = [a[0] + u[0] * len * 0.3, a[1] + u[1] * len * 0.3]
      const s1: [number, number] = [a[0] + u[0] * len * 0.92, a[1] + u[1] * len * 0.92]
      marks.push({ k: 'line', pts: [...s0, ...s1], w: 0.25, dash: [3, 1.2, 0.6, 1.2], rgb: accent })
      const side = [-u[1], u[0]]
      marks.push({ k: 'fill', pts: [s1[0] + u[0] * 2.4, s1[1] + u[1] * 2.4, s1[0] + side[0] * 1.1, s1[1] + side[1] * 1.1, s1[0] - side[0] * 1.1, s1[1] - side[1] * 1.1], rgb: accent })
    }
    const item = itemOf(parts, p.part)
    if (!item || ballooned.has(item)) continue
    ballooned.add(item)
    const an: [number, number] = [X(p.anchor[0]), Y(p.anchor[1])]
    let dir = Math.atan2(an[1] - c[1], an[0] - c[0])
    let at: [number, number] = [0, 0]
    for (let k = 0; k < 18; k++) {
      at = [an[0] + Math.cos(dir) * 14, an[1] + Math.sin(dir) * 14]
      at = [Math.min(Math.max(at[0], area.x), area.x + area.w + 8), Math.min(Math.max(at[1], area.y - 4), area.y + area.h + 4)]
      if (taken.every((q) => Math.hypot(q[0] - at[0], q[1] - at[1]) > 9)) break
      dir += Math.PI / 9
    }
    taken.push(at)
    const l = Math.hypot(an[0] - at[0], an[1] - at[1]) || 1
    marks.push({ k: 'line', pts: [at[0] + ((an[0] - at[0]) / l) * 3.6, at[1] + ((an[1] - at[1]) / l) * 3.6, an[0], an[1]], w: 0.2 })
    marks.push({ k: 'fill', pts: circle(an[0], an[1], 0.5) })
    balloon(marks, at[0], at[1], item, t)
  }
}

/** The drawing alone, for the HTML: the page has its own words. */
export function stepFigure(d: StepDrawing | undefined, parts: Part[], s: AsmSettings): Sheet {
  const w = 200
  const h = 130
  const marks: Mark[] = []
  drawFigure(marks, d, parts, { x: 10, y: 10, w: w - 28, h: h - 20 }, themeOf(s))
  return { w, h, marks }
}

export function stepPage(i: number, step: Step, d: StepDrawing | undefined, parts: Part[], total: number, s: AsmSettings): Sheet {
  const t = themeOf(s)
  const { w, h } = pageSize(s)
  const marks: Mark[] = []
  stepHead(marks, i, t)
  marks.push({ k: 'text', x: w - M, y: M + 5, h: 3.5, text: `${i + 1} / ${total}`, anchor: 'end' })
  const textLines = wrap(step.text ?? '', 3.5, w - 2 * M)
  const textTop = h - M - textLines.length * 6.5
  const area = { x: M + 6, y: M + 18, w: w * 0.64 - M - 12, h: Math.max(40, textTop - M - 26) }
  drawFigure(marks, d, parts, area, t)
  const col = w * 0.64 + 2
  let y = M + 22
  marks.push({ k: 'text', x: col, y, h: 4, text: 'Parts', bold: true })
  const rows = new Map<number, { n: number; row: BomRow | undefined }>()
  const all = bom(parts)
  for (const pl of step.place) {
    const item = itemOf(parts, pl.part)
    const r = rows.get(item) ?? { n: 0, row: all.find((x) => x.item === item) }
    r.n += parts.find((p) => p.name === pl.part)?.qty ?? 1
    rows.set(item, r)
  }
  for (const [item, r] of rows) {
    y += 10
    balloon(marks, col + 4, y - 1.3, item, t)
    const label = `${r.n} × ${r.row?.name ?? '?'}`
    marks.push({ k: 'text', x: col + 10, y, h: 3, text: label })
    if (r.row?.designation) marks.push({ k: 'text', x: col + 10, y: y + 4.5, h: 2.6, text: r.row.designation })
  }
  if (step.tools?.length) {
    y += 14
    marks.push({ k: 'text', x: col, y, h: 4, text: 'Tools', bold: true })
    for (const tool of step.tools) {
      y += 6
      marks.push({ k: 'text', x: col + 2, y, h: 3, text: tool })
    }
  }
  if (step.torque) {
    y += 10
    marks.push({ k: 'text', x: col, y, h: 3, text: `Torque: ${step.torque}` })
  }
  if (step.notes) for (const line of wrap(step.notes, 2.8, w - col - M)) marks.push({ k: 'text', x: col, y: (y += 6), h: 2.8, text: line })
  if (textLines.length) marks.push({ k: 'line', pts: [M, textTop - 1.5, w - M, textTop - 1.5], w: 0.2, grey: 0.75 })
  textLines.forEach((t, j) => marks.push({ k: 'text', x: M, y: textTop + 4 + j * 6.5, h: 3.5, text: t }))
  return { w, h, marks }
}

