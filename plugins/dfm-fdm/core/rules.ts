// SPDX-License-Identifier: AGPL-3.0-only
// The rule pack and its profiles, stacked: the default pack, then the
// nozzle, the material and the printer chosen, then the project's own
// overrides, each later one winning. Every parameter remembers which layer
// set it, so a finding can say why its limit is what it is.

export type Check = 'thinWall' | 'overhang' | 'bridge' | 'smallHole' | 'bedContact' | 'tallThin' | 'trappedVolume' | 'meshHealth' | 'buildVolume'
export type Severity = 'error' | 'warning' | 'info'

export interface Rule {
  id: string
  check: Check
  severity: Severity
  params: Record<string, number>
  rationale: string
  source: string
}

export interface RulePack {
  id: string
  label: string
  version: number
  rules: Rule[]
}

export interface Override {
  params?: Record<string, number>
  severity?: Severity
  disabled?: boolean
}

export interface Profile {
  id: string
  label: string
  overrides: Record<string, Override>
}

export interface Layer {
  /** "default", "nozzle 0.4", "material petg", "printer corexy", "project". */
  name: string
  overrides: Record<string, Override>
}

export interface EffectiveRule extends Rule {
  disabled: boolean
  /** Which layer set each parameter, and the severity. */
  setBy: Record<string, string>
}

export const CHECKS: readonly Check[] = ['thinWall', 'overhang', 'bridge', 'smallHole', 'bedContact', 'tallThin', 'trappedVolume', 'meshHealth', 'buildVolume']

export function stack(pack: RulePack, layers: readonly Layer[]): EffectiveRule[] {
  return pack.rules.map((rule) => {
    const out: EffectiveRule = { ...rule, params: { ...rule.params }, disabled: false, setBy: Object.fromEntries([...Object.keys(rule.params), 'severity'].map((k) => [k, 'default'])) }
    for (const layer of layers) {
      const o = layer.overrides[rule.id]
      if (!o) continue
      for (const [k, v] of Object.entries(o.params ?? {})) {
        out.params[k] = v
        out.setBy[k] = layer.name
      }
      if (o.severity) {
        out.severity = o.severity
        out.setBy.severity = layer.name
      }
      if (o.disabled !== undefined) {
        out.disabled = o.disabled
        out.setBy.disabled = layer.name
      }
    }
    return out
  })
}

/** Refuse a pack or a profile that would break the checks. */
export function validatePack(p: unknown): string[] {
  const errors: string[] = []
  const pack = p as RulePack
  if (!pack || typeof pack.id !== 'string' || !Array.isArray(pack.rules)) return ['A rule pack needs id and rules.']
  const ids = new Set<string>()
  for (const r of pack.rules) {
    if (!r || typeof r.id !== 'string') errors.push('Every rule needs an id.')
    else if (ids.has(r.id)) errors.push(`Rule ${r.id} is there twice.`)
    else ids.add(r.id)
    if (!CHECKS.includes(r?.check)) errors.push(`Rule ${r?.id}: check must be one of ${CHECKS.join(', ')}.`)
    if (!['error', 'warning', 'info'].includes(r?.severity)) errors.push(`Rule ${r?.id}: severity must be error, warning or info.`)
    if (!r?.params || Object.values(r.params).some((v) => typeof v !== 'number')) errors.push(`Rule ${r?.id}: params must be numbers.`)
    if (typeof r?.source !== 'string' || !r.source) errors.push(`Rule ${r?.id}: say where its numbers come from (source).`)
  }
  return errors
}

/** A published design guide's numbers as a profile: its own name, who
 *  published it, where and when it was read, the figures it gives — the
 *  ones a check uses become overrides, the rest are there to read. */
export interface Guide extends Profile {
  publisher: string
  kind?: string
  url?: string
  /** When the guide was read, YYYY-MM-DD. */
  read?: string
  note?: string
  figures: { topic: string; value: number | string; unit?: string }[]
  /** Imported, not shipped with the plugin. */
  custom?: boolean
}

/** Refuse a guide that names a rule or a parameter the pack doesn't have,
 *  or says nothing of where its numbers come from. */
export function validateGuide(g: unknown, pack: RulePack): string[] {
  const errors: string[] = []
  const x = g as Guide
  if (!x || typeof x !== 'object') return ['A guide is a JSON object.']
  if (typeof x.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(x.id)) errors.push('id: lowercase letters, digits and dashes, up to 41.')
  if (typeof x.label !== 'string' || !x.label.trim()) errors.push('label: what the guide is called.')
  if (typeof x.publisher !== 'string' || !x.publisher.trim()) errors.push('publisher: who published the numbers — where they come from.')
  if (x.url !== undefined && (typeof x.url !== 'string' || !/^https?:\/\//.test(x.url))) errors.push('url: a web address, or leave it out.')
  if (x.read !== undefined && (typeof x.read !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.read))) errors.push('read: the date it was read, YYYY-MM-DD.')
  if (!x.overrides || typeof x.overrides !== 'object') errors.push('overrides: an object of rule ids, {} for none.')
  else
    for (const [id, o] of Object.entries(x.overrides)) {
      const rule = pack.rules.find((r) => r.id === id)
      if (!rule) {
        errors.push(`overrides.${id}: no such rule — have ${pack.rules.map((r) => r.id).join(', ')}.`)
        continue
      }
      for (const [k, v] of Object.entries(o?.params ?? {})) {
        if (!(k in rule.params)) errors.push(`overrides.${id}.params.${k}: ${id} has ${Object.keys(rule.params).join(', ') || 'no parameters'}.`)
        else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) errors.push(`overrides.${id}.params.${k}: a number, 0 or more.`)
      }
      if (o?.severity !== undefined && !['error', 'warning', 'info'].includes(o.severity)) errors.push(`overrides.${id}.severity: error, warning or info.`)
    }
  if (x.figures !== undefined && (!Array.isArray(x.figures) || x.figures.some((f) => !f || typeof f.topic !== 'string' || (typeof f.value !== 'number' && typeof f.value !== 'string')))) errors.push('figures: a list of { topic, value, unit }.')
  return errors
}
