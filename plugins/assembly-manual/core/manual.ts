// SPDX-License-Identifier: AGPL-3.0-only
// The manual's pages, as sheets (SVG, PDF, PNG): a cover with what the
// product is, its safety information and the bill of materials; a page of
// the hardware at 1:1 if asked; then the steps, laid onto pages one, two,
// four or six at a time or by how much each carries (layout.ts). A step is
// its number, its pictograms, its drawing, the parts it takes (a column at
// the side or a box in the corner), tools and torque, its safety messages
// and its instructions — or no words, for a wordless kit. A sub-assembly's
// steps come framed, the way a kit's callouts are. The theme (themes.ts)
// sets the accent, balloons and badge.

import { boxOf } from '../../_shared/lineart/hlr'
import { textWidth, type Mark, type Sheet } from '../../_shared/lineart/sheet'
import { bom, itemOf, subAssemblies, type BomRow } from './assembly'
import { hardwareOutline, icon, sentences, warningBlock, wrapText } from './extras'
import type { StepDrawing } from './geometry'
import { area, layoutOf, pack, type Frame } from './layout'
import type { AsmSettings, Part, Step } from './model'
import { sheetAccent, themeOf, type Theme } from './themes'

const PAPER = { letter: { w: 215.9, h: 279.4 }, a4: { w: 210, h: 297 } }
const M = 12

export function pageSize(s: AsmSettings) {
  const p = PAPER[s.paper]
  return s.orientation === 'landscape' ? { w: p.h, h: p.w } : p
}

/** Lines of text no wider than w at cap height h. */
export const wrap = wrapText

const circle = (cx: number, cy: number, r: number): number[] => {
  const pts: number[] = []
  for (let i = 0; i <= 32; i++) pts.push(cx + r * Math.cos((i / 32) * 2 * Math.PI), cy + r * Math.sin((i / 32) * 2 * Math.PI))
  return pts
}

const rect = (x: number, y: number, w: number, h: number) => [x, y, x + w, y, x + w, y + h, x, y + h, x, y]

function balloon(marks: Mark[], cx: number, cy: number, n: number, t: Theme, k = 1) {
  const rgb = sheetAccent(t)
  const r = 3.6 * k
  if (t.balloon === 'filled') {
    marks.push({ k: 'fill', pts: circle(cx, cy, r), rgb })
    marks.push({ k: 'text', x: cx, y: cy + 1.3 * k, h: 2.6 * k, text: String(n), anchor: 'middle', rgb: '#ffffff', bold: true })
  } else {
    marks.push({ k: 'line', pts: circle(cx, cy, r), w: 0.3 * k, rgb })
    marks.push({ k: 'text', x: cx, y: cy + 1.3 * k, h: 2.6 * k, text: String(n), anchor: 'middle', rgb })
  }
}

/** A sub-assembly's tag where a part's balloon would be. */
function subTag(marks: Mark[], x: number, y: number, name: string, t: Theme, k = 1) {
  const h = 2.6 * k
  const w = textWidth(name, h) + 4 * k
  marks.push({ k: 'line', pts: rect(x - w / 2, y - 3 * k, w, 6 * k), w: 0.3 * k, rgb: sheetAccent(t) })
  marks.push({ k: 'text', x, y: y + 1.3 * k, h, text: name, anchor: 'middle', rgb: sheetAccent(t), bold: true })
}

/** A step's number, as the theme stands it. Returns its width. */
function stepHead(marks: Mark[], f: Frame, label: string, t: Theme, k: number): number {
  const rgb = sheetAccent(t)
  if (t.badge === 'box') {
    const s = 12 * k
    const wbox = Math.max(s, textWidth(label, 6.5 * k) + 5 * k)
    marks.push({ k: 'fill', pts: [f.x, f.y, f.x + wbox, f.y, f.x + wbox, f.y + s, f.x, f.y + s], rgb })
    marks.push({ k: 'text', x: f.x + wbox / 2, y: f.y + 9 * k, h: 6.5 * k, text: label, anchor: 'middle', rgb: '#ffffff', bold: true })
    return wbox
  }
  if (t.badge === 'big') {
    marks.push({ k: 'text', x: f.x, y: f.y + 13 * k, h: 13 * k, text: label, bold: true, rgb })
    return textWidth(label, 13 * k)
  }
  const text = `Step ${label}`
  marks.push({ k: 'text', x: f.x, y: f.y + 7 * k, h: 7 * k, text, rgb })
  return textWidth(text, 7 * k)
}

