// SPDX-License-Identifier: AGPL-3.0-only
// The Cut page: a cut setup's parts checked for the sheet, and their
// outlines out as a file to cut from.

import { SetupPage } from '../../_shared/ui/SetupPage'

const EXPORTS = [
  { label: 'DXF', title: 'The outlines laid out flat, as DXF', input: { format: 'dxf' } },
  { label: 'SVG', title: 'The outlines laid out flat, as SVG', input: { format: 'svg' } },
] as const

export function CutPanel() {
  return (
    <SetupPage
      type="cut"
      check="cut.check"
      exportCommand="cut.export"
      exports={EXPORTS}
      heading="Cut from sheet"
      testId="cut-panel"
      info={
        <>
          <p>Each part is checked as a sheet part: two flat sides, edges square to them, of the sheet’s thickness; webs, slots and holes against the least feature; a router’s inside corners against its cutter.</p>
          <p>The file holds every part’s outline and holes, laid out in rows. Figures left empty in the setup come from the machine and the part’s material.</p>
        </>
      }
    />
  )
}
