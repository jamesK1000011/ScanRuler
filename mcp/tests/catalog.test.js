// SPDX-License-Identifier: AGPL-3.0-only
// The catalog extras: listed when asked for; a page opened through the
// person's browser (a stand-in opener here); the new CAD files in a
// downloads folder listed; one taken in, and the CAD files of a zip
// unpacked, each recorded with where it came from, never overwriting.
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { downloads, openUrl, take } from '../src/extras/catalog.js'
import { extraTools } from '../src/extras/index.js'

const helpers = { text: (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] }), failure: (e) => ({ isError: true, content: [{ type: 'text', text: String(e.message ?? e) }] }) }

function storedZip(entries) {
  const parts = [], central = []
  let offset = 0
  for (const [name, data] of entries) {
    const n = Buffer.from(name), d = Buffer.from(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt32LE(d.length, 18)
    local.writeUInt32LE(d.length, 22)
    local.writeUInt16LE(n.length, 26)
    parts.push(local, n, d)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt32LE(d.length, 20)
    c.writeUInt32LE(d.length, 24)
    c.writeUInt16LE(n.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, n)
    offset += 30 + n.length + d.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

test('listed when asked for', () => {
  assert.deepEqual(extraTools(helpers, { SCANRULER_MCP_EXTRAS: 'catalog' }).map((t) => t.name), ['catalog_open_url', 'catalog_watch', 'catalog_sources', 'catalog_source', 'catalog_mcmaster', 'catalog_traceparts', 'catalog_downloads', 'catalog_take'])
  assert.equal(extraTools(helpers, { SCANRULER_MCP_EXTRAS: 'slicer' }).some((t) => t.name.startsWith('catalog_')), false)
})

test('a page opened in the browser, http and https only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'open-'))
  const opener = join(dir, 'opener')
  await writeFile(opener, `#!/bin/sh\necho "$1" > ${join(dir, 'opened.txt')}\n`)
  await chmod(opener, 0o755)
  const r = await openUrl('https://www.traceparts.com/en/search?Keywords=608', { SCANRULER_OPENER: opener })
  assert.equal(r.opened, 'https://www.traceparts.com/en/search?Keywords=608')
  await new Promise((res) => setTimeout(res, 300))
  assert.match(await readFile(join(dir, 'opened.txt'), 'utf8'), /traceparts/)
  await assert.rejects(openUrl('file:///etc/passwd', { SCANRULER_OPENER: opener }), /http and https/)
})

test('new downloads listed; a file and a zip taken in, with provenance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dl-'))
  const dl = join(dir, 'Downloads'), home = join(dir, 'home')
  await import('node:fs/promises').then((f) => f.mkdir(dl))
  await writeFile(join(dl, 'bearing-608.step'), 'ISO-10303-21;')
  await writeFile(join(dl, 'old.stl'), 'solid')
  await utimes(join(dl, 'old.stl'), new Date('2020-01-01'), new Date('2020-01-01'))
  await writeFile(join(dl, 'notes.pdf'), '%PDF')
  await writeFile(join(dl, 'traceparts.zip'), storedZip([['readme.txt', 'x'], ['CAD/screw-m5x16.stp', 'ISO-10303-21;'], ['CAD/screw-m5x16.stl', 'solid']]))
  const env = { SCANRULER_HOME: home, SCANRULER_DOWNLOADS: dl }
  const listed = await downloads({}, env)
  assert.deepEqual(listed.files.map((f) => f.name).sort(), ['bearing-608.step', 'traceparts.zip'])
  const a = await take({ file: join(dl, 'bearing-608.step'), source: 'mcmaster', url: 'https://www.mcmaster.com/608/', licence: 'McMaster CAD terms' }, env)
  assert.equal(a.taken.length, 1)
  const again = await take({ file: join(dl, 'bearing-608.step'), source: 'mcmaster' }, env)
  assert.match(again.taken[0], /bearing-608-2\.step$/)
  const z = await take({ file: join(dl, 'traceparts.zip'), source: 'traceparts' }, env)
  assert.deepEqual(z.taken.map((p) => p.split('/').pop()).sort(), ['screw-m5x16.stl', 'screw-m5x16.stp'])
  const ledger = JSON.parse(await readFile(join(home, 'imports', 'provenance.json'), 'utf8'))
  assert.equal(ledger.length, 4)
  assert.equal(ledger[0].licence, 'McMaster CAD terms')
  assert.equal(ledger.every((x) => x.redistribute === false), true)
  await assert.rejects(take({ file: join(dl, 'notes.pdf'), source: 'x' }, env), /not a CAD file/)
  await assert.rejects(take({ file: join(dl, 'bearing-608.step') }, env), /source/)
})

test('a watch takes each finished download into the imports folder, and leaves what was there', async () => {
  const { watch, watchStatus, stopWatch } = await import('../src/extras/catalog.js')
  const dir = await mkdtemp(join(tmpdir(), 'scanruler-watch-'))
  const dl = join(dir, 'Downloads')
  const { mkdir, rename } = await import('node:fs/promises')
  await mkdir(dl)
  await writeFile(join(dl, 'old.stl'), 'solid old\nendsolid old\n')
  const env = { SCANRULER_HOME: join(dir, 'home'), SCANRULER_DOWNLOADS: dl }
  await watch({ source: 'printables', url: 'https://www.printables.com/model/1', licence: 'CC BY 4.0', redistribute: true, pollMs: 40 }, env)
  await writeFile(join(dl, 'bracket.stl.crdownload'), 'solid b\n')
  await new Promise((s) => setTimeout(s, 200))
  assert.equal(watchStatus().taken.length, 0, 'a partial download is not taken')
  await writeFile(join(dl, 'bracket.stl.crdownload'), 'solid b\nfacet normal 0 0 1\nendfacet\nendsolid b\n')
  await rename(join(dl, 'bracket.stl.crdownload'), join(dl, 'bracket.stl'))
  for (let i = 0; i < 50 && !watchStatus().taken.length; i++) await new Promise((s) => setTimeout(s, 40))
  const st = watchStatus()
  assert.equal(st.taken.length, 1)
  assert.equal(st.taken[0].from, 'bracket.stl')
  const ledger = JSON.parse(await readFile(join(dir, 'home', 'imports', 'provenance.json'), 'utf8'))
  assert.deepEqual(ledger.map((x) => [x.file, x.source, x.licence, x.redistribute]), [['bracket.stl', 'printables', 'CC BY 4.0', true]])
  assert.equal(stopWatch().watching, false)
  await writeFile(join(dl, 'late.stl'), 'solid late\n')
  await new Promise((s) => setTimeout(s, 150))
  assert.equal(watchStatus().taken.length, 1, 'nothing is taken after the watch stops')
})
