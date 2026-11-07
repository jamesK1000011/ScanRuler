// SPDX-License-Identifier: AGPL-3.0-only
// fit-comp driven by an agent, end to end: an MCP client starts
// scanruler-mcp, the app in headless Chrome is paired with it, and a print's
// fit is measured through the tools alone. A test plate (a 60 × 40 × 6 mm
// plate, a Ø5 and a Ø10 hole, a Ø8 boss) is made in Manifold as the CAD,
// then "printed" with known errors — 0.5 % small in X, 0.3 % in Y, walls
// 0.08 mm out, holes 0.12 mm closed, the first layer 0.15 mm squashed — and
// "scanned" with scatter, set off from the CAD so the alignment has work to
// do. fit.measure must read every error back, fit.suggest must give the
// OrcaSlicer values for it, and the exports must be written.
//
// Prereqs: dev server running (npm run dev), Chrome, the server's
// dependencies (npm --prefix mcp ci).
//   node plugins/fit-comp/scripts/e2e-agent-fit.mjs
// Env: APP_URL, CHROME, OUT_DIR.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Module from 'manifold-3d'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')

// ---- the CAD and its print -------------------------------------------------------------------
const wasm = await Module()
wasm.setup()
const { Manifold } = wasm
const HOLES = [{ c: [15, 20], r: 2.5 }, { c: [40, 20], r: 5 }]
const BOSS = { c: [28, 31], r: 4 }
let plate = Manifold.cube([60, 40, 6])
for (const h of HOLES) plate = plate.subtract(Manifold.cylinder(10, h.r, h.r, 96).translate([h.c[0], h.c[1], -2]))
plate = plate.add(Manifold.cylinder(10, BOSS.r, BOSS.r, 96).translate([BOSS.c[0], BOSS.c[1], 5]))

