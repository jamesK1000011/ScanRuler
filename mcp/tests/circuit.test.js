// SPDX-License-Identifier: AGPL-3.0-only
// The circuit extras against a stand-in tsci (fakeTsci.js): listed only when
// asked for; tsci found by SCANRULER_TSCI, a project's own, the PATH or
// bunx, or the install said when it is nowhere; its --help read for flags
// and formats, and what it lacks refused by name; projects made from each
// template; a build into a job folder with its exports, BOM and
// pick-and-place out of the Gerbers zip, and the DRC messages; a build that
// fails, one cancelled, one waiting its turn; files listed and read only
// inside projects and builds; and the page's asks answered over the link.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { extraTools } from '../src/extras/index.js'
import { build, buildInTurn, builtPath, circuitsDir, circuitTools, e24Above, entryOf, files, findTsci, newProject, notchedOutline, readCircuitFile, TEMPLATES, templateValues } from '../src/extras/circuit.js'
import { attachCircuitAsks } from '../src/pageAsks.js'
import { fakeTsci } from './fakeTsci.js'

const helpers = { text: (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] }), failure: (e) => ({ isError: true, content: [{ type: 'text', text: String(e.message ?? e) }] }) }

async function setUp(mode = '') {
  const dir = await mkdtemp(join(tmpdir(), 'circuit-'))
  const bin = join(dir, 'bin')
  await mkdir(bin)
  const tsci = await fakeTsci(bin, { mode })
  const log = join(dir, 'tsci.log')
  // PATH keeps this node's folder so the fake's #!/usr/bin/env node runs.
  const env = { SCANRULER_HOME: join(dir, 'home'), SCANRULER_TSCI: tsci, PATH: process.env.PATH, FAKE_TSCI_LOG: log, FAKE_TSCI_MODE: mode, NVM_DIR: join(dir, 'no-nvm') }
  return { dir, env, tsci, log, bin }
}
const runs = async (log) => (existsSync(log) ? (await readFile(log, 'utf8')).trim().split('\n').map((l) => JSON.parse(l)) : [])

test('the circuit tools are listed only when asked for, and take only their inputs', async () => {
  assert.equal(extraTools(helpers, {}).filter((t) => t.name.startsWith('circuit_')).length, 0)
  const tools = extraTools(helpers, { SCANRULER_MCP_EXTRAS: 'circuit' })
  assert.deepEqual(tools.map((t) => t.name), ['circuit_tools', 'circuit_new', 'circuit_build', 'circuit_files', 'circuit_read'])
  const bad = await tools.find((t) => t.name === 'circuit_build').call({ project: 'x', outputz: [] })
  assert.ok(bad.isError)
  assert.match(bad.content[0].text, /outputz is not an input/)
  const wrongType = await tools.find((t) => t.name === 'circuit_build').call({ project: 'x', outputs: ['gerber'] })
  assert.match(wrongType.content[0].text, /gerber.*is not one of/)
})

test('no tsci anywhere: not ready, and how to install it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'circuit-none-'))
  const r = await circuitTools({ SCANRULER_HOME: dir, PATH: join(dir, 'empty'), NVM_DIR: join(dir, 'x') })
  // This machine may have a global tsci in a usual folder; the test is for one that has none.
  if (r.tsci) return
  assert.equal(r.ready, false)
  assert.match(r.howTo, /npm install -g tscircuit/)
  const broken = await circuitTools({ SCANRULER_HOME: dir, SCANRULER_TSCI: join(dir, 'nope') })
  assert.equal(broken.ready, false)
  assert.match(broken.howTo, /SCANRULER_TSCI is set to .*nope/)
})

test('tsci found, its version, and what its --help lists', async () => {
  const { env } = await setUp()
  const r = await circuitTools(env)
  assert.equal(r.ready, true)
  assert.equal(r.tsci.version, '0.1.2446')
  assert.equal(r.tsci.via, 'SCANRULER_TSCI')
  assert.ok(r.build.flags.includes('--ignore-errors'))
  assert.ok(r.build.flags.includes('--routing-disabled'))
  // The format list wraps over lines in the help.
  for (const f of ['gerbers', 'kicad_pcb', 'step', 'glb', 'pcb-svg', 'explosion-mp4']) assert.ok(r.export.formats.includes(f), f)
  assert.ok(r.commands.includes('build') && r.commands.includes('export'))
})

