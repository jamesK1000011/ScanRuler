// SPDX-License-Identifier: AGPL-3.0-only
// catalog.*: what standard part a scan is, from the dimensions measured on
// it; where to find a part's CAD; and where each file brought into the
// project came from. Offline — the downloads themselves come in through
// the MCP server's catalog_* tools, on this computer.

import { arr, bool, enumOf, int, obj, str, anyObject } from '../../../src/commands/schema'
import { type Command, CommandError } from '../../../src/plugins/api'
import { links, SOURCES } from '../core/links'
import { KINDS, lookup, match, PARTS, type Kind } from '../core/standards'
import { useCatalog } from '../state/catalogStore'
import { answered } from '../state/modelsStore'

const KIND_IDS = KINDS.map((k) => k.kind)

export const kinds: Command<Record<string, never>> = {
  name: 'kinds',
  title: 'The standard parts known offline',
  description: 'The kinds of standard part catalog.match and catalog.lookup know without a network — socket and button head screws, hex nuts, washers, ball bearings — each with its standard, what each dimension means for a person with calipers, and how many sizes. Changes nothing.',
  input: obj({}),
  readOnly: true,
  run: async () => ({ kinds: KINDS.map((k) => ({ ...k, sizes: PARTS.filter((p) => p.kind === k.kind).length })) }),
}

export const lookupCommand: Command<{ designation: string }> = {
  name: 'lookup',
  title: 'Look up a standard part',
  description: 'A standard part’s nominal dimensions by name — "M5 socket head", "608", "M8 washer", "M4" (every M4 part). Changes nothing.',
  input: obj({ designation: str('The part, or the start of its name.', { minLength: 1 }) }, ['designation']),
  readOnly: true,
  run: async ({ designation }) => {
    const hits = lookup(designation)
    if (!hits.length) throw new CommandError('not_found', `No standard part "${designation}" — catalog.kinds lists what is known.`)
    return { parts: hits }
  },
}

export const matchCommand: Command<{ dims: Record<string, number>; kind?: Kind; limit?: number }> = {
  name: 'match',
  title: 'Which standard part is this',
  description:
    'The standard parts whose nominal dimensions fit the ones measured (with element fits, sections or the person’s calipers), best first: each with every dimension’s nominal, measured and difference, and the worst share off. Name dimensions as catalog.kinds does (a bearing: d, D, B; a screw head: dk, k, s). A part worn, printed or from a maker’s own range fits loosely; worst under about 3 % is a good fit. Changes nothing.',
  input: obj({ dims: anyObject('Measured dimensions by name, mm: { "d": 8, "D": 22, "B": 7 }.'), kind: enumOf(KIND_IDS, 'Only this kind.'), limit: int('How many, 5 by default.', { minimum: 1, maximum: 20 }) }, ['dims']),
  readOnly: true,
  run: async ({ dims, kind, limit = 5 }) => {
    for (const [k, v] of Object.entries(dims)) if (typeof v !== 'number' || !(v > 0)) throw new CommandError('invalid_input', `dims.${k} must be a positive number of mm.`)
    const hits = match(dims, kind, limit)
    if (!hits.length) throw new CommandError('not_found', `No kind has all of ${Object.keys(dims).join(', ')} — catalog.kinds says which dimensions each has.`)
    return { matches: hits.map((m) => ({ designation: m.part.designation, kind: m.part.kind, standard: m.part.standard, worst: m.worst, agree: m.agree })), fit: hits[0].worst <= 0.03 ? 'good' : hits[0].worst <= 0.08 ? 'loose' : 'none close' }
  },
}

export const linksCommand: Command<{ query: string; sources?: string[] }> = {
  name: 'links',
  title: 'Where to find a part’s CAD',
  description: `Search pages for a part on the catalogues and model libraries (${SOURCES.map((s) => s.id).join(', ')}), each with what its terms allow for a downloaded model. Build the query from the person’s words and what was measured ("M5 x 16 socket head cap screw ISO 4762", "608 bearing", "Milwaukee M18 battery latch"). Give the person the links, or open one with catalog_open_url; they click download, and catalog_take brings the file in. Changes nothing.`,
  input: obj({ query: str('What to search for.', { minLength: 1 }), sources: arr(enumOf(SOURCES.map((s) => s.id)), 'Only these.', { minItems: 1 }) }, ['query']),
  readOnly: true,
  run: async ({ query, sources }) => ({ query, links: links(query, sources) }),
}

export const provenance: Command<{ action?: 'list' | 'record' | 'forget'; file?: string; source?: string; url?: string; licence?: string; redistribute?: boolean; note?: string }> = {
  name: 'provenance',
  title: 'Where the project’s parts came from',
  description: 'The record of each file brought into this project: its source, page, licence and whether it may be shared on. record: add or replace one (catalog_take records its own in the imports folder; record it here too so it stays with the project). forget: drop one. Kept with the project; library-pack leaves out anything not to be redistributed.',
  input: obj({ action: enumOf(['list', 'record', 'forget'], 'list by default.'), file: str('The file’s name.'), source: str('Where from: a source id or a name.'), url: str('The page it came from.'), licence: str('Its licence, as the page says.'), redistribute: bool('May it be shared on? false unless its licence says so.'), note: str('Anything else.') }),
  history: false,
  run: async ({ action = 'list', file, source, url, licence, redistribute, note }) => {
    const st = useCatalog.getState()
    if (action === 'record') {
      if (!file || !source) throw new CommandError('invalid_input', 'record needs file and source.')
      st.record({ file, source, ...(url ? { url } : {}), ...(licence ? { licence } : {}), redistribute: redistribute === true, ...(note ? { note } : {}), at: new Date().toISOString() })
    } else if (action === 'forget') {
      if (!file || !st.forget(file)) throw new CommandError('not_found', `No record for "${file}".`)
    }
    return { parts: useCatalog.getState().parts }
  },
}

export const answerCommand: Command<{ req: string; ok: boolean; result?: unknown; error?: string }> = {
  name: 'answer',
  title: 'A model library’s answer',
  description: 'Used by the agent’s server: the answer to a search, a file list or a take the Catalog panel asked of it. Not for an agent.',
  input: obj({ req: str(), ok: bool(), result: anyObject('The answer.'), error: str() }, ['req', 'ok']),
  readOnly: true,
  history: false,
  internal: true,
  run: async (a) => ({ taken: answered(a) }),
}

export const catalogCommands = [kinds, lookupCommand, matchCommand, linksCommand, provenance, answerCommand] as Command<never>[]
