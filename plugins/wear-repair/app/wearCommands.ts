// SPDX-License-Identifier: AGPL-3.0-only
// wear.*: a worn or damaged part brought back to what it should be, from
// its own other half or its CAD, and a print pre-warped so it comes out
// true. Everything in the frame the part is measured in now.

import { sceneOf } from '../../../src/commands/host'
import { arr, bool, enumOf, num, obj, oneOf, str, vec3 } from '../../../src/commands/schema'
import { rigidApply, rigidInvert } from '../../../src/core/deviation/rigid'
import { type Command, CommandError } from '../../../src/plugins/api'
import { useDeviation } from '../../../src/state/deviationStore'
import { useStore } from '../../../src/state/store'
import { mirror, surface, type Mesh, type Region } from '../core/geometry'
import { prewarp, stopRule } from '../core/prewarp'
import { diff, rebuild } from '../core/repair'
import { useWear, type Reference } from '../state/wearStore'

type Json = Record<string, unknown>


const regionSchema = oneOf(
  [
    { ...obj({ kind: enumOf(['box']), min: vec3('Lowest corner, mm.'), max: vec3('Highest corner, mm.') }, ['kind', 'min', 'max'], 'A box, square to the axes.'), title: 'box' },
    { ...obj({ kind: enumOf(['sphere']), center: vec3('Centre, mm.'), radius: num('mm.', { exclusiveMinimum: 0 }) }, ['kind', 'center', 'radius'], 'A ball.'), title: 'sphere' },
  ],
  'Where, in the frame the part is measured in now.',
)

function weld(src: ArrayLike<number>, index: ArrayLike<number> | null): Mesh {
  const count = index ? index.length : src.length / 3
  const map = new Map<string, number>()
  const pos: number[] = []
  const indices = new Uint32Array(count)
  for (let k = 0; k < count; k++) {
    const i = index ? index[k] : k
    const key = `${Math.round(src[3 * i] * 1e4)},${Math.round(src[3 * i + 1] * 1e4)},${Math.round(src[3 * i + 2] * 1e4)}`
    let v = map.get(key)
    if (v === undefined) {
      v = map.size
      map.set(key, v)
      pos.push(src[3 * i], src[3 * i + 1], src[3 * i + 2])
    }
    indices[k] = v
  }
  return { positions: Float64Array.from(pos), indices }
}

function scanMesh(): Mesh {
  if (!useStore.getState().fileName) throw new CommandError('no_scan', 'There is no scan open — open the worn part with scan.open.')
  const m = sceneOf()?.scanMesh()
  if (!m) throw new CommandError('unavailable', 'The scan is not on the stage.')
  return { positions: Float64Array.from(m.positions), indices: m.indices }
}

/** The aligned reference part in the scan's frame. */
function referenceInScanFrame(): Mesh {
  const d = useDeviation.getState()
  if (!d.nominalName) throw new CommandError('invalid_state', 'No reference part is open — deviation.open_reference with the CAD or a twin’s scan, then deviation.align.')
  if (!d.align) throw new CommandError('invalid_state', 'The reference is not aligned to the scan — run deviation.align first.')
  const g = sceneOf()?.nominalGeometry()
  if (!g) throw new CommandError('unavailable', 'The reference part is not on the stage.')
  const m = weld(g.getAttribute('position').array as ArrayLike<number>, g.getIndex()?.array ?? null)
  const back = rigidInvert(d.align.transform)
  const t = new Float64Array(3)
  for (let i = 0; i < m.positions.length; i += 3) {
    rigidApply(back, m.positions[i], m.positions[i + 1], m.positions[i + 2], t)
    m.positions.set(t, i)
  }
  return m
}

function referenceSurface(scan: Mesh) {
  const ref = useWear.getState().reference
  if (!ref) throw new CommandError('invalid_state', 'No reference chosen — wear.reference: mirror (the part’s own other half) or deviation (the CAD or a twin).')
  return surface(ref.source === 'mirror' ? mirror(scan, ref.point, ref.normal) : referenceInScanFrame())
}

const stl = (positions: Float64Array, indices: Uint32Array): Uint8Array => {
  const tris = indices.length / 3
  const buf = new ArrayBuffer(84 + 50 * tris)
  const view = new DataView(buf)
  view.setUint32(80, tris, true)
  for (let t = 0; t < tris; t++) {
    const o = 84 + 50 * t
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) view.setFloat32(o + 12 + 12 * k + 4 * a, positions[3 * indices[3 * t + k] + a], true)
  }
  return new Uint8Array(buf)
}

const stem = (name: string | null) => (name ?? 'part').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '_')

