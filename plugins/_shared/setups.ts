// SPDX-License-Identifier: AGPL-3.0-only
// Setups: how the parts of a build are made. As in Fusion's Manufacture
// workspace, a setup says what is made and how — a process (print; cut,
// mill or a board ordered to come) and the bodies made by it — and a design
// has as many as it needs: a bracket printed, a plate laser-cut, a board
// ordered, all in one build. What the part is made of is the part's
// (materials.ts); how it is made is the setup's. Nothing here decides which
// process a part gets — that is chosen in conversation; a setup records it.
//
// The setups themselves live in the setups plugin (plugins/setups) and are
// read here through its part of the session, never by importing it, so a
// build without it stands: every body is then in no setup, and each
// workspace goes by its own settings as before.
//
// A body is keyed by its Reverse Engineer id as text — the id of the
// feature that made it, which a rename leaves alone — as materials/
// keys it. A setup from a project older than setups may hold a body's
// name instead (what the review spec's processes named): it matches too.
//
// A plugin brings a kind of setup with registerSetupType — its pages on the
// Make tab, its settings and their checks, what part.review runs on a body
// in it, what it puts out, and the machine's tolerance Fits sizes with. The
// print setup's type is printSetup.ts.

import type { ComponentType } from 'react'
import { readStateSection } from '../../src/commands/stateSections'
import type { JsonSchema } from '../../src/commands/schema'
import type { PrinterFit } from './printerFit'

// ---- the data ---------------------------------------------------------------------------

/** A body as a setup holds it: its Reverse Engineer id, as text. */
export type BodyKey = string

/** The kinds of setup named so far; a type registered brings its own id. */
export type SetupKind = 'print' | 'cut' | 'mill' | 'pcb'

/** One setup, as the project file keeps it: its own fields, then its type's
 *  settings beside them — { id, type, name, bodies, nozzle: "0.4", … }. */
export interface Setup {
  /** S1, S2 …: stable for the life of the project. */
  id: string
  /** The kind of setup: a registered type's id ("print", …). */
  type: SetupKind | (string & {})
  name: string
  bodies: BodyKey[]
  [setting: string]: unknown
}

/** The fields every setup has; the rest are its type's settings. */
export const SETUP_FIELDS = ['id', 'type', 'name', 'bodies'] as const

/** A setup's type's settings alone. */
export function settingsOf(s: Setup): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s)) if (!(SETUP_FIELDS as readonly string[]).includes(k) && v !== undefined) out[k] = v
  return out
}

// ---- kinds of setup -----------------------------------------------------------------------

/** One setting of a type: its schema for the agent, and its check. */
export interface SetupSetting {
  schema: JsonSchema
  /** Why a value given is not one, or null when it is. Run on every value
   *  set, and on each read from a file (one that fails is dropped there). */
  check(value: unknown): string | null
  /** The value as kept, once checked: rounded, an alias to its id. */
  normalize?(value: unknown): unknown
}

/** What a machine holds a made size to, for Fits to size a fit with. A
 *  print setup's is its printer calibration; a cut setup's will be the
 *  kerf, a milled one's an IT grade — the kinds to come are named so Fits
 *  can say it has no sizing for them yet. */
export type MachineTolerance =
  | { kind: 'print'; fit: PrinterFit | null }
  | { kind: 'kerf'; kerf: number }
  | { kind: 'it'; grade: number }

/** A command part.review runs on a body in a setup of the type. */
export interface SetupCheck {
  command: string
  /** Its input for the body; { body: name } by default. */
  input?(body: { id?: number; name: string }): Record<string, unknown>
}

export interface SetupType {
  /** The type's id, kept in each setup: stable. */
  id: string
  /** Its name in the list, and in a new setup's name: "Print". */
  label: string
  /** What it is for, a tooltip: 60 characters at most. */
  title: string
  /** The Make tab's pages for a setup of this type, by workspace id, in
   *  order — those of plugins not in the build left out. */
  pages: readonly string[]
  /** Its settings, by key. A setting left unset leaves each workspace on
   *  its own. */
  settings: Readonly<Record<string, SetupSetting>>
  /** What part.review runs on a body in such a setup — its process's
   *  checks; findings it reads from each answer's findings. */
  checks?: readonly SetupCheck[]
  /** What a setup of the type puts out, in words, for setup.list. */
  outputs?: readonly string[]
  /** The machine's tolerance, for Fits; none when it has none to give. */
  tolerance?(setup: Setup): MachineTolerance | null
  /** Its settings on the Make tab, under the list. */
  Settings?: ComponentType<{ setup: Setup }>
}

const types = new Map<string, SetupType>()

/** Bring a kind of setup. The same type registered again — by each of the
 *  plugins whose pages it has, so any of them alone brings it — is one;
 *  another under the same id throws. The returned function takes it out. */
export function registerSetupType(type: SetupType): () => void {
  const had = types.get(type.id)
  if (had && had !== type) throw new Error(`Two setup types share the id "${type.id}".`)
  types.set(type.id, type)
  return () => {
    if (types.get(type.id) === type) types.delete(type.id)
  }
}

