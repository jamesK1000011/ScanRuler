// SPDX-License-Identifier: AGPL-3.0-only
// What a triple clamp's run tripped over at the server: a read still writing
// its file while a wait for idle said idle and a second export began on top
// of it; a queued change refused busy, its failure read 16 s later; a save
// after the page was reset, a file named for the last revision holding none
// of it, and nothing in the answer to say so; and a run's refusals left in
// its trace as bare codes. A fake page behind a real MCP client.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { PageLink } from '../src/link.js'
import { createMcpServer } from '../src/mcp.js'
import { httpServer } from '../src/serve.js'
import { replyHead } from '../src/trace.js'
import { fakePage } from './fakePage.js'

const TOKEN = 'a-token-for-the-save-and-idle-tests'
const obj = (properties = {}) => ({ type: 'object', properties, additionalProperties: false })
const command = (name, readOnly, extra = {}) => ({ name, title: name, description: `${name}.`, input: obj(), readOnly, returnsFile: false, returnsImage: false, ...extra })
const COMMANDS = [
  command('session.state', true),
  { ...command('demo.slowread', true), input: obj({ ms: { type: 'number' } }) },
  command('demo.change', false),
  command('project.save', true, { returnsFile: true }),
]

let link
let http
let client
let page
let dir
let busyUntil = 0
let held = {}
let aligned = false
let changes = 0

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'scanruler-save-idle-'))
  link = new PageLink({ token: TOKEN })
  http = httpServer({})
  link.attach(http)
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve))
  const server = createMcpServer({ link, version: '0.0.0', cwd: dir, outDir: dir, connectHelp: () => 'Pair it.', serverInfo: () => ({}), pageTimeoutMs: 50, tools: 'full' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(a), client.connect(b)])
  ;({ page } = await fakePage(http.address().port, {
    token: TOKEN,
    commands: COMMANDS,
    answer: async (name, input) => {
      if (name === 'session.state') return { busy: Date.now() < busyUntil ? 'working out a map' : null, running: null }
      if (name === 'demo.slowread') {
        await new Promise((r) => setTimeout(r, input.ms))
        return { read: true }
      }
      if (name === 'demo.change') {
        if (Date.now() < busyUntil) throw { code: 'busy', message: 'The session is busy — working out a map.' }
        changes++
        return { changed: changes }
      }
      if (name === 'project.save') return { file: { name: 'part.scanruler', mimeType: 'application/zip', bytes: new Uint8Array([0x50, 0x4b]) }, holds: held, aligned }
      throw { code: 'unknown_command', message: name }
    },
  }))
})
after(async () => {
  await client.close()
  page.close()
  link.close()
  http.close()
  rmSync(dir, { recursive: true, force: true })
})

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  return { error: r.isError === true, text: r.content[0].text, json: r.isError ? null : JSON.parse(r.content[0].text) }
}

test('a wait for idle waits for a read still being answered', async () => {
  const reading = call('demo_slowread', { ms: 300 })
  await new Promise((r) => setTimeout(r, 30))
  const at = Date.now()
  const idle = await call('scanruler_wait', { for: 'idle', timeoutSeconds: 5 })
  assert.equal(idle.json.state, 'idle')
  assert.ok(Date.now() - at >= 200, 'idle came before the read was done')
  await reading
})

test('a wait for idle that runs out while a read goes on says running', async () => {
  const reading = call('demo_slowread', { ms: 1500 })
  await new Promise((r) => setTimeout(r, 30))
  const idle = await call('scanruler_wait', { for: 'idle', timeoutSeconds: 0.2 })
  assert.equal(idle.json.state, 'running')
  await reading
})

test('a change refused busy runs again once the page is idle, once', async () => {
  const before = changes
  busyUntil = Date.now() + 200
  const r = await call('demo_change', {})
  assert.equal(r.error, false, r.text)
  assert.equal(changes, before + 1)
  busyUntil = 0
})

test('a save says what it holds, and what fell away since the last', async () => {
  held = { elements: 37, features: 59 }
  aligned = true
  const first = await call('project_save', { path: join(dir, 'a.scanruler') })
  assert.deepEqual(first.json.holds, { elements: 37, features: 59 })
  assert.equal(first.json.warning, undefined)

  const more = await call('project_save', { path: join(dir, 'b.scanruler') })
  assert.equal(more.json.warning, undefined, 'the same work again says nothing')

  // The page reset between them: hand-fitted elements, no model, no alignment.
  held = { elements: 22 }
  aligned = false
  const reset = await call('project_save', { path: join(dir, 'c.scanruler') })
  assert.match(reset.json.warning, /holds less than the last save/)
  assert.match(reset.json.warning, /59 features/)
  assert.match(reset.json.warning, /the alignment/)
  assert.match(reset.json.warning, /b\.scanruler/)
  assert.doesNotMatch(reset.json.warning, /elements/, 'elements are still there, fewer')
})

test('the trace keeps the head of an answer, a refusal’s message with it', () => {
  assert.equal(replyHead({ content: [{ type: 'text', text: 'invalid_input: $.places: not a known field' }], isError: true }), 'invalid_input: $.places: not a known field')
  assert.equal(replyHead({ content: [{ type: 'text', text: 'x'.repeat(2000) }] }).length, 500)
  assert.equal(replyHead({ content: [{ type: 'image', data: 'abc' }] }), undefined)
})
