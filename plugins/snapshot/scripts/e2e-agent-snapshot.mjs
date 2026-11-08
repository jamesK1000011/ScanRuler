// SPDX-License-Identifier: AGPL-3.0-only
// snapshot through scanruler-mcp: no shot yet is said so, the person's
// click on the camera button takes a real capture of the tab (Chrome told
// to accept the tab, as the person's choice would), the note they write
// goes with it, and the agent reads it back as a picture — without any way
// to take one itself. Watched for any request off this machine.
//
//   APP_URL=http://localhost:5173 node plugins/snapshot/scripts/e2e-agent-snapshot.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')

const { agent } = await launchAgent(startAgent)
const { call } = agent
const allText = async (name, args = {}) => ((await agent.client.callTool({ name, arguments: args })).content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
async function ok(name, input, what) {
  const r = await call(name, input)
  if (r.error) fail(`${what ?? name}: ${r.text}`)
  return r
}
const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
check(Boolean(link), `the server hands out a pairing link (${link})`)
const { browser, page, consoleErrors } = await launchApp({
  url: link,
  args: ['--auto-accept-this-tab-capture', '--auto-select-tab-capture-source-by-title=ScanRuler', '--use-fake-ui-for-media-stream'],
})
const offMachine = []
const local = (u) => /^(data:|blob:|about:|chrome|devtools)/.test(u) || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(u).hostname)
page.on('request', (r) => {
  if (!local(r.url())) offMachine.push(r.url())
})

