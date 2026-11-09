// SPDX-License-Identifier: AGPL-3.0-only
// A PCB order setup's settings on the Make tab: the fab profile, layers,
// thickness, finish, quantity and assembly. Each left empty takes the
// board's own (or the fab's first). Every change runs setup.set.

import { runCommand } from '../../../src/commands/registry'
import { useLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { NumberInput } from '../../../src/ui/NumberField'
import type { Setup } from '../../_shared/setups'
import { DEFAULT_QUANTITY, FABS, FINISH_LABEL, fabOf } from '../app/pcboCommandCore'

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
const change = (setup: Setup, settings: Record<string, unknown>) => void runCommand('setup.set', { id: setup.id, settings }).catch(report)

function Choice({ label, title, value, empty, options, onChange, test }: { label: string; title: string; value: unknown; empty: string; options: [string, string][]; onChange(v: string | null): void; test: string }) {
  return (
    <label className="field" title={title}>
      <span>{label}</span>
      <select value={value === undefined || value === null ? '' : String(value)} data-test={test} onChange={(e) => onChange(e.target.value || null)}>
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

export function OrderSettings({ setup }: { setup: Setup }) {
  const len = useLength()
  const fab = fabOf(setup.fab)
  const set = (k: string, conv: (v: string) => unknown = (v) => v) => (v: string | null) => change(setup, { [k]: v === null ? null : conv(v) })
  return (
    <div className="setup-settings" data-test="pcb-order-settings">
      <Choice label="Fab" title="Typical capabilities of a board house" value={setup.fab} empty="Generic" options={FABS.filter((f) => f.id !== 'generic').map((f) => [f.id, f.label])} onChange={set('fab')} test="pcbo-fab" />
      <Choice label="Layers" title="Copper layers ordered" value={setup.layers} empty="The board’s" options={fab.layers.map((n) => [String(n), String(n)])} onChange={set('layers', Number)} test="pcbo-layers" />
      <Choice label="Thickness" title="Board thickness ordered" value={setup.thickness} empty="The board’s" options={fab.thickness.map((t) => [String(t), len.fmt(t, 2)])} onChange={set('thickness', Number)} test="pcbo-thickness" />
      <Choice label="Finish" title="The pads’ surface finish" value={setup.finish} empty={`${FINISH_LABEL[fab.finishes[0]]} (the fab’s first)`} options={fab.finishes.map((f) => [f, FINISH_LABEL[f]])} onChange={set('finish')} test="pcbo-finish" />
      <label className="field" title="How many boards">
        <span>Quantity</span>
        <NumberInput value={typeof setup.quantity === 'number' ? setup.quantity : null} step={1} min={1} placeholder={String(DEFAULT_QUANTITY)} data-test="pcbo-quantity" onCommit={(v) => change(setup, { quantity: v === null ? null : Math.max(1, Math.round(v)) })} />
      </label>
      <Choice label="Assembly" title="Bare boards, or SMT parts placed by the fab" value={setup.assembly} empty="None: bare boards" options={[['smt', 'SMT by the fab']]} onChange={set('assembly')} test="pcbo-assembly" />
    </div>
  )
}
