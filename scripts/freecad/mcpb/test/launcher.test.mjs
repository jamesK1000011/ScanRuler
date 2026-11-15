// SPDX-License-Identifier: AGPL-3.0-only
// The extension's launcher against a fake FreeCAD: it serves, restarts a
// crashed FreeCAD, and agentlink_update installs new add-ons and starts
// FreeCAD again without the connection dropping, and hands over to a newer
// launcher in-process, also under Claude Desktop's built-in Node. Node only.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import assert from 'node:assert/strict'

const here = path.dirname(new URL(import.meta.url).pathname)

// The launcher names no add-on beyond the data list: its built-in fallbacks
// are the lists in scripts/freecad/addons.json, field for field.
{
  const text = fs.readFileSync(path.join(here, '..', 'server', 'index.js'), 'utf8')
  const data = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'addons.json'), 'utf8'))
  const literal = (name) => new Function(`return ${new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n\\])`).exec(text)[1]}`)()
  assert.deepEqual(literal('SOURCES'), data.sources.map((s) => ({ repo: s.repo, branch: s.branch, folder: s.folder, dest: s.dest, pin: s.pin })), 'the built-in SOURCES are addons.json\'s sources')
  assert.deepEqual(literal('COMPANIONS_DEFAULT'), data.companions, 'the built-in companions are addons.json\'s companions')
}
async function launch(nodeArgs = () => []) {
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
case "$1" in *smoke.py) exec ${JSON.stringify(realPython)} "$1";; esac
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
  const child = spawn(process.execPath, [...nodeArgs(root), path.join(ext, 'index.js')], {
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
  return { root, ud, fresh, child, call, tool, notes, errs: () => errs }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

{
  const { root, ud, fresh, child, call, tool, notes, errs } = await launch()
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
  // An update whose smoke test fails: refused, the add-ons in place put
  // back, nothing restarted, the broken ones kept for a look.
  fs.writeFileSync(path.join(fresh, 'VERSION'), '3.0\n')
  fs.writeFileSync(path.join(fresh, 'AgentLink', 'VERSION'), '3.0\n')
  fs.mkdirSync(path.join(fresh, 'AgentLink', 'agentlink'), { recursive: true })
  fs.writeFileSync(path.join(fresh, 'AgentLink', 'agentlink', 'smoke.py'), 'import json\nprint(json.dumps({"ok": False, "failures": ["family cut fails to load"]}))\n')
  const bad = await tool('agentlink_update')
  assert.equal(bad.result.isError, true)
  assert.match(bad.result.content[0].text, /failed the smoke test/)
  assert.equal(fs.readFileSync(path.join(ud, 'Mod', 'AgentLink', 'VERSION'), 'utf8').trim(), '2.0')
  assert.equal((await tool('anything')).result.content[0].text, '2.0')
  const hist = JSON.parse(fs.readFileSync(path.join(root, 'AgentLink', 'versions.json'), 'utf8')).history
  assert.match(hist[hist.length - 1].outcome, /rolled back/)
  // An update that brings a new add-on folder and a newer launcher: the
  // folder installed and written down as ours, and the new launcher takes
  // over this same connection (no restart of Claude).
  fs.rmSync(path.join(fresh, 'AgentLink', 'agentlink'), { recursive: true, force: true })
  fs.writeFileSync(path.join(fresh, 'VERSION'), '4.0\n')
  fs.writeFileSync(path.join(fresh, 'AgentLink', 'VERSION'), '4.0\n')
  fs.mkdirSync(path.join(fresh, 'Extra'), { recursive: true })
  fs.writeFileSync(path.join(fresh, 'Extra', 'marker'), 'x\n')
  const newer = fs.readFileSync(path.join(here, '..', 'server', 'index.js'), 'utf8').replace("description: 'Fetch the newest", "description: 'NEWER Fetch the newest")
  assert.ok(newer.includes('NEWER'))
  fs.writeFileSync(path.join(fresh, 'launcher', 'index.js'), newer)
  const hand = await tool('agentlink_update')
  const handSaid = JSON.parse(hand.result.content[0].text)
  assert.equal(hand.result.isError, false, JSON.stringify(handSaid))
  assert.match(handSaid.launcher || '', /new launcher/)
  assert.ok(fs.existsSync(path.join(ud, 'Mod', 'Extra', 'marker')), 'the new add-on folder is installed')
  assert.ok(JSON.parse(fs.readFileSync(path.join(ud, 'Mod', 'AgentLink', '.installed-names'), 'utf8')).includes('Extra'))
  await wait(1500)
  list = await call('tools/list')
  const upd = list.result.tools.find((t) => t.name === 'agentlink_update')
  assert.match(upd.description, /^NEWER/, 'the new launcher serves')
  assert.equal((await tool('anything')).result.content[0].text, '4.0')
  console.log('launcher: serves, restarts a crash, updates without dropping the connection, rolls back a failed update, installs a new add-on, hands over to a newer launcher; its built-in lists are addons.json\'s')
} finally {
  child.stdin.end()
  child.kill()
  fs.rmSync(root, { recursive: true, force: true })
}
}

// Claude Desktop's built-in Node: Electron's helper, which refuses to start
// Node as a subprocess. The handover still happens, in the same process, and
// a newer launcher that cannot take over leaves this one serving.
{
  const refused = 'The built-in Node.js runtime cannot start "Claude Helper (Plugin)" as a Node.js subprocess (child_process.fork or process.execPath). Install Node.js and turn off "Use built-in Node.js for MCP" in Settings > Extensions > Advanced settings, or avoid spawning Node from this server.'
  const { root, ud, fresh, child, call, tool, errs } = await launch((dir) => {
    const pre = path.join(dir, 'electron.cjs')
    fs.writeFileSync(pre, `
