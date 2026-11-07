// SPDX-License-Identifier: AGPL-3.0-only
// What patent-kit keeps: the figures planned, the reference numerals, the
// draft text and the settings. Plain data, kept with the project.

import type { V3, ViewName } from '../../_shared/lineart/views'

export type Paper = 'letter' | 'a4'

export interface PatentSettings {
  paper: Paper
  /** Hidden lines: left out (the usual for patent drawings) or dashed. */
  hidden: 'omit' | 'dashed'
  /** Cap height of the reference numerals, mm; 37 CFR 1.84(p)(3) wants 3.2 or more. */
  numeralMm: number
  /** Cap height of "FIG. n" and the sheet numbers, mm; larger than the numerals. */
  figLabelMm: number
  /** Visible line weight, mm. */
  lineMm: number
  figuresPerSheet: 1 | 2 | 4
  /** The first numeral given out, and the step between. */
  numeralStart: number
  numeralStep: number
  /** What the brief description calls the thing: "the device", "the clamp". */
  title: string
}

export const DEFAULT_SETTINGS: PatentSettings = {
  paper: 'letter',
  hidden: 'omit',
  numeralMm: 3.5,
  figLabelMm: 6,
  lineMm: 0.35,
  figuresPerSheet: 1,
  numeralStart: 10,
  numeralStep: 2,
  title: 'the device',
}

export type Axis = 'x' | 'y' | 'z'

export interface Figure {
  id: string
  kind: 'view' | 'exploded' | 'section'
  view: ViewName | { toward: V3; up?: V3 }
  /** Body names; every visible solid body when left out. */
  bodies?: string[]
  /** Numerals to show; every one that can be seen when left out. */
  numerals?: number[]
  section?: { axis: Axis; offset: number; keep: 'above' | 'below'; from?: string }
  explode?: { factor: number }
  /** Words for the brief description after the view: "showing the latch open". */
  caption?: string
}

/** A body by name (and the reverse body id it had, so a rename follows
 *  it), or a point on the part, mm. */
export type Target = { body: string; id?: number } | { at: V3; body?: string }

export interface Numeral {
  n: number
  label: string
  /** Named after its body, and renamed with it. */
  auto: boolean
  target: Target
}

export const SECTIONS = ['title', 'field', 'background', 'summary', 'drawings', 'detailed', 'claims', 'abstract'] as const
export type Section = (typeof SECTIONS)[number]

export const DRAFT_MARK = 'DRAFT — for attorney review'
