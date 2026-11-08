// SPDX-License-Identifier: AGPL-3.0-only
// The start requests put in front of the person in ScanRuler: what to
// print where, and the one-time address the answer goes to. The address is
// held here and nowhere an agent reads.

import { create } from 'zustand'

export interface Ask {
  request: string
  /** What is asked: to start a print (the default) or resume a paused one. */
  verb?: 'start' | 'resume'
  printer: string
  file: string
  summary: { time?: string; filament?: string; size?: string }
  answer: string
  status: 'waiting' | 'sending' | 'started' | 'cancelled' | 'failed' | 'expired' | 'withdrawn' | 'starting'
  error?: string
  at: string
}

interface AskState {
  asks: Ask[]
  add(a: Ask): void
  update(request: string, patch: Partial<Ask>): void
  dismiss(request: string): void
}

export const useAsks = create<AskState>((set, get) => ({
  asks: [],
  add: (a) => set({ asks: [a, ...get().asks.filter((x) => x.request !== a.request)].slice(0, 20) }),
  update: (request, patch) => set({ asks: get().asks.map((x) => (x.request === request ? { ...x, ...patch } : x)) }),
  dismiss: (request) => set({ asks: get().asks.filter((x) => x.request !== request) }),
}))

/** Send the person's answer to the server's one-time address, then follow
 *  what became of it. */
export async function answer(a: Ask, action: 'start' | 'cancel') {
  const { update } = useAsks.getState()
  update(a.request, { status: 'sending' })
  try {
    await fetch(a.answer, { method: 'POST', mode: 'no-cors', body: new URLSearchParams({ action }) })
  } catch {
    update(a.request, { status: 'failed', error: 'ScanRuler could not reach the agent’s server.' })
    return
  }
  for (let i = 0; i < 60; i++) {
    try {
      const r = (await (await fetch(`${a.answer}/status`)).json()) as { status: Ask['status']; error?: string }
      if (r.status !== 'waiting' && r.status !== 'starting') {
        update(a.request, { status: r.status, ...(r.error ? { error: r.error } : {}) })
        return
      }
    } catch {
      break
    }
    await new Promise((s) => setTimeout(s, 500))
  }
}
