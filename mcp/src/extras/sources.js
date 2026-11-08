// SPDX-License-Identifier: AGPL-3.0-only
// The catalogue connections that need an account: McMaster-Carr's Product
// Information API (an approved customer's client certificate, user name and
// password) and the TraceParts API Gateway (a tenant id and API key). Both
// are off until the person sets them up: catalog.json in the ScanRuler
// folder says which are on and where the certificate is; the passwords and
// keys are in the Keychain (secrets.js), never in a tool's answer. A CAD
// file fetched comes into the imports folder like any download, recorded
// as not to be shared on — both sources' terms are for designing with
// their parts.

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import https from 'node:https'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { take } from './catalog.js'
import { getSecret, hasSecret } from './secrets.js'
import { home } from './slicer.js'

const tilde = (p) => (typeof p === 'string' && p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

export async function loadSources(env = process.env) {
  const file = join(home(env), 'catalog.json')
  let c = {}
  if (existsSync(file)) {
    try {
      c = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      throw new Error(`${file} is not valid JSON — fix it by hand, or delete it and set the sources up again (catalog_source).`)
    }
  }
  const one = (v) => (v && typeof v === 'object' ? { ...v, enabled: v.enabled === true, ...(v.certPath ? { certPath: tilde(v.certPath) } : {}) } : null)
  return { file, mcmaster: one(c?.mcmaster), traceparts: one(c?.traceparts) }
}

export async function saveSources(patch, env = process.env) {
  const { file, mcmaster, traceparts } = await loadSources(env)
  const next = { mcmaster, traceparts, ...patch }
  await mkdir(home(env), { recursive: true })
  await writeFile(file, JSON.stringify(next, null, 2))
  return file
}

export async function sourcesStatus(env = process.env) {
  const s = await loadSources(env)
  const m = s.mcmaster
  const t = s.traceparts
  return {
    file: s.file,
    mcmaster: m?.enabled
      ? { on: true, certificate: m.certPath ? (existsSync(m.certPath) ? 'found' : `missing at ${m.certPath}`) : 'not set', user: m.user ?? 'not set', password: (await hasSecret('mcmaster:password', env)) ? 'set' : 'not set', certificatePassword: (await hasSecret('mcmaster:certificate', env)) ? 'set' : 'not set' }
      : { on: false, howTo: 'McMaster gives an approved customer a client certificate (.pfx) and its password. Put it somewhere private, then catalog_source { source: "mcmaster", certPath, user, enabled: true }, and in a terminal: node mcp/src/extras/secrets.js set mcmaster:password, then … set mcmaster:certificate.' },
    traceparts: t?.enabled
      ? { on: true, tenant: t.tenantUid ? 'set' : 'not set', apiKey: (await hasSecret('traceparts:apiKey', env)) ? 'set' : 'not set', userEmail: t.userEmail ?? 'not set' }
      : { on: false, howTo: 'TraceParts gives a tenant id and API key on request (developers.traceparts.com). Then catalog_source { source: "traceparts", tenantUid, userEmail, enabled: true }, and in a terminal: node mcp/src/extras/secrets.js set traceparts:apiKey.' },
  }
}

/** The most a catalogue's answer may be: a CAD file of any size it sends. */
const MAX_BODY = 500 * 1024 * 1024

/** One HTTPS request, answered whole within timeoutMs — headers and body
 *  together — or failed: a connection that drops, or drips, never waits
 *  for ever. */
function request(url, { method = 'GET', headers = {}, body, pfx, passphrase, timeoutMs = 60_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    let settled = false
    const fail = (e) => {
      if (settled) return
      settled = true
      clearTimeout(whole)
      reject(e)
    }
    const req = https.request({ method, hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }, ...(pfx ? { pfx, passphrase } : {}), ...((env.SCANRULER_SOURCES_INSECURE ?? process.env.SCANRULER_SOURCES_INSECURE) === '1' ? { rejectUnauthorized: false } : {}) }, (res) => {
      const chunks = []
      let n = 0
      res.on('data', (c) => {
        n += c.length
        if (n > MAX_BODY) return req.destroy(new Error(`${u.host} sent more than ${MAX_BODY / 2 ** 20} MB.`))
        chunks.push(c)
      })
      res.on('aborted', () => fail(new Error(`${u.host} broke off the answer.`)))
      res.on('error', (e) => fail(new Error(`${u.host}: ${e.message}`)))
      res.on('end', () => {
        if (settled) return
        if (!res.complete) return fail(new Error(`${u.host} broke off the answer.`))
        settled = true
        clearTimeout(whole)
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
      })
    })
    const whole = setTimeout(() => req.destroy(new Error(`${u.host} did not answer in ${timeoutMs / 1000} s.`)), timeoutMs)
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`${u.host} did not answer in ${timeoutMs / 1000} s.`)))
    req.on('error', (e) => fail(new Error(/did not answer|sent more|broke off/.test(e.message) ? e.message : `${u.host}: ${e.message}`)))
    if (body) req.write(body)
    req.end()
  })
}

