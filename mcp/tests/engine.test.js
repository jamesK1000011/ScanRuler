// SPDX-License-Identifier: AGPL-3.0-only
// The server headless: ScanRuler run in this process from an engine in
// place of the page — here a stand-in engine with two commands that run
// headless and one that needs the page — with a real MCP client over an
// in-memory transport; and the engine looked for where it is not.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { EngineLink, loadEngine } from '../src/engine.js'
import { createMcpServer } from '../src/mcp.js'

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false })

/** An engine as scripts/build-engine.mjs builds one, cut down: the same
 *  shape, its own little session. */
function standIn() {
  const parameters = []
  const calls = []
  return {
    calls,
    app: 'ScanRuler',
    version: '9.9.9',
    plugins: ['demo'],
    listCommands: () => [
      { name: 'session.state', title: 'Read the session', description: 'The session.', input: obj(), readOnly: true, returnsFile: false, returnsImage: false },
      { name: 'demo.parameter_add', title: 'Add a parameter', description: 'A parameter.', input: obj({ name: { type: 'string' } }, ['name']), readOnly: false, returnsFile: false, returnsImage: false },
      { name: 'demo.export', title: 'Export', description: 'A file.', input: obj(), readOnly: true, returnsFile: true, returnsImage: false },
      { name: 'demo.long', title: 'A long reading', description: 'Many rows.', input: obj(), readOnly: true, returnsFile: false, returnsImage: false },
    ],
    pageCommands: () => ['view.render', 'scan.open', 'dfm.check_scan'],
    insteadOf: (name) => (name === 'dfm.check_scan' ? 'dfm.settings { target: "body" } checks a body instead.' : null),
    attached: null,
    notices: [],
    attach(server) {
      this.attached = server
      return () => {
        this.attached = null
      }
    },
    async run(name, input) {
      calls.push(name)
      if (name === 'session.state') return { parameters: [...parameters], viewport: false }
      if (name === 'demo.parameter_add') {
        if (!input.name) throw { code: 'invalid_input', message: 'name: give one.' }
        parameters.push(input.name)
        return { added: input.name }
      }
      if (name === 'demo.export') return { file: { name: 'part.step', mimeType: 'model/step', bytes: new TextEncoder().encode('ISO-10303-21;') } }
      if (name === 'demo.long') return { rows: Array.from({ length: 4000 }, (_, i) => ({ i, text: 'a reading of the part, long enough to add up' })) }
      if (name === 'demo.answer') {
        this.notices.push(input)
        return { taken: true }
      }
      throw { code: 'unavailable', message: `${name} needs the page.` }
    },
    stopped: false,
    async stop() {
      this.stopped = true
    },
  }
}

let engine
let link
let client
let dir

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scanruler-mcp-engine-'))
  engine = standIn()
  link = new EngineLink(engine, '/where/engine.mjs')
  const server = createMcpServer({
    link,
    version: '0.0.0',
    cwd: dir,
    outDir: dir,
    connectHelp: () => 'No page connects to this one.',
    serverInfo: () => ({ backend: 'headless', engine: link.file }),
    remembered: null,
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(a), client.connect(b)])
})
after(async () => {
  await client.close()
  link.close()
})

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  const text = r.content[0].text
  return { error: r.isError === true, text, json: r.isError ? null : JSON.parse(text) }
}

test('headless: the server says so, lists the engine’s tools, and runs them in the engine', async () => {
  assert.match(client.getInstructions(), /headless/)
  assert.doesNotMatch(client.getInstructions(), /browser tab the user has open/)
  const names = (await client.listTools()).tools.map((t) => t.name)
  assert.deepEqual(names.filter((n) => !n.startsWith('scanruler_')), ['session_state', 'demo_parameter_add', 'demo_export', 'demo_long'])
  const status = await call('scanruler_status')
  assert.equal(status.json.backend, 'headless')
  assert.equal(status.json.connected, true)
  assert.equal(status.json.page.version, '9.9.9')
  assert.equal(status.json.server.engine, '/where/engine.mjs')
  assert.equal(status.json.howToConnect, undefined)
  const opened = await call('scanruler_open')
  assert.equal(opened.json.opened, false)
  assert.match(opened.json.note, /headless/)
  assert.deepEqual((await call('demo_parameter_add', { name: 'l1' })).json, { added: 'l1' })
  assert.deepEqual((await call('session_state')).json.parameters, ['l1'])
  const refused = await call('demo_parameter_add', { name: '' })
  assert.equal(refused.error, true)
  assert.equal(refused.text, 'invalid_input: name: give one.')
  // A file goes to a path on this computer, as from the page.
  const file = await call('demo_export', { path: dir })
  assert.equal(await readFile(file.json.file.path, 'utf8'), 'ISO-10303-21;')
})

