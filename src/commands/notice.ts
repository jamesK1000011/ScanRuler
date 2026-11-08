// SPDX-License-Identifier: AGPL-3.0-only
// Telling the agent's server something without being asked — the person took
// a screenshot, say. Kept apart from the bridge, with no imports of its own,
// so a plugin can reach it through plugins/api without pulling the bridge
// and all it imports into the plugin's module graph.

type Notice = { event: 'notice'; kind: string; data: Record<string, unknown> }

let out: ((m: Notice) => void) | null = null

/** The bridge's open connection takes notices here; null when it closes. */
export function setNoticeOut(send: ((m: Notice) => void) | null) {
  out = send
}

/** Tell the agent's server that something happened on the page it may want
 *  to know of. The server keeps it and tells the agent with its next
 *  answer. Dropped when no server is connected: a notice is news, not a
 *  request. */
export function notifyAgent(kind: string, data: Record<string, unknown> = {}) {
  out?.({ event: 'notice', kind, data })
}
