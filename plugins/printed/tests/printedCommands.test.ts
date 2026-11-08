// SPDX-License-Identifier: AGPL-3.0-only
// The printed.* commands as an agent runs them, against a stand-in for
// Reverse Engineer — a 40 × 40 × 10 block on the bed, its top, bottom and
// one side face — and for the Hardware workspace's hw.record. A trace plan
// and its features; made, with the traces body named and the circuit
// recorded; a failed feature taking everything out again; a closed channel
// recorded for its pause at its roof; a standing one refused for a pause
// and threaded instead; nets routed; a 3D route's profile plane; the check
// at a current; the calculator; the export's files; the refusals.
import { beforeAll, describe, expect, test } from 'vitest'
import { registerCommands, runCommand } from '../../../src/commands/registry'
import { registerStateSection } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { printedCommands } from '../app/printedCommands'
import { DEFAULT_SETTINGS } from '../core/plan'
import { settingsOf, usePrinted } from '../state/printedStore'

type V3 = [number, number, number]
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]]

const face = (index: number, centroid: V3, normal: V3) => ({ index, kind: 'plane', centroid, normal, area: 1600, fingerprint: { kind: 'plane', centroid, dir: normal } })
const BODIES: Record<string, { id: number; faces: Json[]; bounds: { min: V3; max: V3 } }> = {
  Block: { id: 1, faces: [face(0, [0, 0, 10], [0, 0, 1]), face(1, [0, 0, 0], [0, 0, -1]), face(2, [20, 0, 5], [1, 0, 0]), { index: 3, kind: 'cylinder', centroid: [0, 0, 5] }], bounds: { min: [-20, -20, 0], max: [20, 20, 10] } },
}
let features: Json[] = []
let renamed: Json[] = []
let records: Json[] = []
let failAt: string | null = null
let offHw: () => void = () => {}

function frameOf(p: Json): { origin: V3; normal: V3; basisU: V3; basisV: V3 } {
  const off = (p.offset as number) ?? 0
  if (p.kind === 'world') {
    const [n, u, v]: V3[] = p.axis === 'z' ? [[0, 0, 1], [1, 0, 0], [0, 1, 0]] : p.axis === 'x' ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : [[0, 1, 0], [0, 0, 1], [1, 0, 0]]
    return { origin: add([0, 0, 0], n, off), normal: n, basisU: u, basisV: v }
  }
  if (p.kind === 'radial') {
    const a = (p.angleDeg * Math.PI) / 180
    const ax = p.axis.axis
    // About Z: u out along the radius, v up Z. About X and Y likewise.
    const [u, v]: V3[] = ax === 'z' ? [[Math.cos(a), Math.sin(a), 0], [0, 0, 1]] : ax === 'x' ? [[0, Math.cos(a), Math.sin(a)], [1, 0, 0]] : [[Math.sin(a), 0, Math.cos(a)], [0, 1, 0]]
    const n = cross(u, v)
    return { origin: add([0, 0, 0], n, off), normal: n, basisU: u, basisV: v }
  }
  if (p.kind === 'bodyFace') {
    const n = p.face.dir as V3
    const u: V3 = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
    const v = cross(n, u)
    return { origin: add(p.face.centroid, n, off), normal: n, basisU: u, basisV: v }
  }
  throw new CommandError('invalid_input', `plane ${p.kind}`)
}

const anyIn = { type: 'object', additionalProperties: true } as never
const cmd = (name: string, run: (a: Json) => Promise<unknown>, readOnly = false): Command<Json> => ({ name, title: name, description: name, input: anyIn, readOnly, run })
const fake: Command<Json>[] = [
  cmd('body.describe', async ({ body, limit }) => {
    const name = typeof body === 'number' ? Object.keys(BODIES).find((k) => BODIES[k].id === body) : body
    const b = name ? BODIES[name] : undefined
    if (!b) throw new CommandError('not_found', `There is no body ${body}.`)
    return { bodies: [{ name, faceList: b.faces.slice(0, limit ?? b.faces.length) }] }
  }, true),
  cmd('plane.describe', async ({ plane, point }) => {
    const f = frameOf(plane)
    const d = sub(point, f.origin)
    return { ...f, point: { at: [dot(d, f.basisU), dot(d, f.basisV)], above: dot(d, f.normal) } }
  }, true),
  cmd('feature.add', async ({ features: list }) => {
    features.push(...list)
    return { added: list.map((f: Json) => ({ feature: { name: f.name, status: f.name === failAt ? 'failed' : 'ok' }, result: { status: f.name === failAt ? 'failed' : 'ok', ...(f.name === failAt ? { message: 'the kernel said no' } : {}) } })) }
  }),
  cmd('feature.remove', async ({ feature }) => {
    features = features.filter((f) => f.name !== feature)
    return { removed: feature }
  }),
  cmd('body.set', async (a) => {
    renamed.push(a)
    return { body: a }
  }),
  cmd('export.stl', async ({ bodies }) => ({ file: { name: 'x.stl', mimeType: 'model/stl', bytes: new TextEncoder().encode(`solid ${bodies[0]}`) } }), true),
]
const hwRecord = cmd('record', async (a) => {
  records.push(a)
  return { recorded: { id: 'E1', ...a } }
})

