// SPDX-License-Identifier: AGPL-3.0-only
// The catalogue accounts against stand-ins: off until set up; McMaster's
// login with a client certificate, the part subscribed, its STEP fetched
// and taken in as not to be shared on; TraceParts' token, availability,
// formats, request, the wait and the file. No answer carries a secret.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { extraTools } from '../src/extras/index.js'
import { setSecret } from '../src/extras/secrets.js'

const helpers = { text: (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] }), failure: (e) => ({ isError: true, content: [{ type: 'text', text: String(e.message ?? e) }] }) }
const dir = mkdtempSync(join(tmpdir(), 'scanruler-sources-'))
const ssl = (args) => execFileSync('openssl', args, { stdio: 'ignore' })
ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'srv.key'), '-out', join(dir, 'srv.crt'), '-days', '1', '-subj', '/CN=localhost'])
ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'cli.key'), '-out', join(dir, 'cli.crt'), '-days', '1', '-subj', '/CN=approved-customer'])
ssl(['pkcs12', '-export', '-inkey', join(dir, 'cli.key'), '-in', join(dir, 'cli.crt'), '-out', join(dir, 'cli.pfx'), '-passout', 'pass:certpw'])
const srv = { key: readFileSync(join(dir, 'srv.key')), cert: readFileSync(join(dir, 'srv.crt')) }
const SECRETS = { mm: 'mm-Pa55', cert: 'certpw', tp: 'tp-key-123' }
const STEP = 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n'

let mm, tp, env, tools, said = []
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)))
const body = async (req) => {
  let b = ''
  for await (const c of req) b += c
  return b
}

before(async () => {
  process.env.SCANRULER_SOURCES_INSECURE = '1'
  mm = https.createServer({ ...srv, requestCert: true, rejectUnauthorized: false }, async (req, res) => {
    const b = await body(req)
    const peer = req.socket.getPeerCertificate()
    if (!peer?.subject?.CN) return res.writeHead(403).end(JSON.stringify({ ErrorCode: 403, ErrorDescription: 'No client certificate.' }))
    const ok = (v, code = 200) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(v))
    if (req.url === '/v1/login') {
      const j = JSON.parse(b)
      return j.UserName === 'alexuser' && j.Password === SECRETS.mm ? ok({ AuthToken: 'tok-1', ExpirationTS: '2026-11-08T00:00:00Z' }) : ok({ ErrorCode: 401, ErrorDescription: 'Login failed.' }, 401)
    }
    if (req.headers.authorization !== 'Bearer tok-1') return ok({ ErrorCode: 403, ErrorDescription: 'Invalid authorization token.' }, 403)
    if (req.url === '/v1/logout') return res.writeHead(204).end()
    if (req.url === '/v1/products' && req.method === 'PUT') {
      const part = JSON.parse(b).URL.split('/').pop()
      if (part !== '91290A115') return ok({ ErrorCode: 400, ErrorDescription: 'Invalid part number.' }, 400)
      return ok({ PartNumber: part, ProductStatus: 'Active', FamilyDescription: 'Socket Head Screw', DetailDescription: 'M3 x 0.5 mm Thread, 10 mm Long', Specifications: [], Links: [{ Key: 'Price', Value: `/v1/products/${part}/price` }, { Key: '2-D DWG', Value: `/v1/cad/library/${part}.DWG` }, { Key: '3-D STEP', Value: `/v1/cad/library/${part}.STEP` }] })
    }
    if (req.url === '/v1/cad/library/91290A115.STEP') return res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(STEP)
    ok({ ErrorCode: 404 }, 404)
  })
  let polls = 0
  tp = https.createServer(srv, async (req, res) => {
    const b = await body(req)
    const ok = (v, code = 200) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(v))
    const u = new URL(req.url, 'https://x')
    if (u.pathname === '/v2/RequestToken') {
      const j = JSON.parse(b)
      return j.tenantUid === '11111111-2222-3333-4444-555555555555' && j.apiKey === SECRETS.tp ? ok({ token: 'tp-tok' }) : ok({ message: 'bad key' }, 401)
    }
    if (u.pathname === '/files/6204.stp') return res.writeHead(200).end(STEP)
    if (req.headers.authorization !== 'Bearer tp-tok') return ok({ message: 'unauthorised' }, 401)
    if (u.pathname === '/v2/Search/PartNumber/Availability') return u.searchParams.get('partNumber') === '6204-2RS' ? ok([{ partFamilyCode: 'SKF-6204', selectionPath: '|1|4|' }]) : ok([])
    if (u.pathname === '/v3/Product/CadDataAvailability') return ok({ cadFormatList: [{ cadFormatId: 3, cadFormatName: 'Autodesk Inventor' }, { cadFormatId: 7, cadFormatName: 'STEP AP214' }] })
    if (u.pathname === '/v3/Product/cadRequest') {
      const j = JSON.parse(b)
      return j.cadFormatId === 7 && j.userEmail === 'me@example.com' && j.partFamilyCode === 'SKF-6204' ? ok({ cadRequestId: 4242 }) : ok({ message: 'bad request' }, 400)
    }
    if (u.pathname === '/v2/Product/cadFileUrl') {
      if (polls++ < 1) return res.writeHead(204).end()
      return ok({ filesUrls: [{ uri: `https://127.0.0.1:${tp.address().port}/files/6204.stp` }] })
    }
    if (u.pathname === '/files/6204.stp') return res.writeHead(200).end(STEP)
    ok({}, 404)
  })
  const mmPort = await listen(mm)
  const tpPort = await listen(tp)
  env = { SCANRULER_MCP_EXTRAS: 'catalog', SCANRULER_HOME: join(dir, 'home'), SCANRULER_SECRETS: 'file', SCANRULER_MCMASTER_URL: `https://127.0.0.1:${mmPort}`, SCANRULER_TRACEPARTS_URL: `https://127.0.0.1:${tpPort}`, SCANRULER_TRACEPARTS_POLL_MS: '20' }
  tools = extraTools(helpers, env)
})

