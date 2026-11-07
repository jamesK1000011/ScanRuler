// SPDX-License-Identifier: AGPL-3.0-only
// Figures laid out on sheets the way 37 CFR 1.84 asks: inside the sight
// area, black lines, numerals on short lead lines that don't cross, cut
// faces hatched, "FIG. n" under each, the sheet number at the top.

import { boxOf, type Polyline } from '../../_shared/lineart/hlr'
import { textWidth, type Mark, type Sheet } from '../../_shared/lineart/sheet'
import type { Drawing } from './drawings'
import type { Figure, Paper, PatentSettings } from './model'

export const PAPER: Record<Paper, { w: number; h: number }> = { letter: { w: 215.9, h: 279.4 }, a4: { w: 210, h: 297 } }

/** 37 CFR 1.84(g): top 2.5 cm, left 2.5 cm, right 1.5 cm, bottom 1.0 cm. */
export const MARGIN = { top: 25, left: 25, right: 15, bottom: 10 }

export interface Leader {
  n: number
  figure: number
  /** The numeral's text box on the sheet. */
  box: { x: number; y: number; w: number; h: number }
  /** The lead line, from beside the numeral to the part. */
  line: [number, number, number, number]
}

export interface Placement {
  figure: number
  id: string
  sheet: number
  /** Part mm to sheet mm. */
  scale: number
  box: { x: number; y: number; w: number; h: number }
  shortestEdge: number
  hatched: boolean
  bracketed: boolean
  cutsDrawn: string[]
  /** Visible lines in sheet mm. */
  lines: Polyline[]
}

export interface Layout {
  sheets: Sheet[]
  placements: Placement[]
  leaders: Leader[]
  /** Every mark's extent per sheet, for the margin check. */
  extents: { minX: number; minY: number; maxX: number; maxY: number }[]
  settings: PatentSettings
}

const SLOTS: Record<1 | 2 | 4, { cols: number; rows: number }> = { 1: { cols: 1, rows: 1 }, 2: { cols: 1, rows: 2 }, 4: { cols: 2, rows: 2 } }

/** Lines at 45° `gap` apart inside the even-odd region the loops bound. */
export function hatch(loops: Polyline[], gap: number, flip = false): number[][] {
  if (flip) return hatch(loops.map((l) => l.map((v, i) => (i % 2 === 0 ? -v : v))), gap).map((s) => s.map((v, i) => (i % 2 === 0 ? -v : v)))
  const segs: [number, number, number, number][] = []
  const rot = (x: number, y: number): [number, number] => [(x + y) / Math.SQRT2, (y - x) / Math.SQRT2]
  const back = (u: number, v: number): [number, number] => [(u - v) / Math.SQRT2, (u + v) / Math.SQRT2]
  let vmin = Infinity
  let vmax = -Infinity
  for (const l of loops)
    for (let i = 0; i + 3 < l.length; i += 2) {
      const a = rot(l[i], l[i + 1])
      const b = rot(l[i + 2], l[i + 3])
      segs.push([a[0], a[1], b[0], b[1]])
      vmin = Math.min(vmin, a[1], b[1])
      vmax = Math.max(vmax, a[1], b[1])
    }
  const out: number[][] = []
  for (let v = Math.ceil(vmin / gap) * gap + gap / 2; v < vmax; v += gap) {
    const xs: number[] = []
    for (const [u1, v1, u2, v2] of segs) if ((v1 <= v && v2 > v) || (v2 <= v && v1 > v)) xs.push(u1 + ((v - v1) * (u2 - u1)) / (v2 - v1))
    xs.sort((p, q) => p - q)
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([...back(xs[i], v), ...back(xs[i + 1], v)])
  }
  return out
}

export function segmentsCross(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px))
  const [ax, ay, bx, by] = a
  const [cx, cy, dx, dy] = b
  return o(ax, ay, bx, by, cx, cy) * o(ax, ay, bx, by, dx, dy) < 0 && o(cx, cy, dx, dy, ax, ay) * o(cx, cy, dx, dy, bx, by) < 0
}

/** Where a ray from c through p leaves the rectangle. */
function ringPoint(c: [number, number], p: [number, number], r: { x0: number; y0: number; x1: number; y1: number }): [number, number] {
  let dx = p[0] - c[0]
  let dy = p[1] - c[1]
  if (Math.hypot(dx, dy) < 1e-9) dx = 1
  const ts = [dx > 0 ? (r.x1 - c[0]) / dx : dx < 0 ? (r.x0 - c[0]) / dx : Infinity, dy > 0 ? (r.y1 - c[1]) / dy : dy < 0 ? (r.y0 - c[1]) / dy : Infinity]
  const t = Math.min(...ts)
  return [c[0] + dx * t, c[1] + dy * t]
}

