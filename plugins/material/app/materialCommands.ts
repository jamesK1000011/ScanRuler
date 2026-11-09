// SPDX-License-Identifier: AGPL-3.0-only
// The material commands (material.*): the library listed and read, and a
// material put on a Reverse Engineer body or taken off it. Who chooses is
// not the app's business — the person and the agent settle it between
// them; these record it, and Mass and Strength use it. Every one runs
// headless.

import { arr, enumOf, int, obj, oneOf, str } from '../../../src/commands/schema'
import { readStateSection } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { CATEGORIES, ensureMaterials, library, LIBRARY_ALIASES, libraryMaterial, libraryNote, materialsFor, searchLibrary, type Material } from '../../_shared/materials'
import { PRINTED } from '../../_shared/materials/printed'
import { assignedReady, resolveAssignment, useAssigned, type Assignment, type CustomMaterial, type ResolvedMaterial } from '../../_shared/materials/assigned'
import { bodyKeyOf, setupFor } from '../../_shared/setups'

interface ReverseBody {
  id: number
  name: string
  surface?: boolean
}
type Ref = string | number

const reverseBodies = (): ReverseBody[] => ((readStateSection('reverse') ?? {}) as { bodies?: ReverseBody[] }).bodies ?? []

function bodyOf(ref: Ref): ReverseBody {
  const all = reverseBodies()
  if (!all.length) throw new CommandError('invalid_state', 'There is no body: build one in Reverse Engineer (or import a STEP there) first.')
  const b = typeof ref === 'number' ? all.find((x) => x.id === ref) : all.find((x) => x.name.toLowerCase() === String(ref).trim().toLowerCase())
  if (!b) throw new CommandError('invalid_input', `There is no body ${typeof ref === 'number' ? `with id ${ref}` : `"${ref}"`} (bodies: ${all.map((x) => x.name).join(', ')}).`)
  if (b.surface) throw new CommandError('invalid_input', `${b.name} is a surface: a material is a solid's.`)
  return b
}
const bodiesOf = (refs: Ref | Ref[]): ReverseBody[] => [...new Map((Array.isArray(refs) ? refs : [refs]).map(bodyOf).map((b) => [b.id, b])).values()]

const r3 = (x: number | undefined) => (x === undefined ? undefined : Math.round(x * 1000) / 1000)

/** A material in brief, as a list carries it. */
const brief = (m: Material | ResolvedMaterial) => ({
  id: m.id,
  name: m.name,
  category: m.category,
  ...(m.family ? { family: m.family } : {}),
  ...(m.density !== undefined ? { density: r3(m.density) } : {}),
  ...(m.youngsMPa !== undefined ? { youngsMPa: m.youngsMPa } : {}),
  ...(m.yieldMPa !== undefined ? { yieldMPa: m.yieldMPa } : {}),
  ...('machining' in m && m.machining ? { machining: true } : {}),
  ...(PRINTED[m.id] ? { printable: true } : {}),
})

/** A body's material as the answers give it, with how it is made. */
function bodyMaterial(b: ReverseBody) {
  const key = bodyKeyOf(b)
  const a = useAssigned.getState().assigned[key]
  const m = resolveAssignment(a)
  const setup = setupFor(key)
  return {
    body: b.name,
    id: b.id,
    material: m ? brief(m) : a !== undefined ? { id: typeof a === 'string' ? a : 'custom', unknown: true } : null,
    setup: setup ? { id: setup.id, type: setup.type, name: setup.name } : null,
    as: setup?.type === 'print' ? 'printed' : 'solid',
  }
}

/** The session readout's part: each body with a material, and how many have
 *  none. */
export function describeMaterials() {
  const bodies = reverseBodies().filter((b) => !b.surface)
  const assigned = useAssigned.getState().assigned
  const set = bodies.filter((b) => assigned[bodyKeyOf(b)] !== undefined)
  return {
    bodies: set.map((b) => {
      const m = resolveAssignment(assigned[bodyKeyOf(b)])
      return { body: b.name, id: b.id, material: m ? m.id : 'unknown', name: m?.name ?? String(assigned[bodyKeyOf(b)]) }
    }),
    ...(bodies.length > set.length ? { unassigned: bodies.length - set.length } : {}),
    // A FreeCAD card reads as unknown until the cards are loaded: say so.
    ...(set.some((b) => !resolveAssignment(assigned[bodyKeyOf(b)])) && libraryNote() ? { library: libraryNote() } : {}),
  }
}

