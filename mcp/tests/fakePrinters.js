// SPDX-License-Identifier: AGPL-3.0-only
// Stand-in printers for the printer extras' tests: a Bambu Lab printer's
// MQTT broker and FTPS server over TLS with a throwaway self-signed
// certificate, and Moonraker, OctoPrint and PrusaLink over HTTP. Each
// records what it was sent, so a test can prove nothing started.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import http from 'node:http'
import tls from 'node:tls'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packet, parse, readPublish } from '../src/extras/printers/mqtt.js'

/** A fresh self-signed certificate, made with openssl for this run only. */
export function throwawayCert(cn = 'fake-printer') {
  const dir = mkdtempSync(join(tmpdir(), 'scanruler-cert-'))
  const key = join(dir, 'key.pem')
  const cert = join(dir, 'cert.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', `/CN=${cn}`], { stdio: 'ignore' })
  return { key: readFileSync(key), cert: readFileSync(cert) }
}

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

const readStr = (b, o) => {
  const n = b.readUInt16BE(o)
  return [b.subarray(o + 2, o + 2 + n).toString('utf8'), o + 2 + n]
}

export async function fakeBambu({ accessCode = '12345678', serial = '01P00A000000001', creds = throwawayCert() } = {}) {
  const seen = { requests: [], files: new Map(), state: 'IDLE', subtask: '' }
  const report = (sock, print) => sock.write(packet(0x30, Buffer.concat([Buffer.from([0, `device/${serial}/report`.length]), Buffer.from(`device/${serial}/report`), Buffer.from(JSON.stringify({ print }))])))
  const mqtt = tls.createServer(creds, (sock) => {
    let buf = Buffer.alloc(0)
    sock.on('error', () => {})
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      const { packets, rest } = parse(buf)
      buf = rest
      for (const p of packets) {
        if (p.type === 1) {
          let [, o] = readStr(p.body, 0)
          const flags = p.body[o + 1]
          o += 4
          ;[, o] = readStr(p.body, o)
          let user = '', pass = ''
          if (flags & 0x80) [user, o] = readStr(p.body, o)
          if (flags & 0x40) [pass, o] = readStr(p.body, o)
          sock.write(Buffer.from([0x20, 2, 0, user === 'bblp' && pass === accessCode ? 0 : 4]))
        } else if (p.type === 8) sock.write(Buffer.from([0x90, 3, p.body[0], p.body[1], 0]))
        else if (p.type === 3) {
          const { topic, payload } = readPublish(p.body)
          if (topic !== `device/${serial}/request`) continue
          const j = JSON.parse(payload.toString('utf8'))
          seen.requests.push(j)
          if (j.pushing?.command === 'pushall') report(sock, { gcode_state: seen.state, mc_percent: seen.state === 'RUNNING' ? 12 : 0, mc_remaining_time: seen.state === 'RUNNING' ? 47 : 0, subtask_name: seen.subtask, layer_num: 3, total_layer_num: 120, nozzle_temper: 220, bed_temper: 60 })
          const cmd = j.print?.command
          if (cmd) {
            if (cmd === 'project_file' || cmd === 'gcode_file') {
              seen.state = 'RUNNING'
              seen.subtask = j.print.subtask_name ?? j.print.param
            } else if (cmd === 'pause') seen.state = 'PAUSE'
            else if (cmd === 'resume') seen.state = 'RUNNING'
            else if (cmd === 'stop') seen.state = 'IDLE'
            report(sock, { command: cmd, result: 'success', sequence_id: j.print.sequence_id })
          }
        } else if (p.type === 14) sock.end()
      }
    })
  })
  const ftp = tls.createServer({ ...creds, sessionTimeout: 300 }, (sock) => {
    sock.on('error', () => {})
    const say = (l) => sock.write(`${l}\r\n`)
    let user = ''
    let authed = false
    let data = null
    say('220 fake printer')
    let line = ''
    sock.on('data', (d) => {
      line += d.toString('utf8')
      let i
      while ((i = line.indexOf('\r\n')) >= 0) {
        const cmd = line.slice(0, i)
        line = line.slice(i + 2)
        const [verb, ...rest] = cmd.split(' ')
        const arg = rest.join(' ')
        if (verb === 'USER') {
          user = arg
          say('331 password')
        } else if (verb === 'PASS') {
          authed = user === 'bblp' && arg === accessCode
          say(authed ? '230 in' : '530 no')
        } else if (!authed) say('530 log in first')
        else if (['PBSZ', 'PROT', 'TYPE'].includes(verb)) say('200 ok')
        else if (verb === 'PASV') {
          data = { chunks: [], done: null }
          const ds = tls.createServer(creds, (s) => {
            s.on('data', (c) => data.chunks.push(c))
            s.on('end', () => data.done?.())
            s.on('error', () => {})
          })
          ds.listen(0, '127.0.0.1', () => {
            const port = ds.address().port
            data.server = ds
            say(`227 Entering Passive Mode (127,0,0,1,${port >> 8},${port & 255})`)
          })
        } else if (verb === 'STOR') {
          say('150 go')
          const d0 = data
          d0.done = () => {
            seen.files.set(arg, Buffer.concat(d0.chunks))
            d0.server.close()
            say('226 stored')
          }
        } else if (verb === 'QUIT') {
          say('221 bye')
          sock.end()
        } else say('502 no')
      }
    })
  })
  const mqttPort = await listen(mqtt)
  const ftpPort = await listen(ftp)
  return { seen, mqttPort, ftpPort, serial, accessCode, close: () => (mqtt.close(), ftp.close()) }
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c60000000049454e44ae426082', 'hex')

