// SPDX-License-Identifier: AGPL-3.0-only
// fea (Strength) through scanruler-mcp, as an agent drives it: a 100 × 10 ×
// 10 mm PLA beam comes in as a STEP, is held by its −X end and loaded at its
// +X end, and is solved by Gmsh and CalculiX on this computer against beam
// theory, printed flat and then on end; then under its own weight alone, at
// 100 g, against wL⁴/8EI — weighed as solid PLA, then as the Mass workspace
// weighs it with walls and infill. The study comes back with the project.
// Without Gmsh and CalculiX the solves are skipped and the refusal checked.
//
//   APP_URL=http://localhost:5173 node plugins/fea/scripts/e2e-agent-fea.mjs
// Env: SCANRULER_GMSH, SCANRULER_CCX where FreeCAD's or Homebrew's are not found.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')
const { OcctKernel } = await import('occt-wasm')

const out = join(OUT_DIR, 'fea')
mkdirSync(out, { recursive: true })
const k = await OcctKernel.init()
const stepFile = join(out, 'beam.step')
writeFileSync(stepFile, k.exportStep(k.makeBox(100, 10, 10)))

// Beam theory, N mm MPa: PLA in its layers 2680 MPa, across them 2160.
const I = (10 * 10 ** 3) / 12
const tip = (E) => (100 * 100 ** 3) / (3 * E * I)
const G = 9806.65
const sag = (density, g) => ((density * 1e-9 * 100 * G * g) * 100 ** 4) / (8 * 2680 * I)
const within = (got, want, tol) => Math.abs(got / want - 1) <= tol
const facing = (n) => ({ kind: 'plane', between: [n], withinDeg: 5 })