beforeAll(() => {
  registerCommands('reverse', fake as Command<never>[])
  offHw = registerCommands('hw', [hwRecord] as Command<never>[])
  registerCommands('printed', printedCommands)
  registerStateSection('reverse', () => ({ features: features.map((f) => ({ name: f.name })), bodies: [...Object.entries(BODIES).map(([name, b]) => ({ id: b.id, name, bounds: b.bounds })), ...renamed.map((r, i) => ({ id: 100 + i, name: r.name, bounds: null }))] }))
})

const reset = () => {
  features = []
  renamed = []
  records = []
  failAt = null
  usePrinted.setState({ ...settingsOf(DEFAULT_SETTINGS), plan: null, made: [], check: null, busy: null })
}

const run = (name: string, input: Json = {}) => runCommand(`printed.${name}`, input) as Promise<Json>
const refused = async (p: Promise<unknown>, re: RegExp) => {
  let err: unknown
  try {
    await p
  } catch (e) {
    err = e
  }
  expect(err instanceof Error).toBe(true)
  if (!re.test((err as Error).message)) throw new Error(`"${(err as Error).message}" does not match ${re}`)
}

const LED = { name: 'LED', points: [[-10, 0], [10, 0]], pads: [{ at: [-10, 0] }, { at: [10, 0], shape: 'square' }] }

