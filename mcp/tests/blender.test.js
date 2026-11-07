// SPDX-License-Identifier: AGPL-3.0-only
// blender_convert: a .blend handed to the Blender on this computer, run in
// the background with scripts in the file switched off, and the GLB it
// writes found where the answer says. A stand-in Blender checks the flags
// it is started with and writes the file.
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { blenderCandidates, convertBlend, findBlender } from '../src/blender.js'

async function fakeBlender(dir) {
  const path = join(dir, 'blender')
  await writeFile(
    path,
    [
      '#!/usr/bin/env node',
      "const fs = require('fs')",
      'const args = process.argv.slice(2)',
      "if (!args.includes('--disable-autoexec') || !args.includes('--background') || !args.includes('--factory-startup')) { console.error('unsafe flags'); process.exit(3) }",
      "const src = args.find((a) => a.endsWith('.blend'))",
      "if (!fs.readFileSync(src, 'utf8').startsWith('BLENDER')) { console.error('Not a blend file'); process.exit(2) }",
      "fs.writeFileSync(process.env.SCANRULER_GLB_OUT, Buffer.from('glTF'))",
    ].join('\n'),
  )
  await chmod(path, 0o755)
  return path
}

test('a .blend comes back as a GLB, Blender started safely', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'blend-'))
  const blender = await fakeBlender(dir)
  const src = join(dir, 'grip.blend')
  await writeFile(src, 'BLENDER-v400')
  const r = await convertBlend({ path: src, out: join(dir, 'out', 'grip.glb'), blender })
  assert.equal(r.path, join(dir, 'out', 'grip.glb'))
  assert.equal(r.bytes, 4)
  assert.equal(await readFile(r.path, 'utf8'), 'glTF')
  assert.match(r.next, /import_open/)
})

test('what Blender says when it fails comes back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'blend-'))
  const blender = await fakeBlender(dir)
  const src = join(dir, 'bad.blend')
  await writeFile(src, 'nope')
  await assert.rejects(convertBlend({ path: src, blender }), /code 2.*Not a blend file/)
})

test('refused without Blender, or for a file that is not a .blend', async () => {
  await assert.rejects(convertBlend({ path: '/tmp/x.blend', blender: null }), /SCANRULER_MCP_BLENDER/)
  await assert.rejects(convertBlend({ path: '/tmp/x.glb', blender: '/bin/true' }), /not a \.blend/)
})

test('SCANRULER_MCP_BLENDER and BLENDER_PATH are looked at first, then where Blender installs', () => {
  const c = blenderCandidates({ SCANRULER_MCP_BLENDER: 'auto', BLENDER_PATH: '/opt/b/blender', PATH: '/usr/bin', HOME: '/Users/j' }, 'darwin')
  assert.equal(c[0], '/opt/b/blender')
  assert.equal(blenderCandidates({ SCANRULER_MCP_BLENDER: '/x/blender' }, 'linux')[0], '/x/blender')
  assert.ok(c.includes('/Applications/Blender.app/Contents/MacOS/Blender'))
  assert.equal(findBlender({ BLENDER_PATH: '/nowhere/blender', PATH: '' }, 'linux'), null)
})
