// SPDX-License-Identifier: AGPL-3.0-only
// Strength of a printed part: the material about the layers, the mesh read
// with its mid-side nodes in CalculiX's order, the result file read, the
// checks for a printed part — and, where Gmsh and CalculiX are on this
// computer (SCANRULER_GMSH / SCANRULER_CCX, or FreeCAD's), a cantilever
// solved and held to beam theory, layers along it and across it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { feaTools, judge, layerAxes, materialOf, nodalForces, readFrd, readMsh, solve, surfaceOf, writeInp } from '../src/extras/fea.js'

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
  assert.equal(flat.surface.positions.length / 3, flat.surface.fields.safety.length)
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
