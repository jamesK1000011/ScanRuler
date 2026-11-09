// SPDX-License-Identifier: AGPL-3.0-only
// What the imprint owes third-party data or software that is in the build
// whichever plugins are: a library several plugins share — the material
// library, with FreeCAD's cards — registers its notice where it is defined,
// so the notice is there whenever the library is bundled, however many of
// its readers are. A plugin's own notices stay on the plugin
// (ScanRulerPlugin.notices). Drawn by src/ui/Imprint.tsx under
// "Third-party software", after the plugins'.

import type { ComponentType } from 'react'

export interface SharedNotice {
  /** Stable, and one a notice: the same notice registered again is one. */
  id: string
  Notices: ComponentType
}

const notices = new Map<string, SharedNotice>()

/** Put a notice in the imprint. The same id again replaces it, so a module
 *  loaded twice (a hot reload) leaves one. */
export function registerSharedNotice(notice: SharedNotice): void {
  notices.set(notice.id, notice)
}

/** The shared notices, in the order registered. */
export const sharedNotices = (): SharedNotice[] => [...notices.values()]
