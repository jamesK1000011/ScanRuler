// SPDX-License-Identifier: AGPL-3.0-only
// The generators: each a set of named parameters, checked, and the solids
// they make. Shared by the worker that builds them, the commands that ask
// for them and the panel that sets them.

import { box, BOX_DEFAULTS, checkBox, lid, type BoxParams } from './enclosure'
import { BOARD_BOX_DEFAULTS, boardBox, boardBoxPlan, boardLid, checkBoardBox, type BoardBoxParams, type BoardSpec } from './boardBox'
import { BASE_DEFAULTS, baseplate, bin, BIN_DEFAULTS, checkBin, MAGNET, magnetsOf, type BaseParams, type BinParams } from './gridfinity'
import type { GenPart } from './genWorker'
import type { GenKernel, H } from './kernel'

export type Value = number | boolean

export interface Param {
  key: string
  label: string
  kind: 'int' | 'num' | 'bool'
  min?: number
  max?: number
  step?: number
  /** A word for a count's unit (cells); a length has none here — it is
   *  millimetres, shown in the display units. */
  unit?: string
  /** A length in millimetres. */
  length?: boolean
  /** A line on what it does. */
  tip: string
}

export interface Generator {
  id: string
  label: string
  blurb: string
  params: Param[]
  defaults: Record<string, Value>
  /** Takes a board besides its values (BoardSpec): a box made round it. */
  board?: boolean
  /** Why these values won't do, or null; with the board, if it takes one. */
  check(p: Record<string, Value>, board?: BoardSpec | null): string | null
  /** The solids, each under its name. */
  build(k: GenKernel, p: Record<string, Value>, board?: BoardSpec | null): { name: string; shape: H }[]
  /** Where its pieces go, worked out without building: for a check. */
  plan?(p: Record<string, Value>, board: BoardSpec): unknown
  /** Hardware that goes into its holes (magnets), as built: recorded with
   *  the Hardware workspace for its pause and its mass. */
  embeds?(p: Record<string, Value>): GenEmbed[]
}

/** Parts that go into a generated part's holes. */
export interface GenEmbed {
  /** The part they go in, by name. */
  part: string
  kind: 'magnet'
  /** As the Hardware workspace's table has it. */
  size: string
  what: string
  /** Each one's centre, as built, mm. */
  centres: [number, number, number][]
  /** The holes' top, Z as built, mm. */
  top: number
  /** The holes' width, mm. */
  span: number
  /** How they go in, for the answer. */
  note: string
}

const magnetEmbeds = (part: string, m: ReturnType<typeof magnetsOf>, note: string): GenEmbed[] =>
  m ? [{ part, kind: 'magnet', size: MAGNET.size, what: `${m.centres.length} ${MAGNET.size} magnets`, centres: m.centres, top: m.top, span: m.span, note }] : []

const int = (key: string, label: string, min: number, max: number, tip: string, unit?: string): Param => ({ key, label, kind: 'int', min, max, step: 1, tip, ...(unit ? { unit } : {}) })
const num = (key: string, label: string, min: number, max: number, step: number, tip: string): Param => ({ key, label, kind: 'num', min, max, step, length: true, tip })
const flag = (key: string, label: string, tip: string): Param => ({ key, label, kind: 'bool', tip })

const binName = (p: BinParams) => `Gridfinity bin ${p.x}x${p.y}x${p.units}`