export const settings: Command<Partial<ReturnType<typeof useWear.getState>['settings']>> = {
  name: 'settings',
  title: 'Wear-repair settings',
  description: 'tolerance: what counts as worn, and the pre-warp’s target, mm (0.05). blendMm: how far outside a worn region a repair fades out (1). maxMm: how far the reference may be and still be the same surface (2). mode: add (only lost material comes back, the default) or both (what stands proud is trimmed too). Call with nothing to read them. Kept with the project.',
  input: obj({ tolerance: num('mm.', { exclusiveMinimum: 0 }), blendMm: num('mm.', { minimum: 0 }), maxMm: num('mm.', { exclusiveMinimum: 0 }), mode: enumOf(['add', 'both'], 'add or both.') }),
  history: false,
  run: async (p) => {
    if (Object.keys(p).length) useWear.getState().set(p)
    return { settings: useWear.getState().settings }
  },
}

export const tag: Command<{ action?: 'set' | 'remove' | 'clear' | 'list'; name?: string; kind?: 'worn' | 'keep'; region?: Json }> = {
  name: 'tag',
  title: 'Tag worn and kept regions',
  description: 'Name the regions of the part: worn — to be read and repaired — or keep — never moved (a fit face, a datum, a feature that is meant to differ from the other half). A region is a box or a sphere in the frame the part is measured in now (scan.query, section cuts and element fits say where things are). set adds or replaces one by name; remove, clear, list. Kept with the project.',
  input: obj({ action: enumOf(['set', 'remove', 'clear', 'list'], 'set by default when a region is given, else list.'), name: str('The region’s name.'), kind: enumOf(['worn', 'keep'], 'worn by default.'), region: regionSchema }),
  history: false,
  run: async ({ action, name, kind = 'worn', region }) => {
    const st = useWear.getState()
    const act = action ?? (region ? 'set' : 'list')
    if (act === 'set') {
      if (!name || !region) throw new CommandError('invalid_input', 'set needs a name and a region.')
      const reg = region as unknown as Region
      if (reg.kind === 'box' && reg.min.some((v, i) => v > reg.max[i])) throw new CommandError('invalid_input', 'A box’s min must not exceed its max.')
      st.tag({ name, kind, region: reg })
    } else if (act === 'remove') {
      if (!name || !st.untag(name)) throw new CommandError('not_found', `No region "${name}".`)
    } else if (act === 'clear') st.clearTags()
    return { tags: useWear.getState().tags }
  },
}

