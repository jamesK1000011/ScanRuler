// SPDX-License-Identifier: AGPL-3.0-only
// Pauses for parts dropped in mid-print, put into sliced G-code: the layer
// each falls before (the first whose bottom is at or above the pocket's
// top) with a first layer of its own height, a top exactly on a boundary
// and between two, several on one layer merged; the command each printer
// takes and where in the layer it goes; a Bambu .3mf written back with its
// plate's MD5; slicing with the stand-in slicers; and the refusals.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readGcode } from '../src/extras/gcode.js'
import { addPauses, configOf, injectPauses, layersOf, messageOf, pauseCommandOf } from '../src/extras/pauses.js'
import { saveConfig, slice } from '../src/extras/slicer.js'
import { zipEntries, zipWrite } from '../src/extras/zip.js'
import { bambuGcode, orcaKlipperGcode, prusaGcode } from './gcodeSamples.js'
import { fakeOrca, fakePrusa } from './fakeSlicers.js'

const lines = (t) => t.split(/\r?\n/)
/** The lines of the block put in, and the line just before it. */
function block(text) {
  const l = lines(text)
  const i = l.findIndex((x) => x.startsWith('; ScanRuler pause'))
  let j = i + 1
  while (j < l.length && /^(M117|M601|M600|PAUSE|M400 U1)\b/.test(l[j])) j++
  return { before: l[i - 1], block: l.slice(i, j), after: l[j], index: i }
}
/** The layer a line is in: the Z of the last layer marker above it. */
function layerZAt(text, index) {
  const l = lines(text)
  for (let i = index; i >= 0; i--) {
    const m = /^;\s*(?:Z|Z_HEIGHT)\s*:\s*([\d.]+)/.exec(l[i])
    if (m) return Number(m[1])
  }
  return null
}

test('layers read as printed: each slicer’s markers, one per Z', () => {
  for (const [name, g, n] of [
    ['prusa', prusaGcode({ layers: 12 }), 12],
    ['orca', orcaKlipperGcode({ layers: 7 }), 7],
    ['bambu', bambuGcode({ layers: 9 }), 9],
  ]) {
    const L = layersOf(lines(g))
    assert.equal(L.length, n, name)
    assert.equal(L[0].z, 0.2, name)
    assert.equal(L[n - 1].z, Math.round((0.2 + (n - 1) * 0.2) * 1000) / 1000, name)
  }
  const odd = layersOf(lines(prusaGcode({ layers: 5, first: 0.3, height: 0.15 })))
  assert.deepEqual(odd.map((l) => l.z), [0.3, 0.45, 0.6, 0.75, 0.9])
  // The settings at the end (PrusaSlicer) and at the top (Bambu Studio).
  assert.equal(configOf(lines(prusaGcode())).pause_print_gcode, 'M601')
  assert.equal(configOf(lines(bambuGcode())).machine_pause_gcode, 'M400 U1')
})