export const GENERATORS: Generator[] = [
  {
    id: 'gridfinity_bin',
    label: 'Gridfinity bin',
    // units-ok: Gridfinity's own figures, metric by definition.
    blurb: 'A storage bin on the 42 mm Gridfinity grid, in 7 mm height units, with the stacking lip, magnet and screw holes, dividers and a label ledge.',
    params: [
      // units-ok: the standard's cell and unit sizes.
      int('x', 'Width', 1, 10, 'Cells across (42 mm each).', 'cells'),
      // units-ok: as above.
      int('y', 'Depth', 1, 10, 'Cells deep (42 mm each).', 'cells'),
      // units-ok: as above.
      int('units', 'Height', 2, 30, 'Height units (7 mm each), base included, lip not.', 'units'),
      flag('lip', 'Stacking lip', 'The rim another bin stacks on.'),
      // units-ok: the magnets' size as sold.
      flag('magnets', 'Magnet holes', '6 × 2 mm magnets, four under each cell.'),
      flag('screws', 'Screw holes', 'M3 screws into the baseplate, four per cell.'),
      num('wall', 'Wall', 0, 5, 0.1, 'Wall thickness; 0 for a solid block to cut your own pocket into.'),
      num('floor', 'Floor', 0.4, 10, 0.1, 'Floor thickness above the base.'),
      int('dividersX', 'Dividers across', 0, 10, 'Walls splitting it left to right.'),
      int('dividersY', 'Dividers deep', 0, 10, 'Walls splitting it front to back.'),
      num('label', 'Label ledge', 0, 20, 0.5, 'A ledge along the back for a label; 0 for none.'),
      num('holes', 'Hole allowance', -0.5, 1, 0.05, 'Added to the magnet and screw holes’ diameters: printed holes come out small. Follows the printer’s fit calibration unless set.'),
    ],
    defaults: { ...BIN_DEFAULTS },
    check: (p) => checkBin(p as unknown as BinParams),
    build: (k, p) => [{ name: binName(p as unknown as BinParams), shape: bin(k, p as unknown as BinParams) }],
    embeds: (p) => magnetEmbeds(binName(p as unknown as BinParams), magnetsOf('bin', p as unknown as BinParams), 'The magnet holes open onto the bed: press the magnets in after printing, or drop them in at the pause and they are printed over.'),
  },
  {
    id: 'gridfinity_baseplate',
    label: 'Gridfinity baseplate',
    // units-ok: Gridfinity's own figures.
    blurb: 'The plate Gridfinity bins drop into: a grid of 42 mm pockets, open underneath, or on a floor with magnet holes.',
    params: [
      int('x', 'Width', 1, 20, 'Cells across.', 'cells'),
      int('y', 'Depth', 1, 20, 'Cells deep.', 'cells'),
      // units-ok: the magnets' size as sold.
      flag('magnets', 'Magnet holes', 'A floor under the pockets with 6 × 2 mm magnet holes.'),
      num('holes', 'Hole allowance', -0.5, 1, 0.05, 'Added to the magnet holes’ diameters. Follows the printer’s fit calibration unless set.'),
    ],
    defaults: { ...BASE_DEFAULTS },
    check: (p) => (Number.isInteger(p.x) && Number.isInteger(p.y) && (p.x as number) >= 1 && (p.y as number) >= 1 && (p.x as number) <= 20 && (p.y as number) <= 20 ? null : 'x and y are whole cells, 1 to 20.'),
    build: (k, p) => [{ name: `Gridfinity baseplate ${p.x}x${p.y}`, shape: baseplate(k, p as unknown as BaseParams) }],
    embeds: (p) => magnetEmbeds(`Gridfinity baseplate ${p.x}x${p.y}`, magnetsOf('baseplate', p as unknown as BaseParams), 'The magnet holes open into the pockets above: drop the magnets in at the pause or after printing.'),
  },
  {
    id: 'project_box',
    label: 'Project box',
    blurb: 'A rounded box with a lid that drops in on a lip at a set clearance, optionally screwed down into corner bosses (M3). The lid is laid out beside the box, top down, to print flat.',
    params: [
      num('width', 'Width', 20, 400, 1, 'Outside, left to right.'),
      num('depth', 'Depth', 20, 400, 1, 'Outside, front to back.'),
      num('height', 'Height', 8, 300, 1, 'Outside, without the lid.'),
      num('corner', 'Corner radius', 0, 50, 0.5, 'Outside corners.'),
      num('wall', 'Wall', 0.8, 10, 0.1, 'Side walls.'),
      num('floor', 'Floor', 0.6, 20, 0.1, 'The bottom.'),
      num('lid', 'Lid', 0.6, 10, 0.1, 'The lid plate.'),
      num('lip', 'Lip depth', 0, 50, 0.5, 'How far the lid’s lip drops inside; 0 for a flat lid.'),
      num('clearance', 'Clearance', 0, 1, 0.05, 'Gap each side between lip and wall; 0.2 suits most printers. Follows the printer’s fit calibration unless set.'),
      flag('screws', 'Corner screws', 'M3 bosses in the corners and holes through the lid.'),
      num('holes', 'Hole allowance', -0.5, 1, 0.05, 'Added to the screw holes’ diameters. Follows the printer’s fit calibration unless set.'),
    ],
    defaults: { ...BOX_DEFAULTS },
    check: (p) => checkBox(p as unknown as BoxParams),
    build: (k, p) => [
      { name: 'Box', shape: box(k, p as unknown as BoxParams) },
      { name: 'Lid', shape: lid(k, p as unknown as BoxParams) },
    ],
  },
]

const boxed = (b?: BoardSpec | null) => {
  if (!b) throw new Error('No board: bring one in with Electronics › KiCad (pcb.import), or give board.')
  return b
}

