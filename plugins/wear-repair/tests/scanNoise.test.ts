// SPDX-License-Identifier: AGPL-3.0-only
// Wear repair with the scan noise to plan with: the least tolerance a scan
// supports is twice its scatter off the worn regions or three times the
// scan noise (Scanner noise's, read through the shared reader), the
// larger; wear.diff says which, and warns when the tolerance is under it.
import { beforeAll, describe, expect, test } from 'vitest'
import { installCommandHost, type CommandHost } from '../../../src/commands/host'
import { registerStateSection } from '../../../src/commands/stateSections'
import { useStore } from '../../../src/state/store'
import { diffCommand } from '../app/wearCommands'
import { scatterNote, toleranceFloor } from '../core/repair'
import { useWear } from '../state/wearStore'

describe('the least tolerance', () => {
  test('the larger of twice the scatter and three times the noise', () => {
    expect(toleranceFloor({ mm: 0.02 }, { sigmaMm: 0.01 })).toEqual({ mm: 0.04, by: 'scatter' })
    expect(toleranceFloor({ mm: 0.02 }, { sigmaMm: 0.03 })).toEqual({ mm: 0.09, by: 'noise' })
    expect(toleranceFloor(null, { sigmaMm: 0.03 })).toEqual({ mm: 0.09, by: 'noise' })
    expect(toleranceFloor({ mm: 0.02 }, null)).toEqual({ mm: 0.04, by: 'scatter' })
    expect(toleranceFloor(null, null)).toBeNull()
  })

  test('the note names what sets it', () => {
    expect(scatterNote({ mm: 0.03 }, 0.05)).toMatch(/twice the scan's scatter/)
    expect(scatterNote({ mm: 0.01 }, 0.05, { sigmaMm: 0.03, from: 'scanner Bench' })).toMatch(/under three times the scan noise \(0\.03 mm, scanner Bench\).*raise it to about 0\.09 mm/)
    expect(scatterNote({ mm: 0.01 }, 0.1, { sigmaMm: 0.03, from: 'scanner Bench' })).toBeNull()
  })
})

/** A flat plate across x = 0, its own mirror image: no scatter at all. */
function plate(step = 0.5, half = 10) {
  const k = Math.round((2 * half) / step) + 1
  const positions = new Float32Array(k * k * 3)
  for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) positions.set([-half + i * step, -half + j * step, 0], (j * k + i) * 3)
  const idx: number[] = []
  for (let j = 0; j + 1 < k; j++)
    for (let i = 0; i + 1 < k; i++) {
      const a = j * k + i
      idx.push(a, a + 1, a + k, a + 1, a + k + 1, a + k)
    }
  return { positions, indices: new Uint32Array(idx), normals: new Float32Array(k * k * 3) }
}

describe('wear.diff', () => {
  const ctx = { progress() {}, signal: new AbortController().signal } as never
  beforeAll(() => {
    const mesh = plate()
    installCommandHost({ session: { imports: { busy: false }, sceneRef: { current: { scanMesh: () => mesh } } } } as unknown as CommandHost)
    useStore.setState({ fileName: 'plate.stl', modelSize: 14 })
    useWear.getState().set({ tolerance: 0.05 })
    useWear.getState().tag({ name: 'Worn 1', kind: 'worn', region: { kind: 'box', min: [4, -2, -1], max: [8, 2, 1] } })
    useWear.getState().setReference({ source: 'mirror', point: [0, 0, 0], normal: [1, 0, 0] })
  })

  test('without Scanner noise, a clean scan clears the tolerance', async () => {
    const r = (await diffCommand.run({}, ctx)) as Record<string, unknown>
    expect(r.scatter).toBe(0)
    expect(r.scanNoise).toBeUndefined()
    expect(r.note).toBeUndefined()
  })

  test('with a scanner noisier than the tolerance allows, it says so', async () => {
    const stop = registerStateSection('scanner', () => ({ profile: { name: 'Bench', noiseMm: 0.05 }, measured: { sigmaMm: 0.02 } }))
    try {
      const r = (await diffCommand.run({}, ctx)) as Record<string, unknown>
      expect(r.scanNoise).toMatchObject({ sigmaMm: 0.05, source: 'profile', from: 'scanner Bench', finestMm: 0.15 })
      expect(r.floor).toEqual({ mm: 0.15, by: 'noise' })
      expect(r.note).toEqual(expect.stringMatching(/under three times the scan noise \(0\.05 mm, scanner Bench\)/))
    } finally {
      stop()
    }
  })
})
