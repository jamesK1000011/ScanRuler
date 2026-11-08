// SPDX-License-Identifier: AGPL-3.0-only
// What a page carries beside the drawing: safety messages in the ANSI
// Z535.6 way (signal word, colour, the alert symbol), pictograms drawn here
// (two people, eye protection, gloves, a click, don't overtighten, check
// the fit — none copied from a symbol set), and hardware drawn at 1:1 from
// its designation, to lay a screw on and check it.

import { textWidth, type Mark } from '../../_shared/lineart/sheet'
import type { IconId, Signal } from './model'

export const SIGNAL_STYLE: Record<Signal, { word: string; band: string; ink: string; alert: boolean }> = {
  danger: { word: 'DANGER', band: '#c8102e', ink: '#ffffff', alert: true },
  warning: { word: 'WARNING', band: '#ff7900', ink: '#000000', alert: true },
  caution: { word: 'CAUTION', band: '#ffd100', ink: '#000000', alert: true },
  notice: { word: 'NOTICE', band: '#0057b8', ink: '#ffffff', alert: false },
}

const rect = (x: number, y: number, w: number, h: number) => [x, y, x + w, y, x + w, y + h, x, y + h, x, y]

/** STE writes one instruction a sentence: each its own line. */
export const sentences = (text: string) =>
  text
    .split(/\n+/)
    .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/))
    .map((x) => x.trim())
    .filter(Boolean)

