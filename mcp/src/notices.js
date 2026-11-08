// SPDX-License-Identifier: AGPL-3.0-only
// What the page tells without being asked, passed on to the agent with the
// next answer it gets — an MCP server cannot start a turn of its own, so
// the news rides on the next reply, and on a log message for a client that
// shows those. A screenshot the person takes is also written to disk here,
// beside the scan (scanruler-work/shots) or in the server's output folder,
// and the page is told where.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const clock = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5)
}

/** A screenshot's news, in a line. */
export function shotLine(d) {
  const parts = [`the person took a screenshot${d.at ? ` at ${clock(d.at)}` : ''}${d.workspace ? ` in ${d.workspace}` : ''}`]
  if (d.marks) parts.push(`${d.marks} mark${d.marks === 1 ? '' : 's'}${d.pins ? `, ${d.pins} numbered pin${d.pins === 1 ? '' : 's'} with comments` : ''}`)
  if (d.note) parts.push(`note: “${String(d.note).slice(0, 200)}”`)
  if (d.path) parts.push(`saved to ${d.path}`)
  return `From ScanRuler: ${parts.join('; ')}. snapshot_latest shows it.`
}

/**
 * link: the page link (emits 'notice'); folder(): the scan's work folder or
 * null; outDir: the server's own; log; notify(text): a log message to the
 * client. Returns { drain() } — the lines not told yet, once.
 */
export function attachNotices({ link, folder, outDir, log = () => {}, notify = () => {} }) {
  const pending = new Map()
  const save = async (d) => {
    if (d.save === false || typeof d.id !== 'string') return null
    try {
      const r = await link.run('snapshot.latest', { id: d.id, original: false })
      const bytes = r?.file?.bytes
      if (!bytes) return null
      const dir = join((await folder()) ?? outDir, ...((await folder()) ? ['shots'] : ['scanruler-shots']))
      await mkdir(dir, { recursive: true })
      const path = join(dir, r.file.name)
      await writeFile(path, Buffer.from(bytes))
      await link.run('snapshot.saved', { id: d.id, path }).catch(() => {})
      return path
    } catch (e) {
      log(`A screenshot could not be saved: ${e.message}`)
      return null
    }
  }
  link.on?.('notice', async ({ kind, data }) => {
    if (kind !== 'snapshot') return
    const key = `snapshot:${data.id ?? ''}`
    pending.set(key, { ...(pending.get(key) ?? {}), ...data })
    const path = data.save === false ? null : await save(data)
    const d = { ...(pending.get(key) ?? data), ...(path ? { path } : {}) }
    if (pending.has(key)) pending.set(key, d)
    const line = shotLine(d)
    log(line)
    notify(line)
  })
  return {
    drain() {
      const lines = [...pending.values()].map(shotLine)
      pending.clear()
      return lines
    },
    /** Seen: snapshot_latest was called, so there is no news to tell. */
    seen() {
      pending.clear()
    },
  }
}
