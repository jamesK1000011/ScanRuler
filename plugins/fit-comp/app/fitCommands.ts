// SPDX-License-Identifier: AGPL-3.0-only
// fit.*: a scanned print read against the CAD it was printed from, and what
// to change in the slicer — or in the model — so the next one fits.
// The Deviation workspace opens and aligns the two (deviation.open_reference,
// deviation.align); fit-comp reads the reference's walls, floors, holes and
// bosses on the scan and fits the print's scale, contour offset, hole offset
// and elephant foot to them (core/solve.ts).

import { arr, bool, enumOf, num, obj, str, anyObject } from '../../../src/commands/schema'
import { type Command, CommandError } from '../../../src/plugins/api'
import { noTrueSize, noTrueSizeText } from '../../../src/core/scanScale'
import { useStore } from '../../../src/state/store'
import { compensate, stlBytes } from '../core/compensate'
import { fromBuild, UPS, type Up } from '../core/frame'
import { measure } from '../core/measure'
import { solve, type Solution } from '../core/solve'
import { corrections, iniFragment, slicerChanges, type Keymap } from '../core/suggest'
import { judgeNoise, noiseNotes } from '../core/noiseCheck'
import { readScanNoise, scanNoiseAnswer } from '../../_shared/scanNoise'
import { useFit, type FitRun, type FitSettings } from '../state/fitStore'
import { POOR_FIT } from '../../_shared/printerFit'
import { alignedScan, reference } from './geometry'
import { shareCalibration } from './shareCalibration'

type Json = Record<string, unknown>

const BUILT_IN: Keymap[] = Object.values(import.meta.glob<Keymap>('../keymaps/*.json', { eager: true, import: 'default' }))


/** A scan with no true size — Meshroom's, or one a few millimetres or
 *  several metres across — measured as if it had one gives confident
 *  nonsense: said with the answer, with how to scale it. */
const sizeWarning = () => {
  const st = useStore.getState()
  const across = 2 * st.modelSize
  const none = noTrueSize(st.fileName, across, Boolean(st.scanScale))
  return none ? { sizeWarning: noTrueSizeText(none, across) } : {}
}

export const keymaps = (): Keymap[] => [...BUILT_IN.filter((b) => !useFit.getState().keymaps.some((k) => k.id === b.id)), ...useFit.getState().keymaps]

function keymapOf(id: string): Keymap {
  const k = keymaps().find((m) => m.id === id)
  if (!k) throw new CommandError('not_found', `No slicer key map "${id}" — have ${keymaps().map((m) => m.id).join(', ')}; add your own with fit.keymaps.`)
  return k
}

const r = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d
const mmText = (v: number) => `${v} mm`
const AXES = ['X', 'Y', 'Z']

function lastRun(): FitRun {
  const run = useFit.getState().runs.at(-1)
  if (!run) throw new CommandError('invalid_state', 'Nothing measured yet — run fit.measure first.')
  return run
}

/** A run whose fit is poor (Print fit's guide: over about 4, don't
 *  suggest offsets) is refused for anything that turns its offsets into
 *  settings or a model: a scale and offsets don't describe the print. */
export function trusted(run: FitRun): FitRun {
  if (run.solution.fit > POOR_FIT)
    throw new CommandError('invalid_state', `Run ${run.n} fits poorly (${r(run.solution.fit, 2)}, over ${POOR_FIT}): the print warped, lifted or is badly aligned, so its offsets would mislead. Check the outliers and the deviation map, fix the cause, and measure again.`)
  return run
}

function describeSolution(s: Solution) {
  const e = (x: { value: number; se: number; determined: boolean }, d = 4) => ({ value: r(x.value, d), se: r(x.se, d), ...(x.determined ? {} : { determined: false }) })
  return {
    scale: { x: e(s.scale.x, 5), y: e(s.scale.y, 5), z: e(s.scale.z, 5) },
    contourOffset: e(s.contour),
    holeOffset: e(s.hole),
    elephantFoot: s.foot ? { value: r(s.foot.value), se: r(s.foot.se), walls: s.foot.readings } : null,
    fit: s.fit,
    ...(s.outliers.length ? { outliers: s.outliers } : {}),
  }
}

