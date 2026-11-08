// SPDX-License-Identifier: AGPL-3.0-only
// What goes in a pack and what can't: each upstream part checked against
// the licence chosen, parts from sources that don't allow passing files on
// left out and linked, and the README and attribution written.

import { compatible, LICENCES, readLicence, RESTRICTED_SOURCES, type LicenceId } from './licence'

export interface Upstream {
  /** The part's name here: a body name, or an imported file's name. */
  part: string
  /** The Reverse Engineer body it became, if any. */
  body?: string
  title?: string
  author?: string
  url?: string
  /** Its licence, as the source page said it. */
  licence?: string
  source?: string
  /** May its files be shared on (catalog's record). */
  redistribute?: boolean
  /** Changed from what was downloaded (a remix); true unless said. */
  modified?: boolean
  /** The person confirmed the author's permission. */
  permission?: boolean
}

export interface PackSettings {
  title: string
  author: string
  summary: string
  printSettings: string
  licence: LicenceId | null
  platform: string
  includeStep: boolean
  include3mf: boolean
  includeNotes: boolean
  includeManual: boolean
  renders: number
}

export const DEFAULT_PACK: PackSettings = { title: 'Untitled part', author: '', summary: '', printSettings: '', licence: null, platform: 'printables', includeStep: true, include3mf: true, includeNotes: false, includeManual: true, renders: 4 }

export interface Planned {
  ok: boolean
  licence: LicenceId | null
  /** Parts in the pack, with what it must carry for them. */
  credited: { part: string; title?: string; author?: string; url?: string; licence: string; needs: string[]; modified: boolean }[]
  /** Parts left out because their source's terms don't allow sharing. */
  leftOut: { part: string; body?: string; url?: string; source?: string; why: string }[]
  /** Parts that stop the pack under this licence. */
  blocked: { part: string; why: string }[]
  problems: string[]
}

export function plan(s: PackSettings, upstream: Upstream[]): Planned {
  const credited: Planned['credited'] = []
  const leftOut: Planned['leftOut'] = []
  const blocked: Planned['blocked'] = []
  const problems: string[] = []
  if (!s.licence) problems.push('No licence chosen yet: pack.licence { id }.')
  if (!s.author.trim()) problems.push('No author (the copyright holder) yet: pack.settings { author }.')
  for (const u of upstream) {
    const src = (u.source ?? '').toLowerCase()
    if (u.redistribute === false || RESTRICTED_SOURCES.some((r) => src.includes(r))) {
      leftOut.push({ part: u.part, ...(u.body ? { body: u.body } : {}), ...(u.url ? { url: u.url } : {}), ...(u.source ? { source: u.source } : {}), why: u.redistribute === false ? 'its licence or source doesn’t allow sharing its files' : `${u.source}’s terms don’t allow passing its files on` })
      continue
    }
    if (!s.licence) continue
    const up = readLicence(u.licence)
    const v = compatible(up, s.licence, { modified: u.modified, permission: u.permission })
    if (!v.ok) blocked.push({ part: u.part, why: v.why })
    else credited.push({ part: u.part, ...(u.title ? { title: u.title } : {}), ...(u.author ? { author: u.author } : {}), ...(u.url ? { url: u.url } : {}), licence: up ? LICENCES[up].short : 'used with permission', needs: v.needs ?? [], modified: u.modified ?? true })
    if (v.ok && up && up !== 'CC0-1.0' && (!u.author || !u.url)) problems.push(`${u.part}: its author and source page are needed to credit it (pack.attrib).`)
  }
  return { ok: blocked.length === 0 && Boolean(s.licence) && Boolean(s.author.trim()), licence: s.licence, credited, leftOut, blocked, problems }
}

