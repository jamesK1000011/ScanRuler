// SPDX-License-Identifier: AGPL-3.0-only
// The printer extras against stand-in printers: a Bambu Lab printer over
// MQTT and FTPS with its certificate pinned, Moonraker, OctoPrint,
// PrusaLink, a folder and the Bambu Studio hand-off. Above all: printer_start
// on its own never sends a start — only the person's answer does — and no
// answer ever carries a secret.
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { extraTools } from '../src/extras/index.js'
import { connectPacket, parse } from '../src/extras/printers/mqtt.js'
import { _person } from '../src/extras/printers/confirm.js'
import { setSecret } from '../src/extras/secrets.js'
import { fakeBambu, fakeBambuCamera, fakeHttp, starts, throwawayCert } from './fakePrinters.js'
import { bambuJpeg, digest, rtspFrame } from '../src/extras/printers/adapters.js'

const helpers = { text: (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] }), failure: (e) => ({ isError: true, content: [{ type: 'text', text: String(e.message ?? e) }] }) }

let env, dir, tools, said
const call = async (name, args = {}) => {
  const r = await tools.find((t) => t.name === name).call(args)
  const text = r.content?.find((c) => c.type === 'text')?.text ?? ''
  said.push(text)
  return { error: r.isError === true, text, json: (() => { try { return JSON.parse(text) } catch { return null } })(), content: r.content }
}
const ok = async (name, args) => {
  const r = await call(name, args)
  assert.equal(r.error, false, `${name}: ${r.text}`)
  return r.json
}
const answer = async (id, action) => {
  const r = await fetch(_person.address(id), { method: 'POST', body: new URLSearchParams({ action }) })
  assert.equal(r.status, 200)
  return r.text()
}
const settle = async (id) => {
  for (let i = 0; i < 50; i++) {
    const r = (await ok('printer_requests')).requests.find((x) => x.request === id)
    if (r.status !== 'waiting' && r.status !== 'starting') return r
    await new Promise((s) => setTimeout(s, 50))
  }
  throw new Error('no answer')
}

let bambu, moon, octo, prusa
const SECRETS = { bambu: '87654321', moon: 'moon-key-xyz', octo: 'octo-key-xyz', prusa: 'prusa-key-xyz', prusaPass: 'Secr3tPass' }

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scanruler-printers-'))
  const opener = join(dir, 'opener.sh')
  await writeFile(opener, `#!/bin/sh\necho "$1" >> ${join(dir, 'opened.txt')}\n`)
  await chmod(opener, 0o755)
  env = { SCANRULER_MCP_EXTRAS: 'printer', SCANRULER_HOME: join(dir, 'home'), SCANRULER_SECRETS: 'file', SCANRULER_CONFIRM: 'page', SCANRULER_OPENER: opener }
  tools = extraTools(helpers, env)
  said = []
  bambu = await fakeBambu({ accessCode: SECRETS.bambu })
  moon = await fakeHttp('moonraker', { key: SECRETS.moon })
  octo = await fakeHttp('octoprint', { key: SECRETS.octo })
  prusa = await fakeHttp('prusalink', { key: SECRETS.prusa })
  await writeFile(join(dir, 'part.gcode'), ';FLAVOR:Marlin\nG28\nG1 X10 Y10\n')
  await writeFile(join(dir, 'part.3mf'), Buffer.from('PK fake 3mf with Metadata/plate_1.gcode'))
})

after(() => {
  for (const f of [bambu, moon, octo, prusa]) f?.close()
})

test('MQTT packets round-trip', () => {
  const p = connectPacket({ clientId: 'c', username: 'bblp', password: 'x' })
  const { packets, rest } = parse(Buffer.concat([p, p.subarray(0, 3)]))
  assert.equal(packets.length, 1)
  assert.equal(packets[0].type, 1)
  assert.equal(rest.length, 3)
})

test('the printer tools are listed only when asked for', () => {
  assert.equal(extraTools(helpers, {}).some((t) => t.name.startsWith('printer_')), false)
  assert.deepEqual(tools.map((t) => t.name), ['printer_list', 'printer_add', 'printer_remove', 'printer_test', 'printer_status', 'printer_upload', 'printer_start', 'printer_requests', 'printer_pause', 'printer_resume', 'printer_stop', 'printer_camera'])
})

