// SPDX-License-Identifier: AGPL-3.0-only
// What a batch and a long change are to the server: a batch refused part
// way at a change undone back to where it began, timed if asked — at a
// read, kept as it stands; a call refused busy run again once the page is
// idle; a change answered at
// once as a job with wait: false and its answer read by scanruler_wait; a
// call the client stopped waiting for kept running, its answer still read;
// and the tab hidden, as the status says. A fake page with an undo history
// of its own, behind a real MCP client.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { PageLink } from '../src/link.js'
import { createMcpServer } from '../src/mcp.js'
import { httpServer } from '../src/serve.js'
import { fakePage } from './fakePage.js'

const TOKEN = 'a-token-for-the-jobs-tests'
const obj = (properties = {}) => ({ type: 'object', properties, additionalProperties: false })
const COMMANDS = [
  { name: 'session.state', title: 'Read the session', description: 'The session.', input: obj(), readOnly: true, returnsFile: false, returnsImage: false },
  { name: 'demo.read', title: 'Read', description: 'Reads.', input: obj(), readOnly: true, returnsFile: false, returnsImage: false },
  { name: 'demo.change', title: 'Change', description: 'Changes.', input: obj({ n: { type: 'number' }, fail: { type: 'boolean' }, ms: { type: 'number' } }), readOnly: false, returnsFile: false, returnsImage: false },
  { name: 'section.cut', title: 'Cut a section', description: 'Cuts.', input: obj({ name: { type: 'string' } }), readOnly: false, returnsFile: false, returnsImage: false },
  { name: 'section.get', title: 'Read a section', description: 'Reads one.', input: obj({ section: { type: 'string' } }), readOnly: true, returnsFile: false, returnsImage: false },
  { name: 'history.checkpoint', title: 'Mark the history', description: 'Marks.', input: obj(), readOnly: true, returnsFile: false, returnsImage: false },
  { name: 'history.restore', title: 'Back to a mark', description: 'Restores.', input: obj({ checkpoint: { type: 'string' } }), readOnly: false, returnsFile: false, returnsImage: false },
  // Commands that say which fields name what they make, in one name space.
  { name: 'demo.add', title: 'Add', description: 'Adds.', input: obj({ feature: { type: 'object' }, features: { type: 'array' } }), readOnly: false, returnsFile: false, returnsImage: false, names: { space: 'sketches and features', at: ['feature.name', 'features[].name'] } },
  { name: 'demo.update', title: 'Update', description: 'Updates.', input: obj({ feature: { type: 'string' }, set: { type: 'object' }, features: { type: 'array' } }), readOnly: false, returnsFile: false, returnsImage: false, names: { space: 'sketches and features', at: ['set.name', 'features[].set.name'] } },
  // A long change that says how far it is.
  { name: 'demo.compare', title: 'Compare', description: 'Compares.', input: obj({ ms: { type: 'number' } }), readOnly: false, returnsFile: false, returnsImage: false },
]

/** The page's undo history: a label a change. */
const history = []
/** The sections cut, by name. */
const sections = []
/** Until when the page says it is busy with something of its own. */
let busyUntil = 0
let link
let http
let client
let page

before(async () => {
  link = new PageLink({ token: TOKEN })
  http = httpServer({})
  link.attach(http)
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve))
  const server = createMcpServer({ link, version: '0.0.0', cwd: '.', outDir: '.', connectHelp: () => 'Pair it.', serverInfo: () => ({}), pageTimeoutMs: 50, tools: 'full' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(a), client.connect(b)])
  ;({ page } = await fakePage(http.address().port, {
    token: TOKEN,
    commands: COMMANDS,
    answer: async (name, input, progress) => {
      if (name === 'demo.add' || name === 'demo.update') {
        history.push(`Agent: ${name}`)
        return { ok: name }
      }
      if (name === 'demo.compare') {
        progress('Meshing the bodies…')
        await new Promise((r) => setTimeout(r, input.ms / 2))
        progress('Measuring the reference against the scan — 42%…')
        await new Promise((r) => setTimeout(r, input.ms / 2))
        return { rms: 0.29 }
      }
      if (name === 'session.state') return { busy: Date.now() < busyUntil ? 'working out a map' : null, running: null }
      if (name === 'section.cut') {
        if (Date.now() < busyUntil) throw { code: 'busy', message: 'The session is busy — working out a map.' }
        sections.push(input.name)
        history.push(`Agent: cut ${input.name}`)
        return { section: { name: input.name } }
      }
      if (name === 'section.get') {
        if (!sections.includes(input.section)) throw { code: 'not_found', message: `There is no section "${input.section}".` }
        return { section: { name: input.section } }
      }
      if (name === 'history.restore') sections.length = 0
      if (name === 'demo.read') return { read: true }
      if (name === 'history.checkpoint') return { checkpoint: `cp${history.length}`, steps: history.length }
      if (name === 'history.restore') return { undone: history.splice(Number(String(input.checkpoint).slice(2))).reverse() }
      if (name === 'demo.change') {
        if (input.ms) await new Promise((r) => setTimeout(r, input.ms))
        if (input.fail) throw { code: 'invalid_state', message: 'Not now.' }
        history.push(`Agent: change ${input.n}`)
        return { n: input.n, steps: { recomputed: 1, restored: 2, played: [{ feature: 'Round 1', ms: 12.5 }] } }
      }
      throw { code: 'unknown_command', message: name }
    },
  }))
})
after(async () => {
  await client.close()
  page.close()
  link.close()
  http.close()
})

