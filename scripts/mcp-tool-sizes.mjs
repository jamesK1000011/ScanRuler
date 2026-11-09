// SPDX-License-Identifier: AGPL-3.0-only
// What the MCP server's tool list costs an agent before it does any work:
// the bytes of the tools/list answer, and of the server's instructions,
// per tool mode (--tools) and per backend — the page, or headless. The
// server is the real one (mcp/src/mcp.js), driven in this process over an
// in-memory transport, so the numbers are what a client is sent.
//
//   node scripts/mcp-tool-sizes.mjs [--commands <file>] [--engine <file>]
//        [--modes full,lean,compact] [--enable reverse,scan] [--per-tool] [--json]
//
// The commands are, by default, the app's own as the server ships them
// (mcp/src/commands.json) — no plugins'. For a page with its plugins, give
// the list the server keeps from the last page that connected
// (`tools.json` in its settings folder: ~/.config/scanruler-mcp on Linux,
// ~/Library/Application Support/scanruler-mcp on a Mac) with --commands; a
// file whose JSON also has `headless`, the names of the commands that run
// headless, is measured headless too. --engine measures a built engine
// (npm run build:engine) headless. --enable: in lean mode, the list again
// after scanruler_tools has listed those groups too. --per-tool: each
// tool's bytes, largest first. Needs the server's dependencies
// (npm --prefix mcp ci). The extras (SCANRULER_MCP_EXTRAS) and Blender's
// tool are left out unless the environment asks for them.

import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { EventEmitter } from 'node:events'

const { values } = parseArgs({
  options: {
    commands: { type: 'string' },
    engine: { type: 'string' },
    modes: { type: 'string', default: 'full,lean,compact' },
    enable: { type: 'string' },
    'per-tool': { type: 'boolean' },
    json: { type: 'boolean' },
  },
})

const mcp = await import('../mcp/src/mcp.js')

const bytes = (v) => Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v), 'utf8')

/** The commands to measure, and which run headless (null: unknown). */
async function source() {
  if (values.engine) {
    const { loadEngine } = await import('../mcp/src/engine.js')
    const engine = await loadEngine(values.engine)
    const headless = engine.listCommands()
    const page = [...headless, ...engine.pageCommands().map((name) => ({ name, missing: true }))]
    return { label: `engine ${values.engine}`, page: null, headless, pageCount: page.length }
  }
  if (values.commands) {
    const read = JSON.parse(readFileSync(values.commands, 'utf8'))
    const commands = Array.isArray(read) ? read : read.commands
    const names = Array.isArray(read?.headless) ? new Set(read.headless) : null
    return { label: values.commands, page: commands, headless: names ? commands.filter((c) => names.has(c.name)) : null }
  }
  return { label: 'mcp/src/commands.json (the app without plugins)', page: mcp.SNAPSHOT, headless: null }
}

/** A link as the server takes one: a page that is there, or the engine. */
function linkOf(commands, backend) {
  const link = new EventEmitter()
  Object.assign(link, {
    backend,
    role: backend === 'headless' ? 'headless' : 'holder',
    error: null,
    connected: true,
    page: { app: 'ScanRuler', version: 'measured', origin: backend === 'headless' ? null : 'https://scanruler.com', plugins: [], viewport: backend !== 'headless', commands },
    waitForPage: async () => true,
    run: async () => ({}),
    pageCommand: () => null,
  })
  return link
}

/** The server's answers to initialize and tools/list — and, with
 *  `enable`, to the list after scanruler_tools listed those groups. */
async function measure(commands, backend, mode, enable) {
  const link = linkOf(commands, backend)
  const server = mcp.createMcpServer({
    link,
    version: 'measured',
    cwd: '/home/user/parts',
    outDir: '/home/user/parts',
    connectHelp: () => '',
    serverInfo: () => ({}),
    tools: mode,
    log: () => {},
    listWaitMs: 0,
  })
  const waiting = new Map()
  let id = 0
  const transport = {
    start: async () => {},
    close: async () => {},
    send: async (message) => {
      if (message.id !== undefined && waiting.has(message.id)) {
        waiting.get(message.id)(message)
        waiting.delete(message.id)
      }
    },
  }
  await server.connect(transport)
  const ask = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id
      waiting.set(n, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)))
      transport.onmessage({ jsonrpc: '2.0', id: n, method, params })
    })
  const init = await ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-tool-sizes', version: '1' } })
  transport.onmessage({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const { tools } = await ask('tools/list')
  const out = { mode, backend, tools: tools.length, bytes: bytes(tools), instructions: bytes(init.instructions ?? ''), perTool: tools.map((t) => [t.name, bytes(t)]).sort((a, b) => b[1] - a[1]) }
  if (enable?.length && mode === 'lean') {
    const answer = await ask('tools/call', { name: 'scanruler_tools', arguments: { enable } })
    const after = (await ask('tools/list')).tools
    out.enabled = { groups: enable, answer: bytes(answer.content?.[0]?.text ?? ''), tools: after.length, bytes: bytes(after) }
  }
  await server.close?.()
  return out
}

const src = await source()
const modes = values.modes.split(',').map((s) => s.trim()).filter(Boolean)
const enable = values.enable?.split(',').map((s) => s.trim()).filter(Boolean)
delete process.env.SCANRULER_MCP_BLENDER
const rows = []
for (const mode of modes) {
  if (src.page) rows.push(await measure(src.page, 'page', mode, enable))
  if (src.headless) rows.push(await measure(src.headless, 'headless', mode, enable))
}

if (values.json) {
  console.log(JSON.stringify({ source: src.label, commands: src.page?.length ?? src.pageCount, rows }, null, 2))
} else {
  const kb = (n) => `${(n / 1000).toFixed(1)} kB`
  console.log(`Commands: ${src.label} — ${src.page?.length ?? src.pageCount}${src.headless ? `, ${src.headless.length} of them headless` : ''}`)
  for (const r of rows) {
    console.log(`${r.backend.padEnd(8)} ${r.mode.padEnd(8)} ${String(r.tools).padStart(4)} tools ${kb(r.bytes).padStart(10)}   instructions ${kb(r.instructions)}`)
    if (r.enabled) console.log(`${''.padEnd(17)} + ${r.enabled.groups.join(',')}: ${r.enabled.tools} tools ${kb(r.enabled.bytes)} (scanruler_tools' answer ${kb(r.enabled.answer)})`)
    if (values['per-tool']) for (const [name, n] of r.perTool) console.log(`    ${String(n).padStart(7)}  ${name}`)
  }
}
