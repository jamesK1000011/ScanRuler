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
import { buildInTurn, buildsWaiting, circuitTools, files as circuitFiles, newProject, readCircuitFile, templatesInfo } from './extras/circuit.js'

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
    if (data.action === 'open' && data.as !== 'scan' && data.as !== 'reference' && data.as !== 'body') {
      await link.run('catalog.answer', { req, ok: false, error: 'Open it as the scan, the reference or a body.' }).catch(() => {})
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
        // A body: a STEP file into Reverse Engineer as bodies of its own.
        if (data.as === 'body' && !/\.(step|stp)$/i.test(path)) throw new Error('Only a STEP file opens as a body.')
        const as = data.as === 'scan' ? 'scan.open' : data.as === 'body' ? 'reverse.import.step' : 'deviation.open_reference'
        const bytes = new Uint8Array(await readFile(path))
        // Cancelled while the file was read: it is not opened.
        if (signal.aborted) return
        await link.run(as, { bytes, name: basename(path), ...(as === 'scan.open' && data.discard === true ? { discard: true } : {}) }, 'bytes')
        result = { opened: basename(path), as: data.as }
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
export function attachFeaAsks({ link, holds = () => true, env = process.env, log = () => {}, waiting = 3 }) {
  const running = new Map()
  // A cancel that came before its solve: kept a while, so the solve is not run.
  const cancelledEarly = new Map()
  let queued = 0
  let queue = Promise.resolve()
  link.on?.('notice', async ({ kind, data }) => {
    if (kind !== 'fea.solve' || !holds()) return
    const req = typeof data?.req === 'string' ? data.req.slice(0, 40) : null
    if (!req || !['tools', 'solve', 'cancel'].includes(data.action)) return
    if (data.action === 'cancel') {
      const of = String(data.of ?? '').slice(0, 40)
      const ctl = running.get(of)
      if (ctl) ctl.abort()
      else if (of) {
        const now = Date.now()
        for (const [k, t] of cancelledEarly) if (now - t > 30_000) cancelledEarly.delete(k)
        if (cancelledEarly.size < 50) cancelledEarly.set(of, now)
      }
      return
    }
    if (running.has(req)) return
    if (cancelledEarly.delete(req)) return
    const ctl = new AbortController()
    const say = (phase, detail) => link.run('fea.progress', { req, phase, detail: String(detail ?? '').slice(0, 200) }).catch(() => {})
    const answerNow = (answer) => link.run('fea.answer', answer).catch((e) => log(`The FEA answer did not reach the page: ${e.message}`))
    if (data.action === 'solve' && queued >= waiting) return answerNow({ req, ok: false, error: `${queued} studies are already waiting to solve: cancel one, or wait for them.` })
    running.set(req, ctl)
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
      await answerNow(answer)
    }
    if (data.action === 'tools') return work()
    queued++
    const turn = async () => {
      queued--
      await work()
    }
    queue = queue.then(turn, turn)
  })
}

/** The Circuit workspace's asks (circuit.tsci: tools, new, build, files,
 *  read, cancel): tscircuit's command line run on this computer
 *  (extras/circuit.js), how far a build has got said as it goes
 *  (circuit.progress), the answer as circuit.answer. Builds run one at a
 *  time, the agent's circuit_build among them; a few may wait. */
export function attachCircuitAsks({ link, holds = () => true, env = process.env, log = () => {}, waiting = 3 }) {
  const running = new Map()
  const cancelledEarly = new Map()
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]))
  link.on?.('notice', async ({ kind, data }) => {
    if (kind !== 'circuit.tsci' || !holds()) return
    const req = typeof data?.req === 'string' ? data.req.slice(0, 40) : null
    if (!req || !['tools', 'new', 'build', 'files', 'read', 'cancel'].includes(data.action)) return
    if (data.action === 'cancel') {
      const of = String(data.of ?? '').slice(0, 40)
      const ctl = running.get(of)
      if (ctl) ctl.abort()
      else if (of) {
        const now = Date.now()
        for (const [k, t] of cancelledEarly) if (now - t > 30_000) cancelledEarly.delete(k)
        if (cancelledEarly.size < 50) cancelledEarly.set(of, now)
      }
      return
    }
    if (running.has(req) || cancelledEarly.delete(req)) return
    const answerNow = (answer) => link.run('circuit.answer', answer).catch((e) => log(`The circuit answer did not reach the page: ${e.message}`))
    if (running.size >= 8) return answerNow({ req, ok: false, error: 'Too many asks at once: wait for one to finish.' })
    if (data.action === 'build' && buildsWaiting() >= waiting) return answerNow({ req, ok: false, error: `${buildsWaiting()} builds are waiting already: cancel one, or wait for them.` })
    const ctl = new AbortController()
    running.set(req, ctl)
    const say = (phase, detail) => link.run('circuit.progress', { req, phase: String(phase).slice(0, 40), detail: String(detail ?? '').slice(0, 200) }).catch(() => {})
    let answer
    try {
      const a = data.args && typeof data.args === 'object' && !Array.isArray(data.args) ? data.args : {}
      let result
      if (data.action === 'tools') result = { ...(await circuitTools(env)), templates: templatesInfo() }
      else if (data.action === 'new') result = await newProject(pick(a, ['name', 'template', 'params', 'dir']), env)
      else if (data.action === 'build') result = await buildInTurn(pick(a, ['project', 'entry', 'outputs', 'routing', 'partsEngine', 'name']), env, { signal: ctl.signal, progress: say })
      else if (data.action === 'files') result = await circuitFiles(pick(a, ['project', 'job']), env)
      else result = await readCircuitFile(pick(a, ['path', 'project', 'job', 'entry']), env)
      answer = { req, ok: true, result }
    } catch (e) {
      answer = { req, ok: false, error: String(e?.message ?? e).slice(0, 800), ...(e?.job ? { result: e.job } : {}) }
    } finally {
      running.delete(req)
    }
    if (ctl.signal.aborted) return
    await answerNow(answer)
  })
}
