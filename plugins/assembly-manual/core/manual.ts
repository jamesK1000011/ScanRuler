// SPDX-License-Identifier: AGPL-3.0-only
// The manual's pages: a cover with the bill of materials, then a page a
// step — its drawing, the parts and tools it takes, and its instructions —
// as sheets (SVG, PDF, PNG), and the whole as one self-contained HTML file.

import { boxOf } from '../../_shared/lineart/hlr'
import { textWidth, toSvg, type Mark, type Sheet } from '../../_shared/lineart/sheet'
import { bom, itemOf, type BomRow } from './assembly'
import type { StepDrawing } from './geometry'
import type { AsmSettings, Part, Step } from './model'

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

function balloon(marks: Mark[], cx: number, cy: number, n: number) {
  marks.push({ k: 'line', pts: circle(cx, cy, 3.6), w: 0.3 })
  marks.push({ k: 'text', x: cx, y: cy + 1.3, h: 2.6, text: String(n), anchor: 'middle' })
}

export function cover(parts: Part[], steps: Step[], s: AsmSettings): Sheet {
  const { w, h } = pageSize(s)
  const marks: Mark[] = []
  marks.push({ k: 'text', x: M, y: M + 8, h: 8, text: s.title })
  marks.push({ k: 'text', x: M, y: M + 18, h: 3.5, text: `${steps.length} step${steps.length === 1 ? '' : 's'}, ${parts.length} part${parts.length === 1 ? '' : 's'}` })
  marks.push({ k: 'text', x: M, y: M + 32, h: 5, text: 'Bill of materials' })
  const cols = [M, M + 14, M + 26, M + 96, M + 160]
  const heads = ['Item', 'Qty', 'Name', 'Designation', 'Source']
  let y = M + 42
  heads.forEach((t, i) => marks.push({ k: 'text', x: cols[i], y, h: 3, text: t }))
  marks.push({ k: 'line', pts: [M, y + 2, w - M, y + 2], w: 0.3 })
  for (const r of bom(parts)) {
    y += 7
    if (y > h - M) break
    const cells = [String(r.item), String(r.qty), r.name, r.designation ?? '', r.source ?? '']
    cells.forEach((t, i) => {
      const room = (cols[i + 1] ?? w - M) - cols[i] - 2
      let txt = t
      while (txt.length > 1 && textWidth(txt, 3) > room) txt = txt.slice(0, -2) + '…'
      marks.push({ k: 'text', x: cols[i], y, h: 3, text: txt })
    })
  }
  return { w, h, marks }
}

export function stepPage(i: number, step: Step, d: StepDrawing | undefined, parts: Part[], total: number, s: AsmSettings): Sheet {
  const { w, h } = pageSize(s)
  const marks: Mark[] = []
  marks.push({ k: 'text', x: M, y: M + 7, h: 7, text: `Step ${i + 1}` })
  marks.push({ k: 'text', x: w - M, y: M + 5, h: 3.5, text: `${i + 1} / ${total}`, anchor: 'end' })
  const textLines = wrap(step.text ?? '', 3.5, w - 2 * M)
  const textTop = h - M - textLines.length * 6.5
  const area = { x: M + 6, y: M + 18, w: w * 0.64 - M - 12, h: Math.max(40, textTop - M - 26) }
  const lines = d?.lines ?? []
  if (lines.length) {
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
        marks.push({ k: 'line', pts: [...s0, ...s1], w: 0.25, dash: [3, 1.2, 0.6, 1.2] })
        const side = [-u[1], u[0]]
        marks.push({ k: 'fill', pts: [s1[0] + u[0] * 2.4, s1[1] + u[1] * 2.4, s1[0] + side[0] * 1.1, s1[1] + side[1] * 1.1, s1[0] - side[0] * 1.1, s1[1] - side[1] * 1.1] })
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
        if (taken.every((t) => Math.hypot(t[0] - at[0], t[1] - at[1]) > 9)) break
        dir += Math.PI / 9
      }
      taken.push(at)
      const l = Math.hypot(an[0] - at[0], an[1] - at[1]) || 1
      marks.push({ k: 'line', pts: [at[0] + ((an[0] - at[0]) / l) * 3.6, at[1] + ((an[1] - at[1]) / l) * 3.6, an[0], an[1]], w: 0.2 })
      marks.push({ k: 'fill', pts: circle(an[0], an[1], 0.5) })
      balloon(marks, at[0], at[1], item)
    }
  }
  const col = w * 0.64 + 2
  let y = M + 22
  marks.push({ k: 'text', x: col, y, h: 4, text: 'Parts' })
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
    balloon(marks, col + 4, y - 1.3, item)
    const label = `${r.n} × ${r.row?.name ?? '?'}`
    marks.push({ k: 'text', x: col + 10, y, h: 3, text: label })
    if (r.row?.designation) marks.push({ k: 'text', x: col + 10, y: y + 4.5, h: 2.6, text: r.row.designation })
  }
  if (step.tools?.length) {
    y += 14
    marks.push({ k: 'text', x: col, y, h: 4, text: 'Tools' })
    for (const t of step.tools) {
      y += 6
      marks.push({ k: 'text', x: col + 2, y, h: 3, text: t })
    }
  }
  if (step.torque) {
    y += 10
    marks.push({ k: 'text', x: col, y, h: 3, text: `Torque: ${step.torque}` })
  }
  if (step.notes) for (const line of wrap(step.notes, 2.8, w - col - M)) marks.push({ k: 'text', x: col, y: (y += 6), h: 2.8, text: line })
  textLines.forEach((t, j) => marks.push({ k: 'text', x: M, y: textTop + 4 + j * 6.5, h: 3.5, text: t }))
  return { w, h, marks }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function html(title: string, parts: Part[], steps: Step[], pages: Sheet[]): string {
  const rows = bom(parts)
    .map((r) => `<tr><td>${r.item}</td><td>${r.qty}</td><td>${esc(r.name)}</td><td>${esc(r.designation ?? '')}</td><td>${esc(r.source ?? '')}</td></tr>`)
    .join('\n')
  const sections = steps
    .map((s, i) => `<section><h2>Step ${i + 1}</h2>\n<div class="page">${toSvg(pages[i]).replace(/ width="[^"]*mm" height="[^"]*mm"/, '')}</div>\n${s.text ? `<p>${esc(s.text)}</p>` : ''}</section>`)
    .join('\n')
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Helvetica,Arial,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#000}table{border-collapse:collapse}td,th{border-bottom:1px solid #999;padding:.3rem .8rem;text-align:left}.page svg{width:100%;height:auto;border:1px solid #ccc}section{page-break-before:always;margin-top:2rem}</style>
</head><body>
<h1>${esc(title)}</h1>
<h2>Bill of materials</h2>
<table><thead><tr><th>Item</th><th>Qty</th><th>Name</th><th>Designation</th><th>Source</th></tr></thead><tbody>
${rows}
</tbody></table>
${sections}
</body></html>
`
}