GENERATORS.push({
  id: 'board_box',
  label: 'Board enclosure',
  blurb: 'A box round a circuit board: standoffs under its mounting holes (heat-set inserts or self-tapping screws), room above and below its parts, openings for the connectors at its edge, and a lid on a lip. Made in the board’s frame, so it stands round the board; the lid beside it, top down.',
  board: true,
  params: [
    num('wall', 'Wall', 0.8, 10, 0.1, 'Side walls.'),
    num('floor', 'Floor', 0.6, 20, 0.1, 'The bottom.'),
    num('lid', 'Lid', 0.6, 10, 0.1, 'The lid plate.'),
    num('lip', 'Lip depth', 0, 50, 0.5, 'How far the lid’s lip drops inside; 0 for a flat lid.'),
    num('clearance', 'Lid clearance', 0, 1, 0.05, 'Gap each side between lip and wall. Follows the printer’s fit calibration unless set.'),
    num('corner', 'Corner radius', 0, 50, 0.5, 'Outside corners.'),
    num('gap', 'Gap to the board', 0, 20, 0.1, 'Between the board’s edge and the wall, each side. Follows the printer’s fit calibration unless set.'),
    num('standoff', 'Standoff', 1, 50, 0.5, 'The board’s bottom above the floor; more than its parts underneath reach.'),
    num('headroom', 'Headroom', 0, 100, 0.5, 'Above the tallest part, to the lid.'),
    flag('inserts', 'Heat-set inserts', 'Holes for brass inserts in the standoffs; off for self-tapping screw pilots.'),
    flag('cutouts', 'Connector openings', 'Openings in the walls for the connectors at the edge.'),
    num('margin', 'Opening margin', 0, 5, 0.1, 'Added round each opening, each side. Follows the printer’s fit calibration unless set.'),
    num('holes', 'Hole allowance', -0.5, 1, 0.05, 'Added to the insert and pilot holes’ diameters. Follows the printer’s fit calibration unless set.'),
  ],
  defaults: { ...BOARD_BOX_DEFAULTS },
  check: (p, b) => checkBoardBox(p as unknown as BoardBoxParams, b),
  build: (k, p, b) => {
    const board = boxed(b)
    const name = board.name ? `${board.name} ` : 'Board '
    return [
      { name: `${name}box`, shape: boardBox(k, p as unknown as BoardBoxParams, board) },
      { name: `${name}lid`, shape: boardLid(k, p as unknown as BoardBoxParams, board) },
    ]
  },
  plan: (p, b) => boardBoxPlan(p as unknown as BoardBoxParams, b),
})

export const generatorOf = (id: string): Generator | undefined => GENERATORS.find((g) => g.id === id)

/** The values for a generator: its defaults, then those given, each
 *  checked against its parameter. Throws on a name or value that won't do. */
export function valuesOf(g: Generator, given: Record<string, unknown> = {}, base: Record<string, Value> = g.defaults, board?: BoardSpec | null): Record<string, Value> {
  const out: Record<string, Value> = { ...g.defaults, ...base }
  for (const [key, v] of Object.entries(given)) {
    const p = g.params.find((q) => q.key === key)
    if (!p) throw new Error(`${g.label} has no parameter "${key}" (it has ${g.params.map((q) => q.key).join(', ')}).`)
    if (p.kind === 'bool') {
      if (typeof v !== 'boolean') throw new Error(`${key} is true or false.`)
    } else {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${key} is a number.`)
      if (p.kind === 'int' && !Number.isInteger(v)) throw new Error(`${key} is a whole number.`)
      if ((p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max)) throw new Error(`${key}: ${p.min} to ${p.max}${p.unit ? ` ${p.unit}` : ''}.`)
    }
    out[key] = v
  }
  const why = g.check(out, board)
  if (why) throw new Error(why)
  return out
}

/** The part each new body is: by where its box stands, nearest first; in
 *  order where a body has no box. */
export function matchParts(parts: GenPart[], bodies: { bounds?: { min: number[]; max: number[] } | null }[]): (GenPart | undefined)[] {
  const left = new Set(parts.map((_, i) => i))
  return bodies.map((b, i) => {
    let best = -1
    let far = Infinity
    if (b.bounds)
      for (const j of left) {
        const p = parts[j]
        const d = [0, 1, 2].reduce((s, k) => s + Math.abs(p.box.min[k] - b.bounds!.min[k]) + Math.abs(p.box.max[k] - b.bounds!.max[k]), 0)
        if (d < far) [best, far] = [j, d]
      }
    if (best < 0) best = left.has(i) ? i : [...left][0] ?? -1
    if (best < 0) return undefined
    left.delete(best)
    return parts[best]
  })
}