/** The types in this build, in the order registered. */
export const setupTypes = (): SetupType[] => [...types.values()]

export const setupTypeOf = (id: string): SetupType | undefined => types.get(id)

/** The pages a setup's type offers: its pages whose workspace is in the
 *  build, given the build's. */
export const pagesOfType = (type: SetupType, have: readonly string[]): string[] => type.pages.filter((p) => have.includes(p))

// ---- reading them -----------------------------------------------------------------------

interface Body {
  id: number
  name: string
}
const reverseBodies = (): Body[] | undefined => (readStateSection('reverse') as { bodies?: Body[] } | undefined)?.bodies
const same = (a: string, b: string) => a === b || a.toLowerCase() === b.toLowerCase()

/** A body's key from the body, its Reverse Engineer id, or a name: a name
 *  Reverse Engineer knows is its body's id; anything else as it is. */
export function bodyKeyOf(body: { id: number } | number | string): BodyKey {
  if (typeof body === 'object') return String(body.id)
  if (typeof body === 'number') return String(body)
  const b = reverseBodies()?.find((x) => x.name === body) ?? reverseBodies()?.find((x) => same(x.name, body))
  return b ? String(b.id) : body
}

/** The body's name for a key, as the answers show it; the key itself when
 *  no body has it. */
export function bodyNameOf(key: BodyKey): string {
  return reverseBodies()?.find((b) => String(b.id) === key)?.name ?? key
}

const isSetup = (x: unknown): x is Setup => {
  const s = x as Partial<Setup> | null
  return !!s && typeof s === 'object' && typeof s.id === 'string' && typeof s.type === 'string' && Array.isArray(s.bodies)
}

/** The setups in a state — the `setups` section as saved, the readout's
 *  part, or { setups } around either — or, given nothing, the session's
 *  now; none without the setups plugin. Malformed entries are left out;
 *  bodies always as text. */
export function setupsOf(state?: unknown): Setup[] {
  const raw = state === undefined ? readStateSection('setups') : state
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { setups?: unknown }).setups) ? (raw as { setups: unknown[] }).setups : []
  return list.filter(isSetup).map((s) => ({ ...s, bodies: s.bodies.map((b) => String(b)) }))
}

/** Whether a setup holds the body: by its key, or — a setup from before
 *  setups — by its name. */
function holds(s: Setup, body: { id: number } | number | string): boolean {
  const key = bodyKeyOf(body)
  const name = bodyNameOf(key)
  return s.bodies.some((b) => b === key || (name !== null && same(b, name)))
}

/** Every setup the body is in. */
export function setupsFor(body: { id: number } | number | string, state?: unknown): Setup[] {
  return setupsOf(state).filter((s) => holds(s, body))
}

/** The setup the body is in — of the type, when given — or null. A body
 *  is in one setup of a type at most; one in more (it should not be) is
 *  taken by the first. The state, as setupsOf takes it, in place of the
 *  type or after it. */
export function setupFor(body: { id: number } | number | string, typeOrState?: unknown, state?: unknown): Setup | null {
  const type = typeof typeOrState === 'string' ? typeOrState : undefined
  const from = typeof typeOrState === 'string' ? state : typeOrState
  return setupsFor(body, from).find((s) => !type || s.type === type) ?? null
}

/** Whether a body is printed: in a print setup. */
export const isPrinted = (body: { id: number } | number | string, state?: unknown): boolean => setupFor(body, 'print', state) !== null

/** A setting of the setup of `type` the body is in, and that setup — null
 *  when the body is in none, or its setup leaves the setting unset: the
 *  workspace then goes by its own. */
export function setupValue<T = unknown>(body: { id: number } | number | string | null | undefined, key: string, type = 'print'): { value: T; setup: Setup } | null {
  if (body === null || body === undefined) return null
  const s = setupFor(body, type)
  if (!s || s[key] === undefined || s[key] === null) return null
  return { value: s[key] as T, setup: s }
}

/** A setting several bodies share through their setups of `type`: the
 *  value when every body is in such a setup and all of them say the same,
 *  else null (the workspace's own then). */
export function sharedSetupValue<T = unknown>(bodies: readonly (string | number)[], key: string, type = 'print'): { value: T; setups: Setup[] } | null {
  if (!bodies.length) return null
  const each = bodies.map((b) => setupValue<T>(b, key, type))
  if (each.some((x) => x === null)) return null
  const first = JSON.stringify(each[0]!.value)
  if (each.some((x) => JSON.stringify(x!.value) !== first)) return null
  return { value: each[0]!.value, setups: [...new Map(each.map((x) => [x!.setup.id, x!.setup])).values()] }
}

/** The tolerance of the machine that makes the body, or of the setup named
 *  (by id or name): null when there is no such setup, or its type has none
 *  to give. */
export function machineTolerance(ref: { body?: string | number; setup?: string }): MachineTolerance | null {
  const s = ref.setup !== undefined ? (setupsOf().find((x) => x.id === ref.setup || same(x.name, ref.setup!)) ?? null) : ref.body !== undefined ? setupFor(ref.body) : null
  if (!s) return null
  return setupTypeOf(s.type)?.tolerance?.(s) ?? null
}
