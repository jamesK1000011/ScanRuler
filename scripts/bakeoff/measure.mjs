// SPDX-License-Identifier: AGPL-3.0-only
// The bake-off's measuring: the same counts for both servers, so the
// scorecard compares like with like. A call is measured as the agent pays
// for it — the bytes of its arguments and of its answer's text, the
// pictures, the time to answer, and whether it was refused.

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'

/** Wrap a `call(name, args) → { error, text, json, images }` so each call is
 *  recorded in `trace`. */
export function measured(call, trace, side) {
  return async (tool, args = {}, why = '') => {
    const t0 = performance.now()
    let r
    try {
      r = await call(tool, args)
    } catch (e) {
      r = { error: true, text: String(e?.message ?? e), json: null, images: [] }
    }
    const row = {
      side,
      tool,
      why,
      ms: Math.round(performance.now() - t0),
      argBytes: Buffer.byteLength(JSON.stringify(args)),
      answerBytes: Buffer.byteLength(r.text ?? ''),
      images: r.images?.length ?? 0,
      ok: !r.error,
      ...(r.error ? { refused: (r.text ?? '').slice(0, 240) } : {}),
    }
    trace.push(row)
    console.log(`${side} ${row.ok ? 'ok  ' : 'FAIL'} ${tool} ${row.ms} ms, ${row.answerBytes} B${r.error ? ` — ${row.refused}` : ''}`)
    return r
  }
}

/** A stdio MCP client for any command (the FreeCAD server is Python): newline
 *  JSON-RPC 2.0, the framing the SDK's stdio transport uses. */
export async function stdioClient({ command, args = [], env = {}, cwd, stderrFile }) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  const log = stderrFile ? createWriteStream(stderrFile, { flags: 'a' }) : null
  child.stderr.on('data', (d) => (log ? log.write(d) : process.stderr.write(d)))
  let id = 1
  let buf = ''
  const pending = new Map()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buf += chunk
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        log?.write(`[bakeoff] not JSON on stdout: ${line.slice(0, 200)}\n`)
        continue
      }
      const p = pending.get(msg.id)
      if (!p) continue
      pending.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    }
  })
  child.on('exit', (code) => {
    for (const [, p] of pending) p.reject(new Error(`the server exited (code ${code}) before answering`))
    pending.clear()
  })
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const n = id++
      pending.set(n, { resolve, reject })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`)
    })
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bakeoff', version: '1' } })
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  const call = async (name, args = {}) => {
    const r = await request('tools/call', { name, arguments: args })
    const text = r.content?.find((c) => c.type === 'text')?.text ?? ''
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    return { error: r.isError === true, text, json, images: (r.content ?? []).filter((c) => c.type === 'image') }
  }
  const listTools = () => request('tools/list', {})
  return { init, call, listTools, close: () => child.kill() }
}

/** The sums a scorecard shows for one side. */
export function summary(trace, side) {
  // The tool list is its own row on the scorecard: the brief's calls alone here.
  const rows = trace.filter((r) => r.side === side && r.tool !== 'tools/list')
  const sum = (k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0)
  return {
    calls: rows.length,
    refused: rows.filter((r) => !r.ok).length,
    ms: sum('ms'),
    argBytes: sum('argBytes'),
    answerBytes: sum('answerBytes'),
    images: sum('images'),
  }
}
