// SPDX-License-Identifier: AGPL-3.0-only
// White-cell harness, phase 1: runs scenarios A–D (scenarios.mjs) as
// scripted call sequences against scanruler-mcp run headless, one fresh
// server per scenario (the engine's state is its process's), each with its
// own call trace; then sums the traces up with scripts/trace-summary.mjs
// and writes a scorecard as JSON and Markdown.
//
// Every step logs pass / fail / unavailable / missing / skipped and the run
// goes on: a refused step is a finding, not the end of the scenario.
//   pass         answered, and no expectation (silent-failure check) failed
//   fail         refused (any code but unavailable), or answered but an
//                expectation failed (reason "check: …")
//   unavailable  the command needs the page (headless engine refused it)
//   missing      no such tool in this server (an extra not switched on, a
//                plugin not in the build)
//   skipped      its inputs never came (an earlier step failed), or its
//                `when` said no
//
// Run, on the Mac, in the ScanRuler checkout:
//   npm ci && npm --prefix mcp ci
//   npm run build:engine                    # writes dist-engine/engine.mjs
//   node scripts/white-cell/run.mjs         # all of A–D
//   node scripts/white-cell/run.mjs --scenarios A,B --out /tmp/wc
//   node scripts/white-cell/run.mjs --scan ~/scans/part.stl   # C on a real scan
// Options:
//   --engine <file>     an engine elsewhere (default: this checkout's, --headless)
//   --out <dir>         where results go (default scripts/white-cell/out/<stamp>)
//   --scenarios A,B,…   which to run (default A,B,C,D)
//   --scan <file>       the scan for C (default: a CAD STL made from a fixture)
//   --extras <list>     SCANRULER_MCP_EXTRAS for the server (default fea,pcb,circuit;
//                       "none" for none)
//   --answer-within <s> passed through (default: the server's 45 s; queued
//                       answers are waited for with scanruler_wait, as an agent does)
//   --trace-args        passed through: arguments and answer heads in the trace
//   --step-timeout <s>  a single call's limit here (default 900)

import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { tmpdir } from 'node:os'
import { connect } from './mcp-client.mjs'
import { scenarios } from './scenarios.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
// WHITE_CELL_BIN: another server to start in its place (a stand-in, to test this harness).
const BIN = process.env.WHITE_CELL_BIN ? resolve(process.env.WHITE_CELL_BIN) : join(repo, 'mcp', 'bin', 'scanruler-mcp.js')
const SUMMARY = join(repo, 'scripts', 'trace-summary.mjs')

const { values } = parseArgs({
  options: {
    engine: { type: 'string' },
    out: { type: 'string' },
    scenarios: { type: 'string' },
    scan: { type: 'string' },
    extras: { type: 'string' },
    'answer-within': { type: 'string' },
    'trace-args': { type: 'boolean' },
    'step-timeout': { type: 'string' },
    help: { type: 'boolean' },
  },
  strict: true,
})
if (values.help) {
  process.stdout.write(`${readHelp()}\n`)
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '')
const outDir = resolve(values.out ?? join(here, 'out', stamp))
const filesDir = join(outDir, 'files')
const traceRoot = join(outDir, 'trace')
const homeDir = join(outDir, 'home')
for (const d of [outDir, filesDir, traceRoot, homeDir]) mkdirSync(d, { recursive: true })
const configDir = join(tmpdir(), `scanruler-white-cell-${process.pid}`)
mkdirSync(configDir, { recursive: true })
const wanted = (values.scenarios ?? 'A,B,C,D').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
const extras = values.extras ?? 'fea,pcb,circuit'
const stepTimeoutMs = Number(values['step-timeout'] ?? 900) * 1000
const engineFile = values.engine ? resolve(values.engine) : join(repo, 'dist-engine', 'engine.mjs')

function readHelp() {
  return 'node scripts/white-cell/run.mjs [--engine f] [--out d] [--scenarios A,B,C,D] [--scan f] [--extras list|none] [--answer-within s] [--trace-args] [--step-timeout s] — see the header of this file.'
}

if (!existsSync(engineFile)) {
  process.stderr.write(`There is no engine at ${engineFile}. Run "npm run build:engine" in the checkout first (or give --engine).\n`)
  process.exit(2)
}

const log = (line) => process.stdout.write(`${line}\n`)

/** A call, waited out when it answers queued — as an agent does with
 *  scanruler_wait { for: "job" } — measured whole: the waits' calls,
 *  time and bytes are the step's. */
async function callWaited(client, tool, args) {
  let r = await client.call(tool, args, stepTimeoutMs)
  const waits = { calls: 0, ms: 0, inBytes: 0, outBytes: 0 }
  let json = r.json
  let ok = r.ok
  let code = r.code
  let message = r.message
  let images = r.images
  const t0 = Date.now()
  while (ok && json && json.queued === true && typeof json.job === 'string') {
    if (Date.now() - t0 > stepTimeoutMs) {
      ok = false
      code = 'timeout'
      message = `still running after ${stepTimeoutMs / 1000} s of scanruler_wait`
      break
    }
    const w = await client.call('scanruler_wait', { for: 'job', job: json.job, timeoutSeconds: 40 }, 120_000)
    waits.calls++
    waits.ms += w.ms
    waits.inBytes += w.inBytes
    waits.outBytes += w.outBytes
    images += w.images
    if (!w.ok) {
      ok = false
      code = w.code
      message = w.message
      break
    }
    const a = w.json
    if (a?.state === 'running') continue
    if (a?.error) {
      ok = false
      code = a.error.code ?? 'failed'
      message = a.error.message ?? ''
      json = null
    } else json = a?.result ?? a
    break
  }
  return { ...r, ok, code, message, json, images, waits }
}

