// SPDX-License-Identifier: AGPL-3.0-only
// gen through scanruler-mcp, as an agent drives it: the generators listed,
// a Gridfinity bin measured against the specification, made in Reverse
// Engineer and made again under a name not taken; a baseplate; a project box
// and its lid as two bodies; a bad value refused; the bin exported as STL and
// STEP; the panel's Make clicked; and the setup back with the project.
//
//   APP_URL=http://localhost:5173 node plugins/gen/scripts/e2e-agent-gen.mjs

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile, sleep } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')

const out = join(OUT_DIR, 'gen')
mkdirSync(out, { recursive: true })

const { agent } = await launchAgent(startAgent)
const { call } = agent
async function ok(name, input, what) {
  const r = await call(name, input)
  if (r.error) fail(`${what ?? name}: ${r.text}`)
  return r
}
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol
const bodiesNow = async () => (await ok('session_state', {})).json?.plugins?.reverse?.bodies ?? []
const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
check(Boolean(link), `the server hands out a pairing link (${link})`)
const { browser, page, consoleErrors } = await launchApp({ url: link, protocolTimeout: 600_000 })
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 90 })
  check(waited.json?.connected === true && waited.json.page.plugins.includes('gen'), `the page connected with gen (${waited.json?.page?.plugins})`)
  const names = (await agent.client.listTools()).tools.map((t) => t.name)
  const wanted = ['gen_list', 'gen_set', 'gen_measure', 'gen_make', 'gen_export', 'gen_stop']
  check(wanted.every((n) => names.includes(n)), `the ${wanted.length} gen tools are listed`)
  const guide = await ok('guide_read', { topic: 'gen' })
  check(/gen\.make/.test(guide.text), 'guide_read serves the gen guide')

  const list = await ok('gen_list', {})
  check(list.json?.generators?.map((g) => g.id).join() === 'gridfinity_bin,gridfinity_baseplate,project_box', `gen_list: ${list.json?.generators?.map((g) => g.id)}`)

  const bin = { x: 1, y: 1, units: 3 }
  const m = await ok('gen_measure', { generator: 'gridfinity_bin', params: bin })
  const size = m.json?.parts?.[0]?.size
  check(size && near(size[0], 41.5) && near(size[1], 41.5) && near(size[2], 25.4, 0.1), `a 1×1×3 bin is 41.5 × 41.5 × 25.4 mm (${size})`)
  check((await bodiesNow()).length === 0, 'measuring makes nothing')

  const bad = await call('gen_make', { generator: 'gridfinity_bin', params: { x: 0 } })
  check(Boolean(bad.error) && /x/.test(bad.text), `a bin 0 cells wide is refused: ${bad.text?.slice(0, 80)}`)

  await ok('workspace_set', { workspace: 'reverse' })
  const made = await ok('gen_make', { generator: 'gridfinity_bin', params: bin })
  check(made.json?.bodies?.length === 1 && made.json.bodies[0] === 'Gridfinity bin 1x1x3', `the bin comes in as one body (${made.json?.bodies})`)
  const again = await ok('gen_make', { generator: 'gridfinity_bin', params: bin })
  check(again.json?.bodies?.[0] === 'Gridfinity bin 1x1x3 2', `made again it takes a name not taken (${again.json?.bodies})`)
  const plate = await ok('gen_make', { generator: 'gridfinity_baseplate', params: { x: 2, y: 1, magnets: false } })
  check(near(plate.json?.parts?.[0]?.size?.[0], 84) && near(plate.json.parts[0].size[2], 4.65), `a 2×1 baseplate is 84 mm long and 4.65 mm tall (${plate.json?.parts?.[0]?.size})`)
  const box = await ok('gen_make', { generator: 'project_box', params: { width: 60, depth: 40, height: 25, screws: true } })
  check(JSON.stringify(box.json?.bodies) === JSON.stringify(['Box', 'Lid']), `the box and lid come in as two bodies (${box.json?.bodies})`)
  const all = await bodiesNow()
  const boxBody = all.find((b) => b.name === 'Box')
  check(boxBody && near(boxBody.bounds.size[0], 60) && near(boxBody.bounds.size[1], 40) && near(boxBody.bounds.size[2], 25), `the box stands 60 × 40 × 25 mm (${boxBody?.bounds?.size})`)
  const check1 = await ok('reverse_body_check', { body: 'Box' })
  check(check1.json?.ok === true, `the box is a clean solid (${JSON.stringify(check1.json)?.slice(0, 100)})`)

  const stl = await ok('gen_export', { generator: 'gridfinity_bin', params: bin, format: 'stl', path: join(out, 'bin.stl') })
  const stlPath = stl.json?.file?.path
  check(Boolean(stlPath) && readFileSync(stlPath).length > 84 + 50 * 100, `gen_export wrote an STL (${stlPath})`)
  const step = await ok('gen_export', { generator: 'gridfinity_bin', params: bin, path: join(out, 'bin.step') })
  check(readFileSync(step.json?.file?.path ?? join(out, 'bin.step'), 'utf8').startsWith('ISO-10303-21;'), 'gen_export wrote a STEP')

  await ok('gen_set', { generator: 'gridfinity_bin', params: { x: 2, y: 2, units: 4, dividersX: 1 } })
  await ok('workspace_set', { workspace: 'gen' })
  await page.waitForSelector('[data-test=gen-panel]', { timeout: 30_000 })
  check((await page.$eval('[data-test=gen-x]', (e) => e.value)) === '2', 'the panel shows the values set')
  const before = (await bodiesNow()).length
  await page.click('[data-test=gen-make]')
  await page.waitForSelector('[data-test=gen-made]', { timeout: 120_000 })
  for (let i = 0; i < 60 && (await bodiesNow()).length === before; i++) await sleep(500)
  check((await bodiesNow()).some((b) => b.name === 'Gridfinity bin 2x2x4'), 'Make in the panel brings the 2×2×4 bin in')
  await page.screenshot({ path: join(out, 'gen-panel.png') })

  const projectFile = join(out, 'gen.scanruler')
  await ok('project_save', { path: projectFile })
  await ok('project_load', { path: projectFile, discard: true })
  const back = await ok('gen_list', { generator: 'gridfinity_bin' })
  check(back.json?.generators?.[0]?.values?.dividersX === 1 && (await bodiesNow()).length === before + 1, 'the values and the bodies come back with the project')
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
