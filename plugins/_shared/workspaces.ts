// SPDX-License-Identifier: AGPL-3.0-only
// The top-bar tabs several plugins' workspaces share as pages (see
// WorkspaceTab.host in src/plugins/api.ts). Each page's plugin names its
// host from here, so they agree on it, and any of them alone still makes
// the tab: a build without one of the plugins keeps the others' pages.
//
//   Parts        Catalog (catalog) · Generate (gen)
//   Fits         Design (fits) · Hardware (hw) · Calibrate from a scan (fit-comp)
//   Electronics  KiCad (pcb) · tscircuit (circuit) · Printed wiring (printed)
//   Print        1 Check (dfm-fdm) · 2 Slice (slicer-loop) · 3 Send (printer-handoff)
//   Analyze      Strength (fea) · Mass (mass) · Wear (wear-repair)
//   Docs         Manual (assembly-manual) · Patent (patent-kit)
//
// Merged only where one tab is what a person would look in for both: a part
// got without modelling it (found, or generated to a standard); how parts
// join (fits, and the holes hardware takes — both sized by the one
// calibration). Mesh Tools stays a tab of its own, and Share (library-pack:
// publishing a part) stays apart from Docs, whose patent drawings are kept
// private until filed.
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

export const PARTS: WorkspaceHost = {
  id: 'parts',
  label: 'Parts',
  title: 'Ready-made parts: found in a catalogue, or generated to size',
  icon: 'catalog',
  order: 12,
  group: 'model',
  pages: ['catalog', 'gen'],
}

export const FITS: WorkspaceHost = {
  id: 'fits',
  label: 'Fits',
  title: 'Fits, hinges, stacks, and holes for screws and inserts',
  icon: 'concentric',
  order: 15,
  group: 'model',
  pages: ['fits', 'hw', 'fit-scan'],
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

export const ANALYZE: WorkspaceHost = {
  id: 'analyze',
  label: 'Analyze',
  title: 'Strength, mass and wear of a part',
  icon: 'strength',
  order: 20,
  group: 'make',
  pages: ['fea', 'mass', 'wear'],
}

export const DOCS: WorkspaceHost = {
  id: 'docs',
  label: 'Docs',
  title: 'Build instructions and patent drawings',
  icon: 'manual',
  order: 30,
  group: 'share',
  pages: ['assembly', 'patent'],
}
