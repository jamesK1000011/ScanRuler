// SPDX-License-Identifier: AGPL-3.0-only
// KiCad's 3D model library in the Catalog: a package name sends the search
// to the one library folder KiCad files it under; a folder's list is asked
// of GitLab once and kept; a model already installed with KiCad is taken
// from disk with no request at all; a take records the licence and the
// KiCad Libraries Team; an id that would climb out of the library is
// refused; a STEP opens as a body.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { librariesFor, rank } from '../src/extras/kicadModels.js'
import { modelFiles, searchModels, takeModel } from '../src/extras/models.js'
import { attachPageAsks } from '../src/pageAsks.js'

const STEP = 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n'
let env, realFetch, calls, dir

const reply = (body, status = 200, type = 'application/json') => new Response(type.includes('json') ? JSON.stringify(body) : body, { status, headers: { 'content-type': type } })
const SOT = ['SOT-23', 'SOT-23-5', 'SOT-23-6', 'SOT-223-3_TabPin2', 'SOT-89-3']

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kicad3d-'))
  env = { SCANRULER_HOME: join(dir, 'home'), SCANRULER_KICAD_API: 'https://gitlab.example', SCANRULER_KICAD_3DMODELS: join(dir, 'none') }
  realFetch = globalThis.fetch
  calls = []
  globalThis.fetch = async (url) => {
    const u = new URL(url)
    calls.push(u.toString())
    if (u.host !== 'gitlab.example') return reply({}, 404)
    if (u.pathname === '/api/v4/projects/kicad%2Flibraries%2Fkicad-packages3D/repository/tree') {
      const path = u.searchParams.get('path')
      if (path === 'Package_TO_SOT_SMD.3dshapes') return reply(SOT.flatMap((n) => [{ name: `${n}.step`, type: 'blob' }, { name: `${n}.wrl`, type: 'blob' }]))
      if (path === 'Connector_USB.3dshapes') return reply([{ name: 'USB_C_Receptacle_HRO_TYPE-C-31-M-12.step', type: 'blob' }])
      if (!path) return reply([{ name: 'Package_TO_SOT_SMD.3dshapes', type: 'tree' }, { name: 'Connector_Molex.3dshapes', type: 'tree' }, { name: 'README.md', type: 'blob' }])
      if (path === 'Connector_Molex.3dshapes') return reply([{ name: 'Molex_KK-254_1x02.step', type: 'blob' }])
      return reply({ message: '404 Tree Not Found' }, 404)
    }
    if (u.pathname.startsWith('/kicad/libraries/kicad-packages3D/-/raw/master/')) return reply(STEP, 200, 'application/octet-stream')
    return reply({}, 404)
  }
})
after(() => (globalThis.fetch = realFetch))

test('a package name points at its library folder', () => {
  assert.deepEqual(librariesFor('SOT-23'), ['Package_TO_SOT_SMD'])
  assert.deepEqual(librariesFor('PinHeader_1x04_P2.54mm'), ['Connector_PinHeader_2.54mm'])
  assert.deepEqual(librariesFor('PinSocket_1x06_P2.00mm_Vertical'), ['Connector_PinSocket_2.00mm'])
  assert.deepEqual(librariesFor('USB_C_Receptacle'), ['Connector_USB'])
  assert.deepEqual(librariesFor('Package_SO/SOIC-8'), ['Package_SO'])
  assert.deepEqual(librariesFor('Package_SO.3dshapes'), ['Package_SO'])
  assert.deepEqual(librariesFor('bearing holder'), [])
  assert.deepEqual(rank(SOT, 'SOT-23'), ['SOT-23', 'SOT-23-5', 'SOT-23-6'])
})

test('search: one folder asked for, kept on disk, the STEP files only', async () => {
  const r = await searchModels({ query: 'SOT-23', sources: ['kicad'] }, env)
  assert.deepEqual(r.results.map((h) => h.id), ['Package_TO_SOT_SMD.3dshapes/SOT-23', 'Package_TO_SOT_SMD.3dshapes/SOT-23-5', 'Package_TO_SOT_SMD.3dshapes/SOT-23-6'])
  const h = r.results[0]
  assert.equal(h.licence, 'CC-BY-SA 4.0 with the KiCad libraries exception')
  assert.equal(h.author, 'KiCad Libraries Team')
  assert.equal(h.url, 'https://gitlab.example/kicad/libraries/kicad-packages3D/-/blob/master/Package_TO_SOT_SMD.3dshapes/SOT-23.step')
  const asked = calls.length
  await searchModels({ query: 'SOT-223', sources: ['kicad'] }, env)
  assert.equal(calls.length, asked, 'the folder came from the disk the second time')
  // A word of a folder's name, when no package name is known.
  const m = await searchModels({ query: 'molex kk', sources: ['kicad'] }, env)
  assert.deepEqual(m.results.map((x) => x.name), ['Molex_KK-254_1x02'])
  const none = await searchModels({ query: 'QFN-99', sources: ['kicad'] }, env)
  assert.deepEqual(none.results, [])
  assert.equal(none.errors, undefined)
})

