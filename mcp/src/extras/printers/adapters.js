// SPDX-License-Identifier: AGPL-3.0-only
// One adapter per way of reaching a printer. Each can test, read status,
// upload, start, pause, resume, stop and (where it can) take a snapshot.
// start is only ever called once a person has confirmed it (confirm.js).

import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import tls from 'node:tls'
import { existsSync } from 'node:fs'
import { access, copyFile, readdir, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import { upload as ftpsUpload } from './ftps.js'
import { Mqtt } from './mqtt.js'

export const KINDS = {
  'bambu-studio': { label: 'Bambu Studio hand-off', needs: [], secret: null, starts: 'you, in Bambu Studio', note: 'Opens the sliced 3MF in Bambu Studio on this computer; you send it to the printer there.' },
  'bambu-lan': { label: 'Bambu Lab printer on the LAN', needs: ['host', 'serial'], secret: 'the access code from the printer’s screen', starts: 'after you confirm', note: 'Needs LAN Only and Developer Mode on the printer (Settings → Network). The printer then takes commands from the local network without Bambu’s cloud.' },
  moonraker: { label: 'Klipper (Moonraker)', needs: ['host'], secret: 'an API key, if Moonraker asks for one', starts: 'after you confirm', note: 'HTTP API.' },
  octoprint: { label: 'OctoPrint', needs: ['host'], secret: 'an API key (OctoPrint → Settings → Application Keys)', starts: 'after you confirm', note: 'REST API.' },
  prusalink: { label: 'PrusaLink', needs: ['host'], secret: 'the password (with user, usually "maker") or the API key shown in PrusaLink settings', starts: 'after you confirm', note: 'HTTP API: digest login when user is set (newer firmware), X-Api-Key otherwise.' },
  folder: { label: 'A folder or SD card', needs: ['folder'], secret: null, starts: 'you, at the printer', note: 'Copies the file there.' },
}

const base = (p, fallbackPort) => {
  const h = String(p.host ?? '')
  if (/^https?:\/\//.test(h)) return h.replace(/\/$/, '')
  return `http://${h}${p.port ? `:${p.port}` : fallbackPort ? `:${fallbackPort}` : ''}`
}

async function http(url, { method = 'GET', headers = {}, body, timeoutMs = 15_000, via } = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = via ? await via.request(url, { method, headers, body, signal: ctl.signal }) : await fetch(url, { method, headers, body, signal: ctl.signal })
    const type = r.headers.get('content-type') ?? ''
    const data = type.includes('json') ? await r.json().catch(() => null) : type.startsWith('image/') ? new Uint8Array(await r.arrayBuffer()) : await r.text()
    if (!r.ok) throw new Error(`${method} ${new URL(url).pathname} answered ${r.status}${r.status === 401 || r.status === 403 ? ' — the API key or password is missing or wrong' : ''}${typeof data === 'string' && data ? `: ${data.slice(0, 160)}` : ''}`)
    return { data, type }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`${new URL(url).host} did not answer in ${timeoutMs / 1000} s.`)
    if (e.cause?.code) throw new Error(`${new URL(url).host}: ${e.cause.code}`)
    throw e
  } finally {
    clearTimeout(t)
  }
}

const md5 = (s) => createHash('md5').update(s).digest('hex')

/** HTTP Digest (RFC 7616, MD5) for PrusaLink's username and password: the
 *  challenge read from a 401, then each request signed with it. */
export function digest(user, password) {
  let challenge = null
  let nc = 0
  const sign = (method, url) => {
    if (!challenge) return {}
    const uri = new URL(url).pathname + new URL(url).search
    const ha1 = md5(`${user}:${challenge.realm}:${password}`)
    const ha2 = md5(`${method}:${uri}`)
    const qop = /\bauth\b/.test(challenge.qop ?? '') ? 'auth' : null
    const cnonce = randomBytes(8).toString('hex')
    const n = (++nc).toString(16).padStart(8, '0')
    const response = qop ? md5(`${ha1}:${challenge.nonce}:${n}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${challenge.nonce}:${ha2}`)
    return { Authorization: `Digest username="${user}", realm="${challenge.realm}", nonce="${challenge.nonce}", uri="${uri}", response="${response}"${challenge.opaque ? `, opaque="${challenge.opaque}"` : ''}${qop ? `, qop=${qop}, nc=${n}, cnonce="${cnonce}"` : ''}` }
  }
  const read = (h) => {
    if (!h || !/^Digest /i.test(h)) return false
    const v = {}
    for (const m of h.slice(7).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) v[m[1].toLowerCase()] = m[2] ?? m[3]
    challenge = v
    nc = 0
    return true
  }
  return {
    async request(url, opts = {}) {
      const go = () => fetch(url, { ...opts, headers: { ...(opts.headers ?? {}), ...sign(opts.method ?? 'GET', url) } })
      let r = await go()
      if (r.status === 401 && read(r.headers.get('www-authenticate'))) r = await go()
      return r
    },
  }
}