const json = (r) => {
  try {
    return JSON.parse(r.body.toString('utf8'))
  } catch {
    return null
  }
}

/** A format asked for, matched as words, not as a pattern. */
const formatIs = (format) => {
  const w = String(format ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!w) throw new Error('Say the format: STEP, SLDPRT, DWG…')
  return (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '').includes(w)
}

const problem = (r, who) => {
  const j = json(r)
  return `${who} answered ${r.status}${j?.ErrorDescription ? `: ${j.ErrorDescription}` : j?.message ? `: ${j.message}` : ''}`
}

/** A McMaster-Carr part's CAD file, into the imports folder. */
export async function mcmaster({ part, format = 'STEP', to }, env = process.env) {
  // A part number names a page and a file: letters, digits and dashes only.
  if (typeof part !== 'string' || !/^[A-Za-z0-9-]{3,24}$/.test(part.trim())) throw new Error('Give the McMaster part number, as on its page: 91290A115.')
  part = part.trim()
  const want = formatIs(format)
  const { mcmaster: m } = await loadSources(env)
  if (!m?.enabled) throw new Error('McMaster-Carr is not set up: catalog_sources says how.')
  if (!m.certPath || !existsSync(m.certPath)) throw new Error(`The McMaster client certificate isn't at ${m.certPath ?? '(not set)'}.`)
  const password = await getSecret('mcmaster:password', env)
  const passphrase = await getSecret('mcmaster:certificate', env)
  if (!m.user || !password) throw new Error('The McMaster user name or password is not set: catalog_sources says how.')
  const base = env.SCANRULER_MCMASTER_URL ?? 'https://api.mcmaster.com'
  const pfx = await readFile(m.certPath)
  const call = (path, o = {}) => request(new URL(path, base).href, { ...o, pfx, passphrase: passphrase ?? undefined, env })
  const login = await call('/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ UserName: m.user, Password: password }) })
  if (login.status !== 200) throw new Error(problem(login, 'McMaster’s login'))
  const token = json(login)?.AuthToken
  if (!token) throw new Error('McMaster’s login gave no token.')
  const auth = { Authorization: `Bearer ${token}` }
  try {
    const sub = await call('/v1/products', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ URL: `https://mcmaster.com/${part}` }) })
    if (sub.status !== 200 && sub.status !== 201) throw new Error(problem(sub, `McMaster, for ${part}`))
    const p = json(sub)
    const links = p?.Links ?? []
    const cad = links.find((l) => /^3-?D/i.test(l.Key) && want(l.Key)) ?? links.find((l) => want(l.Key))
    if (!cad) throw new Error(`${part} has no ${format} file; it has ${links.filter((l) => /\/cad\//.test(l.Value)).map((l) => l.Key).join(', ') || 'no CAD'}.`)
    // The CAD file from McMaster's own API only: the login goes nowhere else.
    if (new URL(cad.Value, base).host !== new URL(base).host) throw new Error(`McMaster pointed the CAD file at another site (${new URL(cad.Value, base).host}); not fetched.`)
    const file = await call(cad.Value, { headers: auth, timeoutMs: 180_000 })
    if (file.status !== 200) throw new Error(problem(file, 'McMaster’s CAD download'))
    const name = `${part}${cad.Value.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '.step'}`
    const dir = await mkdtemp(join(tmpdir(), 'scanruler-mcmaster-'))
    await writeFile(join(dir, name), file.body)
    const taken = await take({ file: join(dir, name), to, source: 'mcmaster', url: `https://www.mcmaster.com/${part}/`, licence: 'McMaster-Carr terms: for designing with the part', redistribute: false, note: `${p.FamilyDescription ?? ''} ${p.DetailDescription ?? ''}`.trim() }, env)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    return { part, description: `${p.FamilyDescription ?? ''} — ${p.DetailDescription ?? ''}`, status: p.ProductStatus, format: cad.Key, ...taken }
  } finally {
    await call('/v1/logout', { method: 'POST', headers: auth }).catch(() => null)
  }
}

