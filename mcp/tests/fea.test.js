// SPDX-License-Identifier: AGPL-3.0-only
// Strength of a printed part: the material about the layers, the mesh read
// with its mid-side nodes in CalculiX's order, the result file read, the
// checks for a printed part — and, where Gmsh and CalculiX are on this
// computer (SCANRULER_GMSH / SCANRULER_CCX, or FreeCAD's), a cantilever
// solved and held to beam theory, layers along it and across it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { decodeSurface, facesOn, feaTools, G, gravityOf, judge, layerAxes, MATERIAL_ALIASES, MATERIALS, materialOf, nodalForces, readFrd, readMsh, solve, surfaceOf, writeInp } from '../src/extras/fea.js'

const quad = (o, u, v) => {
  const c = (s, t) => [0, 1, 2].map((a) => o[a] + u[a] * s + v[a] * t)
  return [...c(0, 0), ...c(1, 0), ...c(1, 1), ...c(0, 0), ...c(1, 1), ...c(0, 1)]
}

// One quadratic tetrahedron with its mid-side nodes listed out of order.
const MSH = `$MeshFormat
2.2 0 8
$EndMeshFormat
$Nodes
10
1 0 0 0
2 1 0 0
3 0 1 0
4 0 0 1
5 0 0 0.5
6 0.5 0.5 0
7 0.5 0 0
8 0 0.5 0.5
9 0 0.5 0
10 0.5 0 0.5
$EndNodes
$Elements
2
1 2 2 1 1 1 2 3
2 11 2 1 1 1 2 3 4 7 6 9 5 8 10
$EndElements
`

test('a tetrahedron read: corners kept, mid-side nodes in CalculiX order by where they lie', () => {
  const m = readMsh(MSH)
  assert.equal(m.elements.length, 10)
  const at = (n) => [m.xyz[(n - 1) * 3], m.xyz[(n - 1) * 3 + 1], m.xyz[(n - 1) * 3 + 2]]
  const e = Array.from(m.elements)
  const EDGES = [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]]
  EDGES.forEach(([a, b], k) => {
    const want = at(e[a]).map((x, i) => (x + at(e[b])[i]) / 2)
    assert.deepEqual(at(e[4 + k]), want)
  })
  assert.equal(surfaceOf(m).length, 4)
})

test('the material: preset, overrides, derived shear, refused when unstable', () => {
  const m = materialOf('pla', { Zt: 20 })
  assert.equal(m.Zt, 20)
  assert.equal(m.Sz, 12)
  assert.ok(m.Gz > 0 && m.Gxy > m.Gz * 0.5)
  assert.throws(() => materialOf('unobtainium'), /No material/)
  assert.throws(() => materialOf('pla', { nuXY: 0.99, nuZ: 0.9 }), /unstable/)
})

test('the checks: a pull across the layers fails on its own strength; the same in the layer passes', () => {
  const m = materialOf('pla')
  const ax = layerAxes([0, 0, 1])
  const across = judge([0, 0, 30, 0, 0, 0], m, ax)
  const along = judge([30, 0, 0, 0, 0, 0], m, ax)
  assert.equal(across.mode, 'layers pulled apart')
  assert.ok(Math.abs(across.sf - 35 / 30) < 1e-6)
  assert.ok(along.sf > 1.2)
  const sheared = judge([0, 0, 0, 0, 0, 15], m, ax)
  assert.equal(sheared.mode, 'layers sheared')
  // Layers stood on their side: the same pull is now in the layers.
  assert.ok(judge([0, 0, 30, 0, 0, 0], m, layerAxes([1, 0, 0])).sf > across.sf)
})

test('the input: orientation about the layers, engineering constants, the holds and the loads', () => {
  const m = readMsh(MSH)
  const surface = surfaceOf(m)
  const forces = nodalForces(surface, [{ faces: [0], force: [0, 0, -9] }])
  const total = [...forces.values()].reduce((s, v) => s + v[2], 0)
  assert.ok(Math.abs(total + 9) < 1e-9)
  const inp = writeInp(m, { material: materialOf('pla'), axes: layerAxes([0, 0, 1]), fixed: new Set([1, 2, 3]), forces })
  assert.match(inp, /\*ELASTIC, TYPE=ENGINEERING CONSTANTS\n2680(\.0+)?, 2680(\.0+)?, 2160(\.0+)?,/)
  assert.match(inp, /\*SOLID SECTION, ELSET=EALL, MATERIAL=PRINTED, ORIENTATION=LAYERS/)
  assert.match(inp, /\*NSET, NSET=FIXED\n1, 2, 3/)
  assert.match(inp, /\*STEP\n\*STATIC/)
})

