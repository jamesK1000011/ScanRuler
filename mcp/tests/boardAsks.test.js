// SPDX-License-Identifier: AGPL-3.0-only
// The Boards panel's asks of this server: answered only by the copy that
// holds the tab; the board's STEP and the fab zip go back as bytes; a
// cancel stops a run before it answers; a path that is no board is said so.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { copyFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { attachBoardAsks } from '../src/boardAsks.js'
import { fakeKicad } from './fakeKicad.js'

const FIXTURE = fileURLToPath(new URL('./fixtures/tiny.kicad_pcb', import.meta.url))

async function setUp(holds = true) {
  const dir = await mkdtemp(join(tmpdir(), 'boardasks-'))
  const board = join(dir, 'tiny.kicad_pcb')
  await copyFile(FIXTURE, board)
  const env = { ...process.env, SCANRULER_HOME: join(dir, 'home'), SCANRULER_KICAD_CLI: await fakeKicad(dir, 9) }
  const link = new EventEmitter()
  const ran = []
  const waiters = []
  link.run = async (name, input, binary) => {
    ran.push({ name, input, binary })
    for (const w of waiters.splice(0)) w()
    return {}
  }
  attachBoardAsks({ link, holds: () => holds, env })
  const ask = (data) => link.emit('notice', { kind: 'pcb.kicad', data })
  const answer = async (req, ms = 5000) => {
    const end = Date.now() + ms
    for (;;) {
      const a = ran.find((r) => r.name === 'pcb.answer' && r.input.req === req)
      if (a) return a
      if (Date.now() > end) return null
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  return { board, ask, answer, ran }
}

test('import: the STEP back as bytes, the board read, progress on the way', async () => {
  const { board, ask, answer, ran } = await setUp()
  ask({ req: 'a1', action: 'import', path: board })
  const a = await answer('a1')
  assert.equal(a.input.ok, true, a.input.error)
  assert.equal(a.binary, 'bytes')
  assert.match(new TextDecoder().decode(a.input.bytes.subarray(0, 14)), /ISO-10303-21/)
  assert.equal(a.input.result.board.holes.length, 2)
  assert.equal(a.input.result.step.bytes, undefined)
  assert.ok(ran.some((r) => r.name === 'pcb.progress' && r.input.req === 'a1'))
})

test('fab: the zip back as bytes; tools and read answer at once', async () => {
  const { board, ask, answer } = await setUp()
  ask({ req: 'f1', action: 'fab', path: board, drc: false })
  const f = await answer('f1')
  assert.equal(f.input.ok, true, f.input.error)
  assert.equal(f.input.bytes[0], 0x50)
  assert.ok(f.input.result.files.includes('tiny.GTL'))
  ask({ req: 't1', action: 'tools' })
  assert.equal((await answer('t1')).input.result.ready, true)
  ask({ req: 'r1', action: 'read', path: board })
  assert.equal((await answer('r1')).input.result.connectors.length, 2)
})

test('a path that is no board, an unknown action, a copy that does not hold the tab', async () => {
  const { ask, answer } = await setUp()
  ask({ req: 'b1', action: 'import', path: '/etc/passwd' })
  const b = await answer('b1')
  assert.equal(b.input.ok, false)
  assert.match(b.input.error, /not a KiCad board/)
  assert.equal(b.binary, undefined)
  ask({ req: 'b2', action: 'rm', path: '/' })
  assert.equal(await answer('b2', 200), null)
  const other = await setUp(false)
  other.ask({ req: 'c1', action: 'tools' })
  assert.equal(await other.answer('c1', 200), null)
})

test('cancelled before it ran: no answer', async () => {
  const { board, ask, answer } = await setUp()
  ask({ req: 'x1x', action: 'cancel', of: 'x1' })
  ask({ req: 'x1', action: 'import', path: board })
  assert.equal(await answer('x1', 400), null)
})
