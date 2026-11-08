// SPDX-License-Identifier: AGPL-3.0-only
// What the page shows of its link to an AI agent — where the link stands, for
// the chip and Settings — and the pairing link that switches it on. The link
// itself, bridge.ts, is loaded only once it is switched on: a page no agent
// drives carries none of it.

import { create } from 'zustand'
import { usePrefs } from '../state/prefsStore'

/** Where the link stands, for the chip in the top bar: switched off;
 *  waiting for the agent's server to answer; connected to it; or turned
 *  away by it — a wrong token, another tab connected already. */
export type AgentLinkStatus = 'off' | 'waiting' | 'connected' | 'refused'

/** The agent's server as its welcome said: `{ version }`, `{ version: null }`
 *  for a scanruler-mcp before 0.4.0, whose welcome carries no version, or
 *  null before a welcome (or from a server that does not say it is one). */
export interface AgentServer {
  version: string | null
  /** What it answers beyond the page's commands, as its welcome said
   *  (['catalog.models']); absent from a server before they were named. */
  features?: string[]
}

export const useAgentLink = create<{ status: AgentLinkStatus; detail: string | null; server: AgentServer | null }>(() => ({
  status: 'off',
  detail: null,
  server: null,
}))

/** The oldest scanruler-mcp whose behaviour this page's commands assume.
 *  Set by hand, when a release changes what the server has to do. */
export const WANTS_SERVER = '0.4.0'

const versionParts = (v: string): number[] | null => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Whether version `a` is older than `b`; false when either is no version. */
export function olderVersion(a: string, b: string): boolean {
  const x = versionParts(a)
  const y = versionParts(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]
  return false
}

/** What the person can paste into the agent's chat to have it update the
 *  connector: it says the setting, for an agent that has not read the page,
 *  and the restart, which the agent cannot do itself. */
export const CONNECTOR_ASK =
  'Update the scanruler MCP server in this app to scanruler-mcp@latest, then tell me to quit the app completely and open it again.'

/** One step per AI app to update the connector, copy-ready: the setting
 *  with `@latest`, which has npx fetch the newest at each start. */
export const CONNECTOR_STEPS: { app: string; how: string; text: string }[] = [
  {
    app: 'Claude Code',
    how: 'run in a terminal',
    text: 'claude mcp remove scanruler\nclaude mcp add --scope user scanruler -- npx -y scanruler-mcp@latest',
  },
  {
    app: 'Codex',
    how: 'run in a terminal',
    text: 'codex mcp remove scanruler\ncodex mcp add scanruler -- npx -y scanruler-mcp@latest',
  },
  {
    app: 'Claude Desktop',
    how: 'in Settings → Developer → Edit Config, change "scanruler-mcp" in the scanruler entry to "scanruler-mcp@latest", so the line reads',
    text: '"args": ["-y", "scanruler-mcp@latest"]',
  },
]

/** When the connected server is older than WANTS_SERVER: what to tell the
 *  person, in plain words — the banner says it, and session.state carries
 *  it for the agent to pass on. Null otherwise. */
export function serverTooOld(server: AgentServer | null = useAgentLink.getState().server): string | null {
  if (!server) return null
  if (server.version !== null && !olderVersion(server.version, WANTS_SERVER)) return null
  const which = server.version ? `version ${server.version}` : `older than ${WANTS_SERVER}`
  const steps = CONNECTOR_STEPS.map((s) => `${s.app} — ${s.how}: ${s.text.split('\n').map((line) => `\`${line}\``).join(', then ')}`).join('; ')
  return (
    `Your ScanRuler connector is out of date: the scanruler-mcp your AI app started is ${which}, and this ScanRuler needs ${WANTS_SERVER} or newer — some of what the agent asks may not work. ` +
    `To update it, ask the agent to, or change its setting to the @latest one. ${steps}. Then quit the app completely and open it again. ` +
    'With more than one AI app open, the old connector may be another app’s — one left open in the background holds the connection for all of them: quit it.'
  )
}

/** How the link stands, in a few words — Settings and the chip say it. */
export const AGENT_STATUS: Record<AgentLinkStatus, string> = {
  off: 'Off',
  waiting: 'Listening for the agent',
  connected: 'Connected to the agent',
  refused: 'Turned away by the agent',
}

/** `#agent=<port>:<token>` in the address — the pairing link scanruler-mcp
 *  hands out — switches the connection on with that port and token (the first
 *  time, once the warning about the person's data is accepted: prefsStore's
 *  agentDataOk), and is taken out of the address again. True when there was one. */
export function takePairingLink(): boolean {
  if (typeof location === 'undefined') return false
  const m = /(?:^#|&)agent=(\d{1,5}):([A-Za-z0-9_-]{8,})/.exec(location.hash)
  if (!m) return false
  const prefs = usePrefs.getState()
  prefs.setAgentPort(Number(m[1]))
  prefs.setAgentToken(m[2])
  prefs.setAgentLink(true)
  history.replaceState(null, '', location.pathname + location.search)
  return true
}
