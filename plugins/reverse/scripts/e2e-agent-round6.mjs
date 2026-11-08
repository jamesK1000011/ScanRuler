// SPDX-License-Identifier: AGPL-3.0-only
// Round 6 of the agent plan (the measuring back in ScanRuler) driven by an
// agent, end to end: an MCP client starts scanruler-mcp with its call trace
// on, the app in headless Chrome is paired with it, and on the scan of a
// 40 mm block whose one top edge is rounded R2.5 the agent reads the round
// off the scan (reverse_body_fillet_read), rounds the model to it, writes
// the STEP checked (reverse_export_step { verify }), and looks at the scan
// in Mesh Tools and comes back (mesh_show says it took the screen). The
// trace has a line for every call.
//
// Prereqs: dev server running (npm run dev), Chrome, the server's
// dependencies (npm --prefix mcp ci).
//   node plugins/reverse/scripts/e2e-agent-round6.mjs
// Env: APP_URL, CHROME, OUT_DIR.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')
const { summarize, readTrace } = await import('../../../scripts/trace-summary.mjs')

// ---- the scan: a block with one rounded edge ------------------------------------

/** A 40 mm square in XZ about the origin, its corner at x = 20, z = 20
 *  rounded `r`, run along Y from −20 to 20 and capped, with a little noise
 *  on the profile: triangles as a flat list of xyz. */
function roundedBlock(r = 2.5, step = 0.4, arcSteps = 24, noise = 0.02) {
  let seed = 7
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  const pts = []
  const line = (a, b, n) => {
    const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    for (let i = 0; i < k; i++) pts.push({ p: [a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k], n })
  }
  line([-20, -20], [20, -20], [0, -1])
  line([20, -20], [20, 20 - r], [1, 0])
  for (let i = 0; i < arcSteps; i++) {
    const a = (Math.PI / 2) * (i / arcSteps)
    pts.push({ p: [20 - r + r * Math.cos(a), 20 - r + r * Math.sin(a)], n: [Math.cos(a), Math.sin(a)] })
  }
  line([20 - r, 20], [-20, 20], [0, 1])
  line([-20, 20], [-20, -20], [-1, 0])
  const profile = pts.map(({ p, n }) => {
    const d = gauss() * noise
    return [p[0] + d * n[0], p[1] + d * n[1]]
  })
  const at = (p, y) => [p[0], y, p[1]]
  const tris = []
  // Along Y in strips of half a millimetre, so the scan has vertices all
  // over its faces, as a scan does — the comparison reads vertices.
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i]
    const b = profile[(i + 1) % profile.length]
    for (let y = -20; y < 20; y += 0.5) tris.push([at(a, y), at(b, y + 0.5), at(b, y)], [at(a, y), at(a, y + 0.5), at(b, y + 0.5)])
    tris.push([[0, -20, 0], at(a, -20), at(b, -20)], [[0, 20, 0], at(b, 20), at(a, 20)])
  }
  // Wound outward: the signed volume comes out positive.
  const vol = tris.reduce((v, [p, q, r]) => v + (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6, 0)
  if (!(vol > 0)) throw new Error(`The test block is wound inside out (${vol}).`)
  return tris
}

/** Triangles as a binary STL. */
function stl(tris) {
  const buf = Buffer.alloc(84 + tris.length * 50)
  buf.writeUInt32LE(tris.length, 80)
  tris.forEach((t, i) => {
    const o = 84 + i * 50
    t.forEach((p, j) => p.forEach((v, k) => buf.writeFloatLE(v, o + 12 + j * 12 + k * 4)))
  })
  return buf
}

mkdirSync(OUT_DIR, { recursive: true })
const scanPath = join(OUT_DIR, 'round6-block.stl')
writeFileSync(scanPath, stl(roundedBlock()))
const traceDir = join(OUT_DIR, 'round6-trace')
rmSync(traceDir, { recursive: true, force: true })
process.env.SCANRULER_MCP_TRACE = traceDir

