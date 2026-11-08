// SPDX-License-Identifier: AGPL-3.0-only
// The model libraries as the Catalog panel sees them: what it asked the
// agent's server, and what came back. The server does the asking — the
// libraries' keys live there — and answers through catalog.answer.

import { create } from 'zustand'
import { notifyAgent } from '../../../src/plugins/api'
import { useAgentLink } from '../../../src/commands/agentLink'

export type Library = 'sketchfab' | 'thingiverse' | 'cults3d'

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

/** Ask the agent's server; the answer comes as catalog.answer. */
export function ask<T = any>(action: string, data: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
  if (useAgentLink.getState().status !== 'connected') return Promise.reject(new Error('The model libraries are searched through the agent connection: switch it on in Settings → Agents (or open ScanRuler from Claude).'))
  const req = `m${Date.now().toString(36)}${(n++).toString(36)}`
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(req)
      reject(new Error('The agent’s server did not answer. It may be older than this page: restart it (and Claude), then try again.'))
    }, timeoutMs)
    waiting.set(req, { resolve, reject, timer })
    notifyAgent('catalog.models', { req, action, ...data })
  })
}

/** An answer from the server, to the ask waiting for it. */
export function answered(a: Answer): boolean {
  const w = waiting.get(a.req)
  if (!w) return false
  clearTimeout(w.timer)
  waiting.delete(a.req)
  if (a.ok) w.resolve(a.result)
  else w.reject(new Error(a.error ?? 'The library did not answer.'))
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
  /** The hit whose files are open, and its files. */
  open: { hit: ModelHit; files: ModelFile[]; licence: string | null } | null
  /** What a take brought in, ready to open. */
  taken: { hit: ModelHit; paths: string[] } | null
}

export const useModels = create<ModelsState>(() => ({ query: '', libraries: ['sketchfab', 'thingiverse', 'cults3d'], page: 1, hits: null, missing: {}, errors: {}, busy: null, open: null, taken: null }))
