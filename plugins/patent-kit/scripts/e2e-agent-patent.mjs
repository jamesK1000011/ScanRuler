// SPDX-License-Identifier: AGPL-3.0-only
// patent-kit through scanruler-mcp, as an agent drives it: a plate with a
// pin built in Reverse Engineer, figures planned with a section, numerals
// given to the bodies and to a face, the sheets drawn and looked at, the
// 1.84 checklist read, a draft written with numeral tokens, a body renamed
// and the draft following, and the kit saved to disk as a zip. The page is
// watched the whole time for any request off this machine.
//
//   APP_URL=http://localhost:5173 node plugins/patent-kit/scripts/e2e-agent-patent.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')

function boxStl(sx, sy, sz) {
  const v = (x, y, z) => [x * sx, y * sy, z * sz]
  const q = [
    [v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)],
    [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)],
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)],
    [v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)],
    [v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)],
    [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)],
  ]
  const tris = q.flatMap(([a, b, c, d]) => [
    [a, b, c],
    [a, c, d],
  ])
  const buf = Buffer.alloc(84 + tris.length * 50)
  buf.writeUInt32LE(tris.length, 80)
  tris.forEach((t, i) => t.forEach((p, j) => p.forEach((x, k) => buf.writeFloatLE(x, 84 + i * 50 + 12 + j * 12 + k * 4))))
  return buf
}

mkdirSync(OUT_DIR, { recursive: true })
const scan = join(OUT_DIR, 'patent-plate.stl')
writeFileSync(scan, boxStl(60, 20, 8))
const out = join(OUT_DIR, 'patent-kit')
mkdirSync(out, { recursive: true })