test('the result file: displacement and stress by node', () => {
  const pad = (n) => String(n).padStart(10)
  const v = (x) => x.toExponential(5).padStart(12)
  const frd = [
    '    1C',
    '  100CL  101 1.000000000       2                     0    1           1',
    ' -4  DISP        4    1',
    ' -5  D1          1    2    1    0',
    ` -1${pad(1)}${v(0.1)}${v(-0.2)}${v(0.3)}`,
    ` -1${pad(2)}${v(0)}${v(0)}${v(-1.5)}`,
    ' -3',
    '  100CL  101 1.000000000       2                     0    1           1',
    ' -4  STRESS      6    1',
    ` -1${pad(1)}${v(10)}${v(-2)}${v(3)}${v(1)}${v(0)}${v(0.5)}`,
    ` -1${pad(2)}${v(-1)}${v(0)}${v(0)}${v(0)}${v(0)}${v(0)}`,
    ' -3',
    ' 9999',
  ].join('\n')
  const r = readFrd(frd)
  assert.deepEqual(r.disp.get(2), [0, 0, -1.5])
  assert.deepEqual(r.stress.get(1), [10, -2, 3, 1, 0, 0.5])
})

test('the tools found, or how to get them', async () => {
  const t = await feaTools({ PATH: '/nonexistent', SCANRULER_GMSH: '/nope/gmsh', SCANRULER_CCX: '/nope/ccx' })
  assert.equal(t.ready, false)
  assert.match(t.howTo, /FreeCAD/)
})

const tools = await feaTools()
const skip = tools.ready ? false : 'Gmsh and CalculiX not on this computer'

test('a PLA cantilever printed flat, then on end, against beam theory', { skip, timeout: 300_000 }, async () => {
  const job = (build) => ({
    step: readFileSync(new URL('./fea-beam.step', import.meta.url), 'utf8'),
    build,
    material: { id: 'pla' },
    fixtures: [{ name: 'wall', triangles: quad([0, 0, 0], [0, 10, 0], [0, 0, 10]) }],
    loads: [{ name: 'tip', triangles: quad([100, 0, 0], [0, 10, 0], [0, 0, 10]), force: [0, 0, -100] }],
  })
  const I = (10 * 10 ** 3) / 12
  const flat = await solve(job([0, 0, 1]))
  assert.ok(Math.abs(flat.worst.displacement / ((100 * 100 ** 3) / (3 * 2680 * I)) - 1) < 0.03, `flat: ${flat.worst.displacement}`)
  assert.equal(flat.worst.mode, 'in the layers')
  const onEnd = await solve(job([1, 0, 0]))
  assert.ok(Math.abs(onEnd.worst.displacement / ((100 * 100 ** 3) / (3 * 2160 * I)) - 1) < 0.03, `on end: ${onEnd.worst.displacement}`)
  assert.equal(onEnd.worst.mode, 'layers pulled apart')
  assert.ok(onEnd.worst.safety < flat.worst.safety)
  const d = decodeSurface(flat.surface)
  assert.equal(d.positions.length / 3, flat.surface.vertices)
  assert.equal(d.fields.safety.length, flat.surface.vertices)
  assert.equal(d.index.length, flat.surface.triangles * 3)
  assert.ok(d.index.every((i) => i < flat.surface.vertices))
})

test('the page asks for the tools and gets them; a solve with no part is refused in words', async () => {
  const { EventEmitter } = await import('node:events')
  const { attachFeaAsks } = await import('../src/pageAsks.js')
  const runs = []
  const link = Object.assign(new EventEmitter(), { run: async (name, input) => (runs.push({ name, input }), { ok: true }) })
  attachFeaAsks({ link, env: { PATH: '/none', SCANRULER_GMSH: '/none/gmsh', SCANRULER_CCX: '/none/ccx' } })
  link.emit('notice', { kind: 'fea.solve', data: { req: 'f1', action: 'tools' } })
  link.emit('notice', { kind: 'fea.solve', data: { req: 'f2', action: 'solve', job: {} } })
  for (let i = 0; i < 100 && runs.filter((r) => r.name === 'fea.answer').length < 2; i++) await new Promise((s) => setTimeout(s, 20))
  const a = runs.filter((r) => r.name === 'fea.answer')
  assert.equal(a.find((x) => x.input.req === 'f1').input.result.ready, false)
  assert.ok(a.find((x) => x.input.req === 'f1').input.result.materials.pla)
  assert.match(a.find((x) => x.input.req === 'f2').input.error, /not found|FreeCAD/)
})