const ERR = { sx: 0.995, sy: 0.997, sz: 1.002, contour: 0.08, hole: 0.12, foot: 0.15 }
function stl(verts, tris) {
  const out = Buffer.alloc(84 + 50 * tris.length / 3)
  out.writeUInt32LE(tris.length / 3, 80)
  for (let t = 0; t < tris.length / 3; t++) for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) out.writeFloatLE(verts[3 * tris[3 * t + k] + a], 84 + 50 * t + 12 + 12 * k + 4 * a)
  return out
}
function meshOf(m) {
  const g = m.getMesh()
  const n = g.vertProperties.length / g.numProp
  const v = new Float64Array(3 * n)
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) v[3 * i + k] = g.vertProperties[i * g.numProp + k]
  return { v, t: g.triVerts }
}
const cad = meshOf(plate)
const scan = meshOf(plate.refineToLength(0.15))
let seed = 9
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand())
const near = (a, b) => Math.abs(a - b) < 1e-3
for (let i = 0; i < scan.v.length; i += 3) {
  let x = scan.v[i], y = scan.v[i + 1]
  const z = scan.v[i + 2]
  const foot = z < 0.2 ? ERR.foot : 0
  if (near(x, 0) && z <= 6) x -= ERR.contour + foot
  if (near(x, 60) && z <= 6) x += ERR.contour + foot
  if (near(y, 0) && z <= 6) y -= ERR.contour + foot
  if (near(y, 40) && z <= 6) y += ERR.contour + foot
  for (const h of HOLES) {
    const r = Math.hypot(x - h.c[0], y - h.c[1])
    if (Math.abs(r - h.r) < 0.01 && z <= 6) {
      const k = (h.r - ERR.hole - foot) / r
      x = h.c[0] + (x - h.c[0]) * k
      y = h.c[1] + (y - h.c[1]) * k
    }
  }
  const rb = Math.hypot(x - BOSS.c[0], y - BOSS.c[1])
  if (Math.abs(rb - BOSS.r) < 0.01 && z >= 6 - 1e-6) {
    const k = (BOSS.r + ERR.contour) / rb
    x = BOSS.c[0] + (x - BOSS.c[0]) * k
    y = BOSS.c[1] + (y - BOSS.c[1]) * k
  }
  // Printed, scanned, and set down 1.5 mm and 2° off where the CAD is.
  const px = x * ERR.sx + gauss() * 0.02, py = y * ERR.sy + gauss() * 0.02, pz = z * ERR.sz + gauss() * 0.02
  const a = (2 * Math.PI) / 180
  scan.v[i] = px * Math.cos(a) - py * Math.sin(a) + 1.5
  scan.v[i + 1] = px * Math.sin(a) + py * Math.cos(a) - 1
  scan.v[i + 2] = pz + 0.5
}
const dir = mkdtempSync(join(tmpdir(), 'scanruler-fit-'))
const CAD = join(dir, 'plate.stl'), SCAN = join(dir, 'plate-print-scan.stl')
writeFileSync(CAD, stl(cad.v, cad.t))
writeFileSync(SCAN, stl(scan.v, scan.t))

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
  check(waited.json?.connected === true && waited.json.page.plugins.includes('fit-comp'), `the page connected with fit-comp (${waited.json?.page?.plugins})`)
  const tools = (await agent.client.listTools()).tools
  const names = tools.map((t) => t.name)
  const wanted = ['fit_settings', 'fit_features', 'fit_tag', 'fit_measure', 'fit_suggest', 'fit_export', 'fit_compensated_mesh', 'fit_runs', 'fit_profiles', 'fit_keymaps']
  check(wanted.every((n) => names.includes(n)), `the ${wanted.length} fit tools are listed (missing: ${wanted.filter((n) => !names.includes(n)).join(', ') || 'none'})`)
  const depth = (v) => (v !== null && typeof v === 'object' ? 1 + Math.max(0, ...Object.values(v).map(depth)) : 0)
  const heavy = tools.filter((t) => t.name.startsWith('fit_') && (JSON.stringify(t.inputSchema).length > 8000 || depth(t.inputSchema) > 12)).map((t) => t.name)
  check(heavy.length === 0, `every fit tool’s schema within budget${heavy.length ? ` — not ${heavy.join(', ')}` : ''}`)
  const guide = await ok('guide_read', { topic: 'fit-comp' })
  check(/fit\.measure/.test(guide.text) && /compensated_mesh/.test(guide.text), 'guide_read serves the fit-comp guide')

  const early = await call('fit_measure', {})
  check(early.error && /scan/.test(early.text), `fit_measure with nothing open says what is missing: ${early.text?.slice(0, 80)}`)

  // ---- open, align ----------------------------------------------------------------------------
  await ok('scan_open', { path: SCAN, discard: true })
  await ok('deviation_open_reference', { path: CAD })
  const notAligned = await call('fit_measure', {})
  check(notAligned.error && /deviation\.align/.test(notAligned.text), 'fit_measure before the alignment asks for it')
  const al = await ok('deviation_align', {})
  check((al.json?.deviation?.align?.rms ?? al.json?.align?.rms ?? 1) < 0.2, `deviation_align: RMS ${al.json?.deviation?.align?.rms ?? al.json?.align?.rms}`)

  // ---- the features and the settings ----------------------------------------------------------
  const feats = await ok('fit_features', {})
  check(feats.json?.planes?.length === 7 && feats.json.circles.filter((c) => c.kind === 'hole').length === 2 && feats.json.circles.some((c) => c.kind === 'boss' && Math.abs(c.diameter - 8) < 1e-3), `fit_features: ${feats.json?.planes?.length} faces, ${feats.json?.circles?.map((c) => `${c.id} ${c.kind} Ø${c.diameter}`).join(', ')}`)
  const set = await ok('fit_settings', { printer: 'Bambu H2D', material: 'PETG', nozzle: '0.4', slicer: 'orcaslicer', current: { xy_hole_compensation: 0.05 } })
  check(set.json?.settings?.printer === 'Bambu H2D' && set.json.slicers.includes('prusaslicer'), `fit_settings: ${set.json?.settings?.printer}, slicers ${set.json?.slicers?.join(', ')}`)
  const badSlicer = await call('fit_settings', { slicer: 'cura' })
  check(badSlicer.error && /orcaslicer/.test(badSlicer.text), 'an unknown slicer is refused with the ones there are')

  // ---- the measurement ------------------------------------------------------------------------
  const m = await ok('fit_measure', { detail: 'full' })
  const j = m.json ?? {}
  check(Math.abs(j.scale?.x?.value - ERR.sx) < 0.0006 && Math.abs(j.scale?.y?.value - ERR.sy) < 0.0006, `scale read back: X ${j.scale?.x?.value} (${ERR.sx}), Y ${j.scale?.y?.value} (${ERR.sy})`)
  check(Math.abs(j.contourOffset?.value - ERR.contour) < 0.02, `contour offset ${j.contourOffset?.value} ± ${j.contourOffset?.se} (${ERR.contour})`)
  check(Math.abs(j.holeOffset?.value - ERR.hole) < 0.02, `hole offset ${j.holeOffset?.value} ± ${j.holeOffset?.se} (${ERR.hole})`)
  check(j.elephantFoot?.value > 0.08 && j.elephantFoot.value < 0.2, `elephant foot ${j.elephantFoot?.value} ± ${j.elephantFoot?.se} (${ERR.foot})`)
  check(j.fit < 4 && !j.warning, `the model explains the print: χ²/dof ${j.fit}`)
  check(j.planes?.length === 7 && j.circles?.length === 3, `detail full: ${j.planes?.length} faces, ${j.circles?.length} circles read`)

  // ---- what to change -------------------------------------------------------------------------
  const sug = await ok('fit_suggest', {})
  const ch = Object.fromEntries((sug.json?.changes ?? []).map((c) => [c.key, c.to]))
  check(Math.abs(ch.xy_contour_compensation + 0.08) < 0.02 && Math.abs(ch.xy_hole_compensation - 0.17) < 0.02 && Math.abs(ch.filament_shrink - 99.6) < 0.1 && ch.elefant_foot_compensation > 0.08, `fit_suggest (OrcaSlicer): ${JSON.stringify(ch)}`)
  const prusa = await ok('fit_suggest', { slicer: 'prusaslicer' })
  check(prusa.json?.changes?.some((c) => c.quantity === 'hole' && c.key === null && /compensated_mesh/.test(c.note)), 'fit_suggest (PrusaSlicer): no hole setting, the compensated model offered instead')
  const ini = await ok('fit_export', { format: 'ini', path: OUT_DIR })
  const iniPath = ini.json?.file?.path
  check(Boolean(iniPath) && /xy_hole_compensation = 0\.1\d/.test(readFileSync(iniPath, 'utf8')), `fit_export wrote ${iniPath}`)
  const comp = await ok('fit_compensated_mesh', { path: OUT_DIR })
  const compPath = comp.json?.file?.path
  check(Boolean(compPath) && existsSync(compPath) && comp.json.triangles === cad.t.length / 3 && comp.json.footMm > 0.08, `fit_compensated_mesh wrote ${compPath}: ${comp.json?.triangles} triangles, ${JSON.stringify(comp.json?.applied)}`)

  // ---- profiles, runs and the project ---------------------------------------------------------
  await ok('fit_profiles', { action: 'save', name: 'H2D PETG 0.4' })
  const prof = await ok('fit_profiles', { action: 'list' })
  check(prof.json?.profiles?.[0]?.values?.xy_hole_compensation > 0.1, `fit_profiles saved: ${JSON.stringify(prof.json?.profiles?.[0]?.values)}`)
  await ok('fit_measure', {})
  const cmp = await ok('fit_runs', { compare: true })
  check(cmp.json?.changes?.length >= 5, `fit_runs compare: runs ${cmp.json?.before} and ${cmp.json?.after}`)
  const tagged = await ok('fit_tag', { ids: ['B1'], as: 'ignore' })
  check(tagged.json?.ignore?.includes('B1'), 'fit_tag ignores the boss')
  const projectFile = join(dir, 'plate-fit.scanruler')
  await ok('project_save', { path: projectFile })
  await ok('project_load', { path: projectFile, discard: true })
  const state = await ok('session_state', {})
  const fit = state.json?.plugins?.fit
  check(fit?.runs === 2 && fit.profiles?.includes('H2D PETG 0.4') && fit.settings?.ignore?.includes('B1'), `the project brings fit-comp back: ${JSON.stringify(fit)}`)
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