const form = async (file) => {
  const f = new FormData()
  f.append('file', new Blob([await readFile(file)]), basename(file))
  return f
}

/** The TLS check for a printer's self-signed certificate: its SHA-256
 *  fingerprint is pinned the first time (printer_test) and must match after. */
const pin = (p, seen) => ({
  check: (socket) => {
    const fp = socket.getPeerCertificate()?.fingerprint256
    if (p.fingerprint && fp !== p.fingerprint) throw new Error(`${p.name}'s certificate is not the one first seen (${fp} ≠ ${p.fingerprint}). If the printer was reset, run printer_test { trust: true } to pin the new one.`)
    seen.fingerprint = fp
  },
})

const BAMBU_STATE = { IDLE: 'idle', RUNNING: 'printing', PAUSE: 'paused', FINISH: 'finished', FAILED: 'failed', PREPARE: 'preparing', SLICING: 'preparing' }

function bambu(p, secret) {
  if (!secret) throw new Error(`${p.name} has no access code yet. In a terminal: node mcp/src/extras/secrets.js set printer:${p.name}`)
  const seen = {}
  const topicReport = `device/${p.serial}/report`
  const topicRequest = `device/${p.serial}/request`
  const session = async (fn) => {
    const m = await Mqtt.connect({ host: p.host, port: p.mqttPort ?? 8883, username: 'bblp', password: secret, tlsOptions: pin(p, seen) })
    try {
      m.subscribe(topicReport)
      return await fn(m)
    } finally {
      m.end()
    }
  }
  const command = (cmd, extra = {}) => session(async (m) => {
    m.publish(topicRequest, { print: { sequence_id: String(Date.now() % 100000), command: cmd, ...extra } })
    const ack = await m.next(topicReport, (j) => j.print?.command === cmd, 5000)
    return { sent: cmd, ...(ack ? { acknowledged: ack.print.result ?? true } : { acknowledged: false, note: 'No reply in 5 s; printer_status shows what it is doing.' }) }
  })
  return {
    seen,
    async test() {
      const s = await this.status()
      return { ok: true, state: s.state, fingerprint: seen.fingerprint }
    },
    async status() {
      return session(async (m) => {
        m.publish(topicRequest, { pushing: { sequence_id: '0', command: 'pushall' } })
        const j = await m.next(topicReport, (x) => x.print && 'gcode_state' in x.print)
        if (!j) throw new Error(`${p.name} answered on MQTT but sent no status in 8 s.`)
        const s = j.print
        return { state: BAMBU_STATE[s.gcode_state] ?? String(s.gcode_state).toLowerCase(), percent: s.mc_percent ?? null, remainingMin: s.mc_remaining_time ?? null, file: s.subtask_name || s.gcode_file || null, layer: s.layer_num != null ? `${s.layer_num}/${s.total_layer_num ?? '?'}` : null, nozzleC: s.nozzle_temper ?? null, bedC: s.bed_temper ?? null, ...(s.print_error ? { error: s.print_error } : {}) }
      })
    },
    async upload(file) {
      const name = basename(file)
      return ftpsUpload({ host: p.host, port: p.ftpPort ?? 990, password: secret, name, data: await readFile(file), tlsOptions: pin(p, seen) })
    },
    async start(name) {
      if (name.toLowerCase().endsWith('.3mf'))
        return command('project_file', { param: p.plate ?? 'Metadata/plate_1.gcode', subtask_name: name.replace(/\.3mf$/i, ''), url: `${p.startUrl ?? 'ftp:///'}${name}`, bed_type: 'auto', timelapse: false, bed_leveling: true, flow_cali: false, vibration_cali: true, layer_inspect: false, use_ams: Boolean(p.useAms), ams_mapping: p.amsMapping ?? [0], project_id: '0', profile_id: '0', task_id: '0', subtask_id: '0' })
      return command('gcode_file', { param: `/sdcard/${name}` })
    },
    pause: () => command('pause'),
    resume: () => command('resume'),
    stop: () => command('stop'),
    async camera() {
      const how = p.camera ?? (/^(p1|a1)/i.test(p.model ?? '') ? 'jpeg' : 'rtsp')
      if (how === 'jpeg') return { mimeType: 'image/jpeg', bytes: await bambuJpeg(p.host, p.cameraPort ?? 6000, secret, pin(p, seen)) }
      if (how === 'rtsp') return { mimeType: 'image/jpeg', bytes: await rtspFrame(`rtsps://bblp:${encodeURIComponent(secret)}@${p.host}:${p.cameraPort ?? 322}/streaming/live/1`, p.ffmpeg) }
      throw new Error(`${p.name} has camera: "none".`)
    },
  }
}

