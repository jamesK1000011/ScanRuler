// SPDX-License-Identifier: AGPL-3.0-only
// The model libraries against stand-in APIs: each answers in its own shape
// and comes back in one; a library without its key is named with how to set
// it, not failed; a take writes the file and its licence beside it; the
// page's asks are answered only by the copy holding the tab, and open only
// what a take brought in. No key ever appears in an answer.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { librariesStatus, mayShare, modelFiles, searchModels, takeModel } from '../src/extras/models.js'
import { attachPageAsks } from '../src/pageAsks.js'
import { setSecret } from '../src/extras/secrets.js'

const KEYS = { sketchfab: 'sk-token-xyz', thingiverse: 'tv-token-xyz', cults: 'maker:cults-key-xyz' }
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
const STL = new TextEncoder().encode('solid t\nendsolid t\n')
let env, realFetch, calls

const reply = (body, status = 200, type = 'application/json') => new Response(type.includes('json') ? JSON.stringify(body) : body, { status, headers: { 'content-type': type } })

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'models-'))
  env = { SCANRULER_HOME: join(dir, 'home'), SCANRULER_SECRETS: 'file' }
  realFetch = globalThis.fetch
  calls = []
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url)
    const auth = init.headers?.Authorization ?? ''
    calls.push({ url: u.toString(), auth })
    if (u.host === 'api.sketchfab.com' && u.pathname === '/v3/search') return reply({ results: [{ uid: 'sf1', name: 'Bearing holder', user: { displayName: 'Ann' }, license: { label: 'CC Attribution' }, viewerUrl: 'https://sketchfab.com/3d-models/sf1', thumbnails: { images: [{ url: 'https://media.sketchfab.com/t.jpg', width: 256 }] }, isDownloadable: true }] })
    if (u.host === 'api.sketchfab.com' && u.pathname === '/v3/models/sf1/download') return auth === `Token ${KEYS.sketchfab}` ? reply({ glb: { url: 'https://s3.example.com/sf1.glb?sig=1', size: 20 } }) : reply({}, 401)
    if (u.host === 'api.sketchfab.com' && u.pathname === '/v3/models/sf1') return reply({ license: { label: 'CC Attribution' }, viewerUrl: 'https://sketchfab.com/3d-models/sf1' })
    if (u.host === 's3.example.com') return reply(STL, 200, 'application/octet-stream')
    if (u.host === 'media.sketchfab.com' || u.host === 'cdn.thingiverse.com') return reply(JPEG, 200, 'image/jpeg')
    if (u.host === 'api.thingiverse.com') {
      if (auth !== `Bearer ${KEYS.thingiverse}`) return reply({}, 401)
      if (u.pathname.startsWith('/search/')) return reply({ total: 2, hits: [{ id: 101, name: '608 holder', creator: { name: 'Bo' }, public_url: 'https://www.thingiverse.com/thing:101', preview_image: 'https://cdn.thingiverse.com/a.jpg' }, { id: 102, name: '608 spinner', creator: { name: 'Cy' }, public_url: 'https://www.thingiverse.com/thing:102' }] })
      if (u.pathname === '/things/101') return reply({ license: 'Creative Commons - Attribution', public_url: 'https://www.thingiverse.com/thing:101' })
      if (u.pathname === '/things/101/files') return reply([{ id: 9, name: 'holder.stl', size: 20, download_url: 'https://api.thingiverse.com/files/9/download' }])
      if (u.pathname === '/files/9/download') return reply(STL, 200, 'application/octet-stream')
    }
    if (u.host === 'cults3d.com') {
      if (auth !== `Basic ${Buffer.from(KEYS.cults).toString('base64')}`) return reply({}, 401)
      return reply({ data: { creationsSearchBatch: { total: 1, results: [{ slug: 'c1', name: 'Bearing cap', url: 'https://cults3d.com/en/3d-model/c1', creator: { nick: 'Di' }, license: { name: 'Cults - Private Use' }, price: { cents: 0 } }] } } })
    }
    return reply({}, 404)
  }
})
after(() => (globalThis.fetch = realFetch))

