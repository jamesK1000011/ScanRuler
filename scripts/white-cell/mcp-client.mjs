// SPDX-License-Identifier: AGPL-3.0-only
// A minimal MCP client over stdio for the white-cell harness: plain node and
// child_process, no dependencies. It starts scanruler-mcp (mcp/bin), speaks
// newline-delimited JSON-RPC 2.0 to it — the framing the SDK's stdio
// transport uses — and gives back each tool call measured: text, JSON,
// error code, pictures and bytes each way, as mcp/src/trace.js counts them.

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'

const PROTOCOL = '2025-06-18'

/** Start `node <bin> <args>` and connect. `stderrFile`: where the server's
 *  log goes (it writes only its log to stderr; stdout is the channel). */
export async function connect({ bin, args = [], env = {}, cwd, stderrFile, requestTimeoutMs = 15 * 60_000 }) {
  const child = spawn(process.execPath, [bin, ...args], { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  const log = stderrFile ? createWriteStream(stderrFile, { flags: 'a' }) : null
  child.stderr.on('data', (d) => log?.write(d))
  let nextId = 1
  const pending = new Map()
  let buffer = ''
  let exited = null
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '')
      buffer = buffer.slice(nl + 1)
      if (!line.trim()) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        log?.write(`[white-cell] not JSON on stdout: ${line.slice(0, 200)}\n`)
        continue
      }
      if (msg.id !== undefined && pending.has(msg.id) && (msg.result !== undefined || msg.error !== undefined)) {
        const p = pending.get(msg.id)
        pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.error) p.reject(Object.assign(new Error(msg.error.message ?? 'JSON-RPC error'), { rpc: msg.error }))
        else p.resolve(msg.result)
      } else if (msg.id !== undefined && msg.method) {
        // A request from the server (roots, sampling, elicitation): this
        // client offers none of them.
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Not supported by the white-cell client.' } })
      }
      // Notifications (logging, list_changed, progress) are ignored.
    }
  })
  child.on('exit', (code, signal) => {
    exited = { code, signal }
    for (const [, p] of pending) {
      clearTimeout(p.timer)
      p.reject(new Error(`scanruler-mcp exited (code ${code}, signal ${signal}) before answering.`))
    }
    pending.clear()
  })
  const send = (msg) => {
    if (exited) throw new Error(`scanruler-mcp has exited (code ${exited.code}).`)
    child.stdin.write(`${JSON.stringify(msg)}\n`)
  }
  const request = (method, params, timeoutMs = requestTimeoutMs) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${method}: no answer in ${Math.round(timeoutMs / 1000)} s.`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        send({ jsonrpc: '2.0', id, method, params })
      } catch (e) {
        clearTimeout(timer)
        pending.delete(id)
        reject(e)
      }
    })
  const notify = (method, params) => send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })

  const init = await request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'scanruler-white-cell', version: '0.1.0' } }, 120_000)
  notify('notifications/initialized')

  /** The tool list, and what it weighs as JSON. */
  const listTools = async () => {
    const tools = []
    let cursor
    do {
      const r = await request('tools/list', cursor ? { cursor } : {})
      tools.push(...(r.tools ?? []))
      cursor = r.nextCursor
    } while (cursor)
    return { tools, bytes: Buffer.byteLength(JSON.stringify(tools), 'utf8') }
  }

  /** One tool call, measured: { ok, code, message, text, json, images,
   *  inBytes, outBytes, ms }. A transport failure (the server gone, no
   *  answer) is ok: false with code "transport". */
  const call = async (name, args = {}, timeoutMs = requestTimeoutMs) => {
    const inBytes = Buffer.byteLength(JSON.stringify(args ?? {}), 'utf8')
    const t0 = Date.now()
    let r
    try {
      r = await request('tools/call', { name, arguments: args ?? {} }, timeoutMs)
    } catch (e) {
      return { ok: false, code: 'transport', message: e?.message ?? String(e), text: '', json: null, images: 0, inBytes, outBytes: 0, ms: Date.now() - t0 }
    }
    const ms = Date.now() - t0
    let outBytes = 0
    let images = 0
    for (const c of r?.content ?? []) {
      if (c.type === 'text') outBytes += Buffer.byteLength(c.text ?? '', 'utf8')
      else if (c.type === 'image') {
        outBytes += (c.data ?? '').length
        images++
      }
    }
    const text = (r?.content ?? []).find((c) => c.type === 'text')?.text ?? ''
    if (r?.isError) {
      // The server's refusals read "<code>: <message>" (mcp/src/trace.js).
      const m = /^([a-z_]+): ([\s\S]*)$/.exec(text)
      return { ok: false, code: m ? m[1] : 'failed', message: m ? m[2] : text, text, json: null, images, inBytes, outBytes, ms }
    }
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    return { ok: true, code: null, message: null, text, json, images, inBytes, outBytes, ms }
  }

  const close = async () => {
    if (exited) return exited
    try {
      child.stdin.end()
    } catch {
      // already closed
    }
    const done = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })))
    const timer = setTimeout(() => child.kill('SIGTERM'), 5000)
    const out = await done
    clearTimeout(timer)
    log?.end()
    return out
  }

  return { init, listTools, call, close, get exited() { return exited } }
}
