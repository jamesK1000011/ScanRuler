// SPDX-License-Identifier: AGPL-3.0-only
// The last page's commands, kept between runs: listed before a page is back,
// so a client that lists the tools once at its start sees every one the tab
// offers; written when a page connects, with the page's version. A list
// kept from an older page than the one this server was shipped with gives
// way to the server's own, the kept page's plugin commands kept; and a
// listing waits a moment for a page that connected before.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { loadRemembered, saveRemembered } from '../src/config.js'
import { PageLink } from '../src/link.js'
import { compareVersions, createMcpServer, listBeforePage, SNAPSHOT, SNAPSHOT_OF } from '../src/mcp.js'
import { httpServer } from '../src/serve.js'
import { fakePage } from './fakePage.js'

const TOKEN = 'remembered-test-token-of-length'
const extra = { name: 'demo.thing', title: 'A plugin’s thing', description: 'Something a plugin adds to the list of commands.', input: { type: 'object', properties: {} }, readOnly: false, returnsFile: false, returnsImage: false }
const closers = []
after(() => closers.forEach((close) => close()))
const toolOf = (command) => command.name.replace(/\./g, '_')

/** A server on a fresh port with `kept` as the list kept from the last
 *  page, and a client of it. */
async function serverWith(kept, options = {}) {
  const saved = []
  const link = new PageLink({ token: TOKEN })
  const http = httpServer({})
  link.attach(http)
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve))
  closers.push(() => link.close(), () => http.close())
  const server = createMcpServer({
    link,
    version: '0.0.0',
    cwd: tmpdir(),
    outDir: tmpdir(),
    connectHelp: () => 'Pair it.',
    serverInfo: () => ({}),
    pageTimeoutMs: 50,
    remembered: { load: () => kept, save: (commands) => saved.push(commands) },
    listWaitMs: 50,
    tools: 'full',
    ...options,
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(a), client.connect(b)])
  closers.push(() => client.close())
  return { link, http, port: http.address().port, client, saved }
}

test('the kept list is read back with its page’s version and plugins, and nothing kept reads as nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scanruler-mcp-'))
  assert.equal(loadRemembered(dir), null)
  saveRemembered({ commands: [extra], version: '0.6.3', plugins: ['demo'] }, dir)
  const kept = loadRemembered(dir)
  assert.deepEqual(kept.commands, [extra])
  assert.equal(kept.version, '0.6.3')
  assert.deepEqual(kept.plugins, ['demo'])
  assert.match(kept.saved, /^\d{4}-\d\d-\d\dT/)
  // As a server before 0.4.0 kept it: no version.
  saveRemembered([extra], dir)
  assert.equal(loadRemembered(dir).version, null)
})

test('this server’s own list has the app’s version, and versions compare by their numbers', () => {
  assert.match(String(SNAPSHOT_OF.version), /^\d+\.\d+\.\d+/)
  assert.match(String(SNAPSHOT_OF.saved), /^\d{4}-\d\d-\d\dT/)
  assert.equal(compareVersions('0.6.10', '0.6.9'), 1)
  assert.equal(compareVersions('0.6.3', '0.6.3'), 0)
  assert.equal(compareVersions('0.5.2', '0.6.0'), -1)
})

test('the newer of the kept list and the server’s own is listed before a page: same version by date, plugin commands kept', () => {
  const own = [{ name: 'scan.open' }, { name: 'scan.outline' }]
  const of = { version: '0.6.3', saved: '2026-10-22T20:00:00.000Z' }
  const old = [{ name: 'scan.open', old: true }, { name: 'demo.thing' }, { name: 'other.thing' }]
  // Older by version: the server's own, with the kept page's plugins'.
  const older = listBeforePage({ commands: old, version: '0.6.0', plugins: ['demo'], saved: '2026-10-17T10:00:00.000Z' }, own, of)
  assert.deepEqual(older.commands.map((c) => c.name), ['demo.thing', 'scan.open', 'scan.outline'])
  assert.equal(older.commands.find((c) => c.name === 'scan.open').old, undefined)
  assert.match(older.from, /this server’s own list \(ScanRuler 0\.6\.3\), newer than the one kept from the last page \(ScanRuler 0\.6\.0\), and that page’s plugins’ commands \(1\)/)
  // No version (kept before 0.4.0) is the older; with no plugins named, what
  // the server's own list has no namespace for is a plugin's.
  assert.deepEqual(listBeforePage(old, own, of).commands.map((c) => c.name), ['demo.thing', 'other.thing', 'scan.open', 'scan.outline'])
  // The same version: the one written later.
  assert.equal(listBeforePage({ commands: old, version: '0.6.3', saved: '2026-10-21T10:00:00.000Z' }, own, of).commands.length, 4)
  assert.equal(listBeforePage({ commands: old, version: '0.6.3', saved: '2026-10-23T10:00:00.000Z' }, own, of).commands, old)
  // Newer by version: the kept page's own.
  assert.equal(listBeforePage({ commands: old, version: '0.7.0' }, own, of).commands, old)
  assert.equal(listBeforePage(null, own, of), null)
})

