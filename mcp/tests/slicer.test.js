// SPDX-License-Identifier: AGPL-3.0-only
// The slicer extras: listed only when asked for; a slicer set up, its
// profiles listed, a model sliced with a setting overridden, the G-code read
// back from inside the .3mf or beside it, two jobs compared; a flag the
// installed slicer lacks refused by name. Stand-in slicers (fakeSlicers.js).
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { extraTools, extrasWanted } from '../src/extras/index.js'
import { parseDuration, readGcode } from '../src/extras/gcode.js'
import { job, saveConfig, slice } from '../src/extras/slicer.js'
import { fakeOrca, fakePrusa, sampleGcode } from './fakeSlicers.js'

const helpers = { text: (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] }), failure: (e) => ({ isError: true, content: [{ type: 'text', text: String(e.message ?? e) }] }) }

test('the extras are listed only when asked for', () => {
  assert.deepEqual(extraTools(helpers, {}), [])
  const names = extraTools(helpers, { SCANRULER_MCP_EXTRAS: 'slicer' }).map((t) => t.name)
  assert.deepEqual(names, ['slicer_detect', 'slicer_list', 'slicer_profiles', 'slicer_slice', 'slicer_jobs', 'slicer_result', 'slicer_compare'])
  assert.ok(extrasWanted({ SCANRULER_MCP_EXTRAS: 'all' })('slicer'))
})

test('G-code read back: the slicer’s totals and the moves', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gcode-'))
  await writeFile(join(dir, 'a.gcode'), sampleGcode({ layers: 4 }))
  const r = await readGcode(join(dir, 'a.gcode'))
  assert.equal(r.totals.seconds, 605)
  assert.equal(r.totals.filamentG, 3.71)
  assert.equal(r.totals.layers, 4)
  assert.equal(r.counted.layers, 4)
  assert.equal(r.counted.firstLayerMm, 0.2)
  assert.deepEqual(r.counted.layerHeightsMm, [0.2])
  assert.equal(r.counted.retractions, 4)
  assert.deepEqual(Object.keys(r.counted.byFeatureMm), ['outer wall', 'sparse infill'])
  assert.equal(parseDuration('1d 2h 3m 4s'), 93784)
})

async function setUp() {
  const dir = await mkdtemp(join(tmpdir(), 'slicers-'))
  const env = { SCANRULER_HOME: join(dir, 'home') }
  const profiles = join(dir, 'profiles')
  await mkdir(join(profiles, 'machine'), { recursive: true })
  await mkdir(join(profiles, 'process'), { recursive: true })
  await mkdir(join(profiles, 'filament'), { recursive: true })
  await writeFile(join(profiles, 'machine', 'H2D 0.4.json'), JSON.stringify({ type: 'machine', name: 'H2D 0.4' }))
  await writeFile(join(profiles, 'process', 'Standard 0.20.json'), JSON.stringify({ type: 'process', name: 'Standard 0.20', layer_height: '0.2', xy_hole_compensation: '0' }))
  await writeFile(join(profiles, 'filament', 'PETG.json'), JSON.stringify({ type: 'filament', name: 'PETG', filament_shrink: ['100%'] }))
  const model = join(dir, 'part.stl')
  await writeFile(model, 'solid part\nendsolid part\n')
  const orca = await fakeOrca(dir)
  const prusa = await fakePrusa(dir)
  await saveConfig(
    [
      { id: 'orca', kind: 'orca', path: orca, flags: ['--slice', '--load-settings', '--load-filaments', '--outputdir', '--export-3mf'], profileDirs: [profiles], defaults: { machine: 'H2D 0.4', process: 'Standard 0.20', filament: 'PETG' } },
      { id: 'prusa', kind: 'prusa', path: prusa, flags: ['--export-gcode', '--load', '--output'], profileDirs: [] },
    ],
    env,
  )
  return { dir, env, model }
}

test('sliced with OrcaSlicer, a setting overridden, read back from the .3mf', async () => {
  const { env, model } = await setUp()
  const a = await slice({ slicerId: 'orca', model, name: 'before' }, env)
  assert.equal(a.ok, true)
  assert.equal(a.totals.seconds, 605)
  assert.equal(a.counted.layers, 5)
  const b = await slice({ slicerId: 'orca', model, overrides: { layer_height: 0.28, xy_hole_compensation: 0.17, filament_shrink: '99.6%' }, name: 'after' }, env)
  assert.deepEqual(b.counted.layerHeightsMm, [0.28])
  const proc = JSON.parse(await readFile(join(b.folder, 'process.json'), 'utf8'))
  assert.equal(proc.xy_hole_compensation, '0.17')
  const fil = JSON.parse(await readFile(join(b.folder, 'filament.json'), 'utf8'))
  assert.deepEqual(fil.filament_shrink, ['99.6%'])
  const cmd = JSON.parse(await readFile(join(b.folder, 'command.json'), 'utf8'))
  assert.ok(cmd.args.includes('--export-3mf'))
  const tools = Object.fromEntries(extraTools(helpers, { ...env, SCANRULER_MCP_EXTRAS: 'slicer' }).map((t) => [t.name, t]))
  const cmp = JSON.parse((await tools.slicer_compare.call({ a: a.job, b: b.job })).content[0].text)
  assert.equal(cmp.layers.a, 5)
  assert.ok(cmp.heightMm.change > 0)
  const listed = JSON.parse((await tools.slicer_jobs.call({})).content[0].text)
  assert.equal(listed.jobs.length, 2)
  assert.equal((await job(a.job, env)).ok, true)
})

test('sliced with PrusaSlicer: G-code beside it, overrides as flags', async () => {
  const { env, model } = await setUp()
  const r = await slice({ slicerId: 'prusa', model, overrides: { xy_size_compensation: -0.08 } }, env)
  assert.equal(r.totals.seconds, 605)
  assert.equal(r.counted.layers, 3)
  const cmd = JSON.parse(await readFile(join(r.folder, 'command.json'), 'utf8'))
  assert.ok(cmd.args.join(' ').includes('--xy-size-compensation -0.08'))
})

test('refused plainly: no model, an unknown profile, a flag the slicer lacks', async () => {
  const { env, model } = await setUp()
  await assert.rejects(slice({ slicerId: 'orca', model: '/nope.stl' }, env), /export_stl/)
  await assert.rejects(slice({ slicerId: 'orca', model, process: 'Nonexistent' }, env), /slicer_profiles/)
  await saveConfig([{ id: 'old', kind: 'orca', path: '/bin/true', flags: ['--slice'], profileDirs: [] }], env)
  await assert.rejects(slice({ slicerId: 'old', model }, env), /--outputdir/)
})
