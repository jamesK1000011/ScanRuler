// SPDX-License-Identifier: AGPL-3.0-only
// The ScanRuler side of the bake-off, and the comparison: the brief through
// scanruler-mcp paired with the app in headless Chrome (as an agent drives
// it), every call measured; then Stefan's Deviation workspace compares the
// two bins both ways — FreeCAD's STL as the scan against ScanRuler's STEP as
// the reference, and ScanRuler's STL against FreeCAD's STEP — best-fit
// aligned, as a print is checked against its CAD.
//
//   APP_URL=http://localhost:4173/ node scripts/bakeoff/run-scanruler.mjs \
//     --out bakeoff-out/scanruler --freecad bakeoff-out/freecad
// Needs a build served at APP_URL (npm run build; npx vite preview), Chrome
// (CHROME), and npm --prefix mcp ci.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { launchAgent, launchApp, repoFile } from '../e2e-lib.mjs'
import { BRIEF } from './brief.mjs'
import { measured, summary } from './measure.mjs'
import { scanrulerScanJobs } from './scan-jobs.mjs'

const { values } = parseArgs({ options: { out: { type: 'string' }, freecad: { type: 'string' } } })
const out = resolve(values.out ?? 'bakeoff-out/scanruler')
const fc = resolve(values.freecad ?? 'bakeoff-out/freecad')
mkdirSync(out, { recursive: true })
if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: npm --prefix mcp ci first.')
  process.exit(1)
}
const { startAgent } = await import('../../mcp/tests/client.js')

const trace = []
const result = { side: 'scanruler', steps: {}, deviation: {} }

// What an agent reads before its first call, lean (the default) and full.
const lean = await startAgent({ args: ['--port', String(40000 + Math.floor(Math.random() * 20000)), '--tools', 'lean'], env: { SCANRULER_MCP_CONFIG_DIR: join(out, 'cfg-lean') }, stderr: 'ignore' }).catch(() => null)
if (lean) {
  const l = await lean.client.listTools()
  result.toolListLean = { tools: l.tools.length, bytes: Buffer.byteLength(JSON.stringify(l)) }
  await lean.close()
}

const { agent } = await launchAgent(startAgent)
const link = /(\S+#agent=\d+:[\w-]+)/.exec((await agent.call('scanruler_status')).json?.howToConnect ?? '')?.[1]
const { browser } = await launchApp({ url: link, protocolTimeout: 900_000 })
const call = measured(agent.call, trace, 'scanruler')
const dev = measured(agent.call, trace, 'deviation')
try {
  await agent.call('scanruler_wait', { for: 'page', timeoutSeconds: 120 })
  const t0 = performance.now()
  const list = await agent.client.listTools()
  trace.push({ side: 'scanruler', tool: 'tools/list', why: 'what the agent reads before its first call (full)', ms: Math.round(performance.now() - t0), argBytes: 0, answerBytes: Buffer.byteLength(JSON.stringify(list)), images: 0, ok: true })
  result.toolListFull = { tools: list.tools.length, bytes: Buffer.byteLength(JSON.stringify(list)) }

  // The brief, as the gen, setups, material and review guides have it.
  const m = await call('gen_measure', { generator: 'gridfinity_bin', params: BRIEF.params }, 'size before making')
  result.steps.measure = m.json?.parts?.[0]
  await call('workspace_set', { workspace: 'reverse' }, 'Reverse engineer, where the bin lands')
  const made = await call('gen_make', { generator: 'gridfinity_bin', params: BRIEF.params, name: 'Bin' }, 'make the bin')
  result.steps.made = made.json
  await call('setup_add', { type: 'print', bodies: ['Bin'], settings: { nozzle: '0.4', layerHeight: 0.2, firstLayer: 0.2 } }, 'how it is made')
  await call('material_set', { body: 'Bin', material: BRIEF.material }, 'what it is made of')
  await call('part_spec', { spec: BRIEF.spec }, 'the limits')
  let review = await call('part_review', { body: 'Bin' }, 'one verdict')
  result.steps.review = review.json
  // The lip's thin top, waived as the standard's: its finding's id.
  const id = /\b(F\d+) thin-wall\b/.exec(JSON.stringify(review.json?.findings ?? []))?.[1]
  if (id) {
    await call('dfm_waive', { id, reason: BRIEF.waiveReason }, 'the lip waived')
    review = await call('part_review', { body: 'Bin' }, 'the verdict again')
    result.steps.reviewWaived = review.json
  }
  const check = await call('reverse_body_check', { body: 'Bin' }, 'soundness, for the scorecard')
  result.steps.check = check.json?.bodies?.[0] ?? check.json
  const step = await call('reverse_export_step', { bodies: ['Bin'], path: join(out, 'bin.step') }, 'STEP')
  const stl = await call('reverse_export_stl', { bodies: ['Bin'], chord: 0.01, path: join(out, 'bin.stl') }, 'STL')
  result.files = { step: step.json?.file?.path ?? join(out, 'bin.step'), stl: stl.json?.file?.path ?? join(out, 'bin.stl') }
  const diff = await call('history_diff', {}, 'what the last change did')
  result.steps.diff = diff.json
  result.verdict = review.json?.verdict ?? null

  // Stefan's deviation tools, both ways round.
  const pairs = [
    { name: 'freecadScan_vs_scanrulerRef', scan: join(fc, 'bin.stl'), ref: result.files.step },
    { name: 'scanrulerScan_vs_freecadRef', scan: result.files.stl, ref: join(fc, 'bin.step') },
  ]
  for (const p of pairs) {
    if (!existsSync(p.scan) || !existsSync(p.ref)) {
      result.deviation[p.name] = { skipped: `missing ${existsSync(p.scan) ? p.ref : p.scan}` }
      continue
    }
    await dev('scan_open', { path: p.scan, discard: true }, `${p.name}: the scan`)
    await dev('workspace_set', { workspace: 'deviation' }, 'the Deviation workspace')
    await dev('deviation_open_reference', { path: p.ref }, `${p.name}: the reference`)
    const a = await dev('deviation_align', {}, `${p.name}: best fit`)
    result.deviation[p.name] = a.json?.deviation ?? { refused: a.text?.slice(0, 300) }
  }

  // The scan jobs, on the fixture the FreeCAD side wrote.
  const fxDir = join(fc, 'fixture')
  if (existsSync(join(fxDir, 'truth.json'))) {
    const fx = { scan: join(fxDir, 'bracket-scan.stl'), step: join(fxDir, 'bracket.step'), truth: JSON.parse(readFileSync(join(fxDir, 'truth.json'), 'utf8')) }
    try {
      result.scanJobs = await scanrulerScanJobs(measured(agent.call, trace, 'scanruler-scan'), fx)
    } catch (e) {
      result.scanJobs = { failed: String(e?.message ?? e) }
    }
  } else {
    result.scanJobs = { skipped: 'no fixture from the FreeCAD side' }
  }
} finally {
  await agent.close?.()
  await browser.close().catch(() => {})
}
result.totals = summary(trace, 'scanruler')
result.scanTotals = summary(trace, 'scanruler-scan')
console.log(`deviation: ${JSON.stringify(result.deviation)}`)
writeFileSync(join(out, 'trace.json'), JSON.stringify(trace, null, 1))
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 1))
console.log(`scanruler: ${result.totals.calls} calls, ${result.totals.refused} refused, ${result.totals.ms} ms, verdict ${result.verdict}`)
process.exit(0)