/** Every string in a JSON answer that is a web address. */
const urlsIn = (v, out = []) => {
  if (typeof v === 'string' && /^https?:\/\//.test(v)) out.push(v)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) urlsIn(x, out)
  return out
}

/** A TraceParts part's CAD file, into the imports folder: the token, the
 *  part found in its catalog, a format picked from those it offers, the
 *  file requested, waited for, and fetched. */
/** The file's address in TraceParts' answer: its own field first, any
 *  address only when it has none. */
const fileUrlIn = (j) => {
  for (const k of ['fileUrl', 'cadFileUrl', 'url', 'FileUrl', 'Url'])
    if (typeof j?.[k] === 'string' && /^https?:\/\//.test(j[k])) return j[k]
  if (typeof j === 'string' && /^https?:\/\//.test(j)) return j
  return urlsIn(j).find((u) => !/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(u)) ?? null
}

export async function traceparts({ partNumber, catalog, format = 'STEP', to, waitSeconds = 120 }, env = process.env) {
  if (typeof partNumber !== 'string' || !partNumber.trim()) throw new Error('Say the part number (partNumber), as the supplier writes it.')
  if (typeof catalog !== 'string' || !catalog.trim()) throw new Error('Say the supplier’s catalog, as TraceParts names it.')
  const want = formatIs(format)
  const wait = Math.max(2, Math.min(600, Number(waitSeconds) || 120))
  const { traceparts: t } = await loadSources(env)
  if (!t?.enabled) throw new Error('TraceParts is not set up: catalog_sources says how.')
  const apiKey = await getSecret('traceparts:apiKey', env)
  if (!t.tenantUid || !apiKey) throw new Error('The TraceParts tenant id or API key is not set: catalog_sources says how.')
  if (!t.userEmail) throw new Error('TraceParts links every download to a user account: set userEmail with catalog_source.')
  const base = env.SCANRULER_TRACEPARTS_URL ?? 'https://api-gateway.traceparts.com'
  const culture = t.cultureInfo ?? 'en'
  const tok = await request(`${base}/v2/RequestToken`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/*+json' }, body: JSON.stringify({ tenantUid: t.tenantUid, apiKey }), env })
  if (tok.status !== 200) throw new Error(problem(tok, 'TraceParts’ token'))
  const tj = json(tok)
  const token = typeof tj === 'string' ? tj : (tj?.token ?? tj?.Token ?? tj?.accessToken ?? tj?.access_token)
  if (!token) throw new Error('TraceParts gave no token.')
  const auth = { accept: 'application/json', authorization: `Bearer ${token}` }
  const avail = await request(`${base}/v2/Search/PartNumber/Availability?partNumber=${encodeURIComponent(partNumber)}&catalog=${encodeURIComponent(catalog)}&removeChar=true`, { headers: auth, env })
  if (avail.status !== 200) throw new Error(problem(avail, `TraceParts, for ${partNumber} in ${catalog}`))
  const a = json(avail)
  const hit = Array.isArray(a) ? a[0] : (a?.results?.[0] ?? a)
  const partFamilyCode = hit?.partFamilyCode
  const selectionPath = hit?.selectionPath
  if (!partFamilyCode) throw new Error(`TraceParts doesn't have ${partNumber} in ${catalog}.`)
  const q = `partFamilyCode=${encodeURIComponent(partFamilyCode)}${selectionPath ? `&selectionPath=${encodeURIComponent(selectionPath)}` : ''}&cultureInfo=${encodeURIComponent(culture)}`
  const fm = await request(`${base}/v3/Product/CadDataAvailability?${q}`, { headers: auth, env })
  if (fm.status !== 200) throw new Error(problem(fm, 'TraceParts’ CAD formats'))
  const fj = json(fm)
  const formats = (Array.isArray(fj) ? fj : (fj?.cadFormatList ?? fj?.cadFormats ?? [])).filter((f) => f && f.cadFormatId != null)
  const chosen = formats.find((f) => want(f.cadFormatName))
  if (!chosen) throw new Error(`${partNumber} isn't offered as ${format}; TraceParts has ${formats.map((f) => f.cadFormatName).join(', ') || 'no CAD formats'}.`)
  const req = await request(`${base}/v3/Product/cadRequest`, { method: 'POST', headers: { ...auth, 'content-type': 'application/*+json' }, body: JSON.stringify({ userEmail: t.userEmail, cultureInfo: culture, cadFormatId: chosen.cadFormatId, partFamilyCode, ...(selectionPath ? { selectionPath } : {}) }), env })
  if (req.status !== 200 && req.status !== 201) throw new Error(problem(req, 'TraceParts’ CAD request'))
  const rj = json(req)
  const id = typeof rj === 'number' ? rj : (rj?.cadRequestId ?? rj?.requestId ?? rj?.id)
  if (id == null) throw new Error('TraceParts gave no request id.')
  let url = null
  const until = Date.now() + wait * 1000
  while (Date.now() <= until && !url) {
    const r = await request(`${base}/v2/Product/cadFileUrl?cadRequestId=${encodeURIComponent(id)}`, { headers: auth, timeoutMs: Math.max(5000, Math.min(60_000, until - Date.now() + 5000)) })
    if (r.status === 204) {
      await new Promise((s) => setTimeout(s, Number(env.SCANRULER_TRACEPARTS_POLL_MS ?? 2000)))
      continue
    }
    if (r.status !== 200) throw new Error(problem(r, 'TraceParts’ CAD file'))
    url = fileUrlIn(json(r))
    if (!url) throw new Error('TraceParts answered with no file address.')
  }
  if (!url) throw new Error(`TraceParts is still making the file after ${wait} s; ask again with the same part.`)
  let file = await request(url, { timeoutMs: 180_000, env })
  // The token again only to TraceParts' own gateway, never another host.
  if ((file.status === 401 || file.status === 403) && new URL(url).host === new URL(base).host) file = await request(url, { headers: { authorization: `Bearer ${token}` }, timeoutMs: 180_000, env })
  if (file.status !== 200) throw new Error(problem(file, 'TraceParts’ file download'))
  const ext = new URL(url).pathname.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '.zip'
  const dir = await mkdtemp(join(tmpdir(), 'scanruler-traceparts-'))
  const name = `${partNumber.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '') || 'part'}${ext}`
  await writeFile(join(dir, name), file.body)
  const taken = await take({ file: join(dir, name), to, source: 'traceparts', url: `https://www.traceparts.com/en/search?Keywords=${encodeURIComponent(partNumber)}`, licence: 'TraceParts terms: for computer-aided design only, not to be shared on', redistribute: false, note: `${catalog} ${partNumber}, ${chosen.cadFormatName}` }, env)
  await rm(dir, { recursive: true, force: true }).catch(() => {})
  return { partNumber, catalog, format: chosen.cadFormatName, poweredBy: 'Powered by TraceParts — https://www.traceparts.com', ...taken }
}
