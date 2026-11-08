// SPDX-License-Identifier: AGPL-3.0-only
// mass through scanruler-mcp, as an agent drives it: a 40 × 20 × 10 mm block
// comes in as a STEP and is weighed solid against ρV, then as printed with
// walls and infill; a material is named by its old id; a print on the scales
// calibrates it; a target pulls the balance point along X, the ballast pocket
// is planned and cut as Reverse Engineer features, and the part weighed again
// lands on the target. The study comes back with the project.
//
//   APP_URL=http://localhost:5173 node plugins/mass/scripts/e2e-agent-mass.mjs

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')
const { OcctKernel } = await import('occt-wasm')

const out = join(OUT_DIR, 'mass')
mkdirSync(out, { recursive: true })
const k = await OcctKernel.init()
const stepFile = join(out, 'block.step')
writeFileSync(stepFile, k.exportStep(k.makeBox(40, 20, 10)))

const { agent } = await launchAgent(startAgent)
const { call } = agent
async function ok(name, input, what) {
  const r = await call(name, input)
  if (r.error) fail(`${what ?? name}: ${r.text}`)
  return r
}
const near = (a, b, tol) => Math.abs(a - b) <= tol
const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
check(Boolean(link), `the server hands out a pairing link (${link})`)
const { browser, page, consoleErrors } = await launchApp({ url: link, protocolTimeout: 600_000 })
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 90 })
  check(waited.json?.connected === true && waited.json.page.plugins.includes('mass'), `the page connected with mass (${waited.json?.page?.plugins})`)
  const names = (await agent.client.listTools()).tools.map((t) => t.name)
  const wanted = ['mass_materials', 'mass_setup', 'mass_properties', 'mass_calibrate', 'mass_target', 'mass_ballast', 'mass_apply']
  check(wanted.every((n) => names.includes(n)), `the ${wanted.length} mass tools are listed`)
  const guide = await ok('guide_read', { topic: 'mass' })
  check(/mass\.ballast/.test(guide.text), 'guide_read serves the mass guide')

  await ok('workspace_set', { workspace: 'reverse' })
  await ok('reverse_import_step', { path: stepFile })
  const bodies = (await ok('session_state', {})).json?.plugins?.reverse?.bodies ?? []
  check(bodies.length === 1, `the block comes in as one body (${bodies.map((b) => b.name)})`)
  await ok('reverse_body_set', { body: bodies[0].name, name: 'Block' })

  const mats = await ok('mass_materials', {})
  check(mats.json?.materials?.['tpu-95a']?.density === 1.21 && mats.json.materials.pla.label === 'PLA', 'the materials are the shared table')
  const tpu = await ok('mass_setup', { material: 'tpu' })
  check(tpu.json?.setup?.material === 'tpu-95a', `tpu is taken as tpu-95a (${tpu.json?.setup?.material})`)

  await ok('mass_setup', { material: 'pla', infill: 100, walls: 2 })
  const solid = await ok('mass_properties', {})
  const b = solid.json?.bodies?.[0]
  check(near(b?.volume, 8000, 1) && near(b?.mass, 9.92, 0.01), `solid PLA block: ${b?.volume} mm³, ${b?.mass} g (ρV 9.92 g)`)
  check(b?.com && near(b.com[0], 20, 0.01) && near(b.com[1], 10, 0.01) && near(b.com[2], 5, 0.01), `its balance point is its centre (${b?.com})`)
  // Ixx about the centre: m (b² + c²) / 12, g·mm².
  check(near(b?.inertia?.[0]?.[0], (9.92 * (20 ** 2 + 10 ** 2)) / 12, 0.5), `Ixx ${b?.inertia?.[0]?.[0]} g·mm² against m(b²+c²)/12`)

  await ok('mass_setup', { infill: 15, walls: 2, lineMm: 0.42 })
  const printed = await ok('mass_properties', {})
  const pm = printed.json?.total?.mass
  check(pm > 9.92 * 0.15 && pm < 9.92 * 0.6, `printed at 15 % with two walls it weighs less (${pm} g)`)
  const cal = await ok('mass_calibrate', { grams: pm * 1.1 })
  const after = await ok('mass_properties', {})
  check(near(after.json?.total?.mass, pm * 1.1, 0.02), `calibrated to the scales: ${after.json?.total?.mass} g (×${cal.json?.scale})`)

  const target = [24, 10, 5]
  await ok('mass_target', { com: target })
  const plan = await ok('mass_ballast', { filler: 'tungsten-putty' })
  check(plan.json?.fits !== false && plan.json?.at?.[0] > 20, `a pocket on the +X side fits (${JSON.stringify(plan.json?.at)}; ${plan.json?.why ?? 'fits'})`)
  const cut = await ok('mass_apply', {})
  check(cut.json?.cut?.extrude === 'Ballast' && cut.json.cut.body === 'Block', `the pocket is cut as Reverse Engineer features (${JSON.stringify(cut.json?.cut)})`)
  const feats = (await ok('reverse_feature_list', {})).json
  check(JSON.stringify(feats).includes('Ballast'), 'Reverse Engineer lists the Ballast features')
  const now = await ok('mass_properties', {})
  check(now.json?.bodies?.[0]?.volume < 8000 - plan.json?.size?.reduce((a, x) => a * x, 1) * 0.95, `the body is smaller by the pocket (${now.json?.bodies?.[0]?.volume} mm³)`)

  await ok('workspace_set', { workspace: 'mass' })
  await page.waitForSelector('[data-test=mass-panel]', { timeout: 30_000 })
  await page.screenshot({ path: join(out, 'mass-panel.png') })

  const projectFile = join(out, 'mass.scanruler')
  await ok('project_save', { path: projectFile })
  await ok('project_load', { path: projectFile, discard: true })
  const st = await ok('session_state', {})
  check(st.json?.plugins?.mass?.setup?.infill === 15 && JSON.stringify(st.json.plugins.mass.setup.target?.com) === JSON.stringify(target), `the study comes back with the project: ${JSON.stringify(st.json?.plugins?.mass?.setup)}`)
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
