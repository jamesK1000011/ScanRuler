// SPDX-License-Identifier: AGPL-3.0-only
// The top-bar tabs several plugins' workspaces share as pages (see
// WorkspaceTab.host in src/plugins/api.ts). Each page's plugin names its
// host from here, so they agree on it, and any of them alone still makes
// the tab: a build without one of the plugins keeps the others' pages.
//
//   Electronics  KiCad (pcb) · tscircuit (circuit) · Printed wiring (printed)
//   Fits         Design (fits) · Calibrate from a scan (fit-comp)
//   Print        1 Check (dfm-fdm) · 2 Slice (slicer-loop) · 3 Send (printer-handoff)
//
// A page keeps its own workspace id — what project files, the undo history
// and workspace.set name — so work saved before the tabs were merged opens
// on its page.

import type { WorkspaceHost } from '../../src/plugins/api'

export const ELECTRONICS: WorkspaceHost = {
  id: 'electronics',
  label: 'Electronics',
  title: 'Circuit boards, and wiring printed into parts',
  icon: 'board',
  order: 17,
  group: 'model',
  pages: ['pcb', 'circuit', 'printed'],
}

export const FITS: WorkspaceHost = {
  id: 'fits',
  label: 'Fits',
  title: 'Fits, hinges and stacks, calibrated to your printer',
  icon: 'concentric',
  order: 15,
  group: 'model',
  pages: ['fits', 'fit-scan'],
}

export const PRINT: WorkspaceHost = {
  id: 'print',
  label: 'Print',
  title: 'Check, slice and send a part to the printer',
  icon: 'printer',
  order: 22,
  group: 'make',
  steps: true,
  pages: ['dfm', 'slice', 'print'],
}
