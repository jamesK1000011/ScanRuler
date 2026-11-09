// SPDX-License-Identifier: AGPL-3.0-only
// scanner.noise reads the scan check's noise (scan.qa) rather than its own,
// adds only the point spacing, and the session's "scanner" part carries
// the noise to plan with — the larger of the scanner's and this scan's —
// with where it came from and its warning.
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { installCommandHost, type CommandHost } from '../../../src/commands/host'
import { listCommands, registerCommands, runCommand } from '../../../src/commands/registry'
import { obj } from '../../../src/commands/schema'
import { readStateSection } from '../../../src/commands/stateSections'
import type { Command } from '../../../src/plugins/api'
import { useStore } from '../../../src/state/store'
import { readScanNoise } from '../../_shared/scanNoise'
import plugin from '../plugin'
import { useScanner } from '../state/scannerStore'

/** What the stand-in scan check answers: its noise.median and whether the
 *  mesh is a CAD tessellation. */
const qaSays = { median: 0.031, cad: false }
const qa: Command<Record<string, never>> = {
  name: 'qa',
  title: 'Scan check (stand-in)',
  description: 'Stand-in for the scan check.',
  input: obj({}),
  readOnly: true,
  run: async () => ({ noise: { median: qaSays.cad ? 0 : qaSays.median, p90: 0.05, sampled: 4000 }, ...(qaSays.cad ? { tessellation: { cad: true } } : {}) }),
}

function grid(step: number, k = 21) {
  const positions = new Float32Array(k * k * 3)
  for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) positions.set([i * step, j * step, 0], (j * k + i) * 3)
  const idx: number[] = []
  for (let j = 0; j + 1 < k; j++)
    for (let i = 0; i + 1 < k; i++) {
      const a = j * k + i
      idx.push(a, a + 1, a + k, a + 1, a + k + 1, a + k)
    }
  return { positions, indices: new Uint32Array(idx), normals: new Float32Array(k * k * 3) }
}

beforeAll(() => {
  plugin.install?.()
  // The app's own scan.qa where the test run registered the core commands.
  if (!listCommands().some((c) => c.name === 'scan.qa')) registerCommands('scan', [qa] as Command<never>[])
  const mesh = grid(0.4)
  installCommandHost({ session: { imports: { busy: false }, sceneRef: { current: { scanMesh: () => mesh } } } } as unknown as CommandHost)
})
beforeEach(() => {
  for (const p of useScanner.getState().profiles) useScanner.getState().remove(p.name)
  useScanner.getState().replace(null, null)
  useStore.setState({ fileName: 'plate.stl' })
  qaSays.median = 0.031
  qaSays.cad = false
})

const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => String(e),
  )

describe('scanner.noise', () => {
  test('takes the scan check’s noise and adds the spacing', async () => {
    const r = (await runCommand('scanner.noise', {})) as Record<string, unknown>
    expect(r).toMatchObject({ sigmaMm: 0.031, spacingMm: 0.4, readBy: 'scan.qa' })
    expect(useScanner.getState().measured).toMatchObject({ sigmaMm: 0.031, spacingMm: 0.4 })
  })

  test('refuses a CAD tessellation, which has no scan noise', async () => {
    qaSays.cad = true
    expect(await failure(runCommand('scanner.noise', {}))).toMatch(/CAD tessellation/)
    expect(useScanner.getState().measured).toBeNull()
  })

  test('refuses with no scan open', async () => {
    useStore.setState({ fileName: null })
    expect(await failure(runCommand('scanner.noise', {}))).toMatch(/no scan open/)
  })
})

describe('the session’s scanner part', () => {
  test('a measured scan with no scanner warns, and readScanNoise reads it', async () => {
    await runCommand('scanner.noise', {})
    const part = readStateSection('scanner') as { noise: Record<string, unknown> }
    expect(part.noise).toMatchObject({ sigmaMm: 0.031, source: 'measured', from: 'measured on this scan', finestMm: 0.093 })
    expect(part.noise.warning).toEqual(expect.stringMatching(/^No scanner is set/))
    expect(readScanNoise()).toMatchObject({ sigmaMm: 0.031, source: 'measured' })
  })

  test('the scanner’s noise is the floor under a scan that reads cleaner', async () => {
    await runCommand('scanner.add', { name: 'Bench', noiseMm: 0.05, use: true })
    await runCommand('scanner.noise', {})
    const part = readStateSection('scanner') as { noise: Record<string, unknown> }
    expect(part.noise).toMatchObject({ sigmaMm: 0.05, source: 'profile', from: 'scanner Bench', finestMm: 0.15 })
    expect(part.noise.warning).toBeUndefined()
    expect(readScanNoise()?.sigmaMm).toBe(0.05)
  })

  test('a scan well above its scanner plans with the scan’s, and warns', async () => {
    await runCommand('scanner.add', { name: 'Bench', noiseMm: 0.02, use: true })
    qaSays.median = 0.06
    await runCommand('scanner.noise', {})
    const part = readStateSection('scanner') as { noise: Record<string, unknown> }
    expect(part.noise).toMatchObject({ sigmaMm: 0.06, source: 'measured' })
    expect(part.noise.warning).toEqual(expect.stringMatching(/reads 0\.06 mm, 3× the 0\.02 mm Bench usually gives/))
  })
})
