// SPDX-License-Identifier: AGPL-3.0-only
// The Wear repair workspace's part in the app: its panel, and a click on
// the part placing a new region's centre while asked to.

import type { PluginRuntime } from '../../../src/plugins/api'
import { placeAt, WearPanel } from '../ui/WearPanel'

export function useWearPlugin(): PluginRuntime {
  return {
    panel: <WearPanel />,
    pick: (hit) => void placeAt(hit.point),
    startPane: {
      title: 'Wear repair',
      blurb: 'Open the worn part as the scan. Read it against its own other half or an aligned CAD, twin or catalog part, tag the worn areas, and save the repaired part. A print that keeps coming out distorted can be pre-warped here too.',
    },
  }
}