const call = async (name, args = {}, options) => {
  const r = await client.callTool({ name, arguments: args }, undefined, options)
  const text = r.content[0].text
  return { error: r.isError === true, text, json: r.isError ? null : JSON.parse(text) }
}
const ran = () => page.runs.map((m) => m.name)

test('a change takes wait, a read does not', async () => {
  const { tools } = await client.listTools()
  assert.ok(tools.find((t) => t.name === 'demo_change').inputSchema.properties.wait)
  assert.equal(tools.find((t) => t.name === 'demo_read').inputSchema.properties.wait, undefined)
  assert.ok(tools.find((t) => t.name === 'scanruler_batch').inputSchema.properties.rollback)
})

test('a batch refused part way undoes what it did before, back to where it began', async () => {
  history.length = 0
  page.runs.length = 0
  const r = await call('scanruler_batch', { calls: [{ tool: 'demo_change', arguments: { n: 1 } }, { tool: 'demo_read' }, { tool: 'demo_change', arguments: { n: 2 } }, { tool: 'demo_change', arguments: { fail: true } }, { tool: 'demo_change', arguments: { n: 3 } }] })
  assert.equal(r.json.ran, 4)
  assert.deepEqual(r.json.failed, { index: 3, tool: 'demo_change', error: { code: 'invalid_state', message: 'Not now.' } })
  assert.deepEqual(r.json.undone, ['Agent: change 2', 'Agent: change 1'])
  assert.equal(r.json.stopped, 3)
  // Each change taken back says so, its result kept; the read stands.
  assert.deepEqual(r.json.results.map((x) => [x.tool, x.ok, x.undone]), [['demo_change', false, true], ['demo_read', true, undefined], ['demo_change', false, true], ['demo_change', false, undefined]])
  assert.equal(r.json.results[2].result.n, 2)
  assert.equal(r.json.callsUndone, 2)
  assert.deepEqual(history, [])
  // The rollback waits for the page to be idle first.
  assert.deepEqual(ran(), ['history.checkpoint', 'demo.change', 'demo.read', 'demo.change', 'demo.change', 'session.state', 'history.restore'])
  // Without the steps played: those are for a batch asked for its timings.
  assert.deepEqual(r.json.results[0].result.steps, { recomputed: 1, restored: 2 })
  assert.equal(r.json.results[0].ms, undefined)
  // Left standing, a change keeps ok: true.
  history.length = 0
  const kept = await call('scanruler_batch', { calls: [{ tool: 'demo_change', arguments: { n: 1 } }, { tool: 'demo_change', arguments: { fail: true } }], rollback: false })
  assert.equal(kept.json.results[0].ok, true)
  assert.equal(kept.json.results[0].undone, undefined)
  assert.equal(kept.json.callsUndone, undefined)
  assert.equal(r.json.total_ms, undefined)
})

test('rollback: false leaves what went before standing; a batch that only reads marks nothing; stopOnError: false undoes nothing', async () => {
  history.length = 0
  page.runs.length = 0
  const kept = await call('scanruler_batch', { calls: [{ tool: 'demo_change', arguments: { n: 1 } }, { tool: 'demo_change', arguments: { fail: true } }], rollback: false })
  assert.equal(kept.json.failed.index, 1)
  assert.equal(kept.json.undone, undefined)
  assert.deepEqual(history, ['Agent: change 1'])
  assert.ok(!ran().includes('history.checkpoint'))
  page.runs.length = 0
  await call('scanruler_batch', { calls: [{ tool: 'demo_read' }, { tool: 'session_state' }] })
  assert.deepEqual(ran(), ['demo.read', 'session.state'])
  page.runs.length = 0
  const on = await call('scanruler_batch', { calls: [{ tool: 'demo_change', arguments: { fail: true } }, { tool: 'demo_change', arguments: { n: 4 } }], stopOnError: false })
  assert.equal(on.json.ran, 2)
  assert.equal(on.json.failed, undefined)
  assert.deepEqual(history, ['Agent: change 1', 'Agent: change 4'])
})

