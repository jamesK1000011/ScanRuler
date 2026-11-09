// SPDX-License-Identifier: AGPL-3.0-only
// A board ordered from a fab: the fab profiles (typical capabilities, never
// a fab's own word — each fab's capabilities page is that, and its figures
// move with the layer count and the options chosen), the order a setup
// asks for, and the board's figures judged against the fab. Pure: no app,
// no page; the commands (pcboCommands.ts) gather the figures, and these
// answers are theirs (the agent API: millimetres always).
//
// Lengths are millimetres throughout, as the agent's commands answer.

export interface Fab {
  id: string
  label: string
  /** Typical least trace width and space between copper. */
  minTrace: number
  minSpace: number
  /** Typical least drill, mechanical. */
  minDrill: number
  /** Copper layer counts usually offered. */
  layers: readonly number[]
  /** Board thicknesses usually offered. */
  thickness: readonly number[]
  finishes: readonly Finish[]
  /** The largest board, either way round; null: not said here. */
  maxSize: readonly [number, number] | null
  /** Whether it places SMT parts from a BOM and CPL. */
  assembly: boolean
  /** What to read the figures as. */
  note: string
}

export const FINISHES = ['hasl', 'lf-hasl', 'enig', 'osp', 'immersion-silver', 'immersion-tin'] as const
export type Finish = (typeof FINISHES)[number]
export const FINISH_LABEL: Record<Finish, string> = { hasl: 'HASL', 'lf-hasl': 'Lead-free HASL', enig: 'ENIG', osp: 'OSP', 'immersion-silver': 'Immersion silver', 'immersion-tin': 'Immersion tin' }

export const ASSEMBLY = ['none', 'smt'] as const
export type Assembly = (typeof ASSEMBLY)[number]

const TYPICAL = 'Typical figures for its standard service, not the fab’s word: its own capabilities page is, and they change with layers and options.'

/** The profiles. Figures for the standard (cheapest) service of a 2-layer
 *  board where they differ by layer count: a finer one costs more. */
export const FABS: readonly Fab[] = [
  {
    id: 'generic',
    label: 'Generic',
    minTrace: 0.15,
    minSpace: 0.15,
    minDrill: 0.3,
    layers: [1, 2, 4, 6],
    thickness: [0.8, 1, 1.2, 1.6, 2],
    finishes: ['hasl', 'lf-hasl', 'enig'],
    maxSize: [400, 400],
    assembly: true,
    note: 'Figures most board houses make in their standard service; a safe start when the fab is not chosen yet.',
  },
  {
    id: 'jlcpcb',
    label: 'JLCPCB',
    minTrace: 0.127,
    minSpace: 0.127,
    minDrill: 0.3,
    layers: [1, 2, 4, 6, 8, 10, 12, 14, 16, 20],
    thickness: [0.4, 0.6, 0.8, 1, 1.2, 1.6, 2],
    finishes: ['hasl', 'lf-hasl', 'enig'],
    maxSize: [400, 500],
    assembly: true,
    note: `${TYPICAL} Finer traces (about 0.09) on 4 layers and up.`,
  },
  {
    id: 'pcbway',
    label: 'PCBWay',
    minTrace: 0.127,
    minSpace: 0.127,
    minDrill: 0.2,
    layers: [1, 2, 4, 6, 8, 10, 12, 14],
    thickness: [0.4, 0.6, 0.8, 1, 1.2, 1.6, 2, 2.4, 3.2],
    finishes: ['hasl', 'lf-hasl', 'enig', 'osp', 'immersion-silver', 'immersion-tin'],
    maxSize: [500, 500],
    assembly: true,
    note: `${TYPICAL} Finer traces (about 0.1) at extra cost.`,
  },
  {
    id: 'oshpark',
    label: 'OSH Park',
    minTrace: 0.1524,
    minSpace: 0.1524,
    minDrill: 0.254,
    layers: [2, 4, 6],
    thickness: [0.8, 1.6],
    finishes: ['enig'],
    maxSize: null,
    assembly: false,
    note: `${TYPICAL} Boards only, ENIG on all; 0.8 thick on its thin 2-layer service.`,
  },
]

export const fabOf = (id: unknown): Fab => FABS.find((f) => f.id === id) ?? FABS[0]

