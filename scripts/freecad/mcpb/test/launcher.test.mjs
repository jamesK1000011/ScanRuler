// SPDX-License-Identifier: AGPL-3.0-only
// The extension's launcher against a fake FreeCAD: it serves, restarts a
// crashed FreeCAD, and agentlink_update installs new add-ons and starts
// FreeCAD again without the connection dropping. Node only.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import assert from 'node:assert/strict'

const here = path.dirname(new URL(import.meta.url).pathname)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentlink-launcher-'))
const app = path.join(root, 'FreeCAD.app')
const bin = path.join(app, 'Contents', 'Resources', 'bin')
fs.mkdirSync(bin, { recursive: true })
fs.mkdirSync(path.join(app, 'Contents', 'Resources', 'lib'), { recursive: true })
const ud = path.join(root, 'userdata')
// The real interpreter by its path: the launcher puts the fake's folder
// first on PATH, as FreeCAD's bin is.
const realPython = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim()
const server = path.join(root, 'fake_server.py')
// A fake FreeCAD Python: answers the user-folder question, else serves MCP,
// its tools saying which add-ons version it found in the Mod folder.
fs.writeFileSync(server, `
import json, os, sys
mod = os.path.join(${JSON.stringify(ud)}, 'Mod', 'AgentLink', 'VERSION')
ver = open(mod).read().strip() if os.path.exists(mod) else 'none'
for line in sys.stdin:
    m = json.loads(line)
    if 'id' not in m:
        continue
    if m.get('method') == 'initialize':
        r = {'protocolVersion': '2025-06-18', 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'fake', 'version': ver}}
    elif m.get('method') == 'tools/list':
        r = {'tools': [{'name': 'echo_' + ver.replace('.', '_'), 'inputSchema': {'type': 'object'}}]}
    elif m.get('params', {}).get('name') == 'crash':
        sys.exit(3)
    else:
        r = {'content': [{'type': 'text', 'text': ver}]}
    print(json.dumps({'jsonrpc': '2.0', 'id': m['id'], 'result': r}), flush=True)
`)
fs.writeFileSync(path.join(bin, 'python3'), `#!/bin/sh
if [ "$1" = "-c" ]; then printf '@@%s@@' ${JSON.stringify(ud)}; exit 0; fi
exec ${JSON.stringify(realPython)} ${JSON.stringify(server)}
`, { mode: 0o755 })
// The add-ons an update brings.
const fresh = path.join(root, 'fresh')
for (const n of ['AgentLink', 'ScanRulerFC']) fs.mkdirSync(path.join(fresh, n), { recursive: true })
fs.writeFileSync(path.join(fresh, 'AgentLink', 'VERSION'), '2.0\n')
fs.writeFileSync(path.join(fresh, 'VERSION'), '2.0\n')
// And the launcher itself, as GitHub serves it: #! first line and all.
fs.mkdirSync(path.join(fresh, 'launcher'), { recursive: true })
fs.copyFileSync(path.join(here, '..', 'server', 'index.js'), path.join(fresh, 'launcher', 'index.js'))

// The launcher as the extension holds it: its own folder, no package.json
// saying ES module (this repository's does).
const ext = path.join(root, 'ext', 'server')
fs.mkdirSync(ext, { recursive: true })
fs.copyFileSync(path.join(here, '..', 'server', 'index.js'), path.join(ext, 'index.js'))
fs.writeFileSync(path.join(root, 'ext', 'package.json'), '{"type": "commonjs"}\n')
const child = spawn(process.execPath, [path.join(ext, 'index.js')], {
  env: { ...process.env, HOME: root, FREECAD_APP: app, AGENTLINK_UPDATE: 'false', AGENTLINK_UPDATE_FROM: fresh, AGENTLINK_PORT: '1', AGENTLINK_OUT: path.join(root, 'out') },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let errs = ''
child.stderr.on('data', (d) => (errs += d))
const waiting = new Map()
const notes = []
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.id !== undefined && waiting.has(m.id)) {
    waiting.get(m.id)(m)
    waiting.delete(m.id)
  } else if (m.method) notes.push(m.method)
})
let n = 0
function call(method, params = {}) {
  const id = ++n
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  return new Promise((resolve, reject) => {
    waiting.set(id, resolve)
    setTimeout(() => reject(new Error(`${method} timed out\n${errs}`)), 20000)
  })
}
const tool = (name) => call('tools/call', { name, arguments: {} })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
  assert.equal(init.result.capabilities.tools.listChanged, true, 'the launcher says the tool list may change')
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  let list = await call('tools/list')
  let names = list.result.tools.map((t) => t.name)
  assert.ok(names.includes('agentlink_update'), names.join())
  assert.ok(names.includes('echo_none'), names.join())
  // A crash is answered and FreeCAD comes back.
  const crash = await tool('crash')
  assert.equal(crash.result.isError, true)
  assert.match(crash.result.content[0].text, /started again/)
  await wait(300)
  assert.equal((await tool('anything')).result.content[0].text, 'none')
  // The update: installed into the Mod folder, FreeCAD started again on it.
  const up = await tool('agentlink_update')
  const said = JSON.parse(up.result.content[0].text)
  assert.equal(up.result.isError, false, JSON.stringify(said))
  assert.equal(said.after, 'local+2.0')
  assert.equal(said.restarted, true)
  const kept = path.join(root, '.config', 'freecad-agentlink', 'launcher')
  assert.ok(fs.existsSync(path.join(kept, 'index.js')), 'the launcher was kept for the next start')
  assert.ok(fs.existsSync(path.join(kept, 'package.json')))
  await wait(500)
  assert.ok(notes.includes('notifications/tools/list_changed'), notes.join())
  list = await call('tools/list')
  names = list.result.tools.map((t) => t.name)
  assert.ok(names.includes('echo_2_0'), names.join())
  assert.equal((await tool('anything')).result.content[0].text, '2.0')
  // Again: nothing new, nothing restarted.
  const again = JSON.parse((await tool('agentlink_update')).result.content[0].text)
  assert.equal(again.restarted, false)
  console.log('launcher: serves, restarts a crash, updates without dropping the connection')
} finally {
  child.stdin.end()
  child.kill()
  fs.rmSync(root, { recursive: true, force: true })
}
