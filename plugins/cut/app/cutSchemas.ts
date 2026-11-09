// SPDX-License-Identifier: AGPL-3.0-only
// The cut setup: parts cut from sheet — laser, waterjet, plasma, or a
// router cutting through. Its settings (the machine, the sheet's thickness
// and size, the kerf, the least feature, whether the file's path is
// kerf-compensated), each optional: unset, the figure comes from the
// machine and the part's material (core/rules.ts). The material is the
// part's, never the setup's. Its page on the Make tab is Cut.

import { bool, enumOf, num, arr } from '../../../src/commands/schema'
import { bodyKeyOf, type Setup, type SetupSetting, type SetupType } from '../../_shared/setups'
import { materialOfBody } from '../../_shared/materials/assigned'
import { cutRules, kindOf, KINDS, stuffOf } from '../core/rules'
import { CutSettings } from '../ui/CutSettings'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const range = (lo: number, hi: number, what: string) => (v: unknown) => (isNum(v) && v >= lo && v <= hi ? null : `${what} is to be a number from ${lo} to ${hi}`)
const r4 = (v: unknown) => (isNum(v) ? Math.round(v * 1e4) / 1e4 + 0 : v)

export const CUT_SETTINGS: Record<string, SetupSetting> = {
  machine: {
    schema: enumOf(KINDS, 'The machine: laser, waterjet, plasma, or router (a CNC router cutting through the sheet). laser when unset.'),
    check: (v) => ((KINDS as readonly unknown[]).includes(v) ? null : `machine is one of ${KINDS.join(', ')}`),
  },
  thickness: { schema: num('The sheet’s thickness, mm; the part’s own when unset.', { minimum: 0.05, maximum: 300 }), check: range(0.05, 300, 'thickness'), normalize: r4 },
  kerf: { schema: num('The width the cut takes out, mm — a router’s cutter diameter; by the machine and material when unset.', { minimum: 0.01, maximum: 25 }), check: range(0.01, 25, 'kerf'), normalize: r4 },
  minFeature: { schema: num('The least web, slot or hole, mm; by the machine, material and thickness when unset.', { minimum: 0.01, maximum: 100 }), check: range(0.01, 100, 'minFeature'), normalize: r4 },
  sheet: {
    schema: arr(num(undefined, { exclusiveMinimum: 0 }), 'The sheet’s size, [width, height] mm; parts are checked to fit it and laid out on it.', { minItems: 2, maxItems: 2 }),
    check: (v) => (Array.isArray(v) && v.length === 2 && v.every((x) => isNum(x) && x > 0 && x <= 20000) ? null : 'sheet is [width, height], each over 0 and at most 20000'),
    normalize: (v) => (v as number[]).map((x) => r4(x)),
  },
  compensate: { schema: bool('The file’s path moved off the part by half the kerf, so the cut lands on the drawn edge (false: the drawn edge, the machine’s software compensates — the default).'), check: (v) => (typeof v === 'boolean' ? null : 'compensate is true or false') },
}

/** The setup's kerf, else its machine's in its first part's material. */
export function setupKerf(s: Setup): { kerf: number; tolerance: number } {
  const first = s.bodies[0]
  const m = first !== undefined ? materialOfBody(bodyKeyOf(first)) : null
  const rules = cutRules(kindOf(s), stuffOf(m?.category), isNum(s.thickness) ? s.thickness : 0)
  return { kerf: isNum(s.kerf) ? s.kerf : rules.kerf, tolerance: rules.tolerance }
}

export const CUT_SETUP: SetupType = {
  id: 'cut',
  label: 'Cut',
  title: 'Cut from sheet: laser, waterjet, plasma or router',
  pages: ['cut'],
  settings: CUT_SETTINGS,
  checks: [{ command: 'cut.check', input: (b) => ({ body: b.id ?? b.name }) }],
  outputs: ['the sheet-part check (cut.check)', 'the parts’ outlines laid out flat as DXF or SVG, kerf-compensated or not (cut.export)'],
  Settings: CutSettings,
  tolerance: (s) => {
    const k = setupKerf(s)
    return { kind: 'kerf', kerf: k.kerf, compensated: s.compensate === true, tolerance: k.tolerance }
  },
}
