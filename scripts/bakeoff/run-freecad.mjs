// SPDX-License-Identifier: AGPL-3.0-only
// The FreeCAD side of the bake-off: the brief through the Agent Link
// server headless, as an agent would call it, every call measured. Writes
// trace.json, result.json and the bin as STEP and STL into --out.
//
//   node scripts/bakeoff/run-freecad.mjs --out bakeoff-out/freecad [--python python]
// The Python must import FreeCAD (conda-forge's freecad, or FREECAD_LIB set).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { BRIEF } from './brief.mjs'
import { measured, stdioClient, summary } from './measure.mjs'

const { values } = parseArgs({ options: { out: { type: 'string' }, python: { type: 'string' } } })
const out = resolve(values.out ?? 'bakeoff-out/freecad')
mkdirSync(out, { recursive: true })
const trace = []
const server = resolve('freecad/AgentLink/agentlink_headless.py')
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
  let review = await call('part_review', { body: 'Bin', spec: BRIEF.spec, material: BRIEF.material }, 'one verdict')
  result.steps.review = review.json
  const thin = (review.json?.findings ?? []).find((f) => f.source === 'wall' && f.severity === 'error')
  if (thin?.at) {
    review = await call('part_review', { body: 'Bin', spec: BRIEF.spec, material: BRIEF.material, waive: [{ at: thin.at, reason: BRIEF.waiveReason }] }, 'the lip waived')
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
} finally {
  c.close()
}
result.totals = summary(trace, 'freecad')
writeFileSync(join(out, 'trace.json'), JSON.stringify(trace, null, 1))
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 1))
console.log(`freecad: ${result.totals.calls} calls, ${result.totals.refused} refused, ${result.totals.ms} ms, verdict ${result.verdict}`)