/** A step's drawing fitted into area: the parts in place in grey, the
 *  step's own in black, their paths in and a balloon on each new item. */
function drawFigure(marks: Mark[], d: StepDrawing | undefined, parts: Part[], subs: Map<string, string[]>, area: Frame, t: Theme, k = 1) {
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
  const lw = Math.max(0.6, k)
  for (const l of lines) marks.push({ k: 'line', pts: l.pts.map((v, j) => (j % 2 === 0 ? X(v) : Y(v))), w: (l.fresh ? 0.4 : 0.25) * lw, ...(l.fresh ? {} : { grey: 0.6 }) })
  const c: [number, number] = [ox + (bw * sc) / 2, oy + (bh * sc) / 2]
  const taken: [number, number][] = []
  const ballooned = new Set<string>()
  for (const p of d!.paths) {
    const a: [number, number] = [X(p.from[0]), Y(p.from[1])]
    const z: [number, number] = [X(p.to[0]), Y(p.to[1])]
    const len = Math.hypot(z[0] - a[0], z[1] - a[1])
    if (len > 4) {
      const u = [(z[0] - a[0]) / len, (z[1] - a[1]) / len]
      const s0: [number, number] = [a[0] + u[0] * len * 0.3, a[1] + u[1] * len * 0.3]
      const s1: [number, number] = [a[0] + u[0] * len * 0.92, a[1] + u[1] * len * 0.92]
      marks.push({ k: 'line', pts: [...s0, ...s1], w: 0.25 * lw, dash: [3 * lw, 1.2 * lw, 0.6 * lw, 1.2 * lw], rgb: accent })
      const side = [-u[1], u[0]]
      const ah = 2.4 * lw
      marks.push({ k: 'fill', pts: [s1[0] + u[0] * ah, s1[1] + u[1] * ah, s1[0] + side[0] * ah * 0.46, s1[1] + side[1] * ah * 0.46, s1[0] - side[0] * ah * 0.46, s1[1] - side[1] * ah * 0.46], rgb: accent })
    }
    const isSub = subs.has(p.part)
    const item = isSub ? 0 : itemOf(parts, p.part)
    const key = isSub ? `s:${p.part}` : `i:${item}`
    if ((!item && !isSub) || ballooned.has(key)) continue
    ballooned.add(key)
    const an: [number, number] = [X(p.anchor[0]), Y(p.anchor[1])]
    let dir = Math.atan2(an[1] - c[1], an[0] - c[0])
    let at: [number, number] = [0, 0]
    const reach = 14 * k
    for (let n = 0; n < 18; n++) {
      at = [an[0] + Math.cos(dir) * reach, an[1] + Math.sin(dir) * reach]
      at = [Math.min(Math.max(at[0], area.x), area.x + area.w + 8 * k), Math.min(Math.max(at[1], area.y - 4 * k), area.y + area.h + 4 * k)]
      if (taken.every((q) => Math.hypot(q[0] - at[0], q[1] - at[1]) > 9 * k)) break
      dir += Math.PI / 9
    }
    taken.push(at)
    const l = Math.hypot(an[0] - at[0], an[1] - at[1]) || 1
    const r = 3.6 * k
    marks.push({ k: 'line', pts: [at[0] + ((an[0] - at[0]) / l) * r, at[1] + ((an[1] - at[1]) / l) * r, an[0], an[1]], w: 0.2 * lw })
    marks.push({ k: 'fill', pts: circle(an[0], an[1], 0.5 * k) })
    if (isSub) subTag(marks, at[0], at[1], p.part, t, k)
    else balloon(marks, at[0], at[1], item, t, k)
  }
}

/** The drawing alone, for the HTML: the page has its own words. */
export function stepFigure(d: StepDrawing | undefined, parts: Part[], s: AsmSettings, steps: Step[] = []): Sheet {
  const w = 200
  const h = 130
  const marks: Mark[] = []
  drawFigure(marks, d, parts, subAssemblies(steps), { x: 10, y: 10, w: w - 28, h: h - 20 }, themeOf(s))
  return { w, h, marks }
}