test('a Bambu printer on the LAN: pinned, uploaded over FTPS, started only when the person says so', async () => {
  const added = await ok('printer_add', { name: 'X1C', kind: 'bambu-lan', host: '127.0.0.1', serial: bambu.serial })
  assert.match(added.secret, /secrets\.js set printer:X1C/)
  const noKey = await call('printer_test', { name: 'X1C' })
  assert.equal(noKey.error, true)
  assert.match(noKey.text, /no access code yet/)
  await setSecret('printer:X1C', SECRETS.bambu, env)
  const conf = JSON.parse(await readFile(join(env.SCANRULER_HOME, 'printers.json'), 'utf8'))
  conf.printers[0].mqttPort = bambu.mqttPort
  conf.printers[0].ftpPort = bambu.ftpPort
  await writeFile(join(env.SCANRULER_HOME, 'printers.json'), JSON.stringify(conf))
  const t = await ok('printer_test', { name: 'X1C' })
  assert.equal(t.state, 'idle')
  assert.match(t.pinned, /pinned/)
  assert.match(JSON.parse(await readFile(join(env.SCANRULER_HOME, 'printers.json'), 'utf8')).printers[0].fingerprint, /^[0-9A-F:]{95}$/)
  const up = await ok('printer_upload', { printer: 'X1C', file: join(dir, 'part.3mf') })
  assert.equal(up.name, 'part.3mf')
  assert.deepEqual(bambu.seen.files.get('part.3mf'), await readFile(join(dir, 'part.3mf')))
  const req = await ok('printer_start', { printer: 'X1C' })
  assert.equal(req.status, 'waiting')
  assert.equal(req.file, 'part.3mf')
  assert.ok(!JSON.stringify(req).includes('/confirm/'), 'the address is not in the answer')
  await new Promise((s) => setTimeout(s, 300))
  assert.equal(starts(bambu).length, 0, 'asking started nothing')
  const page = await (await fetch(_person.address(req.request))).text()
  assert.match(page, /Start this print\?/)
  assert.match(page, /part\.3mf/)
  assert.match(await answer(req.request, 'start'), /Started/)
  const r = await settle(req.request)
  assert.equal(r.status, 'started', JSON.stringify(r))
  assert.equal(starts(bambu).length, 1)
  assert.equal(starts(bambu)[0].print.url, 'ftp:///part.3mf')
  assert.equal(starts(bambu)[0].print.param, 'Metadata/plate_1.gcode')
  const st = await ok('printer_status', { name: 'X1C' })
  assert.equal(st.state, 'printing')
  assert.equal(st.layer, '3/120')
  assert.equal((await ok('printer_pause', { name: 'X1C' })).acknowledged, 'success')
  assert.equal((await ok('printer_status', { name: 'X1C' })).state, 'paused')
  await ok('printer_stop', { name: 'X1C' })
  assert.equal((await ok('printer_status', { name: 'X1C' })).state, 'idle')
  const replay = await answer(req.request, 'start')
  assert.match(replay, /Started/)
  assert.equal(starts(bambu).length, 1, 'answering again starts nothing more')
})

test('a Bambu printer whose certificate changed is refused until trusted again', async () => {
  const other = await fakeBambu({ accessCode: SECRETS.bambu, creds: throwawayCert('another-printer') })
  const conf = JSON.parse(await readFile(join(env.SCANRULER_HOME, 'printers.json'), 'utf8'))
  conf.printers[0].mqttPort = other.mqttPort
  conf.printers[0].ftpPort = other.ftpPort
  await writeFile(join(env.SCANRULER_HOME, 'printers.json'), JSON.stringify(conf))
  const r = await call('printer_status', { name: 'X1C' })
  assert.equal(r.error, true)
  assert.match(r.text, /certificate is not the one first seen/)
  const t = await ok('printer_test', { name: 'X1C', trust: true })
  assert.match(t.pinned, /pinned/)
  assert.equal((await ok('printer_status', { name: 'X1C' })).state, 'idle')
  other.close()
})

