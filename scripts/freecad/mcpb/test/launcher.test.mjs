// SPDX-License-Identifier: LGPL-2.1-or-later
// The launcher moved to AgentLink-FreeCAD (packaging/mcpb, with its full
// test, the manifest packaging/addons.json and the pins packaging/pins) on
// 16 Nov 2026. This path keeps a copy of it so installed extensions, which
// still update from here, hop to the new channel at their next update; and
// scripts/freecad/addons.json with scripts/bakeoff/*-ref stay the old
// channel, read by launchers from before the move and as the new one's
// fallback. This checks the hop: the copy here parses, is newer than every
// launcher from before the move, updates from AgentLink-FreeCAD with this
// path as its fallback, and the old manifest and pins here are whole and
// name the same add-ons. Node only, no network.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const here = path.dirname(new URL(import.meta.url).pathname)
const repo = path.join(here, '..', '..', '..', '..')
const text = fs.readFileSync(path.join(here, '..', 'server', 'index.js'), 'utf8')
new Function('require', 'module', 'exports', '__dirname', '__filename', text.replace(/^#!.*/, ''))
const stamp = Number(/const LAUNCHER_STAMP = (\d+)/.exec(text)[1])
assert.ok(stamp >= 20261118, `stamp ${stamp}: newer than the launchers from before the move (20261117), or they never take it`)
assert.ok(text.includes('startHandedOver'), 'takes over a running launcher in-process')
const obj = (name) => new Function(`return ${new RegExp(`const ${name} = (\\{[^\\n]*\\})`).exec(text)[1]}`)()
assert.deepEqual(obj('CHANNEL'), { repo: 'AgentLink-FreeCAD', branch: 'main', launcher: 'packaging/mcpb/server/index.js' })
assert.equal(/const MANIFEST = '([^']+)'/.exec(text)[1], 'packaging/addons.json')
assert.deepEqual(obj('OLD_CHANNEL'), { repo: 'ScanRuler', branch: 'freecad-spike', launcher: 'scripts/freecad/mcpb/server/index.js', manifest: 'scripts/freecad/addons.json' })
const data = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'addons.json'), 'utf8'))
const literal = new Function(`return ${/const SOURCES = (\[[\s\S]*?\n\])/.exec(text)[1]}`)()
assert.deepEqual(data.sources.map((s) => ({ ...s, pin: s.pin.replace('scripts/bakeoff/', 'packaging/pins/') })), literal, 'the old manifest names the add-ons the launcher does')
for (const s of data.sources) {
  assert.match(s.pin, /^scripts\/bakeoff\/[a-z]+-ref$/)
  assert.match(fs.readFileSync(path.join(repo, s.pin), 'utf8').trim(), /^[0-9a-f]{40}$/, `${s.pin} holds a commit`)
}
console.log(`launcher hop copy: stamp ${stamp}, channel AgentLink-FreeCAD main, fallback here; old manifest and ${data.sources.length} pins whole`)