test('tsci looked for on the PATH, in a project, then through bunx', async () => {
  const { dir, bin } = await setUp()
  const env = { PATH: `${bin}:${process.env.PATH}`, NVM_DIR: join(dir, 'x') }
  assert.equal((await findTsci(env)).via, 'PATH')
  const proj = join(dir, 'p')
  await mkdir(join(proj, 'node_modules', '.bin'), { recursive: true })
  await fakeTsci(join(proj, 'node_modules', '.bin'))
  const local = await findTsci(env, proj)
  assert.equal(local.via, 'project')
  const bunDir = join(dir, 'bun')
  await mkdir(bunDir)
  await writeFile(join(bunDir, 'bunx'), '#!/bin/sh\nexit 0\n')
  await chmod(join(bunDir, 'bunx'), 0o755)
  const viaBunx = await findTsci({ PATH: `${bunDir}:/usr/bin:/bin`, NVM_DIR: join(dir, 'x') })
  // Unless a global tsci is in one of the usual folders on this machine.
  if (viaBunx.via === 'bunx') assert.deepEqual(viaBunx.pre, ['tscircuit'])
})

test('a project from each template, as tsci init lays one out', async () => {
  const { env } = await setUp()
  for (const id of Object.keys(TEMPLATES)) {
    const r = await newProject({ name: `p-${id}`, template: id }, env)
    for (const f of ['package.json', 'tsconfig.json', '.gitignore', 'index.circuit.tsx']) assert.ok(existsSync(join(r.project, f)), `${id}: ${f}`)
    const tsx = await readFile(join(r.project, 'index.circuit.tsx'), 'utf8')
    assert.match(tsx, /export default \(\) => \(\n {2}<board /, id)
    assert.equal(JSON.parse(await readFile(join(r.project, 'package.json'), 'utf8')).main, 'index.circuit.tsx')
    assert.equal(entryOf(r.project), 'index.circuit.tsx')
  }
  // The LED's resistor: (3.3 − 2) V / 5 mA = 260 Ω, up to 270 Ω (E24).
  const led = await newProject({ name: 'led2', template: 'led', params: { supply: 3.3, current: 5, vf: 2 } }, env)
  assert.match(await readFile(join(led.project, 'index.circuit.tsx'), 'utf8'), /resistance="270"/)
  assert.equal(e24Above(260), 270)
  assert.equal(e24Above(1000), 1000)
  assert.equal(e24Above(9.15), 10)
  // Refusals.
  await assert.rejects(newProject({ name: 'p-blank' }, env), /not empty/)
  await assert.rejects(newProject({ name: '../evil' }, env), /name/)
  await assert.rejects(newProject({ name: 'q', template: 'nope' }, env), /no template "nope"/)
  await assert.rejects(newProject({ name: 'q', template: 'blank', params: { widht: 3 } }, env), /widht is not a value/)
  await assert.rejects(newProject({ name: 'q', template: 'blank', params: { width: 2 } }, env), /width: 5 to 500/)
  await assert.rejects(newProject({ name: 'q', template: 'led', params: { supply: 2 } }, env), /supply must be above/)
  await assert.rejects(newProject({ name: 'q', template: 'pico_carrier', params: { height: 50 } }, env), /height: 56 to 300/)
})

test('a board to fit an enclosure, notched round its bosses', async () => {
  const { env } = await setUp()
  const v = templateValues('enclosure', { inside_width: 76, inside_depth: 56, corner: 2, clearance: 0.5, keepouts: [{ x: 33, y: 23, r: 5 }, { x: -33, y: -23, r: 5 }] })
  assert.equal(v.keepouts.length, 2)
  const r = await newProject({ name: 'boxed', template: 'enclosure', params: { inside_width: 76, inside_depth: 56, corner: 2, clearance: 0.5, keepouts: [{ x: 33, y: 23, r: 5 }] } }, env)
  const tsx = await readFile(join(r.project, 'index.circuit.tsx'), 'utf8')
  assert.match(tsx, /<board outline=\{\[/)
  // Without keep-outs and corners, a plain width and height.
  const plain = await newProject({ name: 'plainbox', template: 'enclosure', params: { inside_width: 50, inside_depth: 40, corner: 0, clearance: 1 } }, env)
  assert.match(await readFile(join(plain.project, 'index.circuit.tsx'), 'utf8'), /<board width="48mm" height="38mm">/)
  assert.throws(() => templateValues('enclosure', { keepouts: [{ x: 1, y: 2 }] }), /keepouts\[0\]\.r|each needs/)
})

test('the outline notched: area by the shoelace against the closed form', () => {
  const area = (o) => Math.abs(o.reduce((s, p, i) => s + p[0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * p[1], 0) / 2)
  // A half disc of r 3 out of the middle of the right edge: 76 × 56 − π·9/2.
  const half = notchedOutline(76, 56, 0, [{ x: 38, y: 0, r: 3 }])
  assert.ok(Math.abs(area(half) - (76 * 56 - (Math.PI * 9) / 2)) < 0.05)
  assert.ok(half.every(([x, y]) => Math.hypot(x - 38, y) >= 3 - 1e-3))
  // A circle that stays inside is no notch, and is said so.
  const inner = notchedOutline(76, 56, 0, [{ x: 0, y: 0, r: 3 }])
  assert.equal(area(inner), 76 * 56)
  assert.equal(inner.inside.length, 1)
  // Over a corner: the circle less its parts beyond the two edges, and the corner's tip dropped.
  const corner = notchedOutline(76, 56, 0, [{ x: 33, y: 23, r: 6 }])
  const cap = 36 * Math.acos(5 / 6) - 5 * Math.sqrt(11)
  const lost = 76 * 56 - area(corner)
  assert.ok(lost > Math.PI * 36 - 2 * cap - 0.2 && lost < Math.PI * 36 - 2 * cap + 2, String(lost))
  assert.throws(() => notchedOutline(76, 56, 0, [{ x: 0, y: 0, r: 30 }]), /cut/)
})

test('built into a job folder: circuit.json, the exports, BOM and pick-and-place, and the DRC', async () => {
  const { env, log } = await setUp()
  const p = await newProject({ name: 'blinky', template: 'led' }, env)
  const j = await build({ project: 'blinky', outputs: ['gerbers', 'bom', 'pnp', 'kicad_pcb', 'step'] }, env)
  assert.equal(j.ok, true)
  for (const f of ['circuit.json', 'gerbers.zip', 'bom.csv', 'pick_and_place.csv', 'board.kicad_pcb', 'board.step', 'job.json', 'build.log', 'command.json']) assert.ok(existsSync(join(j.folder, f)), f)
  assert.match(await readFile(join(j.folder, 'bom.csv'), 'utf8'), /R1,1k,0603/)
  assert.deepEqual(j.gerberFiles, ['F_Cu.gtl', 'Edge_Cuts.gm1'])
  assert.equal(j.summary.errorCount, 1)
  assert.equal(j.summary.errors[0].message, 'Trace too close to pad')
  assert.equal(j.summary.warningCount, 1)
  assert.deepEqual(j.summary.boards, [{ width: 30, height: 20, thickness: 1.6, layers: 2, outline: 0 }])
  const ran = (await runs(log)).filter((r) => !r.args.includes('--help') && r.args[0] !== '--version')
  assert.deepEqual(ran[0].args, ['build', 'index.circuit.tsx', '--ignore-errors'])
  assert.equal(ran[0].cwd, p.project)
  // One export per format: the Gerbers zip once for gerbers, bom and pnp.
  assert.deepEqual(ran.slice(1).map((r) => r.args[3]), ['gerbers', 'kicad_pcb', 'step'])
  assert.equal(ran[1].args[1], join(j.folder, 'circuit.json'))
  assert.equal(builtPath(p.project, 'index.circuit.tsx'), join(p.project, 'dist', 'index', 'circuit.json'))
  const again = await build({ project: p.project, routing: false, partsEngine: false }, env)
  const last = (await runs(log)).filter((r) => r.args[0] === 'build' && !r.args.includes('--help')).pop()
  assert.deepEqual(last.args, ['build', 'index.circuit.tsx', '--ignore-errors', '--routing-disabled', '--disable-parts-engine'])
  assert.equal(again.files['gerbers.zip'], undefined)
})

test('refused by name: an output not offered, and a flag or format the installed tsci lacks', async () => {
  const { env } = await setUp('old')
  await newProject({ name: 'b' }, env)
  await assert.rejects(build({ project: 'b', outputs: ['gerber'] }, env), /gerber is not one this builds/)
  await assert.rejects(build({ project: 'b', outputs: ['glb'] }, env), /does not list the export format glb/)
  await assert.rejects(build({ project: 'b', routing: false }, env), /does not list --routing-disabled for "build"/)
  await assert.rejects(build({ project: 'nothere' }, env), /no project folder/)
  await assert.rejects(build({ project: 'b', entry: '../../etc/passwd' }, env), /outside the project/)
  // The old tsci builds what it does list.
  assert.equal((await build({ project: 'b', outputs: ['kicad_pcb'] }, env)).ok, true)
})

test('a build that writes nothing says so, with its log; an export that fails is listed', async () => {
  const { env } = await setUp('fail')
  await newProject({ name: 'b' }, env)
  const e = await build({ project: 'b' }, env).catch((x) => x)
  assert.match(e.message, /wrote no circuit\.json \(exit 1\).*Cannot find module/)
  assert.equal(JSON.parse(await readFile(join(e.job.folder, 'job.json'), 'utf8')).ok, false)
  const n = await setUp('noexport')
  await newProject({ name: 'c' }, n.env)
  const j = await build({ project: 'c', outputs: ['kicad_pcb', 'bom'] }, n.env)
  assert.deepEqual(j.exportsFailed.map((f) => f.format), ['kicad_pcb', 'gerbers'])
})

test('a build cancelled stops tsci; builds wait their turn', async () => {
  const { env } = await setUp('slow')
  await newProject({ name: 'b' }, env)
  const ctl = new AbortController()
  const t0 = Date.now()
  const p = build({ project: 'b' }, env, { signal: ctl.signal })
  setTimeout(() => ctl.abort(), 400)
  await assert.rejects(p, /Cancelled/)
  assert.ok(Date.now() - t0 < 5000)
  const q = await setUp()
  await newProject({ name: 'one' }, q.env)
  const order = []
  await Promise.all([buildInTurn({ project: 'one', name: 'first' }, q.env).then(() => order.push(1)), buildInTurn({ project: 'one', name: 'second' }, q.env).then(() => order.push(2))])
  assert.deepEqual(order, [1, 2])
})

test('files listed and read inside projects and builds only', async () => {
  const { env, dir } = await setUp()
  await newProject({ name: 'b', template: 'led' }, env)
  const outside = await newProject({ name: 'elsewhere', dir: join(dir, 'work') }, env)
  const j = await build({ project: 'b', outputs: ['gerbers'] }, env)
  const all = await files({}, env)
  assert.deepEqual(all.projects.map((p) => p.name).sort(), ['b', 'elsewhere'])
  assert.equal(all.builds[0].job, j.job)
  assert.ok((await files({ project: 'b' }, env)).files.some((f) => f.path === 'index.circuit.tsx'))
  assert.ok((await files({ job: j.job }, env)).files.some((f) => f.path === 'circuit.json'))
  const cj = await readCircuitFile({ job: j.job, path: 'circuit.json' }, env)
  assert.equal(JSON.parse(cj.text).length, 7)
  const z = await readCircuitFile({ job: j.job, path: 'gerbers.zip' }, env)
  assert.deepEqual(z.entries.map((e) => e.name), ['F_Cu.gtl', 'Edge_Cuts.gm1', 'bom.csv', 'pick_and_place.csv'])
  assert.match((await readCircuitFile({ job: j.job, path: 'gerbers.zip', entry: 'pick_and_place.csv' }, env)).text, /Designator/)
  // A project made elsewhere is read; anything else is not.
  assert.match((await readCircuitFile({ path: join(outside.project, 'index.circuit.tsx') }, env)).text, /<board/)
  await assert.rejects(readCircuitFile({ path: '/etc/hosts' }, env), /reads only those/)
  await assert.rejects(readCircuitFile({ project: 'b', path: '../../../etc/hosts' }, env), /outside the project/)
  await assert.rejects(readCircuitFile({ job: '../x', path: 'a' }, env), /job id/)
  await assert.rejects(files({ project: 'b', job: j.job }, env), /not both/)
})

test('the page’s asks: tools, a project, a build with progress, a cancel', async () => {
  const { env } = await setUp()
  const link = new EventEmitter()
  const said = []
  link.run = async (name, input) => said.push({ name, input })
  attachCircuitAsks({ link, env })
  const ask = (data) => link.emit('notice', { kind: 'circuit.tsci', data })
  const answerOf = async (req) => {
    for (let i = 0; i < 200; i++) {
      const a = said.find((s) => s.name === 'circuit.answer' && s.input.req === req)
      if (a) return a.input
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error(`no answer to ${req}`)
  }
  ask({ req: 't1', action: 'tools' })
  const tools = await answerOf('t1')
  assert.equal(tools.ok, true)
  assert.equal(tools.result.ready, true)
  assert.ok(tools.result.templates.some((t) => t.id === 'enclosure'))
  ask({ req: 'n1', action: 'new', args: { name: 'pg', template: 'blank', evil: 1 } })
  assert.equal((await answerOf('n1')).ok, true)
  ask({ req: 'b1', action: 'build', args: { project: 'pg', outputs: ['bom'] } })
  const b = await answerOf('b1')
  assert.equal(b.ok, true)
  assert.ok(b.result.files['bom.csv'])
  assert.ok(said.some((s) => s.name === 'circuit.progress' && s.input.req === 'b1' && s.input.phase === 'build'))
  ask({ req: 'r1', action: 'read', args: { job: b.result.job, path: 'circuit.json' } })
  assert.equal(JSON.parse((await answerOf('r1')).result.text).length, 7)
  ask({ req: 'bad', action: 'build', args: { project: 'nope' } })
  assert.match((await answerOf('bad')).error, /no project folder/)
  // A cancel before its ask: the ask is dropped, nothing answered.
  ask({ req: 'c1x', action: 'cancel', of: 'c1' })
  ask({ req: 'c1', action: 'tools' })
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(said.some((s) => s.input.req === 'c1'), false)
  // Unknown actions and other kinds are not answered.
  link.emit('notice', { kind: 'catalog.models', data: { req: 'z', action: 'tools' } })
  ask({ req: 'z2', action: 'rm' })
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(said.some((s) => s.input.req === 'z' || s.input.req === 'z2'), false)
})

test('red team: reserved names, relative dirs, params not an object, the home folder, two builds in a second, a link out', async () => {
  const { env, dir } = await setUp()
  await assert.rejects(newProject({ name: 'builds' }, env), /circuits folder’s own/)
  await assert.rejects(newProject({ name: 'x', dir: 'relative/place' }, env), /full folder path/)
  await assert.rejects(newProject({ name: 'x', params: [1, 2] }, env), /params/)
  await assert.rejects(build({ project: homedir() }, env), /not a project folder this takes/)
  await assert.rejects(build({ project: '/' }, env), /not a project folder this takes|no project folder/)
  await newProject({ name: 'quick' }, env)
  const [a, b] = [await build({ project: 'quick', name: 'same' }, env), await build({ project: 'quick', name: 'same' }, env)]
  assert.notEqual(a.job, b.job)
  // A link inside a project to a file outside it is not read.
  const secret = join(dir, 'secret.txt')
  await writeFile(secret, 'private')
  await symlink(secret, join(circuitsDir(env), 'quick', 'notes.txt'))
  await assert.rejects(readCircuitFile({ project: 'quick', path: 'notes.txt' }, env), /links to .*outside/)
})