export const reference: Command<{ source?: 'mirror' | 'deviation'; plane?: 'x' | 'y' | 'z'; point?: number[]; normal?: number[] }> = {
  name: 'reference',
  title: 'What the part should be',
  description: 'The surface wear is read and repaired against. mirror: the part’s own other half, mirrored across its symmetry plane — plane x, y or z (through the origin, square to that axis: run align.symmetry first so the plane is one of them) or point and normal outright. deviation: the reference part open in the Deviation workspace, aligned (deviation.open_reference, deviation.align) — the CAD, a twin’s scan, or a catalog download. Call with nothing to read it. Kept with the project.',
  input: obj({ source: enumOf(['mirror', 'deviation'], 'mirror or deviation.'), plane: enumOf(['x', 'y', 'z'], 'For mirror: the symmetry plane square to this axis, through the origin.'), point: vec3('For mirror: a point on the plane.'), normal: vec3('For mirror: the plane’s normal.') }),
  history: false,
  run: async ({ source, plane, point, normal }) => {
    if (source === 'mirror') {
      const n = (plane ? { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[plane] : normal) as [number, number, number] | undefined
      if (!n || Math.hypot(...n) === 0) throw new CommandError('invalid_input', 'mirror needs plane (x, y or z) or a normal.')
      useWear.getState().setReference({ source: 'mirror', point: (point ?? [0, 0, 0]) as [number, number, number], normal: n })
    } else if (source === 'deviation') {
      referenceInScanFrame()
      useWear.getState().setReference({ source: 'deviation' })
    }
    return { reference: useWear.getState().reference as Reference | null }
  },
}

export const diffCommand: Command<{ names?: string[] }> = {
  name: 'diff',
  title: 'Read the wear',
  description: 'For each region tagged worn (or those named): how far the scan stands in from the reference — lost, the deepest, mm, negative — and out from it — added — with the mean, the RMS and how many points are past the tolerance either way. Changes nothing.',
  input: obj({ names: arr(str(), 'Only these regions.', { minItems: 1 }) }),
  readOnly: true,
  run: async ({ names }) => {
    const st = useWear.getState()
    const worn = st.tags.filter((t) => t.kind === 'worn' && (!names || names.includes(t.name)))
    if (!worn.length) throw new CommandError('invalid_state', 'No region tagged worn — wear.tag first.')
    const scan = scanMesh()
    const ref = referenceSurface(scan)
    return { reference: st.reference, tolerance: st.settings.tolerance, regions: diff(scan, ref, worn, st.settings.tolerance, st.settings.maxMm) }
  },
}

export const rebuildCommand: Command<{ names?: string[]; mode?: 'add' | 'both' }> = {
  name: 'rebuild',
  title: 'Repair the worn regions',
  description: 'The scan with each worn region brought back onto the reference — every vertex there moved to the reference surface, fading out over blendMm outside the region, never inside a region tagged keep, never where the reference is farther than maxMm — as an STL in the frame the part is measured in now. A worn or dented surface comes back; a piece broken off, with no scan surface left there, does not (model it from the reference instead). Read it after with wear.diff on the file opened as the scan. Changes nothing in the session.',
  input: obj({ names: arr(str(), 'Only these worn regions.', { minItems: 1 }), mode: enumOf(['add', 'both'], 'Overrides the setting.') }),
  readOnly: true,
  returnsFile: true,
  run: async ({ names, mode }) => {
    const st = useWear.getState()
    const worn = st.tags.filter((t) => t.kind === 'worn' && (!names || names.includes(t.name)))
    if (!worn.length) throw new CommandError('invalid_state', 'No region tagged worn — wear.tag first.')
    const scan = scanMesh()
    const ref = referenceSurface(scan)
    const before = diff(scan, ref, worn, st.settings.tolerance, st.settings.maxMm)
    const out = rebuild(scan, ref, { worn: worn.map((t) => t.region), keep: st.tags.filter((t) => t.kind === 'keep').map((t) => t.region), blendMm: st.settings.blendMm, maxMm: st.settings.maxMm, mode: mode ?? st.settings.mode })
    const after = diff({ positions: out.positions, indices: scan.indices }, ref, worn, st.settings.tolerance, st.settings.maxMm)
    return {
      file: { name: `${stem(useStore.getState().fileName)}-repaired.stl`, mimeType: 'model/stl', bytes: stl(out.positions, scan.indices) },
      moved: out.moved,
      largestMoveMm: out.largest,
      before: before.map((b) => ({ name: b.name, lost: b.lost, added: b.added, pointsLost: b.pointsLost })),
      after: after.map((a) => ({ name: a.name, lost: a.lost, added: a.added, pointsLost: a.pointsLost })),
    }
  },
}

export const prewarpCommand: Command<{ gain?: number; smooth?: number; fresh?: boolean }> = {
  name: 'prewarp',
  title: 'Pre-warp the target from a print of it',
  description: 'With the target open as the reference part (deviation.open_reference: the CAD, or a repaired part) and a scan of a print of it open as the scan, aligned (deviation.align): the target moved back at every point by the error the print shows there, smoothed over smooth neighbour rings (2) so scan scatter is not printed in, times gain (1) — as an STL in the target’s own frame, to print next. Each call is a run of the loop: rms is this print’s error, and stop says whether another run is worth it (under the tolerance, less than a fifth better than the last run, or three runs). fresh: start the run count again. Changes nothing in the session.',
  input: obj({ gain: num('How much of the error to undo, 0.2 to 1.5.', { minimum: 0.2, maximum: 1.5 }), smooth: num('Neighbour rings to smooth over, 0 to 10.', { minimum: 0, maximum: 10 }), fresh: bool('Start the run count again.') }),
  readOnly: true,
  returnsFile: true,
  run: async ({ gain = 1, smooth = 2, fresh }) => {
    const st = useWear.getState()
    const d = useDeviation.getState()
    if (!d.nominalName || !d.align) throw new CommandError('invalid_state', 'Open the target as the reference part and the print’s scan as the scan, then deviation.align.')
    const g = sceneOf()!.nominalGeometry()!
    const target = weld(g.getAttribute('position').array as ArrayLike<number>, g.getIndex()?.array ?? null)
    const scan = scanMesh()
    const t = new Float64Array(3)
    for (let i = 0; i < scan.positions.length; i += 3) {
      rigidApply(d.align.transform, scan.positions[i], scan.positions[i + 1], scan.positions[i + 2], t)
      scan.positions.set(t, i)
    }
    const res = prewarp(target, surface(scan), { gain, smooth: Math.round(smooth), maxMm: st.settings.maxMm })
    if (fresh) st.clearRuns()
    const run = useWear.getState().addRun(res.rms)
    const verdict = stopRule(useWear.getState().runs, st.settings.tolerance)
    return {
      file: { name: `${stem(d.nominalName)}-prewarp-${run.n}.stl`, mimeType: 'model/stl', bytes: stl(res.positions, target.indices) },
      run: run.n,
      rms: res.rms,
      largest: res.largest,
      ...(res.unread ? { unread: res.unread } : {}),
      runs: useWear.getState().runs.map((x) => ({ run: x.n, rms: x.rms })),
      stop: verdict.stop,
      why: verdict.why,
    }
  },
}

export const wearCommands = [settings, tag, reference, diffCommand, rebuildCommand, prewarpCommand] as Command<never>[]


