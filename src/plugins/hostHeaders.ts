// SPDX-License-Identifier: AGPL-3.0-only
// What a plugin draws over the pages of a shared tab (WorkspaceHost) in
// place of the plain strip of its pages: the Make tab's list of setups,
// say, with the pages of the setup chosen under it. Registered from
// install(), so nothing is drawn while the plugin is disabled, and drawn by
// src/ui/PageStrip.tsx; without one the tab keeps its plain strip.

import type { ComponentType } from 'react'
import type { WorkspaceHost, WorkspaceTab } from './api'

export interface HostHeaderProps {
  host: WorkspaceHost
  /** The host's pages in this build, in their order. */
  pages: WorkspaceTab[]
  /** The page on screen. */
  workspace: string
}

export interface HostHeader {
  /** The host it heads, by id. One header a host. */
  host: string
  /** The header: it draws the pages to choose from as well (PageTabs in
   *  src/ui/PageStrip.tsx), all of them or the ones that apply now. */
  Header: ComponentType<HostHeaderProps>
}

const headers = new Map<string, HostHeader>()

/** Head a shared tab's pages; the returned function takes it off again.
 *  Two headers for one host throw. */
export function registerHostHeader(header: HostHeader): () => void {
  if (headers.has(header.host)) throw new Error(`Two headers for the tab "${header.host}".`)
  headers.set(header.host, header)
  return () => {
    if (headers.get(header.host) === header) headers.delete(header.host)
  }
}

/** The header of a host, or undefined for the plain strip. */
export const hostHeaderOf = (host: string): HostHeader | undefined => headers.get(host)
