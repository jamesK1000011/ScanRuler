// SPDX-License-Identifier: AGPL-3.0-only
// library-pack through scanruler-mcp, as an agent drives it: a bracket and
// a bought-in bolt built in Reverse Engineer, the bracket recorded as a
// remix of a CC BY-SA part and the bolt as McMaster's. CC BY-NC is
// refused with the reason, CC BY-SA goes. A sliced 3MF carrying a home
// path, an access code and a printer serial is added and scrubbed. The
// zip is built and opened: the bolt is out of the model and linked, the
// remix is credited, and nothing private is left. Nothing leaves the
// machine.
//
//   APP_URL=http://localhost:5173 node plugins/library-pack/scripts/e2e-agent-pack.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')

const out = join(OUT_DIR, 'library-pack')
mkdirSync(out, { recursive: true })
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
const scan = join(out, 'bracket-scan.stl')
writeFileSync(scan, boxStl(60, 20, 8))
const PLANTED = { code: '13572468', serial: '01P00A987654321', path: '/Users/alexuser/Desktop/bracket', key: 'sk-moon-9988', email: 'alexuser@example.com' }
const sliced = join(out, 'bracket-profile.3mf')
writeFileSync(
  sliced,
  zipSync({
    'Metadata/project_settings.config': strToU8(JSON.stringify({ print_settings_id: '0.20mm Standard', filament_settings_id: ['PETG'], printhost_apikey: PLANTED.key, export_path: `${PLANTED.path}/bracket.3mf` }, null, 2)),
    'Metadata/model_settings.config': strToU8(`<config><plate><metadata key="printer_sn" value="${PLANTED.serial}"/><metadata key="access_code" value="${PLANTED.code}"/></plate></config>`),
    'Metadata/plate_1.gcode': strToU8(`; owner ${PLANTED.email}\nG28\nG1 X10\n`),
  }),
)

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
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 90 })
  check(waited.json?.connected === true && waited.json.page.plugins.includes('library-pack'), `the page connected with library-pack (${waited.json?.page?.plugins})`)
  const names = (await agent.client.listTools()).tools.map((t) => t.name)
  const wanted = ['pack_settings', 'pack_licence', 'pack_attrib', 'pack_add', 'pack_files', 'pack_plan', 'pack_scrub', 'pack_presets', 'pack_build']
  check(wanted.every((n) => names.includes(n)), `the ${wanted.length} pack tools are listed`)
  const guide = await ok('guide_read', { topic: 'library-pack' })
  check(/You never upload or post anything/.test(guide.text), 'guide_read serves the library-pack guide')

  await ok('scan_open', { path: scan, discard: true })
  await ok('workspace_set', { workspace: 'reverse' })
  await call('scanruler_wait', { for: 'idle', timeoutSeconds: 120 })
  await ok('reverse_feature_add', { feature: { kind: 'sketch', name: 'Bracket sketch', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { shapes: [{ kind: 'rectangle', id: 1, center: [30, 10], size: [60, 20], fixed: true }] } }, detail: 'none' })
  await ok('reverse_feature_add', { feature: { kind: 'extrude', name: 'Bracket', sketchId: 'Bracket sketch', regions: 'all', extent: { kind: 'distance', from: 0, to: 8 }, op: 'new' }, detail: 'none' })
  await ok('reverse_feature_add', { feature: { kind: 'sketch', name: 'Bolt sketch', plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: { entities: [{ id: 1, kind: 'circle', c: [90, 10], r: 2.5 }] } }, detail: 'none' })
  await ok('reverse_feature_add', { feature: { kind: 'extrude', name: 'Bolt', sketchId: 'Bolt sketch', regions: 'all', extent: { kind: 'distance', from: 0, to: 20 }, op: 'new' }, detail: 'none' })
  const built = (await ok('session_state', {})).json?.plugins?.reverse?.bodies ?? []
  await ok('reverse_body_set', { body: built[0].name, name: 'Bracket' })
  await ok('reverse_body_set', { body: built[1].name, name: 'M5 bolt' })

  await ok('pack_settings', { title: 'Stiff wall bracket', author: 'A. Example', summary: 'A wall bracket with a deeper web.', printSettings: 'PETG, 0.2 mm layers, 4 walls, 25% gyroid, no supports.', renders: 3, platform: 'printables' })
  await ok('pack_attrib', {
    set: [
      { part: 'Bracket', body: 'Bracket', title: 'Wall bracket', author: 'maker42', url: 'https://www.printables.com/model/000001-wall-bracket', licence: 'CC BY-SA 4.0', source: 'printables' },
      { part: 'M5 bolt', body: 'M5 bolt', url: 'https://www.mcmaster.com/91290A228/', source: 'mcmaster' },
    ],
  })
  const nc = await ok('pack_licence', { id: 'CC-BY-NC-4.0' })
  check(nc.json?.ok === false && /ShareAlike/.test(nc.json.blocked?.[0]?.why ?? ''), `CC BY-NC is blocked: ${nc.json?.blocked?.[0]?.why}`)
  const refused = await call('pack_build', { path: join(out, 'refused.zip') })
  check(refused.error && /ShareAlike/.test(refused.text), 'pack_build refuses while the licence is blocked')
  const sa = await ok('pack_licence', { id: 'CC-BY-SA-4.0' })
  check(sa.json?.ok === true && sa.json.leftOut?.includes('M5 bolt'), `CC BY-SA goes; the McMaster bolt is left out (${sa.json?.leftOut})`)

  await ok('pack_add', { path: sliced, name: 'bracket-profile.3mf' })
  const sc = await ok('pack_scrub', {})
  const kinds = new Set((sc.json?.changes ?? []).filter((c) => c.file.endsWith('bracket-profile.3mf')).map((c) => c.what))
  check(['access codes, keys, tokens or passwords emptied', 'printer serial numbers emptied', 'absolute paths cut to the file name', 'e-mail addresses removed'].every((k) => kinds.has(k)), `pack_scrub finds the planted details: ${[...kinds].join('; ')}`)

  const b = await ok('pack_build', { path: join(out, 'stiff-wall-bracket.zip') })
  const zip = unzipSync(readFileSync(join(out, 'stiff-wall-bracket.zip')))
  const entries = Object.keys(zip)
  check(['README.md', 'LICENSE', 'PLATFORM.md', 'files/stiff-wall-bracket.stl', 'files/stiff-wall-bracket.3mf', 'files/stiff-wall-bracket.step', 'files/bracket-profile.3mf'].every((e) => entries.includes(`stiff-wall-bracket/${e}`)), `the zip holds the model, the profile, README, LICENSE and PLATFORM.md (${entries.length} files)`)
  check(entries.filter((e) => /images\/.*\.png$/.test(e)).length === 3, 'three renders')
  const readmeText = strFromU8(zip['stiff-wall-bracket/README.md'])
  check(/Remixed from \*\*Wall bracket\*\* by maker42/.test(readmeText) && /M5 bolt \(mcmaster\): https:\/\/www\.mcmaster\.com/.test(readmeText), 'README credits the remix and links the bolt instead of packing it')
  check(/Attribution-ShareAlike 4\.0/.test(strFromU8(zip['stiff-wall-bracket/LICENSE'])), 'LICENSE is CC BY-SA 4.0')
  const stl = Buffer.from(zip['stiff-wall-bracket/files/stiff-wall-bracket.stl'])
  let maxX = -Infinity
  for (let i = 0, n = stl.readUInt32LE(80); i < n; i++) for (let k = 0; k < 3; k++) maxX = Math.max(maxX, stl.readFloatLE(84 + i * 50 + 12 + k * 12))
  check(maxX < 61, `the bolt is not in the model (it ends at x = ${maxX.toFixed(1)})`)
  const everything = Object.entries(zip)
    .flatMap(([n, d]) => (n.endsWith('.3mf') ? Object.values(unzipSync(d)) : [d]))
    .map((d) => strFromU8(d, true))
    .join('\n')
  const leaked = Object.entries(PLANTED).filter(([, v]) => everything.includes(v)).map(([k]) => k)
  check(leaked.length === 0 && !everything.includes('alexuser'), `nothing private in the pack (${leaked.join(', ') || 'none found'})`)
  check(/Printables — fields to paste/.test(strFromU8(zip['stiff-wall-bracket/PLATFORM.md'])), 'PLATFORM.md has the Printables fields to paste')
  check(/Upload it yourself/.test(b.json?.next ?? ''), 'pack_build leaves the upload to the person')

  await ok('workspace_set', { workspace: 'pack' })
  await page.waitForSelector('[data-test=pack-panel]', { timeout: 30_000 })
  const clickText = (t) => page.evaluate((t) => [...document.querySelectorAll('[data-test=pack-panel] button')].find((b) => b.textContent.trim() === t)?.click(), t)
  check((await page.$eval('[data-test=pack-licence]', (e) => e.value)) === 'CC-BY-SA-4.0', 'the Share workspace’s panel shows the licence chosen')
  await page.select('[data-test=pack-licence]', 'CC-BY-NC-4.0')
  await page.waitForSelector('[data-test=pack-blocked]', { timeout: 30_000 })
  check(/ShareAlike/.test(await page.$eval('[data-test=pack-blocked]', (e) => e.textContent)), 'choosing CC BY-NC in the panel shows why the remix blocks it')
  await page.select('[data-test=pack-licence]', 'CC-BY-SA-4.0')
  await clickText('What the scrub takes out')
  await page.waitForSelector('[data-test=pack-scrub]', { timeout: 120_000 })
  check(/access codes/.test(await page.$eval('[data-test=pack-scrub]', (e) => e.textContent)), 'the panel’s scrub report names the access code')
  await clickText('Build the pack')
  await page.waitForSelector('[data-test=pack-built]', { timeout: 120_000 })
  check(/Upload it yourself/.test(await page.$eval('[data-test=pack-built]', (e) => e.textContent)), 'Build in the panel saves the pack')
  await page.screenshot({ path: join(out, 'pack-panel.png') })

  const projectFile = join(OUT_DIR, 'pack.scanruler')
  await ok('project_save', { path: projectFile })
  await ok('project_load', { path: projectFile, discard: true })
  const st = await ok('session_state', {})
  check(st.json?.plugins?.pack?.licence === 'CC-BY-SA-4.0' && st.json.plugins.pack.upstream === 2, `the licence and upstream parts come back with the project: ${JSON.stringify(st.json?.plugins?.pack)}`)
  check(offMachine.length === 0, `nothing left this machine (${offMachine.length} requests off it)`)
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
