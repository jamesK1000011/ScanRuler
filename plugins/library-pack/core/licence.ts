// SPDX-License-Identifier: AGPL-3.0-only
// The licences a pack can carry, and whether a remix of an upstream part
// may go out under the one chosen. A table written for this plugin from
// each licence's terms as they are commonly read: a guide for the person,
// not legal advice, and the person confirms each upstream licence.

export const LICENCES = {
  'CC-BY-4.0': { name: 'Creative Commons Attribution 4.0', short: 'CC BY', url: 'https://creativecommons.org/licenses/by/4.0/', commercial: true, adapt: true, shareAlike: false },
  'CC-BY-SA-4.0': { name: 'Creative Commons Attribution-ShareAlike 4.0', short: 'CC BY-SA', url: 'https://creativecommons.org/licenses/by-sa/4.0/', commercial: true, adapt: true, shareAlike: true },
  'CC-BY-NC-4.0': { name: 'Creative Commons Attribution-NonCommercial 4.0', short: 'CC BY-NC', url: 'https://creativecommons.org/licenses/by-nc/4.0/', commercial: false, adapt: true, shareAlike: false },
  'CC-BY-NC-SA-4.0': { name: 'Creative Commons Attribution-NonCommercial-ShareAlike 4.0', short: 'CC BY-NC-SA', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/', commercial: false, adapt: true, shareAlike: true },
  'CC-BY-ND-4.0': { name: 'Creative Commons Attribution-NoDerivatives 4.0', short: 'CC BY-ND', url: 'https://creativecommons.org/licenses/by-nd/4.0/', commercial: true, adapt: false, shareAlike: false },
  'CC-BY-NC-ND-4.0': { name: 'Creative Commons Attribution-NonCommercial-NoDerivatives 4.0', short: 'CC BY-NC-ND', url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/', commercial: false, adapt: false, shareAlike: false },
  'CC0-1.0': { name: 'CC0 1.0 Universal (public domain dedication)', short: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', commercial: true, adapt: true, shareAlike: false },
  MIT: { name: 'MIT License', short: 'MIT', url: 'https://opensource.org/license/mit', commercial: true, adapt: true, shareAlike: false },
  'GPL-3.0-only': { name: 'GNU General Public License v3.0', short: 'GPL-3.0', url: 'https://www.gnu.org/licenses/gpl-3.0.html', commercial: true, adapt: true, shareAlike: true },
  ARR: { name: 'All rights reserved', short: 'All rights reserved', url: '', commercial: false, adapt: false, shareAlike: false },
} as const

export type LicenceId = keyof typeof LICENCES

/** The licences a pack may be released under (ND and NC-ND can't carry a
 *  remix, but can carry one's own work). */
export const PACK_LICENCES = Object.keys(LICENCES) as LicenceId[]

const ALIASES: [RegExp, LicenceId][] = [
  [/^cc[\s-]*0|public\s*domain|cc0/i, 'CC0-1.0'],
  [/by[\s-]*nc[\s-]*nd/i, 'CC-BY-NC-ND-4.0'],
  [/by[\s-]*nc[\s-]*sa/i, 'CC-BY-NC-SA-4.0'],
  [/by[\s-]*nc/i, 'CC-BY-NC-4.0'],
  [/by[\s-]*nd/i, 'CC-BY-ND-4.0'],
  [/by[\s-]*sa/i, 'CC-BY-SA-4.0'],
  [/(cc[\s-]*by|attribution)(?![\s-]*(sa|nc|nd))/i, 'CC-BY-4.0'],
  [/^mit/i, 'MIT'],
  [/gpl[\s-]*v?3|gnu general public/i, 'GPL-3.0-only'],
  [/all rights reserved|^arr$|proprietary|standard digital file|personal use/i, 'ARR'],
]

/** A licence as a page or person wrote it, read as one of the table's. */
export function readLicence(text: string | undefined): LicenceId | null {
  if (!text) return null
  if (text in LICENCES) return text as LicenceId
  const t = text
    .replace(/non[\s-]*commercial/gi, 'NC')
    .replace(/share[\s-]*alike/gi, 'SA')
    .replace(/no[\s-]*deriv(ative)?s?/gi, 'ND')
    .replace(/creative\s*commons\s*[-–—]?\s*attribution|attribution/gi, 'CC BY')
    .replace(/\s*[-–—]\s*/g, '-')
  for (const [re, id] of ALIASES) if (re.test(t)) return id
  return null
}

export interface Verdict {
  ok: boolean
  why: string
  /** What the pack must carry for this part. */
  needs?: string[]
}

/** May a part under `upstream` go out in a pack under `chosen`? modified:
 *  the part was changed (a remix), not just included as it came. */
export function compatible(upstream: LicenceId | null, chosen: LicenceId, opts: { modified?: boolean; permission?: boolean } = {}): Verdict {
  const modified = opts.modified ?? true
  const c = LICENCES[chosen]
  if (!upstream) return opts.permission ? { ok: true, why: 'Its licence is unknown, and you said you have the author’s permission.', needs: ['credit the author'] } : { ok: false, why: 'Its licence is unknown. Find it on the source page, or confirm you have the author’s permission.' }
  const u = LICENCES[upstream]
  if (upstream === 'ARR') return opts.permission ? { ok: true, why: 'All rights reserved, with the author’s permission you confirmed.', needs: ['credit the author'] } : { ok: false, why: 'Its author reserved all rights: it can’t be shared on, changed or not, without their permission.' }
  if (modified && !u.adapt) return { ok: false, why: `${u.short} allows sharing it only unchanged; a remix of it can’t be shared. Leave it out, or ask its author.` }
  if (!u.commercial && c.commercial) return { ok: false, why: `${u.short} forbids commercial use, and ${c.short} would allow it. Pick a NonCommercial licence (CC BY-NC or CC BY-NC-SA).` }
  if (modified && u.shareAlike) {
    const same = upstream === chosen || (upstream === 'CC-BY-SA-4.0' && chosen === 'GPL-3.0-only')
    if (!same) return { ok: false, why: `${u.short} is ShareAlike: a remix must go out under ${u.short}${upstream === 'CC-BY-SA-4.0' ? ' (or GPL-3.0, which it allows one way)' : ''}, not ${c.short}.` }
  }
  if (upstream === 'GPL-3.0-only' && chosen !== 'GPL-3.0-only') return { ok: false, why: `GPL-3.0 work goes out under GPL-3.0, not ${c.short}.` }
  if (!modified && !u.adapt) return { ok: true, why: `${u.short}, included unchanged under its own licence.`, needs: ['credit the author', `keep it under ${u.short}, marked as such`] }
  const needs = upstream === 'CC0-1.0' ? [] : upstream === 'MIT' ? ['keep its copyright and licence notice'] : ['credit the author, link the source and the licence', ...(modified ? ['say it was changed'] : [])]
  return { ok: true, why: `${u.short} allows ${modified ? 'a remix' : 'it'} under ${c.short}.`, needs }
}

/** Sources whose terms don't allow passing their files on: left out of a
 *  pack and linked instead. */
export const RESTRICTED_SOURCES = ['traceparts', 'mcmaster', 'misumi', 'grabcad']

export function licenceFile(id: LicenceId, holder: string, year: number): string {
  const l = LICENCES[id]
  if (id === 'MIT')
    return `MIT License\n\nCopyright (c) ${year} ${holder}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n`
  if (id === 'ARR') return `Copyright (c) ${year} ${holder}. All rights reserved.\n\nNo part of these files may be copied, changed or shared without the copyright holder's written permission.\n`
  if (id === 'GPL-3.0-only') return `Copyright (C) ${year} ${holder}\n\nThis work is licensed under the GNU General Public License, version 3 only.\nThe full text of the licence must travel with it: replace this file with ${'https://www.gnu.org/licenses/gpl-3.0.txt'}\n(library-pack does not fetch it).\n`
  return `Copyright (c) ${year} ${holder}\n\nThis work is licensed under the ${l.name} licence (${l.short}).\nTo view a copy of this licence, visit ${l.url}\n`
}