const featureList = arr(str(), 'Feature ids as fit.features gives them (+X1, H2, B1 …).', { minItems: 1 })

export const settings: Command<Partial<FitSettings> & { reset?: boolean }> = {
  name: 'settings',
  title: 'Print-fit settings',
  description:
    'What fit-comp reads with and writes for. up: which way of the reference stood up on the printer (+z by default). band: how far off the nominal surface a scan point still counts, mm (1). firstLayer: the first layer’s height, mm (0.2) — the slab the elephant foot is read in. slicer: the key map suggestions are written for (orcaslicer, bambustudio, prusaslicer, or one of your own — fit.keymaps). printer, material, nozzle: what it was printed on, kept with each run and profile. current: the slicer’s values in use when it was printed, by key ({ "xy_hole_compensation": 0.05 }) — the suggestions add to them. Call with nothing to read them. Kept with the project.',
  input: obj({
    up: enumOf(UPS, 'Which way of the reference stood up on the printer.'),
    band: num('mm.', { minimum: 0.1, maximum: 5 }),
    firstLayer: num('mm.', { minimum: 0.05, maximum: 1 }),
    slicer: str('A key map id.'),
    printer: str('The printer, e.g. "Bambu H2D".'),
    material: str('The filament, e.g. "PETG, Polymaker".'),
    nozzle: str('e.g. "0.4".'),
    current: anyObject('The slicer’s values in use, by key — numbers; percentages as numbers (100 for 100 %).'),
    reset: bool('Back to the defaults (runs and profiles stay).'),
  }),
  history: false,
  run: async ({ reset, ...p }) => {
    const st = useFit.getState()
    if (reset) st.setSettings({ up: '+z', band: 1, firstLayer: 0.2, slicer: 'orcaslicer', printer: '', material: '', nozzle: '', current: {}, inner: [], ignore: [] })
    if (p.slicer) keymapOf(p.slicer)
    if (p.current) for (const [k, v] of Object.entries(p.current)) if (typeof v !== 'number') throw new CommandError('invalid_input', `current.${k} must be a number.`)
    if (Object.keys(p).length) st.setSettings(p)
    return { settings: useFit.getState().settings, slicers: keymaps().map((k) => k.id) }
  },
}

export const features: Command<{ detail?: 'brief' | 'full' }> = {
  name: 'features',
  title: 'The reference’s features fit-comp reads',
  description:
    'The walls (faces square to X or Y), floors and tops (square to Z), holes and bosses (upright round walls) found on the reference part in the build frame (fit.settings up), each with an id, its nominal place and size, and whether it is tagged inner or ignored (fit.tag). Faces at an angle and curved surfaces other than upright circles are not read. Changes nothing.',
  input: obj({ detail: enumOf(['brief', 'full'], 'full adds each face’s extent.') }),
  readOnly: true,
  run: async ({ detail = 'brief' }) => {
    const { settings: s } = useFit.getState()
    const ref = reference(s.up)
    const f = ref.features
    return {
      reference: ref.name,
      up: s.up,
      bed: r(f.zMin, 3),
      height: r(f.zMax - f.zMin, 3),
      planes: f.planes.map((p) => ({
        id: p.id,
        facing: `${p.sign > 0 ? '+' : '-'}${AXES[p.axis]}`,
        at: r(p.offset, 3),
        areaMm2: p.area,
        ...(s.inner.includes(p.id) ? { inner: true } : {}),
        ...(s.ignore.includes(p.id) ? { ignored: true } : {}),
        ...(detail === 'full' ? { min: p.min.map((v) => r(v, 3)), max: p.max.map((v) => r(v, 3)) } : {}),
      })),
      circles: f.circles.map((c) => ({ id: c.id, kind: c.kind, center: c.center, diameter: r(2 * c.radius, 3), z: [r(c.zMin, 3), r(c.zMax, 3)], ...(s.ignore.includes(c.id) ? { ignored: true } : {}) })),
    }
  },
}