test('a server lists the last page’s commands before a page connects, and keeps the next page’s', async () => {
  // Kept from a page newer than this server's list: one more command, and
  // one whose input has changed since — the same name, another schema.
  const changed = { ...SNAPSHOT[0], input: { type: 'object', properties: { old: { type: 'string' } } } }
  const kept = { commands: [changed, ...SNAPSHOT.slice(1), extra], version: '999.0.0', plugins: ['demo'], saved: new Date().toISOString() }
  const { port, client, saved } = await serverWith(kept)
  let listChanged = 0
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    listChanged++
  })

  const listedBefore = (await client.listTools()).tools
  const before = listedBefore.map((t) => t.name)
  assert.ok(before.includes('demo_thing'), 'the kept command is listed with no page')
  assert.equal(before.length, SNAPSHOT.length + 8)
  assert.ok(listedBefore.find((t) => t.name === toolOf(SNAPSHOT[0])).inputSchema.properties.old, 'as it was kept')

  const page = await fakePage(port, { token: TOKEN, commands: SNAPSHOT })
  for (let i = 0; i < 100 && saved.length === 0; i++) await new Promise((r) => setTimeout(r, 10))
  assert.equal(saved.length, 1, 'the page’s list is kept')
  assert.equal(saved[0].commands.length, SNAPSHOT.length)
  assert.equal(saved[0].version, '0.0.0-test', 'with the page’s version')
  assert.deepEqual(saved[0].plugins, [])
  for (let i = 0; i < 100 && listChanged === 0; i++) await new Promise((r) => setTimeout(r, 10))
  assert.equal(listChanged, 1, 'the client is told the list changed')
  const listed = (await client.listTools()).tools
  const now = listed.map((t) => t.name)
  assert.ok(!now.includes('demo_thing'), 'the page’s own list replaces the kept one')
  assert.equal(listed.find((t) => t.name === toolOf(SNAPSHOT[0])).inputSchema.properties.old, undefined, 'the changed schema is the page’s now')
  page.page.close()
})

test('a list kept from an older page gives way to the server’s own, its plugin commands kept', async () => {
  // Kept on Oct 17 by a server before 0.4.0: no version, the last command
  // of today's list missing, the first one's input changed.
  const changed = { ...SNAPSHOT[0], input: { type: 'object', properties: { old: { type: 'string' } } } }
  const { client } = await serverWith([changed, ...SNAPSHOT.slice(1, -1), extra])
  const tools = (await client.listTools()).tools
  const names = tools.map((t) => t.name)
  assert.ok(names.includes(toolOf(SNAPSHOT.at(-1))), 'the server’s own list has what the kept one lacks')
  assert.ok(names.includes('demo_thing'), 'the kept page’s plugin command stays')
  assert.equal(tools.find((t) => t.name === toolOf(SNAPSHOT[0])).inputSchema.properties.old, undefined, 'the command as the server’s list has it')
  const status = JSON.parse((await client.callTool({ name: 'scanruler_status', arguments: {} })).content[0].text)
  assert.equal(status.tools, undefined, 'nothing stale with no page')
})

test('a listing waits a moment for a page that connected before, and lists its commands', async () => {
  const added = { ...extra, name: 'demo.added', title: 'Added since' }
  const { port, client } = await serverWith({ commands: [...SNAPSHOT, extra], version: '999.0.0', plugins: ['demo'] }, { listWaitMs: 2_000 })
  // The tab reconnects a little after the client lists.
  const page = new Promise((resolve) => setTimeout(() => resolve(fakePage(port, { token: TOKEN, commands: [...SNAPSHOT, added] })), 150))
  const names = (await client.listTools()).tools.map((t) => t.name)
  assert.ok(names.includes('demo_added'), 'the page’s list, not the kept one')
  assert.ok(!names.includes('demo_thing'))
  ;(await page).page.close()
})

test('with nothing kept, a listing does not wait', async () => {
  const { client } = await serverWith(null, { listWaitMs: 5_000 })
  const t = Date.now()
  const tools = (await client.listTools()).tools
  assert.ok(Date.now() - t < 1_000)
  assert.equal(tools.length, SNAPSHOT.length + 7)
})