const bodyRef = oneOf([int('The body’s id.'), str('Its name.', { minLength: 1 })], 'A Reverse Engineer body, by id or name.')
const bodiesRef = oneOf([int('The body’s id.'), str('Its name.', { minLength: 1 }), arr(oneOf([int(), str(undefined, { minLength: 1 })]), 'Several bodies.', { minItems: 1 })], 'A body or several, by id or name.')

const list: Command<{ category?: string; q?: string; limit?: number; offset?: number }> = {
  name: 'list',
  title: 'The material library',
  description:
    'The materials a body can be set to, briefly: id, name, category, family, density (g/cm³), youngsMPa, yieldMPa; machining: true where cutting data is held; printable: true where printing figures are (a print setup uses them). FreeCAD’s material cards and the app’s own (printing filaments, sheet plastics, brass). Filter by category and by words (q: "stainless", "6061", "acrylic"). total says how many match; page with offset. Changes nothing.',
  input: obj({
    category: enumOf(CATEGORIES),
    q: str('Words each to be found in the id, name, family, standard or a common name.'),
    limit: int('How many, 40 by default.', { minimum: 1, maximum: 200 }),
    offset: int('Skip this many.', { minimum: 0 }),
  }),
  readOnly: true,
  run: async ({ category, q, limit = 40, offset = 0 }) => {
    // Without FreeCAD's cards the app's own are still listed, and the
    // answer says what is missing.
    const loaded = await ensureMaterials().then(
      () => true,
      () => false,
    )
    const found = searchLibrary({ category, q })
    const counts: Record<string, number> = {}
    if (!category && !q) for (const m of library()) counts[m.category] = (counts[m.category] ?? 0) + 1
    return {
      ...(loaded ? {} : { note: libraryNote() }),
      total: found.length,
      ...(offset ? { offset } : {}),
      materials: found.slice(offset, offset + limit).map(brief),
      ...(Object.keys(counts).length ? { categories: counts } : {}),
    }
  },
}

const get: Command<{ material?: string; body?: Ref }> = {
  name: 'get',
  title: 'A material, or a body’s',
  description:
    'material: one library material whole — density, stiffness, strengths, thermal and machining figures, its other names, the printing figures where it has them, and where the data comes from (FreeCAD card, author and licence, or the app’s own with its basis). body: the material set on that body (null when none), its setup (how it is made: print, cut, mill, pcb) and whether it counts as printed or solid. Neither: every body with its material. Changes nothing.',
  input: obj({ material: str('A library id or common name.', { minLength: 1 }), body: bodyRef }),
  readOnly: true,
  run: async ({ material, body }) => {
    if (material !== undefined && body !== undefined) throw new CommandError('invalid_input', 'Give a material or a body, not both.')
    if (material !== undefined) {
      await materialsFor([material])
      const m = libraryMaterial(material)
      if (!m) throw new CommandError('invalid_input', `No material "${material}" in the library: material.list { q } finds one.`)
      const aliases = Object.entries(LIBRARY_ALIASES)
        .filter(([, id]) => id === m.id)
        .map(([a]) => a)
      return { material: { ...m, ...(aliases.length ? { aliases } : {}), ...(PRINTED[m.id] ? { printed: PRINTED[m.id] } : {}) } }
    }
    await assignedReady()
    if (body !== undefined) {
      const b = bodyOf(body)
      const m = resolveAssignment(useAssigned.getState().assigned[bodyKeyOf(b)])
      return { ...bodyMaterial(b), ...(m ? { material: m } : {}) }
    }
    return { bodies: reverseBodies().filter((b) => !b.surface).map(bodyMaterial) }
  },
}

const NUMBERS: Record<keyof Omit<CustomMaterial, 'name' | 'base'>, [number, number]> = {
  density: [0.01, 25],
  youngsMPa: [0.1, 1.2e6],
  poisson: [-0.99, 0.5],
  yieldMPa: [0.01, 1e4],
  ultimateMPa: [0.01, 1e4],
}