/** What a step takes, item by item: a part's BOM row, or a sub-assembly. */
export function takes(step: Step, parts: Part[], subs: Map<string, string[]>) {
  const all = bom(parts)
  const rows = new Map<string, { item: number; n: number; row?: BomRow; sub?: string }>()
  for (const pl of step.place) {
    if (subs.has(pl.part)) {
      rows.set(`s:${pl.part}`, { item: 0, n: 1, sub: pl.part })
      continue
    }
    const item = itemOf(parts, pl.part)
    const r = rows.get(`i:${item}`) ?? { item, n: 0, row: all.find((x) => x.item === item) }
    r.n += parts.find((p) => p.name === pl.part)?.qty ?? 1
    rows.set(`i:${item}`, r)
  }
  return [...rows.values()]
}

/** A step's number as it reads: a sub-assembly's steps by their own
 *  letter and count — A1, A2 — the main ones 1, 2, 3. */
export function stepLabels(steps: Step[]): string[] {
  const subNames = [...new Set(steps.filter((s) => s.sub).map((s) => s.sub!))]
  const count = new Map<string, number>()
  return steps.map((s) => {
    const key = s.sub ?? ''
    const n = (count.get(key) ?? 0) + 1
    count.set(key, n)
    return s.sub ? `${String.fromCharCode(65 + (subNames.indexOf(s.sub) % 26))}${n}` : String(n)
  })
}

interface StepCtx {
  i: number
  label: string
  step: Step
  d: StepDrawing | undefined
  parts: Part[]
  subs: Map<string, string[]>
  s: AsmSettings
  t: Theme
}

