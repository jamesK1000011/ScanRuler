// SPDX-License-Identifier: AGPL-3.0-only
// Hardware sizes its holes with the printer's fit calibration from Fits —
// read through Fits' part of the session, never copied — moving each
// allowance left at its default by the calibration's difference from the
// typical printer. An allowance set by hand stays; printerFit: false turns
// it off; the answers say which calibration was used.
import { beforeAll, describe, expect, test } from 'vitest'
import { registerCommands, runCommand } from '../../../src/commands/registry'
import { registerStateSection } from '../../../src/commands/stateSections'
import { hwCommands } from '../app/hwCommands'
import { DEFAULT_SETTINGS } from '../core/plan'
import { withPrinterFit } from '../core/printerFit'
import { useHw } from '../state/hwStore'
import { printerFitOf } from '../../_shared/printerFit'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// Fits' calibration as Fits holds it: holes print 0.3 small.
let calibration: Json | undefined
const CAL = { hole: 0.3, shaft: 0.1, source: 'measured', at: '2026-11-08', profile: 'PETG' }

beforeAll(() => {
  registerCommands('hw', hwCommands)
  registerStateSection('fits', () => (calibration ? { calibration } : {}))
})

const magnetCut = async (size: string) => ((await runCommand('hw.check', { diameter: 6.3 })) as Json).matches.find((m: Json) => m.kind === 'magnet' && m.size === size)?.cut

describe('the allowances', () => {
  test('follow the calibration by its difference from the typical printer', () => {
    const s = withPrinterFit(DEFAULT_SETTINGS, printerFitOf(CAL))
    expect(s.allowance).toEqual({ screw: 0.3, nut: 0.3, insert: 0.1, pilot: 0.1, magnet: 0.3, bearing: 0.2 })
  })
  test('the typical printer, none, or printerFit off leave them be', () => {
    expect(withPrinterFit(DEFAULT_SETTINGS, printerFitOf({ hole: 0.2, shaft: 0.1, source: 'entered' })).allowance).toEqual(DEFAULT_SETTINGS.allowance)
    expect(withPrinterFit(DEFAULT_SETTINGS, null)).toBe(DEFAULT_SETTINGS)
    expect(withPrinterFit({ ...DEFAULT_SETTINGS, printerFit: false }, printerFitOf(CAL)).allowance).toEqual(DEFAULT_SETTINGS.allowance)
  })
  test('one set by hand stays as set', () => {
    const s = withPrinterFit({ ...DEFAULT_SETTINGS, allowance: { ...DEFAULT_SETTINGS.allowance, magnet: 0.15 } }, printerFitOf(CAL))
    expect(s.allowance.magnet).toBe(0.15)
    expect(s.allowance.screw).toBe(0.3)
  })
  test('a printer whose holes print big takes them down, not up', () => {
    const s = withPrinterFit(DEFAULT_SETTINGS, printerFitOf({ hole: -0.1, shaft: 0, source: 'entered' }))
    expect(s.allowance.screw).toBe(-0.1)
    expect(s.allowance.insert).toBe(-0.3)
  })
})

describe('the hw.* commands', () => {
  test('size holes with the calibration and say which they used', async () => {
    useHw.getState().reset()
    calibration = undefined
    expect(await magnetCut('6x2')).toBe(6.2)
    calibration = CAL
    expect(await magnetCut('6x2')).toBe(6.3)
    const l = (await runCommand('hw.list', {})) as Json
    expect(l.settings.allowance.magnet).toBe(0.3)
    expect(l.printerFit.used).toBe('printer fits from 2026-11-08 (PETG)')
    // Kept as set: the stored allowances are still the defaults.
    expect(useHw.getState().allowance.magnet).toBe(0.2)
  })
  test('an allowance set by hand wins; printerFit: false turns the calibration off', async () => {
    useHw.getState().reset()
    calibration = CAL
    await runCommand('hw.set', { allowance: { magnet: 0.1 } })
    expect(await magnetCut('6x2')).toBe(6.1)
    const l = (await runCommand('hw.list', {})) as Json
    expect(l.printerFit.kinds.includes('magnet')).toBe(false)
    expect(l.settings.allowance.screw).toBe(0.3)
    await runCommand('hw.set', { allowance: { magnet: 0.2 }, printerFit: false })
    expect(await magnetCut('6x2')).toBe(6.2)
    expect(((await runCommand('hw.list', {})) as Json).printerFit).toMatch(/off/)
    await runCommand('hw.set', { reset: true })
    expect(useHw.getState().printerFit).toBe(true)
    calibration = undefined
  })
})
