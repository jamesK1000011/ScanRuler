// SPDX-License-Identifier: AGPL-3.0-only
// import.*: model formats the app's own readers don't take, opened as the
// scan or the reference part. The file is read and flattened here
// (core/convert.ts), then handed to scan.open or deviation.open_reference
// as STL — the app's own path from there on.

import { deviationCommands } from '../../../src/commands/core/deviation'
import { scanCommands } from '../../../src/commands/core/scan'
import { arr, bool, bytes, enumOf, obj, str } from '../../../src/commands/schema'
import { type Command, CommandError } from '../../../src/plugins/api'
import { flatten, formatOf, FORMATS, loadScene, toStl, type Up, type Units } from '../core/convert'
import { useImportPlus } from '../state/importStore'

type Json = Record<string, unknown>

const UNITS: Units[] = ['mm', 'cm', 'm', 'in']

/** The app's own open commands, run inside this one's step: a change that
 *  asked the command queue for another change would wait on itself. */
const scanOpen = scanCommands.find((c) => c.name === 'open') as Command<Record<string, unknown>>
const referenceOpen = deviationCommands.find((c) => c.name === 'open_reference') as Command<Record<string, unknown>>

const common = {
  bytes: bytes('The file’s contents.'),
  name: str(`The file’s name with its extension: ${FORMATS.flatMap((f) => f.extensions).map((e) => `.${e}`).join(', ')}.`, { minLength: 1 }),
  units: enumOf(UNITS, 'The file’s units, overriding the format’s (see import.formats). Read the answer’s size: a part 0.03 mm or 30 m across has its units wrong.'),
  up: enumOf(['y', 'z'], 'Which axis is up in the file, overriding the format’s: y turns it Z up.'),
}

async function read(data: Uint8Array, name: string, units?: Units, up?: Up, parts?: string[]) {
  const f = formatOf(name)
  if (!f) throw new CommandError('invalid_input', `${name}: import-plus reads ${FORMATS.flatMap((x) => x.extensions).map((e) => `.${e}`).join(', ')}. STL, PLY, OBJ, 3MF and STEP open with scan.open; a .blend is converted first with blender_convert.`)
  let scene
  try {
    scene = await loadScene(data, name)
  } catch (e) {
    throw new CommandError('failed', `${name} could not be read as ${f.label}: ${e instanceof Error ? e.message : String(e)}`)
  }
  try {
    return { info: f, flat: flatten(scene, f.id, { units, up, parts }) }
  } catch (e) {
    throw new CommandError('failed', `${name}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

const describe = (name: string, flat: ReturnType<typeof flatten>, info: { label: string; basis: string }) => ({
  file: name,
  format: info.label,
  units: flat.units,
  ...(flat.unitsAssumed ? { unitsFrom: info.basis } : {}),
  up: flat.up === 'y' ? 'Y up in the file, turned to Z up' : 'Z up',
  triangles: flat.positions.length / 9,
  parts: flat.parts,
  sizeMm: [0, 1, 2].map((a) => Math.round((flat.max[a] - flat.min[a]) * 1000) / 1000),
  min: flat.min,
  max: flat.max,
  ...(flat.unitsWarning ? { unitsWarning: flat.unitsWarning } : {}),
})

export const formats: Command<Record<string, never>> = {
  name: 'formats',
  title: 'Formats import-plus reads',
  description: 'The model formats import.open reads beyond the app’s own (STL, PLY, OBJ, 3MF, STEP): each with its extensions and the units and up axis taken when the file does not say, and why. A .blend is converted to GLB first with the blender_convert tool, on this computer’s Blender. Changes nothing.',
  input: obj({}),
  readOnly: true,
  run: async () => ({ formats: FORMATS.map((f) => ({ format: f.id, extensions: f.extensions, label: f.label, units: f.units, up: f.up === 'y' ? 'Y up' : 'Z up', basis: f.basis })), own: ['stl', 'ply', 'obj', '3mf', 'step', 'stp'], blend: 'blender_convert, then import.open on the .glb it writes' }),
}

export const inspect: Command<{ bytes: Uint8Array; name: string; units?: Units; up?: Up }> = {
  name: 'inspect',
  title: 'Look inside a model file',
  description: 'Read a model file without opening it: its format, the units and up axis taken, its parts (mesh nodes) with their triangle counts, and its size in mm — to choose units, up or parts before import.open. Changes nothing.',
  input: obj(common, ['bytes', 'name']),
  readOnly: true,
  run: async ({ bytes: data, name, units, up }) => {
    const { info, flat } = await read(data, name, units, up)
    return describe(name, flat, info)
  },
}

export const open: Command<{ bytes: Uint8Array; name: string; as?: 'scan' | 'reference'; units?: Units; up?: Up; parts?: string[]; discard?: boolean }> = {
  name: 'open',
  title: 'Open a GLB, glTF, FBX, 3DS, Collada, AMF or VRML model',
  description:
    'Open a model in a format the app does not read itself — as the scan (as: scan, the default, through scan.open) or as the reference part to compare with (as: reference, through deviation.open_reference). Every mesh node is flattened into one mesh, its transforms applied, in mm and Z up; parts keeps only the named nodes (import.inspect lists them). Check sizeMm: a unitsWarning means the units taken are likely wrong — open again with units. discard as for scan.open. Returns what was read (read) beside the app’s own answer (scan, or deviation for a reference). Not undoable: a new scan starts a new history.',
  input: obj({ ...common, as: enumOf(['scan', 'reference'], 'scan (the default) or reference.'), parts: arr(str(), 'Only these parts (mesh nodes), by name.', { minItems: 1 }), discard: bool('As for scan.open: replace a session that holds measurements.') }, ['bytes', 'name']),
  history: false,
  discards: ({ as, discard }) => as !== 'reference' && discard === true,
  timeoutMs: 5 * 60_000,
  run: async ({ bytes: data, name, as = 'scan', units, up, parts, discard }, ctx) => {
    ctx.progress(`Reading ${name}`)
    const { info, flat } = await read(data, name, units, up, parts)
    const stl = toStl(flat.positions, `import-plus: ${name}`.slice(0, 80))
    const stem = name.replace(/\.[^.]+$/, '')
    const target = `${stem}.stl`
    ctx.progress(`Opening ${flat.positions.length / 9} triangles as the ${as}`)
    let answer: unknown
    if (as === 'scan') answer = await scanOpen.run({ bytes: stl, name: target, units: 'mm', ...(discard ? { discard } : {}) }, ctx)
    else answer = await referenceOpen.run({ bytes: stl, name: target, units: 'mm' }, ctx)
    useImportPlus.getState().remember({ name, as, format: info.id, units: flat.units, up: flat.up, triangles: flat.positions.length / 9, parts: flat.parts.map((p) => p.name) })
    return { read: describe(name, flat, info), openedAs: as, openedName: target, ...(answer as Json) }
  },
}

export const importCommands = [formats, inspect, open] as Command<never>[]