/** The outcome of a refusal. */
function refusalOutcome(r, listed, tool) {
  if (r.code === 'unavailable') return 'unavailable'
  if (!listed.has(tool) && r.code !== 'transport') return 'missing'
  return 'fail'
}

const head = (s, n = 400) => (typeof s === 'string' ? (s.length > n ? `${s.slice(0, n)}…` : s) : s)

async function runStep(client, step, ctx, listed, rows, label = step.id) {
  const row = { id: label, tool: step.tool, probe: Boolean(step.probe), why: step.why }
  try {
    if (step.when && !step.when(ctx)) return push({ ...row, outcome: 'skipped', reason: 'when: not this run' })
    const missingKey = (step.needs ?? []).find((k) => ctx[k] === undefined || ctx[k] === null)
    if (missingKey) return push({ ...row, outcome: 'skipped', reason: `needs ${missingKey}, which no earlier step gave` })
    const args = typeof step.args === 'function' ? step.args(ctx) : (step.args ?? {})
    row.args = head(JSON.stringify(args), 300)
    const r = await callWaited(client, step.tool, args)
    Object.assign(row, { ms: r.ms + r.waits.ms, inBytes: r.inBytes + r.waits.inBytes, outBytes: r.outBytes + r.waits.outBytes, images: r.images, waits: r.waits.calls, listed: listed.has(step.tool) })
    if (!r.ok) {
      row.outcome = refusalOutcome(r, listed, step.tool)
      row.code = r.code
      row.message = head(r.message)
      push(row)
      if (step.fallback) {
        log(`      ↳ fallback ${step.fallback.id}`)
        await runStep(client, step.fallback, ctx, listed, rows, `${label}→${step.fallback.id}`)
      }
      return
    }
    try {
      step.save?.(r.json, ctx)
    } catch (e) {
      row.saveError = e?.message ?? String(e)
    }
    const flags = step.flags ? step.flags(r.json, ctx) : []
    if (flags.length) row.flags = flags
    const bad = step.expect ? step.expect(r.json, ctx) : null
    if (bad) {
      row.outcome = 'fail'
      row.code = 'check'
      row.message = bad
    } else row.outcome = 'pass'
    if (r.json === null) row.answerHead = head(r.text, 200)
    return push(row)
  } catch (e) {
    return push({ ...row, outcome: 'fail', code: 'harness', message: e?.message ?? String(e) })
  }

  function push(x) {
    rows.push(x)
    const extra = x.code ? ` ${x.code}: ${head(x.message ?? '', 160)}` : x.reason ? ` (${x.reason})` : ''
    const size = x.outBytes !== undefined ? ` ${x.ms} ms, ${x.inBytes}/${x.outBytes} B${x.images ? `, ${x.images} pic` : ''}${x.waits ? `, ${x.waits} waits` : ''}` : ''
    log(`   ${x.outcome.padEnd(11)} ${x.id.padEnd(22)} ${x.tool}${size}${extra}${x.flags ? ` [flag: ${x.flags.join('; ')}]` : ''}`)
  }
}

function totals(rows) {
  const t = { steps: rows.length, pass: 0, fail: 0, unavailable: 0, missing: 0, skipped: 0, calls: 0, waits: 0, ms: 0, inBytes: 0, outBytes: 0, images: 0, probeOutBytes: 0, flags: 0 }
  for (const r of rows) {
    t[r.outcome]++
    if (r.outcome !== 'skipped') t.calls += 1 + (r.waits ?? 0)
    t.waits += r.waits ?? 0
    t.ms += r.ms ?? 0
    t.inBytes += r.inBytes ?? 0
    t.outBytes += r.outBytes ?? 0
    t.images += r.images ?? 0
    if (r.probe) t.probeOutBytes += r.outBytes ?? 0
    t.flags += r.flags?.length ?? 0
  }
  const ran = t.pass + t.fail + t.unavailable + t.missing
  t.headlessShare = ran ? Math.round((100 * (t.pass + t.fail)) / ran) : 0
  return t
}

