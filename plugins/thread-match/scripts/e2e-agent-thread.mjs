// SPDX-License-Identifier: AGPL-3.0-only
// thread-match driven by an agent, end to end: an MCP client starts
// scanruler-mcp, the app in headless Chrome is paired with it, and threads
// are named through the tools alone. Two scanned rods are made here: an
// M8×1.25 boss, which must match, and an M5×0.8, which a scan can't tell
// from #10-32 UNF — it must come back ambiguous with calipers on the crests
// as the deciding measurement. The answer is pinned on the part as a note.
//
// Prereqs: dev server running (npm run dev), Chrome, the server's
// dependencies (npm --prefix mcp ci).
//   node plugins/thread-match/scripts/e2e-agent-thread.mjs
// Env: APP_URL, CHROME, OUT_DIR.
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')

// ---- a threaded rod as a scanner would mesh it: Z 0 to length, the 60° form, rounded ----------
function rod({ major, pitch, length, noise = 0.015, blur = 0.08, seed = 3 }) {
  const depth = (5 / 8) * (Math.sqrt(3) / 2) * pitch
  const wf = depth * Math.tan(Math.PI / 6)
  const flat = (pitch - 2 * wf) / 2
  const tooth = (u) => {
    const x = ((u % pitch) + pitch) % pitch
    if (x < flat) return 0
    if (x < flat + wf) return ((x - flat) / wf) * depth
    if (x < 2 * flat + wf) return depth
    return depth - ((x - 2 * flat - wf) / wf) * depth
  }
  const smooth = (u) => {
    let s = 0
    for (let k = -3; k <= 3; k++) s += tooth(u + (k / 6) * blur)
    return s / 7
  }
  let s = seed
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  const COLS = 240, rows = Math.ceil((length / pitch) * 24)
  const v = []
  for (let j = 0; j <= rows; j++) {
    const z = (j / rows) * length
    const row = []
    for (let i = 0; i < COLS; i++) {
      const th = (i / COLS) * 2 * Math.PI
      const r = major / 2 - depth + smooth(z - (pitch * th) / (2 * Math.PI)) + (rand() - 0.5) * 2 * noise
      row.push([r * Math.cos(th), r * Math.sin(th), z])
    }
    v.push(row)
  }
  const tris = []
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < COLS; i++) {
      const a = v[j][i], b = v[j][(i + 1) % COLS], c = v[j + 1][(i + 1) % COLS], d = v[j + 1][i]
      tris.push([a, b, c], [a, c, d])
    }
  for (let i = 0; i < COLS; i++) {
    tris.push([[0, 0, 0], v[0][(i + 1) % COLS], v[0][i]])
    tris.push([[0, 0, length], v[rows][i], v[rows][(i + 1) % COLS]])
  }
  const out = Buffer.alloc(84 + 50 * tris.length)
  out.writeUInt32LE(tris.length, 80)
  tris.forEach((t, k) => t.flat().forEach((x, m) => out.writeFloatLE(x, 84 + 50 * k + 12 + 4 * m)))
  return out
}
const dir = mkdtempSync(join(tmpdir(), 'scanruler-thread-'))
const M8 = join(dir, 'm8-rod.stl'), M5 = join(dir, 'm5-rod.stl')
writeFileSync(M8, rod({ major: 8, pitch: 1.25, length: 20 }))
writeFileSync(M5, rod({ major: 5, pitch: 0.8, length: 14, seed: 11 }))

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
  check(waited.json?.connected === true && waited.json.page.plugins.includes('thread-match'), `the page connected with thread-match (${waited.json?.page?.plugins})`)
  const tools = (await agent.client.listTools()).tools
  const names = tools.map((t) => t.name)
  const wanted = ['thread_identify', 'thread_standards', 'thread_lookup', 'thread_note', 'thread_settings']
  check(wanted.every((n) => names.includes(n)), `the ${wanted.length} thread tools are listed (missing: ${wanted.filter((n) => !names.includes(n)).join(', ') || 'none'})`)
  const depth = (v) => (v !== null && typeof v === 'object' ? 1 + Math.max(0, ...Object.values(v).map(depth)) : 0)
  const heavy = tools.filter((t) => t.name.startsWith('thread_') && (JSON.stringify(t.inputSchema).length > 8000 || depth(t.inputSchema) > 12)).map((t) => t.name)
  check(heavy.length === 0, `every thread tool’s schema within budget${heavy.length ? ` — not ${heavy.join(', ')}` : ''}`)

  const guide = await ok('guide_read', { topic: 'thread-match' })
  check(/can't tell/.test(guide.text) && /thread\.identify/.test(guide.text), 'guide_read serves the thread-match guide')

  // ---- the tables, no scan needed -------------------------------------------------------------
  const lk = await ok('thread_lookup', { designation: 'm8x1.25' })
  check(lk.json?.designation === 'M8×1.25' && Math.abs(lk.json.minorInternal - 6.647) < 0.001 && lk.json.canModel === true, `thread_lookup M8×1.25: minor ${lk.json?.minorInternal}, ${lk.json?.source}`)
  const npt = await ok('thread_lookup', { designation: '1/2-14 NPT' })
  check(npt.json?.taper === '1:16' && npt.json.canModel === false, `thread_lookup 1/2-14 NPT: taper ${npt.json?.taper}, modelled ${npt.json?.canModel}`)
  const missing = await call('thread_lookup', { designation: 'M8x7' })
  check(missing.error && /M8/.test(missing.text), `an unknown size is refused with near ones: ${missing.text?.slice(0, 90)}`)
  const st = await ok('thread_standards', { query: '1/2' })
  check(st.json?.families?.length === 10 && st.json.designations.includes('G 1/2') && st.json.designations.includes('1/2-13 UNC'), `thread_standards: ${st.json?.families?.length} families, ${st.json?.designations?.length} sizes with 1/2`)

  // ---- an M8×1.25 boss: a match ---------------------------------------------------------------
  await ok('scan_open', { path: M8, discard: true })
  const axis8 = { kind: 'line', origin: [0, 0, 10], dir: [0, 0, 1], radius: 3.6, length: 16 }
  const m8 = await ok('thread_identify', { axis: axis8 })
  check(m8.json?.verdict === 'match' && m8.json.best?.designation === 'M8×1.25', `thread_identify on the M8 rod: ${m8.json?.verdict} ${m8.json?.best?.designation} (${m8.json?.confidence}) — ${m8.json?.note}`)
  check(Math.abs(m8.json?.reads?.pitch - 1.25) < 0.005 && m8.json.reads.starts === 1 && m8.json.reads.leftHanded === false, `the fold reads pitch ${m8.json?.reads?.pitch} ± ${m8.json?.reads?.pitchSigma}, ${m8.json?.reads?.starts} start, right hand`)
  check(Math.abs(m8.json?.reads?.flankAngle - 60) < 6 && m8.json.reads.taper === 'parallel', `flank ${m8.json?.reads?.flankAngle}° (${m8.json?.reads?.flankConfidence}), ${m8.json?.reads?.taper}`)
  const full = await ok('thread_identify', { axis: axis8, detail: 'full' })
  check(full.json?.candidates?.length === 6 && full.json.tooth?.length >= 16, `detail full: ${full.json?.candidates?.length} candidates, a ${full.json?.tooth?.length}-bin tooth`)
  const metricOnly = await ok('thread_identify', { axis: axis8, families: ['unc', 'unf'] })
  check(metricOnly.json?.verdict !== 'match' || metricOnly.json?.confidence === 'low', `inch families only: ${metricOnly.json?.verdict} ${metricOnly.json?.best?.designation ?? ''} (${metricOnly.json?.confidence ?? 'no'} confidence) — the M8 is not forced onto an inch size`)

  // ---- an M5×0.8: ambiguous with #10-32 -------------------------------------------------------
  await ok('scan_open', { path: M5, discard: true })
  const axis5 = { kind: 'line', origin: [0, 0, 7], dir: [0, 0, 1], radius: 2.2, length: 11 }
  const m5 = await ok('thread_identify', { axis: axis5 })
  const tied = m5.json?.tied ?? []
  check(m5.json?.verdict === 'ambiguous' && tied.includes('M5×0.8') && tied.includes('#10-32 UNF'), `thread_identify on the M5 rod: ${m5.json?.verdict}, tied ${tied.join(' / ')}`)
  const first = m5.json?.deciding?.[0]
  check(/major diameter/.test(first?.measure ?? '') && first.expect.some((e) => e.value === '5 mm') && first.expect.some((e) => e.value === '4.83 mm'), `deciding: ${first?.measure} — ${first?.expect?.map((e) => `${e.designation} ${e.value}`).join(', ')}`)

  // ---- settings and the note ------------------------------------------------------------------
  const set = await ok('thread_settings', { families: ['metric'], pitchFloor: 0.02 })
  check(set.json?.families?.length === 1 && set.json.pitchFloor === 0.02, 'thread_settings sets the defaults')
  const narrowed = await ok('thread_identify', { axis: axis5 })
  check(narrowed.json?.verdict === 'match' && narrowed.json.best?.designation === 'M5×0.8', `metric only by default now: ${narrowed.json?.verdict} ${narrowed.json?.best?.designation}`)
  const state = await ok('session_state', {})
  check(state.json?.plugins?.thread?.last?.best === 'M5×0.8', `session_state carries the last thread: ${JSON.stringify(state.json?.plugins?.thread?.last)}`)
  await ok('thread_settings', { reset: true })
  const pinned = await call('thread_note', { text: 'M5×0.8 or #10-32 UNF? Calipers across the crests: 5.00 vs 4.83 mm. Assuming M5×0.8.' })
  check(!pinned.error, `thread_note pins the question on the part${pinned.error ? `: ${pinned.text}` : ''}`)
  await ok('view_render', { view: 'iso', fit: true, width: 800, height: 600, path: join(OUT_DIR, 'e2e-thread-note.png') })
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
