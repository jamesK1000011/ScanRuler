// SPDX-License-Identifier: AGPL-3.0-only
// The merged tabs as the plugins in this build declare them: Electronics
// (KiCad · tscircuit · Printed wiring), Fits (Design · Calibrate from a
// scan) and Print (Check · Slice · Send). Each page keeps the workspace id
// projects were saved with, and every page names the same host. Found by a
// glob, so a build without one of the plugins checks the rest.
import { describe, expect, it } from 'vitest'
import type { ScanRulerPlugin } from '../../../src/plugins/api'
import { barTabsIn } from '../../../src/app/workspaceHosts'
import { ELECTRONICS, FITS, PRINT } from '../workspaces'

const found = Object.values(import.meta.glob<{ default: ScanRulerPlugin }>('../../{pcb,circuit,printed,fits,fit-comp,dfm-fdm,slicer-loop,printer-handoff}/plugin.ts', { eager: true })).map((m) => m.default)
const tabs = found.flatMap((p) => (p.workspace ? [p.workspace] : []))
const pagesOf = (id: string) => tabs.filter((t) => t.host?.id === id).sort((a, b) => a.order - b.order)

const EXPECTED: Record<string, [string, string][]> = {
  [ELECTRONICS.id]: [['pcb', 'KiCad'], ['circuit', 'tscircuit'], ['printed', 'Printed wiring']],
  [FITS.id]: [['fits', 'Design'], ['fit-scan', 'Calibrate from a scan']],
  [PRINT.id]: [['dfm', 'Check'], ['slice', 'Slice'], ['print', 'Send']],
}

describe('the merged tabs', () => {
  it('each page keeps its id, in the order of the tab', () => {
    for (const [host, pages] of Object.entries(EXPECTED)) {
      const have = pagesOf(host).map((p) => [p.id, p.label])
      // Only the pages whose plugins are in this build, in the same order.
      expect(have).toEqual(pages.filter(([id]) => have.some(([h]) => h === id)))
    }
  })

  it('every page of a host names the one host object', () => {
    for (const host of [ELECTRONICS, FITS, PRINT]) for (const p of pagesOf(host.id)) expect(p.host).toBe(host)
  })

  it('the bar: unique ids, short titles, a group each', () => {
    const bar = barTabsIn(tabs)
    expect(new Set(bar.map((t) => t.id)).size).toBe(bar.length)
    expect(new Set(bar.map((t) => t.order)).size).toBe(bar.length)
    for (const t of bar) {
      expect(t.title.length, t.id).toBeLessThanOrEqual(64)
      expect(t.group, t.id).toBeDefined()
    }
    for (const t of tabs) expect(t.title.length, t.id).toBeLessThanOrEqual(64)
  })
})
