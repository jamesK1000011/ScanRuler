// SPDX-License-Identifier: AGPL-3.0-only
// The catalog's red-team round: what a hostile or unlucky site, file or
// caller does to the server's catalog functions, and that each now ends
// well — no key in an answer, no file written over another, no zip bomb,
// no watch eating its own output, no token sent to a stranger.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { take, watch, watchStatus, stopWatch } from '../src/extras/catalog.js'
import { mayShare, modelFiles, searchModels, takeModel } from '../src/extras/models.js'
import { getSecret, setSecret } from '../src/extras/secrets.js'
import { mcmaster } from '../src/extras/sources.js'
import { checkArgs } from '../src/extras/index.js'

const dir = () => mkdtemp(join(tmpdir(), 'rt-'))

/** A zip of { name: bytes } entries, deflated, flags as given. */
function zipOf(files, { flags = 0, claim } = {}) {
  const locals = []
  const centrals = []
  let at = 0
  for (const [name, data] of Object.entries(files)) {
    const body = deflateRawSync(data)
    const n = Buffer.from(name)
    const l = Buffer.alloc(30)
    l.writeUInt32LE(0x04034b50, 0)
    l.writeUInt16LE(flags, 6)
    l.writeUInt16LE(8, 8)
    l.writeUInt32LE(body.length, 18)
    l.writeUInt32LE(claim ?? data.length, 22)
    l.writeUInt16LE(n.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(flags, 8)
    c.writeUInt16LE(8, 10)
    c.writeUInt32LE(body.length, 20)
    c.writeUInt32LE(claim ?? data.length, 24)
    c.writeUInt16LE(n.length, 28)
    c.writeUInt32LE(at, 42)
    locals.push(l, n, body)
    centrals.push(c, n)
    at += 30 + n.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const e = Buffer.alloc(22)
  e.writeUInt32LE(0x06054b50, 0)
  e.writeUInt16LE(Object.keys(files).length, 8)
  e.writeUInt16LE(Object.keys(files).length, 10)
  e.writeUInt32LE(cd.length, 12)
  e.writeUInt32LE(at, 16)
  return Buffer.concat([...locals, cd, e])
}

test('eight takes of one name at once: eight files, eight records, none lost', async () => {
  const d = await dir()
  const src = join(d, 'p.stl')
  await writeFile(src, 'solid p\nendsolid p\n')
  const to = join(d, 'imports')
  const r = await Promise.all(Array.from({ length: 8 }, (_, i) => take({ file: src, to, source: `s${i}` })))
  const names = new Set(r.flatMap((x) => x.taken))
  assert.equal(names.size, 8)
  const ledger = JSON.parse(await readFile(join(to, 'provenance.json'), 'utf8'))
  assert.equal(ledger.length, 8)
  assert.deepEqual(new Set(ledger.map((x) => x.source)).size, 8)
})

test('a zip bomb, a locked zip and a damaged one are refused, and leave nothing behind', async () => {
  const d = await dir()
  const to = join(d, 'imports')
  const big = Buffer.alloc(64 * 1024 * 1024)
  await writeFile(join(d, 'bomb.zip'), zipOf({ 'a.stl': big }, { claim: 1000 }))
  await assert.rejects(take({ file: join(d, 'bomb.zip'), to, source: 'x' }), /unpacks to more than/)
  await writeFile(join(d, 'locked.zip'), zipOf({ 'a.stl': Buffer.from('solid') }, { flags: 1 }))
  await assert.rejects(take({ file: join(d, 'locked.zip'), to, source: 'x' }), /locked with a password/)
  const ok = zipOf({ 'a.stl': Buffer.from('solid a'), 'b.stl': Buffer.from('solid b') })
  await writeFile(join(d, 'cut.zip'), ok.subarray(0, ok.length - 30))
  await assert.rejects(take({ file: join(d, 'cut.zip'), to, source: 'x' }), /not a zip|not a readable zip/)
  const left = (await readdir(to).catch(() => [])).filter((n) => n.endsWith('.stl'))
  assert.deepEqual(left, [])
})

test('a glTF zip keeps its buffers and textures beside it; no path leaves its folder', async () => {
  const d = await dir()
  const to = join(d, 'imports')
  await writeFile(join(d, 'm.zip'), zipOf({ 'scene.gltf': Buffer.from('{}'), 'scene.bin': Buffer.from('bin'), 'textures/a.png': Buffer.from('png'), '../../evil.png': Buffer.from('x') }))
  const r = await take({ file: join(d, 'm.zip'), to, source: 'sketchfab' })
  assert.equal(r.taken.length, 1)
  assert.match(r.taken[0], /m[/\\]scene\.gltf$/)
  assert.equal(await readFile(join(to, 'm', 'scene.bin'), 'utf8'), 'bin')
  assert.equal(await readFile(join(to, 'm', 'textures', 'a.png'), 'utf8'), 'png')
  assert.ok(!(await readdir(d)).includes('evil.png'))
})

test('a broken provenance.json is set aside, not a reason to fail', async () => {
  const d = await dir()
  const to = join(d, 'imports')
  await mkdir(to)
  await writeFile(join(to, 'provenance.json'), '{ not json')
  await writeFile(join(d, 'p.stl'), 'solid p')
  const r = await take({ file: join(d, 'p.stl'), to, source: 'x' })
  assert.match(r.note, /could not be read/)
  assert.ok((await readdir(to)).some((n) => n.startsWith('provenance.corrupt-')))
})

test('a watch refuses its own imports folder, and a bad start leaves the running watch be', async () => {
  const d = await dir()
  await assert.rejects(watch({ dir: d, to: d, source: 'x' }), /take its own files/)
  await assert.rejects(watch({ dir: d, to: join(d, 'imports'), source: 'x' }), /take its own files/)
  const other = await dir()
  await watch({ dir: d, to: other, source: 'x', minutes: 1 })
  await assert.rejects(watch({ dir: d, to: other, source: 'y', minutes: 'abc' }), /minutes/)
  assert.equal(watchStatus().watching, true)
  assert.equal(watchStatus().source, 'x')
  stopWatch()
})

test('a key with stray newlines is used trimmed, and a bad header never shows the key', async () => {
  const d = await dir()
  const env = { SCANRULER_HOME: d, SCANRULER_SECRETS: 'file' }
  await writeFile(join(d, 'secrets.json'), JSON.stringify({ 'catalog:sketchfab': 'sk-SECRET-123\n\n' }))
  assert.equal(await getSecret('catalog:sketchfab', env), 'sk-SECRET-123')
  await setSecret('catalog:thingiverse', 'tv-SECRET\nX-Evil: 1', env)
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => new Headers(init.headers) && new Response('{}')
  try {
    const r = await searchModels({ query: 'x', sources: ['thingiverse'], thumbnails: false }, env)
    assert.ok(!JSON.stringify(r).includes('SECRET'), JSON.stringify(r))
  } finally {
    globalThis.fetch = real
  }
})

test('a secrets file that is not JSON is said plainly, without quoting it', async () => {
  const d = await dir()
  await writeFile(join(d, 'secrets.json'), '{"catalog:thingiverse": tv-SUPERSECRET }')
  await assert.rejects(getSecret('catalog:thingiverse', { SCANRULER_HOME: d, SCANRULER_SECRETS: 'file' }), (e) => /not valid JSON/.test(e.message) && !e.message.includes('SUPERSECRET'))
})

test('the Thingiverse token goes to its API only; a typed file id is not swapped for another', async () => {
  const d = await dir()
  const env = { SCANRULER_HOME: d, SCANRULER_SECRETS: 'file' }
  await setSecret('catalog:thingiverse', 'tv-token', env)
  const sent = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url)
    sent.push({ host: u.host, auth: new Headers(init.headers).get('authorization') })
    if (u.pathname === '/things/7') return new Response(JSON.stringify({ license: 'Creative Commons - Attribution' }))
    if (u.pathname === '/things/7/files') return new Response(JSON.stringify([{ id: 1, name: 'README.pdf', download_url: 'https://files.example.com/r' }, { id: 2, name: 'part.stl', download_url: 'https://evil.example.com/p' }]))
    return new Response('solid p', { headers: { 'content-type': 'application/octet-stream' } })
  }
  try {
    await assert.rejects(takeModel({ source: 'thingiverse', id: '7', file: '9' }, env), /no file "9".*1, 2/)
    const t = await takeModel({ source: 'thingiverse', id: '7' }, env)
    assert.match(t.file, /part\.stl/)
    assert.equal(sent.find((s) => s.host === 'evil.example.com').auth, null)
    await assert.rejects(modelFiles({ source: 'constructor', id: '1' }, env), /No library/)
  } finally {
    globalThis.fetch = real
  }
})

