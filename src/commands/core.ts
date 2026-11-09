// SPDX-License-Identifier: AGPL-3.0-only
// The app's own commands, by namespace — the contract an agent works
// against. Their names stay as they are once published; new ones are added
// beside them. A plugin's are its own business and come in under its id.
//
// Named in the contract and still to come: scan.pick_screen, scan.candidates
// and the { screen } and { candidate } places of `at`.

import { registerCommands } from './registry'
import { alignCommands } from './core/align'
import { dimensionCommands } from './core/dimension'
import { deviationCommands } from './core/deviation'
import { volumeCommands } from './core/volume'
import { elementCommands } from './core/element'
import { exportCommands, projectCommands } from './core/files'
import { flatCommands } from './core/flat'
import { guideCommands } from './core/guide'
import { scanCommands } from './core/scan'
import { segmentCommands } from './core/segment'
import { sectionCommands } from './core/section'
import { historyCommands, reportCommands, sessionCommands, workspaceCommands } from './core/session'
import { thicknessCommands } from './core/thickness'
import { viewCommands } from './core/view'
import { registerGuide } from './guides'
import { watchPartChanges } from './partDigest'

let registered = false

/** Register the app's commands, once. Loaded with the agent connection
 *  rather than with the page — a session no agent drives carries none of
 *  this — so the plugins' commands, registered at start-up, are there
 *  first; the names never meet. */
export function registerCoreCommands(): void {
  if (registered) return
  registered = true
  registerCommands('session', sessionCommands)
  registerCommands('workspace', workspaceCommands)
  registerCommands('scan', [...scanCommands, ...segmentCommands])
  registerCommands('element', elementCommands)
  registerCommands('dimension', dimensionCommands)
  registerCommands('align', alignCommands)
  registerCommands('section', sectionCommands)
  registerCommands('deviation', [...deviationCommands, ...volumeCommands])
  registerCommands('thickness', thicknessCommands)
  registerCommands('flat', flatCommands)
  registerCommands('report', reportCommands)
  registerCommands('export', exportCommands)
  registerCommands('project', projectCommands)
  registerCommands('history', historyCommands)
  // What history.diff compares with: the part before each change.
  watchPartChanges()
  registerCommands('view', viewCommands)
  registerCommands('guide', guideCommands)
  registerGuide({
    id: 'measure',
    title: 'Measuring a 3D scan',
    when: 'measuring a 3D scan: fitting elements, dimensions and GD&T-like checks, sections and the 2D sheet, deviation against a reference part, wall thickness, the report — by hand or as an automatic run over many scans',
    text: () => import('./guides/measure.md?raw').then((m) => m.default),
  })
  registerGuide({
    id: 'measure-reference',
    title: 'Measuring a 3D scan — reference',
    when: 'the measuring tools’ shapes with examples, what each answer costs, what each refusal means — a section at a time, as the measure guide sends you',
    text: () => import('./guides/measure-reference.md?raw').then((m) => m.default),
  })
}
