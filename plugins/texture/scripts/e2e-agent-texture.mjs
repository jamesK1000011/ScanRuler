// SPDX-License-Identifier: AGPL-3.0-only
// The Texture workspace driven by an agent, end to end: an MCP client starts
// scanruler-mcp, the app in headless Chrome is paired with it, and a part is
// textured through the tools alone. The part is a D-shaped grip — a round
// body with one flat face standing for a surface that must fit: the flat is
// painted to stay plain, the round body is knurled, the part is previewed,
// exported, and texture_check proves the flat came through untouched. The
// file is checked too: the round wall stands proud by the depth asked, the
// flat not at all. Then the project is saved and opened again, and the
// texture comes back with it; the undo key names the agent's step.
//
// Prereqs: dev server running (npm run dev), Chrome, the server's
// dependencies (npm --prefix mcp ci).
//   node plugins/texture/scripts/e2e-agent-texture.mjs
// Env: APP_URL, CHROME, OUT_DIR.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile, sleep } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')

// ---- the part: a D-shaped prism, Z 0–60, radius 15, flat at X = 10 --------------------------
const R = 15, FLAT = 10, H = 60, SEG = 120, ROWS = 30
function dProfile() {
  const a0 = Math.acos(FLAT / R)                  // where the flat meets the round
  const pts = []
  for (let i = 0; i <= SEG; i++) {                // the round, from +a0 the long way to -a0
    const a = a0 + (i / SEG) * (2 * Math.PI - 2 * a0)
    pts.push([R * Math.cos(a), R * Math.sin(a)])
  }
  const flatSteps = 16                            // the flat, -a0 back up to +a0
  const y0 = R * Math.sin(a0)
  for (let i = 1; i < flatSteps; i++) pts.push([FLAT, -y0 + (2 * y0 * i) / flatSteps])
  return pts
}
function prism() {
  const p = dProfile()
  const tris = []
  const n = p.length
  for (let r = 0; r < ROWS; r++) {
    const z0 = (r / ROWS) * H, z1 = ((r + 1) / ROWS) * H
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n]
      tris.push([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1]], [[a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]])
    }
  }
  const c = [2, 0]                                // a point inside, for the caps' fans
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n]
    tris.push([[c[0], c[1], H], [a[0], a[1], H], [b[0], b[1], H]], [[c[0], c[1], 0], [b[0], b[1], 0], [a[0], a[1], 0]])
  }
  return tris
}
function stl(tris) {
  const out = Buffer.alloc(84 + 50 * tris.length)
  out.writeUInt32LE(tris.length, 80)
  tris.forEach((t, i) => t.flat().forEach((x, k) => out.writeFloatLE(x, 84 + 50 * i + 12 + 4 * k)))
  return out
}
const dir = mkdtempSync(join(tmpdir(), 'scanruler-texture-'))
const SCAN = join(dir, 'grip.stl')
writeFileSync(SCAN, stl(prism()))

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
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 90 })
  check(waited.json?.connected === true && waited.json.page.plugins.includes('texture'), `the page connected with the Texture plugin (${waited.json?.page?.plugins})`)
  const tools = (await agent.client.listTools()).tools
  const names = tools.map((t) => t.name)
  const wanted = ['texture_textures', 'texture_set', 'texture_image', 'texture_mask', 'texture_show_mask', 'texture_layer', 'texture_output', 'texture_settings', 'texture_estimate', 'texture_preview', 'texture_show', 'texture_export', 'texture_check', 'texture_stop']
  check(wanted.every((n) => names.includes(n)), `the workspace’s ${wanted.length} tools are listed (missing: ${wanted.filter((n) => !names.includes(n)).join(', ') || 'none'})`)
  const depth = (v) => (v !== null && typeof v === 'object' ? 1 + Math.max(0, ...Object.values(v).map(depth)) : 0)
  const heavy = tools.filter((t) => t.name.startsWith('texture_') && (JSON.stringify(t.inputSchema).length > 8000 || depth(t.inputSchema) > 12)).map((t) => t.name)
  check(heavy.length === 0, `every texture tool’s schema within budget${heavy.length ? ` — not ${heavy.join(', ')}` : ''}`)

  const guide = await ok('guide_read', { topic: 'texture' })
  check(/Surfaces that must not change/.test(guide.text) && /texture\.check/.test(guide.text), 'guide_read serves the texture guide')

  await ok('scan_open', { path: SCAN, discard: true })
  const lib = await ok('texture_textures', { category: 'grip' })
  check(lib.json?.textures?.some((t) => t.name === 'Knurling'), `texture_textures: ${lib.json?.count} grip textures, Knurling among them`)

  // ---- the flat kept plain ------------------------------------------------------------------
  const masked = await ok('texture_mask', { mode: 'exclude', region: { near: [FLAT, 0, H / 2], spreadDeg: 20 } })
  const m = masked.json?.layer?.mask
  const flatArea = 2 * Math.sqrt(R * R - FLAT * FLAT) * H
  check(m?.mode === 'exclude' && Math.abs(m.box.min[0] - FLAT) < 1e-3 && Math.abs(m.box.max[0] - FLAT) < 1e-3 && Math.abs(m.areaMm2 - flatArea) / flatArea < 0.02,
    `texture_mask near the flat: ${m?.vertices} vertices, ${m?.areaMm2} mm² of ${flatArea.toFixed(1)}, all at X ${m?.box?.min?.[0]}`)
  await sleep(300)
  const undoTitle = await page.$eval('[data-test="undo"]', (e) => e.title).catch(() => '')
  check(/Agent: texture mask/.test(undoTitle), `the undo key names the agent’s step: "${undoTitle}"`)

  // ---- the knurl ------------------------------------------------------------------------------
  const set = await ok('texture_set', { texture: 'Knurling', settings: { mappingMode: 3, textureHeight: 0.6 } })
  const L = set.json?.layer
  check(L?.texture?.name === 'Knurling' && /cylindrical/.test(L.mapping) && L.depthMm === 0.6, `texture_set: ${L?.texture?.name}, ${L?.mapping}, ${L?.depthMm} mm deep, tile ${L?.tileMm}`)
  const circumference = 2 * Math.PI * R
  const tiles = circumference / L.tileMm[0]
  check(Math.abs(tiles - Math.round(tiles)) < 1e-3, `the tile wraps seamlessly: ${tiles.toFixed(4)} tiles round`)
  const bad = await call('texture_set', { settings: { textureHeight: -1 } })
  check(bad.error && /0 or more/.test(bad.text), `a negative depth is refused: ${bad.text?.slice(0, 80)}`)
  const unknown = await call('texture_set', { settings: { bogus: 1 } })
  check(unknown.error && /bogus/.test(unknown.text), 'an unknown setting is refused by name')

  await ok('texture_show_mask', {})
  await ok('view_render', { view: 'iso', fit: true, width: 640, height: 480, path: join(OUT_DIR, 'e2e-texture-mask.png') })
  const est = await ok('texture_estimate', {})
  check(est.json?.texturedAreaMm2 > 0 && est.json.subdividedTriangles > 1000, `texture_estimate: ${est.json?.texturedAreaMm2} mm² textured, ~${est.json?.subdividedTriangles} triangles at ${est.json?.refineLength} mm`)

  const prev = await ok('texture_preview', {})
  check(prev.json?.run?.kind === 'preview' && prev.json.run.triangles > 0, `texture_preview: ${prev.json?.run?.triangles} triangles in ${prev.json?.run?.seconds} s`)
  const pic = await ok('view_render', { view: 'iso', fit: true, width: 800, height: 600, path: join(OUT_DIR, 'e2e-texture-preview.png') })
  check(Boolean(pic.images?.length), 'view_render pictures the preview')

  // ---- the file -------------------------------------------------------------------------------
  const out = await ok('texture_export', { format: 'stl', path: OUT_DIR })
  const written = out.json?.file?.path
  check(out.json?.triangles > 2 * prev.json.run.triangles && out.json?.run?.refineLength === est.json.refineLength, `the export is built at full resolution (${out.json?.run?.refineLength} mm): ${out.json?.triangles} triangles against the preview’s ${prev.json.run.triangles}`)
  check(Boolean(written) && existsSync(written), `texture_export wrote ${written} (${out.json?.triangles} triangles, warnings ${JSON.stringify(out.json?.warnings)})`)
  const b = readFileSync(written)
  const n = b.readUInt32LE(80)
  let roundMin = Infinity, roundMax = 0, flatDev = 0, flatPts = 0
  for (let t = 0; t < n; t++) {
    for (let v = 0; v < 3; v++) {
      const o = 84 + 50 * t + 12 + 12 * v
      const x = b.readFloatLE(o), y = b.readFloatLE(o + 4), z = b.readFloatLE(o + 8)
      if (z < 3 || z > H - 3) continue
      const r = Math.hypot(x, y)
      if (Math.abs(Math.atan2(y, x)) > Math.acos(FLAT / R) + 0.15) { roundMin = Math.min(roundMin, r); roundMax = Math.max(roundMax, r) }
      if (Math.abs(y) < Math.sqrt(R * R - FLAT * FLAT) - 1.5 && x > FLAT - 1) { flatPts++; flatDev = Math.max(flatDev, Math.abs(x - FLAT)) }
    }
  }
  check(n === out.json.triangles && roundMax > R + 0.5 && roundMax < R + 0.62 && roundMin > R - 0.02, `the round wall stands proud 0–0.6 mm: r ${roundMin.toFixed(3)}–${roundMax.toFixed(3)}`)
  check(flatPts > 0 && flatDev < 1e-4, `the flat is untouched in the file: ${flatPts} points within ${flatDev.toExponential(1)} mm of X ${FLAT}`)

  const proof = await ok('texture_check', {})
  check(proof.json?.moved === 0 && proof.json.kept > 100, `texture_check: ${proof.json?.verdict}`)

  // ---- saved and opened again -----------------------------------------------------------------
  const saved = await ok('project_save', { path: join(dir, 'grip.scanruler') })
  const projectFile = saved.json?.file?.path ?? join(dir, 'grip.scanruler')
  check(existsSync(projectFile), `project_save wrote ${projectFile}`)
  await ok('project_load', { path: projectFile, discard: true })
  const state = await ok('session_state', {})
  const tex = state.json?.plugins?.texture
  check(tex?.layers?.[0]?.texture?.name === 'Knurling' && tex.layers[0].mask.vertices === m.vertices, `the project brings the texture back: ${tex?.layers?.[0]?.texture?.name}, ${tex?.layers?.[0]?.mask?.vertices} vertices painted`)

  // ---- a stamp on a second layer --------------------------------------------------------------
  const added = await ok('texture_layer', { action: 'add' })
  check(added.json?.layers?.length === 2 && added.json.active === 2, 'texture_layer add: a second layer, active')
  await ok('texture_set', { texture: 'Hexagon', settings: { stampOnce: true, stampCenterX: -15, stampCenterY: 0, stampCenterZ: 30, stampSide: -1, mappingMode: 2, scaleU: 12, textureHeight: 0.4 } })
  const prev2 = await ok('texture_preview', {})
  check(prev2.json?.run?.triangles > 0, `two layers preview: ${prev2.json?.run?.triangles} triangles`)
  await ok('view_render', { view: 'left', fit: true, width: 800, height: 600, path: join(OUT_DIR, 'e2e-texture-stamp.png') })
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