/** One JPEG off a P1 or A1's camera: TLS on port 6000, an 80-byte login
 *  (0x40, 0x3000, 0, 0, then "bblp" and the access code, 32 bytes each),
 *  then frames of a 16-byte header (payload length first) and a JPEG. */
export function bambuJpeg(host, port, code, tlsOptions = {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, rejectUnauthorized: false, ...tlsOptions })
    let buf = Buffer.alloc(0)
    const done = (e, v) => {
      clearTimeout(t)
      sock.destroy()
      e ? reject(e) : resolve(v)
    }
    const t = setTimeout(() => done(new Error(`No picture from ${host}:${port} in ${timeoutMs / 1000} s.`)), timeoutMs)
    sock.once('error', (e) => done(new Error(`Camera at ${host}:${port}: ${e.message}`)))
    sock.once('secureConnect', () => {
      try {
        tlsOptions.check?.(sock)
      } catch (e) {
        return done(e)
      }
      const auth = Buffer.alloc(80)
      auth.writeUInt32LE(0x40, 0)
      auth.writeUInt32LE(0x3000, 4)
      auth.write('bblp', 16, 'ascii')
      auth.write(String(code), 48, 'ascii')
      sock.write(auth)
    })
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      if (buf.length < 16) return
      const len = buf.readUInt32LE(0)
      if (len === 0 || len > 20_000_000) return done(new Error('The camera sent no picture (is the access code right?).'))
      if (buf.length < 16 + len) return
      const jpg = buf.subarray(16, 16 + len)
      if (jpg[0] !== 0xff || jpg[1] !== 0xd8) return done(new Error('The camera sent something that is not a JPEG.'))
      done(null, new Uint8Array(jpg))
    })
    sock.on('close', () => done(new Error('The camera closed the connection (the access code may be wrong).')))
  })
}

/** One frame of an RTSP stream (X1, H2D: rtsps on port 322), through ffmpeg
 *  if it is installed. */
export function rtspFrame(url, ffmpeg = 'ffmpeg', timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', url, '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const out = []
    let err = ''
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(t)
      reject(new Error(e.code === 'ENOENT' ? 'This camera streams over RTSP; a snapshot needs ffmpeg (brew install ffmpeg).' : e.message))
    })
    child.on('close', (code) => {
      clearTimeout(t)
      const jpg = Buffer.concat(out)
      if (code === 0 && jpg[0] === 0xff && jpg[1] === 0xd8) resolve(new Uint8Array(jpg))
      else reject(new Error(`No picture from the RTSP stream${err ? `: ${err.replace(/rtsps:\/\/[^@\s]*@/g, 'rtsps://…@').trim().split('\n').pop()}` : ''}.`))
    })
  })
}

function moonraker(p, secret) {
  const u = base(p)
  const headers = secret ? { 'X-Api-Key': secret } : {}
  return {
    async test() {
      const r = await http(`${u}/printer/info`, { headers })
      return { ok: true, state: r.data?.result?.state ?? null, software: r.data?.result?.software_version ?? null }
    },
    async status() {
      const r = await http(`${u}/printer/objects/query?print_stats&display_status&extruder&heater_bed`, { headers })
      const s = r.data?.result?.status ?? {}
      return { state: { standby: 'idle', printing: 'printing', paused: 'paused', complete: 'finished', error: 'failed', cancelled: 'idle' }[s.print_stats?.state] ?? s.print_stats?.state ?? null, percent: s.display_status?.progress != null ? Math.round(s.display_status.progress * 100) : null, file: s.print_stats?.filename || null, nozzleC: s.extruder?.temperature ?? null, bedC: s.heater_bed?.temperature ?? null }
    },
    async upload(file) {
      await http(`${u}/server/files/upload`, { method: 'POST', headers, body: await form(file), timeoutMs: 300_000 })
      return { name: basename(file), bytes: (await stat(file)).size }
    },
    start: async (name) => (await http(`${u}/printer/print/start?filename=${encodeURIComponent(name)}`, { method: 'POST', headers }), { sent: 'start' }),
    pause: async () => (await http(`${u}/printer/print/pause`, { method: 'POST', headers }), { sent: 'pause' }),
    resume: async () => (await http(`${u}/printer/print/resume`, { method: 'POST', headers }), { sent: 'resume' }),
    stop: async () => (await http(`${u}/printer/print/cancel`, { method: 'POST', headers }), { sent: 'stop' }),
    async camera() {
      const list = await http(`${u}/server/webcams/list`, { headers }).catch(() => null)
      const snap = list?.data?.result?.webcams?.find((w) => w.enabled !== false)?.snapshot_url ?? '/webcam/?action=snapshot'
      const r = await http(snap.startsWith('http') ? snap : `${u}${snap}`, { headers })
      if (!(r.data instanceof Uint8Array)) throw new Error('The webcam gave no picture.')
      return { mimeType: r.type.split(';')[0], bytes: r.data }
    },
  }
}