async function body(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

/** Moonraker, OctoPrint or PrusaLink, as far as the adapters use them. */
export async function fakeHttp(kind, { key = 'k-123', user = null, password = null } = {}) {
  const seen = { calls: [], files: new Map(), state: 'idle' }
  const server = http.createServer(async (req, res) => {
    const b = await body(req)
    const url = new URL(req.url, 'http://x')
    const json = (code, v) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(v))
    if (user) {
      const auth = req.headers.authorization ?? ''
      const v = Object.fromEntries([...auth.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)].map((m) => [m[1], m[2] ?? m[3]]))
      const md5 = (x) => createHash('md5').update(x).digest('hex')
      const want = v.nonce === 'n0nce' && md5(`${md5(`${user}:Printer API:${password}`)}:${v.nonce}:${v.nc}:${v.cnonce}:auth:${md5(`${req.method}:${v.uri}`)}`) === v.response
      if (!auth.startsWith('Digest ') || !want) return res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="Printer API", nonce="n0nce", qop="auth"' }).end()
    } else if (key && req.headers['x-api-key'] !== key && kind !== 'moonraker-open') return json(kind === 'octoprint' ? 403 : 401, { error: 'key' })
    seen.calls.push({ method: req.method, path: url.pathname, query: url.search, headers: req.headers, body: b })
    const multipartName = () => /filename="([^"]+)"/.exec(b.toString('latin1'))?.[1]
    if (kind.startsWith('moonraker')) {
      if (url.pathname === '/printer/info') return json(200, { result: { state: 'ready', software_version: 'v0.12-fake' } })
      if (url.pathname === '/printer/objects/query') return json(200, { result: { status: { print_stats: { state: seen.state === 'printing' ? 'printing' : 'standby', filename: seen.file ?? '' }, display_status: { progress: seen.state === 'printing' ? 0.3 : 0 }, extruder: { temperature: 210 }, heater_bed: { temperature: 60 } } } })
      if (url.pathname === '/server/files/upload') {
        seen.files.set(multipartName(), b)
        return json(201, { result: { item: { path: multipartName() } } })
      }
      if (url.pathname === '/printer/print/start') {
        seen.state = 'printing'
        seen.file = url.searchParams.get('filename')
        return json(200, { result: 'ok' })
      }
      if (url.pathname === '/printer/print/pause') return (seen.state = 'paused'), json(200, { result: 'ok' })
      if (url.pathname === '/printer/print/resume') return (seen.state = 'printing'), json(200, { result: 'ok' })
      if (url.pathname === '/printer/print/cancel') return (seen.state = 'idle'), json(200, { result: 'ok' })
      if (url.pathname === '/server/webcams/list') return json(200, { result: { webcams: [{ enabled: true, snapshot_url: '/webcam/?action=snapshot' }] } })
      if (url.pathname === '/webcam/') return res.writeHead(200, { 'Content-Type': 'image/png' }).end(PNG)
    }
    if (kind === 'octoprint') {
      if (url.pathname === '/api/version') return json(200, { text: 'OctoPrint 1.10.0-fake' })
      if (url.pathname === '/api/job' && req.method === 'GET') return json(200, { state: seen.state === 'printing' ? 'Printing' : 'Operational', progress: { completion: seen.state === 'printing' ? 30 : null, printTimeLeft: 600 }, job: { file: { name: seen.file ?? null } } })
      if (url.pathname === '/api/printer') return json(200, { temperature: { tool0: { actual: 205 }, bed: { actual: 58 } } })
      if (url.pathname === '/api/files/local' && req.method === 'POST') {
        seen.files.set(multipartName(), b)
        return json(201, { done: true })
      }
      if (url.pathname.startsWith('/api/files/local/')) {
        const j = JSON.parse(b.toString() || '{}')
        if (j.command === 'select' && j.print) {
          seen.state = 'printing'
          seen.file = decodeURIComponent(url.pathname.split('/').pop())
        }
        return res.writeHead(204).end()
      }
      if (url.pathname === '/api/job' && req.method === 'POST') {
        const j = JSON.parse(b.toString())
        seen.state = j.command === 'cancel' ? 'idle' : j.action === 'pause' ? 'paused' : 'printing'
        return res.writeHead(204).end()
      }
      if (url.pathname === '/webcam/') return res.writeHead(200, { 'Content-Type': 'image/png' }).end(PNG)
    }
    if (kind === 'prusalink') {
      if (url.pathname === '/api/version') return json(200, { server: '2.1.2-fake' })
      if (url.pathname === '/api/v1/status') return json(200, { printer: { state: seen.state === 'printing' ? 'PRINTING' : 'IDLE', temp_nozzle: 215, temp_bed: 60 }, ...(seen.state !== 'idle' ? { job: { id: 7, progress: 22, time_remaining: 1800 } } : {}) })
      if (url.pathname.startsWith('/api/v1/files/') && req.method === 'PUT') {
        seen.files.set(decodeURIComponent(url.pathname.split('/').pop()), b)
        return res.writeHead(201).end()
      }
      if (url.pathname.startsWith('/api/v1/files/') && req.method === 'POST') {
        seen.state = 'printing'
        seen.file = decodeURIComponent(url.pathname.split('/').pop())
        return res.writeHead(204).end()
      }
      if (url.pathname === '/api/v1/job/7/pause') return (seen.state = 'paused'), res.writeHead(204).end()
      if (url.pathname === '/api/v1/job/7' && req.method === 'DELETE') return (seen.state = 'idle'), res.writeHead(204).end()
    }
    json(404, { error: 'no route' })
  })
  const port = await listen(server)
  return { seen, port, key, close: () => server.close() }
}

