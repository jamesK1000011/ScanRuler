// SPDX-License-Identifier: AGPL-3.0-only
// The modelled part in brief — each body's size and stamp, the features by
// a signature of what they hold, the parts encased — as the plugins that
// hold it describe it, so that history.diff can say what a change did
// without anyone describing the part again. A plugin adds its share with
// registerPartDigest from install(); the app never names one.
//
// Kept here: the part as it stood before each change that ran (newest
// last, a few dozen), so "since the last change" means the last one that
// changed the part — a check that only reads it, or a setting moved, is
// passed over.

import { onChangeStart } from './registry'

export interface BodyDigest {
  id: number | string
  name: string
  visible?: boolean
  /** mm³, mm², mm. */
  volume?: number | null
  area?: number | null
  box?: { min: number[]; max: number[] } | null
  faces?: number | null
  /** A short hash of the body's mesh: another once the body changes. */
  stamp?: string | null
}

/** A feature or an encased part: its id, its name, and a signature of what
 *  it holds — another once it is edited. */
export interface ItemDigest {
  id: string
  name: string
  sig: string
}

export interface PartDigest {
  bodies: BodyDigest[]
  features: ItemDigest[]
  embeds: ItemDigest[]
}

const providers = new Map<string, () => Partial<PartDigest>>()

/** A plugin's share of the part in brief. Two under one id throw; the
 *  returned function takes it out. */
export function registerPartDigest(id: string, digest: () => Partial<PartDigest>): () => void {
  if (providers.has(id)) throw new Error(`Two part digests share the id "${id}".`)
  providers.set(id, digest)
  return () => {
    if (providers.get(id) === digest) providers.delete(id)
  }
}

/** Whether any plugin in use describes a part. */
export const partDigestKnown = (): boolean => providers.size > 0

/** The part as it stands now; a share that throws is left out. */
export function readPartDigest(): PartDigest {
  const out: PartDigest = { bodies: [], features: [], embeds: [] }
  for (const digest of providers.values()) {
    try {
      const d = digest()
      out.bodies.push(...(d.bodies ?? []))
      out.features.push(...(d.features ?? []))
      out.embeds.push(...(d.embeds ?? []))
    } catch {
      // What could not be read is not compared.
    }
  }
  return out
}

/** FNV-1a of a text, as 8 hex — a signature, not a secret. */
export function signature(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** FNV-1a of a typed array's bytes, as 8 hex. */
function bytesSignature(v: ArrayBufferView): string {
  const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
  let h = 0x811c9dc5
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193)
  return `${v.byteLength}:${(h >>> 0).toString(16)}`
}

/** A value's signature by its JSON, typed arrays by their bytes. */
export function signatureOf(value: unknown): string {
  try {
    return signature(JSON.stringify(value, (_k, v: unknown) => (ArrayBuffer.isView(v) ? bytesSignature(v) : v)) ?? '')
  } catch {
    return '?'
  }
}

// ---- before each change ------------------------------------------------------------

interface Before {
  digest: PartDigest
  key: string
  /** The command that ran next. */
  change: string
  at: number
}

/** How many befores are kept. */
const KEPT = 32
const befores: Before[] = []

const keyOf = (d: PartDigest) => JSON.stringify(d)

/** Note the part before a change runs. Same as the one before it: nothing
 *  is kept but the change's name, so a run of checks does not push the
 *  part as it was before the last real change out. */
export function noteBefore(change: string): void {
  if (!partDigestKnown()) return
  const digest = readPartDigest()
  const key = keyOf(digest)
  const last = befores.at(-1)
  if (last && last.key === key) {
    last.change = change
    last.at = Date.now()
    return
  }
  befores.push({ digest, key, change, at: Date.now() })
  if (befores.length > KEPT) befores.splice(0, befores.length - KEPT)
}

/** The part before the last change that changed it, with that change's
 *  name — or, when none since the oldest kept did, the newest kept, alike
 *  the part now. Null before any change ran. */
export function beforeLastChange(now: PartDigest = readPartDigest()): { digest: PartDigest; change: string; at: number } | null {
  const key = keyOf(now)
  for (let i = befores.length - 1; i >= 0; i--) {
    if (befores[i].key !== key) return { digest: befores[i].digest, change: befores[i].change, at: befores[i].at }
  }
  const last = befores.at(-1)
  return last ? { digest: last.digest, change: last.change, at: last.at } : null
}

/** Forget every before — for tests and a session started over. */
export function forgetBefores(): void {
  befores.length = 0
}

let watching: (() => void) | null = null

/** Keep the part as it was before each change, from now on; once. */
export function watchPartChanges(): void {
  watching ??= onChangeStart((name) => noteBefore(name))
}

// ---- the difference ---------------------------------------------------------------

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d + 0

