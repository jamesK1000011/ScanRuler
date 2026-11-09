// SPDX-License-Identifier: AGPL-3.0-only
// The library for a panel: FreeCAD's cards are loaded at run time (index.ts),
// so a panel that shows materials asks for them when it is shown and draws
// again when they arrive. Until then the fork's own are there, and a body
// set to a card reads as loading, not as having none.

import { useEffect } from 'react'
import { ensureMaterials, useMaterialLibrary, type CardsStatus } from './index'
import { assignedReady, useAssigned } from './assigned'

/** The whole library wanted (a list to pick from): loads the cards when the
 *  panel is shown and wants them. Returns where they are. */
export function useLibraryLoaded(wanted = true): CardsStatus {
  const status = useMaterialLibrary((s) => s.status)
  useEffect(() => {
    // A failure is in the store (status, error) for the panel to say.
    if (wanted) ensureMaterials().catch(() => undefined)
  }, [wanted])
  return status
}

/** The bodies' materials wanted: loads the cards when a body is set to one,
 *  and returns who has what with the cards' state, so the panel draws again
 *  when they arrive. */
export function useAssignedMaterials() {
  const assigned = useAssigned((s) => s.assigned)
  const status = useMaterialLibrary((s) => s.status)
  useEffect(() => {
    assignedReady().catch(() => undefined)
  }, [assigned])
  return { assigned, status }
}