/** Every start command a fake was sent. */
export function starts(fake) {
  if (fake.seen.requests) return fake.seen.requests.filter((r) => ['project_file', 'gcode_file'].includes(r.print?.command))
  return fake.seen.calls.filter((c) => c.path === '/printer/print/start' || (c.path.startsWith('/api/files/local/') && c.method === 'POST') || (c.path.startsWith('/api/v1/files/') && c.method === 'POST'))
}

/** A P1 / A1 camera on its port 6000: checks the 80-byte login, then sends one frame. */
export async function fakeBambuCamera({ accessCode = '12345678', creds = throwawayCert() } = {}) {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xd9])
  const seen = { logins: [] }
  const server = tls.createServer(creds, (sock) => {
    sock.on('error', () => {})
    let buf = Buffer.alloc(0)
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      if (buf.length < 80) return
      const user = buf.subarray(16, 48).toString('ascii').replace(/\0+$/, '')
      const code = buf.subarray(48, 80).toString('ascii').replace(/\0+$/, '')
      seen.logins.push({ head: [buf.readUInt32LE(0), buf.readUInt32LE(4)], user, ok: code === accessCode })
      if (code !== accessCode) return sock.end()
      const h = Buffer.alloc(16)
      h.writeUInt32LE(jpeg.length, 0)
      sock.write(Buffer.concat([h, jpeg]))
    })
  })
  const port = await listen(server)
  return { port, seen, jpeg, close: () => server.close() }
}
