// SPDX-License-Identifier: AGPL-3.0-only
// Stand-in slicers for the slicer extras' tests: each answers --help with
// the flags the real one lists, checks it was started as the real one
// would be, and writes G-code as the real one does — OrcaSlicer's inside
// the .3mf it exports, PrusaSlicer's as a .gcode.
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function sampleGcode({ layers = 5, layerHeight = 0.2, typeWord = 'TYPE', header = 'orca' } = {}) {
  const lines = []
  if (header === 'orca') lines.push('; HEADER_BLOCK_START', '; model printing time: 0h 9m 30s; total estimated time: 0h 10m 5s', `; total layer number: ${layers}`, '; total filament length [mm] : 1234.56', '; total filament weight [g] : 3.71', '; HEADER_BLOCK_END')
  lines.push('G90', 'M83', 'G1 Z0.2 F600')
  for (let i = 0; i < layers; i++) {
    const z = Math.round((0.2 + i * layerHeight) * 1000) / 1000
    lines.push(`;Z:${z}`, `G1 Z${z}`, `;${typeWord}:Outer wall`, 'G1 X10 Y10 F3000', 'G1 X20 Y10 E1.0', 'G1 X20 Y20 E1.0', `;${typeWord}:Sparse infill`, 'G1 X15 Y15 E0.5', 'G1 E-0.8', 'G1 X40 Y40', 'G1 E0.8')
  }
  if (header === 'prusa') lines.push('; filament used [mm] = 1234.56', '; filament used [g] = 3.71', '; estimated printing time (normal mode) = 10m 5s')
  return lines.join('\n') + '\n'
}

/** A zip with one stored entry, as a .3mf holds its G-code. */
function storedZip(name, data) {
  const nameBuf = Buffer.from(name), body = Buffer.from(data)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(0, 8)
  local.writeUInt32LE(body.length, 18)
  local.writeUInt32LE(body.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(0, 10)
  central.writeUInt32LE(body.length, 20)
  central.writeUInt32LE(body.length, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt32LE(0, 42)
  const cdStart = 30 + nameBuf.length + body.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(46 + nameBuf.length, 12)
  end.writeUInt32LE(cdStart, 16)
  return Buffer.concat([local, nameBuf, body, central, nameBuf, end])
}

export async function fakeOrca(dir) {
  const path = join(dir, 'orca-slicer')
  const zipHelper = `${storedZip.toString()}\n`
  await writeFile(
    path,
    [
      '#!/usr/bin/env node',
      "const fs = require('fs'), p = require('path')",
      'const a = process.argv.slice(2)',
      "if (a[0] === '--help') { console.log('OrcaSlicer-2.3.1\\n--slice --load-settings --load-filaments --outputdir --export-3mf --arrange'); process.exit(0) }",
      "const at = (f) => a[a.indexOf(f) + 1]",
      "if (at('--slice') !== '0') { console.error('need --slice 0'); process.exit(2) }",
      "const settings = (at('--load-settings') || '').split(';').filter(Boolean)",
      "for (const f of settings) JSON.parse(fs.readFileSync(f, 'utf8'))",
      "const proc = settings.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))).find((j) => j.type === 'process') || {}",
      "const lh = Number(proc.layer_height || 0.2)",
      zipHelper,
      `const g = (${sampleGcode.toString()})({ layers: 5, layerHeight: lh })`,
      "fs.writeFileSync(at('--export-3mf'), storedZip('Metadata/plate_1.gcode', g))",
      "console.log('Slicing finished', JSON.stringify(proc))",
    ].join('\n'),
  )
  await chmod(path, 0o755)
  return path
}

export async function fakePrusa(dir) {
  const path = join(dir, 'prusa-slicer')
  await writeFile(
    path,
    [
      '#!/usr/bin/env node',
      "const fs = require('fs')",
      'const a = process.argv.slice(2)',
      "if (a[0] === '--help') { console.log('PrusaSlicer-2.9.2\\n--export-gcode --load --output'); process.exit(0) }",
      "if (!a.includes('--export-gcode')) process.exit(2)",
      "const at = (f) => a[a.indexOf(f) + 1]",
      `fs.writeFileSync(at('--output'), (${sampleGcode.toString()})({ layers: 3, typeWord: 'TYPE', header: 'prusa' }))`,
    ].join('\n'),
  )
  await chmod(path, 0o755)
  return path
}
