// SPDX-License-Identifier: AGPL-3.0-only
// The scorecard: both sides' results side by side, and the deviation
// between their bins. Writes scorecard.md and scorecard.json into --out, and
// appends the Markdown to the job summary when run in GitHub Actions.
//
//   node scripts/bakeoff/score.mjs --out bakeoff-out

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { BRIEF } from './brief.mjs'

const { values } = parseArgs({ options: { out: { type: 'string' } } })
const out = resolve(values.out ?? 'bakeoff-out')
const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)
const fc = read(join(out, 'freecad', 'result.json'))
const sr = read(join(out, 'scanruler', 'result.json'))

const n = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d) : '—')
const kb = (b) => (typeof b === 'number' ? `${(b / 1024).toFixed(1)} kB` : '—')
const sizeOf = (r) => r?.steps?.measure?.size ?? null
const sizeOk = (s) => (s ? s.every((x, i) => Math.abs(x - BRIEF.expect.size[i]) <= 0.05) : null)
const volOf = (r) => r?.steps?.check?.volume ?? r?.steps?.measure?.volume ?? null
const slivers = (r) => {
  const c = r?.steps?.check
  if (!c) return null
  return (c.narrow ?? []).length
}
const sound = (r) => {
  const c = r?.steps?.check
  if (!c) return null
  return c.valid !== false && c.closed !== false && (c.solids ?? 1) === 1
}
const mass = (r) => r?.steps?.reviewWaived?.figures?.mass ?? r?.steps?.review?.figures?.mass
const wall = (r) => r?.steps?.review?.figures?.wall
const findings = (r) => (r?.steps?.review ? (r.steps.review.findings ?? []).length : '—')
const yes = (v) => (v === null || v === undefined ? '—' : v ? 'yes' : 'no')

const rows = [
  ['Server', fc?.server ? `${fc.server.name} ${fc.server.version}` : '—', 'scanruler-mcp (page mode)'],
  ['Tools the agent reads', fc ? `${fc.toolCount} tools, ${kb(fc.toolListBytes)}` : '—', sr?.toolListLean ? `lean ${sr.toolListLean.tools}, ${kb(sr.toolListLean.bytes)} · full ${sr.toolListFull?.tools}, ${kb(sr.toolListFull?.bytes)}` : sr?.toolListFull ? `full ${sr.toolListFull.tools}, ${kb(sr.toolListFull.bytes)}` : '—'],
  ['Calls for the brief', fc?.totals?.calls ?? '—', sr?.totals?.calls ?? '—'],
  ['Refused', fc?.totals?.refused ?? '—', sr?.totals?.refused ?? '—'],
  ['Time in calls', fc ? `${n(fc.totals.ms / 1000)} s` : '—', sr ? `${n(sr.totals.ms / 1000)} s` : '—'],
  ['Answer bytes read', kb(fc?.totals?.answerBytes), kb(sr?.totals?.answerBytes)],
  ['Pictures needed', fc?.totals?.images ?? '—', sr?.totals?.images ?? '—'],
  ['Size 83.5 × 41.5 × 32.4', sizeOf(fc) ? `${sizeOf(fc).join(' × ')} (${yes(sizeOk(sizeOf(fc)))})` : '—', sizeOf(sr) ? `${sizeOf(sr).join(' × ')} (${yes(sizeOk(sizeOf(sr)))})` : '—'],
  ['Volume, mm³', n(volOf(fc), 0), n(volOf(sr), 0)],
  ['Sound (valid, closed, one solid)', yes(sound(fc)), yes(sound(sr))],
  ['Sliver faces', slivers(fc) ?? '—', slivers(sr) ?? '—'],
  ['Least wall read', wall(fc) !== undefined ? `${n(wall(fc), 2)} mm` : '—', wall(sr) !== undefined ? `${n(wall(sr), 2)} mm` : '—'],
  ['Mass, PLA as printed', mass(fc) !== undefined ? `${n(mass(fc))} g` : '—', mass(sr) !== undefined ? `${n(mass(sr))} g` : '—'],
  ['Findings, first review', findings(fc), findings(sr)],
  ['Verdict, lip waived', fc?.verdict ?? '—', sr?.verdict ?? '—'],
]

const devRows = Object.entries(sr?.deviation ?? {}).map(([k, d]) => {
  const s = d?.stats ?? d?.statistics ?? d?.map ?? d
  const pick = (...keys) => keys.map((x) => s?.[x]).find((v) => typeof v === 'number')
  return [k, n(pick('rms', 'RMS'), 4), n(pick('max', 'maxAbs'), 4), n(pick('min'), 4), n(d?.align?.rms ?? d?.alignment?.rms, 4), d?.skipped ?? d?.refused ?? '']
})

const md = [
  '## Bake-off: the same Gridfinity bin, FreeCAD (Agent Link) and ScanRuler',
  '',
  `Brief: ${JSON.stringify(BRIEF.params)}, spec ${JSON.stringify(BRIEF.spec)}, ${BRIEF.material}.`,
  '',
  '| | FreeCAD + Agent Link | ScanRuler |',
  '|---|---|---|',
  ...rows.map((r) => `| ${r.join(' | ')} |`),
  '',
  '### Deviation between the two bins (ScanRuler’s Deviation workspace, best-fit)',
  '',
  '| Pair | RMS, mm | max, mm | min, mm | fit RMS, mm | note |',
  '|---|---|---|---|---|---|',
  ...(devRows.length ? devRows.map((r) => `| ${r.join(' | ')} |`) : ['| — | | | | | not run |']),
  '',
  'Raw answers: result.json and trace.json under each side in the run’s artifact.',
].join('\n')

writeFileSync(join(out, 'scorecard.md'), `${md}\n`)
writeFileSync(join(out, 'scorecard.json'), JSON.stringify({ rows, deviation: sr?.deviation ?? null }, null, 1))
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`)
console.log(md)
