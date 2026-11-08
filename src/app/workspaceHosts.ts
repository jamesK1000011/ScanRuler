// SPDX-License-Identifier: AGPL-3.0-only
// Workspaces that share one top-bar tab as its pages (WorkspaceTab.host in
// plugins/api.ts), worked out from a list of tabs — what the top bar draws
// and where a host's id leads. workspacePages.ts reads them from the
// plugins in use.

import type { WorkspaceHost, WorkspaceTab } from '../plugins/api'

/** The pages of `hostId` among `tabs`, in their order. */
export const pagesIn = (tabs: readonly WorkspaceTab[], hostId: string): WorkspaceTab[] =>
  tabs.filter((t) => t.host?.id === hostId).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

/** One entry per top-bar tab: a workspace on its own, or a host standing for
 *  its pages — the host's label, title, icon, order and group. */
export interface BarTab {
  id: string
  label: string
  title: string
  icon: WorkspaceTab['icon']
  order: number
  group?: WorkspaceTab['group']
  /** The workspaces it stands for: the pages of a host, else its own id. */
  pages: string[]
}

export function barTabsIn(tabs: readonly WorkspaceTab[]): BarTab[] {
  const out: BarTab[] = []
  const hosts = new Set<string>()
  for (const t of tabs) {
    if (!t.host) {
      out.push({ id: t.id, label: t.label, title: t.title, icon: t.icon, order: t.order, group: t.group, pages: [t.id] })
      continue
    }
    if (hosts.has(t.host.id)) continue
    hosts.add(t.host.id)
    const h: WorkspaceHost = t.host
    out.push({ id: h.id, label: h.label, title: h.title, icon: h.icon, order: h.order, group: h.group, pages: pagesIn(tabs, h.id).map((p) => p.id) })
  }
  return out
}

/** The workspace a name opens: a workspace's own id as it is; a host's id
 *  its page `last` names when that is one of its pages, else its first;
 *  anything else null. */
export function resolveIn(tabs: readonly WorkspaceTab[], name: string, last?: string): string | null {
  if (tabs.some((t) => t.id === name)) return name
  const pages = pagesIn(tabs, name)
  if (!pages.length) return null
  return pages.some((p) => p.id === last) ? last! : pages[0].id
}
