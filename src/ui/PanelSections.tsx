// SPDX-License-Identifier: AGPL-3.0-only
// The plugins' sections of one of the app's panels (src/plugins/
// panelSections.ts), in their order. Registered at start-up, before the
// first render, so the list is read as it stands.

import { panelSectionsIn, type PanelSlot } from '../plugins/panelSections'

export function PanelSections({ slot }: { slot: PanelSlot }) {
  return (
    <>
      {panelSectionsIn(slot).map(({ id, Section }) => (
        <Section key={id} />
      ))}
    </>
  )
}
