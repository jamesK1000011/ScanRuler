// SPDX-License-Identifier: AGPL-3.0-only
// The Boards extras: a KiCad board read without KiCad (outline, holes,
// edge connectors and the side each faces); kicad-cli found and each
// command's flags read off its --help, a flag an older KiCad lacks never
// passed; the STEP export centred on the outline; the fab package named
// for a board house and zipped; DRC's exit 5 read as violations. A
// stand-in kicad-cli (fakeKicad.js) of KiCad 7, 8 and 9; the real one,
// where installed, at the end.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { extraTools } from '../src/extras/index.js'
import { readBoard, parseSexpr, fabLayers, heightOf } from '../src/extras/kicadBoard.js'
import { checkPositions, fabName, fabPackage, fabPositions, findKicadCli, importBoard, kicadTools, lists, parseCsv, PLACEHOLDER_HEIGHT, runDrc, summariseDrc, unmodelledParts } from '../src/extras/kicad.js'
import { zipEntries } from '../src/extras/zip.js'
import { fakeKicad } from './fakeKicad.js'

const FIXTURE = fileURLToPath(new URL('./fixtures/tiny.kicad_pcb', import.meta.url))
const helpers = { text: (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] }), failure: (e) => ({ isError: true, content: [{ type: 'text', text: String(e.message ?? e) }] }) }
const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`)

async function setUp(major = 9) {
  const dir = await mkdtemp(join(tmpdir(), 'kicad-'))
  const board = join(dir, 'tiny.kicad_pcb')
  await copyFile(FIXTURE, board)
  const cli = await fakeKicad(dir, major)
  const log = join(dir, 'runs.log')
  const env = { ...process.env, SCANRULER_HOME: join(dir, 'home'), SCANRULER_KICAD_CLI: cli, FAKE_KICAD_LOG: log }
  const runs = async () => (existsSync(log) ? (await readFile(log, 'utf8')).trim().split('\n').map((l) => JSON.parse(l)) : [])
  return { dir, board, cli, env, runs }
}

test('the s-expression: strings with escapes, nesting, a file cut short', () => {
  assert.deepEqual(parseSexpr('(a "b \\"c\\"" (d 1.5) e)'), ['a', 'b "c"', ['d', '1.5'], 'e'])
  assert.throws(() => parseSexpr('(a (b)'), /cut short/)
  assert.throws(() => parseSexpr('(a "b'), /cut short/)
  assert.throws(() => parseSexpr('(a)(b)'), /more than one/)
  assert.throws(() => readBoard('(kicad_sch (version 1))'), /not \(kicad_pcb/)
})

test('the board: outline with its round corner, thickness, centred frame', async () => {
  const b = readBoard(await readFile(FIXTURE, 'utf8'), { name: 'tiny' })
  assert.equal(b.thickness, 1.6)
  assert.deepEqual(b.origin, [125, 120])
  assert.deepEqual(b.size, [50, 40])
  // The corner arc (radius 3) stays inside the box, through its middle.
  const xs = b.outline.map((p) => p[0])
  const ys = b.outline.map((p) => p[1])
  near(Math.max(...xs), 25)
  near(Math.min(...ys), -20)
  assert.ok(b.outline.some(([x, y]) => Math.abs(x - 24.1213) < 0.01 && Math.abs(y + 19.1213) < 0.01), 'the arc passes its mid point')
  assert.ok(!b.outline.some(([x, y]) => x > 24.9 && y < -19.9), 'no point in the cut corner')
  assert.deepEqual(fabLayers(b), ['F.Cu', 'B.Cu', 'B.Mask', 'F.Mask', 'B.SilkS', 'F.SilkS', 'B.Paste', 'F.Paste', 'Edge.Cuts'])
})

test('the holes: both MountingHole footprints, at their places, y turned up', async () => {
  const b = readBoard(await readFile(FIXTURE, 'utf8'))
  assert.deepEqual(b.holes.map((h) => [h.ref, h.x, h.y, h.d]), [['H1', -20, -15, 3.2], ['H2', 20, 15, 3.2]])
  // The USB-C's 0.65 mm locating pegs are not mounting holes.
  assert.equal(b.holes.length, 2)
})

test('the connectors at the edge: kind, side, where along it, opening', async () => {
  const b = readBoard(await readFile(FIXTURE, 'utf8'))
  const usb = b.connectors.find((c) => c.ref === 'J1')
  assert.equal(usb.kind, 'usb_c')
  // KiCad's top edge (y = 100) is +y here; the receptacle hangs 0.8 mm over it.
  assert.equal(usb.side, '+y')
  near(usb.inset, -0.8)
  near(usb.centre, 0)
  assert.deepEqual([usb.opening.width, usb.opening.height, usb.opening.typical], [8.94, 3.26, true])
  const hdr = b.connectors.find((c) => c.ref === 'J2')
  assert.equal(hdr.kind, 'pin_header')
  assert.equal(hdr.side, '-x')
  // Along the wall: the courtyard's length; the middle of it, not pin 1.
  near(hdr.opening.width, 11.2)
  near(hdr.centre, 120 - (116 - 1.8 + 116 + 9.4) / 2)
  assert.equal(hdr.opening.height, 8.5)
  // The resistor in the middle is no connector.
  assert.equal(b.connectors.length, 2)
})

test('a turned footprint, an Edge.Cuts circle hole, a KiCad 5 arc, an outline that does not close', () => {
  const box = '(gr_line (start 0 0) (end 40 0) (layer Edge.Cuts)) (gr_line (start 40 0) (end 40 30) (layer Edge.Cuts)) (gr_line (start 40 30) (end 0 30) (layer Edge.Cuts))'
  const closed = `${box} (gr_line (start 0 30) (end 0 0) (layer Edge.Cuts))`
  const turned = `(kicad_pcb (version 20221018) (general (thickness 1.0)) ${closed}
    (gr_circle (center 10 10) (end 11.5 10) (layer "Edge.Cuts"))
    (footprint "Connector_JST:JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical" (layer "F.Cu") (at 38 15 90)
      (property "Reference" "J5")
      (fp_rect (start -2 -1.5) (end 4 2) (layer "F.CrtYd"))
      (pad "1" thru_hole rect (at 0 0 90) (size 1.2 1.7) (drill 0.75) (layers "*.Cu"))))`
  const b = readBoard(turned)
  assert.equal(b.thickness, 1)
  assert.deepEqual(b.holes.map((h) => [h.from, h.x, h.y, h.d]), [['Edge.Cuts circle', -10, 5, 3]])
  const j = b.connectors[0]
  // Turned 90°: the rect's x (-2..4) runs up the board (KiCad's -y), its y across.
  assert.equal(j.side, '+x')
  assert.equal(j.kind, 'jst')
  near(j.box.min[0], 38 - 1.5 - 20)
  near(j.box.max[0], 38 + 2 - 20)
  near(j.box.min[1], -2 - 0)
  near(j.box.max[1], 4)
  near(j.opening.width, 6)
  assert.equal(j.opening.height, 6)
  // KiCad 5: (start centre) (end start point) (angle): the way that meets the next piece.
  const v5 = `(kicad_pcb (general (thickness 1.6)) (gr_line (start 3 0) (end 40 0) (layer Edge.Cuts)) (gr_line (start 40 0) (end 40 30) (layer Edge.Cuts)) (gr_line (start 40 30) (end 0 30) (layer Edge.Cuts)) (gr_line (start 0 30) (end 0 3) (layer Edge.Cuts)) (gr_arc (start 3 3) (end 0 3) (angle 90) (layer Edge.Cuts)))`
  const old = readBoard(v5)
  assert.deepEqual(old.size, [40, 30])
  assert.ok(old.outline.some(([x, y]) => Math.abs(x - (3 - 3 * Math.SQRT1_2 - 20)) < 0.05 && Math.abs(15 - (3 - 3 * Math.SQRT1_2) - y) < 0.05), 'the arc bows out to the corner')
  assert.throws(() => readBoard(`(kicad_pcb ${box})`), /does not close: 1 open run/)
  // Ends 0.03 mm apart still meet; a second board beside it is said, not read.
  const loose = readBoard(`(kicad_pcb ${box} (gr_line (start 0.03 30) (end 0 0.02) (layer Edge.Cuts)) (gr_rect (start 50 0) (end 60 10) (layer Edge.Cuts)))`)
  assert.deepEqual(loose.size, [40, 30])
  assert.equal(loose.others, 1)
  assert.match(loose.note, /only the biggest board/)
  assert.throws(() => readBoard('(kicad_pcb (version 1))'), /no outline on Edge\.Cuts/)
})

test('parts with no 3D model: found with their box and height, for placeholders', () => {
  const edge = '(gr_rect (start 0 0) (end 40 30) (layer Edge.Cuts))'
  const fp = (ref, name, inner, layer = 'F.Cu') => `(footprint "${name}" (layer "${layer}") (at 20 15) (property "Reference" "${ref}") ${inner})`
  const pads = '(pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu")) (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu"))'
  const crtyd = '(fp_rect (start -3 -2) (end 3 2) (layer "F.CrtYd"))'
  const b = readBoard(`(kicad_pcb (general (thickness 1.6)) ${edge}
    ${fp('U1', 'Package_SO:SOIC-8', `${pads} ${crtyd} (property "Height" "1.75")`)}
    ${fp('U2', 'Package_SO:SOIC-8', `${pads} (fp_rect (start -2 -1.5) (end 2 1.5) (layer "F.Fab")) (model "x.step" (hide yes))`)}
    ${fp('U3', 'Package_SO:SOIC-8', `${pads} ${crtyd} (model "x.step")`)}
    ${fp('C1', 'Capacitor_THT:CP_Radial_D8.0mm_H11.5mm', `${pads} ${crtyd}`, 'B.Cu')}
    ${fp('U4', 'Package_SO:SOIC-8', `${pads} ${crtyd} (attr smd dnp)`)}
    ${fp('FID1', 'Fiducial:Fiducial_1mm', `${pads}`)}
    ${fp('H1', 'MountingHole:MountingHole_3.2mm', '(pad "" np_thru_hole circle (at 0 0) (size 3.2 3.2) (drill 3.2) (layers "*.Cu"))')}
  )`)
  const u = unmodelledParts(b, ['Could not add 3D model to U3.'])
  assert.deepEqual(u.map((x) => [x.ref, x.why, x.boxFrom, x.height, x.heightFrom, x.face]), [
    ['U1', 'no 3D model', 'courtyard', 1.75, 'property', 'top'],
    ['U2', 'no 3D model', 'fab', PLACEHOLDER_HEIGHT, 'default', 'top'],
    ['U3', 'model not found', 'courtyard', PLACEHOLDER_HEIGHT, 'default', 'top'],
    ['C1', 'no 3D model', 'courtyard', 11.5, 'footprint name', 'bottom'],
  ])
  // Centred on the outline's box, y up: the courtyard 6 x 4 round (0, 0).
  assert.deepEqual(u[0].box, { min: [-3, -2], max: [3, 2] })
  // A do-not-populate part is a placeholder only when it is kept.
  assert.ok(unmodelledParts(b, [], { dnp: true }).some((x) => x.ref === 'U4'))
  // U3's model found: no placeholder; a ref named only inside another (U31) does not count.
  assert.equal(unmodelledParts(b, ['Could not add 3D model to U31.']).some((x) => x.ref === 'U3'), false)
  assert.deepEqual(heightOf('2,5', ''), { height: 2.5, from: 'property' })
  assert.equal(heightOf('', 'R_0603'), null)
})

test('flags read off --help as words, not the start of a longer one', () => {
  assert.ok(lists('Usage: [--output VAR] [--force]', '--output'))
  assert.ok(lists('  -o, --output <file>', '--output'))
  assert.ok(!lists('[--output-dir VAR]', '--output'))
  assert.ok(!lists('[--no-dnp-ish]', '--no-dnp'))
})

test('kicad-cli found by SCANRULER_KICAD_CLI, or not at all', async () => {
  const { env, cli } = await setUp(9)
  assert.equal(findKicadCli(env), cli)
  assert.equal(findKicadCli({ SCANRULER_KICAD_CLI: '/no/such/kicad-cli', PATH: '' }), null)
  assert.equal(findKicadCli({ PATH: '' }, 'plan9'), null)
  const none = await kicadTools({ PATH: '' }, { platform: 'plan9' })
  assert.equal(none.found, false)
  assert.match(none.note, /kicad-cli was not found/)
})

test('each version’s flags: KiCad 7 has no DRC or parts list; 8 and 9 do', async () => {
  for (const [major, drc] of [[7, false], [8, true], [9, true]]) {
    const { env } = await setUp(major)
    const t = await kicadTools(env, { fresh: true })
    assert.equal(t.major, major)
    assert.equal(t.ready, true)
    assert.equal(t.commands.drc.ok, drc, `drc on ${major}`)
    assert.equal(t.commands.bom.ok, drc, `bom on ${major}`)
    assert.equal(t.commands.step.has.includes('--no-dnp'), major >= 8)
    assert.equal(t.commands.step.has.includes('--no-virtual'), major === 7)
  }
})

test('import: STEP centred on the outline, flags only as listed, positions checked', async () => {
  for (const major of [7, 9]) {
    const { env, board, runs } = await setUp(major)
    const r = await importBoard({ path: board }, env)
    const step = new TextDecoder().decode(r.step.bytes)
    assert.match(step, /^ISO-10303-21;/)
    assert.match(step, /fake 125x120mm all/)
    const run = (await runs()).find((x) => x.cmd === 'pcb export step')
    assert.equal(run.flags['--user-origin'], '125x120mm')
    assert.equal(run.flags['--subst-models'], true)
    // --no-dnp only where the version lists it; the fake refuses others.
    assert.equal(run.flags['--no-dnp'], major >= 8 ? true : undefined)
    assert.ok(r.warnings.some((w) => /J9/.test(w)), 'missing 3D models are passed on')
    // R1 names no 3D model: listed for a placeholder, its box from its pads
    // (no courtyard or fab outline), at the stated default height.
    assert.deepEqual(r.unmodelled.map((u) => [u.ref, u.why, u.boxFrom, u.height, u.heightFrom]), [['R1', 'no 3D model', 'pads', PLACEHOLDER_HEIGHT, 'default']])
    near(r.unmodelled[0].box.max[0] - r.unmodelled[0].box.min[0], 0.95)
    near(r.unmodelled[0].box.max[1] - r.unmodelled[0].box.min[1], 2.45)
    assert.equal(r.board.connectors.length, 2)
    assert.ok(r.positions.every((p) => p.agrees), 'KiCad places them where they were read')
    assert.equal(r.board.connectors.find((c) => c.ref === 'J2').rot, 90)
    assert.ok(existsSync(join(r.job, 'command.txt')))
  }
  const { env, board } = await setUp(9)
  const flat = await importBoard({ path: board, components: false }, env)
  assert.match(new TextDecoder().decode(flat.step.bytes), /board-only/)
  assert.deepEqual(flat.unmodelled, [])
})

test('import refuses what is not a board, and says why kicad-cli failed', async () => {
  const { env, dir, board } = await setUp(9)
  await assert.rejects(importBoard({ path: join(dir, 'nope.kicad_pcb') }, env), /No board at/)
  await writeFile(join(dir, 'x.step'), 'ISO')
  await assert.rejects(importBoard({ path: join(dir, 'x.step') }, env), /not a KiCad board/)
  await assert.rejects(importBoard({ path: '' }, env), /Give the board/)
  // A path pasted in quotes.
  assert.equal((await importBoard({ path: `'${board}'` }, env)).board.name, 'tiny')
  await assert.rejects(importBoard({ path: board }, { ...env, FAKE_KICAD_FAIL: 'step' }), /could not export the STEP \(exit 3\): .*Failed to export STEP/s)
  await assert.rejects(importBoard({ path: board }, { ...env, SCANRULER_KICAD_CLI: join(dir, 'missing') }), /SCANRULER_KICAD_CLI names/)
})

test('fab package: protel names, plated and unplated drills, JLCPCB columns, DRC, two zips', async () => {
  const { env, board, dir, runs } = await setUp(9)
  await writeFile(join(dir, 'tiny.kicad_sch'), '(kicad_sch (version 20231120))')
  const r = await fabPackage({ path: board }, env)
  assert.deepEqual(r.files.filter((f) => !f.includes('/')).sort(), ['tiny-NPTH-drl_map.gbr', 'tiny-NPTH.DRL', 'tiny-PTH-drl_map.gbr', 'tiny-PTH.DRL', 'tiny.GBL', 'tiny.GBO', 'tiny.GBP', 'tiny.GBS', 'tiny.GKO', 'tiny.GTL', 'tiny.GTO', 'tiny.GTP', 'tiny.GTS', 'tiny.gbrjob'])
  assert.ok(r.files.includes('assembly/tiny-pos.csv'))
  assert.ok(r.files.includes('assembly/tiny-bom.csv'))
  assert.ok(r.files.includes('reports/tiny-drc.json'))
  assert.equal(r.drc.clean, false)
  assert.equal(r.drc.violations, 2)
  const pos = await readFile(r.positions, 'utf8')
  assert.match(pos.split('\n')[0], /^Designator,Val,Package,Mid X,Mid Y,Rotation,Layer$/)
  const bom = await readFile(r.bom, 'utf8')
  assert.match(bom, /^Comment,Designator,Footprint,LCSC Part #/)
  const zip = await zipEntries(r.zip)
  assert.equal(zip.entries.length, r.files.length)
  const gz = await zipEntries(r.gerberZip)
  assert.ok(gz.entries.every((e) => !e.name.includes('/')))
  assert.equal(r.bytes.byteLength, (await readFile(r.zip)).byteLength)
  const drill = (await runs()).find((x) => x.cmd === 'pcb export drill')
  assert.equal(drill.flags['--excellon-separate-th'], true)
  assert.equal(drill.flags['--excellon-units'], 'mm')
  assert.equal(drill.flags['--map-format'], 'gerberx2')
  // JLCPCB's KiCad guide: silkscreen subtracted from the mask openings.
  assert.equal((await runs()).find((x) => x.cmd === 'pcb export gerbers').flags['--subtract-soldermask'], true)
  const kicadNames = await fabPackage({ path: board, naming: 'kicad', drc: false }, env)
  assert.ok(kicadNames.files.includes('tiny-F_Cu.gbr'))
  assert.equal((await runs()).filter((x) => x.cmd === 'pcb export gerbers').pop().flags['--subtract-soldermask'], undefined)
  assert.equal(kicadNames.drc, null)
  await assert.rejects(fabPackage({ path: board, naming: 'gerber' }, env), /naming is fab or kicad/)
})

test('fab on KiCad 7: Gerbers and drills, and notes for what it cannot make', async () => {
  const { env, board, dir } = await setUp(7)
  await writeFile(join(dir, 'tiny.kicad_sch'), '(kicad_sch)')
  const r = await fabPackage({ path: board }, env)
  assert.ok(r.files.includes('tiny.GTL'))
  assert.equal(r.bom, null)
  assert.equal(r.drc, null)
  assert.ok(r.notes.some((n) => /parts list/.test(n)))
  assert.ok(r.notes.some((n) => /no DRC/.test(n)))
  await assert.rejects(runDrc({ path: board }, env), /does not list .* for "pcb drc".*KiCad 8 or later/)
})

test('DRC: exit 5 is violations, exit 0 clean; the summary', async () => {
  const { env, board } = await setUp(8)
  const bad = await runDrc({ path: board }, env)
  assert.equal(bad.exit, 5)
  assert.equal(bad.clean, false)
  assert.deepEqual(bad.bySeverity, { error: 2, warning: 1 })
  assert.deepEqual(bad.items[0].at, [[120.5, 110.2], [120.7, 110.2]])
  const ok = await runDrc({ path: board }, { ...env, FAKE_KICAD_DRC: 'clean' })
  assert.equal(ok.clean, true)
  assert.deepEqual(summariseDrc({}).items, [])
})

test('names and columns for a board house', () => {
  assert.equal(fabName('b-F_Cu.gtl', 'b', 'fab'), 'b.GTL')
  assert.equal(fabName('b-In1_Cu.g1', 'b', 'fab'), 'b.G2L')
  assert.equal(fabName('b-In2_Cu.g2', 'b', 'fab'), 'b.G3L')
  assert.equal(fabName('b-PTH-drl_map.gbr', 'b', 'fab'), 'b-PTH-drl_map.gbr')
  assert.equal(fabName('b-Edge_Cuts.gm1', 'b', 'fab'), 'b.GKO')
  assert.equal(fabName('my-board-B_Silkscreen.gbo', 'my-board', 'fab'), 'my-board.GBO')
  assert.equal(fabName('b-F_Cu.gtl', 'b', 'kicad'), 'b-F_Cu.gtl')
  assert.equal(fabPositions('Ref,Val,Package,PosX,PosY,Rot,Side\n"J1","a,b","p",1,2,0,top\n'), 'Designator,Val,Package,Mid X,Mid Y,Rotation,Layer\nJ1,"a,b",p,1,2,0,top\n')
  assert.deepEqual(parseCsv('a,"b ""c""",d\n'), [['a', 'b "c"', 'd']])
  assert.equal(checkPositions({ connectors: [], origin: [0, 0] }, [['nothing']]), null)
})

test('the pcb extras: listed only when asked for, their inputs checked', async () => {
  assert.ok(!extraTools(helpers, {}).some((t) => t.name.startsWith('kicad_')))
  const { env, board } = await setUp(9)
  const tools = extraTools(helpers, { ...env, SCANRULER_MCP_EXTRAS: 'pcb' })
  assert.deepEqual(tools.map((t) => t.name), ['kicad_tools', 'kicad_board', 'kicad_drc', 'kicad_fab'])
  const call = (n, a) => tools.find((t) => t.name === n).call(a)
  const read = JSON.parse((await call('kicad_board', { path: board })).content[0].text)
  assert.equal(read.components, 5)
  assert.equal(read.holes.length, 2)
  assert.match((await call('kicad_board', {})).content[0].text, /path is needed/)
  assert.match((await call('kicad_fab', { path: board, naming: 'x' })).content[0].text, /naming is one of fab, kicad/)
  const fab = JSON.parse((await call('kicad_fab', { path: board, drc: false })).content[0].text)
  assert.ok(existsSync(fab.zip))
  assert.equal(fab.bytes, undefined)
})

// The real kicad-cli, where KiCad is installed: its flags as this reads them,
// and the fixture through it.
const real = findKicadCli({ PATH: process.env.PATH ?? '' })
test('the real kicad-cli, where installed', { skip: real ? false : 'kicad-cli is not installed here' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kicad-real-'))
  const env = { ...process.env, SCANRULER_HOME: dir, SCANRULER_KICAD_CLI: real }
  const t = await kicadTools(env, { fresh: true })
  assert.equal(t.ready, true, JSON.stringify(t.commands))
  const board = join(dir, 'tiny.kicad_pcb')
  await copyFile(FIXTURE, board)
  const r = await importBoard({ path: board }, env)
  assert.match(new TextDecoder().decode(r.step.bytes.subarray(0, 20)), /ISO-10303-21/)
  const f = await fabPackage({ path: board, drc: t.commands.drc.ok }, env)
  assert.ok(f.files.some((x) => /\.GTL$/.test(x)))
  assert.ok(f.files.some((x) => /NPTH\.DRL$/.test(x)))
})

test('KiCad 10: every flag used is still listed; a 4-layer board names its inner layers as JLCPCB lists them', async () => {
  const { env, board, dir, runs } = await setUp(10)
  const t = await kicadTools(env, { fresh: true })
  assert.equal(t.major, 10)
  for (const [id, c] of Object.entries(t.commands)) assert.equal(c.ok, true, id)
  // The same board with two inner copper layers.
  const text = (await readFile(board, 'utf8')).replace(/\(layers/, '(layers (1 "In1.Cu" signal) (2 "In2.Cu" signal)')
  await writeFile(board, text)
  const r = await fabPackage({ path: board, drc: false }, env)
  assert.ok(r.files.includes('tiny.G2L') && r.files.includes('tiny.G3L'), r.files.join(' '))
  assert.ok((await runs()).some((x) => x.cmd === 'pcb export gerbers' && /In1\.Cu,In2\.Cu/.test(x.flags['--layers'])))
  void dir
})

// ---- the board read: tricky outlines (red team) -------------------------------------

const ec = (body) => `${body} (stroke (width 0.05) (type default)) (layer "Edge.Cuts")`
const sizeOf = (text) => readBoard(text).size

test('outline: a gr_poly with an arc among its points (KiCad 7 on) keeps the arc', () => {
  const b = readBoard(`(kicad_pcb (version 20221018) (general (thickness 1.2)) (gr_poly (pts (xy 0 0) (xy 40 0) (arc (start 40 0) (mid 50 10) (end 40 20)) (xy 0 20)) ${ec('(fill none)')}))`)
  assert.deepEqual(b.size, [50, 20])
  assert.ok(b.outline.some(([x]) => x === 25))
})

test('outline: an arc’s box is the arc’s, not its chords’ (start/mid/end across a quarter)', () => {
  // start (0,30) mid (15,35) end (30,30): centre (15,10), r 25 — its top at y 35.
  const t = `(kicad_pcb (version 20241229) (general (thickness 0.8))
    (gr_line (start 0 0) (end 30 0) ${ec('')}) (gr_line (start 30 30) (end 30 0) ${ec('')})
    (gr_arc (start 0 30) (mid 15 35) (end 30 30) ${ec('')}) (gr_line (start 0 30) (end 0 0) ${ec('')}))`
  assert.deepEqual(sizeOf(t), [30, 35])
})

test('outline: a Bézier edge (gr_curve) closes the outline', () => {
  const t = `(kicad_pcb (version 20240108) (general (thickness 1.6))
    (gr_line (start 0 0) (end 40 0) ${ec('')}) (gr_line (start 40 0) (end 40 20) ${ec('')})
    (gr_curve (pts (xy 40 20) (xy 30 30) (xy 10 30) (xy 0 20)) ${ec('')}) (gr_line (start 0 20) (end 0 0) ${ec('')}))`
  const b = readBoard(t)
  assert.equal(b.size[0], 40)
  assert.ok(Math.abs(b.size[1] - 27.5) < 1e-3, String(b.size[1]))
})

test('outline: KiCad 5 arcs (centre, start, angle) either way round', () => {
  const lines = '(gr_line (start 0 0) (end 45 0) (layer Edge.Cuts) (width 0.05)) (gr_line (start 50 5) (end 50 30) (layer Edge.Cuts) (width 0.05)) (gr_line (start 50 30) (end 0 30) (layer Edge.Cuts) (width 0.05)) (gr_line (start 0 30) (end 0 0) (layer Edge.Cuts) (width 0.05))'
  for (const arc of ['(gr_arc (start 45 5) (end 45 0) (angle 90) (layer Edge.Cuts) (width 0.05))', '(gr_arc (start 45 5) (end 50 5) (angle -90) (layer Edge.Cuts) (width 0.05))']) {
    const b = readBoard(`(kicad_pcb (version 20171130) (host pcbnew 5.1.9) (general (thickness 1.6)) ${lines} ${arc})`)
    assert.deepEqual(b.size, [50, 30])
    // The corner is rounded the right way (about (45, 5) in KiCad's frame, (20, 10) here), not cut or bulging out.
    const corner = b.outline.filter(([x, y]) => x > 20 && y > 10)
    assert.ok(corner.length > 5 && corner.every(([x, y]) => Math.abs(Math.hypot(x - 20, y - 10) - 5) < 1e-3), arc)
  }
})

test('connectors rotated 0, 90, 180 and 270 at each edge; holes as NPTH and plated MountingHole footprints', () => {
  const crt = '(fp_rect (start -4.5 -4) (end 4.5 3.6) (stroke (width 0.05) (type default)) (fill none) (layer "F.CrtYd"))'
  const fp = (ref, at, body, name = 'Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12') => `(footprint "${name}" (layer "F.Cu") (at ${at.join(' ')}) (property "Reference" "${ref}" (at 0 0 0) (layer "F.SilkS")) ${body})`
  const t = `(kicad_pcb (version 20240108) (general (thickness 1.6))
    (gr_rect (start 100 100) (end 200 160) ${ec('(fill none)')})
    ${fp('H1', [104, 104], '(pad "" np_thru_hole circle (at 0 0) (size 3.2 3.2) (drill 3.2) (layers "*.Cu" "*.Mask"))', 'MountingHole:MountingHole_3.2mm_M3')}
    ${fp('H2', [196, 156, 45], '(pad "1" thru_hole circle (at 0 0) (size 6 6) (drill 3.2) (layers "*.Cu")) (pad "1" thru_hole circle (at 2.25 0) (size 0.7 0.7) (drill 0.4) (layers "*.Cu"))', 'MountingHole:MountingHole_3.2mm_M3_Pad_Via')}
    ${fp('J1', [150, 103.5, 0], crt)} ${fp('J2', [196.5, 130, 90], crt)} ${fp('J3', [103.5, 130, 270], crt)} ${fp('J4', [120, 156.5, 180], crt)})`
  const b = readBoard(t)
  assert.deepEqual(b.holes.map((h) => [h.ref, h.x, h.y, h.d, h.plated]), [['H1', -46, 26, 3.2, false], ['H2', 46, -26, 3.2, true]])
  const c = Object.fromEntries(b.connectors.map((k) => [k.ref, [k.side, k.inset, k.centre, k.box.min, k.box.max]]))
  // KiCad turns a footprint anticlockwise as drawn (y down): the courtyard's
  // −y end (−4) goes to −x at 90°, to +y (down, our −y) at 180°, to +x at 270°.
  assert.deepEqual(c.J1, ['+y', -0.5, 0, [-4.5, 22.9], [4.5, 30.5]])
  assert.deepEqual(c.J2, ['+x', -0.1, 0, [42.5, -4.5], [50.1, 4.5]])
  assert.deepEqual(c.J3, ['-x', -0.1, 0, [-50.1, -4.5], [-42.5, 4.5]])
  assert.deepEqual(c.J4, ['-y', -0.5, -30, [-34.5, -30.5], [-25.5, -22.9]])
})

test('outline drawn inside a footprint, turned with it; an L-shaped board', () => {
  const slot = `(kicad_pcb (version 20240108) (general (thickness 1.6)) (gr_rect (start 0 0) (end 60 40) ${ec('(fill none)')})
    (footprint "Slot" (layer "F.Cu") (at 30 20 90) (property "Reference" "S1" (at 0 0 0) (layer "F.SilkS")) (fp_rect (start -10 -1) (end 10 1) ${ec('(fill none)')})))`
  const b = readBoard(slot)
  assert.equal(b.cutouts.length, 1)
  const xs = b.cutouts[0].map((p) => p[0])
  const ys = b.cutouts[0].map((p) => p[1])
  // 20 long along the footprint's x, which the 90° turn lays along y.
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [-1, 1, -10, 10])
  const L = readBoard(`(kicad_pcb (version 20240108) (general (thickness 1.6)) (gr_poly (pts (xy 0 0) (xy 60 0) (xy 60 20) (xy 30 20) (xy 30 50) (xy 0 50)) ${ec('(fill none)')}))`)
  assert.deepEqual(L.size, [60, 50])
  assert.equal(L.outline.length, 7) // closed: the first point again
})

test('every KiCad version’s 3D-model variable points at the app’s models, unless set', async () => {
  const { mkdtemp, mkdir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { modelEnv, modelsDirOf } = await import('../src/extras/kicad.js')
  const app = await mkdtemp(join(tmpdir(), 'kicad-app-'))
  const cli = join(app, 'KiCad.app', 'Contents', 'MacOS', 'kicad-cli')
  await mkdir(join(app, 'KiCad.app', 'Contents', 'MacOS'), { recursive: true })
  assert.equal(modelsDirOf(cli, 'darwin'), null)
  assert.equal(modelEnv(cli, { A: '1' }, 'darwin').KICAD8_3DMODEL_DIR, undefined)
  const models = join(app, 'KiCad.app', 'Contents', 'SharedSupport', '3dmodels')
  await mkdir(models, { recursive: true })
  const e = modelEnv(cli, { KICAD9_3DMODEL_DIR: '/mine' }, 'darwin')
  assert.equal(e.KICAD8_3DMODEL_DIR, models)
  assert.equal(e.KICAD10_3DMODEL_DIR, models)
  assert.equal(e.KICAD9_3DMODEL_DIR, '/mine')
})
