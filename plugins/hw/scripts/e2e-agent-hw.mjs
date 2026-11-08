// SPDX-License-Identifier: AGPL-3.0-only
// hw through scanruler-mcp, as an agent drives it: a 40 × 40 × 6 mm plate
// comes in as a STEP; an M3 socket-cap hole is planned into its top face and
// read back (ISO 273 medium clearance plus the printing allowance, the
// counterbore over the head), cut as Reverse Engineer features; four 6 × 2
// magnet pockets go into its underside as a rectangle; a level hole into its
// side is teardropped; a hole's size is told back from its diameter; and the
// settings come back with the project.
//
//   APP_URL=http://localhost:5173 node plugins/hw/scripts/e2e-agent-hw.mjs

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')
const { OcctKernel } = await import('occt-wasm')

const out = join(OUT_DIR, 'hw')
mkdirSync(out, { recursive: true })
const k = await OcctKernel.init()
const stepFile = join(out, 'plate.step')
writeFileSync(stepFile, k.exportStep(k.makeBox(40, 40, 6)))

const { agent } = await launchAgent(startAgent)
const { call } = agent
async function ok(name, input, what) {
  const r = await call(name, input)
  if (r.error) fail(`${what ?? name}: ${r.text}`)
  return r
}
const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol
const volume = async () => ((await ok('session_state', {})).json?.plugins?.reverse?.bodies ?? []).find((b) => b.name === 'Plate')?.volume
const facing = (n) => ({ kind: 'plane', between: [n], withinDeg: 5 })
const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
check(Boolean(link), `the server hands out a pairing link (${link})`)
const { browser, page, consoleErrors } = await launchApp({ url: link, protocolTimeout: 600_000 })
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 90 })
  check(waited.json?.connected === true && waited.json.page.plugins.includes('hw'), `the page connected with hw (${waited.json?.page?.plugins})`)
  const names = (await agent.client.listTools()).tools.map((t) => t.name)
  const wanted = ['hw_list', 'hw_set', 'hw_plan', 'hw_pattern', 'hw_apply', 'hw_check']
  check(wanted.every((n) => names.includes(n)), `the ${wanted.length} hw tools are listed`)
  const guide = await ok('guide_read', { topic: 'hw' })
  check(/hw\.plan/.test(guide.text) && /ISO 273/.test(guide.text), 'guide_read serves the hw guide')

  await ok('workspace_set', { workspace: 'reverse' })
  await ok('reverse_import_step', { path: stepFile })
  const bodies = (await ok('session_state', {})).json?.plugins?.reverse?.bodies ?? []
  check(bodies.length === 1, `the plate comes in as one body (${bodies.map((b) => b.name)})`)
  await ok('reverse_body_set', { body: bodies[0].name, name: 'Plate' })
  const v0 = await volume()

  const screws = await ok('hw_list', { kind: 'screw' })
  const m3 = screws.json?.sizes?.find((s) => s.size === 'M3')
  check(m3?.clearance?.medium === 3.4, `hw_list: M3 medium clearance 3.4 mm (${JSON.stringify(m3?.clearance)})`)

  const p = await ok('hw_plan', { kind: 'screw', size: 'M3', head: 'socket', at: { body: 'Plate', face: facing([0, 0, 1]), point: [20, 20, 6] } })
  const shaft = p.json?.steps?.find((s) => s.role === 'shaft')
  const head = p.json?.steps?.find((s) => s.role === 'head')
  check(near(shaft?.diameter, 3.6) && shaft?.to === null, `the shaft is 3.4 + 0.2 mm, through (${JSON.stringify(shaft)})`)
  check(head && head.diameter > 5.5 && head.diameter < 6.5, `the counterbore clears the 5.5 mm head (${head?.diameter} mm)`)
  check(near(await volume(), v0, 1e-6), 'planning changes nothing')
  const cut = await ok('hw_apply', {})
  check(cut.json?.features?.length >= 2 && cut.json.features.every((f) => f.status !== 'failed'), `the hole is cut as features: ${cut.json?.features?.map((f) => f.name).join(', ')}`)
  const v1 = await volume()
  check(v1 < v0 - Math.PI * 1.8 ** 2 * 6 * 0.9, `the plate lost the hole's volume (${v0} → ${v1} mm³)`)

  const mags = await ok('hw_pattern', { kind: 'magnet', size: '6x2', at: { body: 'Plate', face: facing([0, 0, -1]), point: [20, 20, 0] }, pattern: { kind: 'rectangle', width: 30, height: 30 } })
  check(mags.json?.centres?.length === 4, `four magnet pockets planned at the corners (${mags.json?.centres?.length})`)
  await ok('hw_apply', {})
  const v2 = await volume()
  check(v2 < v1 - 4 * Math.PI * 3 ** 2 * 2 * 0.9, `four pockets cut (${v1} → ${v2} mm³)`)

  const level = await ok('hw_plan', { kind: 'screw', size: 'M3', head: 'none', depth: 10, at: { body: 'Plate', point: [0, 20, 3], direction: [1, 0, 0] } })
  check(/teardrop/i.test(JSON.stringify(level.json?.steps ?? [])) || /teardrop/i.test(JSON.stringify(level.json?.notes ?? [])), 'a level hole is planned as a teardrop')

  const told = await ok('hw_check', { diameter: 3.6 })
  check(told.json?.matches?.[0]?.kind === 'screw' && told.json.matches[0].size === 'M3', `a 3.6 mm hole is an M3 clearance (${JSON.stringify(told.json?.matches?.[0])})`)
  const bad = await call('hw_plan', { kind: 'screw', size: 'M30', at: { body: 'Plate', face: facing([0, 0, 1]) } })
  check(Boolean(bad.error), `a size not in the table is refused: ${bad.text?.slice(0, 80)}`)

  await ok('hw_set', { allowance: { screw: 0.3 }, teardrop: false })
  await ok('workspace_set', { workspace: 'hw' })
  await page.waitForSelector('[data-test=hw-panel]', { timeout: 30_000 }).catch(() => fail('the Hardware panel shows'))
  await page.screenshot({ path: join(out, 'hw-panel.png') })

  const projectFile = join(out, 'hw.scanruler')
  await ok('project_save', { path: projectFile })
  await ok('project_load', { path: projectFile, discard: true })
  const s = (await ok('hw_list', { kind: 'screw' })).json?.settings
  check(s?.allowance?.screw === 0.3 && s.teardrop === false, `the settings come back with the project (${JSON.stringify(s)})`)
  check(near(await volume(), v2, 0.01), 'and the holes, as Reverse Engineer features')
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