async function runScenario(sc) {
  const traceDir = join(traceRoot, sc.id)
  mkdirSync(traceDir, { recursive: true })
  const args = [values.engine ? '--engine' : '--headless', ...(values.engine ? [engineFile] : []), '--trace', traceDir, '--out', filesDir, '--no-update']
  if (values['trace-args']) args.push('--trace-args')
  if (values['answer-within'] !== undefined) args.push('--answer-within', values['answer-within'])
  const env = { SCANRULER_MCP_CONFIG_DIR: configDir, SCANRULER_MCP_NO_UPDATE: '1', SCANRULER_HOME: homeDir, ...(extras !== 'none' ? { SCANRULER_MCP_EXTRAS: extras } : { SCANRULER_MCP_EXTRAS: '' }) }
  log(`\n== ${sc.id}. ${sc.title}`)
  const rows = []
  const result = { id: sc.id, title: sc.title, rows, server: null, tools: null }
  let client
  try {
    client = await connect({ bin: BIN, args, env, cwd: repo, stderrFile: join(outDir, `server-${sc.id}.log`), requestTimeoutMs: stepTimeoutMs })
    result.server = client.init?.serverInfo ?? null
    const { tools, bytes } = await client.listTools()
    result.tools = { count: tools.length, bytes }
    log(`   ${tools.length} tools listed (${(bytes / 1024).toFixed(1)} kB of definitions)`)
    const listed = new Set(tools.map((t) => t.name))
    const ctx = { scan: values.scan ? resolve(values.scan) : undefined }
    for (const step of sc.steps) await runStep(client, step, ctx, listed, rows)
  } catch (e) {
    result.error = e?.message ?? String(e)
    log(`   the scenario stopped: ${result.error}`)
  } finally {
    if (client) result.exit = await client.close()
  }
  result.totals = totals(rows)
  return result
}

function traceSummary() {
  const out = {}
  for (const id of wanted) {
    const dir = join(traceRoot, id)
    if (!existsSync(dir)) continue
    try {
      out[id] = {
        text: execFileSync(process.execPath, [SUMMARY, dir], { encoding: 'utf8' }),
        json: JSON.parse(execFileSync(process.execPath, [SUMMARY, dir, '--json'], { encoding: 'utf8' })),
      }
    } catch (e) {
      out[id] = { error: e?.message ?? String(e) }
    }
  }
  return out
}

function markdown(card) {
  const L = []
  L.push(`# White-cell scorecard — ${card.started}`)
  L.push('')
  L.push(`Engine: \`${card.engine}\`; extras: \`${card.extras}\`; out: \`${card.outDir}\``)
  L.push('')
  L.push('| Scenario | steps | pass | fail | unavailable | missing | skipped | calls (incl. waits) | kB out | of it guides/probes kB | pictures | headless share % | flags |')
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const s of card.scenarios) {
    const t = s.totals
    L.push(`| ${s.id} | ${t.steps} | ${t.pass} | ${t.fail} | ${t.unavailable} | ${t.missing} | ${t.skipped} | ${t.calls} | ${(t.outBytes / 1024).toFixed(1)} | ${(t.probeOutBytes / 1024).toFixed(1)} | ${t.images} | ${t.headlessShare} | ${t.flags} |`)
  }
  L.push('')
  L.push('headless share: of the steps that reached the server, how many ran in the engine (pass or fail) rather than answering unavailable or missing.')
  for (const s of card.scenarios) {
    L.push('')
    L.push(`## ${s.id}. ${s.title}`)
    if (s.error) L.push(`\n**Stopped:** ${s.error}`)
    if (s.tools) L.push(`\n${s.tools.count} tools listed, ${(s.tools.bytes / 1024).toFixed(1)} kB of definitions.`)
    L.push('')
    L.push('| step | tool | outcome | ms | B in | B out | waits | note |')
    L.push('|---|---|---|---|---|---|---|---|')
    for (const r of s.rows) {
      const note = [r.code ? `${r.code}: ${r.message ?? ''}` : r.reason ?? '', ...(r.flags ?? []).map((f) => `FLAG ${f}`)].filter(Boolean).join(' — ').replace(/\|/g, '\\|').replace(/\n/g, ' ')
      L.push(`| ${r.id}${r.probe ? ' (probe)' : ''} | \`${r.tool}\` | ${r.outcome} | ${r.ms ?? ''} | ${r.inBytes ?? ''} | ${r.outBytes ?? ''} | ${r.waits ?? ''} | ${head(note, 300)} |`)
    }
    const tr = card.trace[s.id]
    if (tr?.text) {
      L.push('')
      L.push('Trace summary (scripts/trace-summary.mjs):')
      L.push('')
      L.push('```')
      L.push(tr.text.trimEnd())
      L.push('```')
    } else if (tr?.error) L.push(`\nTrace summary failed: ${tr.error}`)
  }
  return `${L.join('\n')}\n`
}

const card = { started: new Date().toISOString(), engine: engineFile, extras, outDir, scenarios: [], trace: {} }
const all = scenarios({ repo, files: filesDir, stamp })
for (const id of wanted) {
  const sc = all[id]
  if (!sc) {
    log(`No scenario ${id} (A, B, C, D).`)
    continue
  }
  card.scenarios.push(await runScenario(sc))
}
card.trace = traceSummary()
writeFileSync(join(outDir, 'scorecard.json'), `${JSON.stringify(card, null, 2)}\n`)
writeFileSync(join(outDir, 'scorecard.md'), markdown(card))
log(`\nScorecard: ${join(outDir, 'scorecard.md')} and scorecard.json; traces in ${traceRoot}.`)