export const tag: Command<{ ids: string[]; as: 'inner' | 'contour' | 'ignore' | 'use' }> = {
  name: 'tag',
  title: 'Tag features',
  description:
    'Correct how a feature is read: inner — a flat wall bounding a pocket or slot, which the slicer offsets as a hole; contour — back to an outer wall; ignore — leave it out of the fit (a face meant to be loose, a surface the print was trimmed on, a feature you know warped); use — take it back. Kept with the project; takes effect at the next fit.measure.',
  input: obj({ ids: featureList, as: enumOf(['inner', 'contour', 'ignore', 'use'], 'What to tag them.') }, ['ids', 'as']),
  history: false,
  run: async ({ ids, as }) => {
    const st = useFit.getState()
    const ref = reference(st.settings.up)
    const known = new Set([...ref.features.planes.map((p) => p.id), ...ref.features.circles.map((c) => c.id)])
    const unknown = ids.filter((id) => !known.has(id))
    if (unknown.length) throw new CommandError('not_found', `No feature ${unknown.join(', ')} — see fit.features.`)
    let { inner, ignore } = st.settings
    if (as === 'inner' || as === 'contour') {
      const bad = ids.filter((id) => !ref.features.planes.some((p) => p.id === id && p.axis !== 2))
      if (bad.length) throw new CommandError('invalid_input', `Only upright flat walls are inner or contour: ${bad.join(', ')}.`)
      inner = as === 'inner' ? [...new Set([...inner, ...ids])] : inner.filter((x) => !ids.includes(x))
    } else ignore = as === 'ignore' ? [...new Set([...ignore, ...ids])] : ignore.filter((x) => !ids.includes(x))
    st.setSettings({ inner, ignore })
    return { inner, ignore }
  },
}

