// SPDX-License-Identifier: AGPL-3.0-only
// The setups' rules, pure: a setup read from a file, settings checked by
// their type, the next id, a body in one setup of a type at most, and the
// setup an older project — from before there were setups — opens with.

import { SETUP_FIELDS, settingsOf, type Setup, type SetupType } from '../../_shared/setups'

export type TypeOf = (id: string) => SetupType | undefined

const same = (a: string, b: string) => a === b || a.toLowerCase() === b.toLowerCase()

/** S1, S2 …: one past the highest there is. */
export function nextId(setups: readonly Setup[]): string {
  const n = Math.max(0, ...setups.map((s) => (/^S(\d+)$/.exec(s.id) ? Number(s.id.slice(1)) : 0)))
  return `S${n + 1}`
}

/** A new setup's name: the type's label, numbered past the first. */
export function nameFor(label: string, setups: readonly Setup[]): string {
  if (!setups.some((s) => same(s.name, label))) return label
  for (let i = 2; ; i++) if (!setups.some((s) => same(s.name, `${label} ${i}`))) return `${label} ${i}`
}

/** The settings over `base`, each checked by the type: null drops one. The
 *  reason they are not, or them. A type not in this build takes them as
 *  given — the plugin that knows them is not here to say. */
export function settingsOver(type: SetupType | undefined, base: Record<string, unknown>, given: Record<string, unknown>): Record<string, unknown> | string {
  const out = { ...base }
  for (const [k, v] of Object.entries(given)) {
    if ((SETUP_FIELDS as readonly string[]).includes(k)) return `${k} is the setup’s own, not a setting`
    if (v === null || v === undefined) {
      delete out[k]
      continue
    }
    if (!type) {
      out[k] = v
      continue
    }
    const spec = type.settings[k]
    if (!spec) return `a ${type.label.toLowerCase()} setup has no setting ${k} — it has ${Object.keys(type.settings).join(', ') || 'none'}`
    const why = spec.check(v)
    if (why) return why
    out[k] = spec.normalize ? spec.normalize(v) : v
  }
  return out
}

/** Which setups of `type` other than `except` hold any of `bodies`: a body
 *  is made one way per kind of setup. */
export function clashes(setups: readonly Setup[], type: string, bodies: readonly string[], except?: string): { body: string; setup: Setup }[] {
  const out: { body: string; setup: Setup }[] = []
  for (const s of setups) {
    if (s.type !== type || s.id === except) continue
    for (const b of bodies) if (s.bodies.some((x) => same(x, b))) out.push({ body: b, setup: s })
  }
  return out
}

/** The setups as a project file holds them, read: the reason they do not
 *  read, or them. A setup of a type not in this build is kept as it is, to
 *  be written back; a setting of a known type that no longer checks is
 *  let go. */
export function readSetups(value: unknown, typeOf: TypeOf): Setup[] | string {
  if (!value || typeof value !== 'object') return 'not an object'
  const list = (value as { setups?: unknown }).setups
  if (!Array.isArray(list)) return 'no list of setups'
  const out: Setup[] = []
  for (const [i, raw] of list.entries()) {
    if (!raw || typeof raw !== 'object') return `setup ${i + 1} is not an object`
    const s = raw as Record<string, unknown>
    if (typeof s.id !== 'string' || !s.id || typeof s.type !== 'string' || !s.type) return `setup ${i + 1} has no id or type`
    if (out.some((x) => x.id === s.id)) return `two setups share the id ${s.id}`
    const bodies = Array.isArray(s.bodies) ? [...new Set(s.bodies.filter((b): b is string => typeof b === 'string' && b.length > 0))] : []
    const type = typeOf(s.type)
    const settings: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(settingsOf(s as Setup))) {
      const spec = type?.settings[k]
      if (type && (!spec || spec.check(v))) continue
      settings[k] = spec?.normalize ? spec.normalize(v) : v
    }
    out.push({ id: s.id, type: s.type, name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : s.id, bodies, ...settings })
  }
  return out
}

/** What an older project — from before setups — opens with: one print
 *  setup holding the bodies it said were printed (the review spec's
 *  processes "fdm" or "print") and the body Check was set to, when it did
 *  any printing work (Check's part of the file, or a printed body); else
 *  none, and the Make tab offers one. Not the page it was saved on: New
 *  Project's blank file names the page on screen too. Nothing of the file is changed or dropped:
 *  the workspaces keep their own settings, which a setup leaves standing
 *  until one of its own is set. */
export function migrated(manifest: Record<string, unknown>): Setup[] {
  const bodies: string[] = []
  const add = (b: unknown) => {
    if (typeof b === 'string' && b.trim() && !bodies.some((x) => same(x, b.trim()))) bodies.push(b.trim())
  }
  const processes = ((manifest.review as { spec?: { processes?: Record<string, unknown> } } | undefined)?.spec?.processes) ?? {}
  for (const [body, how] of Object.entries(processes)) if (typeof how === 'string' && /^(fdm|fff|print|printed|3d[- ]?print(ed)?)$/i.test(how.trim())) add(body)
  const dfm = (manifest['dfm-fdm'] as { settings?: { target?: unknown; body?: unknown } } | undefined)?.settings
  if (dfm?.target === 'body') add(dfm.body)
  const printing = bodies.length > 0 || manifest['dfm-fdm'] !== undefined
  return printing ? [{ id: 'S1', type: 'print', name: 'Print', bodies }] : []
}
