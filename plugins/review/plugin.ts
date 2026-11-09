// SPDX-License-Identifier: AGPL-3.0-only
// Review: one answer to "is this part done?" — part.review runs the checks
// the other workspaces carry on a body and comes to one verdict; part.spec
// keeps the design spec it judges against with the project. No workspace
// of its own: it reaches the others only by their commands' names. Its
// commands go under part, the thing they are about, not the plugin's id.
// See README.md.

import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { registerProjectSection } from '../../src/app/projectSections'
import { registerHistory } from '../../src/state/historyStore'
import { reviewSection } from './app/projectSection'
import { reviewCommands } from './app/reviewCommands'
import { useReview } from './state/reviewStore'

const plugin: ScanRulerPlugin = {
  id: 'review',
  name: 'Part review',
  install() {
    registerProjectSection(reviewSection)
    registerCommands('part', reviewCommands)
    registerStateSection('review', () => ({ spec: useReview.getState().spec }))
    registerHistory({
      sections: [{ key: 'review', capture: () => useReview.getState().spec, apply: (v) => useReview.setState({ spec: v as ReturnType<typeof useReview.getState>['spec'] }), compare: 'identity' }],
    })
    registerGuide({
      id: 'review',
      title: 'Is the part done?',
      when: 'after every change to a modelled part, and before saying it is done: one review of validity, clearance, mass and strength — and printability for a printed part — a spec to judge against, how each part is made, and what a change did',
      text: () => import('./guides/review.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