test('timings: each call its ms, the batch total_ms, and the steps a build played', async () => {
  const r = await call('scanruler_batch', { calls: [{ tool: 'demo_change', arguments: { n: 5, ms: 30 } }, { tool: 'demo_read' }], timings: true })
  assert.ok(r.json.results[0].ms >= 25)
  assert.equal(typeof r.json.results[1].ms, 'number')
  assert.ok(r.json.total_ms >= r.json.results[0].ms)
  assert.deepEqual(r.json.results[0].result.steps.played, [{ feature: 'Round 1', ms: 12.5 }])
  // A call on its own: no steps played.
  assert.deepEqual((await call('demo_change', { n: 6 })).json.steps, { recomputed: 1, restored: 2 })
})

test('wait: false answers at once with a job; scanruler_wait gives its answer; the status lists it', async () => {
  page.runs.length = 0
  const queued = await call('demo_change', { n: 7, ms: 200, wait: false })
  assert.equal(queued.json.queued, true)
  assert.equal(queued.json.tool, 'demo_change')
  const running = (await call('scanruler_status')).json.jobs.find((j) => j.job === queued.json.job)
  assert.equal(running.state, 'running')
  // The page keeps answering what reads while the change runs.
  assert.equal((await call('session_state')).json.busy, null)
  const done = await call('scanruler_wait', { for: 'job', job: queued.json.job })
  assert.equal(done.json.state, 'done')
  assert.equal(done.json.result.n, 7)
  assert.ok(done.json.ms >= 150)
  // wait is the server's: the page never sees it.
  assert.deepEqual(page.runs.find((m) => m.name === 'demo.change').input, { n: 7, ms: 200 })
  // A refused one comes back as its error.
  const bad = await call('demo_change', { fail: true, wait: false })
  const refused = await call('scanruler_wait', { for: 'job', job: bad.json.job })
  assert.equal(refused.json.state, 'failed')
  assert.deepEqual(refused.json.error, { code: 'invalid_state', message: 'Not now.' })
  // A batch, too.
  const batch = await call('scanruler_batch', { calls: [{ tool: 'demo_change', arguments: { n: 8 } }], wait: false })
  assert.equal(batch.json.tool, 'scanruler_batch')
  assert.equal((await call('scanruler_wait', { for: 'job', job: batch.json.job })).json.result.results[0].result.n, 8)
  assert.equal((await call('scanruler_wait', { for: 'job', job: 'j999' })).text.startsWith('not_found:'), true)
})

test('a change the client stops waiting for keeps running, and its answer is read by its job', async () => {
  await assert.rejects(call('demo_change', { n: 9, ms: 300 }, { timeout: 50 }), /timed out|Timeout/i)
  const jobs = (await call('scanruler_status')).json.jobs
  const job = jobs.find((j) => j.tool === 'demo_change' && j.state === 'running')
  assert.ok(job, JSON.stringify(jobs))
  const done = await call('scanruler_wait', { for: 'job', job: job.job, timeoutSeconds: 5 })
  assert.equal(done.json.state, 'done')
  assert.equal(done.json.result.n, 9)
})

test('the tab hidden and shown again, as the status says', async () => {
  page.ws.send(JSON.stringify({ event: 'visibility', hidden: true }))
  await new Promise((r) => setTimeout(r, 50))
  const hidden = (await call('scanruler_status')).json
  assert.equal(hidden.page.hidden, true)
  assert.match(hidden.hiddenNote, /hidden/)
  page.ws.send(JSON.stringify({ event: 'visibility', hidden: false }))
  await new Promise((r) => setTimeout(r, 50))
  const shown = (await call('scanruler_status')).json
  assert.equal(shown.page.hidden, false)
  assert.equal(shown.hiddenNote, undefined)
})

test('timings on a change called on its own: the call’s ms and the steps its build played; the page never sees the flag', async () => {
  const { tools } = await client.listTools()
  assert.ok(tools.find((t) => t.name === 'demo_change').inputSchema.properties.timings)
  assert.equal(tools.find((t) => t.name === 'demo_read').inputSchema.properties.timings, undefined)
  page.runs.length = 0
  const r = await call('demo_change', { n: 10, ms: 30, timings: true })
  assert.ok(r.json.ms >= 25)
  assert.deepEqual(r.json.steps, { recomputed: 1, restored: 2, played: [{ feature: 'Round 1', ms: 12.5 }] })
  assert.deepEqual(page.runs.find((m) => m.name === 'demo.change').input, { n: 10, ms: 30 })
  // Inside a batch the flag is the batch's.
  const b = await call('scanruler_batch', { calls: [{ tool: 'demo_change', arguments: { n: 11, timings: true } }] })
  assert.equal(b.json.results[0].result.ms, undefined)
  assert.equal(b.json.results[0].result.steps.played, undefined)
})

