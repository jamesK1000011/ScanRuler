// SPDX-License-Identifier: AGPL-3.0-only
// setup.*: how each part is made, as setups — one per process the build
// uses, each with the bodies made by it and its type's settings (a print
// setup's printer, nozzle, layers, walls, the printer's fit calibration).
// Each change is one undo step. Who decides is not here: the person and
// the agent choose in conversation; a setup records what they chose, and
// the workspaces read it for a body in it.

import { arr, anyObject, bool, num, obj, oneOf, str } from '../../../src/commands/schema'
import { readStateSection } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { bodyKeyOf, bodyNameOf, setupsFor, setupTypeOf, setupTypes, settingsOf, type BodyKey, type Setup, type SetupType } from '../../_shared/setups'
import { clashes, nameFor, nextId, settingsOver } from '../core/setups'
import { useSetups } from '../state/setupsStore'

type Json = Record<string, unknown>

const st = () => useSetups.getState()
const invalid = (m: string): never => {
  throw new CommandError('invalid_input', m)
}
const same = (a: string, b: string) => a === b || a.toLowerCase() === b.toLowerCase()

/** A setup in brief, as the answers carry it: its bodies by name. */
export const brief = (s: Setup) => ({ id: s.id, type: s.type, name: s.name, bodies: s.bodies.map(bodyNameOf), settings: settingsOf(s), ...(setupTypeOf(s.type) ? {} : { note: 'its type is not in this build: kept as it is' }) })

function setupNamed(ref: string): Setup {
  const s = st().setups.find((x) => x.id === ref || same(x.name, ref))
  if (!s) throw new CommandError('not_found', `No setup "${ref}" — there are ${st().setups.map((x) => `${x.id} ${x.name}`).join(', ') || 'none'}.`)
  return s
}

function typeNamed(id: string): SetupType {
  const t = setupTypeOf(id)
  if (!t) throw new CommandError('not_found', `No setup type "${id}" in this build — there are ${setupTypes().map((x) => x.id).join(', ') || 'none'}.`)
  return t
}

interface Body {
  id: number
  name: string
  surface?: boolean
}

/** The bodies named, by name or Reverse Engineer id, as their keys (the
 *  id, which a rename leaves) — checked against Reverse Engineer's bodies
 *  when it is in the build; without it, by name as given. */
function bodiesNamed(refs: readonly (string | number)[]): BodyKey[] {
  const all = (readStateSection('reverse') as { bodies?: Body[] } | undefined)?.bodies
  const out: BodyKey[] = []
  for (const ref of refs) {
    let key = String(ref)
    if (all) {
      const b = all.find((x) => x.id === ref || x.name === ref) ?? all.find((x) => same(x.name, String(ref)))
      if (!b) invalid(`No body "${ref}" — there are ${all.filter((x) => !x.surface).map((x) => x.name).join(', ') || 'none'}.`)
      if (b!.surface) invalid(`${b!.name} is a surface, not a part.`)
      key = bodyKeyOf(b!)
    } else if (typeof ref === 'number') invalid(`A body by id needs Reverse Engineer, which this build has not: name it.`)
    if (!out.includes(key)) out.push(key)
  }
  return out
}

/** A setup's bodies as keys: a name kept from an older project becomes
 *  its body's id once that body is there to say it. */
const keyed = (bodies: readonly string[]): BodyKey[] => [...new Set(bodies.map((b) => bodyKeyOf(b)))]

function nameOk(name: string | undefined): void {
  if (name !== undefined && (!name.trim() || name.trim().length > 60)) invalid('name: 1 to 60 characters.')
}

function noClash(type: string, bodies: string[], except?: string): void {
  const c = clashes(st().setups.map((s) => ({ ...s, bodies: keyed(s.bodies) })), type, bodies, except)
  if (c.length) invalid(`${c.map((x) => `${bodyNameOf(x.body)} is in ${x.setup.name} (${x.setup.id})`).join('; ')} — a body is in one ${type} setup at most: take it out there (setup.set { id, bodies }) first.`)
}

function put(setups: Setup[], selected?: string | null): void {
  st().replace(setups, selected)
}

const bodyRef = oneOf([str(undefined, { minLength: 1 }), num()])

const list: Command<Record<string, never>> = {
  name: 'list',
  title: 'The setups',
  description: 'The setups — how each part of the build is made: id, type, name, the bodies made by it and its settings — the one the Make tab shows (selected), and the types this build has: each with its settings, the Make tab’s pages for it, what part.review checks on a body in it and what it puts out. Changes nothing.',
  input: obj({}),
  readOnly: true,
  headless: true,
  run: async () => ({
    setups: st().setups.map(brief),
    selected: st().selected,
    types: setupTypes().map((t) => ({ id: t.id, label: t.label, title: t.title, settings: Object.fromEntries(Object.entries(t.settings).map(([k, v]) => [k, v.schema.description ?? ''])), pages: t.pages, checks: (t.checks ?? []).map((c) => c.command), outputs: t.outputs ?? [] })),
  }),
}

interface AddIn {
  type: string
  name?: string
  bodies?: (string | number)[]
  settings?: Json
}

