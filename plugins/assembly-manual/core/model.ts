// SPDX-License-Identifier: AGPL-3.0-only
// What assembly-manual keeps: the parts, the steps that put them together,
// the text style and the settings. Plain data, kept with the project.

import type { V3, ViewName } from '../../_shared/lineart/views'

export interface Part {
  /** Item name in the bill of materials. */
  name: string
  /** The Reverse Engineer body it is, in its assembled place; none for
   *  hardware listed without a model (glue, a cable tie). */
  body?: string
  bodyId?: number
  kind: 'part' | 'hardware'
  /** A catalog designation: "M3×10 ISO 4762". */
  designation?: string
  /** Where it comes from: a supplier, a catalog file, "printed". */
  source?: string
  /** How many this one item stands for, when it has no body per piece. */
  qty?: number
}

export interface Placement {
  part: string
  /** The way the part moves into its place, as a direction. */
  move: V3
  /** How far it comes from, mm; long enough to clear the part by default. */
  travel?: number
}

export interface Step {
  id: string
  place: Placement[]
  tools?: string[]
  torque?: string
  notes?: string
  text?: string
  view?: ViewName | { toward: V3; up?: V3 }
}

export type StyleName = 'ste100' | 'plain' | 'custom'

export interface Style {
  name: StyleName
  /** Words to avoid and what to write instead, the project's own list. */
  words: Record<string, string>
  /** For custom: the user's own style file (Markdown). */
  custom?: string
}

export interface AsmSettings {
  title: string
  paper: 'letter' | 'a4'
  orientation: 'landscape' | 'portrait'
  /** How far new parts are pulled out along their move, as a share of their travel. */
  explode: number
  /** How it looks — themes.ts: workshop, picture, technical, shopfloor. */
  theme: string
  /** The person's own accent colour, '#rrggbb', over the theme's. */
  accent?: string
}

export const DEFAULT_SETTINGS: AsmSettings = { title: 'Assembly instructions', paper: 'letter', orientation: 'landscape', explode: 1, theme: 'workshop' }

export const DEFAULT_WORDS: Record<string, string> = {
  utilize: 'use',
  'prior to': 'before',
  'in order to': 'to',
  ensure: 'make sure',
  approximately: 'about',
  commence: 'start',
  terminate: 'stop',
  sufficient: 'enough',
  subsequently: 'then',
  'in the event that': 'if',
}

export const DEFAULT_STYLE: Style = { name: 'ste100', words: { ...DEFAULT_WORDS } }