test('without keys: Sketchfab still searches; the others say how to set theirs', async () => {
  const r = await searchModels({ query: '608 bearing' }, env)
  assert.deepEqual(r.results.map((x) => x.source), ['sketchfab'])
  assert.equal(r.results[0].licence, 'CC Attribution')
  assert.match(r.results[0].thumbnail, /^data:image\/jpeg;base64,/)
  assert.match(r.missing.thingiverse, /secrets\.js set catalog:thingiverse/)
  assert.match(r.missing.cults3d, /user:key/)
  const st = await librariesStatus(env)
  assert.equal(st.sketchfab.search, true)
  assert.equal(st.sketchfab.download, false)
  await assert.rejects(modelFiles({ source: 'sketchfab', id: 'sf1' }, env), /API token/)
})

test('with keys: every library answers, interleaved, and no key is in an answer', async () => {
  await setSecret('catalog:sketchfab', KEYS.sketchfab, env)
  await setSecret('catalog:thingiverse', KEYS.thingiverse, env)
  await setSecret('catalog:cults3d', KEYS.cults, env)
  const r = await searchModels({ query: '608 bearing' }, env)
  assert.deepEqual(r.results.map((x) => `${x.source}:${x.id}`), ['sketchfab:sf1', 'thingiverse:101', 'cults3d:c1', 'thingiverse:102'])
  assert.equal(r.results.find((x) => x.source === 'cults3d').downloadable, false)
  assert.equal(r.missing, undefined)
  const said = JSON.stringify([r, await librariesStatus(env)])
  assert.ok(!Object.values(KEYS).some((k) => said.includes(k)))
})

test('a take: the file in the imports folder, its licence beside it, shared on only under Creative Commons', async () => {
  const files = await modelFiles({ source: 'thingiverse', id: '101' }, env)
  assert.deepEqual(files.files, [{ id: '9', name: 'holder.stl', size: 20, format: 'stl' }])
  const t = await takeModel({ source: 'thingiverse', id: '101', file: '9' }, env)
  assert.ok(existsSync(t.taken[0]))
  const ledger = JSON.parse(await readFile(t.provenance, 'utf8'))
  assert.equal(ledger.at(-1).licence, 'Creative Commons - Attribution')
  assert.equal(ledger.at(-1).redistribute, true)
  const s = await takeModel({ source: 'sketchfab', id: 'sf1' }, env)
  assert.match(s.taken[0], /sf1\.glb$/)
  assert.equal(mayShare('Cults - Private Use'), false)
  assert.equal(mayShare('CC0'), true)
})

test('the page asks: answered once, by the holding copy; open takes only what was brought in', async () => {
  const runs = []
  const link = Object.assign(new EventEmitter(), { run: async (name, input) => (runs.push({ name, input }), { ok: true }) })
  const relay = Object.assign(new EventEmitter(), { run: async () => assert.fail('a relaying copy answered') })
  attachPageAsks({ link, holds: () => true, env })
  attachPageAsks({ link: relay, holds: () => false, env })
  const ask = async (data) => {
    const before = runs.length
    link.emit('notice', { kind: 'catalog.models', data })
    relay.emit('notice', { kind: 'catalog.models', data })
    for (let i = 0; i < 100 && runs.filter((r) => r.name === 'catalog.answer').length === runs.filter((r, j) => j < before && r.name === 'catalog.answer').length; i++) await new Promise((s) => setTimeout(s, 20))
    return runs.filter((r) => r.name === 'catalog.answer').at(-1).input
  }
  const found = await ask({ req: 'r1', action: 'search', query: '608' })
  assert.equal(found.ok, true)
  assert.equal(found.result.results.length, 4)
  const t = await ask({ req: 'r2', action: 'take', source: 'thingiverse', id: '101', file: '9' })
  assert.equal(t.ok, true)
  const bad = await ask({ req: 'r3', action: 'open', path: '/etc/hosts' })
  assert.equal(bad.ok, false)
  const o = await ask({ req: 'r4', action: 'open', path: t.result.taken[0], as: 'reference' })
  assert.equal(o.ok, true)
  const opened = runs.find((r) => r.name === 'deviation.open_reference')
  assert.match(opened.input.name, /^holder(-\d+)?\.stl$/)
  assert.ok(opened.input.bytes.length > 0)
})