test('headless: a tool that needs the page answers unavailable, naming the page mode; one that does not exist is unknown', async () => {
  const page = await call('view_render', {})
  assert.equal(page.error, true)
  assert.match(page.text, /^unavailable: view_render needs the ScanRuler page .* page mode/)
  const none = await call('nothing_here', {})
  assert.equal(none.error, true)
  assert.match(none.text, /^unknown_command:/)
  assert.ok(!engine.calls.includes('view.render'))
  // A batch is run in the engine the same way.
  const batch = await call('scanruler_batch', { calls: [{ tool: 'demo_parameter_add', arguments: { name: 'q' } }, { tool: 'view_render' }] })
  assert.equal(batch.json.results[0].ok, true)
  assert.equal(batch.json.results[1].error.code, 'unavailable')
})

test('headless: a page tool with a headless stand-in names it in its refusal', async () => {
  const refused = await call('dfm_check_scan', {})
  assert.equal(refused.error, true)
  assert.match(refused.text, /^unavailable: dfm_check_scan needs the ScanRuler page .* Headless: dfm\.settings \{ target: "body" \} checks a body instead\. Or start scanruler-mcp in page mode/)
  assert.doesNotMatch((await call('view_render', {})).text, /Headless:/)
})

test('headless: the engine is linked to this server — its features, and its notices heard as a page’s', async () => {
  assert.ok(engine.attached, 'the engine was linked')
  assert.ok(engine.attached.features.includes('fea.solve'))
  assert.ok(engine.attached.features.includes('pcb.kicad'))
  const heard = new Promise((done) => link.once('notice', done))
  engine.attached.notice('demo.ask', { req: 'r1' })
  assert.deepEqual(await heard, { kind: 'demo.ask', data: { req: 'r1' } })
  // Unlinked when the link closes.
  const other = standIn()
  const otherLink = new EngineLink(other, '/where/engine.mjs', { version: '1.2.3' })
  assert.equal(other.attached.version, '1.2.3')
  otherLink.close()
  assert.equal(other.attached, null)
})

test('headless: an answer too long to carry goes to the output folder, and scanruler_read and _files reach it there', async () => {
  const long = await call('demo_long', {})
  assert.equal(long.json.truncated, true)
  assert.match(long.json.note, /scanruler_read/)
  assert.equal(dirname(long.json.file), dir)
  const part = await call('scanruler_read', { path: long.json.file, limit: 100 })
  assert.equal(part.error, false)
  assert.ok(part.json.text.startsWith('{'))
  assert.ok(part.json.nextOffset > 0)
  const listed = await call('scanruler_files', {})
  assert.equal(listed.json.folder, dir)
  assert.ok(listed.json.files.some((f) => join(dir, f.name) === long.json.file))
  const written = await call('scanruler_write', { path: 'report.md', text: '# Report\n' })
  assert.equal(written.json.path, join(dir, 'report.md'))
  assert.equal(await readFile(join(dir, 'report.md'), 'utf8'), '# Report\n')
  assert.equal((await call('scanruler_write', { path: '../out.md', text: 'x' })).error, true)
})

test('an engine is looked for where it is, and a file that is none is refused', async () => {
  await assert.rejects(loadEngine(join(dir, 'missing.mjs')), /There is no ScanRuler engine at .*missing\.mjs\. Build one with "npm run build:engine"/)
  const notOne = join(dir, 'not-an-engine.mjs')
  await writeFile(notOne, 'export const x = 1\n')
  await assert.rejects(loadEngine(notOne), /is not a ScanRuler engine/)
  const fake = join(dir, 'engine.mjs')
  await writeFile(fake, `export async function startEngine() { return { app: 'ScanRuler', version: '1.2.3', plugins: [], listCommands: () => [], pageCommands: () => [], run: async () => ({}), stop: async () => {} } }\n`)
  const started = await loadEngine(fake)
  assert.equal(started.version, '1.2.3')
  assert.ok(pathToFileURL(fake).href.startsWith('file:'))
})

test('headless and compact: the server’s own tools listed, the engine’s read through scanruler_tools and run in a batch', async () => {
  const compactLink = new EngineLink(standIn(), '/where/engine.mjs')
  const server = createMcpServer({
    link: compactLink,
    version: '0.0.0',
    cwd: dir,
    outDir: dir,
    connectHelp: () => 'No page connects to this one.',
    serverInfo: () => ({ backend: 'headless', engine: compactLink.file }),
    remembered: null,
    tools: 'compact',
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const small = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(a), small.connect(b)])
  try {
    assert.match(small.getInstructions(), /headless/)
    assert.match(small.getInstructions(), /scanruler_tools/)
    assert.deepEqual((await small.listTools()).tools.map((t) => t.name).sort(), ['scanruler_batch', 'scanruler_files', 'scanruler_open', 'scanruler_read', 'scanruler_status', 'scanruler_tools', 'scanruler_wait', 'scanruler_write'])
    const listed = JSON.parse((await small.callTool({ name: 'scanruler_tools', arguments: {} })).content[0].text)
    assert.deepEqual(Object.keys(listed.tools), ['session_state', 'demo_parameter_add', 'demo_export', 'demo_long'])
    const batch = JSON.parse((await small.callTool({ name: 'scanruler_batch', arguments: { calls: [{ tool: 'demo_parameter_add', arguments: { name: 'c1' } }, { tool: 'session_state' }] } })).content[0].text)
    assert.deepEqual(batch.results[1].result.parameters, ['c1'])
  } finally {
    await small.close()
    compactLink.close()
  }
})
