// SPDX-License-Identifier: AGPL-3.0-only
// dfm-fdm driven by an agent, end to end: an MCP client starts
// scanruler-mcp, the app in headless Chrome is paired with it, and a plate
// with a known fault of each kind is checked through the tools alone — a
// 0.5 mm fin, a tunnel whose ceiling bridges 16 mm, a ledge held up on one
// side, a Ø1.5 hole beside a Ø4 one, a closed cavity. Each must be found
// once; the profiles must move the limits; a waiver must outlive a save and
// a reload; the report must be written.
//
// Prereqs: dev server running (npm run dev), Chrome, the server's
// dependencies (npm --prefix mcp ci).
//   node plugins/dfm-fdm/scripts/e2e-agent-dfm.mjs
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
const { Manifold } = wasm
const box = (x0, y0, z0, x1, y1, z1) => Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0])
let part = box(0, 0, 0, 60, 40, 4)
part = part.add(box(30, 20, 4, 30.5, 30, 12))
part = part.add(box(2, 14, 4, 22, 34, 12)).subtract(box(0, 16, 4, 24, 32, 10))
part = part.add(box(40, 5, 4, 46, 11, 14)).add(box(40, 5, 14, 54, 11, 16))
part = part.subtract(Manifold.cylinder(10, 0.75, 0.75, 48).translate([55, 35, -2]))
part = part.subtract(Manifold.cylinder(10, 2, 2, 48).translate([50, 30, -2]))
part = part.subtract(box(10, 3, 1, 14, 7, 3))
const g = part.refineToLength(0.6).getMesh()
const tris = g.triVerts.length / 3
const out = Buffer.alloc(84 + 50 * tris)
out.writeUInt32LE(tris, 80)
for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) out.writeFloatLE(g.vertProperties[g.triVerts[3 * t + k] * g.numProp + a], 84 + 50 * t + 12 + 12 * k + 4 * a)
const dir = mkdtempSync(join(tmpdir(), 'scanruler-dfm-'))
const PART = join(dir, 'test-plate.stl')
writeFileSync(PART, out)

const { agent } = await launchAgent(startAgent)
const { call } = agent
async function ok(name, input, what) {
  const r = await call(name, input)
  if (r.error) fail(`${what ?? name}: ${r.text}`)
  return r
}
const of = (j, rule) => (j?.findings ?? []).filter((f) => f.rule === rule)

