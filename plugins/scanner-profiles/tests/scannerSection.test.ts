// SPDX-License-Identifier: AGPL-3.0-only
// The 3D Measure panel's Scanner section: installed with the plugin, its
// form read as scanner.add takes it, and the commands its controls run —
// a profile added and used, the measured noise chosen again, and removed.
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runCommand } from '../../../src/commands/registry'
import { panelSectionsIn } from '../../../src/plugins/panelSections'
import plugin from '../plugin'
import { noiseNow, useScanner } from '../state/scannerStore'
import { profileInput, ScannerSection } from '../ui/ScannerSection'

beforeAll(() => plugin.install?.())
beforeEach(() => {
  for (const p of useScanner.getState().profiles) useScanner.getState().remove(p.name)
  useScanner.getState().replace(null, null)
})

describe('Scanner section', () => {
  test('sits in the 3D Measure panel, before Thread', () => {
    const ids = panelSectionsIn('measure').map((s) => s.id)
    expect(panelSectionsIn('measure').find((s) => s.id === 'scanner-profiles')?.Section).toBe(ScannerSection)
    if (ids.includes('thread-match')) expect(ids.indexOf('scanner-profiles')).toBeLessThan(ids.indexOf('thread-match'))
  })

  test('the form as scanner.add takes it', () => {
    expect(profileInput({ name: '  Revopoint POP 3 ', noiseMm: 0.05, spacingMm: 0, note: ' ', use: false })).toEqual({ name: 'Revopoint POP 3', noiseMm: 0.05 })
    expect(profileInput({ name: 'A', noiseMm: 0.02, spacingMm: 0.1, note: 'fine mode', use: true })).toEqual({ name: 'A', noiseMm: 0.02, spacingMm: 0.1, note: 'fine mode', use: true })
    expect(profileInput({ name: ' ', noiseMm: 0.02, spacingMm: 0, note: '', use: true })).toBeNull()
    expect(profileInput({ name: 'A', noiseMm: 0, spacingMm: 0, note: '', use: true })).toBeNull()
    expect(profileInput({ name: 'A', noiseMm: 6, spacingMm: 0, note: '', use: true })).toBeNull()
  })

  test('add and use, back to measured, remove', async () => {
    await runCommand('scanner.add', profileInput({ name: 'Bench', noiseMm: 0.04, spacingMm: 0, note: '', use: true })!)
    expect(useScanner.getState().using?.name).toBe('Bench')
    expect(noiseNow()).toEqual({ sigmaMm: 0.04, from: 'profile Bench' })
    useScanner.getState().setMeasured({ sigmaMm: 0.02, spacingMm: 0.3, at: '2026-11-08T00:00:00Z' })
    await runCommand('scanner.use', { measured: true })
    expect(useScanner.getState().using).toBeNull()
    expect(noiseNow()?.sigmaMm).toBe(0.02)
    await runCommand('scanner.use', { name: 'Bench' })
    await runCommand('scanner.remove', { name: 'Bench' })
    expect(useScanner.getState().profiles).toEqual([])
    // The project keeps its copy: the section offers it as the project's.
    expect(useScanner.getState().using?.name).toBe('Bench')
    await expect(runCommand('scanner.remove', { name: 'Bench' })).rejects.toThrow(/No profile/)
  })
})
