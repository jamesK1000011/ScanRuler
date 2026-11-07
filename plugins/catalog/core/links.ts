// SPDX-License-Identifier: AGPL-3.0-only
// Where to look for a part's CAD, as search pages a person opens: the
// catalogues and libraries, each with what its terms let you do with what
// you download. No page is fetched from here and nothing is downloaded by
// a program — the person clicks download, and catalog_take brings the file
// in from their downloads.

export interface Source {
  id: string
  label: string
  kind: 'catalogue' | 'library'
  url: (q: string) => string
  /** What the source's terms allow for a downloaded model, in short. */
  terms: string
}

export const SOURCES: readonly Source[] = [
  { id: 'traceparts', label: 'TraceParts', kind: 'catalogue', url: (q) => `https://www.traceparts.com/en/search?Keywords=${encodeURIComponent(q)}`, terms: 'Free account. Models are for your own design work; do not redistribute them (library-pack leaves them out).' },
  { id: 'mcmaster', label: 'McMaster-Carr', kind: 'catalogue', url: (q) => `https://www.mcmaster.com/${encodeURIComponent(q.trim().replace(/\s+/g, '-'))}/`, terms: 'CAD offered per product for designing with that product; do not redistribute.' },
  { id: 'misumi', label: 'MISUMI', kind: 'catalogue', url: (q) => `https://us.misumi-ec.com/vona2/result/?Keyword=${encodeURIComponent(q)}`, terms: 'Account needed for CAD; for designing with MISUMI parts; do not redistribute.' },
  { id: 'printables', label: 'Printables', kind: 'library', url: (q) => `https://www.printables.com/search/models?q=${encodeURIComponent(q)}`, terms: 'Each model carries its own licence: read it on the model’s page and record it when you take the file.' },
  { id: 'thangs', label: 'Thangs', kind: 'library', url: (q) => `https://thangs.com/search/${encodeURIComponent(q)}?scope=all`, terms: 'Each model carries its own licence: read it on the model’s page and record it when you take the file.' },
  { id: 'grabcad', label: 'GrabCAD Community', kind: 'library', url: (q) => `https://grabcad.com/library?query=${encodeURIComponent(q)}`, terms: 'Models for personal use under GrabCAD’s terms unless the author says otherwise; do not redistribute.' },
]

export function links(query: string, ids?: readonly string[]) {
  return SOURCES.filter((s) => !ids || ids.includes(s.id)).map((s) => ({ source: s.id, label: s.label, kind: s.kind, url: s.url(query), terms: s.terms }))
}
