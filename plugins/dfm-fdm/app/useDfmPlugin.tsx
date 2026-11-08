// SPDX-License-Identifier: AGPL-3.0-only
// Print › Check (Printability)'s part in the app for one render: its panel
// over the part, and the guides compared on the stage when asked for.

import type { PluginRuntime } from '../../../src/plugins/api'
import { CompareStage, DfmPanel, useDfmView } from '../ui/DfmPanel'

export function useDfmPlugin(): PluginRuntime {
  const onStage = useDfmView((s) => s.onStage && s.compare !== null)
  return {
    panel: <DfmPanel />,
    stage: onStage ? <CompareStage /> : undefined,
    hideViewport: onStage,
    startPane: onStage ? null : { title: 'Printability', blurb: 'Open a scan or a CAD part to check it for FDM printing: thin walls, overhangs, bridges, small holes, bed contact, cavities, the build volume. Compare the published guides any time from the panel.', skip: { label: 'Compare the guides', title: 'The published design guides side by side', onClick: () => void import('../../../src/commands/registry').then(({ runCommand }) => runCommand('dfm.guides', { action: 'compare' })).then((r) => useDfmView.setState({ compare: r as never, onStage: true })) } },
  }
}