export const measureCommand: Command<{ detail?: 'brief' | 'full' }> = {
  name: 'measure',
  title: 'Measure the print’s fit',
  description:
    'Read the aligned scan against every feature of the reference and fit what the print did: scale on X, Y and Z (measured over nominal: 0.995 is 0.5 % small), the contour offset (mm the outer walls stand out: + is too big), the hole offset (mm the material stands into holes: + is holes too small) and the elephant foot (mm the first layer stands out past the wall above it). Each with its standard error; determined: false where this part cannot separate it (one hole size and no hole centres far apart, say). fit is χ² per degree of freedom — near 1 or under when the model explains the part; well over (4+) means warping, a lifted corner or a poor alignment, and the offsets should not be trusted: see outliers. noise is the scan’s scatter on flat faces. scanNoise is the scan noise to plan with where Scanner noise has one (the larger of the scanner’s usual and this scan’s); nearNoise lists offsets worth changing by their errors but under three times that noise (or the scatter, the larger), and noiseNotes says what to make of them and of a poor fit on a scan that scatters well above its scanner. Kept as a run of the project; fit.suggest turns it into slicer settings. A good fit also becomes the printer’s one calibration, the one Fits sizes holes and shafts with (calibration in the answer; calibrationKept says why not). Needs deviation.open_reference and deviation.align first. Not undoable.',
  input: obj({ detail: enumOf(['brief', 'full'], 'full adds every feature’s reading.') }),
  history: false,
  timeoutMs: 5 * 60_000,
  run: async ({ detail = 'brief' }, ctx) => {
    const st = useFit.getState()
    const s = st.settings
    ctx.progress('Reading the reference’s features')
    const ref = reference(s.up)
    const scan = alignedScan(ref.frame)
    const features = { ...ref.features, planes: ref.features.planes.filter((p) => !s.ignore.includes(p.id)), circles: ref.features.circles.filter((c) => !s.ignore.includes(c.id)) }
    if (features.planes.length + features.circles.length === 0) throw new CommandError('failed', 'The reference has no flat face square to an axis and no upright hole or boss to read the fit on (or all are ignored).')
    ctx.progress(`Reading ${features.planes.length} faces and ${features.circles.length} holes and bosses on the scan`)
    const readings = measure(features, scan.positions, { band: s.band, footBand: s.firstLayer, footAbove: 2.5 }, scan.normals)
    const solution = solve(readings, new Set(s.inner))
    const run = useFit.getState().addRun({ at: new Date().toISOString(), reference: ref.name, settings: s, readings, solution })
    const cs = corrections(solution)
    const plan = readScanNoise()
    const judged = judgeNoise(cs, readings.noise, plan)
    const notes = noiseNotes(judged, solution.fit > POOR_FIT, mmText)
    const calibration = await shareCalibration(solution)
    return {
      run: run.n,
      reference: ref.name,
      ...sizeWarning(),
      ...(s.printer || s.material ? { printedOn: { printer: s.printer, material: s.material, nozzle: s.nozzle } } : {}),
      read: { faces: readings.planes.length, circles: readings.circles.length, ...(readings.missed.length ? { missed: readings.missed } : {}) },
      noise: readings.noise,
      ...(plan ? { scanNoise: scanNoiseAnswer(plan, mmText) } : {}),
      ...describeSolution(solution),
      worthChanging: cs.filter((c) => c.change).map((c) => c.quantity),
      ...calibration,
      ...(judged?.nearNoise.length ? { nearNoise: judged.nearNoise } : {}),
      ...(notes.length ? { noiseNotes: notes } : {}),
      ...(solution.fit > POOR_FIT ? { warning: `The fit is poor (χ²/dof ${solution.fit}): the part did something a scale and offsets do not describe — warping, a lifted corner, or a poor alignment. Look at the outliers and the deviation map before changing settings.` } : {}),
      ...(detail === 'full'
        ? {
            planes: readings.planes.map((p) => ({ id: p.id, nominal: p.nominal, offset: p.offset, se: p.se, points: p.points, ...(p.foot ? { foot: p.foot } : {}) })),
            circles: readings.circles.map((c) => ({ id: c.id, kind: c.kind, nominalDiameter: r(2 * c.nominal.radius, 3), diameter: r(2 * c.radius, 4), se: r(2 * c.seRadius, 4), centerShift: [r(c.center[0] - c.nominal.center[0]), r(c.center[1] - c.nominal.center[1])], points: c.points, ...(c.foot ? { footDiameter: r(2 * c.foot.radius, 4) } : {}) })),
          }
        : {}),
    }
  },
}

export const suggest: Command<{ slicer?: string; run?: number }> = {
  name: 'suggest',
  title: 'What to change in the slicer',
  description:
    'Turn the last run (or run n) into slicer settings: for each of scale XY, scale Z, contour offset, hole offset and elephant foot, whether it is worth changing (more than 3 standard errors and more than 0.02 mm or 0.1 %) and why, then for the slicer’s key map (fit.settings slicer, or slicer here) each setting’s new value from the one in use (fit.settings current) — added to it, not replacing it. Refused for a run whose fit is over 4: its offsets would mislead. Settings a slicer lacks say what to do instead (scale the object; fit.compensated_mesh for holes in PrusaSlicer). Changes nothing.',
  input: obj({ slicer: str('A key map id; the setting’s by default.'), run: num('The run; the last by default.') }),
  readOnly: true,
  run: async ({ slicer, run: n }) => {
    const run = n === undefined ? lastRun() : useFit.getState().runs.find((x) => x.n === n)
    if (!run) throw new CommandError('not_found', `No run ${n}.`)
    trusted(run)
    const map = keymapOf(slicer ?? useFit.getState().settings.slicer)
    const cs = corrections(run.solution)
    const changes = slicerChanges(cs, map, run.settings.current)
    return {
      run: run.n,
      slicer: map.label,
      ...(map.checked ? { keysChecked: map.checked } : {}),
      corrections: cs,
      changes,
      ...(changes.length === 0 ? { note: 'Nothing worth changing: the print is within what this scan resolves.' } : {}),
    }
  },
}

