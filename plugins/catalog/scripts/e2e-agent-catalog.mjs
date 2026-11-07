// SPDX-License-Identifier: AGPL-3.0-only
// catalog driven by an agent, end to end: scanruler-mcp with the catalog
// extras, a downloads folder and a browser stand-in of its own, the app in
// headless Chrome paired with it. A bearing is named from its measured
// sizes; search links are built and one opened; a model "downloaded" by the
// person is taken in with its licence, opened as the reference part, and
// its provenance kept with the project — through the tools alone.
//
// Prereqs: dev server running (npm run dev), Chrome, the server's
// dependencies (npm --prefix mcp ci).
//   node plugins/catalog/scripts/e2e-agent-catalog.mjs
// Env: APP_URL, CHROME, OUT_DIR.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')

const dir = mkdtempSync(join(tmpdir(), 'scanruler-catalog-'))
const downloads = join(dir, 'Downloads'), home = join(dir, 'home'), project = join(dir, 'project')
for (const d of [downloads, home, project]) mkdirSync(d, { recursive: true })
const opener = join(dir, 'browser')
writeFileSync(opener, `#!/bin/sh\necho "$1" >> ${join(dir, 'opened.txt')}\n`)
chmodSync(opener, 0o755)
process.env.SCANRULER_MCP_EXTRAS = 'catalog'
process.env.SCANRULER_HOME = home
process.env.SCANRULER_DOWNLOADS = downloads
process.env.SCANRULER_OPENER = opener

// A block the person "scanned", and a bracket model they "downloaded".
function boxStl(x, y, z) {
  const v = [[0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0], [0, 0, z], [x, 0, z], [x, y, z], [0, y, z]]
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
  const b = Buffer.alloc(84 + 50 * f.length)
  b.writeUInt32LE(f.length, 80)
  f.forEach((t, i) => t.forEach((k, j) => v[k].forEach((c, a) => b.writeFloatLE(c, 84 + 50 * i + 12 + 12 * j + 4 * a))))
  return b
}
const SCAN = join(project, 'bracket-scan.stl')
writeFileSync(SCAN, boxStl(40, 20, 10))
writeFileSync(join(downloads, 'bracket-40x20.stl'), boxStl(40, 20, 10))

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
  check(waited.json?.connected === true && waited.json.page.plugins.includes('catalog'), `the page connected with catalog (${waited.json?.page?.plugins})`)
  const names = (await agent.client.listTools()).tools.map((t) => t.name)
  const wanted = ['catalog_kinds', 'catalog_lookup', 'catalog_match', 'catalog_links', 'catalog_provenance', 'catalog_open_url', 'catalog_downloads', 'catalog_take']
  check(wanted.every((n) => names.includes(n)), `the ${wanted.length} catalog tools are listed (missing: ${wanted.filter((n) => !names.includes(n)).join(', ') || 'none'})`)
  const guide = await ok('guide_read', { topic: 'catalog' })
  check(/catalog_take/.test(guide.text) && /kintsugi/.test(guide.text), 'guide_read serves the catalog guide')

  const m = await ok('catalog_match', { dims: { d: 8.02, D: 21.97, B: 7.01 } })
  check(m.json?.matches?.[0]?.designation === '608 bearing' && m.json.fit === 'good', `catalog_match: ${m.json?.matches?.[0]?.designation} (${m.json?.fit})`)
  const l = await ok('catalog_links', { query: 'M18 battery latch bracket' })
  check(l.json?.links?.length === 6 && l.json.links.every((x) => x.url.startsWith('https://') && x.terms), `catalog_links: ${l.json?.links?.map((x) => x.source).join(', ')}`)
  await ok('catalog_open_url', { url: l.json.links.find((x) => x.source === 'printables').url })
  await new Promise((r) => setTimeout(r, 300))
  check(/printables\.com\/search/.test(readFileSync(join(dir, 'opened.txt'), 'utf8')), 'catalog_open_url opened the page in the person’s browser')

  const dl = await ok('catalog_downloads', {})
  check(dl.json?.files?.[0]?.name === 'bracket-40x20.stl', `catalog_downloads: ${dl.json?.files?.map((f) => f.name).join(', ')}`)
  const taken = await ok('catalog_take', { file: dl.json.files[0].path, to: join(project, 'imports'), source: 'printables', url: 'https://www.printables.com/model/000-bracket', licence: 'CC BY 4.0', redistribute: true })
  const file = taken.json?.taken?.[0]
  check(Boolean(file) && existsSync(file) && JSON.parse(readFileSync(join(project, 'imports', 'provenance.json'), 'utf8'))[0].licence === 'CC BY 4.0', `catalog_take: ${file}, provenance kept beside it`)

  await ok('scan_open', { path: SCAN, discard: true })
  await ok('deviation_open_reference', { path: file })
  const al = await ok('deviation_align', {})
  check((al.json?.deviation?.align?.rms ?? 1) < 0.05, `the download opens as the reference and aligns: RMS ${al.json?.deviation?.align?.rms}`)
  await ok('catalog_provenance', { action: 'record', file: 'bracket-40x20.stl', source: 'printables', url: 'https://www.printables.com/model/000-bracket', licence: 'CC BY 4.0', redistribute: true })
  const projectFile = join(project, 'bracket.scanruler')
  await ok('project_save', { path: projectFile })
  await ok('project_load', { path: projectFile, discard: true })
  const st = await ok('session_state', {})
  check(st.json?.plugins?.catalog?.parts?.[0]?.file === 'bracket-40x20.stl' && st.json.plugins.catalog.parts[0].redistribute === true, `the provenance comes back with the project: ${JSON.stringify(st.json?.plugins?.catalog?.parts)}`)
  const bad = await call('catalog_open_url', { url: 'file:///etc/hosts' })
  check(bad.error && /http/.test(bad.text), 'a non-web address is refused')
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