/** One step drawn into frame f, its type scaled to the frame. */
function drawStep(marks: Mark[], f0: Frame, page: { w: number; h: number }, c: StepCtx) {
  const { step, t, s } = c
  const full = area(page.w, page.h, M)
  const k = Math.max(0.5, Math.min(1, f0.w / full.w + 0.15, f0.h / full.h + 0.15))
  let f = f0
  if (step.sub) {
    const pad = 3 * k
    marks.push({ k: 'fill', pts: rect(f0.x, f0.y, f0.w, f0.h).slice(0, 8), rgb: t.sheetColour ? t.wash : '#f3f3f3' })
    marks.push({ k: 'line', pts: rect(f0.x, f0.y, f0.w, f0.h), w: 0.5 * k, rgb: sheetAccent(t) })
    marks.push({ k: 'text', x: f0.x + f0.w - pad, y: f0.y + pad + 2.4 * k, h: 2.4 * k, text: `Sub-assembly: ${step.sub}`, anchor: 'end', bold: true, rgb: sheetAccent(t) })
    f = { x: f0.x + pad, y: f0.y + pad, w: f0.w - 2 * pad, h: f0.h - 2 * pad }
  }
  const headW = stepHead(marks, f, c.label, t, k)
  const headH = (t.badge === 'big' ? 14 : 12) * k
  let ix = f.x + headW + 4 * k
  for (const id of step.icons ?? []) {
    icon(marks, id, ix, f.y + (headH - 9 * k) / 2, 9 * k, '#000000')
    ix += 11 * k
  }
  // The bottom: instructions and safety messages, laid out from the foot up.
  const words = s.words !== 'hide'
  const said = words ? sentences(step.text ?? '') : []
  const lettered = said.length > 1
  const th = 3.5 * k
  const lead = 6.5 * k
  const textLines = said.flatMap((x, j) => wrap(lettered ? `${String.fromCharCode(97 + j)}.  ${x}` : x, th, f.w))
  let foot = f.y + f.h - textLines.length * lead
  const warnMarks: Mark[] = []
  let wy = 0
  for (const w of step.warnings ?? []) wy += warningBlock(warnMarks, f.x, 0, f.w, w.level, w.text, k) + 2 * k
  const warnTop = foot - wy - (textLines.length ? 3 * k : 0)
  for (const m of warnMarks) {
    if (m.k === 'text') marks.push({ ...m, y: m.y + warnTop })
    else marks.push({ ...m, pts: m.pts.map((v, j) => (j % 2 === 1 ? v + warnTop : v)) })
  }
  if (textLines.length) marks.push({ k: 'line', pts: [f.x, foot - 2.5 * k, f.x + f.w, foot - 2.5 * k], w: 0.2, grey: 0.75 })
  textLines.forEach((l, j) => marks.push({ k: 'text', x: f.x, y: foot + 3.6 * k + j * lead, h: th, text: l }))
  const bottom = warnTop - 3 * k
  // The parts, and the drawing in what is left.
  const rows = takes(step, c.parts, c.subs)
  const extra = [...(step.tools ?? []).map((x) => ({ head: 'Tools', text: x })), ...(step.torque ? [{ head: 'Torque', text: step.torque }] : [])]
  const top = f.y + headH + 4 * k
  if (s.partsBox === 'corner') {
    const rh = 8 * k
    const bw = Math.min(f.w * 0.42, 64 * k)
    const bh = 5 * k + rows.length * rh + (extra.length ? 3 * k + extra.length * 4.6 * k : 0)
    marks.push({ k: 'fill', pts: rect(f.x, top, bw, bh).slice(0, 8), rgb: t.sheetColour ? t.wash : '#f1f1f1' })
    marks.push({ k: 'line', pts: rect(f.x, top, bw, bh), w: 0.3 * k, grey: 0.5 })
    let y = top + 2.5 * k
    for (const r of rows) {
      y += rh
      if (r.sub) subTag(marks, f.x + 4 * k + textWidth(r.sub, 2.6 * k) / 2, y - 3 * k, r.sub, t, k)
      else balloon(marks, f.x + 5 * k, y - 3 * k, r.item, t, k)
      const label = r.sub ? '' : `${r.n}×  ${r.row?.name ?? '?'}`
      if (label) marks.push({ k: 'text', x: f.x + 10.5 * k, y: y - 1.7 * k, h: 3 * k, text: label, bold: true })
    }
    if (extra.length) y += 2 * k
    for (const e of extra) marks.push({ k: 'text', x: f.x + 3 * k, y: (y += 4.6 * k), h: 2.6 * k, text: `${e.head === 'Torque' ? 'Torque ' : ''}${e.text}` })
    drawFigure(marks, c.d, c.parts, c.subs, { x: f.x + bw * 0.55, y: top, w: f.w - bw * 0.55 - 6 * k, h: Math.max(20, bottom - top) }, t, k)
    return
  }
  const colW = Math.min(f.w * 0.34, 70 * k)
  const col = f.x + f.w - colW
  drawFigure(marks, c.d, c.parts, c.subs, { x: f.x + 4 * k, y: top, w: f.w - colW - 12 * k, h: Math.max(20, bottom - top) }, t, k)
  let y = top + 2 * k
  marks.push({ k: 'text', x: col, y, h: 4 * k, text: 'Parts', bold: true })
  for (const r of rows) {
    y += 10 * k
    if (r.sub) {
      subTag(marks, col + 2 * k + textWidth(r.sub, 2.6 * k) / 2, y - 1.3 * k, r.sub, t, k)
      continue
    }
    balloon(marks, col + 4 * k, y - 1.3 * k, r.item, t, k)
    marks.push({ k: 'text', x: col + 10 * k, y, h: 3 * k, text: `${r.n} × ${r.row?.name ?? '?'}` })
    if (r.row?.designation) marks.push({ k: 'text', x: col + 10 * k, y: y + 4.5 * k, h: 2.6 * k, text: r.row.designation })
  }
  if (step.tools?.length) {
    y += 14 * k
    marks.push({ k: 'text', x: col, y, h: 4 * k, text: 'Tools', bold: true })
    for (const tool of step.tools) marks.push({ k: 'text', x: col + 2 * k, y: (y += 6 * k), h: 3 * k, text: tool })
  }
  if (step.torque) marks.push({ k: 'text', x: col, y: (y += 10 * k), h: 3 * k, text: `Torque: ${step.torque}` })
  if (step.notes && words) for (const line of wrap(step.notes, 2.8 * k, colW - 2)) marks.push({ k: 'text', x: col, y: (y += 6 * k), h: 2.8 * k, text: line })
}

function pageChrome(marks: Mark[], s: AsmSettings, t: Theme, page: { w: number; h: number }, n: number, total: number) {
  const ref = [s.product, s.version].filter(Boolean).join(' · ')
  if (t.id === 'technical' && ref) {
    marks.push({ k: 'text', x: M, y: M - 4, h: 2.4, text: s.title, rgb: '#595959' })
    marks.push({ k: 'text', x: page.w - M, y: M - 4, h: 2.4, text: ref, anchor: 'end', rgb: '#595959' })
  }
  marks.push({ k: 'text', x: page.w - M, y: page.h - M + 1, h: 2.6, text: `${n} / ${total}`, anchor: 'end', rgb: '#4d4d4d' })
}

