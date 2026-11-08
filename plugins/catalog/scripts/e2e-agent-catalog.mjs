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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

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
process.env.SCANRULER_SECRETS = 'file'

// Stand-ins for the libraries' APIs: Sketchfab, Thingiverse and Cults3D, each
// answering in its own shape, with a picture and a file to bring in.
const { createServer } = await import('node:http')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const libs = createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const send = (body, type = 'application/json') => res.writeHead(200, { 'content-type': type }).end(type === 'application/json' ? JSON.stringify(body) : body)
  const base = `http://127.0.0.1:${libs.address().port}`
  if (u.pathname === '/pic.png') return send(PNG, 'image/png')
  if (u.pathname === '/file.stl') return send(boxStl(30, 20, 10), 'application/octet-stream')
  if (u.pathname === '/sf/v3/search') return send({ results: [{ uid: 'sf1', name: 'Bearing holder', user: { displayName: 'Ann' }, license: { label: 'CC Attribution' }, viewerUrl: 'https://sketchfab.com/3d-models/sf1', thumbnails: { images: [{ url: `${base}/pic.png`, width: 256 }] }, isDownloadable: true }] })
  if (u.pathname === '/tv/search/608%20bearing%20holder/') return send({ total: 1, hits: [{ id: 101, name: '608 holder bracket', creator: { name: 'Bo' }, public_url: 'https://www.thingiverse.com/thing:101', preview_image: `${base}/pic.png` }] })
  if (u.pathname === '/tv/things/101') return send({ license: 'Creative Commons - Attribution', public_url: 'https://www.thingiverse.com/thing:101' })
  if (u.pathname === '/tv/things/101/files') return send([{ id: 9, name: 'holder.stl', size: 684, download_url: `${base}/file.stl` }])
  res.writeHead(404).end()
})
await new Promise((r) => libs.listen(0, '127.0.0.1', r))
process.env.SCANRULER_SKETCHFAB_API = `http://127.0.0.1:${libs.address().port}/sf`
process.env.SCANRULER_THINGIVERSE_API = `http://127.0.0.1:${libs.address().port}/tv`
const { setSecret } = await import('../../../mcp/src/extras/secrets.js')
await setSecret('catalog:thingiverse', 'tv-token', process.env)

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
const { browser, page, consoleErrors } = await launchApp({ url: link, protocolTimeout: 600_000 })
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
  const w = await ok('catalog_open_url', { url: 'https://www.printables.com/model/000-hinge', watch: true, source: 'printables', licence: 'CC BY 4.0', redistribute: true, to: join(project, 'imports') })
  check(w.json?.watching?.watching === true, 'catalog_open_url { watch: true } opens the page and watches the downloads folder')
  writeFileSync(join(downloads, 'hinge.stl.crdownload'), readFileSync(SCAN))
  await new Promise((r) => setTimeout(r, 1500))
  renameSync(join(downloads, 'hinge.stl.crdownload'), join(downloads, 'hinge.stl'))
  let watched
  for (let i = 0; i < 20; i++) {
    watched = await ok('catalog_watch', { action: 'status' })
    if (watched.json?.taken?.length) break
    await new Promise((r) => setTimeout(r, 500))
  }
  check(watched.json?.taken?.[0]?.from === 'hinge.stl' && existsSync(join(project, 'imports', 'hinge.stl')), `the finished download came into the imports folder by itself: ${JSON.stringify(watched.json?.taken?.map((t) => t.from))}`)
  await ok('catalog_watch', { action: 'stop' })
  const bad = await call('catalog_open_url', { url: 'file:///etc/hosts' })
  check(bad.error && /http/.test(bad.text), 'a non-web address is refused')

  await ok('workspace_set', { workspace: 'catalog' })
  await page.waitForSelector('[data-test=catalog-panel]', { timeout: 30_000 })
  check((await page.$$('[data-test=catalog-record]')).length >= 1, 'the Catalog panel lists where the project’s files came from')
  await page.select('[data-test=catalog-panel] select', 'bearing')
  await page.type('[data-test=catalog-dim-d]', '8.02')
  await page.type('[data-test=catalog-dim-D]', '21.97')
  await page.type('[data-test=catalog-dim-B]', '7')
  await page.click('[data-test=catalog-match]')
  await page.waitForSelector('[data-test=catalog-matches] .cat-row', { timeout: 30_000 })
  const first = await page.$eval('[data-test=catalog-matches] .cat-row .name', (e) => e.textContent)
  check(/^608\b/.test(first ?? ''), `Find the size names a bearing measured 8.02 × 21.97 × 7 a 608 (${first})`)
  await page.click('[data-test=catalog-matches] .cat-row')
  await page.click('[data-test=catalog-links]')
  await page.waitForSelector('[data-test=catalog-link-list] a', { timeout: 30_000 })
  const hrefs = await page.$$eval('[data-test=catalog-link-list] a', (l) => l.map((a) => a.href))
  check(hrefs.length >= 3 && hrefs.every((h) => /^https:\/\//.test(h)) && hrefs.some((h) => /608/.test(h)), `a size picked searches the catalogues for it: ${hrefs.length} pages`)
  await page.type('[data-test=catalog-lookup-name]', 'M5 socket')
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-test=catalog-found] .cat-part', { timeout: 30_000 })
  check(/M5/.test(await page.$eval('[data-test=catalog-found]', (e) => e.textContent)), 'Look up a size shows an M5 socket head’s dimensions')
  await page.screenshot({ path: join(OUT_DIR, 'catalog-panel.png') })

  const libsSet = await ok('catalog_libraries', {})
  check(libsSet.json?.thingiverse?.key === 'set' && libsSet.json?.cults3d?.key === 'not set' && !libsSet.text.includes('tv-token'), 'catalog_libraries says which keys are set, never a key')
  await page.click('[data-test=catalog-model-query]', { clickCount: 3 })
  await page.type('[data-test=catalog-model-query]', '608 bearing holder')
  await page.click('[data-test=catalog-model-search]')
  await page.waitForSelector('[data-test=catalog-model-grid] [data-test=catalog-model]', { timeout: 30_000 })
  const cards = await page.$$eval('[data-test=catalog-model]', (l) => l.map((c) => ({ source: c.dataset.source, img: c.querySelector('img')?.src.startsWith('data:image/png;base64,') ?? false, name: c.querySelector('.cat-card-name')?.textContent })))
  check(cards.length === 2 && cards.every((c) => c.img) && cards.some((c) => c.source === 'sketchfab') && cards.some((c) => c.source === 'thingiverse'), `Find a model shows the libraries' hits as cards with their pictures, fetched by the server: ${JSON.stringify(cards)}`)
  check((await page.$$('[data-test=catalog-model-missing]')).length === 1 && /cults3d/.test(await page.$eval('[data-test=catalog-model-missing]', (e) => e.textContent)), 'a library without its key says how to set it')
  await page.screenshot({ path: join(OUT_DIR, 'catalog-models.png') })
  await page.click('[data-test=catalog-model][data-source=thingiverse] [data-test=catalog-model-files]')
  await page.waitForSelector('[data-test=catalog-model-open] [data-test=catalog-model-take]', { timeout: 30_000 })
  await page.click('[data-test=catalog-model-open] [data-test=catalog-model-take]')
  await page.waitForSelector('[data-test=catalog-model-taken]', { timeout: 60_000 })
  check(existsSync(join(home, 'imports', 'holder.stl')), 'Bring in downloads the file into the imports folder')
  await page.waitForFunction(() => [...document.querySelectorAll('[data-test=catalog-record]')].some((c) => /holder\.stl/.test(c.textContent) && /Creative Commons/.test(c.textContent)), { timeout: 30_000 })
  check(true, 'the file and its licence are recorded with the project')
  await page.screenshot({ path: join(OUT_DIR, 'catalog-taken.png') })
  await page.$$eval('[data-test=catalog-model-taken] button', (b) => b.find((x) => /reference/.test(x.textContent))?.click())
  await page.waitForFunction(() => !document.querySelector('[data-test=catalog-model-busy]'), { timeout: 60_000 })
  const st2 = await ok('session_state', {})
  check(JSON.stringify(st2.json?.deviation ?? st2.json ?? {}).includes('holder'), 'Open as reference opens the model as the reference part')
} finally {
  libs.close()
  await agent.close?.()
  await finish(browser, consoleErrors)
}
