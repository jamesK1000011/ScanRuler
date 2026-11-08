// SPDX-License-Identifier: AGPL-3.0-only
// A manual theme as a JSON file: written out from any theme (or the mix in
// use now), read back in after checking every field, and its CSS made
// safe for a file that must open offline — nothing fetched (no @import, no
// url() but data:), nothing that runs (no expression(), no javascript:),
// no way out of the <style> element.

import { LAYOUTS, type AsmSettings, type ThemeFile } from './model'
import { THEMES, type Theme } from './themes'

const HEX = /^#[0-9a-fA-F]{6}$/
const COLOURS = ['accent', 'ink', 'muted', 'paper', 'rule', 'wash'] as const
const FONTS = ['font', 'heading', 'mono'] as const
export const CSS_MAX = 20_000

/** The CSS with everything taken out that could reach the network, run
 *  code or leave the style element; and what was taken out. */
export function safeCss(css: string): { css: string; removed: string[] } {
  const removed: string[] = []
  let out = css.slice(0, CSS_MAX)
  if (css.length > CSS_MAX) removed.push(`everything past ${CSS_MAX} characters`)
  const cut = (re: RegExp, what: string) => {
    if (re.test(out)) removed.push(what)
    out = out.replace(re, '/* removed */')
  }
  cut(/<\/?\s*style[^>]*>?/gi, 'a style tag')
  cut(/<[!/]?[a-z][^>]*>?/gi, 'markup')
  cut(/@import[^;]*;?/gi, '@import')
  cut(/url\(\s*(?!["']?data:)[^)]*\)/gi, 'url() to a file or address')
  cut(/expression\s*\([^)]*\)/gi, 'expression()')
  cut(/javascript\s*:/gi, 'javascript:')
  cut(/-moz-binding[^;]*;?/gi, '-moz-binding')
  cut(/behavior\s*:[^;]*;?/gi, 'behavior')
  return { css: out, removed }
}

/** Why a theme file can't be read; none when it can. */
export function checkThemeFile(x: unknown): string[] {
  const e: string[] = []
  const t = x as ThemeFile
  if (!t || typeof t !== 'object') return ['A theme file is a JSON object.']
  if (t.scanrulerManualTheme !== 1) e.push('scanrulerManualTheme: 1 says this is a manual theme file.')
  if (typeof t.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(t.id)) e.push('id: lowercase letters, digits and dashes.')
  else if (THEMES.some((b) => b.id === t.id)) e.push(`id: "${t.id}" is a shipped theme; give yours its own.`)
  if (typeof t.name !== 'string' || !t.name.trim() || t.name.length > 60) e.push('name: what it is called, up to 60 characters.')
  if (t.about !== undefined && (typeof t.about !== 'string' || t.about.length > 300)) e.push('about: up to 300 characters.')
  const l = t.look
  if (!l || typeof l !== 'object') e.push('look: the colours, fonts and styles.')
  else {
    for (const k of COLOURS) if (typeof l[k] !== 'string' || !HEX.test(l[k])) e.push(`look.${k}: a colour as '#rrggbb'.`)
    for (const k of FONTS) if (typeof l[k] !== 'string' || !l[k].trim() || l[k].length > 200 || /[{};<>]|url\(/i.test(l[k])) e.push(`look.${k}: a CSS font list — 'Inter', system-ui, sans-serif — with no ; { } < > or url().`)
    if (typeof l.size !== 'number' || l.size < 10 || l.size > 28) e.push('look.size: the type size, 10 to 28 px.')
    if (!['outline', 'filled'].includes(l.balloon)) e.push('look.balloon: outline or filled.')
    if (!['box', 'big', 'plain'].includes(l.badge)) e.push('look.badge: box, big or plain.')
    if (typeof l.sheetColour !== 'boolean') e.push('look.sheetColour: true or false — whether the PDF pages carry the accent.')
  }
  if (t.layout !== undefined) {
    const y = t.layout
    if (!y || typeof y !== 'object') e.push('layout: an object, or leave it out.')
    else {
      if (y.layout !== undefined && !LAYOUTS.includes(y.layout)) e.push(`layout.layout: ${LAYOUTS.join(', ')}.`)
      if (y.words !== undefined && !['show', 'hide'].includes(y.words)) e.push('layout.words: show or hide.')
      if (y.partsBox !== undefined && !['side', 'corner'].includes(y.partsBox)) e.push('layout.partsBox: side or corner.')
      if (y.hardwarePage !== undefined && typeof y.hardwarePage !== 'boolean') e.push('layout.hardwarePage: true or false.')
    }
  }
  if (t.css !== undefined && typeof t.css !== 'string') e.push('css: a string of CSS, or leave it out.')
  return e
}

/** A theme as a file — with the settings' accent and layout switches when
 *  it is the one in use. */
export function toThemeFile(theme: Theme, s?: AsmSettings): ThemeFile {
  const { id, name, about, css, accent, ink, muted, paper, rule, wash, font, heading, mono, size, balloon, badge, sheetColour } = theme
  return {
    scanrulerManualTheme: 1,
    id: theme.custom ? id : `my-${id}`,
    name: theme.custom ? name : `${name} (mine)`,
    about,
    look: { accent: s?.accent ?? accent, ink, muted, paper, rule, wash, font, heading, mono, size, balloon, badge, sheetColour },
    ...(s ? { layout: { layout: s.layout, words: s.words, partsBox: s.partsBox, hardwarePage: s.hardwarePage } } : {}),
    css: css ?? '',
  }
}
