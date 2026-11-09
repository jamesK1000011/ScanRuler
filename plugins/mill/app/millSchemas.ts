// SPDX-License-Identifier: AGPL-3.0-only
// The mill setup: parts machined on a CNC mill — basic, no toolpaths: the
// machine's axes, the stock, the tool directions the part is reached from,
// the least tool and the longest reach, and the IT grade the machined sizes
// hold (Fits sizes with it). Each optional: unset, the defaults below. The
// material is the part's. Its page on the Make tab is Mill.

import { arr, enumOf, int, num, oneOf, str } from '../../../src/commands/schema'
import type { SetupSetting, SetupType } from '../../_shared/setups'
import { AXES, MILL_DEFAULTS } from '../core/defaults'
import { directionOf, directionWord, type V3 } from '../core/reach'
import { MillSettings } from '../ui/MillSettings'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const range = (lo: number, hi: number, what: string) => (v: unknown) => (isNum(v) && v >= lo && v <= hi ? null : `${what} is to be a number from ${lo} to ${hi}`)
const r4 = (v: unknown) => (isNum(v) ? Math.round(v * 1e4) / 1e4 + 0 : v)

// units-ok: the settings' schemas, for the agent — in millimetres always.
export const MILL_SETTINGS: Record<string, SetupSetting> = {
  axes: {
    schema: enumOf(AXES, 'The machine: "3" (each direction a setup of its own, the part refixtured) or "3+2" (indexed: the head or table turned to each direction). "3" when unset.'),
    check: (v) => ((AXES as readonly unknown[]).includes(v) ? null : `axes is one of ${AXES.join(', ')}`),
  },
  directions: {
    schema: arr(oneOf([enumOf(['+z', '-z', '+x', '-x', '+y', '-y']), arr(num(), undefined, { minItems: 3, maxItems: 3 })]), 'The tool directions, from the part towards the spindle: "+z" (cut from above, the default), "-z" (flipped), or [x, y, z]; one or more.', { minItems: 1, maxItems: 6 }),
    check: (v) => (Array.isArray(v) && v.length >= 1 && v.length <= 6 && v.every((d) => directionOf(d) !== null) ? null : 'directions is a list of 1 to 6: "+z", "-x" … or [x, y, z] of some length'),
    normalize: (v) => (v as unknown[]).map((d) => directionWord(directionOf(d) as V3)).map((w) => (w.startsWith('[') ? (JSON.parse(w) as number[]) : w)),
  },
  margin: { schema: num('Stock round the part’s box, each side, mm (2 when unset); a stock size given wins.', { minimum: 0, maximum: 200 }), check: range(0, 200, 'margin'), normalize: r4 },
  stock: {
    schema: arr(num(undefined, { exclusiveMinimum: 0 }), 'The stock’s size [x, y, z], mm, centred on the part; the part’s box and margin when unset.', { minItems: 3, maxItems: 3 }),
    check: (v) => (Array.isArray(v) && v.length === 3 && v.every((x) => isNum(x) && x > 0 && x <= 5000) ? null : 'stock is [x, y, z], each over 0 and at most 5000'),
    normalize: (v) => (v as number[]).map((x) => r4(x)),
  },
  minTool: { schema: num('The least end mill’s diameter, mm (3 when unset).', { minimum: 0.1, maximum: 50 }), check: range(0.1, 50, 'minTool'), normalize: r4 },
  reach: { schema: num('How far the longest tool reaches below the part’s top, mm (30 when unset).', { minimum: 1, maximum: 500 }), check: range(1, 500, 'reach'), normalize: r4 },
  grade: { schema: int('The ISO 286 IT grade machined sizes hold, 5 (fine) to 14 (rough); 8 when unset.', { minimum: 5, maximum: 14 }), check: (v) => (Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 14 ? null : 'grade is a whole number from 5 to 14') },
  note: { schema: str('A note for the machinist, on the setup sheet; 500 characters at most.'), check: (v) => (typeof v === 'string' && v.length <= 500 ? null : 'note is text of 500 characters at most'), normalize: (v) => (v as string).trim() },
}

export const MILL_SETUP: SetupType = {
  id: 'mill',
  label: 'Mill',
  title: 'CNC milled: reach, corners, depth; STEP and setup sheet',
  pages: ['mill'],
  settings: MILL_SETTINGS,
  checks: [{ command: 'mill.check', input: (b) => ({ body: b.id ?? b.name }) }],
  outputs: ['the milling check (mill.check)', 'the part as STEP with a setup sheet: stock, directions, tools, findings (mill.export)'],
  Settings: MillSettings,
  tolerance: (s) => ({ kind: 'it', grade: Number.isInteger(s.grade) ? (s.grade as number) : MILL_DEFAULTS.grade }),
}
