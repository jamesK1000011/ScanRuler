// SPDX-License-Identifier: AGPL-3.0-only
// The gate in front of every print start. printer_start only makes a
// request; a person starts the print by answering it — in a dialog on this
// Mac (the default there), or on a page this server opens in their browser
// at a one-time address. Neither the address nor its token is ever in a
// tool's answer, and no tool answers a request: the agent can ask, and see
// what was decided, but cannot decide.

import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import http from 'node:http'

const requests = new Map()
const EXPIRE_MS = 15 * 60_000
let server = null
let serverPort = 0

/** What the person is asked: to start a print, or to resume one that was
 *  paused (often for a reason at the printer). */
const WORDS = {
  start: { ask: 'Start this print?', button: 'Start', dialog: 'Start print', done: 'Started', failed: 'It did not start', why: 'An agent asked to start a print. It starts only if you press Start.', check: 'Check the bed is clear and the right filament is loaded.' },
  resume: { ask: 'Resume this print?', button: 'Resume', dialog: 'Resume print', done: 'Resumed', failed: 'It did not resume', why: 'An agent asked to resume a paused print. It resumes only if you press Resume.', check: 'Check whatever made it pause is put right: the nozzle, the filament, the part on the bed.' },
}
const words = (r) => WORDS[r.verb] ?? WORDS.start

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const publicView = (r) => ({ request: r.id, ...(r.verb && r.verb !== 'start' ? { asks: r.verb } : {}), printer: r.printer, file: r.file, summary: r.summary, status: r.status, asked: r.createdAt, ...(r.decidedAt ? { decided: r.decidedAt } : {}), ...(r.outcome ? { outcome: r.outcome } : {}), how: r.how })

export function listRequests() {
  expire()
  return [...requests.values()].map(publicView).reverse()
}

function expire() {
  const now = Date.now()
  for (const r of requests.values()) if (r.status === 'waiting' && now - Date.parse(r.createdAt) > EXPIRE_MS) Object.assign(r, { status: 'expired', decidedAt: new Date().toISOString() })
}

async function decide(r, yes) {
  if (r.status !== 'waiting') return r
  r.decidedAt = new Date().toISOString()
  if (!yes) {
    r.status = 'cancelled'
    return r
  }
  r.status = 'starting'
  try {
    r.outcome = await r.onStart()
    r.status = 'started'
  } catch (e) {
    r.status = 'failed'
    r.outcome = { error: String(e.message ?? e) }
  }
  return r
}

function page(r) {
  const s = r.summary ?? {}
  const w = words(r)
  const rows = [['Printer', r.printer], ['File', r.file], ...(s.pauses ? [['Pauses', s.pauses]] : []), ...(s.time ? [['Time', s.time]] : []), ...(s.filament ? [['Filament', s.filament]] : []), ...(s.size ? [['Size', s.size]] : [])]
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(w.ask)}</title>
<style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem}td{padding:.25rem 1rem .25rem 0}button{font-size:1.1rem;padding:.6rem 1.4rem;margin-right:1rem}#start{background:#0a7;color:#fff;border:0;border-radius:6px}</style></head>
<body><h1>${esc(w.ask)}</h1><p>${esc(w.why)}</p>
<table>${rows.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('')}</table>
<p>${esc(w.check)}</p>
<form method="post"><button id="start" name="action" value="start">${esc(w.button)}</button><button name="action" value="cancel">Cancel</button></form></body></html>`
}

const done = (r) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(r.status)}</title></head><body style="font-family:Helvetica,Arial,sans-serif;max-width:32rem;margin:4rem auto"><h1>${r.status === 'started' ? esc(words(r).done) : r.status === 'cancelled' ? 'Cancelled' : r.status === 'failed' ? esc(words(r).failed) : esc(r.status)}</h1><p>${esc(r.outcome?.error ?? (r.status === 'started' ? `${r.file} on ${r.printer}.` : 'Nothing was sent to the printer.'))}</p><p>You can close this tab.</p></body></html>`