const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
check(Boolean(link), `the server hands out a pairing link (${link})`)
const { browser, consoleErrors } = await launchApp({ url: link, protocolTimeout: 600_000 })
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 90 })
  check(waited.json?.connected === true && waited.json.page.plugins.includes('dfm-fdm'), `the page connected with dfm-fdm (${waited.json?.page?.plugins})`)
  const tools = (await agent.client.listTools()).tools
  const names = tools.map((t) => t.name)
  const wanted = ['dfm_settings', 'dfm_profiles', 'dfm_rules', 'dfm_check', 'dfm_explain', 'dfm_waive', 'dfm_report']
  check(wanted.every((n) => names.includes(n)), `the ${wanted.length} dfm tools are listed (missing: ${wanted.filter((n) => !names.includes(n)).join(', ') || 'none'})`)
  const depth = (v) => (v !== null && typeof v === 'object' ? 1 + Math.max(0, ...Object.values(v).map(depth)) : 0)
  const heavy = tools.filter((t) => t.name.startsWith('dfm_') && (JSON.stringify(t.inputSchema).length > 8000 || depth(t.inputSchema) > 12)).map((t) => t.name)
  check(heavy.length === 0, `every dfm tool’s schema within budget${heavy.length ? ` — not ${heavy.join(', ')}` : ''}`)
  const guide = await ok('guide_read', { topic: 'dfm-fdm' })
  check(/dfm\.waive/.test(guide.text) && /ledge/.test(guide.text), 'guide_read serves the dfm-fdm guide')
  const empty = await call('dfm_check', {})
  check(empty.error && /scan\.open/.test(empty.text), `dfm_check with nothing open says what to open: ${empty.text?.slice(0, 70)}`)

  // ---- the check ------------------------------------------------------------------------------
  await ok('scan_open', { path: PART, discard: true })
  const c = await ok('dfm_check', {})
  const j = c.json
  check(of(j, 'thin-wall').length === 1 && Math.abs(of(j, 'thin-wall')[0].value - 0.5) < 0.1, `thin-wall: ${JSON.stringify(of(j, 'thin-wall').map((f) => [f.value, f.at]))}`)
  check(of(j, 'bridge').length === 1 && Math.abs(of(j, 'bridge')[0].value - 16) < 0.2, `bridge: ${JSON.stringify(of(j, 'bridge').map((f) => [f.value, f.at]))}`)
  check(of(j, 'overhang').length === 1 && of(j, 'overhang')[0].at[0] > 46, `overhang (the ledge): ${JSON.stringify(of(j, 'overhang').map((f) => [f.value, f.at]))}`)
  check(of(j, 'small-hole').length === 1 && Math.abs(of(j, 'small-hole')[0].value - 1.5) < 0.1, `small-hole: ${JSON.stringify(of(j, 'small-hole').map((f) => [f.value, f.at]))}`)
  check(of(j, 'trapped-volume').length === 1 && Math.abs(of(j, 'trapped-volume')[0].value - 32) < 1, `trapped-volume: ${JSON.stringify(of(j, 'trapped-volume').map((f) => [f.value, f.at]))}`)
  check(of(j, 'mesh-health').length === 0 && of(j, 'bed-contact').length === 0 && of(j, 'tall-thin').length === 0 && !j.skipped, `nothing else found, nothing skipped (verdict: ${j?.verdict}, ${j?.errors} errors, ${j?.warnings} warnings)`)

  const thinId = of(j, 'thin-wall')[0]?.id
  const ex = await ok('dfm_explain', { id: thinId })
  check(ex.json?.rule?.setBy?.minMm === 'nozzle 0.4' && /two line widths/.test(ex.json.rule.source), `dfm_explain ${thinId}: minMm ${ex.json?.rule?.params?.minMm} set by ${ex.json?.rule?.setBy?.minMm}`)

  // ---- profiles and the project's own rules ---------------------------------------------------
  await ok('dfm_settings', { nozzle: '0.2', material: 'petg', printer: 'corexy' })
  const fine = await ok('dfm_check', { only: ['thin-wall', 'overhang'] })
  check(of(fine.json, 'thin-wall').length === 0 && fine.json.profiles.join() === 'nozzle 0.2,material petg,printer corexy,project', `a 0.2 mm nozzle prints the 0.5 mm fin (profiles ${fine.json?.profiles?.join(', ')})`)
  await ok('dfm_settings', { nozzle: '0.4', material: null, printer: null })
  const set = await ok('dfm_rules', { action: 'set', rule: 'bridge', params: { maxMm: 20 } })
  check(set.json?.rules?.find((x) => x.id === 'bridge')?.setBy?.maxMm === 'project', 'dfm_rules set: the project’s bridge limit')
  const loose = await ok('dfm_check', { only: ['bridge'] })
  check(of(loose.json, 'bridge').length === 0, 'with a 20 mm bridge limit the 16 mm tunnel passes')
  const bad = await call('dfm_rules', { action: 'set', rule: 'bridge', params: { maxSpan: 3 } })
  check(bad.error && /maxMm/.test(bad.text), 'an unknown parameter is refused with the ones there are')
  await ok('dfm_rules', { action: 'clear', rule: 'bridge' })

  // ---- waivers, the report, the project -------------------------------------------------------
  const again = await ok('dfm_check', {})
  const hole = of(again.json, 'small-hole')[0]
  await ok('dfm_waive', { id: hole.id, reason: 'Drilled to 1.5 mm after printing.' })
  const third = await ok('dfm_check', {})
  check(of(third.json, 'small-hole')[0]?.waived === 'Drilled to 1.5 mm after printing.' && third.json.waived === 1, 'the waived hole comes back waived at the next check')
  const rep = await ok('dfm_report', { format: 'md', path: OUT_DIR })
  const md = readFileSync(rep.json.file.path, 'utf8')
  check(/Printability check: test-plate\.stl/.test(md) && /Drilled to 1\.5 mm/.test(md) && /\| F\d \| error \| thin-wall/.test(md), `dfm_report wrote ${rep.json?.file?.path}`)
  const projectFile = join(dir, 'plate-dfm.scanruler')
  await ok('project_save', { path: projectFile })
  await ok('project_load', { path: projectFile, discard: true })
  const after = await ok('dfm_check', {})
  check(of(after.json, 'small-hole')[0]?.waived && after.json.waived === 1, 'the waiver comes back with the project')
  const st = await ok('session_state', {})
  check(st.json?.plugins?.dfm?.last?.errors >= 1 && st.json.plugins.dfm.waivers === 1, `session_state: ${JSON.stringify(st.json?.plugins?.dfm)}`)
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