/** Position along the ring's perimeter, clockwise from top left. */
function perim(p: [number, number], r: { x0: number; y0: number; x1: number; y1: number }): number {
  const w = r.x1 - r.x0
  const h = r.y1 - r.y0
  const e = 1e-6
  if (Math.abs(p[1] - r.y0) < e) return p[0] - r.x0
  if (Math.abs(p[0] - r.x1) < e) return w + (p[1] - r.y0)
  if (Math.abs(p[1] - r.y1) < e) return w + h + (r.x1 - p[0])
  return 2 * w + h + (r.y1 - p[1])
}
function unperim(s: number, r: { x0: number; y0: number; x1: number; y1: number }): [number, number] {
  const w = r.x1 - r.x0
  const h = r.y1 - r.y0
  const P = 2 * (w + h)
  s = ((s % P) + P) % P
  if (s < w) return [r.x0 + s, r.y0]
  if (s < w + h) return [r.x1, r.y0 + s - w]
  if (s < 2 * w + h) return [r.x1 - (s - w - h), r.y1]
  return [r.x0, r.y1 - (s - 2 * w - h)]
}

export function layout(figures: Figure[], drawings: Drawing[], settings: PatentSettings): Layout {
  const paper = PAPER[settings.paper]
  const sight = { x: MARGIN.left, y: MARGIN.top, w: paper.w - MARGIN.left - MARGIN.right, h: paper.h - MARGIN.top - MARGIN.bottom }
  const per = settings.figuresPerSheet
  const grid = SLOTS[per]
  const nSheets = Math.max(1, Math.ceil(figures.length / per))
  const sheets: Sheet[] = Array.from({ length: nSheets }, () => ({ w: paper.w, h: paper.h, marks: [] }))
  const placements: Placement[] = []
  const leaders: Leader[] = []
  const numH = settings.numeralMm
  const figH = settings.figLabelMm
  const sheetNumBand = nSheets > 1 ? figH + 4 : 0
  if (nSheets > 1)
    sheets.forEach((s, i) => s.marks.push({ k: 'text', x: sight.x + sight.w / 2, y: sight.y + figH, h: figH, text: `${i + 1}/${nSheets}`, anchor: 'middle' }))
  figures.forEach((f, idx) => {
    const d = drawings.find((x) => x.figure === f.id)
    const sheetNo = Math.floor(idx / per)
    const slot = idx % per
    const onSheet = Math.min(per, figures.length - sheetNo * per)
    const sheet = sheets[sheetNo]
    const cellW = sight.w / grid.cols
    const cellH = (sight.h - sheetNumBand) / grid.rows
    const cell = { x: sight.x + (slot % grid.cols) * cellW, y: sight.y + sheetNumBand + Math.floor(slot / grid.cols) * cellH, w: cellW, h: cellH }
    const label = `FIG. ${idx + 1}`
    const labelBand = figH + 6
    const anchors = d?.anchors ?? []
    const ring = anchors.length ? Math.max(...anchors.map((a) => textWidth(String(a.n), numH))) + 9 : 2
    const inner = { x: cell.x + ring + 2, y: cell.y + ring + 2, w: cell.w - 2 * ring - 4, h: cell.h - labelBand - 2 * ring - 4 }
    const bracketed = f.kind === 'exploded' && onSheet > 1
    if (!d || d.visible.length === 0) {
      sheet.marks.push({ k: 'text', x: cell.x + cell.w / 2, y: cell.y + cell.h - 3, h: figH, text: label, anchor: 'middle' })
      placements.push({ figure: idx + 1, id: f.id, sheet: sheetNo + 1, scale: 0, box: { x: inner.x, y: inner.y, w: 0, h: 0 }, shortestEdge: Infinity, hatched: false, bracketed, cutsDrawn: [], lines: [] })
      return
    }
    const b = boxOf([...d.visible, ...d.hidden])
    const bw = Math.max(b.maxX - b.minX, 1e-6)
    const bh = Math.max(b.maxY - b.minY, 1e-6)
    const scale = Math.min(inner.w / bw, inner.h / bh)
    const ox = inner.x + (inner.w - bw * scale) / 2
    const oy = inner.y + (inner.h - bh * scale) / 2
    const X = (x: number) => ox + (x - b.minX) * scale
    const Y = (y: number) => oy + (b.maxY - y) * scale
    const toSheet = (l: Polyline): Polyline => l.map((v, i) => (i % 2 === 0 ? X(v) : Y(v)))
    const lines = d.visible.map(toSheet)
    for (const l of lines) sheet.marks.push({ k: 'line', pts: l, w: settings.lineMm })
    for (const l of d.hidden) sheet.marks.push({ k: 'line', pts: toSheet(l), w: settings.lineMm * 0.7, dash: [2, 1.2] })
    d.hatch.forEach((loops, j) => {
      for (const s of hatch(loops.map(toSheet), 2, j % 2 === 1)) sheet.marks.push({ k: 'line', pts: s, w: settings.lineMm * 0.6 })
    })
    const dw = bw * scale
    const dh = bh * scale
    const area = { x0: ox, y0: oy, x1: ox + dw, y1: oy + dh }
    const cutsDrawn: string[] = []
    for (const cut of d.cuts) {
      const sec = figures.findIndex((g) => g.id === cut.section) + 1
      const a: [number, number] = [X(cut.a[0]), Y(cut.a[1])]
      const z: [number, number] = [X(cut.b[0]), Y(cut.b[1])]
      const len = Math.hypot(z[0] - a[0], z[1] - a[1]) || 1
      const u: [number, number] = [(z[0] - a[0]) / len, (z[1] - a[1]) / len]
      const ext = 5
      const p0: [number, number] = [a[0] - u[0] * ext, a[1] - u[1] * ext]
      const p1: [number, number] = [z[0] + u[0] * ext, z[1] + u[1] * ext]
      sheet.marks.push({ k: 'line', pts: [...p0, ...p1], w: settings.lineMm, dash: [6, 1.5, 1, 1.5] })
      const look: [number, number] = [cut.look[0], -cut.look[1]]
      for (const end of [p0, p1]) {
        const tip: [number, number] = [end[0] + look[0] * 6, end[1] + look[1] * 6]
        sheet.marks.push({ k: 'line', pts: [...end, ...tip], w: settings.lineMm })
        const side: [number, number] = [-look[1], look[0]]
        sheet.marks.push({ k: 'fill', pts: [tip[0] + look[0] * 2.5, tip[1] + look[1] * 2.5, tip[0] + side[0] * 1.2, tip[1] + side[1] * 1.2, tip[0] - side[0] * 1.2, tip[1] - side[1] * 1.2] })
        sheet.marks.push({ k: 'text', x: end[0] - look[0] * 3, y: end[1] - look[1] * 3 + numH / 2, h: numH, text: String(sec), anchor: 'middle' })
      }
      cutsDrawn.push(cut.section)
    }
    const r = { x0: area.x0 - ring + 2, y0: area.y0 - ring + 2, x1: area.x1 + ring - 2, y1: area.y1 + ring - 2 }
    const c: [number, number] = [(area.x0 + area.x1) / 2, (area.y0 + area.y1) / 2]
    const pts = anchors.map((a) => ({ n: a.n, at: [X(a.at[0]), Y(a.at[1])] as [number, number] }))
    const P = 2 * (r.x1 - r.x0 + r.y1 - r.y0)
    const gap = Math.max(numH * 1.8, ...pts.map((p) => textWidth(String(p.n), numH) + 2))
    const want = pts.map((p) => {
      const out: [number, number] = [p.at[0] + (p.at[0] - c[0]) * 1e-3, p.at[1] + (p.at[1] - c[1]) * 1e-3]
      const near = [ringPoint(c, out, r), [p.at[0], r.y0], [r.x1, p.at[1]], [p.at[0], r.y1], [r.x0, p.at[1]]] as [number, number][]
      const best = near.filter((q) => q[0] >= r.x0 - 1e-6 && q[0] <= r.x1 + 1e-6 && q[1] >= r.y0 - 1e-6 && q[1] <= r.y1 + 1e-6).sort((q, s) => Math.hypot(q[0] - p.at[0], q[1] - p.at[1]) - Math.hypot(s[0] - p.at[0], s[1] - p.at[1]))[0]
      return perim(best, r)
    })
    const order = pts.map((_, i) => i).sort((i, j) => want[i] - want[j])
    const s = order.map((i) => want[i])
    for (let pass = 0; pass < 50 && s.length > 1; pass++) {
      let moved = false
      for (let k = 0; k < s.length; k++) {
        const next = k + 1 < s.length ? s[k + 1] : s[0] + P
        const short = gap - (next - s[k])
        if (short > 1e-6) {
          s[k] -= short / 2
          if (k + 1 < s.length) s[k + 1] += short / 2
          else s[0] += short / 2
          moved = true
        }
      }
      if (!moved) break
    }
    const placed: Leader[] = order.map((i, k) => {
      const at = pts[i].at
      const q = unperim(s[k], r)
      const tw = textWidth(String(pts[i].n), numH)
      const box = { x: q[0] - tw / 2, y: q[1] - numH / 2, w: tw, h: numH }
      return { n: pts[i].n, figure: idx + 1, box, line: [0, 0, at[0], at[1]] as [number, number, number, number] }
    })
    const startOf = (l: Leader): [number, number] => {
      const cx = l.box.x + l.box.w / 2
      const cy = l.box.y + l.box.h / 2
      const dx = l.line[2] - cx
      const dy = l.line[3] - cy
      const t = Math.min(Math.abs((l.box.w / 2 + 1) / (dx || 1e-9)), Math.abs((l.box.h / 2 + 1) / (dy || 1e-9)))
      return [cx + dx * Math.min(t, 1), cy + dy * Math.min(t, 1)]
    }
    for (const l of placed) {
      const st = startOf(l)
      l.line[0] = st[0]
      l.line[1] = st[1]
    }
    for (let pass = 0; pass < 20; pass++) {
      let swapped = false
      for (let i = 0; i < placed.length; i++)
        for (let j = i + 1; j < placed.length; j++) {
          if (!segmentsCross(placed[i].line, placed[j].line)) continue
          const ai = [placed[i].line[2], placed[i].line[3]]
          const aj = [placed[j].line[2], placed[j].line[3]]
          const ni = placed[i].n
          placed[i].n = placed[j].n
          placed[j].n = ni
          placed[i].line[2] = aj[0]
          placed[i].line[3] = aj[1]
          placed[j].line[2] = ai[0]
          placed[j].line[3] = ai[1]
          for (const l of [placed[i], placed[j]]) {
            const tw = textWidth(String(l.n), numH)
            l.box = { x: l.box.x + l.box.w / 2 - tw / 2, y: l.box.y, w: tw, h: numH }
            const st = startOf(l)
            l.line[0] = st[0]
            l.line[1] = st[1]
          }
          swapped = true
        }
      if (!swapped) break
    }
    for (const l of placed) {
      sheet.marks.push({ k: 'text', x: l.box.x + l.box.w / 2, y: l.box.y + l.box.h, h: numH, text: String(l.n), anchor: 'middle' })
      sheet.marks.push({ k: 'line', pts: [...l.line], w: 0.2 })
      leaders.push(l)
    }
    if (bracketed) {
      const bx0 = r.x0 - 3
      const bx1 = r.x1 + 3
      const by0 = r.y0 - 3
      const by1 = r.y1 + 3
      sheet.marks.push({ k: 'line', pts: [bx0 + 3, by0, bx0, by0, bx0, by1, bx0 + 3, by1], w: settings.lineMm })
      sheet.marks.push({ k: 'line', pts: [bx1 - 3, by0, bx1, by0, bx1, by1, bx1 - 3, by1], w: settings.lineMm })
    }
    sheet.marks.push({ k: 'text', x: cell.x + cell.w / 2, y: Math.min(cell.y + cell.h - 2, r.y1 + ring + figH + 2), h: figH, text: label, anchor: 'middle' })
    placements.push({ figure: idx + 1, id: f.id, sheet: sheetNo + 1, scale, box: { x: ox, y: oy, w: dw, h: dh }, shortestEdge: d.shortestEdge * scale, hatched: d.hatch.length > 0, bracketed, cutsDrawn, lines })
  })
  const extents = sheets.map((s) => {
    const e = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (const m of s.marks) {
      const xy: number[] = m.k === 'text' ? markTextBox(m) : m.pts
      for (let i = 0; i < xy.length; i += 2) {
        e.minX = Math.min(e.minX, xy[i])
        e.maxX = Math.max(e.maxX, xy[i])
        e.minY = Math.min(e.minY, xy[i + 1])
        e.maxY = Math.max(e.maxY, xy[i + 1])
      }
    }
    return e
  })
  return { sheets, placements, leaders, extents, settings }
}

function markTextBox(m: Extract<Mark, { k: 'text' }>): number[] {
  const w = textWidth(m.text, m.h)
  const x0 = m.anchor === 'middle' ? m.x - w / 2 : m.anchor === 'end' ? m.x - w : m.x
  return [x0, m.y - m.h, x0 + w, m.y]
}
