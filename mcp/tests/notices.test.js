// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { attachNotices, shotLine } from '../src/notices.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

function fakeLink() {
  const link = new EventEmitter()
  link.calls = []
  link.run = async (name, input) => {
    link.calls.push([name, input])
    if (name === 'snapshot.latest') return { file: { name: `shot-${input.id}.png`, bytes: PNG } }
    return { ok: true }
  }
  return link
}
const settle = () => new Promise((r) => setTimeout(r, 20))

test('a screenshot is told once, with its note and marks, and saved beside the scan', async () => {
  const link = fakeLink()
  const dir = mkdtempSync(join(tmpdir(), 'notices-'))
  const told = []
  const n = attachNotices({ link, folder: async () => join(dir, 'scanruler-work'), outDir: join(dir, 'out'), notify: (t) => told.push(t) })
  link.emit('notice', { kind: 'snapshot', data: { id: 'a', at: '2026-11-07T19:40:00Z', workspace: 'Patent', note: 'numerals are off', marks: 2, pins: 1 } })
  await settle()
  const lines = n.drain()
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^From ScanRuler: the person took a screenshot at \d\d:\d\d in Patent; 2 marks, 1 numbered pin with comments; note: “numerals are off”; saved to .*shots\/shot-a\.png\. snapshot_latest shows it\.$/)
  assert.deepEqual(readFileSync(join(dir, 'scanruler-work', 'shots', 'shot-a.png')), PNG)
  assert.deepEqual(link.calls.map((c) => c[0]), ['snapshot.latest', 'snapshot.saved'])
  assert.equal(n.drain().length, 0)
  assert.equal(told.length, 1)
})

test('no scan folder: the output folder; saving off: nothing written; a look clears the news', async () => {
  const link = fakeLink()
  const dir = mkdtempSync(join(tmpdir(), 'notices-'))
  const n = attachNotices({ link, folder: async () => null, outDir: dir })
  link.emit('notice', { kind: 'snapshot', data: { id: 'b' } })
  await settle()
  assert.match(n.drain()[0], /scanruler-shots\/shot-b\.png/)
  link.emit('notice', { kind: 'snapshot', data: { id: 'c', save: false } })
  await settle()
  assert.equal(link.calls.filter((c) => c[1]?.id === 'c').length, 0)
  n.seen()
  assert.equal(n.drain().length, 0)
  link.emit('notice', { kind: 'other', data: {} })
  await settle()
  assert.equal(n.drain().length, 0)
  assert.equal(shotLine({}), 'From ScanRuler: the person took a screenshot. snapshot_latest shows it.')
})