const { agent } = await launchAgent(startAgent)
const { call } = agent
async function ok(name, input, what) {
  const r = await call(name, input)
  if (r.error) fail(`${what ?? name}: ${r.text}`)
  return r
}
const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
check(Boolean(link), `the server hands out a pairing link (${link})`)
const { browser, page, consoleErrors } = await launchApp({ url: link, protocolTimeout: 600_000 })
const offMachine = []
const local = (u) => /^(data:|blob:|about:|chrome|devtools)/.test(u) || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(u).hostname)
page.on('request', (r) => {
  if (!local(r.url())) offMachine.push(r.url())
})
for (const w of page.workers?.() ?? []) w.on?.('request', (r) => !local(r.url()) && offMachine.push(r.url()))
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 90 })
  check(waited.json?.connected === true && waited.json.page.plugins.includes('patent-kit'), `the page connected with patent-kit (${waited.json?.page?.plugins})`)
  const names = (await agent.client.listTools()).tools.map((t) => t.name)
  const wanted = ['patent_settings', 'patent_figures', 'patent_numerals', 'patent_render', 'patent_check', 'patent_draft', 'patent_save']
  check(wanted.every((n) => names.includes(n)), `the ${wanted.length} patent tools are listed`)
  const guide = await ok('guide_read', { topic: 'patent-kit' })
  check(/attorney/.test(guide.text) && /90 FR 54636/.test(guide.text) && /Everything stays here/.test(guide.text), 'guide_read serves the patent-kit guide')

  await ok('scan_open', { path: scan, discard: true })
  await ok('workspace_set', { workspace: 'reverse' })
  await call('scanruler_wait', { for: 'idle', timeoutSeconds: 120 })
  await ok('reverse_feature_add', { feature: { kind: 'sketch', name: 'Plate sketch', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [30, 10], size: [60, 20], fixed: true }] } }, detail: 'none' })
  await ok('reverse_feature_add', { feature: { kind: 'extrude', name: 'Plate', sketchId: 'Plate sketch', regions: 'all', extent: { kind: 'distance', from: 0, to: 8 }, op: 'new' }, detail: 'none' })
  await ok('reverse_feature_add', { feature: { kind: 'sketch', name: 'Pin sketch', plane: { kind: 'world', axis: 'z', offset: 8 }, sketch: { entities: [{ id: 1, kind: 'circle', c: [30, 10], r: 4 }] } }, detail: 'none' })
  await ok('reverse_feature_add', { feature: { kind: 'extrude', name: 'Pin', sketchId: 'Pin sketch', regions: 'all', extent: { kind: 'distance', from: 0, to: 16 }, op: 'new' }, detail: 'none' })
  const built = (await ok('session_state', {})).json?.plugins?.reverse?.bodies ?? []
  const plateId = built[0]?.id
  const pinId = built[1]?.id
  check(built.length === 2 && built[1].bounds?.min?.[2] === 8, `the plate and the pin build: ${JSON.stringify(built.map((b) => [b.name, b.bounds?.size]))}`)
  await ok('reverse_body_set', { body: plateId, name: 'Base plate' })
  await ok('reverse_body_set', { body: pinId, name: 'Locating pin' })
  const state = await ok('session_state', {})
  const bodies = state.json?.plugins?.reverse?.bodies?.map((b) => b.name) ?? []
  check(bodies.includes('Base plate') && bodies.includes('Locating pin'), `two named bodies to draw: ${bodies.join(', ')}`)

  await ok('patent_settings', { title: 'the fixture', paper: 'letter', figuresPerSheet: 2 })
  const plan = await ok('patent_figures', { plan: 'standard' })
  check(plan.json?.figures?.length === 5 && plan.json.figures[4].kind === 'exploded', `plan "standard" with two bodies: ${plan.json?.figures?.map((f) => f.kind + ':' + f.view).join(', ')}`)
  const topId = plan.json.figures.find((f) => f.view === 'top').id
  const sec = await ok('patent_figures', { add: [{ id: 'cut', kind: 'section', view: 'front', section: { axis: 'y', offset: 10, keep: 'above', from: topId }, caption: 'through the pin' }] })
  check(/FIG\. 6 is a cross-sectional view taken along line 6–6 of FIG\. 3 of the fixture, through the pin\./.test(sec.json?.brief ?? ''), `the brief description names the section: ${sec.json?.brief?.split('\n').at(-1)}`)

  const nums = await ok('patent_numerals', { assign: 'bodies', set: [{ label: 'end face', at: [60, 10, 4], body: 'Base plate' }] })
  check(JSON.stringify(nums.json?.numerals?.map((n) => [n.n, n.label])) === JSON.stringify([[10, 'Base plate'], [12, 'Locating pin'], [14, 'end face']]), `numerals 10, 12, 14: ${JSON.stringify(nums.json?.numerals?.map((n) => [n.n, n.label]))}`)

  const s1 = await ok('patent_render', { sheet: 1, path: join(out, 'sheet-1.png') })

  check(s1.images?.length === 1 && s1.json?.sheets === 3 && s1.json.figures.length === 2, `patent_render shows sheet 1 of ${s1.json?.sheets} as a picture (${s1.images?.length} image)`)
  check(s1.json?.figures?.[0]?.numerals?.length === 3, `FIG. 1 carries all three numerals: ${JSON.stringify(s1.json?.figures?.[0]?.numerals)}`)
  check((s1.json?.notShown ?? []).some((m) => m.figure === 2 && m.n === 14), `the end face can't be seen from the front, and it says so: ${JSON.stringify(s1.json?.notShown?.find((m) => m.n === 14))}`)
  const svg = await ok('patent_render', { sheet: 3, format: 'svg', path: join(out, 'sheet-3.svg') })
  const svgText = readFileSync(join(out, 'sheet-3.svg'), 'utf8')
  check(/FIG\. 6/.test(svgText) && !/#(?!000000|ffffff)[0-9a-f]{6}/.test(svgText), 'the section sheet is black on white, FIG. 6 on it')
  check(svg.json?.figures?.some((f) => f.id === 'cut'), 'the section is drawn')

  const chk = await ok('patent_check', {})
  check(chk.json?.summary?.errors === 0, `no 1.84 errors: ${JSON.stringify(chk.json?.findings?.filter((f) => f.level === 'error'))}`)
  check(chk.json?.findings?.some((f) => /in the drawings but not in the description/.test(f.message)), 'it flags numerals the description does not mention yet')

  await ok('patent_draft', { generate: 'drawings' })
  await ok('patent_draft', { section: 'detailed', text: 'Referring to FIG. 1, the fixture comprises a [[10]] carrying a [[12]]. The [[12#]] stands up from the [[10]], and the [[14]] faces outward.' })
  const bad = await call('patent_draft', { section: 'summary', text: 'A [[40]].' })
  check(bad.error && /No numeral 40/.test(bad.text), 'a token with no numeral is refused')
  const chk2 = await ok('patent_check', {})
  check(!chk2.json?.findings?.some((f) => /not in the description/.test(f.message)), 'every numeral drawn is now in the description')

  await ok('reverse_body_set', { body: pinId, name: 'Dowel' })
  const after = await ok('patent_draft', { section: 'detailed' })
  check(/carrying a Dowel 12\. The 12 stands up/.test(after.json?.section?.reads ?? ''), `the pin renamed Dowel in Reverse Engineer, the draft follows: ${after.json?.section?.reads}`)

  const saved = await ok('patent_save', { path: join(out, 'patent-kit.zip') })
  const zip = readFileSync(join(out, 'patent-kit.zip'))
  check(zip.readUInt32LE(0) === 0x04034b50 && saved.json?.files?.includes('patent-drawings.pdf') && saved.json.files.includes('patent-draft.md'), `patent_save writes the zip: ${saved.json?.files?.join(', ')}`)
  const md = await ok('patent_save', { format: 'md', path: join(out, 'patent-draft.md') })
  const mdText = readFileSync(join(out, 'patent-draft.md'), 'utf8')
  check(/DRAFT — for attorney review/.test(mdText) && /\| 12 \| Dowel \|/.test(mdText), 'the draft is marked for attorney review, its numeral table current')
  check(Boolean(md), 'the Markdown alone saves too')

  const projectFile = join(OUT_DIR, 'patent.scanruler')
  await ok('project_save', { path: projectFile })
  await ok('project_load', { path: projectFile, discard: true })
  const st = await ok('session_state', {})
  check(st.json?.plugins?.patent?.figures === 6 && st.json.plugins.patent.numerals === 3 && st.json.plugins.patent.draftSections.includes('detailed'), `the figures, numerals and draft come back with the project: ${JSON.stringify(st.json?.plugins?.patent)}`)
  check(offMachine.length === 0, `nothing left this machine (${offMachine.length} requests off it${offMachine.length ? `: ${offMachine.slice(0, 3).join(', ')}` : ''})`)
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