function octoprint(p, secret) {
  const u = base(p)
  if (!secret) throw new Error(`${p.name} has no API key yet. In a terminal: node mcp/src/extras/secrets.js set printer:${p.name}`)
  const headers = { 'X-Api-Key': secret }
  const json = { ...headers, 'Content-Type': 'application/json' }
  return {
    async test() {
      const r = await http(`${u}/api/version`, { headers })
      return { ok: true, software: r.data?.text ?? null }
    },
    async status() {
      const j = (await http(`${u}/api/job`, { headers })).data ?? {}
      const pr = (await http(`${u}/api/printer`, { headers }).catch(() => ({ data: {} }))).data ?? {}
      const st = String(j.state ?? '').toLowerCase()
      return { state: st.startsWith('printing') ? 'printing' : st.startsWith('paused') ? 'paused' : st.startsWith('operational') ? 'idle' : st || null, percent: j.progress?.completion != null ? Math.round(j.progress.completion) : null, remainingMin: j.progress?.printTimeLeft != null ? Math.round(j.progress.printTimeLeft / 60) : null, file: j.job?.file?.name ?? null, nozzleC: pr.temperature?.tool0?.actual ?? null, bedC: pr.temperature?.bed?.actual ?? null }
    },
    async upload(file) {
      await http(`${u}/api/files/local`, { method: 'POST', headers, body: await form(file), timeoutMs: 300_000 })
      return { name: basename(file), bytes: (await stat(file)).size }
    },
    start: async (name) => (await http(`${u}/api/files/local/${encodeURIComponent(name)}`, { method: 'POST', headers: json, body: JSON.stringify({ command: 'select', print: true }) }), { sent: 'start' }),
    pause: async () => (await http(`${u}/api/job`, { method: 'POST', headers: json, body: JSON.stringify({ command: 'pause', action: 'pause' }) }), { sent: 'pause' }),
    resume: async () => (await http(`${u}/api/job`, { method: 'POST', headers: json, body: JSON.stringify({ command: 'pause', action: 'resume' }) }), { sent: 'resume' }),
    stop: async () => (await http(`${u}/api/job`, { method: 'POST', headers: json, body: JSON.stringify({ command: 'cancel' }) }), { sent: 'stop' }),
    async camera() {
      const r = await http(`${u}/webcam/?action=snapshot`, { headers })
      if (!(r.data instanceof Uint8Array)) throw new Error('The webcam gave no picture.')
      return { mimeType: r.type.split(';')[0], bytes: r.data }
    },
  }
}

