// SPDX-License-Identifier: AGPL-3.0-only
// Sections a plugin adds to a panel of the app's own, for a plugin that has
// no workspace of its own but works on what one of the app's workspaces
// holds: a thread read off a cylinder fitted in 3D Measure, the noise of the
// scan open there. Registered from install(), so nothing is added while the
// plugin is disabled, and drawn by src/ui/PanelSections.tsx where the panel
// puts them.

import type { ComponentType } from 'react'

/** The panels of the app's own that take plugins' sections: `measure`, the
 *  3D Measure panel — after its dimensions and tolerances, before the
 *  exports. */
export type PanelSlot = 'measure'

export interface PanelSection {
  /** Unique among the sections — the plugin's id, or under it. */
  id: string
  slot: PanelSlot
  /** Where it stands among the slot's sections, lower first. */
  order: number
  /** The section, drawn with no props: it reads the stores it needs, and
   *  draws nothing when it has nothing to offer. */
  Section: ComponentType
}

const sections: PanelSection[] = []

/** Add a section to one of the app's panels; the returned function takes it
 *  out again. Two sections under one id throw. */
export function registerPanelSection(section: PanelSection): () => void {
  if (sections.some((s) => s.id === section.id)) throw new Error(`Two panel sections share the id "${section.id}".`)
  sections.push(section)
  return () => {
    const i = sections.indexOf(section)
    if (i >= 0) sections.splice(i, 1)
  }
}

/** The sections of `slot`, in their order — by id where two share one. */
export function panelSectionsIn(slot: PanelSlot): PanelSection[] {
  return sections.filter((s) => s.slot === slot).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}