after(() => {
  mm?.close()
  tp?.close()
})

const call = async (name, args = {}) => {
  const r = await tools.find((t) => t.name === name).call(args)
  said.push(r.content[0].text)
  return { error: r.isError === true, text: r.content[0].text, json: r.isError ? null : JSON.parse(r.content[0].text) }
}

test('both are off until set up, and say how', async () => {
  const s = await call('catalog_sources')
  assert.equal(s.json.mcmaster.on, false)
  assert.match(s.json.mcmaster.howTo, /secrets\.js set mcmaster:password/)
  assert.match((await call('catalog_mcmaster', { part: '91290A115' })).text, /not set up/)
  assert.match((await call('catalog_traceparts', { partNumber: '6204-2RS', catalog: 'SKF' })).text, /not set up/)
})

test('McMaster: the certificate and login, the part subscribed, its STEP taken in, not to be shared on', async () => {
  await call('catalog_source', { source: 'mcmaster', enabled: true, certPath: join(dir, 'cli.pfx'), user: 'alexuser' })
  assert.match((await call('catalog_mcmaster', { part: '91290A115' })).text, /user name or password is not set/)
  await setSecret('mcmaster:password', SECRETS.mm, env)
  await setSecret('mcmaster:certificate', SECRETS.cert, env)
  const st = await call('catalog_sources')
  assert.deepEqual([st.json.mcmaster.certificate, st.json.mcmaster.password, st.json.mcmaster.certificatePassword], ['found', 'set', 'set'])
  const r = await call('catalog_mcmaster', { part: '91290A115', to: join(dir, 'imports') })
  assert.equal(r.error, false, r.text)
  assert.match(r.json.description, /Socket Head Screw — M3/)
  assert.equal(r.json.format, '3-D STEP')
  assert.equal(await readFile(r.json.taken[0], 'utf8'), STEP)
  const ledger = JSON.parse(await readFile(join(dir, 'imports', 'provenance.json'), 'utf8'))
  assert.deepEqual([ledger[0].file, ledger[0].source, ledger[0].redistribute], ['91290A115.STEP', 'mcmaster', false])
  assert.match((await call('catalog_mcmaster', { part: '00000X000' })).text, /Invalid part number/)
  await setSecret('mcmaster:password', 'wrong', env)
  assert.match((await call('catalog_mcmaster', { part: '91290A115' })).text, /Login failed/)
})

test('TraceParts: token, availability, a STEP format picked, the request waited for and the file taken in', async () => {
  await call('catalog_source', { source: 'traceparts', enabled: true, tenantUid: '11111111-2222-3333-4444-555555555555' })
  await setSecret('traceparts:apiKey', SECRETS.tp, env)
  assert.match((await call('catalog_traceparts', { partNumber: '6204-2RS', catalog: 'SKF' })).text, /userEmail/)
  await call('catalog_source', { source: 'traceparts', userEmail: 'me@example.com' })
  const r = await call('catalog_traceparts', { partNumber: '6204-2RS', catalog: 'SKF', to: join(dir, 'imports') })
  assert.equal(r.error, false, r.text)
  assert.equal(r.json.format, 'STEP AP214')
  assert.match(r.json.poweredBy, /Powered by TraceParts/)
  assert.equal(await readFile(r.json.taken[0], 'utf8'), STEP)
  assert.match((await call('catalog_traceparts', { partNumber: '9999', catalog: 'SKF' })).text, /doesn't have 9999/)
})

test('no answer carries a secret', () => {
  const all = said.join('\n')
  for (const s of Object.values(SECRETS)) assert.ok(!all.includes(s), `leaked ${s}`)
  assert.ok(!readFileSync(join(dir, 'home', 'catalog.json'), 'utf8').match(/Pa55|certpw|tp-key/))
})
