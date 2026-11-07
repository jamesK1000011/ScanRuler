// SPDX-License-Identifier: AGPL-3.0-only
// How a manual looks: the HTML's type, colours and layout, and the accent
// and balloons on its PDF, PNG and SVG pages. Chosen by name in the
// settings, with the accent colour the person's own if they give one.

import type { AsmSettings } from './model'

export interface Theme {
  id: string
  name: string
  about: string
  /** The one colour beside black: step numbers, balloons, arrows. */
  accent: string
  ink: string
  muted: string
  paper: string
  rule: string
  /** A tint of the accent behind notes and the step badge. */
  wash: string
  /** CSS font stacks — the reader's own fonts: the file carries none. */
  font: string
  heading: string
  mono: string
  /** The HTML's base type size, px. */
  size: number
  balloon: 'outline' | 'filled'
  /** How a step's number stands: a coloured box, a big numeral, or words. */
  badge: 'box' | 'big' | 'plain'
  /** Whether the pages (PDF, PNG, SVG) carry the accent; black if not. */
  sheetColour: boolean
}

const SANS = "'Barlow', 'Inter', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"
const HELV = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const SERIF = "Charter, 'Bitstream Charter', 'Iowan Old Style', 'Sitka Text', Cambria, Georgia, serif"
const MONO = "'B612 Mono', 'JetBrains Mono', 'SF Mono', Consolas, 'Liberation Mono', monospace"

export const THEMES: Theme[] = [
  {
    id: 'workshop',
    name: 'Workshop',
    about: 'Clean sans, a blue accent, numbered boxes and filled balloons. The default.',
    accent: '#1877c0',
    ink: '#1f2326',
    muted: '#6b7075',
    paper: '#ffffff',
    rule: '#d9dcdf',
    wash: '#eaf2fa',
    font: SANS,
    heading: SANS,
    mono: MONO,
    size: 16,
    balloon: 'filled',
    badge: 'box',
    sheetColour: true,
  },
  {
    id: 'picture',
    name: 'Picture first',
    about: 'Big step numerals, the drawing large and few words, black on white — a flat-pack kit’s manual.',
    accent: '#111111',
    ink: '#111111',
    muted: '#666666',
    paper: '#ffffff',
    rule: '#e2e2e2',
    wash: '#f3f3f3',
    font: HELV,
    heading: HELV,
    mono: MONO,
    size: 16,
    balloon: 'outline',
    badge: 'big',
    sheetColour: false,
  },
  {
    id: 'technical',
    name: 'Technical',
    about: 'Serif text, small-caps headings, ruled tables and a dark red accent — a service manual.',
    accent: '#9b1c1c',
    ink: '#1a1a1a',
    muted: '#5f5f5f',
    paper: '#fffefb',
    rule: '#cfcabf',
    wash: '#f7efe9',
    font: SERIF,
    heading: SANS,
    mono: MONO,
    size: 17,
    balloon: 'outline',
    badge: 'plain',
    sheetColour: true,
  },
  {
    id: 'shopfloor',
    name: 'Shop floor',
    about: 'Large type and heavy contrast to read at arm’s length, an amber accent that prints dark on a mono printer.',
    accent: '#b45f06',
    ink: '#000000',
    muted: '#3d3d3d',
    paper: '#ffffff',
    rule: '#9a9a9a',
    wash: '#fff1de',
    font: SANS,
    heading: SANS,
    mono: MONO,
    size: 20,
    balloon: 'filled',
    badge: 'box',
    sheetColour: true,
  },
]

export const THEME_IDS = THEMES.map((t) => t.id)

const HEX = /^#[0-9a-fA-F]{6}$/

/** A light tint of a colour, for the wash behind notes. */
function tint(hex: string, share = 0.1): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return `#${c.map((v) => Math.round(255 - (255 - v) * share).toString(16).padStart(2, '0')).join('')}`
}

/** The settings' theme, with their own accent if they give one. */
export function themeOf(s: Pick<AsmSettings, 'theme' | 'accent'>): Theme {
  const base = THEMES.find((t) => t.id === s.theme) ?? THEMES[0]
  return s.accent && HEX.test(s.accent) ? { ...base, accent: s.accent, wash: tint(s.accent) } : base
}

/** The colour a page mark takes: the accent where the theme colours its
 *  pages, black otherwise. */
export const sheetAccent = (t: Theme) => (t.sheetColour ? t.accent : '#000000')