export interface Pages {
  sheets: Sheet[]
  /** For each sheet, the steps on it (by index); none for the cover and
   *  the hardware page. */
  steps: number[][]
  /** The page each step is on. */
  pageOf: number[]
}

/** The whole manual: cover, the hardware page if asked, the steps packed. */
export function manualPages(parts: Part[], steps: Step[], drawings: (StepDrawing | undefined)[], s: AsmSettings): Pages {
  const t = themeOf(s)
  const page = pageSize(s)
  const subs = subAssemblies(steps)
  const labels = stepLabels(steps)
  const sheets: Sheet[] = [cover(parts, steps, s)]
  const on: number[][] = [[]]
  if (s.hardwarePage) {
    const hw = hardwarePage(parts, s)
    if (hw) {
      sheets.push(hw)
      on.push([])
    }
  }
  const packed = pack(steps, layoutOf(s), page, M, s.orientation === 'landscape')
  const pageOf: number[] = []
  for (const cells of packed) {
    const marks: Mark[] = []
    for (const cell of cells) {
      pageOf[cell.step] = sheets.length
      drawStep(marks, cell.frame, page, { i: cell.step, label: labels[cell.step], step: steps[cell.step], d: drawings[cell.step], parts, subs, s, t })
    }
    for (let a = 0; a < cells.length; a++)
      for (let b = a + 1; b < cells.length; b++) {
        const A = cells[a].frame
        const B = cells[b].frame
        if (Math.abs(A.x + A.w - B.x) < 7 && A.y < B.y + B.h && B.y < A.y + A.h) {
          const x = (A.x + A.w + B.x) / 2
          marks.push({ k: 'line', pts: [x, Math.max(A.y, B.y), x, Math.min(A.y + A.h, B.y + B.h)], w: 0.2, grey: 0.8 })
        }
        if (Math.abs(A.y + A.h - B.y) < 7 && A.x < B.x + B.w && B.x < A.x + A.w) {
          const y = (A.y + A.h + B.y) / 2
          marks.push({ k: 'line', pts: [Math.max(A.x, B.x), y, Math.min(A.x + A.w, B.x + B.w), y], w: 0.2, grey: 0.8 })
        }
      }
    sheets.push({ ...page, marks })
    on.push(cells.map((x) => x.step))
  }
  sheets.forEach((sh, n) => n > 0 && pageChrome(sh.marks, s, t, page, n + 1, sheets.length))
  return { sheets, steps: on, pageOf }
}

/** One step on its own page, as before layouts: for a caller that wants
 *  just that step. */
export function stepPage(i: number, step: Step, d: StepDrawing | undefined, parts: Part[], total: number, s: AsmSettings, steps: Step[] = [step]): Sheet {
  const t = themeOf(s)
  const page = pageSize(s)
  const marks: Mark[] = []
  const labels = stepLabels(steps)
  drawStep(marks, area(page.w, page.h, M), page, { i, label: steps.length > 1 && steps.includes(step) ? labels[steps.indexOf(step)] : String(i + 1), step, d, parts, subs: subAssemblies(steps), s, t })
  marks.push({ k: 'text', x: page.w - M, y: M + 5, h: 3.5, text: `${i + 1} / ${total}`, anchor: 'end' })
  return { ...page, marks }
}

