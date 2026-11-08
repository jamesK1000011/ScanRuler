// SPDX-License-Identifier: AGPL-3.0-only
// What the Boards workspace asks of this server: KiCad's kicad-cli run on
// this computer (extras/kicad.js), which the page cannot start. The page
// asks with a notice (pcb.kicad: tools, read, import, fab, drc, cancel); how
// far a run has got goes back as pcb.progress, the answer as pcb.answer —
// with the file's bytes (the board's STEP, the fab package's zip) as a
// binary frame. Only the copy that holds the tab's connection answers. One
// kicad-cli run at a time; a few more wait their turn.

import { fabPackage, importBoard, kicadTools, readBoardFile, runDrc } from './extras/kicad.js'

const ACTIONS = new Set(['tools', 'read', 'import', 'fab', 'drc', 'cancel'])

export function attachBoardAsks({ link, holds = () => true, env = process.env, log = () => {}, waiting = 3 }) {
  const running = new Map()
  const cancelledEarly = new Map()
  let queued = 0
  let queue = Promise.resolve()
  link.on?.('notice', async ({ kind, data }) => {
    if (kind !== 'pcb.kicad' || !holds()) return
    const req = typeof data?.req === 'string' ? data.req.slice(0, 40) : null
    if (!req || !ACTIONS.has(data.action)) return
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
    const ctl = new AbortController()
    const say = (phase, detail) => link.run('pcb.progress', { req, phase: String(phase).slice(0, 40), detail: String(detail ?? '').slice(0, 200) }).catch(() => {})
    const answerNow = (answer, bytes) => link.run('pcb.answer', bytes ? { ...answer, bytes } : answer, bytes ? 'bytes' : undefined).catch((e) => log(`The board answer did not reach the page: ${e.message}`))
    const heavy = data.action === 'import' || data.action === 'fab' || data.action === 'drc'
    if (heavy && queued >= waiting) return answerNow({ req, ok: false, error: `${queued} KiCad runs are already waiting: wait for them, or stop one.` })
    running.set(req, ctl)
    const work = async () => {
      let answer
      let bytes
      try {
        if (ctl.signal.aborted) throw Object.assign(new Error('Cancelled.'), { cancelled: true })
        const opts = { signal: ctl.signal, progress: say }
        const path = typeof data.path === 'string' ? data.path : ''
        if (data.action === 'tools') answer = { req, ok: true, result: await kicadTools(env, { fresh: data.fresh === true }) }
        else if (data.action === 'read') answer = { req, ok: true, result: await readBoardFile(path, env) }
        else if (data.action === 'import') {
          const r = await importBoard({ path, components: data.components !== false, subst: data.subst !== false, dnp: data.dnp === true }, env, opts)
          const { step, ...rest } = r
          bytes = step.bytes
          answer = { req, ok: true, result: { ...rest, step: { name: step.name, size: step.size } } }
        } else if (data.action === 'fab') {
          const r = await fabPackage({ path, naming: data.naming === 'kicad' ? 'kicad' : 'fab', drc: data.drc !== false, dnp: data.dnp === true }, env, opts)
          const { bytes: zip, ...rest } = r
          bytes = zip
          answer = { req, ok: true, result: rest }
        } else answer = { req, ok: true, result: await runDrc({ path, parity: data.parity === true }, env, opts) }
      } catch (e) {
        answer = { req, ok: false, error: String(e?.message ?? e).slice(0, 600) }
        bytes = undefined
      } finally {
        running.delete(req)
      }
      if (ctl.signal.aborted) return
      await answerNow(answer, bytes)
    }
    if (!heavy) return work()
    queued++
    const turn = async () => {
      queued--
      await work()
    }
    queue = queue.then(turn, turn)
  })
}