function customOf(x: Record<string, unknown>): CustomMaterial {
  const name = typeof x.name === 'string' ? x.name.trim() : ''
  if (!name) throw new CommandError('invalid_input', 'A material of your own needs a name.')
  const known = new Set(['name', 'base', ...Object.keys(NUMBERS)])
  const extra = Object.keys(x).filter((k) => !known.has(k))
  if (extra.length) throw new CommandError('invalid_input', `${extra.join(', ')}: not a material figure — name, base, ${Object.keys(NUMBERS).join(', ')}.`)
  const out: CustomMaterial = { name: name.slice(0, 80) }
  if (x.base !== undefined) {
    const base = libraryMaterial(x.base)
    if (!base) throw new CommandError('invalid_input', `No material "${String(x.base)}" to start from: material.list { q } finds one.`)
    out.base = base.id
  }
  for (const [k, [lo, hi]] of Object.entries(NUMBERS) as [keyof typeof NUMBERS, [number, number]][]) {
    const v = x[k]
    if (v === undefined) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new CommandError('invalid_input', `${k} must be a number from ${lo} to ${hi}.`)
    out[k] = v
  }
  if (!out.base && out.density === undefined) throw new CommandError('invalid_input', 'A material of your own needs a density (g/cm³), or a base material to start from.')
  return out
}

const set: Command<{ body: Ref | Ref[]; material: string | Record<string, unknown> }> = {
  name: 'set',
  title: 'Set a body’s material',
  description:
    'Put a material on one body or several: a library id or common name (material.list), or one of your own — { name, base?, density, youngsMPa, poisson, yieldMPa, ultimateMPa } (g/cm³, MPa), over a library material when base is given. Mass weighs the body in it and Strength solves in it: solid, unless the body is in a print setup, where the printing figures, walls and infill apply. Saved with the project; one undo step. Returns each body with its material.',
  input: obj({ body: bodiesRef, material: oneOf([str('A library id or common name.', { minLength: 1 }), { type: 'object', description: 'One of your own: { name, base?, density, youngsMPa, poisson, yieldMPa, ultimateMPa }.' }]) }, ['body', 'material']),
  run: async ({ body, material }) => {
    const picked = bodiesOf(body)
    await assignedReady([typeof material === 'string' ? material : material && typeof material === 'object' && !Array.isArray(material) ? material.base : undefined])
    let a: Assignment
    if (typeof material === 'string') {
      const m = libraryMaterial(material)
      if (!m) throw new CommandError('invalid_input', `No material "${material}" in the library: material.list { q } finds one, or give one of your own ({ name, density, … }).`)
      a = m.id
    } else if (material && typeof material === 'object' && !Array.isArray(material)) a = { custom: customOf(material) }
    else throw new CommandError('invalid_input', 'material is a library id, or { name, density, … } for one of your own.')
    useAssigned.getState().assign(Object.fromEntries(picked.map((b) => [bodyKeyOf(b), a])))
    const notes = picked.flatMap((b) => {
      const m = resolveAssignment(a)
      const missing = [m?.density === undefined ? 'density' : '', m?.youngsMPa === undefined ? 'stiffness' : ''].filter(Boolean)
      return missing.length ? [`${b.name}: ${m?.name} has no ${missing.join(' or ')} in the library — Mass or Strength will ask for it.`] : []
    })
    return { bodies: picked.map(bodyMaterial), ...(notes.length ? { note: [...new Set(notes)].join(' ') } : {}) }
  },
}

const clear: Command<{ body?: Ref | Ref[]; all?: boolean }> = {
  name: 'clear',
  title: 'Take a body’s material off',
  description: 'Take the material off one body or several (body), or off every body (all: true). A body with none is weighed and solved as before materials were per part, and the answer says what was assumed. One undo step.',
  input: obj({ body: bodiesRef, all: { type: 'boolean' } }),
  run: async ({ body, all }) => {
    if ((body === undefined) === !all) throw new CommandError('invalid_input', 'Give the bodies, or all: true.')
    if (all) {
      const n = Object.keys(useAssigned.getState().assigned).length
      useAssigned.getState().reset()
      return { cleared: n }
    }
    const picked = bodiesOf(body!)
    useAssigned.getState().assign(Object.fromEntries(picked.map((b) => [bodyKeyOf(b), null])))
    return { bodies: picked.map(bodyMaterial) }
  },
}

export const materialCommands = ([list, get, set, clear] as Command<never>[]).map((c) => ({ ...c, headless: true }))
