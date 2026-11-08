// SPDX-License-Identifier: AGPL-3.0-only
// Steps onto pages: one a page, two, a grid of four or six, or auto — each
// step sized by how much it carries, simple ones sharing a page, a big one
// a page to itself. A page is split in halves (side by side on landscape,
// one above the other on portrait), and a half in quarters the other way.

import type { AsmSettings, Layout, Step } from './model'

export interface Frame {
  x: number
  y: number
  w: number
  h: number
}

export interface Cell {
  /** Index into the steps. */
  step: number
  frame: Frame
}

/** The page's working area: inside the margin, above the footer. */
export const area = (w: number, h: number, m: number): Frame => ({ x: m, y: m, w: w - 2 * m, h: h - 2 * m - 7 })
const GAP = 6

function split(f: Frame, across: boolean, n: number): Frame[] {
  return Array.from({ length: n }, (_, i) =>
    across ? { x: f.x + (i * (f.w + GAP)) / n, y: f.y, w: (f.w - GAP * (n - 1)) / n, h: f.h } : { x: f.x, y: f.y + (i * (f.h + GAP)) / n, w: f.w, h: (f.h - GAP * (n - 1)) / n },
  )
}

function grid(f: Frame, cols: number, rows: number): Frame[] {
  return split(f, false, rows).flatMap((r) => split(r, true, cols))
}

/** How much a step carries: parts, words, tools, warnings. */
export function weight(s: Step): number {
  return s.place.length * 0.6 + (s.text?.length ?? 0) / 90 + (s.tools?.length ?? 0) * 0.4 + (s.warnings?.length ?? 0) * 1.4 + (s.notes ? 0.8 : 0) + (s.torque ? 0.3 : 0) + 0.6
}

/** The size a step asks for under auto: a quarter, a half or a page. */
export function sizeOf(s: Step): 'q' | 'h' | 'f' {
  const w = weight(s)
  return w <= 2.2 ? 'q' : w <= 4.2 ? 'h' : 'f'
}

export function pack(steps: Step[], layout: Layout, paper: { w: number; h: number }, m: number, landscape: boolean): Cell[][] {
  const a = area(paper.w, paper.h, m)
  const fixed: Record<Exclude<Layout, 'auto'>, Frame[]> = {
    one: [a],
    two: split(a, landscape, 2),
    grid4: grid(a, 2, 2),
    grid6: landscape ? grid(a, 3, 2) : grid(a, 2, 3),
  }
  if (layout !== 'auto') {
    const frames = fixed[layout]
    const pages: Cell[][] = []
    steps.forEach((_, i) => {
      if (i % frames.length === 0) pages.push([])
      pages[pages.length - 1].push({ step: i, frame: frames[i % frames.length] })
    })
    return pages
  }
  const halves = split(a, landscape, 2)
  const pages: Cell[][] = []
  let page: Cell[] | null = null
  let half = 0
  let quarterOpen: Frame | null = null
  const fresh = () => {
    page = []
    pages.push(page)
    half = 0
    quarterOpen = null
  }
  steps.forEach((s, i) => {
    const size = sizeOf(s)
    if (size === 'f') {
      fresh()
      page!.push({ step: i, frame: a })
      half = 2
      return
    }
    if (size === 'q' && quarterOpen) {
      page!.push({ step: i, frame: quarterOpen })
      quarterOpen = null
      return
    }
    if (!page || half >= 2) fresh()
    const h = halves[half++]
    quarterOpen = null
    if (size === 'h') {
      page!.push({ step: i, frame: h })
      return
    }
    const [q1, q2] = split(h, !landscape, 2)
    page!.push({ step: i, frame: q1 })
    quarterOpen = q2
  })
  return pages
}

export const layoutOf = (s: Pick<AsmSettings, 'layout'>): Layout => s.layout ?? 'one'