test('Moonraker: cancelled at the question, nothing starts; started when the person says so', async () => {
  await ok('printer_add', { name: 'Voron', kind: 'moonraker', host: `127.0.0.1:${moon.port}` })
  await setSecret('printer:Voron', SECRETS.moon, env)
  assert.equal((await ok('printer_test', { name: 'Voron' })).state, 'ready')
  await ok('printer_upload', { printer: 'Voron', file: join(dir, 'part.gcode') })
  assert.ok(moon.seen.files.has('part.gcode'))
  const a = await ok('printer_start', { printer: 'Voron' })
  const twice = await call('printer_start', { printer: 'Voron' })
  assert.match(twice.text, /already a request waiting/)
  await answer(a.request, 'cancel')
  assert.equal((await settle(a.request)).status, 'cancelled')
  assert.equal(starts(moon).length, 0)
  const b = await ok('printer_start', { printer: 'Voron', file: 'part.gcode' })
  await answer(b.request, 'start')
  assert.equal((await settle(b.request)).status, 'started')
  assert.equal(starts(moon).length, 1)
  assert.equal((await ok('printer_status', { name: 'Voron' })).percent, 30)
  const cam = await call('printer_camera', { name: 'Voron' })
  assert.equal(cam.content[0].type, 'image')
  assert.equal(cam.content[0].mimeType, 'image/png')
})

test('OctoPrint: a wrong key is named; a withdrawn request starts nothing', async () => {
  await ok('printer_add', { name: 'Ender', kind: 'octoprint', host: `127.0.0.1:${octo.port}` })
  await setSecret('printer:Ender', 'wrong', env)
  const bad = await call('printer_test', { name: 'Ender' })
  assert.match(bad.text, /API key or password is missing or wrong/)
  await setSecret('printer:Ender', SECRETS.octo, env)
  await ok('printer_test', { name: 'Ender' })
  await ok('printer_upload', { printer: 'Ender', file: join(dir, 'part.gcode') })
  const r = await ok('printer_start', { printer: 'Ender' })
  await ok('printer_requests', { withdraw: r.request })
  await answer(r.request, 'start')
  assert.equal(starts(octo).length, 0, 'a withdrawn request cannot be started')
  const r2 = await ok('printer_start', { printer: 'Ender' })
  await answer(r2.request, 'start')
  assert.equal((await settle(r2.request)).status, 'started')
  assert.equal(starts(octo).length, 1)
  assert.equal((await ok('printer_status', { name: 'Ender' })).state, 'printing')
})

test('PrusaLink: uploaded with Print-After-Upload off, so the upload alone never prints', async () => {
  await ok('printer_add', { name: 'MK4', kind: 'prusalink', host: `127.0.0.1:${prusa.port}` })
  await setSecret('printer:MK4', SECRETS.prusa, env)
  await ok('printer_upload', { printer: 'MK4', file: join(dir, 'part.gcode') })
  const put = prusa.seen.calls.find((c) => c.method === 'PUT')
  assert.equal(put.headers['print-after-upload'], '?0')
  assert.equal(starts(prusa).length, 0)
  const r = await ok('printer_start', { printer: 'MK4' })
  await answer(r.request, 'start')
  assert.equal((await settle(r.request)).status, 'started')
  await ok('printer_pause', { name: 'MK4' })
  assert.equal(prusa.seen.state, 'paused')
  await ok('printer_stop', { name: 'MK4' })
  assert.equal(prusa.seen.state, 'idle')
})

test('a folder, and the Bambu Studio hand-off: the person starts those at the printer or in the app', async () => {
  await ok('printer_add', { name: 'Card', kind: 'folder', folder: dir })
  const up = await ok('printer_upload', { printer: 'Card', file: join(dir, 'part.gcode') })
  assert.ok(existsSync(up.path))
  assert.match((await call('printer_start', { printer: 'Card' })).text, /started by you, at the printer/)
  await ok('printer_add', { name: 'Studio', kind: 'bambu-studio' })
  const h = await ok('printer_upload', { printer: 'Studio', file: join(dir, 'part.3mf') })
  assert.match(h.next, /Press Print in Bambu Studio/)
  await new Promise((s) => setTimeout(s, 200))
  assert.match(await readFile(join(dir, 'opened.txt'), 'utf8'), /part\.3mf/)
  assert.match((await call('printer_start', { printer: 'Studio' })).text, /you, in Bambu Studio/)
})