test('a plate held by a bolt hole: the hole taken whole from a coarse display mesh', { skip, timeout: 300_000 }, async () => {
  const hole = []
  const N = 16
  for (let i = 0; i < N; i++) {
    const a = (2 * Math.PI * i) / N
    const b = (2 * Math.PI * (i + 1)) / N
    const p = (t, z) => [10 + 3 * Math.cos(t), 10 + 3 * Math.sin(t), z]
    hole.push(...p(a, 0), ...p(b, 0), ...p(b, 4), ...p(a, 0), ...p(b, 4), ...p(a, 4))
  }
  const r = await solve({
    step: readFileSync(new URL('./fea-plate.step', import.meta.url), 'utf8'),
    build: [0, 0, 1],
    material: { id: 'petg' },
    fixtures: [{ name: 'bolt', triangles: hole }],
    loads: [{ name: 'end', triangles: quad([60, 0, 0], [0, 20, 0], [0, 0, 4]), force: [0, 0, -20] }],
  })
  // Every face of the hole's wall held: none of the plate's top or bottom.
  assert.ok(r.groups.fixtures[0].faces >= 40, `hole faces: ${r.groups.fixtures[0].faces}`)
  assert.ok(r.worst.displacement > 2 && r.worst.displacement < 5)
})

test('the checks do not depend on which way in the layer is x; modes say which check sets it', () => {
  const m = materialOf('pla')
  const ax = layerAxes([0, 0, 1])
  // Pure in-layer shear of 20 MPa, and a 30 MPa pull, turned in the layer.
  for (const th of [0, 15, 30, 45]) {
    const t = (th * Math.PI) / 180
    const sh = judge([20 * Math.sin(2 * t), -20 * Math.sin(2 * t), 0, 20 * Math.cos(2 * t), 0, 0], m, ax)
    assert.ok(Math.abs(sh.sf - 25 / 20) < 1e-9, `shear at ${th}°: ${sh.sf}`)
    const pull = judge([30 * Math.cos(t) ** 2, 30 * Math.sin(t) ** 2, 0, 30 * Math.sin(t) * Math.cos(t), 0, 0], m, ax)
    assert.ok(Math.abs(pull.sf - 39 / 30) < 1e-9, `pull at ${th}°: ${pull.sf}`)
  }
  // Each strength met exactly once by its own stress.
  for (const [s, mode] of [[[39, 0, 0, 0, 0, 0], 'in the layers'], [[-60, 0, 0, 0, 0, 0], 'in the layers'], [[0, 0, 35, 0, 0, 0], 'layers pulled apart'], [[0, 0, -55, 0, 0, 0], 'layers crushed'], [[0, 0, 0, 25, 0, 0], 'in the layers'], [[0, 0, 0, 0, 0, 21], 'layers sheared']]) {
    const j = judge(s, m, ax)
    assert.ok(Math.abs(j.sf - 1) < 1e-9, `${s}: ${j.sf}`)
    assert.equal(j.mode, mode)
  }
  // Shear between the layers with a little in-layer stress is still shear.
  assert.equal(judge([1, 0, 0, 0, 0, 21], m, ax).mode, 'layers sheared')
  // Pull and shear across together, each 0.7 of its strength: about 1/0.99.
  assert.ok(judge([0, 0, 24.5, 0, 0, 14.7], m, ax).sf < 1.02)
  // No stress, no mode; a weak across-layer override never makes it infinite.
  assert.equal(judge([0, 0, 0, 0, 0, 0], m, ax).mode, null)
  assert.ok(Number.isFinite(judge([40, -40, 0, 0, 0, 0], materialOf('pla', { Zt: 5, Zc: 5 }), ax).sf))
})

test('the material refuses what it cannot use, by name', () => {
  assert.throws(() => materialOf('toString'), /No material/)
  assert.throws(() => materialOf('pla', { Exy: '3000' }), /Exy must be a number/)
  assert.throws(() => materialOf('pla', { Ezz: 3000 }), /no figure "Ezz"/)
  assert.throws(() => materialOf('pla', { Exy: 1e12 }), /not a stiffness/)
  assert.ok(materialOf('tpu-95a'))
})

