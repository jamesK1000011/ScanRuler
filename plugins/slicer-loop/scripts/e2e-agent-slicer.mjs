// SPDX-License-Identifier: AGPL-3.0-only
// slicer-loop driven by an agent, end to end: scanruler-mcp started with the
// slicer extras and a ScanRuler folder of its own, stand-in OrcaSlicer and
// PrusaSlicer (mcp/tests/fakeSlicers.js) where slicers.json says, the app in
// headless Chrome paired with it. A part is opened, exported through the
// page's own export_stl, sliced with the default profiles, sliced again
// with a fit-comp correction and a coarser layer, and the two compared —
// through the tools alone.
//
// Prereqs: dev server running (npm run dev), Chrome, the server's
// dependencies (npm --prefix mcp ci).
//   node plugins/slicer-loop/scripts/e2e-agent-slicer.mjs
// Env: APP_URL, CHROME, OUT_DIR.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')
const { fakeOrca, fakePrusa } = await import('../../../mcp/tests/fakeSlicers.js')

const dir = mkdtempSync(join(tmpdir(), 'scanruler-slicer-'))
const home = join(dir, 'home')
const profiles = join(dir, 'profiles')
for (const k of ['machine', 'process', 'filament']) mkdirSync(join(profiles, k), { recursive: true })
writeFileSync(join(profiles, 'machine', 'H2D 0.4.json'), JSON.stringify({ type: 'machine', name: 'H2D 0.4' }))
writeFileSync(join(profiles, 'process', 'Standard 0.20.json'), JSON.stringify({ type: 'process', name: 'Standard 0.20', layer_height: '0.2', xy_hole_compensation: '0' }))
writeFileSync(join(profiles, 'filament', 'PETG.json'), JSON.stringify({ type: 'filament', name: 'PETG', filament_shrink: ['100%'] }))
const orca = await fakeOrca(dir)
const prusa = await fakePrusa(dir)
mkdirSync(home, { recursive: true })
writeFileSync(
  join(home, 'slicers.json'),
  JSON.stringify({
    slicers: [
      { id: 'orca', kind: 'orca', path: orca, flags: ['--slice', '--load-settings', '--load-filaments', '--outputdir', '--export-3mf'], profileDirs: [profiles], defaults: { machine: 'H2D 0.4', process: 'Standard 0.20', filament: 'PETG' } },
      { id: 'prusa', kind: 'prusa', path: prusa, flags: ['--export-gcode', '--load', '--output'], profileDirs: [] },
    ],
  }),
)
process.env.SCANRULER_MCP_EXTRAS = 'slicer'
process.env.SCANRULER_HOME = home

// A small block to slice.
const tri = (a, b, c) => [a, b, c]
const v = [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0], [0, 0, 10], [20, 0, 10], [20, 20, 10], [0, 20, 10]]
const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]].map(([a, b, c]) => tri(v[a], v[b], v[c]))
const stl = Buffer.alloc(84 + 50 * faces.length)
stl.writeUInt32LE(faces.length, 80)
faces.forEach((t, i) => t.flat().forEach((x, k) => stl.writeFloatLE(x, 84 + 50 * i + 12 + 4 * k)))
const PART = join(dir, 'block.stl')
writeFileSync(PART, stl)

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
  check(waited.json?.connected === true && waited.json.page.plugins.includes('slicer-loop'), `the page connected with slicer-loop (${waited.json?.page?.plugins})`)
  const names = (await agent.client.listTools()).tools.map((t) => t.name)
  const wanted = ['slicer_detect', 'slicer_list', 'slicer_profiles', 'slicer_slice', 'slicer_jobs', 'slicer_result', 'slicer_compare']
  check(wanted.every((n) => names.includes(n)), `the ${wanted.length} slicer tools are listed with SCANRULER_MCP_EXTRAS=slicer`)
  const guide = await ok('guide_read', { topic: 'slicer-loop' })
  check(/slicer_detect/.test(guide.text) && /SCANRULER_MCP_EXTRAS/.test(guide.text), 'guide_read serves the slicer-loop guide')
  const list = await ok('slicer_list', {})
  check(list.json?.slicers?.map((s) => s.id).join() === 'orca,prusa', `slicer_list: ${list.json?.slicers?.map((s) => s.id).join(', ')}`)
  const prof = await ok('slicer_profiles', { slicer: 'orca' })
  check(prof.json?.profiles?.map((p) => `${p.kind}:${p.name}`).sort().join() === 'filament:PETG,machine:H2D 0.4,process:Standard 0.20', 'slicer_profiles lists machine, process and filament')

  await ok('scan_open', { path: PART, discard: true })
  const exported = await ok('export_stl', { path: join(dir, 'exported') + '/' })
  const model = exported.json?.file?.path
  check(Boolean(model) && existsSync(model), `export_stl wrote ${model}`)
  const a = await ok('slicer_slice', { slicer: 'orca', model, name: 'standard' })
  check(a.json?.ok && a.json.totals.seconds === 605 && a.json.counted.layers === 5 && a.json.totals.filamentG === 3.71, `slicer_slice: ${a.json?.totals?.seconds} s, ${a.json?.totals?.filamentG} g, ${a.json?.counted?.layers} layers`)
  const b = await ok('slicer_slice', { slicer: 'orca', model, name: 'fitted', overrides: { xy_hole_compensation: 0.17, layer_height: 0.28 } })
  const proc = JSON.parse(readFileSync(join(b.json.folder, 'process.json'), 'utf8'))
  check(proc.xy_hole_compensation === '0.17' && b.json.counted.layerHeightsMm.join() === '0.28', `the overrides reach the slicer: hole ${proc.xy_hole_compensation}, layers ${b.json.counted.layerHeightsMm}`)
  const cmp = await ok('slicer_compare', { a: a.json.job, b: b.json.job })
  check(cmp.json?.heightMm?.change > 0 && cmp.json.overrides.b.xy_hole_compensation === 0.17, `slicer_compare: height ${cmp.json?.heightMm?.a} → ${cmp.json?.heightMm?.b} mm`)
  const p = await ok('slicer_slice', { slicer: 'prusa', model, overrides: { xy_size_compensation: -0.08 } })
  check(p.json?.ok && p.json.counted.layers === 3, `PrusaSlicer: ${p.json?.counted?.layers} layers, ${p.json?.totals?.seconds} s`)
  const jobs = await ok('slicer_jobs', {})
  check(jobs.json?.jobs?.length === 3, `slicer_jobs: ${jobs.json?.jobs?.length} jobs`)
  const res = await ok('slicer_result', { job: a.json.job, layers: true })
  check(res.json?.layers?.length === 5 && /not a measurement/.test(res.json.heuristic.note), 'slicer_result gives every layer and labels the heuristic')
  const bad = await call('slicer_slice', { slicer: 'orca', model, process: 'Fine 0.08' })
  check(bad.error && /slicer_profiles/.test(bad.text), 'an unknown profile is refused, pointing at slicer_profiles')
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