const { agent } = await launchAgent(startAgent)
const { call } = agent
async function ok(name, input, what) {
  const r = await call(name, input)
  if (r.error) fail(`${what ?? name}: ${r.text}`)
  return r
}
const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
check(Boolean(link), `the server hands out a pairing link (${link})`)
const { browser, page, consoleErrors } = await launchApp({ url: link, protocolTimeout: 1_800_000 })
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 90 })
  check(waited.json?.connected === true && waited.json.page.plugins.includes('fea'), `the page connected with fea (${waited.json?.page?.plugins})`)
  const names = (await agent.client.listTools()).tools.map((t) => t.name)
  const wanted = ['fea_tools', 'fea_setup', 'fea_hold', 'fea_load', 'fea_solve', 'fea_cancel', 'fea_results', 'fea_show', 'fea_clear']
  check(wanted.every((n) => names.includes(n)), `the ${wanted.length} fea tools are listed`)
  const guide = await ok('guide_read', { topic: 'fea' })
  check(/fea\.solve/.test(guide.text) && /gravity/.test(guide.text), 'guide_read serves the fea guide, own weight in it')

  const tools = await ok('fea_tools', {})
  check(tools.json?.materials?.pla?.density === 1.24 && tools.json.materials['tpu-95a']?.density === 1.21, 'the server’s materials carry the shared densities')

  await ok('workspace_set', { workspace: 'reverse' })
  await ok('reverse_import_step', { path: stepFile })
  const bodies = (await ok('session_state', {})).json?.plugins?.reverse?.bodies ?? []
  check(bodies.length === 1, `the beam comes in as one body (${bodies.map((b) => b.name)})`)
  await ok('reverse_body_set', { body: bodies[0].name, name: 'Beam' })

  const set = await ok('fea_setup', { body: 'Beam', build: '+z', material: 'tpu', fineness: 'medium' })
  check(set.json?.setup?.material === 'tpu-95a', `tpu is taken as tpu-95a (${set.json?.setup?.material})`)
  await ok('fea_setup', { material: 'pla' })
  await ok('fea_hold', { name: 'Wall', where: facing([-1, 0, 0]) })
  const none = await call('fea_solve', {})
  check(Boolean(none.error) && /Load it first|own weight/.test(none.text), `a study with no load is refused: ${none.text?.slice(0, 90)}`)
  await ok('fea_load', { name: 'Tip', where: facing([1, 0, 0]), force: [0, 0, -100] })

  if (!tools.json?.ready) {
    const refused = await call('fea_solve', {})
    check(Boolean(refused.error) && /FreeCAD|brew/.test(refused.text), `without Gmsh and CalculiX the solve says how to get them: ${refused.text?.slice(0, 100)}`)
    console.log('SKIP: Gmsh and CalculiX are not on this computer; the solves are not run.')
  } else {
    const flat = await ok('fea_solve', {})
    check(within(flat.json?.worst?.displacement, tip(2680), 0.05), `printed flat, the tip moves ${flat.json?.worst?.displacement} mm (beam theory ${tip(2680).toFixed(4)})`)
    check(flat.json?.worst?.mode === 'in the layers', `and fails in the layers (${flat.json?.worst?.mode})`)
    await ok('fea_setup', { build: '+x' })
    const onEnd = await ok('fea_solve', {})
    check(within(onEnd.json?.worst?.displacement, tip(2160), 0.05) && onEnd.json.worst.mode === 'layers pulled apart', `printed on end: ${onEnd.json?.worst?.displacement} mm (${tip(2160).toFixed(4)}), ${onEnd.json?.worst?.mode}`)
    check(onEnd.json?.worst?.safety < flat.json?.worst?.safety, `weaker on end (${onEnd.json?.worst?.safety} against ${flat.json?.worst?.safety})`)

    await ok('fea_setup', { build: '+z', gravity: { direction: '-z', g: 100, from: 'material' } })
    await ok('fea_load', { remove: 'Tip' })
    const own = await ok('fea_solve', {})
    const gr = own.json?.gravity
    check(Math.abs(gr?.mass - 12.4) < 0.1 && gr?.from === 'material', `own weight as solid PLA: ${gr?.mass} g, ${gr?.weight} N at 100 g`)
    check(within(own.json?.worst?.displacement, sag(1.24, 100), 0.05), `the beam sags ${own.json?.worst?.displacement} mm under its own weight (wL⁴/8EI ${sag(1.24, 100).toFixed(4)})`)

    await ok('mass_setup', { material: 'pla', infill: 20, walls: 2, lineMm: 0.42 })
    const weighed = (await ok('mass_properties', { bodies: ['Beam'] })).json?.bodies?.[0]
    await ok('fea_setup', { gravity: { from: 'mass' } })
    const asPrinted = await ok('fea_solve', {})
    const g2 = asPrinted.json?.gravity
    check(g2?.from === 'mass' && Math.abs(g2.mass - weighed?.mass) < 0.02 * weighed?.mass, `own weight as Mass weighs it: ${g2?.mass} g against ${weighed?.mass} g`)
    check(asPrinted.json?.worst?.displacement < own.json?.worst?.displacement, 'lighter as printed, so it sags less')

    await ok('fea_show', { field: 'displacement' })
    await page.waitForSelector('[data-test=fea-answer]', { timeout: 30_000 })
    await page.waitForSelector('[data-test=fea-legend]', { timeout: 30_000 })
    await ok('view_render', { path: join(out, 'beam-sag.png') })
    await page.screenshot({ path: join(out, 'fea-panel.png') })
  }

  const projectFile = join(out, 'fea.scanruler')
  await ok('project_save', { path: projectFile })
  await ok('project_load', { path: projectFile, discard: true })
  const st = (await ok('session_state', {})).json?.plugins?.fea?.setup
  check(st?.body === 'Beam' && st.holds?.length === 1 && (!tools.json?.ready || st.gravity?.from === 'mass'), `the study comes back with the project: ${JSON.stringify({ body: st?.body, holds: st?.holds?.length, gravity: st?.gravity })}`)
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