describe('printed.plan and apply: traces', () => {
  test('a trace on the top face: its resistance and the features, nothing changed', async () => {
    reset()
    const p = await run('plan', { body: 'Block', on: { face: 0 }, depth: 1, thickness: 1, nets: [LED] })
    expect(p.name).toBe('Traces')
    expect(p.nets[0]).toMatchObject({ name: 'LED', length: 20, width: 2, thickness: 1, run: 3000 })
    expect(p.frame).toEqual({ normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0], into: -1 })
    expect(p.features.map((f: Json) => f.name)).toEqual(['Traces sketch', 'Traces pads sketch', 'Traces', 'Traces pads', 'Traces cut'])
    expect(p.features[0].plane).toMatchObject({ kind: 'bodyFace', body: 'Block' })
    expect(features).toEqual([])
    expect(usePrinted.getState().plan!.name).toBe('Traces')
  })

  test('made: one batch, the traces body named, the circuit kept for export', async () => {
    reset()
    await run('plan', { body: 'Block', on: { face: 0 }, nets: [LED] })
    const r = await run('apply')
    expect(features.map((f) => f.name)).toEqual(['Traces sketch', 'Traces', 'Traces cut'])
    expect(renamed).toEqual([{ body: 'Traces', name: 'Traces' }])
    expect(r.made).toMatchObject({ id: 'C1', method: 'trace', body: 'Block', traces: 'Traces', filament: 'Protopasta conductive PLA' })
    expect(usePrinted.getState().made).toHaveLength(1)
    // Flush at the surface (depth 0): the pads lie in the run's layer, no column; and it is cut out of the part.
    expect(r.features.map((f: Json) => f.status)).toEqual(['ok', 'ok', 'ok'])
  })

  test('a flush trace still cuts the part: depth 0 … thickness', async () => {
    reset()
    const p = await run('plan', { body: 'Block', on: { face: 0 }, nets: [LED] })
    expect(p.features.find((f: Json) => f.name === 'Traces').extent).toEqual({ kind: 'distance', from: 0, to: -0.6 })
    expect(p.features.find((f: Json) => f.kind === 'boolean')).toMatchObject({ body: 'Block', tool: 'Traces', keep: true })
  })

  test('a second plan takes the next name', async () => {
    reset()
    await run('apply', { body: 'Block', on: { face: 0 }, nets: [LED] })
    const p = await run('plan', { body: 'Block', on: { face: 0 }, nets: [LED] })
    expect(p.name).toBe('Traces 2')
  })

  test('a feature that fails: everything taken out again, nothing recorded', async () => {
    reset()
    failAt = 'Traces cut'
    await refused(run('apply', { body: 'Block', on: { face: 0 }, depth: 1, thickness: 1, nets: [LED] }), /could not be made: the kernel said no \(Traces cut\)\. Nothing was kept/)
    expect(features).toEqual([])
    expect(usePrinted.getState().made).toEqual([])
  })

  test('refusals: a round face, two nets alike, a channel’s carrier on a trace, points with no sheet', async () => {
    reset()
    await refused(run('plan', { body: 'Block', on: { face: 3 }, nets: [LED] }), /is a cylinder: runs are drawn on a flat face/)
    await refused(run('plan', { body: 'Block', on: { face: 0 }, nets: [LED, LED] }), /Two nets are named "LED"/)
    await refused(run('plan', { body: 'Block', on: { face: 0 }, carrier: { kind: 'wire', awg: 22 }, nets: [LED] }), /carrier: a channel’s/)
    await refused(run('plan', { body: 'Block', nets: [LED] }), /on: the face or plane/)
    await refused(run('plan', { body: 'Block', on: { face: 0 }, nets: [{ name: 'X', pads: [{ at: [0, 0] }, { at: [5, 0] }] }] }), /route it \(printed\.route\)/)
    await refused(run('apply'), /Plan it first/)
    await refused(run('plan', { body: 'Block', on: { face: 0 }, nets: [{ name: 'Dot', points: [[1, 1], [1, 1]] }] }), /all at one place/)
    await refused(run('route', { body: 'Block', on: { face: 0 }, nets: [{ name: 'Same', pads: [{ at: [1, 1] }, { at: [1, 1] }] }] }), /two pads are at one place/)
    await refused(run('route', { body: 'Block', on: { face: 0 }, nets: [{ name: 'K', pads: [{ at: [0, 0] }, { at: [5, 0] }] }], keepouts: [{ circle: [0, 5, -1] }] }), /r more than 0/)
    const far = await run('plan', { body: 'Block', on: { face: 0 }, nets: [{ name: 'Far', points: [[0, 0], [60, 0]] }] })
    expect(far.warnings.join(' ')).toMatch(/far from face 0’s centre/)
  })

  test('points as Circuit JSON route points ({ x, y, width }), and 3D points taken onto the face', async () => {
    reset()
    const p = await run('plan', { body: 'Block', on: { face: 0 }, nets: [{ name: 'T1', points: [{ x: 0, y: 0, width: 1 }, { x: 0, y: 12, width: 1 }] }, { name: 'T2', points: [[10, 0, 10], [10, 12, 7]] }] })
    expect(p.nets[0]).toMatchObject({ width: 1, length: 12 })
    expect(p.nets[1]).toMatchObject({ width: 2, length: 12 })
  })
})

