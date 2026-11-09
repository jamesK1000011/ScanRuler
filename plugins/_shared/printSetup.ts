// SPDX-License-Identifier: AGPL-3.0-only
// The print setup: a part made by FDM printing. Its pages on the Make tab
// are Check (dfm-fdm), Slice (slicer-loop) and Send (printer-handoff); each
// of those plugins registers this one type, so any of them alone brings it.
//
// It owns what was scattered over the workspaces that work on a printed
// part: the printer and nozzle (Check's profiles), the way up on the bed
// (Check's up, Strength's build direction), the layers (Hardware's pauses
// and roofs), the walls, infill and line width (Mass), and the printer's
// fit calibration (Fits' — the machine's tolerance). A setting left unset
// leaves each workspace on its own; one set is what the workspaces read for
// a body in the setup, through setupValue — never by importing this plugin
// or that one. The material is the part's, not the setup's.

import { readStateSection } from '../../src/commands/stateSections'
import { enumOf, int, num, oneOf, str, anyObject } from '../../src/commands/schema'
import { printerFitOf, type PrinterFit } from './printerFit'
import type { Setup, SetupSetting, SetupType } from './setups'
import { PrintSetupSettings } from './ui/PrintSetupSettings'

export const UPS = ['+z', '-z', '+x', '-x', '+y', '-y'] as const
export type Up = (typeof UPS)[number]

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const range = (lo: number, hi: number, what: string) => (v: unknown) => (isNum(v) && v >= lo && v <= hi ? null : `${what} is to be a number from ${lo} to ${hi}`)
const r4 = (v: unknown) => (isNum(v) ? Math.round(v * 1e4) / 1e4 + 0 : v)

/** Fits' calibration as it holds it now, or null on its defaults. */
const fitsNow = (): Record<string, unknown> | null => {
  const c = (readStateSection('fits') as { calibration?: Record<string, unknown> } | undefined)?.calibration
  return c && printerFitOf(c) ? c : null
}

/** A calibration as the setup keeps it — Fits' own shape (hole: how much
 *  smaller a hole prints, shaft: how much bigger a shaft, diametral) — from
 *  one given, or "fits" for Fits' calibration as it stands. */
function fitKept(v: unknown): Record<string, unknown> | null {
  const c = v === 'fits' ? fitsNow() : v
  if (!printerFitOf(c)) return null
  const o = c as Record<string, unknown>
  return { hole: o.hole, shaft: o.shaft, source: o.source, ...(o.at ? { at: o.at } : {}), ...(o.profile ? { profile: o.profile } : {}) }
}

// units-ok: the settings' schemas, for the agent — in millimetres always.
export const PRINT_SETTINGS: Record<string, SetupSetting> = {
  printer: {
    schema: str('The printer profile Check stacks (dfm.profiles lists them: bed-slinger, corexy, h2d …).', { minLength: 1 }),
    check: (v) => (typeof v === 'string' && v.trim() && v.length <= 40 ? null : 'printer is a profile id, such as corexy'),
    normalize: (v) => (v as string).trim(),
  },
  nozzle: {
    // units-ok: the setting's schema, for the agent — in millimetres always.
    schema: oneOf([str(), num()], 'The nozzle, mm: "0.4" (0.2, 0.4, 0.6, 0.8 have profiles).'),
    check: (v) => {
      const n = typeof v === 'string' ? Number(v) : v
      return isNum(n) && n >= 0.1 && n <= 2 ? null : 'nozzle is a size from 0.1 to 2, such as "0.4"'
    },
    normalize: (v) => String(Number(v)),
  },
  up: {
    schema: enumOf(UPS, 'Which way of the part stands up on the bed: the way the layers stack (+z as modelled).'),
    check: (v) => ((UPS as readonly unknown[]).includes(v) ? null : `up is one of ${UPS.join(', ')}`),
  },
  // units-ok: the setting's schema, for the agent — in millimetres always.
  layerHeight: { schema: num('The layer height, mm.', { minimum: 0.01, maximum: 2 }), check: range(0.01, 2, 'layerHeight'), normalize: r4 },
  // units-ok: the setting's schema, for the agent — in millimetres always.
  firstLayer: { schema: num('The first layer’s height, mm.', { minimum: 0.01, maximum: 2 }), check: range(0.01, 2, 'firstLayer'), normalize: r4 },
  walls: { schema: int('Walls (perimeters).', { minimum: 0, maximum: 50 }), check: (v) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 50 ? null : 'walls is a whole number from 0 to 50') },
  infill: { schema: num('Infill, percent: 0 (walls only) to 100 (solid).', { minimum: 0, maximum: 100 }), check: range(0, 100, 'infill'), normalize: r4 },
  // units-ok: the setting's schema, for the agent — in millimetres always.
  lineMm: { schema: num('The line width, mm.', { minimum: 0.05, maximum: 3 }), check: range(0.05, 3, 'lineMm'), normalize: r4 },
  fit: {
    // units-ok: the setting's schema, for the agent — in millimetres always.
    schema: oneOf([anyObject('{ hole, shaft, source: "entered" | "measured" | "print-fit", at?, profile? } as Fits keeps it: hole how much smaller a hole prints, shaft how much bigger a shaft, diametral, mm.'), enumOf(['fits'])], 'The printer’s fit calibration: as Fits keeps one, or "fits" to take Fits’ calibration as it stands.'),
    check: (v) => (fitKept(v) ? null : v === 'fits' ? 'Fits has no calibration to take: fit.calibrate first' : 'fit is a calibration as fit.calibrate keeps one: { hole, shaft, source }'),
    normalize: fitKept,
  },
}

/** The printer calibration a print setup holds, in the shared convention;
 *  null when it holds none. */
export const setupFit = (s: Setup): PrinterFit | null => printerFitOf(s.fit)

export const PRINT_SETUP: SetupType = {
  id: 'print',
  label: 'Print',
  title: 'FDM printed: check, slice, send to a printer',
  pages: ['dfm', 'slice', 'print'],
  settings: PRINT_SETTINGS,
  checks: [{ command: 'dfm.check', input: (b) => ({ body: b.id ?? b.name }) }, { command: 'hw.pauses', input: (b) => ({ bodies: [b.name] }) }],
  outputs: ['the printability check (dfm.check)', 'a slice: G-code or 3MF (slicer_slice)', 'a print sent to a printer (printer_*)'],
  Settings: PrintSetupSettings,
  // The printer's calibration: the setup's own, else Fits' as it stands.
  tolerance: (s) => ({ kind: 'print', fit: setupFit(s) ?? printerFitOf(fitsNow()) }),
}
