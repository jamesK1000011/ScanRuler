// SPDX-License-Identifier: AGPL-3.0-only
// A copy relaying through another: it learns the holding copy's version
// from its welcome, and when the page says its server is out of date, the
// relaying copy's status says the holding copy is the old one — not this.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { PageLink } from '../src/link.js'
import { createMcpServer } from '../src/mcp.js'
import { PeerLink } from '../src/relay.js'
import { httpServer } from '../src/serve.js'
import { fakePage } from './fakePage.js'

const TOKEN = 'a-token-for-the-relay-tests'
const TOO_OLD = 'Your ScanRuler connector is out of date: the scanruler-mcp your AI app started is older than 0.4.0.'

/** A holding copy of the given version on a port of its own. */
const holding = async (version) => {
  const link = new PageLink({ token: TOKEN, version })
  const http = httpServer({})
  link.attach(http)
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve))
  return { link, http, port: http.address().port, close: () => (link.close(), http.close()) }
}

test('a relaying copy learns the holding copy’s version; a holder before 0.4.1 says none', async () => {
  for (const [version, read] of [['0.4.1', '0.4.1'], ['', null]]) {
    const holder = await holding(version)
    const peer = new PeerLink({ port: holder.port, token: TOKEN, version: '0.4.1' })
    assert.deepEqual(await peer.connect(), { ok: true })
    assert.equal(peer.holderVersion, read)
    const closed = new Promise((resolve) => peer.once('closed', resolve))
    peer.close()
    await closed
    holder.close()
  }
})

let holder
let page
let role = 'relay'

before(async () => {
  holder = await holding('')
  ;({ page } = await fakePage(holder.port, {
    token: TOKEN,
    answer: (name) => {
      if (name === 'session.state') return { scan: null, project: {}, serverTooOld: TOO_OLD }
      throw { code: 'unknown_command', message: name }
    },
  }))
})
after(() => {
  page.close()
  holder.close()
})

const status = async () => {
  const server = createMcpServer({
    link: holder.link,
    version: '0.4.1',
    cwd: '.',
    outDir: '.',
    connectHelp: () => 'Pair it.',
    serverInfo: () => ({ name: 'scanruler-mcp', version: '0.4.1', role, ...(role === 'relay' ? { holder: { version: null } } : {}) }),
    pageTimeoutMs: 50,
    tools: 'full',
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(a), client.connect(b)])
  const r = await client.callTool({ name: 'scanruler_status', arguments: {} })
  await client.close()
  return JSON.parse(r.content[0].text)
}

test('while relaying, the out-of-date warning names the holding copy and says to quit its app', async () => {
  role = 'relay'
  const s = await status()
  assert.equal(s.server.role, 'relay')
  assert.deepEqual(s.server.holder, { version: null })
  assert.match(s.serverTooOld, /^This server \(0\.4\.1\) is current; it sends its calls through another copy of scanruler-mcp, from before 0\.4\.1/)
  assert.match(s.serverTooOld, /quit that app completely/)
  assert.ok(s.serverTooOld.endsWith(TOO_OLD), 'the page’s own words follow')
})

test('while holding, the page’s words stand as they are', async () => {
  role = 'holder'
  const s = await status()
  assert.equal(s.serverTooOld, TOO_OLD)
  assert.equal(s.server.holder, undefined)
})