export interface BodyChange {
  id: number | string
  name: string
  stamp?: [string | null, string | null]
  /** Each a change, now less before: mm³, mm², faces, mm. */
  volume?: number
  area?: number
  faces?: number
  size?: number[]
  moved?: number[]
  shown?: boolean
}

export interface PartDiff {
  changed: boolean
  bodies: { changed: BodyChange[]; added: string[]; removed: string[] }
  features: { added: string[]; removed: string[]; edited: string[] }
  embeds: { added: string[]; removed: string[]; edited: string[] }
  /** The checks part.review runs that what changed would move, by command. */
  recheck: string[]
}

const sizeOf = (b: { min: number[]; max: number[] }) => b.max.map((v, i) => v - b.min[i])
const delta = (a: number | null | undefined, b: number | null | undefined, d = 3): number | undefined => {
  if (typeof a !== 'number' || typeof b !== 'number') return undefined
  const v = round(b - a, d)
  return v === 0 ? undefined : v
}
const vecDelta = (a: number[], b: number[]): number[] | undefined => {
  const v = b.map((x, i) => round(x - a[i]))
  return v.some((x) => x !== 0) ? v : undefined
}

function bodyChange(was: BodyDigest, now: BodyDigest): BodyChange | null {
  const c: BodyChange = { id: now.id, name: now.name }
  if ((was.stamp ?? null) !== (now.stamp ?? null)) c.stamp = [was.stamp ?? null, now.stamp ?? null]
  const v = delta(was.volume, now.volume, 1)
  if (v !== undefined) c.volume = v
  const a = delta(was.area, now.area, 1)
  if (a !== undefined) c.area = a
  const f = delta(was.faces, now.faces, 0)
  if (f !== undefined) c.faces = f
  if (was.box && now.box) {
    const s = vecDelta(sizeOf(was.box), sizeOf(now.box))
    if (s) c.size = s
    const m = vecDelta(was.box.min, now.box.min)
    if (m) c.moved = m
  } else if (Boolean(was.box) !== Boolean(now.box)) c.size = now.box ? sizeOf(now.box).map((x) => round(x)) : [0, 0, 0]
  if (was.visible !== undefined && now.visible !== undefined && was.visible !== now.visible) c.shown = now.visible
  return Object.keys(c).length > 2 ? c : null
}

/** Whether a body's change is to its shape, not only whether it is shown. */
const reshaped = (c: BodyChange) => Object.keys(c).some((k) => k !== 'id' && k !== 'name' && k !== 'shown')

function items(was: ItemDigest[], now: ItemDigest[]) {
  const before = new Map(was.map((x) => [x.id, x]))
  const after = new Map(now.map((x) => [x.id, x]))
  return {
    added: now.filter((x) => !before.has(x.id)).map((x) => x.name),
    removed: was.filter((x) => !after.has(x.id)).map((x) => x.name),
    edited: now.filter((x) => before.has(x.id) && before.get(x.id)!.sig !== x.sig).map((x) => x.name),
  }
}

/** The checks part.review runs, by command, and what moves each. */
export const REVIEW_CHECKS = ['reverse.body.check', 'reverse.body.clearance', 'dfm.check', 'mass.properties', 'hw.pauses', 'fea.results'] as const

/** What changed from `was` to `now`, and which checks it moves. */
export function diffParts(was: PartDigest, now: PartDigest): PartDiff {
  const before = new Map(was.bodies.map((b) => [b.id, b]))
  const after = new Map(now.bodies.map((b) => [b.id, b]))
  const changed: BodyChange[] = []
  for (const b of now.bodies) {
    const w = before.get(b.id)
    const c = w ? bodyChange(w, b) : null
    if (c) changed.push(c)
  }
  const added = now.bodies.filter((b) => !before.has(b.id)).map((b) => b.name)
  const removed = was.bodies.filter((b) => !after.has(b.id)).map((b) => b.name)
  const features = items(was.features, now.features)
  const embeds = items(was.embeds, now.embeds)
  const shape = added.length > 0 || changed.some(reshaped)
  const shown = removed.length > 0 || changed.some((c) => c.shown !== undefined)
  const held = embeds.added.length + embeds.removed.length + embeds.edited.length > 0
  const recheck = new Set<string>()
  if (shape) for (const c of REVIEW_CHECKS) if (c !== 'hw.pauses') recheck.add(c)
  if (shape || shown) recheck.add('reverse.body.clearance')
  if (removed.length > 0) recheck.add('mass.properties')
  if (held || (shape && now.embeds.length > 0)) ['hw.pauses', 'mass.properties', 'dfm.check', 'fea.results'].forEach((c) => recheck.add(c))
  const any = changed.length + added.length + removed.length + features.added.length + features.removed.length + features.edited.length + embeds.added.length + embeds.removed.length + embeds.edited.length > 0
  return {
    changed: any,
    bodies: { changed, added, removed },
    features,
    embeds,
    recheck: REVIEW_CHECKS.filter((c) => recheck.has(c)),
  }
}