test('scanruler_wait for idle waits for the changes still running and says what finished and failed, each once', async () => {
  // What earlier tests left unseen is said first; then nothing is left.
  await call('scanruler_wait', { for: 'idle', timeoutSeconds: 5 })
  assert.deepEqual((await call('scanruler_wait', { for: 'idle', timeoutSeconds: 5 })).json.finished, [])
  const a = (await call('demo_change', { n: 12, ms: 150, wait: false })).json.job
  const b = (await call('demo_change', { fail: true, ms: 50, wait: false })).json.job
  const c = (await call('scanruler_batch', { calls: [{ tool: 'demo_change', arguments: { n: 13 } }, { tool: 'demo_change', arguments: { fail: true } }], wait: false })).json.job
  // A change answered directly was seen: it is not said again.
  await call('demo_change', { n: 14 })
  const idle = (await call('scanruler_wait', { for: 'idle', timeoutSeconds: 5 })).json
  assert.deepEqual(idle.finished.map((j) => [j.job, j.state]), [[a, 'done'], [b, 'failed'], [c, 'done']])
  assert.deepEqual(idle.finished[1].error, { code: 'invalid_state', message: 'Not now.' })
  assert.equal(idle.finished[2].failed.index, 1)
  assert.equal(idle.finished[0].error, undefined)
  // The state and what finished, not the whole status.
  assert.equal(idle.state, 'idle')
  assert.equal(idle.jobs, undefined)
  assert.ok((await call('scanruler_status')).json.jobs.every((j) => j.state !== 'running'))
  assert.deepEqual((await call('scanruler_wait', { for: 'idle', timeoutSeconds: 5 })).json.finished, [])
})

test('scanruler_wait for idle, still running at its time, says what the page is busy with', async () => {
  busyUntil = Date.now() + 5_000
  const running = (await call('scanruler_wait', { for: 'idle', timeoutSeconds: 0.3 })).json
  assert.equal(running.state, 'running')
  assert.equal(running.busy, 'working out a map')
  busyUntil = 0
  const idle = (await call('scanruler_wait', { for: 'idle', timeoutSeconds: 5 })).json
  assert.equal(idle.state, 'idle')
  assert.equal(idle.busy, undefined)
})

test('a refused read stops the batch and keeps what came before; only a refused change rolls back', async () => {
  history.length = 0
  sections.length = 0
  page.runs.length = 0
  const r = await call('scanruler_batch', { calls: [{ tool: 'section_cut', arguments: { name: 'A' } }, { tool: 'section_get', arguments: { section: 'B' } }, { tool: 'section_cut', arguments: { name: 'C' } }] })
  assert.equal(r.json.stopped, 1)
  assert.equal(r.json.failed.error.code, 'not_found')
  assert.equal(r.json.undone, undefined)
  assert.match(r.json.kept, /^section_get changes nothing, so its refusal undid nothing: what the batch changed before it stands\.$/)
  assert.deepEqual(sections, ['A'], 'the section stands')
  assert.deepEqual(history, ['Agent: cut A'])
  assert.ok(!ran().includes('history.restore'))
  // A refused change still takes the batch back whole.
  const back = await call('scanruler_batch', { calls: [{ tool: 'section_cut', arguments: { name: 'D' } }, { tool: 'demo_change', arguments: { fail: true } }] })
  assert.deepEqual(back.json.undone, ['Agent: cut D'])
  assert.equal(back.json.kept, undefined)
})

test('in a batch, a call refused busy waits for the page to be idle and is run again, once', async () => {
  history.length = 0
  sections.length = 0
  page.runs.length = 0
  busyUntil = Date.now() + 300
  const r = await call('scanruler_batch', { calls: [{ tool: 'section_cut', arguments: { name: 'E' } }, { tool: 'section_get', arguments: { section: 'E' } }] })
  assert.equal(r.json.failed, undefined, JSON.stringify(r.json))
  assert.equal(r.json.results[0].retried, 'busy')
  assert.deepEqual(r.json.results[0].result, { section: { name: 'E' } })
  assert.equal(r.json.results[1].retried, undefined)
  assert.ok(Date.now() >= busyUntil)
  const cuts = ran().filter((n) => n === 'section.cut')
  assert.equal(cuts.length, 2, 'refused once, run again once')
  assert.ok(ran().indexOf('session.state') < ran().lastIndexOf('section.cut'), 'idle asked before the second try')
})