const add: Command<AddIn> = {
  name: 'add',
  title: 'Add a setup',
  description: 'A setup: how some of the parts are made. type: a type setup.list names (print: FDM printed). bodies: the bodies made by it, by name or id (none yet by default); a body is in one setup of a type at most. name: the type’s label by default. settings: the type’s, each optional — unset, every workspace goes by its own. Made the one the Make tab shows. One undo step.',
  input: obj(
    {
      type: str('The kind of setup: print, or another setup.list names.', { minLength: 1 }),
      name: str('Its name; the type’s label by default.', { minLength: 1 }),
      bodies: arr(bodyRef, 'The bodies made by it.'),
      settings: anyObject('The type’s settings (setup.list); each optional.'),
    },
    ['type'],
  ),
  headless: true,
  label: ({ type }) => `add a ${type} setup`,
  run: async ({ type: tid, name, bodies = [], settings = {} }) => {
    const type = typeNamed(tid)
    nameOk(name)
    const names = bodiesNamed(bodies)
    noClash(type.id, names)
    if (name && st().setups.some((s) => same(s.name, name.trim()))) invalid(`There is a setup named ${name} already.`)
    const set = settingsOver(type, {}, settings)
    if (typeof set === 'string') invalid(`settings: ${set}.`)
    const s: Setup = { id: nextId(st().setups), type: type.id, name: name?.trim() || nameFor(type.label, st().setups), bodies: names, ...(set as Json) }
    put([...st().setups, s], s.id)
    return { added: brief(s), setups: st().setups.length }
  },
}

interface SetIn {
  id: string
  name?: string
  bodies?: (string | number)[]
  add?: (string | number)[]
  remove?: (string | number)[]
  settings?: Json
  select?: boolean
}

const set: Command<SetIn> = {
  name: 'set',
  title: 'Change a setup',
  description: 'Change a setup (id: its id or name): name; bodies — the whole list; or add and remove, bodies by name or id; settings — merged over its own, null drops one (the workspaces then go by their own). select: true shows it on the Make tab. One undo step.',
  input: obj(
    {
      id: str('The setup, by id (S1) or name.', { minLength: 1 }),
      name: str('Its new name.', { minLength: 1 }),
      bodies: arr(bodyRef, 'The bodies made by it: the whole list.'),
      add: arr(bodyRef, 'Bodies to add.'),
      remove: arr(bodyRef, 'Bodies to take out.'),
      settings: anyObject('Its type’s settings to change (setup.list); null drops one.'),
      select: bool('Show it on the Make tab.'),
    },
    ['id'],
  ),
  headless: true,
  label: ({ id }) => `change setup ${id}`,
  run: async ({ id, name, bodies, add: more, remove: fewer, settings, select }) => {
    const s = setupNamed(id)
    nameOk(name)
    if (bodies !== undefined && (more !== undefined || fewer !== undefined)) invalid('Give bodies (the whole list), or add and remove — not both.')
    if (name !== undefined && st().setups.some((x) => x.id !== s.id && same(x.name, name.trim()))) invalid(`There is a setup named ${name} already.`)
    let names = keyed(s.bodies)
    if (bodies !== undefined) names = bodiesNamed(bodies)
    if (more?.length) names = [...names, ...bodiesNamed(more).filter((b) => !names.includes(b))]
    if (fewer?.length) {
      // Taken out by name or id, whether its body is still there or not.
      const out = fewer.map((f) => bodyKeyOf(f))
      names = names.filter((b) => !out.includes(b) && !fewer.some((f) => same(String(f), b)))
    }
    noClash(s.type, names, s.id)
    const next = settings === undefined ? settingsOf(s) : settingsOver(setupTypeOf(s.type), settingsOf(s), settings)
    if (typeof next === 'string') invalid(`settings: ${next}.`)
    const changed: Setup = { id: s.id, type: s.type, name: name?.trim() || s.name, bodies: names, ...(next as Json) }
    if (name === undefined && bodies === undefined && more === undefined && fewer === undefined && settings === undefined && !select) invalid('Give something to change: name, bodies, add, remove, settings or select.')
    put(st().setups.map((x) => (x.id === s.id ? changed : x)), select ? s.id : undefined)
    return { setup: brief(changed), selected: st().selected }
  },
}

const remove: Command<{ id: string }> = {
  name: 'remove',
  title: 'Remove a setup',
  description: 'Take a setup away (id: its id or name). Its bodies are then in no setup of its type: each workspace goes by its own settings for them, and part.review no longer judges them by its checks. One undo step.',
  input: obj({ id: str('The setup, by id or name.', { minLength: 1 }) }, ['id']),
  headless: true,
  label: ({ id }) => `remove setup ${id}`,
  run: async ({ id }) => {
    const s = setupNamed(id)
    put(st().setups.filter((x) => x !== s))
    return { removed: brief(s), setups: st().setups.map((x) => x.id) }
  },
}

const of: Command<{ body: string | number }> = {
  name: 'of',
  title: 'How a body is made',
  description: 'The setups a body (by name or id) is in, with their settings — how it is made, as recorded; none: no setup says, and each workspace goes by its own settings for it. Changes nothing.',
  input: obj({ body: oneOf([str(undefined, { minLength: 1 }), num()], 'The body, by name or id.') }, ['body']),
  readOnly: true,
  headless: true,
  run: async ({ body }) => {
    const in_ = setupsFor(body)
    return { body: bodyNameOf(bodyKeyOf(body)), setups: in_.map(brief), ...(in_.length ? {} : { none: 'in no setup: how it is made is not recorded' }) }
  },
}

export const setupCommands = [list, add, set, remove, of] as Command<never>[]
