// SPDX-License-Identifier: AGPL-3.0-only
// printer-handoff driven by an agent, end to end: scanruler-mcp with the
// printer extras and a ScanRuler folder of its own, a stand-in Bambu Lab
// printer (MQTT and FTPS over TLS) and a stand-in Klipper, and the app in
// headless Chrome. The person's part is played here, outside the agent:
// they store the access code, and they open the page printer_start put in
// their browser and press Start. The agent sets the printers up, uploads,
// asks, waits, watches, pauses and stops — and never gets the address or
// the secret.
//
//   APP_URL=http://localhost:5173 node plugins/printer-handoff/scripts/e2e-agent-printer.mjs

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')
const { fakeBambu, fakeHttp, starts } = await import('../../../mcp/tests/fakePrinters.js')
const { setSecret } = await import('../../../mcp/src/extras/secrets.js')

const dir = mkdtempSync(join(tmpdir(), 'scanruler-printer-'))
const home = join(dir, 'home')
mkdirSync(home, { recursive: true })
const opened = join(dir, 'opened.txt')
const opener = join(dir, 'opener.sh')
writeFileSync(opener, `#!/bin/sh\necho "$1" >> ${opened}\n`)
chmodSync(opener, 0o755)
Object.assign(process.env, { SCANRULER_MCP_EXTRAS: 'slicer,printer', SCANRULER_HOME: home, SCANRULER_SECRETS: 'file', SCANRULER_CONFIRM: 'page', SCANRULER_OPENER: opener })
const SECRETS = { bambu: '24681357', klipper: 'klipper-key-77' }
const bambu = await fakeBambu({ accessCode: SECRETS.bambu })
const klipper = await fakeHttp('moonraker', { key: SECRETS.klipper })
const job = join(dir, 'bracket.3mf')
writeFileSync(job, Buffer.from('PK a sliced plate'))
const gcode = join(dir, 'bracket.gcode')
writeFileSync(gcode, ';FLAVOR:Klipper\nG28\n')
mkdirSync(OUT_DIR, { recursive: true })

const { agent } = await launchAgent(startAgent)
const { call } = agent
const said = []
async function ok(name, input, what) {
  const r = await call(name, input)
  said.push(r.text)
  if (r.error) fail(`${what ?? name}: ${r.text}`)
  return r
}
async function nextUrl(seen) {
  for (let i = 0; i < 40; i++) {
    const lines = existsSync(opened) ? readFileSync(opened, 'utf8').trim().split('\n').filter(Boolean) : []
    if (lines.length > seen) return lines.at(-1)
    await new Promise((s) => setTimeout(s, 100))
  }
  fail('No page was opened for the person.')
}
async function answered(id) {
  for (let i = 0; i < 60; i++) {
    const r = (await ok('printer_requests', {})).json.requests.find((x) => x.request === id)
    if (!['waiting', 'starting'].includes(r.status)) return r
    await new Promise((s) => setTimeout(s, 250))
  }
  return null
}
const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
check(Boolean(link), `the server hands out a pairing link (${link})`)
const { browser, consoleErrors } = await launchApp({ url: link, protocolTimeout: 300_000 })
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 90 })
  check(waited.json?.connected === true && waited.json.page.plugins.includes('printer-handoff'), `the page connected with printer-handoff (${waited.json?.page?.plugins})`)
  const names = (await agent.client.listTools()).tools.map((t) => t.name)
  check(['printer_add', 'printer_start', 'printer_requests', 'printer_camera'].every((n) => names.includes(n)), 'the printer tools are listed with SCANRULER_MCP_EXTRAS=printer')
  const guide = await ok('guide_read', { topic: 'printer-handoff' })
  check(/You never start a print/.test(guide.text) && /Developer Mode/.test(guide.text), 'guide_read serves the printer-handoff guide')

  const add = await ok('printer_add', { name: 'X1C', kind: 'bambu-lan', host: '127.0.0.1', serial: bambu.serial, mqttPort: bambu.mqttPort, ftpPort: bambu.ftpPort })
  check(/secrets\.js set printer:X1C/.test(add.json?.secret ?? ''), 'printer_add says the access code is the person’s to set, in a terminal')
  await setSecret('printer:X1C', SECRETS.bambu, process.env)
  const t = await ok('printer_test', { name: 'X1C' })
  check(t.json?.state === 'idle' && /pinned/.test(t.json?.pinned ?? ''), `printer_test reaches it and pins its certificate (${t.json?.state})`)

  await ok('printer_upload', { printer: 'X1C', file: job })
  check(bambu.seen.files.has('bracket.3mf'), 'the 3MF arrives over FTPS')
  const req = await ok('printer_start', { printer: 'X1C' })
  check(req.json?.status === 'waiting' && !req.text.includes('/confirm/'), `printer_start asks and waits (${req.json?.status}); the address is not in its answer`)
  await new Promise((s) => setTimeout(s, 800))
  check(starts(bambu).length === 0, 'nothing has started')

  const url = await nextUrl(0)
  const person = await browser.newPage()
  await person.goto(url)
  await person.screenshot({ path: join(OUT_DIR, 'printer-confirm.png') })
  check(/bracket\.3mf/.test(await person.content()), 'the person’s page shows the printer and the file')
  await Promise.all([person.waitForNavigation(), person.click('#start')])
  check(/Started/.test(await person.content()), 'the person presses Start')
  const r = await answered(req.json.request)
  check(r?.status === 'started' && starts(bambu).length === 1 && starts(bambu)[0].print.url === 'ftp:///bracket.3mf', `printer_requests: ${r?.status}; the printer was sent project_file`)
  const st = await ok('printer_status', { name: 'X1C' })
  check(st.json?.state === 'printing' && st.json.layer === '3/120', `printer_status: ${st.json?.state}, layer ${st.json?.layer}`)
  await ok('printer_pause', { name: 'X1C' })
  check((await ok('printer_status', { name: 'X1C' })).json?.state === 'paused', 'printer_pause pauses it')
  await ok('printer_stop', { name: 'X1C' })
  check((await ok('printer_status', { name: 'X1C' })).json?.state === 'idle', 'printer_stop stops it')

  await ok('printer_add', { name: 'Voron', kind: 'moonraker', host: `127.0.0.1:${klipper.port}` })
  await setSecret('printer:Voron', SECRETS.klipper, process.env)
  await ok('printer_upload', { printer: 'Voron', file: gcode })
  const r2 = await ok('printer_start', { printer: 'Voron' })
  const url2 = await nextUrl(1)
  await person.goto(url2)
  await Promise.all([person.waitForNavigation(), person.click('button[value=cancel]')])
  const c = await answered(r2.json.request)
  check(c?.status === 'cancelled' && starts(klipper).length === 0, `the person cancels the Klipper print: ${c?.status}, nothing sent`)
  const cam = await call('printer_camera', { name: 'Voron' })
  check(cam.images?.length === 1, 'printer_camera returns a snapshot')

  const list = await ok('printer_list', {})
  check(list.json?.printers?.every((p) => !p.secret || p.secret === 'set'), 'printer_list says only that each secret is set')
  const all = said.join('\n')
  check(!Object.values(SECRETS).some((s) => all.includes(s)) && !all.includes('/confirm/'), 'no answer carried a secret or a confirmation address')
} finally {
  bambu.close()
  klipper.close()
  await agent.close?.()
  await finish(browser, consoleErrors)
}
