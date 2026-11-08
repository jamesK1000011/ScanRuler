// SPDX-License-Identifier: AGPL-3.0-only
// assembly-manual through scanruler-mcp, as an agent drives it: a box, a lid
// and four screws come in as one STEP, are named and listed as parts with
// the screws' designation, and are put in the wrong order first — the lid
// hits the screw heads, and the check says so — then the right one. The
// instructions are written, linted and rewritten, a page is looked at, and
// the manual is saved as HTML, PDF and a zip, with nothing leaving the
// machine.
//
//   APP_URL=http://localhost:5173 node plugins/assembly-manual/scripts/e2e-agent-asm.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')
const { OcctKernel } = await import('occt-wasm')

const out = join(OUT_DIR, 'assembly-manual')
mkdirSync(out, { recursive: true })
const k = await OcctKernel.init()
const HOLES = [
  [6, 6],
  [34, 6],
  [6, 34],
  [34, 34],
]
let box = k.makeBox(40, 40, 20)
for (const [x, y] of HOLES) box = k.cut(box, k.translate(k.makeCylinder(1.6, 16), x, y, 5))
let lid = k.translate(k.makeBox(40, 40, 3), 0, 0, 20)
for (const [x, y] of HOLES) lid = k.cut(lid, k.translate(k.makeCylinder(1.7, 5), x, y, 19))
const screws = HOLES.map(([x, y]) => k.fuse(k.translate(k.makeCylinder(1.5, 15), x, y, 8), k.translate(k.makeCylinder(2.8, 2), x, y, 23)))
const stepFile = join(out, 'box-kit.step')
writeFileSync(stepFile, k.exportStep(k.makeCompound([box, lid, ...screws])))
const scan = join(out, 'box-scan.stl')
{
  const tris = []
  const v = (x, y, z) => [x * 40, y * 40, z * 23]
  const q = [
    [v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)],
    [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)],
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)],
    [v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)],
    [v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)],
    [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)],
  ]
  for (const [a, b, c, d] of q) tris.push([a, b, c], [a, c, d])
  const buf = Buffer.alloc(84 + tris.length * 50)
  buf.writeUInt32LE(tris.length, 80)
  tris.forEach((t, i) => t.forEach((p, j) => p.forEach((x, m) => buf.writeFloatLE(x, 84 + i * 50 + 12 + j * 12 + m * 4))))
  writeFileSync(scan, buf)
}

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
  check(waited.json?.connected === true && waited.json.page.plugins.includes('assembly-manual'), `the page connected with assembly-manual (${waited.json?.page?.plugins})`)
  const names = (await agent.client.listTools()).tools.map((t) => t.name)
  const wanted = ['asm_settings', 'asm_parts', 'asm_step', 'asm_steps', 'asm_check', 'asm_text', 'asm_style', 'asm_render', 'asm_save', 'asm_review']
  check(wanted.every((n) => names.includes(n)), `the ${wanted.length} asm tools are listed`)
  const guide = await ok('guide_read', { topic: 'assembly-manual' })
  check(/asm\.check/.test(guide.text) && /ASD-STE100/.test(guide.text), 'guide_read serves the assembly-manual guide')

  await ok('scan_open', { path: scan, discard: true })
  await ok('workspace_set', { workspace: 'reverse' })
  await call('scanruler_wait', { for: 'idle', timeoutSeconds: 120 })
  await ok('reverse_import_step', { path: stepFile })
  const built = (await ok('session_state', {})).json?.plugins?.reverse?.bodies ?? []
  check(built.length === 6, `the STEP comes in as six bodies: ${built.map((b) => b.name).join(', ')}`)
  const byZ = [...built].sort((a, b) => a.bounds.max[2] - b.bounds.max[2] || a.bounds.min[0] - b.bounds.min[0] || a.bounds.min[1] - b.bounds.min[1])
  const boxBody = byZ.find((b) => Math.abs(b.bounds.max[2] - 20) < 0.01)
  const lidBody = byZ.find((b) => Math.abs(b.bounds.min[2] - 20) < 0.01 && Math.abs(b.bounds.size[0] - 40) < 0.01)
  const screwBodies = byZ.filter((b) => Math.abs(b.bounds.max[2] - 25) < 0.01)
  check(Boolean(boxBody && lidBody) && screwBodies.length === 4, 'the box, the lid and the four screws are told apart by where they sit')
  await ok('reverse_body_set', { body: boxBody.name, name: 'Box' })
  await ok('reverse_body_set', { body: lidBody.name, name: 'Lid' })
  for (const [i, b] of screwBodies.entries()) await ok('reverse_body_set', { body: b.name, name: `Screw ${i + 1}` })

  await ok('asm_settings', { title: 'Box kit' })
  await ok('asm_parts', { fromBodies: true })
  const p = await ok('asm_parts', { set: [1, 2, 3, 4].map((i) => ({ name: `Screw ${i}`, kind: 'hardware', designation: 'M3×16 ISO 4762', source: 'catalog' })).concat([{ name: 'Box', source: 'printed' }, { name: 'Lid', source: 'printed' }]) })
  check(JSON.stringify(p.json?.bom?.map((r) => [r.name, r.qty, r.designation ?? null])) === JSON.stringify([['Box', 1, null], ['Lid', 1, null], ['Screw', 4, 'M3×16 ISO 4762']]), `the bill of materials: ${JSON.stringify(p.json?.bom?.map((r) => [r.name, r.qty]))}`)

  const screwPlace = [1, 2, 3, 4].map((i) => ({ part: `Screw ${i}`, move: 'down' }))
  await ok('asm_step', { add: { id: 'box', place: [{ part: 'Box', move: 'down' }] } })
  await ok('asm_step', { add: { id: 'screws', place: screwPlace, tools: ['2.5 mm hex key'], torque: '0.8 N·m' } })
  await ok('asm_step', { add: { id: 'lid', place: [{ part: 'Lid', move: 'down' }] } })
  const bad = await ok('asm_check', {})
  check(bad.json?.ok === false && bad.json.hits?.length === 1 && bad.json.hits[0].part === 'Lid' && /^Screw/.test(bad.json.hits[0].hits), `screws before the lid: ${bad.json?.issues?.find((x) => x.level === 'error')?.message}`)
  await ok('asm_step', { move: { id: 'lid', to: 2 } })
  const good = await ok('asm_check', {})
  check(good.json?.ok === true && good.json.hits.length === 0 && good.json.clashes.length === 0, `box, lid, screws checks clean (${good.json?.issues?.filter((x) => x.level !== 'note').map((x) => x.message).join('; ') || 'nothing in the way'})`)

  const long = await ok('asm_text', { step: 'lid', text: 'The lid is put on the box so that the four holes in the lid line up with the four holes in the box and the edges of both parts meet all round.' })
  check(long.json?.findings?.some((f) => f.rule === 'length') && long.json.findings.some((f) => f.rule === 'passive'), `the long passive sentence is flagged: ${long.json?.findings?.map((f) => f.rule).join(', ')}`)
  const fixed = await ok('asm_text', { step: 'lid', text: 'Put the lid on the box. Align the four holes in the lid with the holes in the box.' })
  check(fixed.json?.findings?.length === 0, 'the rewrite lints clean')
  await ok('asm_text', { step: 1, text: 'Put the box on the bench with the holes up.' })
  const scr = await ok('asm_text', { step: 'screws', text: 'Install the four screws through the lid into the box. Tighten the screws in a cross pattern.' })
  check(scr.json?.findings?.length === 0, 'step 3 lints clean')
  await ok('asm_style', { add: [{ avoid: 'bench', use: 'work surface' }] })
  const word = await ok('asm_text', { step: 1 })
  check(word.json?.findings?.some((f) => f.rule === 'word' && /work surface/.test(f.message)), 'a word added to the project list is flagged')
  await ok('asm_text', { step: 1, text: 'Put the box on the work surface with the holes up.' })

  const pg = await ok('asm_render', { page: 3, path: join(out, 'step-3.png') })
  check(pg.images?.length === 1 && pg.json?.pages === 4, `asm_render shows step 3 as a picture (${pg.json?.pages} pages)`)
  await ok('asm_render', { page: 3, format: 'svg', path: join(out, 'step-3.svg') })
  const svg = readFileSync(join(out, 'step-3.svg'), 'utf8')
  check(/font-weight="bold"[^>]*>3</.test(svg) && /4 × Screw/.test(svg) && /M3×16 ISO 4762/.test(svg) && /Torque: 0.8 N·m/.test(svg) && /stroke="#999999"/.test(svg), 'step 3 has the box and lid in grey, the four screws listed with their torque')

  await ok('asm_save', { path: join(out, 'box-kit.html') })
  const h = readFileSync(join(out, 'box-kit.html'), 'utf8')
  check(/<h1>Box kit<\/h1>/.test(h) && (h.match(/<section class="sheet step"/g) ?? []).length === 3 && !/<script|src="http|<link|url\(/.test(h), 'the HTML manual is self-contained: cover and three steps')
  check(/<li>Put the lid on the box\.<\/li><li>Align the four holes/.test(h) && /class="torque">0\.8 N·m/.test(h) && /<span class="balloon">3<\/span>/.test(h), 'each instruction on its own line, the torque and the balloons in the HTML')
  const themes = await ok('asm_settings', {})
  check(themes.json?.themes?.map((t) => t.id).join() === 'workshop,picture,technical,shopfloor,brick' && themes.json.theme.id === 'workshop', `asm_settings lists the themes: ${themes.json?.themes?.map((t) => t.name).join(', ')}`)
  const badColour = await call('asm_settings', { accent: 'green' })
  check(Boolean(badColour.error) && /#rrggbb/.test(badColour.text), 'an accent that is no colour is refused')
  const shots = {}
  for (const theme of ['workshop', 'picture', 'technical', 'shopfloor']) {
    await ok('asm_settings', { theme, accent: theme === 'technical' ? '#2a6f4b' : '' })
    await ok('asm_save', { path: join(out, `box-kit-${theme}.html`) })
    shots[theme] = readFileSync(join(out, `box-kit-${theme}.html`), 'utf8')
  }
  check(shots.technical.includes('--accent:#2a6f4b') && shots.technical.includes('badge-plain') && shots.picture.includes('badge-big balloons-outline') && shots.shopfloor.includes('font-size:20px'), 'each theme gives its own HTML, and the accent is the person’s own')
  const look = await browser.newPage()
  await look.setViewport({ width: 1100, height: 1400 })
  for (const theme of Object.keys(shots)) {
    await look.goto(`file://${join(out, `box-kit-${theme}.html`)}`)
    await look.screenshot({ path: join(out, `manual-${theme}.png`), fullPage: true })
  }
  const printed = await look.pdf({ format: 'letter' })
  check(printed.length > 10_000, `the HTML prints (${Math.round(printed.length / 1024)} kB from Chrome)`)
  await look.close()
  await ok('asm_settings', { theme: 'workshop', accent: '' })

  const before = await ok('asm_review', {})
  check(before.json?.items?.some((x) => x.topic === 'Intended use' && !x.ok && x.fix) && before.json.open > 0, `asm_review lists what 82079 asks for that is missing (${before.json?.open} open)`)
  await ok('asm_settings', { product: 'Box kit BK-1', version: '1.0', publisher: 'A. Example', intendedUse: 'A small box for screws and bits.', safety: 'Small parts: keep away from children under 3.', disposal: 'Take the screws out and recycle the plastic.' })
  await ok('asm_step', { update: { id: 'box', icons: ['two-people'], warnings: [{ level: 'caution', text: 'The box edges are sharp. Wear gloves.' }], tools: ['none'] } })
  const after = await ok('asm_review', {})
  check(after.json?.open === 0, `with the cover filled in, nothing open (${after.json?.items?.filter((x) => !x.ok).map((x) => x.topic).join(', ') || 'all there'})`)
  const brick = await ok('asm_settings', { preset: 'brick-kit' })
  check(brick.json?.settings?.layout === 'auto' && brick.json.settings.words === 'hide' && brick.json.settings.hardwarePage === true && brick.json.presets.find((p) => p.id === 'brick-kit')?.current, 'the brick-kit preset sets the layout, wordless pages and the 1:1 page')
  const hwPage = await ok('asm_render', { page: 1, format: 'svg', path: join(out, 'brick-hardware.svg') })
  check(hwPage.json?.steps?.length === 0 && /Hardware at 1:1/.test(readFileSync(join(out, 'brick-hardware.svg'), 'utf8')), 'page 1 is the hardware at 1:1')
  await ok('asm_render', { page: 1, path: join(out, 'brick-hardware.png') })
  const packed = await ok('asm_render', { step: 1, path: join(out, 'brick-page.png') })
  check(packed.json?.steps?.length >= 2 && packed.json.layout === 'auto', `auto layout packs simple steps together: page ${packed.json?.page} holds steps ${packed.json?.steps?.join(', ')}`)
  await ok('asm_render', { step: 1, format: 'svg', path: join(out, 'brick-page.svg') })
  const bp = readFileSync(join(out, 'brick-page.svg'), 'utf8')
  check(/>CAUTION</.test(bp) && !/Put the box on the work surface/.test(bp), 'the caution shows on the wordless page; the instructions stay off it')
  await ok('asm_settings', { preset: 'technical-order', layout: 'two' })
  await ok('asm_render', { page: 1, path: join(out, 'technical-two.png') })
  await ok('asm_save', { path: join(out, 'box-kit-brick.html') })
  const tech = await ok('asm_save', { path: join(out, 'box-kit-technical.html') })
  const th = readFileSync(join(out, 'box-kit-technical.html'), 'utf8')
  check(/class="z535 caution"/.test(th) && /Intended use/.test(th) && /layout-two/.test(th) && Boolean(tech), 'the HTML carries the caution, the cover facts and the layout')
  await ok('asm_settings', { preset: 'brick-kit' })
  await ok('asm_save', { path: join(out, 'box-kit-brick.html') })
  const look2 = await browser.newPage()
  await look2.setViewport({ width: 1100, height: 1400 })
  for (const n of ['brick', 'technical']) {
    await look2.goto(`file://${join(out, `box-kit-${n}.html`)}`)
    await look2.screenshot({ path: join(out, `manual2-${n}.png`), fullPage: true })
  }
  await look2.goto(`file://${join(out, 'box-kit-technical.html')}`)
  await look2.pdf({ path: join(out, 'box-kit-technical-print.pdf'), format: 'letter', landscape: true })
  await look2.close()
  await ok('asm_settings', { preset: 'standard', product: '', version: '', publisher: '', intendedUse: '', safety: '', disposal: '' })
  await ok('asm_step', { update: { id: 'box', icons: [], warnings: [] } })
  const z = await ok('asm_save', { format: 'zip', path: join(out, 'box-kit.zip') })
  check(readFileSync(join(out, 'box-kit.zip')).readUInt32LE(0) === 0x04034b50 && z.json?.files?.includes('box-kit.pdf'), `the zip: ${z.json?.files?.join(', ')}`)

  await ok('workspace_set', { workspace: 'assembly' })
  await page.waitForSelector('[data-test=asm-panel]', { timeout: 30_000 })
  const clickText = (t) => page.evaluate((t) => [...document.querySelectorAll('[data-test=asm-panel] button')].find((b) => b.textContent.trim() === t)?.click(), t)
  check((await page.$$eval('[data-test=asm-step]', (l) => l.length)) === 3, 'the Assembly workspace’s panel lists the three steps')
  await clickText('Check it goes together')
  await page.waitForSelector('[data-test=asm-check]', { timeout: 120_000 })
  check((await page.$eval('[data-test=asm-check]', (e) => e.textContent)) === 'Every part gets in', 'Check in the panel says every part gets in')
  await clickText('Draw')
  await page.waitForSelector('[data-test=asm-page] img', { timeout: 120_000 })
  check(await page.$eval('[data-test=asm-page] img', (i) => i.complete && i.naturalWidth > 500), 'Draw in the panel puts step 1 on the stage')
  await page.screenshot({ path: join(out, 'asm-panel.png') })

  const projectFile = join(OUT_DIR, 'asm.scanruler')
  await ok('project_save', { path: projectFile })
  await ok('project_load', { path: projectFile, discard: true })
  const st = await ok('session_state', {})
  check(st.json?.plugins?.asm?.parts === 6 && st.json.plugins.asm.steps === 3, `the parts and steps come back with the project: ${JSON.stringify(st.json?.plugins?.asm)}`)
  check(offMachine.length === 0, `nothing left this machine (${offMachine.length} requests off it)`)
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