export function cover(parts: Part[], steps: Step[], s: AsmSettings): Sheet {
  const t = themeOf(s)
  const { w, h } = pageSize(s)
  const marks: Mark[] = []
  const accent = sheetAccent(t)
  marks.push({ k: 'fill', pts: [M, M - 2, M + 30, M - 2, M + 30, M - 0.8, M, M - 0.8], rgb: accent })
  marks.push({ k: 'text', x: M, y: M + 8, h: 8, text: s.title, bold: true })
  const sub = [s.product, s.version ? `Version ${s.version}` : '', `${steps.length} step${steps.length === 1 ? '' : 's'}, ${parts.length} part${parts.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')
  marks.push({ k: 'text', x: M, y: M + 18, h: 3.5, text: sub })
  let y = M + 26
  const colR = w * 0.58
  // The right column: what it is for, safety, who made it.
  let ry = M + 32
  const block = (head: string, text: string | undefined) => {
    if (!text) return
    marks.push({ k: 'text', x: colR, y: ry, h: 3.6, text: head, bold: true, rgb: accent })
    for (const line of wrap(text, 2.8, w - M - colR)) marks.push({ k: 'text', x: colR, y: (ry += 5), h: 2.8, text: line })
    ry += 8
  }
  block('Intended use', s.intendedUse)
  if (s.safety) {
    ry += warningBlock(marks, colR, ry - 3, w - M - colR, 'warning', s.safety, 0.85) + 6
  }
  block('Disposal', s.disposal)
  block('Made by', s.publisher)
  y += 6
  const bomW = (s.intendedUse || s.safety || s.disposal || s.publisher ? colR - 8 : w - M) - M
  marks.push({ k: 'text', x: M, y, h: 5, text: 'Bill of materials', bold: true, rgb: accent })
  const cols = [M, M + 14, M + 26, M + 26 + bomW * 0.42, M + 26 + bomW * 0.75]
  const heads = ['Item', 'Qty', 'Name', 'Designation', 'Source']
  y += 10
  heads.forEach((x, i) => marks.push({ k: 'text', x: cols[i], y, h: 3, text: x, bold: true }))
  marks.push({ k: 'line', pts: [M, y + 2, M + bomW, y + 2], w: 0.3 })
  for (const r of bom(parts)) {
    y += 7
    if (y > h - M - 8) break
    const cells = ['', String(r.qty), r.name, r.designation ?? '', r.source ?? '']
    balloon(marks, cols[0] + 3.6, y - 1.3, r.item, t)
    cells.forEach((x, i) => {
      const room = (cols[i + 1] ?? M + bomW) - cols[i] - 2
      let txt = x
      while (txt.length > 1 && textWidth(txt, 3) > room) txt = txt.slice(0, -2) + '…'
      marks.push({ k: 'text', x: cols[i], y, h: 3, text: txt })
    })
  }
  return { w, h, marks }
}

/** The hardware at 1:1, from each item's designation: lay a screw on it to
 *  check. Null when no item's designation gives an outline. */
export function hardwarePage(parts: Part[], s: AsmSettings): Sheet | null {
  const t = themeOf(s)
  const { w, h } = pageSize(s)
  const items = bom(parts).flatMap((r) => (r.designation ? [{ r, o: hardwareOutline(r.designation) }] : [])).filter((x) => x.o)
  if (!items.length) return null
  const marks: Mark[] = []
  const accent = sheetAccent(t)
  marks.push({ k: 'text', x: M, y: M + 7, h: 6, text: 'Hardware at 1:1', bold: true })
  marks.push({ k: 'text', x: M, y: M + 14, h: 2.8, text: 'Print at 100% (no “fit to page”). Lay each piece on its outline to check it.' })
  // A 50 mm bar to check the print's scale.
  const bx = w - M - 50
  marks.push({ k: 'line', pts: [bx, M + 6, bx + 50, M + 6], w: 0.5 })
  for (let i = 0; i <= 5; i++) marks.push({ k: 'line', pts: [bx + i * 10, M + 4.5, bx + i * 10, M + 7.5], w: 0.3 })
  // units-ok: a printed length on purpose: the check bar is 50 mm on paper
  marks.push({ k: 'text', x: bx + 25, y: M + 12, h: 2.6, text: 'This bar is 50 mm', anchor: 'middle' })
  let x = M
  let y = M + 26
  let rowH = 0
  for (const { r, o } of items) {
    const ow = Math.max(o!.length, 8) + 52
    const oh = Math.max(o!.height, 8) + 6
    if (x + ow > w - M) {
      x = M
      y += rowH + 6
      rowH = 0
    }
    if (y + oh > h - M - 6) break
    const cy = y + oh / 2
    balloon(marks, x + 4, cy, r.item, t)
    marks.push({ k: 'text', x: x + 10, y: cy - 1, h: 3.4, text: `${r.qty}×`, bold: true, rgb: accent })
    marks.push({ k: 'text', x: x + 10, y: cy + 4, h: 2.4, text: r.designation!.slice(0, 22) })
    const ox = x + 46
    for (const l of o!.lines) marks.push({ k: 'line', pts: l.map((v, j) => (j % 2 === 0 ? ox + v : cy + v)), w: 0.25 })
    x += ow + 8
    rowH = Math.max(rowH, oh)
  }
  marks.push({ k: 'text', x: M, y: h - M + 1, h: 2.2, text: 'Outlines drawn from the designations, near the standards’ nominal sizes.', rgb: '#666666' })
  return { w, h, marks }
}