test('the pause layer: first layer of its own height, a top on a boundary and between two', () => {
  // First layer 0.3, then 0.2: tops 0.3, 0.5, 0.7, 0.9, 1.1 …
  const g = prusaGcode({ layers: 20, first: 0.3, height: 0.2 })
  // On a boundary: the top of layer 4 (0.9) is layer 5's bottom.
  let r = injectPauses(g, [{ z: 0.9, note: 'Insert a 6x3 magnet' }])
  assert.deepEqual(r.pauses.map((p) => [p.layer, p.afterLayer, p.z, p.printZ]), [[5, 4, 0.9, 1.1]])
  assert.equal(r.warnings, undefined)
  assert.equal(layerZAt(r.text, block(r.text).index), 1.1, 'the pause is inside layer 5, before it prints')
  // A hair under the boundary is the same layer, within 2 µm.
  assert.equal(injectPauses(g, [{ z: 0.8995 }]).pauses[0].layer, 5)
  assert.equal(injectPauses(g, [{ z: 0.901 }]).pauses[0].layer, 5)
  // Between boundaries: the next one up, and a warning that the layer it
  // falls in may close over it.
  r = injectPauses(g, [{ z: 0.95 }])
  assert.equal(r.pauses[0].layer, 6)
  assert.equal(r.pauses[0].z, 1.1)
  assert.match(r.warnings[0], /inside layer 5 \(0\.9–1\.1\)/)
  // Inside the first layer: the second layer.
  r = injectPauses(g, [{ z: 0.3 }])
  assert.deepEqual([r.pauses[0].layer, r.pauses[0].z], [2, 0.3])
  r = injectPauses(g, [{ z: 0.1 }])
  assert.equal(r.pauses[0].layer, 2)
  assert.match(r.warnings[0], /inside layer 1/)
  // The last layer's bottom is the highest a pause can go.
  const top = 0.3 + 18 * 0.2
  assert.equal(injectPauses(g, [{ z: top }]).pauses[0].layer, 20)
  assert.throws(() => injectPauses(g, [{ z: top + 0.1 }]), /above the print's last layer bottom/)
})

test('several on one layer merged; several layers each in its place, in order', () => {
  const g = orcaKlipperGcode({ layers: 40 })
  const r = injectPauses(g, [
    { z: 3.0, note: 'Insert an M3 nut' },
    { z: 1.0, note: 'Insert a 6x3 magnet' },
    { z: 2.9, note: 'Insert a 608 bearing' },
    { z: 1.0, note: 'Insert a 6x3 magnet' },
  ])
  assert.deepEqual(r.pauses.map((p) => p.layer), [6, 16])
  assert.equal(r.pauses[0].note, 'Insert a 6x3 magnet')
  assert.deepEqual(r.pauses[0].asked, [1, 1])
  assert.equal(r.pauses[1].note, 'Insert an M3 nut; Insert a 608 bearing')
  const l = lines(r.text)
  const at = l.flatMap((x, i) => (x.startsWith('; ScanRuler pause') ? [i] : []))
  assert.equal(at.length, 2)
  assert.deepEqual(at.map((i) => layerZAt(r.text, i)), [1.2, 3.2])
  assert.equal(l.filter((x) => x === 'PAUSE').length, 2)
  // Nothing else moved: the moves read the same.
  assert.equal(l.length, lines(g).length + 2 * 3)
})

test('each printer’s pause, with its message where it shows one, after the layer’s lift', async () => {
  // PrusaSlicer, MK4S: its profile's own M601, an M117 before it.
  let r = injectPauses(prusaGcode(), [{ z: 1, note: 'Insert a 6x3 magnet' }])
  let b = block(r.text)
  assert.deepEqual(b.block.slice(1), ['M117 Insert a 6x3 magnet', 'M601'])
  assert.equal(r.command.from, 'pause_print_gcode')
  assert.equal(b.before, 'G1 Z1.2 F720', 'after the move up to the layer, filament drawn back')
  // M600 when asked.
  r = injectPauses(prusaGcode(), [{ z: 1 }], { pauseCommand: 'M600' })
  assert.deepEqual(block(r.text).block.slice(1), ['M117 Insert parts, then resume', 'M600'])
  // A Marlin profile with no pause G-code of its own: M601 by the flavour.
  r = injectPauses(prusaGcode({ pause: '', model: 'Generic', flavor: 'marlin2' }), [{ z: 1 }])
  assert.equal(block(r.text).block.at(-1), 'M601')
  // Klipper (OrcaSlicer): PAUSE, the message by M117, after the lift.
  r = injectPauses(orcaKlipperGcode(), [{ z: 1, note: 'Insert an M3 nut' }])
  b = block(r.text)
  assert.deepEqual(b.block.slice(1), ['M117 Insert an M3 nut', 'PAUSE'])
  assert.equal(b.before, 'G1 Z1.6 F600')
  // A Klipper profile whose pause is empty: PAUSE by the flavour.
  assert.deepEqual(injectPauses(orcaKlipperGcode({ pause: '' }), [{ z: 1 }]).command.lines, ['PAUSE'])
  // Bambu Lab: M400 U1, no message (its screen takes none), after the arc up.
  r = injectPauses(bambuGcode(), [{ z: 1, note: 'Insert a 6x3 magnet' }])
  b = block(r.text)
  assert.deepEqual(b.block.slice(1), ['M400 U1'])
  assert.match(b.before, /^G3 Z1\.6 /)
  assert.match(b.block[0], /^; ScanRuler pause: before layer 6, Z 1: Insert a 6x3 magnet$/)
  // A profile pause that is a template the slicer fills in is not taken.
  assert.deepEqual(pauseCommandOf({ gcode_flavor: 'klipper', machine_pause_gcode: 'PAUSE X={x}' }).lines, ['PAUSE'])
  // The G-code reads the same after: layers, filament.
  const before = await readTmp(orcaKlipperGcode())
  const after = await readTmp(r.text)
  assert.equal(after.counted.layers, (await readTmp(bambuGcode())).counted.layers)
  assert.equal(before.counted.layers, 20)
})

async function readTmp(text) {
  const d = await mkdtemp(join(tmpdir(), 'pz-'))
  await writeFile(join(d, 'a.gcode'), text)
  return readGcode(join(d, 'a.gcode'))
}

test('refused plainly', () => {
  assert.throws(() => injectPauses(prusaGcode(), []), /1 to 50/)
  assert.throws(() => injectPauses(prusaGcode(), [{ z: 0 }]), /more than 0/)
  assert.throws(() => injectPauses(prusaGcode(), [{ z: Number.NaN }]), /more than 0/)
  assert.throws(() => injectPauses(prusaGcode(), [{ z: 1, layer: 3 }]), /not taken/)
  assert.throws(() => injectPauses(prusaGcode(), [{ z: 1, note: 7 }]), /words/)
  assert.throws(() => injectPauses('G28\nG1 Z0.2\nG1 X1 E1\n', [{ z: 1 }]), /no layer markers/)
  // Printed object by object: Z goes back down.
  const seq = prusaGcode({ layers: 4 }) + prusaGcode({ layers: 4 })
  assert.throws(() => injectPauses(seq, [{ z: 0.4 }]), /object by object/)
  // No printer named, no pause in the profile.
  assert.throws(() => injectPauses(prusaGcode({ flavor: 'reprapfirmware', pause: '', model: 'Duet' }), [{ z: 1 }]), /give pauseCommand/)
  assert.equal(injectPauses(prusaGcode({ flavor: 'reprapfirmware', pause: '', model: 'Duet' }), [{ z: 1 }], { pauseCommand: 'M600' }).command.lines[0], 'M600')
  assert.throws(() => injectPauses(prusaGcode(), [{ z: 1 }], { pauseCommand: 'G28' }), /pauseCommand is one of/)
  // Twice into the same G-code.
  const once = injectPauses(prusaGcode(), [{ z: 1 }]).text
  assert.throws(() => injectPauses(once, [{ z: 2 }]), /already/)
})

test('a message the printer can show: no comment marks, no line breaks', () => {
  assert.equal(messageOf('Insert a magnet; then M84\nG28 *42'), 'Insert a magnet- then M84 G28 -42')
  assert.equal(messageOf('Ünïcödé — part'), 'Unicode part')
  assert.equal(messageOf('x'.repeat(100)).length, 48)
  const r = injectPauses(prusaGcode(), [{ z: 1, note: 'nut\nG28 ; home' }])
  const b = block(r.text).block
  assert.equal(b.length, 3)
  assert.equal(b[1], 'M117 nut G28 - home')
  assert.ok(!r.text.split('\n').includes('G28 ; home'))
})

test('CRLF G-code keeps its line ends', () => {
  const g = prusaGcode({ eol: '\r\n' })
  const r = injectPauses(g, [{ z: 1 }])
  assert.ok(!/[^\r]\n/.test(r.text), 'every line ends in CRLF')
  assert.equal(r.pauses[0].layer, 6)
})

test('a Bambu .gcode.3mf: the plate’s G-code and its MD5 written again, the rest as it was', async () => {
  const d = await mkdtemp(join(tmpdir(), 'pz3mf-'))
  const g = bambuGcode({ layers: 30 })
  const md5 = (b) => createHash('md5').update(b).digest('hex').toUpperCase()
  const files = [
    { name: '3D/', data: Buffer.alloc(0), method: 0 },
    { name: '3D/3dmodel.model', data: Buffer.from('<model/>'), method: 8 },
    { name: 'Metadata/plate_1.gcode', data: Buffer.from(g), method: 8 },
    { name: 'Metadata/plate_1.gcode.md5', data: Buffer.from(md5(Buffer.from(g))), method: 0 },
    { name: 'Metadata/plate_1.png', data: Buffer.from([137, 80, 78, 71, 1, 2, 3]), method: 8 },
  ]
  const tmf = join(d, 'job.3mf')
  await writeFile(tmf, zipWrite(files))
  await writeFile(join(d, 'plate_1.gcode'), g)
  const r = await addPauses({ gcode: join(d, 'plate_1.gcode'), tmf, pauses: [{ z: 2, note: 'Insert a 6x3 magnet' }] })
  assert.deepEqual(r.plates, [{ plate: 'Metadata/plate_1.gcode', pauses: [11], md5: true }])
  const z = await zipEntries(tmf)
  const get = (n) => z.read(z.entries.find((e) => e.name === n))
  const plate = get('Metadata/plate_1.gcode')
  assert.equal(get('Metadata/plate_1.gcode.md5').toString(), md5(plate))
  assert.match(plate.toString(), /\nM400 U1\n/)
  assert.equal(plate.toString(), await readFile(join(d, 'plate_1.gcode'), 'utf8'), 'the job’s G-code and the plate’s are one')
  assert.deepEqual(get('Metadata/plate_1.png'), Buffer.from([137, 80, 78, 71, 1, 2, 3]))
  assert.equal(get('3D/3dmodel.model').toString(), '<model/>')
  assert.deepEqual(z.entries.map((e) => [e.name, e.method]), files.map((f) => [f.name, f.method]))
  // Binary G-code is refused, and left as it was.
  await writeFile(join(d, 'b.gcode'), prusaGcode({ binary: true }))
  await assert.rejects(addPauses({ gcode: join(d, 'b.gcode'), pauses: [{ z: 1 }] }), /binary G-code/)
})

async function setUp() {
  const dir = await mkdtemp(join(tmpdir(), 'slicers-p-'))
  const env = { SCANRULER_HOME: join(dir, 'home') }
  const profiles = join(dir, 'profiles')
  for (const k of ['machine', 'process', 'filament']) await mkdir(join(profiles, k), { recursive: true })
  await writeFile(join(profiles, 'machine', 'P1S 0.4.json'), JSON.stringify({ type: 'machine', name: 'P1S 0.4' }))
  await writeFile(join(profiles, 'process', 'Standard 0.20.json'), JSON.stringify({ type: 'process', name: 'Standard 0.20', layer_height: '0.2' }))
  await writeFile(join(profiles, 'filament', 'PLA.json'), JSON.stringify({ type: 'filament', name: 'PLA' }))
  const model = join(dir, 'part.stl')
  await writeFile(model, 'solid part\nendsolid part\n')
  await saveConfig(
    [
      { id: 'orca', kind: 'orca', path: await fakeOrca(dir), flags: ['--slice', '--load-settings', '--load-filaments', '--outputdir', '--export-3mf'], profileDirs: [profiles], defaults: { machine: 'P1S 0.4', process: 'Standard 0.20', filament: 'PLA' } },
      { id: 'prusa', kind: 'prusa', path: await fakePrusa(dir), flags: ['--export-gcode', '--load', '--output'], profileDirs: [] },
    ],
    env,
  )
  return { env, model }
}

test('sliced with pauses: into the G-code and the exported 3MF, recorded in the job', async () => {
  const { env, model } = await setUp()
  // The stand-in OrcaSlicer writes 5 layers of 0.2 and names no printer.
  await assert.rejects(slice({ slicerId: 'orca', model, pauses: [{ z: 0.6 }] }, env), /give pauseCommand/)
  const r = await slice({ slicerId: 'orca', model, pauses: [{ z: 0.6, note: 'Insert a 6x3 magnet' }], pauseCommand: 'M400 U1' }, env)
  assert.deepEqual(r.pauses.pauses.map((p) => [p.layer, p.z]), [[4, 0.6]])
  assert.deepEqual(r.pauses.plates, [{ plate: 'Metadata/plate_1.gcode', pauses: [4] }])
  assert.match(await readFile(r.gcode, 'utf8'), /\nM400 U1\n/)
  const z = await zipEntries(join(r.folder, 'out', 'job.3mf'))
  assert.match(z.read(z.entries[0]).toString(), /\nM400 U1\n/)
  const kept = JSON.parse(await readFile(join(r.folder, 'job.json'), 'utf8'))
  assert.equal(kept.pauses.pauses[0].layer, 4)
  assert.equal(r.counted.layers, 5, 'the layers count the same')
  // PrusaSlicer: the G-code beside it; M601 asked for.
  const p = await slice({ slicerId: 'prusa', model, pauses: [{ z: 0.4, note: 'Insert an M3 nut' }], pauseCommand: 'M601' }, env)
  const text = await readFile(p.gcode, 'utf8')
  assert.match(text, /M117 Insert an M3 nut\nM601\n/)
  assert.equal(p.pauses.pauses[0].layer, 3)
  // A bad pause list is refused before the slicer runs.
  await assert.rejects(slice({ slicerId: 'prusa', model, pauses: [{ z: -1 }] }, env), /more than 0/)
  await assert.rejects(slice({ slicerId: 'prusa', model, pauses: [{ z: 1 }], pauseCommand: 'M0' }, env), /pauseCommand/)
  // Above the part: sliced, but not marked done.
  await assert.rejects(slice({ slicerId: 'prusa', model, pauses: [{ z: 50 }], pauseCommand: 'M601' }, env), /not marked done/)
})
