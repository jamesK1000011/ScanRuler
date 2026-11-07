// SPDX-License-Identifier: AGPL-3.0-only
// wear-repair driven by an agent, end to end: scanruler-mcp and the app in
// headless Chrome paired with it. A symmetric block worn 0.5 mm on one side
// is read against its own mirrored other half and repaired, and the repair
// read again; then a block printed 1 % long in X is pre-warped from its
// scan, the pre-warped model "printed" the same way, and the second run
// must come out within the tolerance and say stop — through the tools
// alone.
//
// Prereqs: dev server running (npm run dev), Chrome, the server's
// dependencies (npm --prefix mcp ci).
//   node plugins/wear-repair/scripts/e2e-agent-wear.mjs
// Env: APP_URL, CHROME, OUT_DIR.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Module from 'manifold-3d'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')

const wasm = await Module()
wasm.setup()
const g = wasm.Manifold.cube([40, 20, 10]).translate([-20, -10, 0]).refineToLength(0.5).getMesh()
const base = []
for (let i = 0; i < g.vertProperties.length / g.numProp; i++) base.push([g.vertProperties[i * g.numProp], g.vertProperties[i * g.numProp + 1], g.vertProperties[i * g.numProp + 2]])
function stl(verts) {
  const tris = g.triVerts.length / 3
  const b = Buffer.alloc(84 + 50 * tris)
  b.writeUInt32LE(tris, 80)
  for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) verts[g.triVerts[3 * t + k]].forEach((c, a) => b.writeFloatLE(c, 84 + 50 * t + 12 + 12 * k + 4 * a))
  return b
}
const readStl = (path) => {
  const b = readFileSync(path)
  const n = b.readUInt32LE(80)
  const out = []
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) out.push([0, 1, 2].map((a) => b.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * a)))
  return out
}
const dir = mkdtempSync(join(tmpdir(), 'scanruler-wear-'))
const WORN = join(dir, 'worn-block.stl'), TARGET = join(dir, 'target-block.stl'), PRINT1 = join(dir, 'print-1.stl')
writeFileSync(WORN, stl(base.map(([x, y, z]) => [x, y, z > 9.999 && x > 12 && x < 18 && Math.abs(y) < 5 ? z - 0.5 : z])))
writeFileSync(TARGET, stl(base))
writeFileSync(PRINT1, stl(base.map(([x, y, z]) => [x * 1.01, y, z])))

const { agent } = await launchAgent(startAgent)
const { call } = agent
async function ok(name, input, what) {
  const r = await call(name, input)
  if (r.error) fail(`${what ?? name}: ${r.text}`)
  return r
}
const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
check(Boolean(link), `the server hands out a pairing link (${link})`)
const { browser, consoleErrors } = await launchApp({ url: link, protocolTimeout: 600_000 })
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 90 })
  check(waited.json?.connected === true && waited.json.page.plugins.includes('wear-repair'), `the page connected with wear-repair (${waited.json?.page?.plugins})`)
  const names = (await agent.client.listTools()).tools.map((t) => t.name)
  const wanted = ['wear_settings', 'wear_tag', 'wear_reference', 'wear_diff', 'wear_rebuild', 'wear_prewarp']
  check(wanted.every((n) => names.includes(n)), `the ${wanted.length} wear tools are listed`)
  const guide = await ok('guide_read', { topic: 'wear-repair' })
  check(/wear\.prewarp/.test(guide.text) && /keep/.test(guide.text), 'guide_read serves the wear-repair guide')

  // ---- repair from the other half ---------------------------------------------------------
  await ok('scan_open', { path: WORN, discard: true })
  await ok('wear_reference', { source: 'mirror', plane: 'x' })
  await ok('wear_tag', { name: 'top right', kind: 'worn', region: { kind: 'box', min: [11, -6, 8], max: [19, 6, 11] } })
  const d = await ok('wear_diff', {})
  check(Math.abs(d.json?.regions?.[0]?.lost + 0.5) < 0.01 && d.json.regions[0].pointsLost > 50, `wear_diff: lost ${d.json?.regions?.[0]?.lost} mm over ${d.json?.regions?.[0]?.pointsLost} points`)
  const rb = await ok('wear_rebuild', { path: OUT_DIR })
  const fixedPath = rb.json?.file?.path
  check(Boolean(fixedPath) && rb.json.after[0].pointsLost === 0 && rb.json.moved > 50, `wear_rebuild wrote ${fixedPath}: ${rb.json?.moved} points moved, lost after ${rb.json?.after?.[0]?.lost}`)
  const fixed = readStl(fixedPath)
  const worst = Math.max(...fixed.filter(([x, y, z]) => x > 12 && x < 18 && Math.abs(y) < 5 && z > 9).map(([, , z]) => Math.abs(z - 10)))
  check(worst < 0.01, `the repaired top is flat again: worst ${worst.toFixed(4)} mm off`)

  // ---- pre-warp ---------------------------------------------------------------------------
  await ok('scan_open', { path: PRINT1, discard: true })
  await ok('deviation_open_reference', { path: TARGET })
  await ok('deviation_align', {})
  const p1 = await ok('wear_prewarp', { path: OUT_DIR, fresh: true })
  check(p1.json?.run === 1 && p1.json.rms > 0.05 && p1.json.stop === false, `wear_prewarp run 1: ${p1.json?.rms} mm RMS, largest ${p1.json?.largest} — ${p1.json?.why}`)
  const warped = readStl(p1.json.file.path)
  // Print the pre-warped model the same way: 1 % long in X.
  const tris = warped.length / 3
  const b = Buffer.alloc(84 + 50 * tris)
  b.writeUInt32LE(tris, 80)
  warped.forEach(([x, y, z], i) => [x * 1.01, y, z].forEach((c, a) => b.writeFloatLE(c, 84 + 50 * Math.floor(i / 3) + 12 + 12 * (i % 3) + 4 * a)))
  const PRINT2 = join(dir, 'print-2.stl')
  writeFileSync(PRINT2, b)
  await ok('scan_open', { path: PRINT2, discard: true })
  await ok('deviation_align', {})
  const p2 = await ok('wear_prewarp', { path: OUT_DIR })
  check(p2.json?.run === 2 && p2.json.rms < 0.2 * p1.json.rms && p2.json.stop === true, `run 2: ${p2.json?.rms} mm RMS — stop: ${p2.json?.why}`)

  const projectFile = join(dir, 'wear.scanruler')
  await ok('project_save', { path: projectFile })
  await ok('project_load', { path: projectFile, discard: true })
  const st = await ok('session_state', {})
  check(st.json?.plugins?.wear?.tags?.[0]?.name === 'top right' && st.json.plugins.wear.runs.length === 2, `the regions and runs come back with the project: ${JSON.stringify(st.json?.plugins?.wear?.runs)}`)
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
