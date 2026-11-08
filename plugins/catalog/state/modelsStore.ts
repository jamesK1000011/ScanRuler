// SPDX-License-Identifier: AGPL-3.0-only
// The model libraries as the Catalog panel sees them: what it asked the
// agent's server, and what came back. The server does the asking — the
// libraries' keys live there — and answers through catalog.answer.

import { create } from 'zustand'
import { notifyAgent } from '../../../src/plugins/api'
import { useAgentLink } from '../../../src/commands/agentLink'

export type Library = 'sketchfab' | 'thingiverse' | 'cults3d' | 'polyhaven'

export interface ModelHit {
  source: Library
  id: string
  name: string
  author: string | null
  licence: string | null
  url: string
  thumbnail: string | null
  downloadable: boolean
  price?: string
}

export interface ModelFile {
  id: string
  name: string
  size: number | null
  format: string
}

type Answer = { req: string; ok: boolean; result?: any; error?: string }

const waiting = new Map<string, { resolve(v: any): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>()
let n = 0

/** Thrown when the person cancels: not an error to show. */
export class Cancelled extends Error {
  constructor() {
    super('Cancelled.')
  }
}

/** Ask the agent's server; the answer comes as catalog.answer. signal (the
 *  panel's Cancel) stops waiting at once and tells the server to stop. */
export function ask<T = any>(action: string, data: Record<string, unknown> = {}, timeoutMs = 60_000, signal?: AbortSignal): Promise<T> {
  if (useAgentLink.getState().status !== 'connected') return Promise.reject(new Error('The model libraries are searched through the agent connection: switch it on in Settings → Agents (or open ScanRuler from your AI app).'))
  if (signal?.aborted) return Promise.reject(new Cancelled())
  // A server started before model search was there never answers: say so
  // at once rather than spin.
  if (!useAgentLink.getState().server?.features?.includes('catalog.models')) return Promise.reject(new Error('The agent’s server running now is older than this page and does not search the model libraries. Quit the agent app completely and open it again (that restarts the server), then reload this page.'))
  const req = `m${Date.now().toString(36)}${(n++).toString(36)}`
  return new Promise<T>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer)
      waiting.delete(req)
      signal?.removeEventListener('abort', cancel)
      unlink()
    }
    // The connection closing is the end of waiting: no answer can come.
    const unlink = useAgentLink.subscribe((s) => {
      if (s.status === 'connected') return
      done()
      reject(new Error('The agent connection closed before the answer came — reconnect (Settings → Agents) and try again.'))
    })
    const cancel = () => {
      done()
      notifyAgent('catalog.models', { req: `${req}x`, action: 'cancel', of: req })
      reject(new Cancelled())
    }
    const timer = setTimeout(() => {
      done()
      notifyAgent('catalog.models', { req: `${req}x`, action: 'cancel', of: req })
      reject(new Error(`No answer in ${Math.round(timeoutMs / 1000)} s. If this keeps happening the agent’s server may be older than this page, or stuck: restart it (and the agent app), then try again.`))
    }, timeoutMs)
    signal?.addEventListener('abort', cancel, { once: true })
    waiting.set(req, {
      resolve: (v) => (done(), resolve(v)),
      reject: (e) => (done(), reject(e)),
      timer,
    })
    notifyAgent('catalog.models', { req, action, ...data })
  })
}

/** An answer from the server, to the ask waiting for it. */
export function answered(a: Answer): boolean {
  const w = waiting.get(a.req)
  if (!w) return false
  if (a.ok) w.resolve(a.result)
  else w.reject(new Error(a.error || 'The library did not answer.'))
  return true
}

export interface ModelsState {
  query: string
  libraries: Library[]
  page: number
  hits: ModelHit[] | null
  missing: Partial<Record<Library, string>>
  errors: Partial<Record<Library, string>>
  busy: string | null
  /** The search the hits are of: what More goes on with. */
  searched?: { query: string; libraries: Library[] }
  /** Where each library's next page starts, as its last answer said. */
  cursors?: Partial<Record<Library, string>>
  /** More results found nothing new: the end of the list. */
  noMore?: boolean
  /** When the work in busy began, ms — the panel counts the seconds. */
  since: number | null
  /** The hit whose files are open, and its files. */
  open: { hit: ModelHit; files: ModelFile[]; licence: string | null } | null
  /** What a take brought in, ready to open. */
  taken: { hit: ModelHit; paths: string[] } | null
}

export const useModels = create<ModelsState>(() => ({ query: '', libraries: ['sketchfab', 'thingiverse', 'cults3d', 'polyhaven'], page: 1, hits: null, missing: {}, errors: {}, busy: null, since: null, open: null, taken: null }))