/** The fab's own figures, set over the profile's. */
export interface Limits {
  minTrace?: number
  minSpace?: number
  minDrill?: number
}

/** The order as a setup asks for it, with the board's own where unset. */
export interface Order {
  fab: Fab
  /** The fab's figures used: the profile's, with the setup's limits over them. */
  limits: { minTrace: number; minSpace: number; minDrill: number; from: 'profile' | 'set' }
  layers: number | null
  layersFrom: 'set' | 'board' | 'not known'
  thickness: number
  thicknessFrom: 'set' | 'board' | 'usual'
  finish: Finish
  finishFrom: 'set' | 'fab'
  quantity: number
  assembly: Assembly
}

/** The figures a board house compares, as the board's source gives them. */
export interface BoardFigures {
  source: 'kicad' | 'tscircuit'
  name: string
  /** Width and height of the outline's box. */
  size: [number, number] | null
  thickness: number | null
  layers: number | null
  minTrace: number | null
  /** The least space between copper of two nets: measured on the board
   *  (tscircuit), or the least the board's own rules allow (KiCad: DRC
   *  holds the board to them). */
  minSpace: number | null
  spaceFrom: 'measured' | 'rules' | null
  /** Where the rules came from, when they did. */
  rulesFrom?: string | null
  minDrill: number | null
}

export interface Finding {
  severity: 'error' | 'warning' | 'info'
  rule: string
  says: string
}

export const DEFAULT_QUANTITY = 5
const USUAL_THICKNESS = 1.6

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const r3 = (x: number) => Math.round(x * 1000) / 1000

/** The order a setup's settings ask for, the board's own figures filling
 *  what they leave unset. */
export function orderOf(settings: Record<string, unknown>, board: BoardFigures | null): Order {
  const fab = fabOf(settings.fab)
  const lim = (settings.limits ?? {}) as Limits
  const set = isNum(lim.minTrace) || isNum(lim.minSpace) || isNum(lim.minDrill)
  const layers = isNum(settings.layers) ? settings.layers : (board?.layers ?? null)
  const thickness = isNum(settings.thickness) ? settings.thickness : (board?.thickness ?? USUAL_THICKNESS)
  const finish = (FINISHES as readonly unknown[]).includes(settings.finish) ? (settings.finish as Finish) : fab.finishes[0]
  return {
    fab,
    limits: { minTrace: isNum(lim.minTrace) ? lim.minTrace : fab.minTrace, minSpace: isNum(lim.minSpace) ? lim.minSpace : fab.minSpace, minDrill: isNum(lim.minDrill) ? lim.minDrill : fab.minDrill, from: set ? 'set' : 'profile' },
    layers,
    layersFrom: isNum(settings.layers) ? 'set' : layers !== null ? 'board' : 'not known',
    thickness,
    thicknessFrom: isNum(settings.thickness) ? 'set' : isNum(board?.thickness) ? 'board' : 'usual',
    finish,
    finishFrom: settings.finish !== undefined ? 'set' : 'fab',
    quantity: Number.isInteger(settings.quantity) ? (settings.quantity as number) : DEFAULT_QUANTITY,
    assembly: settings.assembly === 'smt' ? 'smt' : 'none',
  }
}

/** The board against the fab: each figure under the fab's least, the
 *  order's layers, thickness, finish and size against what it offers. */