test('a McMaster part number with a path in it is refused before anything is asked', async () => {
  await assert.rejects(mcmaster({ part: '../../../tmp/ESCAPED' }, { SCANRULER_HOME: await dir() }), /part number/)
  await assert.rejects(mcmaster({}, { SCANRULER_HOME: await dir() }), /part number/)
})

test('licences: no-derivatives and negations are not shared on', () => {
  for (const l of ['CC BY-ND 4.0', 'CC BY-NC-ND', 'Not Creative Commons', 'Copyright, not cc0', 'All rights reserved']) assert.equal(mayShare(l), false, l)
  for (const l of ['CC0', 'CC BY 4.0', 'Creative Commons - Attribution - Share Alike', 'Public Domain']) assert.equal(mayShare(l), true, l)
})

test('tool arguments are checked against the schema', () => {
  const s = { type: 'object', properties: { query: { type: 'string' }, sources: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } }, page: { type: 'number' } }, required: ['query'], additionalProperties: false }
  assert.throws(() => checkArgs(s, {}), /query is needed/)
  assert.throws(() => checkArgs(s, { query: 'x', sources: 'a' }), /a list/)
  assert.throws(() => checkArgs(s, { query: 'x', sources: ['c'] }), /not one of/)
  assert.throws(() => checkArgs(s, { query: 'x', pollMs: 1 }), /not an input/)
  assert.throws(() => checkArgs(s, { query: 'x', page: NaN }), /number/)
  assert.deepEqual(checkArgs(s, { query: 'x', sources: ['a'], page: 2 }), { query: 'x', sources: ['a'], page: 2 })
})
