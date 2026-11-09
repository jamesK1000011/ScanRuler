// SPDX-License-Identifier: AGPL-3.0-only
// The PCB order setup: a circuit board — from KiCad or tscircuit, brought
// into Reverse Engineer as a body — made by a board house. Its page on the
// Make tab is Order (pcbo); part.review judges a board in one by
// pcbo.check. It has no machine tolerance: nothing is sized to fit by it.
// The board's enclosure is a part of its own, made by a print, cut or mill
// setup — never this one (pcbo.check says so when one is put here).
// Its settings' panel is added by plugin.ts, so this stands without a page.

import { anyObject, enumOf, int, num } from '../../../src/commands/schema'
import type { SetupSetting, SetupType } from '../../_shared/setups'
import { ASSEMBLY, FABS, FINISHES } from './pcboCommandCore'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const r3 = (v: unknown) => (isNum(v) ? Math.round(v * 1000) / 1000 + 0 : v)
const LIMIT_KEYS = ['minTrace', 'minSpace', 'minDrill'] as const

export const ORDER_SETTINGS: Record<string, SetupSetting> = {
  fab: {
    schema: enumOf(FABS.map((f) => f.id), `The fab profile: ${FABS.map((f) => `${f.id} (${f.label})`).join(', ')} — typical capabilities, not the fab’s word; generic by default.`),
    check: (v) => (typeof v === 'string' && FABS.some((f) => f.id === v.toLowerCase()) ? null : `fab is one of ${FABS.map((f) => f.id).join(', ')}`),
    normalize: (v) => (v as string).toLowerCase(),
  },
  layers: {
    schema: int('Copper layers ordered; the board’s own by default.', { minimum: 1, maximum: 32 }),
    check: (v) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 32 ? null : 'layers is a whole number from 1 to 32'),
  },
  thickness: {
    // units-ok: the setting's schema, for the agent — in millimetres always.
    schema: num('Board thickness ordered, mm; the board’s own by default.', { minimum: 0.2, maximum: 3.2 }),
    check: (v) => (isNum(v) && v >= 0.2 && v <= 3.2 ? null : 'thickness is a number from 0.2 to 3.2'),
    normalize: r3,
  },
  finish: {
    schema: enumOf(FINISHES, 'The surface finish; the fab’s first by default.'),
    check: (v) => ((FINISHES as readonly unknown[]).includes(v) ? null : `finish is one of ${FINISHES.join(', ')}`),
  },
  quantity: {
    schema: int('How many boards; 5 by default.', { minimum: 1, maximum: 100000 }),
    check: (v) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 100000 ? null : 'quantity is a whole number from 1 to 100000'),
  },
  assembly: {
    schema: enumOf(ASSEMBLY, 'none: bare boards; smt: the fab places the SMT parts, from the BOM and CPL.'),
    check: (v) => ((ASSEMBLY as readonly unknown[]).includes(v) ? null : `assembly is ${ASSEMBLY.join(' or ')}`),
  },
  limits: {
    // units-ok: the setting's schema, for the agent — in millimetres always.
    schema: anyObject('The fab’s own figures over the profile’s, mm: { minTrace, minSpace, minDrill }, each optional.'),
    check: (v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return 'limits is { minTrace, minSpace, minDrill }'
      for (const [k, x] of Object.entries(v)) {
        if (!(LIMIT_KEYS as readonly string[]).includes(k)) return `limits has no ${k}: it has ${LIMIT_KEYS.join(', ')}`
        if (!isNum(x) || x <= 0 || x > 5) return `limits.${k} is a number over 0, up to 5`
      }
      return null
    },
    normalize: (v) => Object.fromEntries(Object.entries(v as Record<string, number>).map(([k, x]) => [k, r3(x)])),
  },
  source: {
    schema: enumOf(['kicad', 'tscircuit'], 'Where the board comes from, when the body’s name does not say: kicad (Electronics › KiCad) or tscircuit.'),
    check: (v) => (v === 'kicad' || v === 'tscircuit' ? null : 'source is kicad or tscircuit'),
  },
}

export const PCB_ORDER_SETUP: SetupType = {
  id: 'pcb',
  label: 'PCB order',
  title: 'A circuit board ordered from a fab: check, package',
  pages: ['pcbo'],
  settings: ORDER_SETTINGS,
  checks: [{ command: 'pcbo.check', input: (b) => ({ body: b.name }) }],
  outputs: ['the order check: DRC, and the board against the fab’s typical figures (pcbo.check)', 'the order package: Gerbers and drill zipped, BOM, CPL, STEP and an order sheet, one zip (pcbo.package)'],
}