Object.defineProperty(process.versions, 'electron', { value: '45.2.1', enumerable: true })
const cp = require('child_process')
const refused = ${JSON.stringify(refused)}
const spawn = cp.spawn
cp.fork = () => { throw new Error(refused) }
cp.spawn = (cmd, ...rest) => { if (cmd === process.execPath) throw new Error(refused); return spawn(cmd, ...rest) }
`)
    return ['--require', pre]
  })
  const desc = async () => (await call('tools/list')).result.tools.find((t) => t.name === 'agentlink_update').description
  const bump = (v, launcher) => {
    fs.writeFileSync(path.join(fresh, 'VERSION'), `${v}\n`)
    fs.writeFileSync(path.join(fresh, 'AgentLink', 'VERSION'), `${v}\n`)
    fs.writeFileSync(path.join(fresh, 'launcher', 'index.js'), launcher)
  }
  const own = fs.readFileSync(path.join(here, '..', 'server', 'index.js'), 'utf8')
  try {
    await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    assert.doesNotMatch(await desc(), /^NEWER/)
    // A newer launcher that throws as it loads: this one keeps serving, on
    // the new add-ons.
    bump('2.0', `const LAUNCHER_STAMP = 99999999\n// startHandedOver\nthrow new Error('broken on purpose')\n`)
    let said = JSON.parse((await tool('agentlink_update')).result.content[0].text)
    assert.equal(said.after, 'local+2.0', JSON.stringify(said))
    assert.match(said.launcher || '', /^kept/)
    await wait(500)
    assert.equal((await tool('anything')).result.content[0].text, '2.0')
    assert.doesNotMatch(await desc(), /^NEWER/)
    assert.match(errs(), /broken on purpose\); this one keeps serving/)
    // One that loads but fails to start: this one serves again.
    bump('3.0', `const LAUNCHER_STAMP = 99999999\nmodule.exports = { startHandedOver: async () => { throw new Error('cannot start on purpose') } }\n`)
    said = JSON.parse((await tool('agentlink_update')).result.content[0].text)
    assert.equal(said.after, 'local+3.0', JSON.stringify(said))
    await wait(800)
    assert.equal((await tool('anything')).result.content[0].text, '3.0')
    assert.doesNotMatch(await desc(), /^NEWER/)
    assert.match(errs(), /cannot start on purpose\); this one keeps serving/)
    // A good newer launcher: it takes over in this process.
    bump('4.0', own.replace("description: 'Fetch the newest", "description: 'NEWER Fetch the newest"))
    said = JSON.parse((await tool('agentlink_update')).result.content[0].text)
    assert.match(said.launcher || '', /new launcher/, JSON.stringify(said))
    await wait(1500)
    assert.match(await desc(), /^NEWER/, 'the new launcher serves')
    assert.equal((await tool('anything')).result.content[0].text, '4.0')
    assert.equal((await tool('anything')).result.content[0].text, '4.0')
    assert.match(errs(), /handed over to the updated launcher in this process .*\(electron 45\.2\.1\)/)
    assert.doesNotMatch(errs(), /cannot start "Claude Helper/)
    assert.equal(child.exitCode, null, 'still the same process')
    console.log('launcher under Claude\'s built-in Node: hands over in-process without spawning Node; a broken newer launcher leaves the old one serving')
  } finally {
    child.stdin.end()
    child.kill()
    fs.rmSync(root, { recursive: true, force: true })
  }
}