export const exportCommand: Command<{ format?: 'ini' | 'json'; slicer?: string }> = {
  name: 'export',
  title: 'Export the slicer settings',
  description: 'The last run’s suggested settings as a file: ini — key = value lines to paste into or diff against the slicer’s exported profile; json — the corrections, the changes and the run’s readings. Changes nothing.',
  input: obj({ format: enumOf(['ini', 'json'], 'ini by default.'), slicer: str('A key map id; the setting’s by default.') }),
  readOnly: true,
  returnsFile: true,
  run: async ({ format = 'ini', slicer }) => {
    const run = trusted(lastRun())
    const map = keymapOf(slicer ?? useFit.getState().settings.slicer)
    const cs = corrections(run.solution)
    const changes = slicerChanges(cs, map, run.settings.current)
    const stem = run.reference.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '_')
    const text =
      format === 'ini'
        ? iniFragment(changes, map, `fit-comp run ${run.n} on ${run.reference}${run.settings.printer ? `, ${run.settings.printer}` : ''}${run.settings.material ? `, ${run.settings.material}` : ''}`)
        : JSON.stringify({ run: run.n, at: run.at, reference: run.reference, slicer: map.id, settings: run.settings, solution: describeSolution(run.solution), corrections: cs, changes }, null, 2)
    return { file: { name: `${stem}-fit-${map.id}.${format}`, mimeType: format === 'ini' ? 'text/plain' : 'application/json', bytes: new TextEncoder().encode(text) }, changes: changes.length }
  },
}

export const compensatedMesh: Command<{ apply?: ('scale' | 'contour' | 'hole')[]; all?: boolean }> = {
  name: 'compensated_mesh',
  title: 'Export a compensated model',
  description:
    'The reference part pre-distorted so the print comes out true, as an STL in the reference’s own frame: scaled by the inverse of the scale read, then its walls moved in by the contour offset and its holes opened by the hole offset. By default only what fit.suggest finds worth changing; apply names which to use, all uses every one read. The elephant foot is left to the slicer’s own elephant-foot setting (footMm says what to set): a model’s walls seldom have the vertices a first-layer taper needs. Print it with the slicer’s other compensations at the values the run was printed with — not on top of the suggested ones. Changes nothing.',
  input: obj({ apply: arr(enumOf(['scale', 'contour', 'hole']), 'Which corrections to build in.', { minItems: 1 }), all: bool('Every correction read, worth changing or not.') }),
  readOnly: true,
  returnsFile: true,
  run: async ({ apply, all }) => {
    const run = trusted(lastRun())
    const s = useFit.getState().settings
    const ref = reference(run.settings.up as Up)
    const cs = corrections(run.solution)
    const worth = (q: string) => all || (apply ? apply.includes(q as never) : cs.some((c) => c.quantity === (q === 'scale' ? 'scaleXY' : q) && c.change))
    const sol = run.solution
    const used = {
      sx: worth('scale') ? sol.scale.x.value : 1,
      sy: worth('scale') ? sol.scale.y.value : 1,
      sz: all || apply?.includes('scale') || (!apply && cs.some((c) => c.quantity === 'scaleZ' && c.change)) ? sol.scale.z.value : 1,
      contour: worth('contour') ? sol.contour.value : 0,
      hole: worth('hole') ? sol.hole.value : 0,
      foot: 0,
      footFade: s.firstLayer * 2,
    }
    const moved = compensate(ref.positions, ref.indices, ref.features, used)
    const back = new Float64Array(moved.length)
    for (let i = 0; i < moved.length; i += 3) fromBuild(ref.frame, moved[i], moved[i + 1], moved[i + 2], back, i)
    const stem = ref.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '_')
    return {
      file: { name: `${stem}-compensated.stl`, mimeType: 'model/stl', bytes: stlBytes(back, ref.indices) },
      applied: { scale: [r(1 / used.sx, 5), r(1 / used.sy, 5), r(1 / used.sz, 5)], contourMm: r(-used.contour), holeMm: r(used.hole) },
      ...(cs.some((c) => c.quantity === 'foot' && c.change) ? { footMm: r(sol.foot!.value), footNote: 'Set the slicer’s elephant foot compensation to footMm more than it was printed with.' } : {}),
      triangles: ref.indices.length / 3,
    }
  },
}