describe('channels', () => {
  test('a closed channel for AWG 22 on the top face: recorded for its pause at its top', async () => {
    reset()
    const p = await run('plan', { method: 'channel', body: 'Block', on: { face: 0 }, depth: 1, carrier: { kind: 'wire', awg: 22 }, nets: [{ name: 'W', points: [[-10, 0], [10, 0]] }] })
    expect(p.pause).toEqual({ top: 9 })
    expect(p.features[1]).toMatchObject({ kind: 'extrude', op: 'cut', target: 'Block', extent: { from: -1 } })
    const r = await run('apply')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ body: 'Block', top: 9, roof: 1 })
    expect(records[0].what).toMatch(/AWG 22 copper wire in Channels/)
    expect(r.made.pause).toMatchObject({ top: 9, recorded: true })
  })

  test('from the bottom face, up: the top is the floor plus roof plus height', async () => {
    reset()
    const p = await run('plan', { method: 'channel', body: 'Block', on: { face: 1 }, depth: 1, carrier: { kind: 'tape', width: 5, thickness: 0.1 }, nets: [{ name: 'T', points: [[-10, 0], [10, 0]] }] })
    expect(p.pause.top).toBeCloseTo(1 + 0.3, 9)
  })

  test('a closed channel on a standing face: refused for a pause, taken threaded', async () => {
    reset()
    await refused(run('plan', { method: 'channel', body: 'Block', on: { face: 2 }, depth: 1, carrier: { kind: 'wire', awg: 24 }, nets: [{ name: 'W', points: [[-10, 0], [10, 2]] }] }), /has to run level/)
    const p = await run('plan', { method: 'channel', body: 'Block', on: { face: 2 }, depth: 1, lay: 'thread', carrier: { kind: 'wire', awg: 24 }, nets: [{ name: 'W', points: [[-10, 0], [10, 2]], pads: [{ at: [-10, 0] }, { at: [10, 2] }] }] })
    expect(p.pause).toBeUndefined()
    expect(p.notes.join(' ')).toMatch(/Threaded after printing/)
  })

  test('paint is for an open groove; a roof deeper than the part is refused', async () => {
    reset()
    await refused(run('plan', { method: 'channel', body: 'Block', on: { face: 0 }, depth: 1, carrier: { kind: 'paint', width: 2, sheetResistance: 50 }, nets: [{ name: 'P', points: [[0, 0], [10, 0]] }] }), /Paint goes into an open groove/)
    await refused(run('plan', { method: 'channel', body: 'Block', on: { face: 0 }, depth: 9.5, carrier: { kind: 'wire', awg: 22 }, nets: [{ name: 'W', points: [[0, 0], [10, 0]] }] }), /out the far side of Block/)
    await refused(run('plan', { body: 'Block', on: { face: 0 }, depth: 9.8, thickness: 0.4, nets: [LED] }), /reach Z -0\.2, out the far side/)
    const thin = await run('plan', { body: 'Block', on: { face: 0 }, depth: 9, thickness: 0.6, nets: [LED] })
    expect(thin.warnings.join(' ')).toMatch(/Only 0\.4 of part beyond the traces/)
  })

  test('no Hardware workspace: the pause is said, not recorded', async () => {
    reset()
    offHw()
    try {
      const r = await run('apply', { method: 'channel', body: 'Block', on: { face: 0 }, depth: 1, carrier: { kind: 'wire', awg: 22 }, nets: [{ name: 'W', points: [[-10, 0], [10, 0]] }] })
      expect(r.made.pause).toMatchObject({ top: 9, recorded: false })
      // 9 above the block's bottom at Z 0.
      expect(r.notes.join(' ')).toMatch(/Hardware workspace is not in this build: pause the print at 9 mm above the bed/)
      expect(records).toEqual([])
    } finally {
      offHw = registerCommands('hw', [hwRecord] as Command<never>[])
    }
  })
})

describe('printed.route', () => {
  test('two pads routed round a keep-out, then planned', async () => {
    reset()
    const r = await run('route', { body: 'Block', on: { face: 0 }, nets: [{ name: 'A', width: 1, pads: [{ at: [-10, 0] }, { at: [10, 0] }] }], keepouts: [{ rect: [-2, -4, 2, 4] }] })
    expect(r.failed).toEqual([])
    expect(r.routed[0].length).toBeGreaterThan(20)
    expect(r.plan.nets[0].name).toBe('A')
    expect((usePrinted.getState().plan!.input.nets as Json[])[0].points.length).toBeGreaterThan(2)
  })

  test('a net that can’t get through is reported; the rest is planned', async () => {
    reset()
    const r = await run('route', { body: 'Block', on: { face: 0 }, bounds: [-15, -15, 15, 15], nets: [{ name: 'Done', points: [[-12, 12], [12, 12]] }, { name: 'Walled', width: 1, pads: [{ at: [-10, 0] }, { at: [10, 0] }] }], keepouts: [{ rect: [-1, -20, 1, 20] }] })
    expect(r.failed.map((f: Json) => f.net)).toEqual(['Walled'])
    expect(r.plan.nets.map((n: Json) => n.name)).toEqual(['Done'])
  })
})

