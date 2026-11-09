// SPDX-License-Identifier: AGPL-3.0-only
// --tools lean: the session, guide, history, project and view tools and the
// server's own listed from the start; every other namespace a group,
// listed once scanruler_tools enables it — the client told the list
// changed — and run through scanruler_batch either way. Over an
// in-memory transport, the engine a stand-in.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { EngineLink } from '../src/engine.js'
import { createMcpServer, parseToolMode } from '../src/mcp.js'

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const command = (name, readOnly = true) => ({ name, title: name, description: `${name}, for the test.`, input: obj({ n: { type: 'number' } }), readOnly, returnsFile: false, returnsImage: false })

const standIn = () => ({
  app: 'ScanRuler',
  version: '9.9.9',
  plugins: ['demo'],
  listCommands: () => [command('session.state'), command('guide.read'), command('history.undo', false), command('demo.add', false), command('demo.list'), command('scan.query')],
  pageCommands: () => [],
  run: async (name, input) => ({ ran: name, input }),
  stop: async () => {},
})

let client
let link
let changed = 0

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scanruler-mcp-lean-'))
  link = new EngineLink(standIn(), '/where/engine.mjs')
  const server = createMcpServer({ link, version: '0.0.0', cwd: dir, outDir: dir, connectHelp: () => '', serverInfo: () => ({}), tools: 'lean' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '0.0.0' })
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    changed++
  })
  await Promise.all([server.connect(a), client.connect(b)])
})
after(async () => {
  await client.close()
  link.close()
})

const names = async () => (await client.listTools()).tools.map((t) => t.name)
const tools = async (args) => JSON.parse((await client.callTool({ name: 'scanruler_tools', arguments: args })).content[0].text)

test('lean is a mode of its own', () => {
  assert.deepEqual({ ...parseToolMode('lean'), lists: undefined }, { text: 'lean', compact: false, lean: true, named: null, lists: undefined })
})

test('lists the tools every task uses, the rest by group once enabled', async () => {
  const first = await names()
  for (const n of ['session_state', 'guide_read', 'history_undo', 'scanruler_tools', 'scanruler_batch']) assert.ok(first.includes(n), n)
  assert.ok(!first.includes('demo_add') && !first.includes('scan_query'))
  assert.match(client.getInstructions(), /scanruler_tools \{ enable: \["reverse"\] \}/)
  assert.match(client.getInstructions(), /Paths: A relative path is taken from/)

  const index = await tools({})
  assert.deepEqual(index.groups.demo, { listed: false, tools: 'add, list' })
  assert.equal(index.groups.session.listed, true)
  assert.deepEqual((await tools({ group: 'demo' })).group, { name: 'demo', listed: false, tools: { demo_add: 'demo.add', demo_list: 'demo.list' } })

  const on = await tools({ enable: ['demo', 'scan_query', 'nothing'] })
  assert.deepEqual(on.enabled, ['demo', 'scan'])
  assert.deepEqual(on.listed, ['demo_add', 'demo_list', 'scan_query'])
  assert.deepEqual(on.unknown, ['nothing'])
  const now = await names()
  for (const n of ['demo_add', 'demo_list', 'scan_query']) assert.ok(now.includes(n), n)
  await new Promise((r) => setTimeout(r, 10))
  assert.ok(changed >= 1, 'the client is told the list changed')

  const off = await tools({ disable: ['scan'] })
  assert.deepEqual(off.disabled, ['scan'])
  assert.ok(!(await names()).includes('scan_query'))
})

test('a group not listed still runs, directly or batched, and its definitions are there', async () => {
  const direct = await client.callTool({ name: 'scan_query', arguments: { n: 1 } })
  assert.equal(JSON.parse(direct.content[0].text).ran, 'scan.query')
  const batch = JSON.parse((await client.callTool({ name: 'scanruler_batch', arguments: { calls: [{ tool: 'scan_query', arguments: { n: 2 } }] } })).content[0].text)
  assert.equal(batch.results[0].ok, true)
  const defs = await tools({ names: ['scan_query', 'scanruler_status'] })
  assert.deepEqual(defs.tools.map((t) => t.name), ['scan_query', 'scanruler_status'])
})
