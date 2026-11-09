// SPDX-License-Identifier: AGPL-3.0-only
// The Mill page: a mill setup's parts checked for machining, and handed
// over as STEP with a setup sheet.

import { SetupPage } from '../../_shared/ui/SetupPage'

const EXPORTS = [{ label: 'STEP and sheet', title: 'A zip: the parts as STEP, and the setup sheet', input: {} }] as const

export function MillPanel() {
  return (
    <SetupPage
      type="mill"
      check="mill.check"
      exportCommand="mill.export"
      exports={EXPORTS}
      heading="CNC milling"
      testId="mill-panel"
      info={
        <>
          <p>Each part is checked from the setup’s tool directions: faces the tool cannot reach, inside corners tighter than the least tool, holes and pockets too deep for it, thin walls, and whether the stock holds the part.</p>
          <p>The zip holds the parts as STEP and a setup sheet for the machinist. No toolpaths: those are the CAM’s.</p>
        </>
      }
    />
  )
}