async function ensureServer() {
  if (server) return serverPort
  server = http.createServer((req, res) => {
    const m = /^\/confirm\/([A-Za-z0-9_-]{20,})(\/status)?$/.exec(req.url ?? '')
    const r = m ? [...requests.values()].find((x) => x.token === m[1]) : null
    if (!r) {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }).end('Not found.')
      return
    }
    expire()
    if (m[2] && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }).end(JSON.stringify({ status: r.status, ...(r.outcome?.error ? { error: r.outcome.error } : {}) }))
      return
    }
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' }).end(r.status === 'waiting' ? page(r) : done(r))
      return
    }
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', async () => {
        const action = new URLSearchParams(body).get('action')
        await decide(r, action === 'start')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(done(r))
      })
      return
    }
    res.writeHead(405).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  server.unref()
  serverPort = server.address().port
  return serverPort
}

function dialog(r, env, open) {
  const s = r.summary ?? {}
  const w = words(r)
  const text = `${w.why}\n\nPrinter: ${r.printer}\nFile: ${r.file}${s.pauses ? `\nPauses: ${s.pauses}` : ''}${s.time ? `\nTime: ${s.time}` : ''}${s.filament ? `\nFilament: ${s.filament}` : ''}\n\n${w.check}`.replace(/["\\]/g, (c) => `\\${c}`)
  const script = `display dialog "${text}" with title "ScanRuler — ${w.ask.toLowerCase()}" buttons {"Cancel", "${w.dialog}"} default button "Cancel" cancel button "Cancel" with icon caution giving up after 600`
  const child = spawn(env.SCANRULER_DIALOG ?? 'osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] })
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  child.on('error', async () => {
    r.how = 'page'
    const port = await ensureServer()
    await open(`http://127.0.0.1:${port}/confirm/${r.token}`).catch(() => {})
  })
  child.on('close', (code) => {
    if (r.status !== 'waiting') return
    const yes = code === 0 && out.includes(`button returned:${w.dialog}`) && !/gave up:true/.test(out)
    if (/gave up:true/.test(out)) Object.assign(r, { status: 'expired', decidedAt: new Date().toISOString() })
    else decide(r, yes)
  })
}

/** A request to start a print: the person is asked, and onStart runs only
 *  if they say start. Returns what the agent may see. */
export async function ask({ printer, file, summary, onStart, open, page, verb = 'start' }, env = process.env, platform = process.platform) {
  expire()
  if ([...requests.values()].some((r) => r.printer === printer && r.status === 'waiting')) throw new Error(`There is already a request waiting for ${printer}; printer_requests shows it.`)
  const how = env.SCANRULER_CONFIRM ?? (platform === 'darwin' ? 'dialog' : 'page')
  const r = { id: randomUUID().slice(0, 8), token: randomBytes(24).toString('base64url'), printer, file, summary, onStart, verb, status: 'waiting', createdAt: new Date().toISOString(), how }
  requests.set(r.id, r)
  if (how === 'dialog') dialog(r, env, open)
  else if (how === 'app' && page) {
    const port = await ensureServer()
    try {
      await page('printer.ask', { request: r.id, verb, printer, file, summary: summary ?? {}, answer: `http://127.0.0.1:${port}/confirm/${r.token}` })
    } catch {
      r.how = 'page'
      await open(`http://127.0.0.1:${port}/confirm/${r.token}`)
    }
  } else {
    if (how === 'app') r.how = 'page'
    const port = await ensureServer()
    await open(`http://127.0.0.1:${port}/confirm/${r.token}`)
  }
  return {
    ...publicView(r),
    how: r.how,
    next: `${r.how === 'dialog' ? 'A dialog on this Mac' : r.how === 'app' ? 'A card in ScanRuler' : 'A page opened in the person’s browser'} asks the person to ${verb} it. printer_requests shows the answer.`,
  }
}

export function cancelRequest(id) {
  const r = requests.get(id)
  if (!r) throw new Error(`No request "${id}".`)
  if (r.status === 'waiting') Object.assign(r, { status: 'withdrawn', decidedAt: new Date().toISOString() })
  return publicView(r)
}

/** For the tests only: the person's side of a request. */
export const _person = {
  address: (id) => `http://127.0.0.1:${serverPort}/confirm/${requests.get(id)?.token}`,
  clear: () => requests.clear(),
}
