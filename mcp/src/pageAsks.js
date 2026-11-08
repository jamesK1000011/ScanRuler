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
import { feaTools, MATERIALS, solve } from './extras/fea.js'

const ACTIONS = new Set(['search', 'files', 'take', 'open', 'status', 'cancel'])

/** What is being asked now, by request, to cancel. */
const running = new Map()
/** Asks cancelled before they came, for 30 s. */
const cancelled = new Map()

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
    // The page's Cancel: stops the ask it names; the page has stopped
    // waiting already, so nothing is answered.
    if (data.action === 'cancel') {
      const of = String(data.of ?? '').slice(0, 40)
      running.get(of)?.abort()
      // A cancel that came before its ask: the ask, when it comes, is dropped.
      cancelled.set(of, Date.now())
      for (const [k, t] of cancelled) if (Date.now() - t > 30_000) cancelled.delete(k)
      return
    }
    if (running.has(req) || cancelled.has(req)) return
    if (running.size >= 6) {
      await link.run('catalog.answer', { req, ok: false, error: 'Too many asks at once: wait for one to finish.' }).catch(() => {})
      return
    }
    if (data.action === 'open' && data.as !== 'scan' && data.as !== 'reference') {
      await link.run('catalog.answer', { req, ok: false, error: 'Open it as the scan or as the reference.' }).catch(() => {})
      return
    }
    const ctl = new AbortController()
    running.set(req, ctl)
    const signal = ctl.signal
    let answer
    try {
      let result
      if (data.action === 'search') result = await searchModels({ query: String(data.query ?? ''), sources: Array.isArray(data.sources) ? data.sources.map(String) : undefined, page: Number(data.page) || 1, thumbnails: true, signal, ...(data.cursors && typeof data.cursors === 'object' ? { cursors: data.cursors } : {}) }, env)
      else if (data.action === 'files') result = await modelFiles({ source: String(data.source), id: String(data.id), signal }, env)
      else if (data.action === 'take') {
        result = await takeModel({ source: String(data.source), id: String(data.id), ...(data.file ? { file: String(data.file) } : {}), signal }, env)
        for (const p of result.taken ?? []) taken.add(p)
      } else if (data.action === 'open') {
        const path = String(data.path ?? '')
        if (!taken.has(path)) throw new Error('Only a file just brought in from a library opens from here.')
        const as = data.as === 'scan' ? 'scan.open' : 'deviation.open_reference'
        const bytes = new Uint8Array(await readFile(path))
        // Cancelled while the file was read: it is not opened.
        if (signal.aborted) return
        await link.run(as, { bytes, name: basename(path), ...(as === 'scan.open' && data.discard === true ? { discard: true } : {}) }, 'bytes')
        result = { opened: basename(path), as: as === 'scan.open' ? 'scan' : 'reference' }
      } else result = await librariesStatus(env)
      answer = { req, ok: true, result }
    } catch (e) {
      answer = { req, ok: false, error: String(e?.message ?? e).slice(0, 300) }
    } finally {
      running.delete(req)
    }
    if (signal.aborted) return
    await link.run('catalog.answer', answer).catch((e) => log(`The catalog's answer did not reach the page: ${e.message}`))
  })
}

/** The FEA panel's asks (fea.solve: tools, solve, cancel): the part meshed
 *  and solved on this computer by Gmsh and CalculiX (extras/fea.js), how
 *  far it has got said as it goes (fea.progress), the answer as fea.answer.
 *  One solve at a time: a second waits its turn, or is cancelled. */
export function attachFeaAsks({ link, holds = () => true, env = process.env, log = () => {} }) {
  const running = new Map()
  let queue = Promise.resolve()
  link.on?.('notice', async ({ kind, data }) => {
    if (kind !== 'fea.solve' || !holds()) return
    const req = typeof data?.req === 'string' ? data.req.slice(0, 40) : null
    if (!req || !['tools', 'solve', 'cancel'].includes(data.action)) return
    if (data.action === 'cancel') {
      running.get(String(data.of ?? '').slice(0, 40))?.abort()
      return
    }
    if (running.has(req)) return
    const ctl = new AbortController()
    running.set(req, ctl)
    const say = (phase, detail) => link.run('fea.progress', { req, phase, detail: String(detail ?? '').slice(0, 200) }).catch(() => {})
    let answer
    const work = async () => {
      try {
        if (ctl.signal.aborted) throw Object.assign(new Error('Cancelled.'), { cancelled: true })
        const result = data.action === 'tools' ? { ...(await feaTools(env)), materials: MATERIALS } : await solve(data.job, env, { signal: ctl.signal, progress: say })
        answer = { req, ok: true, result }
      } catch (e) {
        answer = { req, ok: false, error: String(e?.message ?? e).slice(0, 500) }
      } finally {
        running.delete(req)
      }
      if (ctl.signal.aborted) return
      await link.run('fea.answer', answer).catch((e) => log(`The FEA answer did not reach the page: ${e.message}`))
    }
    if (data.action === 'tools') return work()
    queue = queue.then(work, work)
  })
}