export function judge(b: BoardFigures | null, o: Order): Finding[] {
  const out: Finding[] = []
  const f = o.fab
  const who = o.limits.from === 'set' ? `${f.label} (the figures set)` : `${f.label} typically`
  const add = (severity: Finding['severity'], rule: string, says: string) => out.push({ severity, rule, says })
  if (b) {
    if (b.minTrace === null) add('info', 'trace', 'The narrowest trace is not known: the board has no traces, or its file does not say.')
    else if (b.minTrace < o.limits.minTrace - 1e-6) add('error', 'trace', `The narrowest trace is ${r3(b.minTrace)} mm, under the ${o.limits.minTrace} mm ${who} makes.`)
    if (b.minSpace === null) add('info', 'space', b.source === 'kicad' ? 'The least clearance the board is held to is not known: no .kicad_pro beside it says. DRC holds it to KiCad’s defaults.' : 'The least space between copper is not known: the board has copper of one net or none.')
    else if (b.minSpace < o.limits.minSpace - 1e-6) {
      if (b.spaceFrom === 'rules') add('warning', 'space', `The board’s rules${b.rulesFrom ? ` (${b.rulesFrom})` : ''} allow copper ${r3(b.minSpace)} mm apart, under the ${o.limits.minSpace} mm ${who} makes, and DRC holds the board to its rules, not the fab’s: raise the clearance in Board Setup, then run DRC again.`)
      else add('error', 'space', `Copper of two nets comes ${r3(b.minSpace)} mm apart, under the ${o.limits.minSpace} mm ${who} makes.`)
    }
    if (b.minDrill !== null && b.minDrill < o.limits.minDrill - 1e-6) add('error', 'drill', `The smallest hole is ${r3(b.minDrill)} mm, under the ${o.limits.minDrill} mm drill ${who} makes.`)
    if (b.layers !== null && o.layersFrom === 'set' && o.layers !== b.layers) add('error', 'layers', `The board has ${b.layers} copper layer${b.layers === 1 ? '' : 's'}; the order says ${o.layers}.`)
    if (b.thickness !== null && o.thicknessFrom === 'set' && Math.abs(o.thickness - b.thickness) > 0.05) add('warning', 'thickness', `The board’s file says ${b.thickness} mm thick, the order ${o.thickness} mm: anything sized round the board (its enclosure) was sized for the file’s.`)
    if (b.size && f.maxSize) {
      const [w, h] = [Math.max(...b.size), Math.min(...b.size)]
      const [mw, mh] = [Math.max(...f.maxSize), Math.min(...f.maxSize)]
      if (w > mw + 1e-6 || h > mh + 1e-6) add('error', 'size', `The board is ${r3(b.size[0])} × ${r3(b.size[1])} mm, more than the ${mw} × ${mh} mm ${who} makes.`)
    }
  }
  if (o.layers === null) add('info', 'layers', 'How many copper layers is not known: set layers on the setup.')
  else if (!f.layers.includes(o.layers)) add('error', 'layers', `${f.label} does not usually make ${o.layers}-layer boards (${f.layers.join(', ')}).`)
  if (!f.thickness.some((t) => Math.abs(t - o.thickness) < 0.01)) add('warning', 'thickness', `${o.thickness} mm is not one of ${f.label}’s usual thicknesses (${f.thickness.join(', ')} mm).`)
  if (!f.finishes.includes(o.finish)) add('error', 'finish', `${f.label} does not usually offer ${FINISH_LABEL[o.finish]} (it does ${f.finishes.map((x) => FINISH_LABEL[x]).join(', ')}).`)
  if (o.assembly === 'smt' && !f.assembly) add('error', 'assembly', `${f.label} makes bare boards only: set assembly to none, or choose a fab that assembles.`)
  return out
}

// ---- the parts lists ------------------------------------------------------------

/** A CSV's rows, quotes kept to their cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const cells: string[] = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"'
          i++
        } else if (c === '"') q = false
        else cur += c
      } else if (c === '"') q = true
      else if (c === ',') {
        cells.push(cur)
        cur = ''
      } else cur += c
    }
    cells.push(cur)
    rows.push(cells)
  }
  return rows
}

const REF_COLUMN = /^(designators?|references?|refs?|ref des)$/i

/** The references a BOM or CPL holds, from its designator column (a row
 *  may hold several: "R1,R2" or "R1 R2"); null when it has none. */
export function refsIn(text: string): string[] | null {
  const rows = parseCsv(text.replace(/^﻿/, ''))
  if (!rows.length) return null
  const col = rows[0].findIndex((h) => REF_COLUMN.test(h.trim()))
  if (col < 0) return null
  const out = new Set<string>()
  for (const r of rows.slice(1)) for (const ref of (r[col] ?? '').split(/[,;\s]+/)) if (ref.trim()) out.add(ref.trim())
  return [...out]
}

const named = (refs: string[]) => (refs.length > 12 ? `${refs.slice(0, 12).join(', ')} and ${refs.length - 12} more` : refs.join(', '))
const are = (refs: string[]) => (refs.length === 1 ? 'is' : 'are')

