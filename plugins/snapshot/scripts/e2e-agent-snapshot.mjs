// SPDX-License-Identifier: AGPL-3.0-only
// snapshot through scanruler-mcp: no shot yet is said so, the person's
// click on the camera button takes a real capture of the tab (Chrome told
// to accept the tab, as the person's choice would), the note they write
// goes with it, and the agent reads it back as a picture — without any way
// to take one itself. Watched for any request off this machine.
//
//   APP_URL=http://localhost:5173 node plugins/snapshot/scripts/e2e-agent-snapshot.mjs

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')

const { agent } = await launchAgent(startAgent)
const { call } = agent
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

  const list = await ok('snapshot_list', {})
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

  await page.click('[data-test=snapshot-button]')
  await page.waitForFunction(() => document.querySelector('[data-test=snapshot-button] b')?.textContent === '2', { timeout: 30_000 })
  const two = await ok('snapshot_list', {})
  check(two.json?.shots?.length === 2 && two.json.shots[1].note === 'the panel is cut off on the right' && two.json.shots[0].note === null, 'a second shot comes first; the first keeps its note')
  const older = await ok('snapshot_latest', { index: 1 })
  check(older.json?.note === 'the panel is cut off on the right' && older.images?.length === 1, 'snapshot_latest { index: 1 } shows the older one')
  const far = await call('snapshot_latest', { index: 5 })
  check(Boolean(far.error) && /index 0 to 1/.test(far.text), 'an index past the end says how many there are')

  check(offMachine.length === 0, `nothing went off this machine (${offMachine.length ? offMachine.join(', ') : 'none'})`)
} catch (e) {
  fail(e.stack ?? String(e))
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
