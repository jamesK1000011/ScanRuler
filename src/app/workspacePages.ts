// SPDX-License-Identifier: AGPL-3.0-only
// Workspaces that share one top-bar tab as its pages (WorkspaceTab.host in
// plugins/api.ts). Each page is still a workspace of its own — the shell,
// the undo history, a project file and an agent's workspace.set go on
// naming it by its id — so all this decides is what the top bar draws, what
// strip of pages stands over the panel, and where a host's own id leads.
// The rules themselves, on a list of tabs, are in workspaceHosts.ts.

import type { WorkspaceHost, WorkspaceTab } from '../plugins/api'
import { plugins } from '../plugins/registry'
import { useShell } from '../state/shellStore'
import { barTabsIn, pagesIn, resolveIn, type BarTab } from './workspaceHosts'

export type { BarTab } from './workspaceHosts'

// ---- the plugins in use -----------------------------------------------------------

const tabs = (): WorkspaceTab[] => plugins().flatMap((p) => (p.workspace ? [p.workspace] : []))

/** The page of each host last on screen, so its tab opens where it was left. */
const lastPage = new Map<string, string>()
let following = false
function follow(): void {
  if (following) return
  following = true
  const note = (w: string) => {
    const host = tabs().find((t) => t.id === w)?.host
    if (host) lastPage.set(host.id, w)
  }
  note(useShell.getState().workspace)
  useShell.subscribe((s) => note(s.workspace))
}

/** The host whose page `workspace` is, or null. */
export const hostOf = (workspace: string): WorkspaceHost | null => tabs().find((t) => t.id === workspace)?.host ?? null

/** The pages of the host `workspace` is a page of — itself among them —
 *  or none. */
export function pagesBeside(workspace: string): WorkspaceTab[] {
  const host = hostOf(workspace)
  return host ? pagesIn(tabs(), host.id) : []
}

/** The plugins' tabs as the top bar shows them. */
export function pluginBarTabs(): BarTab[] {
  follow()
  return barTabsIn(tabs())
}

/** The workspace a plugin's workspace id or a host's id opens, or null for
 *  neither. */
export function resolvePluginWorkspace(name: string): string | null {
  follow()
  const host = hostOf(name) === null ? name : null
  return resolveIn(tabs(), name, host ? lastPage.get(host) : undefined)
}

/** The workspace a click on a top-bar tab opens: a host's page last on
 *  screen, else its first. */
export function pageToOpen(tab: BarTab): string {
  follow()
  const last = lastPage.get(tab.id)
  return last && tab.pages.includes(last) ? last : tab.pages[0]
}

/** The ids of the hosts that are not a workspace's own id too. */
export const hostNames = (): string[] => {
  const ids = new Set(tabs().map((t) => t.id))
  return [...new Set(tabs().flatMap((t) => (t.host && !ids.has(t.host.id) ? [t.host.id] : [])))]
}