try {
  await ok('scanruler_wait', { for: 'page', timeoutMs: 60_000 })
  const names = (await agent.client.listTools()).tools.map((t) => t.name)
  check(names.includes('snapshot_latest') && names.includes('snapshot_list') && !names.some((n) => /^snapshot_(take|shoot|capture)/.test(n)), 'snapshot_latest and snapshot_list are listed, and nothing that takes a shot')
  const guide = await ok('guide_read', { topic: 'snapshot' })
  check(/camera button/.test(guide.text) && /cannot take a shot/.test(guide.text), 'guide_read serves the snapshot guide')

  const none = await call('snapshot_latest', {})
  check(Boolean(none.error) && /camera button/.test(none.text), `no shot yet says how to take one (${none.text.slice(0, 60)}…)`)

  await page.waitForSelector('[data-test=snapshot-button]', { timeout: 30_000 })
  await page.bringToFront()
  await page.click('[data-test=snapshot-button]')
  await page.waitForSelector('[data-test=snapshot-card]', { timeout: 30_000 })
  check(true, 'the camera button takes a shot of the tab and shows it in a card')
  await page.click('[data-test=snapshot-note]')
  await page.keyboard.type('the panel is cut off on the right')
  await page.click('[data-test=snapshot-card] .pl-cardhead')

  await new Promise((r) => setTimeout(r, 1500))
  const news = await allText('scanruler_status')
  check(/From ScanRuler: the person took a screenshot/.test(news) && /snapshot_latest shows it/.test(news), `the next answer the agent gets tells it a screenshot was taken (${(/From ScanRuler:[^\n]*/.exec(news) ?? [''])[0].slice(0, 140)}…)`)
  const quiet = await allText('scanruler_status')
  check(!/From ScanRuler/.test(quiet), 'and tells it once')
  const list = await ok('snapshot_list', {})
  const savedTo = list.json?.shots?.[0]?.savedTo
  check(savedTo && existsSync(savedTo) && readFileSync(savedTo).readUInt32BE(0) === 0x89504e47 && /scanruler-shots/.test(savedTo), `the server saved it to disk (${savedTo})`)
  check(list.json?.shots?.length === 1 && list.json.shots[0].note === 'the panel is cut off on the right', `snapshot_list: ${JSON.stringify(list.json?.shots?.[0] ?? null)}`)
  const shot = await ok('snapshot_latest', {})
  check(shot.images?.length === 1 && shot.json?.width >= 1400 && shot.json.height >= 800 && shot.json.note === 'the panel is cut off on the right', `snapshot_latest returns the picture, ${shot.json?.width}×${shot.json?.height}, with the note`)
  const bytes = Buffer.from(shot.images[0].data, 'base64')
  mkdirSync(join(OUT_DIR, 'snapshot'), { recursive: true })
  writeFileSync(join(OUT_DIR, 'snapshot', 'shot.png'), bytes)
  check(shot.json.workspace && !/\n/.test(shot.json.workspace), `the shot names the workspace on screen (${shot.json.workspace})`)
  check(bytes.readUInt32BE(0) === 0x89504e47 && bytes.length > 20_000, `it is a real PNG of the page (${Math.round(bytes.length / 1024)} kB)`)
  const shown = await page.$eval('#scanruler-snapshot', (e) => getComputedStyle(e.querySelector('.sn-dock')).visibility)
  check(shown === 'visible', 'the button is back once the shot is taken')

  const waiting = call('snapshot_wait', { timeoutSeconds: 60 })
  await new Promise((r) => setTimeout(r, 1500))
  await page.click('[data-test=snapshot-button]')
  await page.waitForFunction(() => document.querySelector('[data-test=snapshot-button] b')?.textContent === '2', { timeout: 30_000 })
  const waited = await waiting
  check(waited.json?.came === true && waited.json.index === 0, 'snapshot_wait answers when the person takes the next shot')
  const two = await ok('snapshot_list', {})
  check(two.json?.shots?.length === 2 && two.json.shots[1].note === 'the panel is cut off on the right' && two.json.shots[0].note === null, 'a second shot comes first; the first keeps its note')
  const older = await ok('snapshot_latest', { index: 1 })
  check(older.json?.note === 'the panel is cut off on the right' && older.images?.length === 1, 'snapshot_latest { index: 1 } shows the older one')
  await page.waitForSelector('[data-test=snapshot-markup]', { timeout: 30_000 })
  await page.click('[data-test=snapshot-markup]')
  await page.waitForSelector('[data-test=snapshot-canvas]', { timeout: 30_000 })
  await new Promise((r) => setTimeout(r, 500))
  const box = await page.$eval('[data-test=snapshot-canvas]', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
  await page.mouse.click(box.x + box.w * 0.12, box.y + box.h * 0.2)
  await page.waitForSelector('[data-test=snapshot-pin-1]')
  await page.type('[data-test=snapshot-pin-1]', 'this label is cut off')
  await page.click('[data-test=snapshot-tool-arrow]')
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.6)
  await page.mouse.down()
  await page.mouse.move(box.x + box.w * 0.3, box.y + box.h * 0.4, { steps: 6 })
  await page.mouse.up()
  await page.click('[data-test=snapshot-tool-box]')
  await page.mouse.move(box.x + box.w * 0.6, box.y + box.h * 0.1)
  await page.mouse.down()
  await page.mouse.move(box.x + box.w * 0.8, box.y + box.h * 0.3, { steps: 6 })
  await page.mouse.up()
  await page.screenshot({ path: join(OUT_DIR, 'snapshot', 'markup-view.png') })
  await page.click('[data-test=snapshot-done]')
  await new Promise((r) => setTimeout(r, 1500))
  const marked = await allText('scanruler_status')
  check(/3 marks, 1 numbered pin/.test(marked), `the agent is told of the marks (${(/From ScanRuler:[^\n]*/.exec(marked) ?? [''])[0].slice(0, 120)})`)
  const withMarks = await ok('snapshot_latest', {})
  const plain = await ok('snapshot_latest', { original: true })
  const mb = Buffer.from(withMarks.images[0].data, 'base64')
  writeFileSync(join(OUT_DIR, 'snapshot', 'marked.png'), mb)
  check(withMarks.json?.picture === 'with the marks' && withMarks.json.pins?.[0]?.comment === 'this label is cut off' && /across/.test(withMarks.json.pins[0].at) && plain.json?.picture === 'as taken' && !mb.equals(Buffer.from(plain.images[0].data, 'base64')), `snapshot_latest shows the marks and the pin's comment (${JSON.stringify(withMarks.json?.pins)}); original: true the shot as taken`)
  const far = await call('snapshot_latest', { index: 5 })
  check(Boolean(far.error) && /index 0 to 1/.test(far.text), 'an index past the end says how many there are')

  check(offMachine.length === 0, `nothing went off this machine (${offMachine.length ? offMachine.join(', ') : 'none'})`)
} catch (e) {
  fail(e.stack ?? String(e))
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
