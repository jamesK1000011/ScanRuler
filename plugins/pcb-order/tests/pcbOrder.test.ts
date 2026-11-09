// SPDX-License-Identifier: AGPL-3.0-only
// A board ordered from a fab: the order a setup asks for, with the board's
// own where unset; the board judged against a fab's typical figures (a
// rule KiCad's DRC holds to is a warning, a gap measured an error); the
// parts lists read and held against each other and the board; the order
// sheet. Then pcbo.check and pcbo.package as an agent runs them, against
// KiCad and tscircuit faked: DRC read, the enclosure kept to its own setup,
// the fab files split and gathered, a tscircuit build made for the outputs
// it lacked, and the lists the package found checked next time.
import { unzipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/commands/registry', () => import('./orderFakes'))
vi.mock('../../../src/commands/schema', () => import('./orderFakes'))
vi.mock('../../../src/commands/stateSections', () => import('./orderFakes'))
vi.mock('../../../src/plugins/api', () => import('./orderFakes'))

import { calls, handlers, sections } from './orderFakes'
import { fabOf, judge, listFindings, orderOf, orderSheet, refsIn, type BoardFigures } from '../app/pcboCommandCore'
import { pcboCommands } from '../app/pcboCommands'
import { useOrder } from '../state/orderStore'
import { zip } from '../../_shared/zip'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const ctx = { progress() {} }
const run = (name: string, input: Record<string, unknown> = {}) => (pcboCommands as unknown as { name: string; run: (i: unknown, c: unknown) => Promise<Json> }[]).find((c) => c.name === name)!.run(input, ctx)
const fails = async (p: Promise<unknown>) => {
  let m = ''
  await p.catch((e: Error) => (m = e.message))
  return m
}
const rules = (fs: { rule: string; severity: string }[]) => fs.map((f) => `${f.severity} ${f.rule}`)
const enc = new TextEncoder()
const dec = new TextDecoder()

const KICAD: BoardFigures = { source: 'kicad', name: 'tiny', size: [50, 40], thickness: 1.6, layers: 2, minTrace: 0.2, minSpace: 0.2, spaceFrom: 'rules', rulesFrom: 'tiny.kicad_pro', minDrill: 0.3 }

describe('the order and the fab', () => {
  it('takes the board’s own where the setup leaves a setting unset', () => {
    const o = orderOf({}, KICAD)
    expect([o.fab.id, o.layers, o.layersFrom, o.thickness, o.thicknessFrom, o.finish, o.finishFrom, o.quantity, o.assembly]).toEqual(['generic', 2, 'board', 1.6, 'board', 'hasl', 'fab', 5, 'none'])
    const set = orderOf({ fab: 'oshpark', layers: 4, thickness: 0.8, quantity: 3, assembly: 'smt', limits: { minTrace: 0.1 } }, KICAD)
    expect([set.fab.label, set.layers, set.thickness, set.finish, set.quantity, set.assembly, set.limits]).toEqual(['OSH Park', 4, 0.8, 'enig', 3, 'smt', { minTrace: 0.1, minSpace: 0.1524, minDrill: 0.254, from: 'set' }])
    // No board and nothing set: the usual thickness, layers not known.
    expect([orderOf({}, null).thickness, orderOf({}, null).layers]).toEqual([1.6, null])
    expect(fabOf('nope').id).toBe('generic')
  })

  it('a board within the fab’s figures: nothing found', () => {
    expect(judge(KICAD, orderOf({}, KICAD))).toEqual([])
  })

  it('each figure under the fab’s, and an order it does not usually make, said', () => {
    const b: BoardFigures = { ...KICAD, size: [450, 100], minTrace: 0.1, minSpace: 0.1, spaceFrom: 'measured', minDrill: 0.2, thickness: 1.6 }
    const o = orderOf({ fab: 'oshpark', layers: 4, thickness: 1.2, finish: 'hasl', assembly: 'smt' }, b)
    expect(rules(judge(b, o))).toEqual(['error trace', 'error space', 'error drill', 'error layers', 'warning thickness', 'warning thickness', 'error finish', 'error assembly'])
    const said = judge(b, o).map((f) => f.says)
    expect(said[0]).toBe('The narrowest trace is 0.1 mm, under the 0.1524 mm OSH Park typically makes.')
    expect(said[3]).toBe('The board has 2 copper layers; the order says 4.')
    // The generic fab's largest board: a long one is too big either way round.
    expect(rules(judge(b, orderOf({}, b))).includes('error size')).toBe(true)
    expect(rules(judge({ ...b, size: [100, 450] }, orderOf({}, b))).includes('error size')).toBe(true)
  })

  it('a clearance from KiCad’s rules is a warning, saying where to raise it; none known is said', () => {
    const f = judge({ ...KICAD, minSpace: 0.1 }, orderOf({}, KICAD))
    expect(rules(f)).toEqual(['warning space'])
    expect(f[0].says).toBe('The board’s rules (tiny.kicad_pro) allow copper 0.1 mm apart, under the 0.15 mm Generic typically makes, and DRC holds the board to its rules, not the fab’s: raise the clearance in Board Setup, then run DRC again.')
    expect(rules(judge({ ...KICAD, minSpace: null, spaceFrom: null, minTrace: null }, orderOf({}, KICAD)))).toEqual(['info trace', 'info space'])
  })

  it('reads the references of a BOM and a CPL, as KiCad, JLCPCB and tscircuit write them', () => {
    expect(refsIn('Comment,Designator,Footprint,LCSC Part #\n10k,"R1,R2",R_0603,C25804\n100n,C1,C_0603,\n')).toEqual(['R1', 'R2', 'C1'])
    expect(refsIn('﻿Ref,Val,Package,PosX,PosY,Rot,Side\nR1,10k,R_0603,1,2,0,top\n')).toEqual(['R1'])
    expect(refsIn('Reference,Value\n"U1 U2",MCU\n')).toEqual(['U1', 'U2'])
    expect(refsIn('Value,Footprint\n10k,R\n')).toBe(null)
  })

  it('a part missing from either list, or from both, is found by name', () => {
    expect(listFindings(['R1', 'C1'], ['R1', 'C1'], { refs: ['R1', 'C1'] })).toEqual([])
    const f = listFindings(['R1', 'C1', 'U1'], ['R1', 'C1', 'J1'], { refs: ['R1', 'C1', 'U1', 'J1', 'D1'] })
    expect(f.map((x) => x.says)).toEqual([
      'U1 is in the BOM but not the CPL: the fab will not place it.',
      'J1 is in the CPL but not the BOM: the fab has no part for it.',
      'D1 is on the board but in neither list: it will not be fitted.',
    ])
    expect(rules(listFindings(null, null))).toEqual(['error bom', 'error cpl'])
    // KiCad's board counts its parts: fewer placed than it has is a warning.
    expect(rules(listFindings(['R1'], ['R1'], { placed: 3 }))).toEqual(['warning parts'])
  })

  it('the order sheet: what to choose on the form, the files, what to put right first', () => {
    const o = orderOf({ fab: 'jlcpcb', finish: 'enig', quantity: 10, assembly: 'smt' }, KICAD)
    const md = orderSheet({ setup: 'Main board', board: KICAD, source: 'KiCad', order: o, files: [{ name: 'tiny-gerbers.zip', what: 'upload this' }], findings: [{ severity: 'error', rule: 'cpl', says: 'U1 is missing.' }, { severity: 'info', rule: 'x', says: 'quiet' }], enclosure: 'The enclosure (tiny box) is made by Print (S2).', at: new Date('2026-11-08T10:00:00Z') })
    const lines = md.split('\n')
    expect(lines[0]).toBe('# Board order: Main board')
    for (const row of ['| Size | 50 × 40 mm |', '| Layers | 2 |', '| Thickness | 1.6 mm |', '| Finish | ENIG |', '| Quantity | 10 |', '| Assembly | SMT by the fab, from the BOM and CPL |', '- `tiny-gerbers.zip` — upload this', '- **error** (cpl): U1 is missing.', '- The enclosure (tiny box) is made by Print (S2).', 'Made 2026-11-08.']) expect(lines.includes(row), row).toBe(true)
    expect(md.includes('quiet')).toBe(false)
    expect(lines.find((l) => l.startsWith('| Fab |'))).toBe('| Fab | JLCPCB — typical figures: trace 0.127 mm, space 0.127 mm, drill 0.3 mm |')
  })
})

// ---- the commands, against Electronics faked --------------------------------------

let setups: Json[] = []
let selected: string | null = null
const bodies = [
  { id: 1, name: 'tiny' },
  { id: 2, name: 'tiny box' },
  { id: 3, name: 'tiny lid' },
  { id: 4, name: 'Board' },
]
let pcb: Json | undefined
let circuit: Json | undefined
sections.setups = () => ({ setups, selected })
sections.reverse = () => ({ bodies })
sections.pcb = () => pcb
sections.circuit = () => circuit

const PCB = () => ({
  setup: { path: '/b/tiny.kicad_pcb' },
  board: { name: 'tiny', size: [50, 40], thickness: 1.6, stats: { copperLayers: 2, minTrack: 0.2, minDrill: 0.3, parts: { placed: 3, listed: 3 } }, rules: { clearance: 0.2, track: null, hole: null, from: 'tiny.kicad_pro' } },
  imported: { body: 'tiny' },
  enclosure: { at: 'x', bodies: ['tiny box', 'tiny lid'] },
})
const BOM = 'Comment,Designator,Footprint,LCSC Part #\n10k,"R1,R2",R_0603,C25804\n'
const POS = 'Designator,Val,Package,Mid X,Mid Y,Rotation,Layer\nR1,10k,R_0603,1,2,0,top\nR2,10k,R_0603,3,2,0,top\nU1,MCU,QFN,5,5,0,top\n'
const FAB_ZIP = zip([
  { name: 'tiny.GTL', bytes: enc.encode('G04 top*') },
  { name: 'tiny.GKO', bytes: enc.encode('G04 edge*') },
  { name: 'tiny-PTH.DRL', bytes: enc.encode('M48') },
  { name: 'assembly/tiny-pos.csv', bytes: enc.encode(POS) },
  { name: 'assembly/tiny-bom.csv', bytes: enc.encode(BOM) },
  { name: 'reports/tiny-drc.json', bytes: enc.encode('{}') },
])
let drc: Json = { clean: true, violations: 0, unconnected: 0, items: [] }
handlers['pcb.drc'] = () => drc
handlers['pcb.fab'] = () => ({ file: { name: 'tiny-fab.zip', mimeType: 'application/zip', bytes: FAB_ZIP }, job: '/h/boards/x', drc: { clean: true, violations: 0, unconnected: 0 }, notes: [] })
handlers['reverse.export.step'] = () => ({ file: { name: 'x.step', mimeType: 'model/step', bytes: enc.encode('ISO-10303-21;') } })

beforeEach(() => {
  setups = [
    { id: 'S1', type: 'pcb', name: 'Main board', bodies: ['1'], fab: 'jlcpcb' },
    { id: 'S2', type: 'print', name: 'Print', bodies: ['2'] },
  ]
  selected = 'S1'
  pcb = PCB()
  circuit = undefined
  drc = { clean: true, violations: 0, unconnected: 0, items: [] }
  calls.length = 0
  useOrder.getState().reset()
})

describe('pcbo.check', () => {
  it('a clean KiCad board on JLCPCB: ok, its figures and the order resolved', async () => {
    const r = await run('check', { setup: 'S1' })
    expect(r.verdict).toBe('ok')
    expect(r.board).toEqual({ name: 'tiny', source: 'kicad', bodies: ['tiny'] })
    expect([r.figures.minTrace, r.figures.minSpace, r.figures.spaceFrom, r.figures.layers]).toEqual([0.2, 0.2, 'rules', 2])
    expect([r.order.fab, r.order.layers, r.order.layersFrom, r.order.finish]).toEqual(['jlcpcb', 2, 'board', 'hasl'])
    expect([r.fab.typical, r.drc.from]).toEqual([true, 'pcb.drc'])
    // The enclosure stays its own part, made by the print setup.
    expect(r.enclosure).toEqual({ bodies: ['tiny box', 'tiny lid'], setups: ['Print (S2)'] })
    expect(useOrder.getState().checked.S1.verdict).toBe('ok')
  })

  it('DRC violations, by the body as part.review asks; the setup chosen on the Make tab by default', async () => {
    drc = { clean: false, violations: 2, unconnected: 1, items: [{ severity: 'error', description: 'Clearance violation (0.1 mm)' }, { severity: 'warning', description: 'Silk over pad' }] }
    const r = await run('check', { body: 'tiny' })
    expect(r.verdict).toBe('fix')
    expect(r.findings.map((f: Json) => f.says)).toEqual(['DRC: 2 violations, 1 unconnected — pcb.drc lists them with where they are.', 'DRC: Clearance violation (0.1 mm)', 'DRC: Silk over pad'])
    expect((await run('check')).setup.id).toBe('S1')
  })

  it('DRC that cannot run leaves the verdict unknown; drc: false skips it', async () => {
    delete handlers['pcb.drc']
    const r = await run('check')
    handlers['pcb.drc'] = () => drc
    expect([r.verdict, r.drc.ran, rules(r.findings)]).toEqual(['unknown', false, ['warning drc']])
    expect((await run('check', { drc: false })).verdict).toBe('unknown')
    expect(calls.filter((c) => c.name === 'pcb.drc').length).toBe(1)
  })

  it('the enclosure put in the order is an error; one in no setup is pointed to a print setup', async () => {
    setups = [{ id: 'S1', type: 'pcb', name: 'Main board', bodies: ['1', '2'] }]
    const r = await run('check', { setup: 'Main board' })
    expect(r.verdict).toBe('fix')
    expect(r.findings[0].says).toBe('tiny box is the board’s enclosure, not the board: take it out of this setup and into a print, cut or mill setup.')
    expect(r.findings.find((f: Json) => f.rule === 'enclosure' && f.severity === 'info').says).toBe('The enclosure (tiny box, tiny lid) is in no setup yet: setup.add { type: "print", bodies: ["tiny box", "tiny lid"] } records how it is made.')
  })

  it('a tscircuit board: its measured gap against the fab, the build’s errors', async () => {
    pcb = undefined
    circuit = { lastBuild: { job: 'j1', ok: false, files: [], failure: 'no route' }, loaded: { name: 'blinky.circuit.json' }, made: { bodies: ['Board'] } }
    handlers['circuit.stats'] = () => ({ name: 'blinky.circuit.json', board: { width: 30, height: 20, thickness: 1.2 }, layers: { declared: 2, withCopper: ['top', 'bottom'] }, traces: { minWidth: 0.15 }, minDrill: 0.3, minClearance: { mm: 0.1 }, refs: ['R1'], errors: 0 })
    setups = [{ id: 'S1', type: 'pcb', name: 'Blinky', bodies: ['4'] }]
    const r = await run('check')
    expect(r.board.source).toBe('tscircuit')
    expect(r.figures.name).toBe('blinky')
    expect(rules(r.findings)).toEqual(['error space', 'error build'])
    expect(r.findings[1].says).toBe('The last tscircuit build failed: no route.')
  })

  it('a board neither source owns is said; a setup of another kind and none at all refused', async () => {
    circuit = { loaded: { name: 'x' }, made: { bodies: [] } }
    setups = [{ id: 'S1', type: 'pcb', name: 'Main board', bodies: ['Odd'] }]
    const r = await run('check')
    expect([r.verdict, r.findings[0].rule]).toEqual(['fix', 'source'])
    setups = [{ id: 'S2', type: 'print', name: 'Print', bodies: ['2'] }]
    expect(await fails(run('check', { setup: 'S2' }))).toBe('Print (S2) is a print setup, not a PCB order: its part is made another way.')
    expect(await fails(run('check'))).toBe('No PCB order setup: setup.add { type: "pcb", bodies: [the board] } records one.')
    // A body in no PCB order setup: judged on the generic profile, and said.
    const loose = await run('check', { body: 'tiny' })
    expect([loose.setup, loose.order.fab, loose.findings.some((f: Json) => f.rule === 'setup')]).toEqual([null, 'generic', true])
  })
})

describe('pcbo.package', () => {
  it('KiCad: the fab files split for the order, the lists checked, a STEP and an order sheet, in one folder', async () => {
    setups[0].assembly = 'smt'
    const r = await run('package')
    expect(calls.find((c) => c.name === 'pcb.fab')!.input).toEqual({ naming: 'fab', drc: true })
    expect(calls.find((c) => c.name === 'reverse.export.step')!.input).toEqual({ bodies: ['tiny'] })
    expect(r.file.name).toBe('tiny-order.zip')
    expect(r.files).toEqual(['tiny-order/tiny-gerbers.zip', 'tiny-order/reports/tiny-drc.json', 'tiny-order/assembly/tiny-bom.csv', 'tiny-order/assembly/tiny-cpl.csv', 'tiny-order/tiny.step', 'tiny-order/order.md'])
    const out = unzipSync(r.file.bytes)
    expect(Object.keys(unzipSync(out['tiny-order/tiny-gerbers.zip']))).toEqual(['tiny.GTL', 'tiny.GKO', 'tiny-PTH.DRL'])
    expect(dec.decode(out['tiny-order/assembly/tiny-cpl.csv'])).toBe(POS)
    // U1 is placed but has no BOM line.
    expect(r.findings.map((f: Json) => f.says)).toEqual(['U1 is in the CPL but not the BOM: the fab has no part for it.'])
    const md = dec.decode(out['tiny-order/order.md'])
    expect(md.split('\n').includes('- **error** (bom): U1 is in the CPL but not the BOM: the fab has no part for it.')).toBe(true)
    expect(md.split('\n').includes('- The enclosure (tiny box, tiny lid) is made by Print (S2).')).toBe(true)
    // The next check reads the lists the package found.
    const c = await run('check')
    expect(c.findings[0].says.startsWith('U1 is in the CPL but not the BOM')).toBe(true)
  })

  it('assembly none: no lists in it; the check says the lists wait for a package', async () => {
    const r = await run('package', { setup: 'S1' })
    expect(r.files.some((f: string) => f.includes('assembly/'))).toBe(false)
    expect(r.notes).toEqual(['Assembly none: no BOM or CPL in the package.'])
    setups[0].assembly = 'smt'
    useOrder.getState().reset()
    expect((await run('check')).findings.find((f: Json) => f.rule === 'lists').says).toBe('The BOM and CPL are checked once pcbo.package has gathered them.')
  })

  it('tscircuit: a build made for the outputs the last one lacked, its files read through the server', async () => {
    pcb = undefined
    circuit = { lastBuild: { job: 'j1', ok: true, files: ['circuit.json', 'gerbers.zip'] }, loaded: { name: 'blinky.circuit.json' }, made: { bodies: ['Board'] } }
    handlers['circuit.stats'] = () => ({ name: 'blinky.circuit.json', board: { width: 30, height: 20, thickness: 1.6 }, layers: { declared: 2, withCopper: [] }, traces: { minWidth: 0.2 }, minDrill: 0.4, minClearance: { mm: 0.3 }, refs: ['R1', 'D1'], errors: 0 })
    handlers['circuit.build'] = () => ({ job: 'j2', ok: true, files: { 'gerbers.zip': '/j2/gerbers.zip', 'bom.csv': '/j2/bom.csv', 'pick_and_place.csv': '/j2/pick_and_place.csv' } })
    const texts: Record<string, string> = { 'F_Cu.gtl': 'G04 top*', 'Edge_Cuts.gm1': 'G04 edge*', 'bom.csv': 'Designator,Comment\nR1,1k\n', 'pick_and_place.csv': 'Designator,Mid X\nR1,0mm\n' }
    handlers['circuit.read'] = (i: { path: string; entry?: string }) => (i.path === 'gerbers.zip' && !i.entry ? { entries: [{ name: 'F_Cu.gtl' }, { name: 'Edge_Cuts.gm1' }, { name: 'bom.csv' }] } : { text: texts[i.entry ?? i.path] })
    setups = [{ id: 'S1', type: 'pcb', name: 'Blinky', bodies: ['4'], assembly: 'smt' }]
    const r = await run('package')
    expect(calls.find((c) => c.name === 'circuit.build')!.input).toEqual({ outputs: ['gerbers', 'bom', 'pnp'], open: false })
    expect(calls.filter((c) => c.name === 'circuit.read').every((c) => c.input.job === 'j2')).toBe(true)
    expect(r.job).toBe('j2')
    expect(Object.keys(unzipSync(unzipSync(r.file.bytes)['blinky-order/blinky-gerbers.zip']))).toEqual(['F_Cu.gtl', 'Edge_Cuts.gm1'])
    expect(r.findings.map((f: Json) => f.says)).toEqual(['D1 is on the board but in neither list: it will not be fitted.'])
    // A last build that holds them all is used as it is.
    circuit.lastBuild = { job: 'j2', ok: true, files: ['gerbers.zip', 'bom.csv', 'pick_and_place.csv'] }
    calls.length = 0
    await run('package')
    expect(calls.some((c) => c.name === 'circuit.build')).toBe(false)
  })

  it('refuses an enclosure in the order, and a build that failed', async () => {
    setups = [{ id: 'S1', type: 'pcb', name: 'Main board', bodies: ['1', '3'] }]
    expect(await fails(run('package'))).toBe('tiny lid is the board’s enclosure, not the board: take it out of this setup and into a print, cut or mill setup.')
    pcb = undefined
    circuit = { lastBuild: null, loaded: { name: 'b' }, made: { bodies: ['Board'] } }
    handlers['circuit.build'] = () => ({ job: 'j3', ok: false, failure: 'The build has 1 error, so it failed.' })
    setups = [{ id: 'S1', type: 'pcb', name: 'Blinky', bodies: ['4'] }]
    expect(await fails(run('package'))).toBe('The tscircuit build failed: The build has 1 error, so it failed. Fix the board and package again.')
  })
})

describe('the PCB order setup type', () => {
  it('its settings checked and kept as given; part.review runs pcbo.check on the body; no tolerance', async () => {
    const { ORDER_SETTINGS: S, PCB_ORDER_SETUP: T } = await import('../app/orderSetup')
    expect([T.id, T.pages, T.tolerance, T.checks?.[0].command, T.checks?.[0].input?.({ id: 7, name: 'tiny' })]).toEqual(['pcb', ['pcbo'], undefined, 'pcbo.check', { body: 'tiny' }])
    expect(T.title.length <= 60).toBe(true)
    expect([S.fab.check('JLCPCB'), S.fab.normalize!('JLCPCB'), S.fab.check('acme')]).toEqual([null, 'jlcpcb', 'fab is one of generic, jlcpcb, pcbway, oshpark'])
    expect([S.layers.check(4), S.layers.check(2.5), S.thickness.check(1.6), S.thickness.check(5), S.thickness.normalize!(1.23456)]).toEqual([null, 'layers is a whole number from 1 to 32', null, 'thickness is a number from 0.2 to 3.2', 1.235])
    expect([S.finish.check('enig'), S.assembly.check('smt'), S.assembly.check('tht'), S.quantity.check(0), S.source.check('kicad')]).toEqual([null, null, 'assembly is none or smt', 'quantity is a whole number from 1 to 100000', null])
    expect([S.limits.check({ minTrace: 0.1 }), S.limits.check({ minHole: 0.1 }), S.limits.check({ minSpace: -1 }), S.limits.normalize!({ minDrill: 0.20004 })]).toEqual([null, 'limits has no minHole: it has minTrace, minSpace, minDrill', 'limits.minSpace is a number over 0, up to 5', { minDrill: 0.2 }])
  })
})