export const runs: Command<{ compare?: boolean }> = {
  name: 'runs',
  title: 'Runs measured in this project',
  description: 'Each run kept with the project (the last 12): when, on what, and what it read. compare: the last two side by side — whether each parameter moved toward true after the settings changed, so you know whether the correction worked or the error is something else (warping reads as offsets that do not shrink). Changes nothing.',
  input: obj({ compare: bool('The last two side by side.') }),
  readOnly: true,
  run: async ({ compare }) => {
    const list = useFit.getState().runs
    const brief = (x: FitRun) => ({ run: x.n, at: x.at, reference: x.reference, printer: x.settings.printer, material: x.settings.material, ...describeSolution(x.solution) })
    if (!compare) return { runs: list.map(brief) }
    if (list.length < 2) throw new CommandError('invalid_state', 'Two runs are needed to compare — measure the next print.')
    const [a, b] = list.slice(-2)
    const pair = (name: string, x: number, y: number, base: number) => ({ quantity: name, before: r(x, 5), after: r(y, 5), better: Math.abs(y - base) < Math.abs(x - base) })
    return {
      before: a.n,
      after: b.n,
      changes: [
        pair('scaleX', a.solution.scale.x.value, b.solution.scale.x.value, 1),
        pair('scaleY', a.solution.scale.y.value, b.solution.scale.y.value, 1),
        pair('scaleZ', a.solution.scale.z.value, b.solution.scale.z.value, 1),
        pair('contourOffset', a.solution.contour.value, b.solution.contour.value, 0),
        pair('holeOffset', a.solution.hole.value, b.solution.hole.value, 0),
        ...(a.solution.foot && b.solution.foot ? [pair('elephantFoot', a.solution.foot.value, b.solution.foot.value, 0)] : []),
      ],
    }
  },
}

export const profiles: Command<{ action: 'list' | 'save' | 'remove' | 'use'; name?: string; slicer?: string }> = {
  name: 'profiles',
  title: 'Saved correction profiles',
  description: 'Correction sets kept by name with the project, per printer, material and nozzle. save: the last run’s suggested settings for the slicer, added to the ones in use, under name. use: make a profile’s values the ones in use (fit.settings current) and its printer, material and nozzle the setting’s — before measuring a print made with it. remove: by name. list: all.',
  input: obj({ action: enumOf(['list', 'save', 'remove', 'use'], 'What to do.'), name: str('The profile’s name.'), slicer: str('For save: a key map id; the setting’s by default.') }, ['action']),
  history: false,
  run: async ({ action, name, slicer }) => {
    const st = useFit.getState()
    if (action === 'list') return { profiles: st.profiles }
    if (!name) throw new CommandError('invalid_input', `${action} needs a name.`)
    if (action === 'remove') {
      if (!st.removeProfile(name)) throw new CommandError('not_found', `No profile "${name}".`)
      return { profiles: useFit.getState().profiles }
    }
    if (action === 'use') {
      const p = st.profiles.find((x) => x.name === name)
      if (!p) throw new CommandError('not_found', `No profile "${name}".`)
      st.setSettings({ current: { ...p.values }, slicer: p.slicer, printer: p.printer, material: p.material, nozzle: p.nozzle })
      return { settings: useFit.getState().settings }
    }
    const run = trusted(lastRun())
    const map = keymapOf(slicer ?? st.settings.slicer)
    const changes = slicerChanges(corrections(run.solution), map, run.settings.current)
    const values: Record<string, number> = { ...run.settings.current }
    for (const c of changes) if (c.key && c.to !== null) values[c.key] = c.to
    st.saveProfile({ name, slicer: map.id, printer: run.settings.printer, material: run.settings.material, nozzle: run.settings.nozzle, values, from: run.n, at: new Date().toISOString() })
    return { saved: useFit.getState().profiles.find((p) => p.name === name) }
  },
}