test('two calls giving the same name refuse the batch before anything runs, naming both', async () => {
  history.length = 0
  page.runs.length = 0
  // A sketch and its extrude both named "Tabs", with good changes before them.
  const calls = [
    { tool: 'demo_change', arguments: { n: 1 } },
    { tool: 'demo_add', arguments: { feature: { kind: 'sketch', name: 'Tabs' } } },
    { tool: 'demo_read' },
    { tool: 'demo_add', arguments: { feature: { kind: 'extrude', name: ' tabs ' } } },
  ]
  const r = await call('scanruler_batch', { calls })
  assert.equal(r.error, true)
  assert.match(r.text, /^invalid_input: calls\[1\] \(demo_add\) and calls\[3\] \(demo_add\) both give the name “tabs” \(“Tabs”\) — names are unique across sketches and features.*Nothing was run/)
  assert.deepEqual(page.runs, [], 'nothing sent to the page, not even a checkpoint')
  assert.deepEqual(history, [])
  // In a features list, in an update's set, and an update's features list.
  const many = await call('scanruler_batch', { calls: [{ tool: 'demo_add', arguments: { features: [{ name: 'Arm' }, { name: 'Boss' }] } }, { tool: 'demo_update', arguments: { features: [{ feature: 'Rib', set: { name: 'boss' } }] } }] })
  assert.match(many.text, /calls\[0\] \(demo_add\) and calls\[1\] \(demo_update\) both give the name “boss”/)
  const twice = await call('scanruler_batch', { calls: [{ tool: 'demo_add', arguments: { features: [{ name: 'Arm' }, { name: 'ARM' }] } }] })
  assert.match(twice.text, /calls\[0\] \(demo_add\) gives the name “ARM” twice/)
  const renamed = await call('scanruler_batch', { calls: [{ tool: 'demo_update', arguments: { feature: 'Sketch 1', set: { name: 'Tabs' } } }, { tool: 'demo_add', arguments: { feature: { name: 'Tabs' } } }] })
  assert.match(renamed.text, /calls\[0\] \(demo_update\) and calls\[1\] \(demo_add\)/)
  assert.deepEqual(page.runs, [])
  // Names of their own: the batch runs; a command that names nothing is not looked into.
  const fine = await call('scanruler_batch', { calls: [{ tool: 'demo_add', arguments: { feature: { name: 'Tabs' } } }, { tool: 'demo_add', arguments: { feature: { name: 'Tabs extrude' } } }, { tool: 'section_cut', arguments: { name: 'Tabs' } }] })
  assert.equal(fine.error, false, fine.text)
  assert.equal(fine.json.ran, 3)
})

test('a long change keeps the page’s last progress line; scanruler_wait and the status answer it while it runs, without a progress token', async () => {
  const queued = await call('demo_compare', { ms: 600, wait: false })
  await new Promise((r) => setTimeout(r, 100))
  const early = await call('scanruler_wait', { for: 'job', job: queued.json.job, timeoutSeconds: 0.05 })
  assert.equal(early.json.state, 'running')
  assert.deepEqual(early.json.progress, { phase: 'Meshing the bodies…', percent: null })
  await new Promise((r) => setTimeout(r, 350))
  const listed = (await call('scanruler_status')).json.jobs.find((j) => j.job === queued.json.job)
  assert.deepEqual(listed.progress, { phase: 'Measuring the reference against the scan…', percent: 42 })
  assert.equal(typeof listed.runningMs, 'number')
  const done = await call('scanruler_wait', { for: 'job', job: queued.json.job, timeoutSeconds: 5 })
  assert.equal(done.json.state, 'done')
  assert.equal(done.json.progress, undefined, 'a finished job answers its result, not how far it got')
  // In a batch, the batch's job says which call the line came from.
  const batch = await call('scanruler_batch', { calls: [{ tool: 'demo_read' }, { tool: 'demo_compare', arguments: { ms: 400 } }], wait: false })
  await new Promise((r) => setTimeout(r, 300))
  const running = await call('scanruler_wait', { for: 'job', job: batch.json.job, timeoutSeconds: 0.05 })
  assert.deepEqual(running.json.progress, { phase: 'Measuring the reference against the scan…', percent: 42, call: 1 })
  assert.equal((await call('scanruler_wait', { for: 'job', job: batch.json.job, timeoutSeconds: 5 })).json.state, 'done')
})