test('the result file: an overflow is kept as such; a new step starts afresh', () => {
  const pad = (n) => String(n).padStart(10)
  const v = (x) => x.toExponential(5).padStart(12)
  const blk = (k, vals) => [` -4  ${k.padEnd(8)}${String(vals.length).padStart(4)}    1`, ` -1${pad(1)}${vals.map(v).join('')}`, ' -3']
  const r = readFrd(['    1C', ...blk('DISP', [1, 1, 1]), ...blk('STRESS', [5, 5, 5, 0, 0, 0]), ...blk('DISP', [2, 2, 2]), ' 9999'].join('\n'))
  assert.deepEqual(r.disp.get(1), [2, 2, 2])
  assert.equal(r.stress.get(1), undefined)
  const inf = readFrd([' -4  DISP        3    1', ' -1         1         INF-1.00000E+00        -INF', ' -3'].join('\n'))
  assert.deepEqual(inf.disp.get(1), [Infinity, -1, -Infinity])
})

test('the tools: one there but not running is not ready', async () => {
  const t = await feaTools({ PATH: '', SCANRULER_GMSH: '/bin/false', SCANRULER_CCX: '/bin/false' })
  assert.equal(t.ready, false)
  assert.match(t.howTo, /did not run/)
  const d = await feaTools({ PATH: '', SCANRULER_GMSH: '/tmp', SCANRULER_CCX: '/tmp' })
  assert.equal(d.gmsh, null)
})

test('a cancel that comes before its solve stops it; a full queue is refused', async () => {
  const { EventEmitter } = await import('node:events')
  const { attachFeaAsks } = await import('../src/pageAsks.js')
  const runs = []
  const link = Object.assign(new EventEmitter(), { run: async (name, input) => (runs.push({ name, input }), { ok: true }) })
  attachFeaAsks({ link, env: { PATH: '/none', SCANRULER_GMSH: '/none/gmsh', SCANRULER_CCX: '/none/ccx' }, waiting: 1 })
  link.emit('notice', { kind: 'fea.solve', data: { req: 'x', action: 'cancel', of: 'early' } })
  link.emit('notice', { kind: 'fea.solve', data: { req: 'early', action: 'solve', job: {} } })
  link.emit('notice', { kind: 'fea.solve', data: { req: 'one', action: 'solve', job: {} } })
  link.emit('notice', { kind: 'fea.solve', data: { req: 'two', action: 'solve', job: {} } })
  for (let i = 0; i < 100 && runs.filter((r) => r.name === 'fea.answer').length < 2; i++) await new Promise((s) => setTimeout(s, 20))
  const a = runs.filter((r) => r.name === 'fea.answer').map((r) => r.input)
  assert.ok(!a.some((x) => x.req === 'early'))
  assert.match(a.find((x) => x.req === 'two').error, /already waiting/)
  assert.ok(a.find((x) => x.req === 'one'))
})

const beam = () => readFileSync(new URL('./fea-beam.step', import.meta.url), 'utf8')
const axial = (step, extra = {}) => ({
  step,
  build: [0, 0, 1],
  material: { id: 'pla' },
  fixtures: [{ triangles: quad([0, 0, 0], [0, 10, 0], [0, 0, 10]) }],
  loads: [{ triangles: quad([100, 0, 0], [0, 10, 0], [0, 0, 10]), force: [1000, 0, 0] }],
  ...extra,
})

test('a STEP in metres solves as millimetres, the same as one in mm', { skip, timeout: 300_000 }, async () => {
  const mm = await solve(axial(beam()))
  const m = await solve(axial(readFileSync(new URL('./fea-beam-metres.step', import.meta.url), 'utf8')))
  assert.ok(Math.abs(m.worst.displacement / mm.worst.displacement - 1) < 0.01, `${m.worst.displacement} vs ${mm.worst.displacement}`)
  assert.ok(Math.abs(m.mesh.size - mm.mesh.size) < 1e-3)
  // FL/EA along the layers, within the fully fixed end's restraint.
  assert.ok(Math.abs(mm.worst.displacement / (100 * 1000 / (100 * 2680)) - 1) < 0.03)
})

