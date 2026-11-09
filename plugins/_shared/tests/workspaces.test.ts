// SPDX-License-Identifier: AGPL-3.0-only
// The merged tabs as the plugins in this build declare them: Parts (Catalog
// · Generate), Fits (Design · Hardware · Calibrate from a scan), Electronics
// (KiCad · tscircuit · Printed wiring), Make (a print setup's Check · Slice ·
// Send), Analyze
// (Strength · Mass · Wear) and Docs (Manual · Patent). Each page keeps the workspace id
// projects were saved with, and every page names the same host. Found by a
// glob, so a build without one of the plugins checks the rest.
import { describe, expect, it } from 'vitest'
import type { ScanRulerPlugin } from '../../../src/plugins/api'
import { barTabsIn } from '../../../src/app/workspaceHosts'
import { ANALYZE, DOCS, ELECTRONICS, FITS, MAKE, PARTS } from '../workspaces'
import { PRINT_SETUP } from '../printSetup'

const found = Object.values(import.meta.glob<{ default: ScanRulerPlugin }>('../../{catalog,gen,hw,wear-repair,pcb,circuit,printed,fits,fit-comp,dfm-fdm,slicer-loop,printer-handoff,fea,mass,assembly-manual,patent-kit}/plugin.ts', { eager: true })).map((m) => m.default)
const tabs = found.flatMap((p) => (p.workspace ? [p.workspace] : []))
const pagesOf = (id: string) => tabs.filter((t) => t.host?.id === id).sort((a, b) => a.order - b.order)

const EXPECTED: Record<string, [string, string][]> = {
  [PARTS.id]: [['catalog', 'Catalog'], ['gen', 'Generate']],
  [FITS.id]: [['fits', 'Design'], ['hw', 'Hardware'], ['fit-scan', 'Calibrate from a scan']],
  [ELECTRONICS.id]: [['pcb', 'KiCad'], ['circuit', 'tscircuit'], ['printed', 'Printed wiring']],
  [MAKE.id]: [['dfm', 'Check'], ['slice', 'Slice'], ['print', 'Send']],
  [ANALYZE.id]: [['fea', 'Strength'], ['mass', 'Mass'], ['wear', 'Wear']],
  [DOCS.id]: [['assembly', 'Manual'], ['patent', 'Patent']],
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
    for (const host of [PARTS, FITS, ELECTRONICS, MAKE, ANALYZE, DOCS]) for (const p of pagesOf(host.id)) expect(p.host).toBe(host)
  })

  it('each host lists every page it is given, so a missing plugin\'s work opens on the tab', () => {
    for (const [host, pages] of Object.entries(EXPECTED)) {
      const h = [PARTS, FITS, ELECTRONICS, MAKE, ANALYZE, DOCS].find((x) => x.id === host)!
      expect([...(h.pages ?? [])], host).toEqual(pages.map(([id]) => id))
    }
  })

  it('the Make tab: once Print, its pages a print setup’s, the ids projects keep', () => {
    expect([MAKE.id, MAKE.label]).toEqual(['make', 'Make'])
    expect(MAKE.pages).toEqual(['dfm', 'slice', 'print'])
    expect(PRINT_SETUP.pages).toEqual(MAKE.pages)
    // workspace.set "print" still opens Send: a page's own id comes first.
    expect(pagesOf(MAKE.id).every((p) => p.id !== MAKE.id)).toBe(true)
    expect(PRINT_SETUP.title.length).toBeLessThanOrEqual(60)
  })

  it('the workspaces moved into a tab are no longer tabs of their own', () => {
    const bar = barTabsIn(tabs).map((t) => t.id)
    for (const id of ['catalog', 'gen', 'hw', 'wear']) expect(bar).not.toContain(id)
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