test('take: the STEP from GitLab, its licence and authors in provenance', async () => {
  const f = await modelFiles({ source: 'kicad', id: 'Connector_USB.3dshapes/USB_C_Receptacle_HRO_TYPE-C-31-M-12' }, env)
  assert.deepEqual(f.files.map((x) => x.name), ['USB_C_Receptacle_HRO_TYPE-C-31-M-12.step'])
  const t = await takeModel({ source: 'kicad', id: 'Connector_USB.3dshapes/USB_C_Receptacle_HRO_TYPE-C-31-M-12' }, env)
  assert.equal(t.redistribute, true)
  assert.match(await readFile(t.taken[0], 'utf8'), /^ISO-10303-21/)
  const ledger = JSON.parse(await readFile(t.provenance, 'utf8'))
  assert.equal(ledger[0].licence, 'CC-BY-SA 4.0 with the KiCad libraries exception')
  assert.equal(ledger[0].note, 'by KiCad Libraries Team')
  assert.equal(ledger[0].source, 'kicad')
  await assert.rejects(modelFiles({ source: 'kicad', id: '../../etc/passwd' }, env), /not a KiCad model/)
  await assert.rejects(modelFiles({ source: 'kicad', id: 'Package_SO.3dshapes/../../x' }, env), /not a KiCad model/)
  await assert.rejects(takeModel({ source: 'kicad', id: 'Connector_USB.3dshapes/USB_C_Receptacle_HRO_TYPE-C-31-M-12', file: 'wrl' }, env), /no file "wrl"/)
})

test('installed with KiCad: searched and taken from disk, no request', async () => {
  const models = join(dir, '3dmodels')
  await mkdir(join(models, 'Connector_PinHeader_2.54mm.3dshapes'), { recursive: true })
  await writeFile(join(models, 'Connector_PinHeader_2.54mm.3dshapes', 'PinHeader_1x04_P2.54mm_Vertical.step'), STEP)
  await writeFile(join(models, 'Connector_PinHeader_2.54mm.3dshapes', 'PinHeader_1x04_P2.54mm_Vertical.wrl'), 'VRML')
  const mine = { ...env, SCANRULER_KICAD_3DMODELS: models }
  const asked = calls.length
  const r = await searchModels({ query: 'PinHeader_1x04', sources: ['kicad'] }, mine)
  assert.deepEqual(r.results.map((h) => [h.name, h.local]), [['PinHeader_1x04_P2.54mm_Vertical', true]])
  const t = await takeModel({ source: 'kicad', id: r.results[0].id }, mine)
  assert.match(await readFile(t.taken[0], 'utf8'), /^ISO-10303-21/)
  assert.equal(calls.length, asked)
})

test('a STEP taken opens as a body in Reverse Engineer', async () => {
  const t = await takeModel({ source: 'kicad', id: 'Package_TO_SOT_SMD.3dshapes/SOT-23' }, env)
  const link = new EventEmitter()
  const ran = []
  link.run = async (name, input, binary) => {
    ran.push({ name, input, binary })
    return {}
  }
  attachPageAsks({ link, env })
  const answer = () => ran.filter((r) => r.name === 'catalog.answer').pop()?.input
  // The page opens only what a take through it brought in.
  link.emit('notice', { kind: 'catalog.models', data: { req: 'k1', action: 'take', source: 'kicad', id: 'Package_TO_SOT_SMD.3dshapes/SOT-23' } })
  await new Promise((r) => setTimeout(r, 300))
  const path = answer().result.taken[0]
  link.emit('notice', { kind: 'catalog.models', data: { req: 'k2', action: 'open', path, as: 'body' } })
  await new Promise((r) => setTimeout(r, 100))
  const opened = ran.find((r) => r.name === 'reverse.import.step')
  assert.equal(opened.binary, 'bytes')
  assert.match(opened.input.name, /^SOT-23.*\.step$/)
  assert.deepEqual(answer().result, { opened: opened.input.name, as: 'body' })
  assert.ok(t.taken[0])
})
