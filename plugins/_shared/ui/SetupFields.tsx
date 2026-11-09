// SPDX-License-Identifier: AGPL-3.0-only
// The fields a setup's settings are made of on the Make tab — a choice, a
// figure (a length in the display units, or a count), a switch — each
// left empty for the page's own or the default. Every change runs
// setup.set, as an agent would. The cut and mill setups' settings are
// made of these.

import { runCommand } from '../../../src/commands/registry'
import { useLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { NumberInput } from '../../../src/ui/NumberField'
import type { Setup } from '../setups'

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })

/** Change a setup's settings (null drops one). */
export const changeSetup = (setup: Setup, settings: Record<string, unknown>) => void runCommand('setup.set', { id: setup.id, settings }).catch(report)

export function SetupChoice({ label, title, value, options, empty = 'Default', onChange }: { label: string; title: string; value: unknown; options: readonly (readonly [string, string])[]; empty?: string; onChange(v: string | null): void }) {
  return (
    <label className="field" title={title}>
      <span>{label}</span>
      <select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{empty}</option>
        {options.map(([v, w]) => (
          <option key={v} value={v}>
            {w}
          </option>
        ))}
      </select>
    </label>
  )
}

/** A figure: a length (held in millimetres, shown in the display units)
 *  or a plain number with its unit word. */
export function SetupFigure({ label, title, value, length, unit, step, placeholder = 'Auto', onCommit }: { label: string; title: string; value: unknown; length?: boolean; unit?: string; step: number; placeholder?: string; onCommit(v: number | null): void }) {
  const len = useLength()
  const held = typeof value === 'number' ? value : null
  return (
    <label className="field" title={title}>
      <span>
        {label} <small>{length ? len.word() : unit}</small>
      </span>
      <NumberInput
        value={held}
        text={length ? (mm) => String(Number(len.toDisplay(mm).toFixed(len.decimals(3)))) : String}
        step={length ? len.step(step) : step}
        min={0}
        placeholder={placeholder}
        onCommit={(v) => onCommit(v === null ? null : length ? len.fromDisplay(v) : v)}
      />
    </label>
  )
}

export function SetupSwitch({ label, title, value, onChange }: { label: string; title: string; value: unknown; onChange(v: boolean | null): void }) {
  return (
    <label className="checkrow" title={title}>
      <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked ? true : null)} />
      {label}
    </label>
  )
}