test('on a Mac the question is a dialog; only its Start button starts', async () => {
  const yes = join(dir, 'yes.sh')
  const no = join(dir, 'no.sh')
  await writeFile(yes, '#!/bin/sh\necho "button returned:Start print, gave up:false"\n')
  await writeFile(no, '#!/bin/sh\necho "execution error: User canceled. (-128)" >&2\nexit 1\n')
  await chmod(yes, 0o755)
  await chmod(no, 0o755)
  const mac = { ...env, SCANRULER_CONFIRM: 'dialog' }
  const before = starts(moon).length
  const t1 = extraTools(helpers, { ...mac, SCANRULER_DIALOG: no })
  const r1 = JSON.parse((await t1.find((t) => t.name === 'printer_start').call({ printer: 'Voron', file: 'part.gcode' })).content[0].text)
  assert.equal(r1.how, 'dialog')
  await new Promise((s) => setTimeout(s, 300))
  assert.equal((await settle(r1.request)).status, 'cancelled')
  assert.equal(starts(moon).length, before)
  const t2 = extraTools(helpers, { ...mac, SCANRULER_DIALOG: yes })
  const r2 = JSON.parse((await t2.find((t) => t.name === 'printer_start').call({ printer: 'Voron', file: 'part.gcode' })).content[0].text)
  await new Promise((s) => setTimeout(s, 300))
  assert.equal((await settle(r2.request)).status, 'started')
  assert.equal(starts(moon).length, before + 1)
})

test('PrusaLink with a username and password: digest login, and a wrong password is named', async () => {
  const prusa2 = await fakeHttp('prusalink', { user: 'maker', password: 'Secr3tPass' })
  try {
    await ok('printer_add', { name: 'CoreOne', kind: 'prusalink', host: `127.0.0.1:${prusa2.port}`, user: 'maker' })
    await setSecret('printer:CoreOne', 'wrong', env)
    assert.match((await call('printer_test', { name: 'CoreOne' })).text, /password is missing or wrong/)
    await setSecret('printer:CoreOne', 'Secr3tPass', env)
    await ok('printer_test', { name: 'CoreOne' })
    await ok('printer_upload', { printer: 'CoreOne', file: join(dir, 'part.gcode') })
    assert.ok(prusa2.seen.files.has('part.gcode'))
    const r = await ok('printer_start', { printer: 'CoreOne' })
    await answer(r.request, 'start')
    assert.equal((await settle(r.request)).status, 'started')
    assert.equal(starts(prusa2).length, 1)
    assert.ok(prusa2.seen.calls.every((c) => !c.headers['x-api-key']), 'no API key header with a password login')
    const d = digest('u', 'p')
    assert.equal(typeof d.request, 'function')
  } finally {
    prusa2.close()
  }
})

test('a Bambu camera: one JPEG off port 6000 with the access code; a wrong code says so; RTSP needs ffmpeg', async () => {
  const cam = await fakeBambuCamera({ accessCode: SECRETS.bambu })
  try {
    const img = await bambuJpeg('127.0.0.1', cam.port, SECRETS.bambu)
    assert.deepEqual([...img], [...cam.jpeg])
    assert.deepEqual(cam.seen.logins[0], { head: [0x40, 0x3000], user: 'bblp', ok: true })
    await assert.rejects(bambuJpeg('127.0.0.1', cam.port, 'nope'), /access code/)
    const conf = JSON.parse(await readFile(join(env.SCANRULER_HOME, 'printers.json'), 'utf8'))
    const x1 = conf.printers.find((p) => p.name === 'X1C')
    Object.assign(x1, { model: 'P1S', cameraPort: cam.port, fingerprint: undefined })
    await writeFile(join(env.SCANRULER_HOME, 'printers.json'), JSON.stringify(conf))
    const shot = await call('printer_camera', { name: 'X1C' })
    assert.equal(shot.content[0].type, 'image')
    assert.equal(shot.content[0].mimeType, 'image/jpeg')
    await assert.rejects(rtspFrame('rtsps://bblp:x@127.0.0.1:1/streaming/live/1', 'no-such-ffmpeg-here'), /needs ffmpeg/)
  } finally {
    cam.close()
  }
})

test('no answer ever carries a secret, and printer_list says only whether one is set', async () => {
  const list = await ok('printer_list')
  assert.deepEqual(list.printers.filter((p) => p.secret).map((p) => [p.name, p.secret]), [
    ['X1C', 'set'],
    ['Voron', 'set'],
    ['Ender', 'set'],
    ['MK4', 'set'],
    ['CoreOne', 'set'],
  ])
  const all = said.join('\n')
  for (const s of Object.values(SECRETS)) assert.ok(!all.includes(s), `a secret leaked: ${s}`)
  assert.ok(!all.includes('/confirm/'), 'no confirmation address leaked')
  const conf = await readFile(join(env.SCANRULER_HOME, 'printers.json'), 'utf8')
  for (const s of Object.values(SECRETS)) assert.ok(!conf.includes(s), 'printers.json holds no secret')
})
