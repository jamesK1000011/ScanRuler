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
