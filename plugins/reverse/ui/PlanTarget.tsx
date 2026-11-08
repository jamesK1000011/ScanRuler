// SPDX-License-Identifier: AGPL-3.0-only
// The plan's accuracy target, set by the person: the share of the scan (or
// of the bodies) within ±T the model is to reach, and T. Shown while a plan
// is set; a change runs reverse.plan.set with the plan as it stands, so its
// regions and their ticks stay, and the agent reads the person's target.

import { runCommand } from '../../../src/commands/registry'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { NumberField } from '../../../src/ui/NumberField'
import { usePlan, type Plan } from '../app/rePlan'

type Target = { withinT: number; side?: 'scan' | 'model'; tolerance?: number }

/** The plan set again with another target — or, with none, the archetype's. */
function setTarget(plan: Plan, target: Target | null) {
  const regions = plan.regions.map((r) => ({ name: r.name, ...(r.function ? { function: r.function } : {}), ...(r.route ? { route: r.route } : {}), ...(r.at ? { at: r.at } : {}), ...(r.inferred ? { inferred: true } : {}) }))
  // Through JSON: a tolerance cleared is left out, not sent as undefined.
  const input = JSON.parse(JSON.stringify({ archetype: plan.archetype, regions, ...(target ? { target } : {}) })) as Record<string, unknown>
  runCommand('reverse.plan.set', input).catch((e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) }))
}

export function PlanTarget() {
  const plan = usePlan((s) => s.plan)
  if (!plan) return null
  const t = plan.target
  const given = (patch: Partial<Target>) => setTarget(plan, { withinT: t.withinT, side: t.side, ...(t.tolerance !== undefined ? { tolerance: t.tolerance } : {}), ...patch })
  return (
    <div className="group" data-test="plan-target">
      <div className="sec-head">
        Accuracy target
        <InfoDot title="The plan’s target">
          <p>How close the model is to come: the share of the scan within ±T of the bodies when compared in Deviation. Left alone it is the usual one for this kind of part; set your own here.</p>
          <p>A comparison read at a looser tolerance than T does not meet it.</p>
        </InfoDot>
      </div>
      <NumberField label="Within T" unit="%" testId="plan-within" value={t.withinT} step={1} min={1} onCommit={(v) => given({ withinT: Math.min(100, Math.max(0.1, v)) })} hint={<p>{t.by === 'given' ? 'Your own target.' : 'The usual target for this kind of part.'}</p>} />
      <NumberField label="Tolerance ±T" kind="length" testId="plan-tolerance" value={t.tolerance ?? 0} step={0.05} min={0} onCommit={(v) => given({ tolerance: v > 0 ? v : undefined })} hint={<p>0: the tolerance the comparison is read at.</p>} />
      <label className="field">
        <span>Share of</span>
        <select value={t.side} aria-label="Share of" data-test="plan-side" onChange={(e) => given({ side: e.target.value as 'scan' | 'model' })}>
          <option value="scan">the scan</option>
          <option value="model">the bodies</option>
        </select>
      </label>
      {t.by === 'given' && (
        <div className="toolrow">
          <button data-test="plan-target-usual" title="The usual target for this kind of part" onClick={() => setTarget(plan, null)}>
            Usual target
          </button>
        </div>
      )}
    </div>
  )
}