/** For SMT assembly: the BOM and CPL each there, and holding the same
 *  parts — and every part on the board, where the board names them (or as
 *  many, where it counts them). */
export function listFindings(bom: string[] | null, cpl: string[] | null, board: { refs?: string[] | null; placed?: number | null } = {}): Finding[] {
  const out: Finding[] = []
  if (bom === null) out.push({ severity: 'error', rule: 'bom', says: 'No BOM (parts list): the fab cannot assemble without one.' })
  if (cpl === null) out.push({ severity: 'error', rule: 'cpl', says: 'No CPL (placement list): the fab cannot place parts without one.' })
  if (bom && cpl) {
    const noPlace = bom.filter((r) => !cpl.includes(r))
    const noPart = cpl.filter((r) => !bom.includes(r))
    if (noPlace.length) out.push({ severity: 'error', rule: 'cpl', says: `${named(noPlace)} ${are(noPlace)} in the BOM but not the CPL: the fab will not place ${noPlace.length === 1 ? 'it' : 'them'}.` })
    if (noPart.length) out.push({ severity: 'error', rule: 'bom', says: `${named(noPart)} ${are(noPart)} in the CPL but not the BOM: the fab has no part for ${noPart.length === 1 ? 'it' : 'them'}.` })
  }
  if (board.refs && (bom || cpl)) {
    const listed = new Set([...(bom ?? []), ...(cpl ?? [])])
    const missing = board.refs.filter((r) => !listed.has(r))
    if (missing.length) out.push({ severity: 'error', rule: 'parts', says: `${named(missing)} ${are(missing)} on the board but in neither list: ${missing.length === 1 ? 'it' : 'they'} will not be fitted.` })
  } else if (typeof board.placed === 'number' && cpl && cpl.length < board.placed) out.push({ severity: 'warning', rule: 'parts', says: `The board has ${board.placed} parts to place; the CPL holds ${cpl.length}.` })
  return out
}

/** Worst first. */
export const worstFirst = (fs: Finding[]): Finding[] => [...fs].sort((a, b) => rank(a) - rank(b))
const rank = (f: Finding) => (f.severity === 'error' ? 0 : f.severity === 'warning' ? 1 : 2)

// ---- the order sheet ------------------------------------------------------------

export interface SheetFile {
  name: string
  what: string
}

/** The order sheet: a short markdown page that goes in the package beside
 *  the files — what to choose on the fab's order form, and what each file
 *  is for. In millimetres: it goes to a fab. */
export function orderSheet(a: { setup: string; board: BoardFigures | null; source: string; order: Order; files: SheetFile[]; findings: Finding[]; enclosure?: string | null; at?: Date }): string {
  const o = a.order
  const b = a.board
  const rows: [string, string][] = [
    ['Board', `${b?.name ?? '—'} (${a.source})`],
    ['Size', b?.size ? `${r3(b.size[0])} × ${r3(b.size[1])} mm` : 'not known'],
    ['Layers', o.layers === null ? 'not known' : String(o.layers)],
    ['Thickness', `${o.thickness} mm`],
    ['Finish', FINISH_LABEL[o.finish]],
    ['Quantity', String(o.quantity)],
    ['Assembly', o.assembly === 'smt' ? 'SMT by the fab, from the BOM and CPL' : 'none: bare boards'],
    ['Fab', `${o.fab.label} — typical figures: trace ${o.limits.minTrace} mm, space ${o.limits.minSpace} mm, drill ${o.limits.minDrill} mm`],
  ]
  const lines = [`# Board order: ${a.setup}`, '', '| | |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${v.replace(/\|/g, '\\|')} |`), '', '## Files', '', ...a.files.map((f) => `- \`${f.name}\` — ${f.what}`), '']
  const open = worstFirst(a.findings).filter((f) => f.severity !== 'info')
  lines.push('## Before ordering', '')
  if (open.length) lines.push(...open.map((f) => `- **${f.severity}** (${f.rule}): ${f.says}`))
  else lines.push('- Nothing found against the fab’s typical figures. Its own capabilities page and order form have the last word.')
  if (a.enclosure) lines.push(`- ${a.enclosure}`)
  lines.push('', `${o.fab.note}`, '', `Made ${(a.at ?? new Date()).toISOString().slice(0, 10)}.`, '')
  return lines.join('\n')
}