describe('3D routes', () => {
  test('a route starting along X: its profile on the YZ plane through its start, swept', async () => {
    reset()
    const p = await run('plan', { body: 'Block', nets: [{ name: 'R', width: 1, path: [[-10, 0, 5], [10, 0, 5], [10, 10, 5]] }] })
    const prof = p.features.find((f: Json) => f.name === 'Traces R profile')
    expect(prof.plane).toEqual({ kind: 'world', axis: 'x', offset: -10 })
    const sw = p.features.find((f: Json) => f.kind === 'sweep')
    expect(sw).toMatchObject({ name: 'Traces', op: 'new', route: { points: [[-10, 0, 5], [10, 0, 5], [10, 10, 5]], bendRadius: 1 } })
    // 30 − 2·1·tan45 + π/2 = 29.571; along the layers: 300 Ω·mm × 29.571 / 0.6.
    expect(p.nets[0].length).toBeCloseTo(28 + Math.PI / 2, 3)
    expect(p.nets[0].run).toBeCloseTo((300 * (28 + Math.PI / 2)) / 0.6, 0)
  })

  test('a route starting on a level diagonal: a plane through Z turned square to it', async () => {
    reset()
    const p = await run('plan', { body: 'Block', nets: [{ name: 'D', width: 1, path: [[0, 0, 5], [5, 5, 5], [5, 15, 5]] }] })
    const prof = p.features.find((f: Json) => f.name === 'Traces D profile')
    expect(prof.plane.kind).toBe('radial')
    const f = frameOf(prof.plane)
    expect(Math.abs(dot(f.normal, [Math.SQRT1_2, Math.SQRT1_2, 0]))).toBeCloseTo(1, 9)
    expect(Math.abs(dot(sub([0, 0, 5], f.origin), f.normal))).toBeLessThan(1e-6)
  })

  test('a route starting and ending askew to every axis is refused', async () => {
    reset()
    await refused(run('plan', { body: 'Block', nets: [{ name: 'S', path: [[0, 0, 0], [5, 5, 5], [10, 12, 7]] }] }), /lie square to X, Y or Z/)
  })
})

describe('check, resistance, export', () => {
  test('check at 1 mA: the drop and power', async () => {
    reset()
    await run('plan', { body: 'Block', on: { face: 0 }, depth: 0, thickness: 1, nets: [{ name: 'A', points: [[0, 0], [100, 0]] }] })
    const c = await run('check', { current: 0.001 })
    expect(c.nets[0]).toMatchObject({ resistance: 15000, volts: 15, watts: 0.015 })
    expect(c.nets[0].wPerM).toBeCloseTo(0.15, 9)
  })

  test('the calculator: AWG 22 over a metre, Protopasta through the layers', async () => {
    reset()
    const w = await run('resistance', { conductor: { kind: 'wire', awg: 22 }, length: 1000 })
    expect(w.resistance).toBeCloseTo(0.0516, 4)
    const f = await run('resistance', { conductor: 'protopasta', length: 100, width: 2, thickness: 1, climb: 'through', current: 0.001 })
    expect(f).toMatchObject({ resistance: 57500, volts: 57.5 })
    await refused(run('resistance', { conductor: 'protopasta', length: 10 }), /width and thickness/)
  })

  test('export: the part and its traces as named STLs, with which filament each takes', async () => {
    reset()
    await refused(run('export'), /No traces made yet/)
    await run('apply', { body: 'Block', on: { face: 0 }, nets: [LED] })
    const r = await run('export')
    expect(r.file.mimeType).toBe('application/zip')
    expect(r.files).toEqual([
      { file: 'Block.stl', body: 'Block', filament: 'filament 1 — the part’s own' },
      { file: 'Traces.stl', body: 'Traces', filament: 'filament 2 — Protopasta conductive PLA' },
    ])
    const text = new TextDecoder().decode(r.file.bytes)
    expect(text).toContain('filaments.txt')
    expect(text).toContain('solid Traces')
  })

  test('set: custom figures only with the custom material; the plan goes stale', async () => {
    reset()
    await run('plan', { body: 'Block', on: { face: 0 }, nets: [LED] })
    await refused(run('set', { along: 5 }), /custom material/)
    const s = await run('set', { material: 'custom', along: 5 })
    expect(s.settings.material).toBe('custom')
    expect(s.plan.stale).toMatch(/settings changed/)
    const p = await run('plan', { body: 'Block', on: { face: 0 }, depth: 0, thickness: 1, nets: [{ name: 'A', points: [[0, 0], [100, 0]] }] })
    expect(p.nets[0].run).toBe(2500)
  })
})