export const keymapsCommand: Command<{ action: 'list' | 'add' | 'remove'; keymap?: Json; id?: string }> = {
  name: 'keymaps',
  title: 'Slicer key maps',
  description:
    'Which slicer setting each correction moves. Built in: orcaslicer, bambustudio, prusaslicer. add a map of your own (kept with the project) for another slicer or a renamed key: { id, label, keys: { contour|hole|foot|scaleXY|scaleZ: { key, kind: add (sign ±1: contour -1, hole +1, foot +1) | percentMeasured (filament shrink as measured %) | percentShrink (shrinkage %) | objectScale | unsupported, note? } } }. remove: one of your own by id.',
  input: obj({ action: enumOf(['list', 'add', 'remove'], 'What to do.'), keymap: anyObject('For add: the map.'), id: str('For remove.') }, ['action']),
  history: false,
  run: async ({ action, keymap, id }) => {
    const st = useFit.getState()
    if (action === 'list') return { keymaps: keymaps().map((k) => ({ ...k, own: st.keymaps.some((m) => m.id === k.id) })) }
    if (action === 'remove') {
      if (!id || !st.removeKeymap(id)) throw new CommandError('not_found', `No key map of your own "${id}".`)
      return { keymaps: keymaps().map((k) => k.id) }
    }
    const k = keymap as unknown as Keymap
    if (!k || typeof k.id !== 'string' || !k.id || typeof k.label !== 'string' || typeof k.keys !== 'object') throw new CommandError('invalid_input', 'A key map needs id, label and keys.')
    for (const [q, spec] of Object.entries(k.keys)) {
      if (!['contour', 'hole', 'foot', 'scaleXY', 'scaleZ'].includes(q)) throw new CommandError('invalid_input', `Unknown quantity "${q}".`)
      if (!spec || !['add', 'percentMeasured', 'percentShrink', 'objectScale', 'unsupported'].includes(spec.kind)) throw new CommandError('invalid_input', `keys.${q}.kind must be add, percentMeasured, percentShrink, objectScale or unsupported.`)
      if (spec.kind === 'add' && spec.sign !== 1 && spec.sign !== -1) throw new CommandError('invalid_input', `keys.${q}.sign must be 1 or -1.`)
    }
    st.addKeymap(k)
    return { added: k.id, keymaps: keymaps().map((m) => m.id) }
  },
}

/** What reads the scan against the reference part needs the page; the
 *  settings, the runs measured and what they suggest run without it
 *  (Command.headless). A print's sizes, measured by hand, calibrate the
 *  printer headless through the Fits design page's fit.calibrate. */
const BY_HAND = 'fit.calibrate { readings: [{ kind, model, measured }] } calibrates the printer from sizes measured on a print by hand, with no scan.'
const PAGE_ONLY: Record<string, string | null> = { features: BY_HAND, tag: BY_HAND, measure: BY_HAND, compensated_mesh: null }

export const fitCommands = ([settings, features, tag, measureCommand, suggest, exportCommand, compensatedMesh, runs, profiles, keymapsCommand] as Command<never>[]).map((c) => {
  if (!(c.name in PAGE_ONLY)) return { ...c, headless: true }
  const instead = PAGE_ONLY[c.name]
  return instead ? { ...c, headlessInstead: instead } : c
})