test('a piece not held is refused, not solved to enormous numbers', { skip, timeout: 300_000 }, async () => {
  const step = readFileSync(new URL('./fea-two-apart.step', import.meta.url), 'utf8')
  await assert.rejects(solve(axial(step, { loads: [{ triangles: quad([100, 30, 0], [0, 10, 0], [0, 0, 10]), force: [1000, 0, 0] }] })), /separate pieces.*not held/)
})

test('loads: too large to mean anything refused; zero force with a pressure is the pressure; on a hold refused', { skip, timeout: 300_000 }, async () => {
  await assert.rejects(solve(axial(beam(), { loads: [{ triangles: quad([100, 0, 0], [0, 10, 0], [0, 0, 10]), force: [1e30, 0, 0] }] })), /moved|overflowed/)
  const p = await solve(axial(beam(), { loads: [{ triangles: quad([100, 0, 0], [0, 10, 0], [0, 0, 10]), force: [0, 0, 0], pressure: 5 }] }))
  assert.ok(p.worst.displacement > 0.15 && p.worst.displacement < 0.22, `${p.worst.displacement}`)
  assert.equal(p.groups.loads[0].pressure, 5)
  await assert.rejects(solve(axial(beam(), { fixtures: [{ triangles: quad([100, 0, 0], [0, 10, 0], [0, 0, 10]) }] })), /lies on a hold/)
  await assert.rejects(solve(axial(beam(), { mesh: { size: Infinity } })), /mesh size/)
  const s = await solve(axial(beam(), { mesh: { size: '5' } }))
  assert.ok(Math.abs(s.mesh.size - 5) < 1e-6)
})

test('a load smaller than a mesh face takes the face under it', { skip, timeout: 300_000 }, async () => {
  const r = await solve(axial(beam(), { loads: [{ triangles: [50, 5, 10, 50.01, 5, 10, 50, 5.01, 10], force: [0, 0, -100] }] }))
  assert.equal(r.groups.loads[0].faces, 1)
})

test('a hold on one wall of a slit thinner than the tolerance takes that wall only', { skip, timeout: 300_000 }, async () => {
  const { readMsh: rm, surfaceOf: so } = await import('../src/extras/fea.js')
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join, dirname } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'fea-slit-'))
  try {
    const lib = join(dirname(tools.gmsh.path), '..', 'lib')
    execFileSync(tools.gmsh.path, [new URL('./fea-slit.step', import.meta.url).pathname, '-3', '-order', '2', '-clmax', String(Math.hypot(300, 40, 40) / 24), '-format', 'msh22', '-o', join(dir, 's.msh')], { env: { ...process.env, LD_LIBRARY_PATH: lib }, stdio: 'pipe' })
    const s = so(rm(readFileSync(join(dir, 's.msh'), 'utf8')))
    const got = facesOn(s, Float64Array.from(quad([150, 10, 0], [0, 30, 0], [0, 0, 40])), Math.hypot(300, 40, 40) * 2e-3)
    assert.ok(got.length > 0)
    assert.equal(got.filter((i) => s[i].centre[0] > 150.25).length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a bolt hole drawn with only eight sides is still held whole', { skip, timeout: 300_000 }, async () => {
  const hole = []
  const N = 8
  for (let i = 0; i < N; i++) {
    const a = (2 * Math.PI * i) / N
    const b = (2 * Math.PI * (i + 1)) / N
    const p = (t, z) => [10 + 3 * Math.cos(t), 10 + 3 * Math.sin(t), z]
    hole.push(...p(a, 0), ...p(b, 0), ...p(b, 4), ...p(a, 0), ...p(b, 4), ...p(a, 4))
  }
  const r = await solve({
    step: readFileSync(new URL('./fea-plate.step', import.meta.url), 'utf8'),
    build: [0, 0, 1],
    material: { id: 'petg' },
    fixtures: [{ name: 'bolt', triangles: hole }],
    loads: [{ name: 'end', triangles: quad([60, 0, 0], [0, 20, 0], [0, 0, 4]), force: [0, 0, -20] }],
  })
  assert.ok(r.groups.fixtures[0].faces >= 40, `hole faces: ${r.groups.fixtures[0].faces}`)
})

test('a cancel between the mesh and the solve stops it before CalculiX', { skip, timeout: 300_000 }, async () => {
  const ctl = new AbortController()
  const t = Date.now()
  await assert.rejects(
    solve(axial(beam()), process.env, { signal: ctl.signal, progress: (phase) => phase === 'solving' && ctl.abort() }),
    (e) => e.cancelled === true,
  )
  assert.ok(Date.now() - t < 60_000)
  const pre = new AbortController()
  pre.abort()
  await assert.rejects(solve(axial(beam()), process.env, { signal: pre.signal }), (e) => e.cancelled === true)
})

