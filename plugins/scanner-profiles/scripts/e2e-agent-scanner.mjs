// SPDX-License-Identifier: AGPL-3.0-only
// scanner-profiles through scanruler-mcp: a plate scanned with 0.03 mm of
// noise is opened and its noise read back; a profile is saved from it,
// used for the project, and comes back with the project.
//
//   APP_URL=http://localhost:5173 node plugins/scanner-profiles/scripts/e2e-agent-scanner.mjs

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, fail, finish, launchAgent, launchApp, OUT_DIR, repoFile } from '../../../scripts/e2e-lib.mjs'

if (!existsSync(repoFile('mcp/node_modules/@modelcontextprotocol/sdk/package.json'))) {
  console.error('FATAL: the MCP server has no dependencies yet — run npm --prefix mcp ci.')
  process.exit(1)
}
const { startAgent } = await import('../../../mcp/tests/client.js')

const SIGMA = 0.03
function noisyPlate(step = 0.5, size = 50) {
  let s = 11
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand())
  const k = Math.round(size / step) + 1
  const z = Array.from({ length: k * k }, () => SIGMA * gauss())
  const at = (i, j) => [i * step, j * step, z[j * k + i]]
  const tris = []
  for (let j = 0; j + 1 < k; j++)
    for (let i = 0; i + 1 < k; i++) tris.push([at(i, j), at(i + 1, j), at(i, j + 1)], [at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)])
  const buf = Buffer.alloc(84 + tris.length * 50)
  buf.writeUInt32LE(tris.length, 80)
  tris.forEach((t, n) => t.forEach((p, a) => p.forEach((v, b) => buf.writeFloatLE(v, 84 + n * 50 + 12 + a * 12 + b * 4))))
  return buf
}
mkdirSync(OUT_DIR, { recursive: true })
const scan = join(OUT_DIR, 'noisy-plate.stl')
writeFileSync(scan, noisyPlate())

const { agent } = await launchAgent(startAgent)
const { call } = agent
async function ok(name, input) {
  const r = await call(name, input)
  if (r.error) fail(`${name}: ${r.text}`)
  return r
}
const link = /(\S+#agent=\d+:[\w-]+)/.exec((await call('scanruler_status')).json?.howToConnect ?? '')?.[1]
check(Boolean(link), `the server hands out a pairing link (${link})`)
const { browser, consoleErrors } = await launchApp({ url: link, protocolTimeout: 300_000 })
try {
  const waited = await call('scanruler_wait', { for: 'page', timeoutSeconds: 90 })
  check(waited.json?.connected === true && waited.json.page.plugins.includes('scanner-profiles'), `the page connected with scanner-profiles (${waited.json?.page?.plugins})`)
  await ok('scan_open', { path: scan, discard: true })
  const n = await ok('scanner_noise', {})
  check(Math.abs(n.json.sigmaMm / SIGMA - 1) < 0.2 && Math.abs(n.json.spacingMm - 0.5) < 0.1, `scanner_noise reads ${n.json?.sigmaMm} mm (planted ${SIGMA}), spacing ${n.json?.spacingMm} mm`)
  await ok('scanner_add', { name: 'Test scanner, fine mode', noiseMm: n.json.sigmaMm, spacingMm: n.json.spacingMm, note: 'matte spray', use: true })
  const st = await ok('session_state', {})
  check(st.json?.plugins?.scanner?.noise?.from === 'profile Test scanner, fine mode', `the session plans with the profile: ${JSON.stringify(st.json?.plugins?.scanner?.noise)}`)
  const projectFile = join(OUT_DIR, 'scanner.scanruler')
  await ok('project_save', { path: projectFile })
  await ok('project_load', { path: projectFile, discard: true })
  const back = await ok('scanner_list', {})
  check(back.json?.using?.name === 'Test scanner, fine mode' && back.json.measured?.sigmaMm === n.json.sigmaMm, 'the profile and the measured noise come back with the project')
} finally {
  await agent.close?.()
  await finish(browser, consoleErrors)
}