const { agent } = await launchAgent(startAgent)
const { call } = agent
const ok = async (name, input, what) => {
  const r = await call(name, input)
  if (r.error) fail(`${what ?? name}: ${r.text}`)
  return r
}

const status = await call('scanruler_status')
const link = /(\S+#agent=\d+:[\w-]+)/.exec(status.json?.howToConnect ?? '')?.[1]
check(Boolean(link) && status.json?.server?.trace?.startsWith(traceDir), `the server traces to ${status.json?.server?.trace}`)
const { browser, page, consoleErrors } = await launchApp({ url: link, protocolTimeout: 300_000 })
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 60 })
  check(waited.json?.connected === true, 'the page connected')
  await ok('scan_open', { path: scanPath, discard: true })
  await ok('workspace_set', { workspace: 'reverse' })
  await call('scanruler_wait', { for: 'idle', timeoutSeconds: 120 })

  // ---- the sharp block, its edge read for a round ---------------------------------
  await ok('reverse_feature_add', { feature: { kind: 'sketch', name: 'Base', plane: { kind: 'world', axis: 'z', offset: -20 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [0, 0], size: [40, 40], fixed: true }] } } })
  const block = await ok('reverse_feature_add', { feature: { kind: 'extrude', name: 'Block', sketchId: 'Base', regions: 'all', extent: { kind: 'distance', from: 0, to: 40 }, op: 'new' } })
  const body = block.json?.bodies?.changed?.[0]?.id
  // What the extrude made, by index: the edge to read picked from it, no
  // describe between.
  const made = block.json?.made?.[0]
  const edgeAt = (x, z) => made?.edges?.find((e) => e.kind === 'line' && Math.abs(e.mid[0] - x) < 1e-3 && Math.abs(e.mid[2] - z) < 1e-3)
  const roundEdge = edgeAt(20, 20)
  const sharpEdge = edgeAt(-20, 20)
  check(made?.faces?.length === 6 && made.edges.length === 12 && roundEdge && sharpEdge, `the extrude's answer names what it made: ${made?.faces?.length} faces, ${made?.edges?.length} edges (the top +X edge is ${roundEdge?.index})`)
  const read = await ok('reverse_body_fillet_read', { body, edges: [roundEdge?.index ?? 0, sharpEdge?.index ?? 0] })
  // A sharp edge comes back among the gathered ones (sharp: { edges, why }),
  // not as a row of its own.
  const [rounded] = read.json?.edges ?? []
  const sharp = read.json?.sharp
  check(rounded?.round === true && Math.abs(rounded.radius - 2.5) < 0.05 && rounded.nominal === 2.5 && rounded.sigma > 0, `reverse_body_fillet_read: the rounded edge reads R${rounded?.radius} ± ${rounded?.sigma} (nominal ${rounded?.nominal}, ${rounded?.sigmas} sigmas off)`)
  check(sharp?.edges?.includes(sharpEdge?.index) && /^no round/.test(sharp.why), `and the sharp one: ${sharp?.why}`)

  // ---- rounded to it, and written out checked -------------------------------------
  // Queued, timed: answered at once, said finished by the idle wait.
  const queued = await ok('reverse_feature_add', { feature: { kind: 'fillet', body, edges: [roundEdge?.index ?? 0], radius: rounded?.nominal ?? 2.5 }, timings: true, wait: false })
  check(queued.json?.queued === true, `the fillet queued as ${queued.json?.job}`)
  const idle = await ok('scanruler_wait', { for: 'idle', timeoutSeconds: 120 })
  const fin = idle.json?.finished?.find((j) => j.job === queued.json?.job)
  check(fin?.state === 'done', `scanruler_wait idle says it finished: ${JSON.stringify(idle.json?.finished)}`)
  const fillet = await ok('scanruler_wait', { for: 'job', job: queued.json?.job })
  const r = fillet.json?.result
  check(r?.feature?.status === 'ok' && r.ms > 0 && Array.isArray(r.steps?.played) && r.made?.[0]?.faces?.some((f) => f.kind === 'cylinder' && Math.abs(f.radius - 2.5) < 1e-6), `the fillet at the nominal builds in ${r?.ms} ms (steps played ${JSON.stringify(r?.steps?.played)}), its round face named`)
  const stepPath = join(OUT_DIR, 'round6-block.step')
  const step = await ok('reverse_export_step', { path: stepPath, verify: true })
  const v = step.json?.verify
  check(v?.ok === true && v.parts === 1 && v.bodies?.[0]?.closed && v.bodies[0].gap.max < 1e-3 && !v.loops.wrong, `reverse_export_step verify: ${JSON.stringify(v?.problems)}, gap ${v?.bodies?.[0]?.gap?.max} mm, loops ${v?.loops?.read}/${v?.loops?.of}`)
  check(existsSync(stepPath) && readFileSync(stepPath, 'utf8').startsWith('ISO-10303-21;'), `the file is written: ${stepPath}`)

  // ---- a section: its profile rounded to the scan, its picture --------------------
  const cut = await ok('section_cut', { across: 'ZX', offset: 0, name: 'Across' })
  const sectionId = cut.json?.section?.id
  await ok('reverse_feature_add', { feature: { kind: 'sketch', name: 'Profile', plane: { kind: 'section', id: sectionId }, sketch: { fit: {} } }, detail: 'none' })
  const listed = await ok('reverse_feature_list', { feature: 'Profile' })
  const sketchLines = (listed.json?.sketch?.entities ?? []).filter((e) => e.kind === 'line')
  const nearCorner = (e) => Math.min(Math.hypot(e.a[0] - 20, e.a[1] - 20), Math.hypot(e.b[0] - 20, e.b[1] - 20))
  const [la, lb] = [...sketchLines].sort((x, y) => nearCorner(x) - nearCorner(y))
  const roundedSketch = await ok('reverse_sketch_edit', { sketch: 'Profile', add: { rounds: [{ a: la?.id, b: lb?.id }] }, detail: 'none' })
  void roundedSketch
  const edited = await ok('reverse_feature_list', { feature: 'Profile' })
  const roundArc = (edited.json?.sketch?.entities ?? []).find((e) => e.kind === 'arc' && Math.hypot(e.c[0] - 17.5, e.c[1] - 17.5) < 1)
  check(roundArc && Math.abs(roundArc.r - 2.5) < 0.06, `reverse_sketch_edit rounds: the corner between pieces ${la?.id} and ${lb?.id} rounded R${roundArc?.r?.toFixed(3)} to the scan`)
  const pic = await call('section_render', { section: sectionId, path: join(OUT_DIR, 'round6-section-good.png') })
  check(!pic.error && pic.images.length === 1 && pic.json?.layers?.some((l) => l.key === 'bodies' && l.outlines > 0 && l.pieces > 0), `section_render: a picture with the bodies' cut and the sketch's pieces (${JSON.stringify(pic.json?.layers ?? pic.text)}), ${pic.json?.gap?.over} of ${pic.json?.gap?.read} points over`)
  // The body's fillet made wrong: its gap, and nothing else, red.
  await ok('reverse_feature_update', { feature: 'Fillet 1', set: { radius: 1 }, detail: 'none' })
  const bad = await ok('section_render', { section: sectionId, path: join(OUT_DIR, 'round6-section-wrong-fillet.png') })
  const g = bad.json?.gap
  check(g?.over > 5 && g.inside === g.over && g.overBox.min[0] > 17.4 && g.overBox.min[1] > 17.4, `with the fillet R1: ${g?.over} points red, all inside the body, all at the corner (${JSON.stringify(g?.overBox)})`)
  // The same fillet checked by itself: its patch, its number, a picture across it.
  const checked = await call('reverse_body_compare', { feature: 'Fillet 1', picture: true, path: join(OUT_DIR, 'round6-feature-check.png') })
  const cj = checked.json
  check(!checked.error && checked.images.length === 1 && cj?.patches?.length > 0 && cj.patches.every((p) => p.side === 'inside') && Math.abs(cj?.numbers?.radius?.scan - 2.5) < 0.06 && cj.numbers.radius.feature === 1 && cj.picture?.gap?.over > 0, `reverse_body_compare { feature, picture }: ${cj?.patches?.length} patches on the fillet, R${cj?.numbers?.radius?.feature} against the scan's ${cj?.numbers?.radius?.scan} (${cj?.numbers?.radius?.sigmas} sigmas), a picture across it with ${cj?.picture?.gap?.over} points red`)
  const close = await ok('section_render', { section: sectionId, frame: { at: [19, 19], size: 5 }, width: 500 })
  check(close.images.length === 1 && Math.abs(close.json?.map?.unitsPerPx - 0.01) < 1e-6, `framed close: ${close.json?.width} px, ${close.json?.map?.unitsPerPx} mm a pixel`)
  await ok('reverse_feature_update', { feature: 'Fillet 1', set: { radius: rounded?.nominal ?? 2.5 }, detail: 'none' })

  // ---- "fit" in place of a number ----------------------------------------------------
  const fitted = await ok('reverse_feature_update', { feature: 'Fillet 1', set: { radius: 'fit' }, detail: 'none' })
  const fr = fitted.json?.fitted?.radius
  check(fr && Math.abs(fr.value - 2.5) < 0.05 && fr.nominal === 2.5, `reverse_feature_update radius "fit": R${fr?.value} ± ${fr?.sigma}, ${fr?.sigmas} sigmas off the nominal`)
  await page.waitForSelector('[data-test="feature-fitted"]', { timeout: 10_000 }).catch(() => {})
  const tag = await page.$eval('[data-test="feature-fitted"]', (e) => e.getAttribute('title')).catch(() => null)
  check(tag !== null && /radius fitted to the scan/.test(tag), `the panel's row says it was fitted: ${tag}`)
  await ok('reverse_feature_update', { feature: 'Fillet 1', set: { radius: 2 }, detail: 'none' })
  const again = await ok('reverse_feature_refit', { feature: 'Fillet 1', fields: ['radius'], detail: 'none' })
  check(again.json?.was?.radius === 2 && Math.abs(again.json?.fitted?.radius?.value - fr?.value) < 1e-6, `reverse_feature_refit: back to R${again.json?.fitted?.radius?.value} from ${again.json?.was?.radius}`)

  // ---- Mesh Tools on screen, and back ---------------------------------------------
  const shown = await call('mesh_show', { scan: true })
  if (shown.error) console.log(`SKIP: mesh_show — ${shown.text}`)
  else {
    check(shown.json?.workspace === 'mesh' && shown.json?.back === 'reverse' && /workspace\.set/.test(shown.json?.note ?? ''), `mesh_show says it took the screen from ${shown.json?.back}`)
    await ok('workspace_set', { workspace: shown.json.back })
    const state = await ok('session_state', {})
    check(state.json?.workspace === 'reverse', `workspace_set puts it back (${state.json?.workspace})`)
  }

  // ---- the trace --------------------------------------------------------------------
  const files = readdirSync(traceDir).filter((f) => f.endsWith('.jsonl'))
  check(files.length === 1, `one trace file (${files.join(', ')})`)
  const lines = readTrace(join(traceDir, files[0]))
  const tools = lines.filter((l) => l.ev === 'call').map((l) => l.tool)
  check(['reverse_body_fillet_read', 'reverse_export_step', 'scan_open', 'section_render', 'reverse_sketch_edit'].every((t) => tools.includes(t)), `the trace has the calls (${tools.length})`)
  const s = summarize(lines)
  check(s.calls === tools.length && s.wallMs > 0 && s.scanrulerMs > 0, `trace summary: ${s.calls} calls, ScanRuler ${(s.scanrulerMs / 1000).toFixed(1)} s of ${(s.wallMs / 1000).toFixed(1)} s`)
} finally {
  await agent.close()
  await finish(browser, consoleErrors)
}
