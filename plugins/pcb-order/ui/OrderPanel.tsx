// SPDX-License-Identifier: AGPL-3.0-only
// Make › Order: the PCB order setup chosen — its board, the fab's typical
// figures, Check and Package, and what each said. Every control runs a
// pcbo.* command; the setup's settings are over it, in the Make tab's list.

import { useState } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { readStateSection } from '../../../src/commands/stateSections'
import { saveFile } from '../../../src/app/exports'
import { useLength } from '../../../src/app/useUnits'
import { useHistory } from '../../../src/state/historyStore'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { Busy, Notes, Status } from '../../_shared/ui/kit'
import { bodyNameOf, setupsOf, settingsOf } from '../../_shared/setups'
import { fabOf, FINISH_LABEL, orderOf } from '../app/pcboCommandCore'
import { useOrder } from '../state/orderStore'

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })

async function packageNow(setup: string) {
  const r = (await runCommand('pcbo.package', { setup }).catch(report)) as { file?: { name: string; mimeType: string; bytes: Uint8Array } } | undefined
  if (r?.file) saveFile(r.file.name, new Blob([r.file.bytes as BlobPart], { type: r.file.mimeType }))
}

const TONE = { ok: 'ok', fix: 'bad', unknown: 'warn' } as const
const WORDS = { ok: 'Nothing to put right for this fab.', fix: 'Put right before ordering.', unknown: 'Not fully checked: DRC did not run.' } as const

export function OrderPanel() {
  // The setups and the boards are other plugins’: read again on each step.
  useHistory((h) => h.past.length + h.future.length)
  const { checked, packaged, busy } = useOrder()
  const len = useLength()
  const all = setupsOf().filter((s) => s.type === 'pcb')
  const sel = (readStateSection('setups') as { selected?: string | null } | undefined)?.selected
  const [pick, setPick] = useState<string | null>(null)
  const setup = all.find((s) => s.id === (pick ?? sel)) ?? all.find((s) => s.id === sel) ?? all[0] ?? null
  if (!setup)
    return (
      <div className="group" data-test="pcbo-panel">
        <div className="sec-head">Board order</div>
        <p className="hint">No PCB order setup yet. Add one over these pages, and tick the board as its part.</p>
      </div>
    )
  const o = orderOf(settingsOf(setup), null)
  const fab = fabOf(setup.fab)
  const c = checked[setup.id]
  const p = packaged[setup.id]
  return (
    <div className="group" data-test="pcbo-panel">
      <div className="sec-head">
        Board order
        <InfoDot title="Board order">
          <p>A board made by a board house: checked against the fab’s typical figures, then its Gerbers, drill files, BOM, CPL and STEP gathered in one zip with an order sheet. The board comes from Electronics (KiCad or tscircuit). Its enclosure is a part of its own, made by another setup.</p>
        </InfoDot>
      </div>
      {all.length > 1 && (
        <label className="field" title="The PCB order setup shown">
          <span>Setup</span>
          <select value={setup.id} data-test="pcbo-setup" onChange={(e) => setPick(e.target.value)}>
            {all.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="hint" data-test="pcbo-board">
        {setup.bodies.length ? `Board: ${setup.bodies.map(bodyNameOf).join(', ')}` : 'No board ticked in this setup: the board open is used.'}
      </p>
      <div className="pl-card" title="Typical figures, not the fab’s own word">
        <p className="hint">
          {fab.label}, typically: trace {len.fmt(o.limits.minTrace)}, space {len.fmt(o.limits.minSpace)}, drill {len.fmt(o.limits.minDrill)}; {fab.layers.join(', ')} layers; {fab.finishes.map((f) => FINISH_LABEL[f]).join(', ')}
          {fab.assembly ? '; assembles SMT' : '; bare boards only'}.
        </p>
        <p className="hint">{fab.note}</p>
      </div>
      <div className="toolrow">
        <button disabled={!!busy} data-test="pcbo-check" title="DRC, and the board against the fab" onClick={() => void runCommand('pcbo.check', { setup: setup.id }).catch(report)}>
          Check
        </button>
        <button disabled={!!busy} data-test="pcbo-package" title="Gerbers, drill, BOM, CPL, STEP and order sheet" onClick={() => void packageNow(setup.id)}>
          Package
        </button>
      </div>
      {c && (
        <div className="pl-card" data-test="pcbo-check-result">
          <Status tone={TONE[c.verdict]}>{WORDS[c.verdict]}</Status>
          <Notes items={c.findings.map((f) => ({ level: f.severity, rule: f.rule, text: f.says }))} />
        </div>
      )}
      {p && (
        <div className="pl-card" data-test="pcbo-package-result">
          <p className="hint">
            {p.name}: {p.files.length} files
          </p>
          <Notes items={p.files.map((f) => ({ text: f.split('/').slice(1).join('/') }))} />
          <Notes items={p.findings.filter((f) => f.severity !== 'info').map((f) => ({ level: f.severity, rule: f.rule, text: f.says }))} />
        </div>
      )}
      <Busy text={busy} />
    </div>
  )
}
