// SPDX-License-Identifier: AGPL-3.0-only
// What the page asks this server to do for it — today, the Catalog panel's
// model search: the libraries' APIs need keys this server keeps (in the
// Keychain or the secrets file) and the page never sees. The page asks with
// a notice (catalog.models: search, files, take, open, status) and the
// answer goes back as a run of its internal catalog.answer command. Only the
// copy that holds the tab's connection answers, so a relaying copy does not
// ask the library a second time. Nothing here is offered as a tool: the page
// is the only one that asks.

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { librariesStatus, modelFiles, searchModels, takeModel } from './extras/models.js'

const ACTIONS = new Set(['search', 'files', 'take', 'open', 'status'])

/** The files a take may open: those it just brought in, by path. */
const taken = new Set()

/**
 * link: the page link (emits 'notice', runs page commands); holds(): whether
 * this copy holds the tab's connection; env; log.
 */
export function attachPageAsks({ link, holds = () => true, env = process.env, log = () => {} }) {
  link.on?.('notice', async ({ kind, data }) => {
    if (kind !== 'catalog.models' || !holds()) return
    const req = typeof data?.req === 'string' ? data.req.slice(0, 40) : null
    if (!req || !ACTIONS.has(data.action)) return
    let answer
    try {
      let result
      if (data.action === 'search') result = await searchModels({ query: String(data.query ?? ''), sources: Array.isArray(data.sources) ? data.sources.map(String) : undefined, page: Number(data.page) || 1, thumbnails: true }, env)
      else if (data.action === 'files') result = await modelFiles({ source: String(data.source), id: String(data.id) }, env)
      else if (data.action === 'take') {
        result = await takeModel({ source: String(data.source), id: String(data.id), ...(data.file ? { file: String(data.file) } : {}) }, env)
        for (const p of result.taken ?? []) taken.add(p)
      } else if (data.action === 'open') {
        const path = String(data.path ?? '')
        if (!taken.has(path)) throw new Error('Only a file just brought in from a library opens from here.')
        const as = data.as === 'scan' ? 'scan.open' : 'deviation.open_reference'
        const bytes = new Uint8Array(await readFile(path))
        await link.run(as, { bytes, name: basename(path), ...(as === 'scan.open' && data.discard === true ? { discard: true } : {}) }, 'bytes')
        result = { opened: basename(path), as: as === 'scan.open' ? 'scan' : 'reference' }
      } else result = await librariesStatus(env)
      answer = { req, ok: true, result }
    } catch (e) {
      answer = { req, ok: false, error: String(e?.message ?? e).slice(0, 300) }
    }
    await link.run('catalog.answer', answer).catch((e) => log(`The catalog's answer did not reach the page: ${e.message}`))
  })
}
