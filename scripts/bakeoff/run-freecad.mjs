// SPDX-License-Identifier: AGPL-3.0-only
// The FreeCAD side of the bake-off: the brief through the Agent Link
// server headless, as an agent would call it, every call measured. Writes
// trace.json, result.json and the bin as STEP and STL into --out.
//
//   node scripts/bakeoff/run-freecad.mjs --out bakeoff-out/freecad [--python python] [--addon <AgentLink folder>]
// The add-on comes from the FreeCAD fork (jamesK1000011/FreeCAD, branch
// agent-link, src/Mod/AgentLink); the workflow checks it out into freecad-addon/.
// The Python must import FreeCAD (conda-forge's freecad, or FREECAD_LIB set).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { BRIEF } from './brief.mjs'
import { measured, stdioClient, summary } from './measure.mjs'
import { freecadScanJobs } from './scan-jobs.mjs'

const { values } = parseArgs({ options: { out: { type: 'string' }, python: { type: 'string' }, addon: { type: 'string' } } })
const out = resolve(values.out ?? 'bakeoff-out/freecad')
mkdirSync(out, { recursive: true })
const trace = []
// The scan jobs' fixture, for this side and ScanRuler's (it reads it from here).
const fxDir = join(out, 'fixture')
spawnSync(values.python ?? 'python', [resolve('scripts/bakeoff/scan_fixture.py'), fxDir], { stdio: 'inherit' })
const fx = existsSync(join(fxDir, 'truth.json'))
  ? { scan: join(fxDir, 'bracket-scan.stl'), step: join(fxDir, 'bracket.step'), truth: JSON.parse(readFileSync(join(fxDir, 'truth.json'), 'utf8')) }
  : null
const server = resolve(values.addon ?? 'freecad-addon/src/Mod/AgentLink', 'agentlink_headless.py')
const c = await stdioClient({ command: values.python ?? 'python', args: [server, '--out', out], stderrFile: join(out, 'server.log') })
const result = { side: 'freecad', server: c.init.serverInfo, steps: {} }
try {
  const t0 = performance.now()
  const list = await c.listTools()
  trace.push({ side: 'freecad', tool: 'tools/list', why: 'what the agent reads before its first call', ms: Math.round(performance.now() - t0), argBytes: 0, answerBytes: Buffer.byteLength(JSON.stringify(list)), images: 0, ok: true })
  result.toolCount = list.tools.length
  result.toolListBytes = Buffer.byteLength(JSON.stringify(list)) + Buffer.byteLength(c.init.instructions ?? '')
  const call = measured(c.call, trace, 'freecad')

  const m = await call('gen_make', { params: BRIEF.params, measure: true }, 'size before making')
  result.steps.measure = m.json?.parts?.[0]
  const made = await call('gen_make', { params: BRIEF.params, name: 'Bin' }, 'make the bin')
  result.steps.made = made.json
  await call('setup', { action: 'add', type: 'print', bodies: ['Bin'], settings: { nozzle: 0.4, layerHeight: 0.2, firstLayer: 0.2 } }, 'how it is made')
  await call('part_spec', { spec: BRIEF.spec, material: BRIEF.material }, 'the limits and the material')
  let review = await call('part_review', { body: 'Bin' }, 'one verdict')
  result.steps.review = review.json
  // The lip's thin runs, waived in the one call: the lip stands above the
  // bin's height (units x 7 mm), so a thin run up there is the lip.
  const lipZ = BRIEF.params.units * 7
  const lip = (review.json?.findings ?? []).filter((f) => /thin-wall/.test(f.says) && f.at?.[2] >= lipZ)
  if (lip.length) {
    review = await call('part_review', { body: 'Bin', waive: lip.map((f) => ({ rule: 'thin-wall', at: f.at, reason: BRIEF.waiveReason })) }, 'the lip waived')
    result.steps.reviewWaived = review.json
  }
  const check = await call('body_check', { body: 'Bin' }, 'soundness, for the scorecard')
  result.steps.check = check.json
  const step = await call('export_file', { body: 'Bin', format: 'step', path: join(out, 'bin.step') }, 'STEP')
  const stl = await call('export_file', { body: 'Bin', format: 'stl', path: join(out, 'bin.stl'), tolerance: 0.01 }, 'STL')
  result.files = { step: step.json?.path, stl: stl.json?.path, stepVerify: step.json?.verify, stlVerify: stl.json?.verify }
  const diff = await call('history_diff', { since: 0 }, 'what the session did')
  result.steps.diff = diff.json
  result.verdict = review.json?.verdict ?? null
  if (fx) {
    try {
      result.scanJobs = await freecadScanJobs(measured(c.call, trace, 'freecad-scan'), fx)
    } catch (e) {
      result.scanJobs = { failed: String(e?.message ?? e) }
    }
  }
} finally {
  c.close()
}
result.totals = summary(trace, 'freecad')
result.scanTotals = summary(trace, 'freecad-scan')
writeFileSync(join(out, 'trace.json'), JSON.stringify(trace, null, 1))
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 1))
console.log(`freecad: ${result.totals.calls} calls, ${result.totals.refused} refused, ${result.totals.ms} ms, verdict ${result.verdict}`)