test('the materials: densities and the old tpu name', () => {
  // Held to the page's table (plugins/_shared/materials.ts) by
  // plugins/fea/tests/fea.test.ts; the server ships on its own.
  for (const m of Object.values(MATERIALS)) assert.ok(m.density > 0.5 && m.density < 2.5 && m.label)
  assert.deepEqual(MATERIAL_ALIASES, { tpu: 'tpu-95a' })
  assert.equal(materialOf('tpu').id, 'tpu-95a')
  assert.equal(materialOf('tpu').Exy, MATERIALS['tpu-95a'].Exy)
})

test('own weight: checked, and written as a density and a GRAV load in N, mm, s', () => {
  const pla = materialOf('pla')
  assert.equal(gravityOf(undefined, pla), null)
  assert.deepEqual(gravityOf({}, pla), { direction: [0, 0, -1], g: 1, density: 1.24 })
  assert.deepEqual(gravityOf({ direction: [0, 2, 0], g: 3, density: 0.5 }, pla), { direction: [0, 1, 0], g: 3, density: 0.5 })
  assert.throws(() => gravityOf({ direction: [0, 0, 0] }, pla), /direction/)
  assert.throws(() => gravityOf({ g: -1 }, pla), /how many g/)
  assert.throws(() => gravityOf({ density: 1240 }, pla), /g\/cm³/)
  const m = readMsh(MSH)
  const inp = writeInp(m, { material: pla, axes: layerAxes([0, 0, 1]), fixed: new Set([1, 2, 3]), forces: new Map(), gravity: gravityOf({ g: 2 }, pla) })
  assert.match(inp, /\*DENSITY\n1\.240000000e-9\n/)
  assert.match(inp, new RegExp(`\\*DLOAD\\nEALL, GRAV, ${(2 * G).toPrecision(10)}, 0, 0, -1\\.0+\\n`))
  assert.doesNotMatch(inp, /\*CLOAD/)
  assert.doesNotMatch(writeInp(m, { material: pla, axes: layerAxes([0, 0, 1]), fixed: new Set([1]), forces: new Map([[4, [0, 0, -1]]]) }), /DENSITY|DLOAD/)
})

test('a PLA cantilever under its own weight against wL⁴/8EI', { skip, timeout: 300_000 }, async () => {
  // 100 × 10 × 10 mm, held at x = 0; 100 g so the sag is plain to read.
  const r = await solve({
    step: beam(),
    build: [0, 0, 1],
    material: { id: 'pla' },
    fixtures: [{ triangles: quad([0, 0, 0], [0, 10, 0], [0, 0, 10]) }],
    loads: [],
    gravity: { direction: [0, 0, -1], g: 100 },
  })
  const w = 1.24e-9 * 100 * G * 100 // N/mm: ρ (t/mm³) · A · g
  const I = (10 * 10 ** 3) / 12
  const want = (w * 100 ** 4) / (8 * 2680 * I)
  assert.ok(Math.abs(r.worst.displacement / want - 1) < 0.03, `${r.worst.displacement} vs ${want}`)
  assert.ok(Math.abs(r.gravity.mass - 12.4) < 0.05, `${r.gravity.mass} g`)
  assert.ok(Math.abs(r.gravity.weight - 12.4e-3 * 9.80665 * 100) < 0.05, `${r.gravity.weight} N`)
  // The stress at the root, wL²/2 · c / I, by beam theory.
  assert.ok(Math.abs(r.worst.vonMises / ((w * 100 ** 2) / 2 * 5 / I) - 1) < 0.15, `${r.worst.vonMises}`)
  await assert.rejects(solve({ ...axial(beam()), loads: [] }), /Load the part/)
})

test('a STEP in inches, as CAD writes it, solves as millimetres', { skip, timeout: 300_000 }, async () => {
  const mm = await solve(axial(beam()))
  const inch = await solve(axial(readFileSync(new URL('./fea-beam-inches.step', import.meta.url), 'utf8')))
  assert.ok(Math.abs(inch.worst.displacement / mm.worst.displacement - 1) < 0.01, `${inch.worst.displacement} vs ${mm.worst.displacement}`)
  assert.ok(Math.abs(inch.mesh.size - mm.mesh.size) < 1e-3)
})