/** Words to lines no wider than w at cap height h. */
export function wrapText(text: string, h: number, w: number): string[] {
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

/** One safety message across width w from (x, y): the band with its signal
 *  word, then the message. Returns its height. */
export function warningBlock(marks: Mark[], x: number, y: number, w: number, level: Signal, text: string, k = 1): number {
  const st = SIGNAL_STYLE[level]
  const band = 6 * k
  marks.push({ k: 'fill', pts: rect(x, y, w, band), rgb: st.band })
  let tx = x + 2 * k
  if (st.alert) {
    const s = 4.4 * k
    const cx = x + 2 * k + s / 2
    const top = y + (band - s * 0.9) / 2
    marks.push({ k: 'fill', pts: [cx, top, cx + s / 2, top + s * 0.9, cx - s / 2, top + s * 0.9], rgb: st.ink })
    marks.push({ k: 'text', x: cx, y: top + s * 0.82, h: s * 0.55, text: '!', anchor: 'middle', bold: true, rgb: st.band })
    tx += s + 1.5 * k
  }
  marks.push({ k: 'text', x: tx, y: y + band / 2 + 1.6 * k, h: 3.2 * k, text: st.word, bold: true, rgb: st.ink })
  const lines = wrapText(text, 2.9 * k, w - 4 * k)
  const body = lines.length * 4.8 * k + 2.4 * k
  marks.push({ k: 'line', pts: rect(x, y, w, band + body), w: 0.35 * k, rgb: st.band === '#ffd100' ? '#000000' : st.band })
  lines.forEach((l, i) => marks.push({ k: 'text', x: x + 2 * k, y: y + band + 4.4 * k + i * 4.8 * k, h: 2.9 * k, text: l }))
  return band + body
}

const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 18) => {
  const pts: number[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
  return pts
}

/** A pictogram in a box of side `size` at (x, y), drawn in `rgb`. */
export function icon(marks: Mark[], id: IconId, x: number, y: number, size: number, rgb = '#000000') {
  const u = size / 10
  const P = (pts: number[]) => pts.map((v, i) => (i % 2 === 0 ? x + v * u : y + v * u))
  const line = (pts: number[], w = 0.6) => marks.push({ k: 'line', pts: P(pts), w: w * u, rgb })
  const fill = (pts: number[]) => marks.push({ k: 'fill', pts: P(pts), rgb })
  line(rect(0.3, 0.3, 9.4, 9.4), 0.35)
  switch (id) {
    case 'two-people':
      for (const cx of [3.3, 6.7]) {
        fill(arc(cx, 2.9, 1.1, 0, Math.PI * 2))
        fill([cx - 1.6, 8.6, cx - 1.4, 5, cx - 0.6, 4.3, cx + 0.6, 4.3, cx + 1.4, 5, cx + 1.6, 8.6])
      }
      break
    case 'eye-protection':
      line([1.2, 5, 1.2, 4, 1.8, 3.4, 4.2, 3.4, 4.8, 4, 5.2, 4, 5.8, 3.4, 8.2, 3.4, 8.8, 4, 8.8, 5, 8.2, 6.6, 6, 6.6, 5.2, 5.2, 4.8, 5.2, 4, 6.6, 1.8, 6.6, 1.2, 5])
      line([0.6, 4.4, 1.2, 4.4])
      line([8.8, 4.4, 9.4, 4.4])
      break
    case 'gloves':
      line([3, 9, 3, 5.4, 2.2, 4.4, 1.6, 3.4, 2.4, 3.1, 3.4, 4.2, 3.4, 1.8, 4.3, 1.8, 4.4, 4, 4.6, 1.2, 5.5, 1.2, 5.6, 4, 6, 1.6, 6.9, 1.7, 6.9, 4.2, 7.4, 2.4, 8.2, 2.6, 7.9, 6, 7, 7.4, 7, 9, 3, 9])
      line([3, 8, 7, 8], 0.4)
      break
    case 'click':
      fill(rect(4.2, 3.6, 1.6, 2.8).slice(0, 8))
      line(arc(5, 5, 2.4, -Math.PI * 0.35, Math.PI * 0.35, 8))
      line(arc(5, 5, 3.6, -Math.PI * 0.3, Math.PI * 0.3, 8))
      line(arc(5, 5, 2.4, Math.PI * 0.65, Math.PI * 1.35, 8))
      line(arc(5, 5, 3.6, Math.PI * 0.7, Math.PI * 1.3, 8))
      break
    case 'no-overtighten': {
      const a = arc(5, 5, 3, -Math.PI * 0.9, Math.PI * 0.4, 20)
      line(a)
      const ex = x + a[a.length - 2] * u
      const ey = y + a[a.length - 1] * u
      marks.push({ k: 'fill', pts: [ex - 1.1 * u, ey - 0.6 * u, ex + 1 * u, ey - 0.4 * u, ex - 0.1 * u, ey + 1.3 * u], rgb })
      fill(arc(5, 5, 0.7, 0, Math.PI * 2))
      line([1.4, 8.6, 8.6, 1.4], 0.8)
      break
    }
    case 'check-fit':
      line(arc(4.3, 4.3, 2.6, 0, Math.PI * 2, 24))
      line([6.2, 6.2, 8.8, 8.8], 1)
      line([3.1, 4.4, 4, 5.4, 5.6, 3.3], 0.6)
      break
  }
}

export interface Outline {
  /** Polylines, mm, in the part's own frame: x along it, y across. */
  lines: number[][]
  /** Its length along x and height across, mm. */
  length: number
  height: number
  /** What it was drawn from. */
  kind: string
}

const WASHER_OD: Record<number, [number, number]> = { 2: [5, 0.3], 2.5: [6, 0.5], 3: [7, 0.5], 4: [9, 0.8], 5: [10, 1], 6: [12, 1.6], 8: [16, 1.6], 10: [20, 2], 12: [24, 2.5] }
const HEX_AF: Record<number, number> = { 2: 4, 2.5: 5, 3: 5.5, 4: 7, 5: 8, 6: 10, 8: 13, 10: 16, 12: 18 }

/** A side view of common metric hardware, from its designation: socket
 *  head, button, countersunk, pan and hex screws, nuts and washers — the
 *  dimensions near the standard's nominal, labelled an outline. Null for a
 *  designation it doesn't know. */
export function hardwareOutline(designation: string): Outline | null {
  const m = /M\s*(\d+(?:\.\d+)?)(?:\s*[×xX*]\s*(\d+(?:\.\d+)?))?/.exec(designation)
  if (!m) return null
  const d = Number(m[1])
  const L = m[2] ? Number(m[2]) : 0
  const std = designation.toLowerCase()
  const r = d / 2
  if (/nut|4032|934|4035|439/.test(std)) {
    const s = HEX_AF[d] ?? 1.6 * d + 0.5
    const h = 0.8 * d
    return { lines: [[0, -s / 2 * 1.15, h, -s / 2 * 1.15, h, s / 2 * 1.15, 0, s / 2 * 1.15, 0, -s / 2 * 1.15], [0, -s / 4, h, -s / 4], [0, s / 4, h, s / 4]], length: h, height: s * 1.15, kind: 'hex nut' }
  }
  if (/washer|7089|7090|125\b|902\b/.test(std)) {
    const [od, t] = WASHER_OD[d] ?? [2 * d + 1, Math.max(0.5, 0.15 * d)]
    return { lines: [[0, -od / 2, t, -od / 2, t, od / 2, 0, od / 2, 0, -od / 2], [0, -r - 0.2, t, -r - 0.2], [0, r + 0.2, t, r + 0.2]], length: t, height: od, kind: 'flat washer' }
  }
  if (!L) return null
  const shank = (x0: number, x1: number) => [
    [x0, -r, x1 - r * 0.3, -r, x1, -r * 0.7, x1, r * 0.7, x1 - r * 0.3, r, x0, r],
    [x0, -r * 0.82, x1 - r * 0.3, -r * 0.82],
    [x0, r * 0.82, x1 - r * 0.3, r * 0.82],
  ]
  let head: number[][]
  let kind: string
  let hl = 0
  if (/10642|7991|countersunk|flat head/.test(std)) {
    const dk = 2 * d
    hl = 0.62 * d
    return { lines: [[0, -dk / 2, 0, dk / 2, hl, r, hl, -r, 0, -dk / 2], ...shank(hl, L)], length: L, height: dk, kind: 'countersunk screw' }
  } else if (/7380|button/.test(std)) {
    const dk = 1.75 * d
    hl = 0.55 * d
    head = [[hl, -dk / 2, ...arc(hl, 0, 1, 0, 0, 0).slice(0, 0), hl * 0.35, -dk / 2 * 0.8, 0, -dk / 4, 0, dk / 4, hl * 0.35, dk / 2 * 0.8, hl, dk / 2, hl, -dk / 2]]
    kind = 'button head screw'
  } else if (/4017|4014|933|931|hex/.test(std)) {
    const s = HEX_AF[d] ?? 1.6 * d
    hl = 0.7 * d
    head = [[0, -s * 0.58, hl, -s * 0.58, hl, s * 0.58, 0, s * 0.58, 0, -s * 0.58], [0, -s * 0.29, hl, -s * 0.29], [0, s * 0.29, hl, s * 0.29]]
    kind = 'hex head screw'
  } else if (/7985|7045|pan/.test(std)) {
    const dk = 2 * d
    hl = 0.7 * d
    head = [[hl, -dk / 2, hl * 0.25, -dk / 2, 0, -dk / 2 + 0.4, 0, dk / 2 - 0.4, hl * 0.25, dk / 2, hl, dk / 2, hl, -dk / 2]]
    kind = 'pan head screw'
  } else {
    const dk = 1.5 * d + 0.5
    hl = d
    head = [[hl, -dk / 2, 0.3, -dk / 2, 0, -dk / 2 + 0.3, 0, dk / 2 - 0.3, 0.3, dk / 2, hl, dk / 2, hl, -dk / 2]]
    kind = 'socket head screw'
  }
  return { lines: [...head, ...shank(hl, hl + L)], length: hl + L, height: Math.max(...head.flatMap((p) => p.filter((_, i) => i % 2 === 1).map(Math.abs))) * 2, kind }
}