function prusalink(p, secret) {
  const u = base(p)
  if (!secret) throw new Error(`${p.name} has no ${p.user ? 'password' : 'API key'} yet. In a terminal: node mcp/src/extras/secrets.js set printer:${p.name}`)
  const via = p.user ? digest(p.user, secret) : undefined
  const headers = p.user ? {} : { 'X-Api-Key': secret }
  const call = (url, o = {}) => http(url, { ...o, via })
  const storage = p.storage ?? 'usb'
  const jobId = async () => {
    const s = (await call(`${u}/api/v1/status`, { headers })).data ?? {}
    if (!s.job?.id) throw new Error('There is no job running.')
    return s.job.id
  }
  return {
    async test() {
      const r = await call(`${u}/api/version`, { headers })
      return { ok: true, software: r.data?.server ?? r.data?.text ?? null }
    },
    async status() {
      const s = (await call(`${u}/api/v1/status`, { headers })).data ?? {}
      return { state: String(s.printer?.state ?? '').toLowerCase().replace('printing', 'printing') || null, percent: s.job?.progress ?? null, remainingMin: s.job?.time_remaining != null ? Math.round(s.job.time_remaining / 60) : null, nozzleC: s.printer?.temp_nozzle ?? null, bedC: s.printer?.temp_bed ?? null }
    },
    async upload(file) {
      await call(`${u}/api/v1/files/${storage}/${encodeURIComponent(basename(file))}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Overwrite-File': '?1', 'Print-After-Upload': '?0' }, body: await readFile(file), timeoutMs: 300_000 })
      return { name: basename(file), bytes: (await stat(file)).size }
    },
    start: async (name) => (await call(`${u}/api/v1/files/${storage}/${encodeURIComponent(name)}`, { method: 'POST', headers }), { sent: 'start' }),
    pause: async () => (await call(`${u}/api/v1/job/${await jobId()}/pause`, { method: 'PUT', headers }), { sent: 'pause' }),
    resume: async () => (await call(`${u}/api/v1/job/${await jobId()}/resume`, { method: 'PUT', headers }), { sent: 'resume' }),
    stop: async () => (await call(`${u}/api/v1/job/${await jobId()}`, { method: 'DELETE', headers }), { sent: 'stop' }),
    async camera() {
      throw new Error('PrusaLink has no snapshot here; Prusa Connect shows the camera.')
    },
  }
}

function folder(p) {
  const dir = p.folder
  return {
    async test() {
      if (!dir || !existsSync(dir)) throw new Error(`There is no folder at ${dir} — is the card in?`)
      await access(dir, constants.W_OK)
      return { ok: true }
    },
    async status() {
      const files = existsSync(dir) ? (await readdir(dir)).filter((f) => /\.(gcode|bgcode|3mf)$/i.test(f)) : null
      return { state: files ? 'ready' : 'missing', files: files?.slice(0, 20) ?? [] }
    },
    async upload(file) {
      const to = join(dir, basename(file))
      await copyFile(file, to)
      return { name: basename(file), path: to, bytes: (await stat(file)).size }
    },
    start: async () => {
      throw new Error('A folder printer is started at the printer.')
    },
    pause: async () => {
      throw new Error('A folder printer is paused at the printer.')
    },
    resume: async () => {
      throw new Error('A folder printer is resumed at the printer.')
    },
    stop: async () => {
      throw new Error('A folder printer is stopped at the printer.')
    },
    camera: async () => {
      throw new Error('A folder printer has no camera.')
    },
  }
}

function bambuStudio(p, env, platform) {
  const open = (file) =>
    new Promise((resolve, reject) => {
      const [cmd, args] = env.SCANRULER_OPENER ? [env.SCANRULER_OPENER, [file]] : platform === 'darwin' ? ['open', ['-a', p.app ?? 'BambuStudio', file]] : [p.app ?? 'bambu-studio', [file]]
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
      child.on('error', (e) => reject(new Error(`Bambu Studio could not be opened: ${e.message}`)))
      child.on('spawn', () => {
        child.unref()
        resolve()
      })
    })
  const no = (what) => async () => {
    throw new Error(`Bambu Studio hand-off: ${what} in Bambu Studio or on the printer.`)
  }
  return {
    test: async () => ({ ok: true, note: 'Nothing to test: the file opens in Bambu Studio.' }),
    status: no('see the status'),
    async upload(file) {
      if (!file.toLowerCase().endsWith('.3mf')) throw new Error('Bambu Studio opens the sliced 3MF; slice with Bambu Studio or OrcaSlicer first.')
      await open(file)
      return { name: basename(file), opened: 'Bambu Studio', next: 'Press Print in Bambu Studio to send it.' }
    },
    start: no('press Print'),
    pause: no('pause'),
    resume: no('resume'),
    stop: no('stop'),
    camera: no('look at the camera'),
  }
}

export function adapterFor(p, secret, env = process.env, platform = process.platform) {
  switch (p.kind) {
    case 'bambu-lan':
      return bambu(p, secret)
    case 'moonraker':
      return moonraker(p, secret)
    case 'octoprint':
      return octoprint(p, secret)
    case 'prusalink':
      return prusalink(p, secret)
    case 'folder':
      return folder(p)
    case 'bambu-studio':
      return bambuStudio(p, env, platform)
    default:
      throw new Error(`No adapter "${p.kind}" — kinds: ${Object.keys(KINDS).join(', ')}.`)
  }
}
