// SPDX-License-Identifier: AGPL-3.0-only
// A batch built at its end: with build: "end" every call but the last goes
// to the page deferred, so a run of changes builds once; without it, none
// does. A batch so built that stops before its last call has the page read
// for idle, which builds what the deferred calls left. A fake page behind a
// real MCP client.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { PageLink } from '../src/link.js'
import { createMcpServer } from '../src/mcp.js'
import { httpServer } from '../src/serve.js'
import { fakePage } from './fakePage.js'

const TOKEN = 'a-token-for-the-build-end-tests'
const obj = (properties = {}) => ({ type: 'object', properties, additionalProperties: false })
const COMMANDS = [
  { name: 'session.state', title: 'Read the session', description: 'The session.', input: obj(), readOnly: true, returnsFile: false, returnsImage: false },
  { name: 'demo.change', title: 'Change', description: 'Changes.', input: obj({ n: { type: 'number' }, fail: { type: 'boolean' } }), readOnly: false, returnsFile: false, returnsImage: false },
]

let link
let http
let client
let page

before(async () => {
  link = new PageLink({ token: TOKEN })
  http = httpServer({})
  link.attach(http)
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve))
  const server = createMcpServer({ link, version: '0.0.0', cwd: '.', outDir: '.', connectHelp: () => 'Pair it.', serverInfo: () => ({}), pageTimeoutMs: 50, tools: 'full' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(a), client.connect(b)])
  ;({ page } = await fakePage(http.address().port, {
    token: TOKEN,
    commands: COMMANDS,
    answer: async (name, input, _progress, message) => {
      if (name === 'session.state') return { busy: null, running: null }
      if (name === 'demo.change') {
        if (input.fail) throw { code: 'invalid_state', message: 'Not now.' }
        return { n: input.n, ...(message.deferred ? { build: 'held' } : {}) }
      }
      throw { code: 'unknown_command', message: name }
    },
  }))
})
after(async () => {
  await client.close()
  page.close()
  link.close()
  http.close()
})

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  const text = r.content[0].text
  return { error: r.isError === true, text, json: r.isError ? null : JSON.parse(text) }
}
const changes = (n) => Array.from({ length: n }, (_, i) => ({ tool: 'demo_change', arguments: { n: i + 1 } }))

test('the batch takes build', async () => {
  const { tools } = await client.listTools()
  const batch = tools.find((t) => t.name === 'scanruler_batch')
  assert.deepEqual(batch.inputSchema.properties.build.enum, ['each', 'end'])
  assert.match(batch.description, /build: "end"/)
})

test('build: "end" sends every call but the last deferred', async () => {
  page.runs.length = 0
  const r = await call('scanruler_batch', { calls: changes(9), build: 'end', rollback: false })
  assert.equal(r.json.ran, 9)
  const runs = page.runs.filter((m) => m.name === 'demo.change')
  assert.deepEqual(
    runs.map((m) => m.deferred === true),
    [true, true, true, true, true, true, true, true, false],
  )
  assert.equal(r.json.results[0].result.build, 'held')
  assert.equal(r.json.results[8].result.build, undefined)
  // Ended on its last call, nothing is left held: no extra read.
  assert.ok(!page.runs.some((m) => m.name === 'session.state'))
})

test('without it, no call is deferred', async () => {
  page.runs.length = 0
  await call('scanruler_batch', { calls: changes(3), rollback: false })
  assert.ok(page.runs.every((m) => m.deferred === undefined))
})

test('stopped before its last call, the page is read for idle, which builds what was held', async () => {
  page.runs.length = 0
  const r = await call('scanruler_batch', { calls: [...changes(2), { tool: 'demo_change', arguments: { fail: true } }, ...changes(1)], build: 'end', rollback: false })
  assert.equal(r.json.stopped, 2)
  assert.deepEqual(
    page.runs.map((m) => [m.name, m.deferred === true]),
    [
      ['demo.change', true],
      ['demo.change', true],
      ['demo.change', true],
      ['session.state', false],
    ],
  )
})