export function attribution(p: Planned): string {
  if (!p.credited.length) return ''
  return [
    '## Attribution',
    '',
    ...p.credited.map((c) => `- ${c.modified ? 'Remixed from' : 'Includes'} **${mdText(c.title ?? c.part)}**${c.author ? ` by ${mdText(c.author)}` : ''}${webUrl(c.url) ? ` (${webUrl(c.url)})` : ''}, ${c.licence}.${c.modified ? ' Changed for this design.' : ''}`),
    '',
  ].join('\n')
}

export interface ReadmeInput {
  settings: PackSettings
  planned: Planned
  files: string[]
  fit?: { scaleXY?: number; contourOffset?: number; holeOffset?: number; fit?: string } | null
  dfm?: { errors: number; warnings: number; waived: number } | null
  scrubbed: { what: string; count: number }[]
}

/** Text the person wrote, made safe in Markdown: markup shows as typed
 *  rather than running on a site that renders the README. */
export const mdText = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A page link fit for a README: http(s) only. */
export const webUrl = (u: string | undefined) => (u && /^https?:\/\/[^\s<>"]+$/i.test(u) ? u : undefined)

export function readme(r: ReadmeInput): string {
  const s = { ...r.settings, title: mdText(r.settings.title), author: mdText(r.settings.author), summary: mdText(r.settings.summary), printSettings: mdText(r.settings.printSettings) }
  const l = s.licence ? LICENCES[s.licence] : null
  const out = [`# ${s.title}`, '']
  if (s.summary) out.push(s.summary, '')
  out.push(`By ${s.author || 'the author'}. ${l ? `Licensed ${l.short}${l.url ? ` (${l.url})` : ''}; see LICENSE.` : ''}`, '')
  out.push('## Files', '', ...r.files.map((f) => `- \`${f}\``), '')
  if (s.printSettings) out.push('## Print settings', '', s.printSettings, '')
  if (r.fit && (r.fit.scaleXY || r.fit.holeOffset || r.fit.contourOffset)) {
    // units-ok: the README quotes slicer settings, in millimetres
    out.push('## Fit on my printer', '', `Measured from a scan of a print (fit-comp): XY scale ${r.fit.scaleXY ?? '—'}, contour offset ${r.fit.contourOffset ?? '—'} mm, hole offset ${r.fit.holeOffset ?? '—'} mm. Your printer will differ; print a test first.`, '')
  }
  if (r.dfm) out.push('## Printability', '', `Checked for FDM printing (dfm-fdm): ${r.dfm.errors} errors, ${r.dfm.warnings} warnings open${r.dfm.waived ? `, ${r.dfm.waived} waived` : ''}.`, '')
  const att = attribution(r.planned)
  if (att) out.push(att)
  if (r.planned.leftOut.length) {
    out.push('## Parts not included', '', 'These come from sources that don’t allow passing their files on. Get them from the source:', '', ...r.planned.leftOut.map((x) => `- ${mdText(x.part)}${x.source ? ` (${mdText(x.source)})` : ''}${webUrl(x.url) ? `: ${webUrl(x.url)}` : ''}`), '')
  }
  out.push('---', '', 'Packed with ScanRuler’s library-pack. Personal details were removed from the files before packing.', '')
  return out.join('\n')
}

/** The upload form's fields, to paste. */
export function platformText(r: ReadmeInput, preset: { name: string; fields: { title: number; summary: number }; note?: string }): string {
  const s = r.settings
  const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
  const l = s.licence ? LICENCES[s.licence] : null
  return [
    `# ${preset.name} — fields to paste`,
    '',
    `Title (${preset.fields.title} characters here): ${cut(s.title, preset.fields.title)}`,
    '',
    `Summary (${preset.fields.summary}): ${cut(s.summary || s.title, preset.fields.summary)}`,
    '',
    `Licence: ${l ? `${l.name} (${l.short})` : 'choose one'}`,
    '',
    'Description:',
    '',
    readme(r).replace(/^# .*\n\n/, ''),
    ...(preset.note ? ['', `Note: ${preset.note}`] : []),
    '',
  ].join('\n')
}
