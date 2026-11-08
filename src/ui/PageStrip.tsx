// SPDX-License-Identifier: AGPL-3.0-only
// The strip over the panel of a workspace that is one page of a shared tab
// (Electronics: KiCad · tscircuit · Printed wiring): the tab's pages, the
// one on screen pressed. A page is a workspace of its own, so a click does
// what the top bar's tabs do — and an agent's workspace.set reaches the
// same pages by their ids. With one page left in the build (the others'
// plugins not in it) there is nothing to choose and no strip.

import { pagesBeside, hostOf } from '../app/workspacePages'
import { useDeviation } from '../state/deviationStore'
import { useShell } from '../state/shellStore'

export function PageStrip() {
  const workspace = useShell((s) => s.workspace)
  const picking = useDeviation((s) => s.picking)
  const pages = pagesBeside(workspace)
  const host = hostOf(workspace)
  if (!host || pages.length < 2) return null
  return (
    <div className={`pagestrip${host.steps ? ' steps' : ''}`} role="tablist" aria-label={host.label} data-test={`pages-${host.id}`}>
      {pages.map((p, i) => (
        <button
          key={p.id}
          role="tab"
          aria-selected={p.id === workspace}
          className={p.id === workspace ? 'on' : undefined}
          data-test={`page-${p.id}`}
          title={p.title}
          disabled={picking}
          onClick={() => useShell.getState().setWorkspace(p.id)}
        >
          {host.steps && <span className="pagenum">{i + 1}</span>}
          {p.label}
        </button>
      ))}
    </div>
  )
}
