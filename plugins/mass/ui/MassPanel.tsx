// SPDX-License-Identifier: AGPL-3.0-only
// The Mass workspace's panel: how the part is printed, its weight, balance
// point and inertia, a print weighed to calibrate, the mass and balance
// point wanted, and the ballast pocket that gets there. Every control runs
// a mass.* command.

import { useEffect, useState } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { useLength, type BoundLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { NumberField as LengthField } from '../../../src/ui/NumberField'
import { InfoDot } from '../../../src/ui/InfoDot'
import { Status } from '../../_shared/ui/kit'
import { FILLERS, MATERIALS, type V3 } from '../core/mass'
import { useMass } from '../state/massStore'
import './mass.css'

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
const run = (name: string, input: Record<string, unknown> = {}) => runCommand(`mass.${name}`, input).catch(report)
const g = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2))
const at = (len: BoundLength, v: number[]) => v.map((x) => len.fmt(x, 1)).join(', ')
/** A length typed in the display units, as millimetres; blank stays blank. */
const mmOf = (len: BoundLength, text: string) => (text.trim() === '' ? NaN : len.fromDisplay(Number(text)))
const shown = (len: BoundLength, mm: number) => String(Math.round(len.toDisplay(mm) * 10000) / 10000)

/** A number field that runs its command when left or on Enter, not on
 *  every key. */
function NumberField({ label, value, unit, step, min, max, onCommit, testId }: { label: string; value: number | undefined; unit: string; step?: number; min?: number; max?: number; onCommit(v: number | null): void; testId?: string }) {
  const [text, setText] = useState<string | null>(null)
  const commit = () => {
    if (text === null) return
    const v = text.trim() === '' ? null : Number(text)
    setText(null)
    if (v === null || Number.isFinite(v)) onCommit(v)
  }
  return (
    <label className="mass-row">
      <span>{label}</span>
      <input className="pl-input" type="number" step={step} min={min} max={max} aria-label={label} data-test={testId} value={text ?? (value ?? '')} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      <span className="pl-aside">{unit}</span>
    </label>
  )
}

export function MassPanel() {
  const s = useMass()
  const len = useLength()
  const busy = s.busy !== null
  const [grams, setGrams] = useState('')
  const [tMass, setTMass] = useState(s.target?.mass?.toString() ?? '')
  const comText = (): [string, string, string] => (s.target?.com?.map((x) => shown(len, x)) as [string, string, string]) ?? ['', '', '']
  const [tCom, setTCom] = useState<[string, string, string]>(comText)
  // The target set elsewhere (a command, a project opened, undo) shows here.
  useEffect(() => {
    setTMass(s.target?.mass?.toString() ?? '')
    setTCom(comText())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.target, len.units])
  const r = s.reading
  return (
    <div className="group" data-test="mass-panel">
      <div className="sec-head">
        Mass and balance
        <InfoDot title="Mass and balance">
          <p>What a part weighs as printed, where it balances and how it turns — walls solid, the inside at the infill’s share. Weigh a print to calibrate it to your printer.</p>
        </InfoDot>
      </div>
      <label className="mass-row">
        <span>Material</span>
        <select value={s.material} aria-label="Material" disabled={busy} onChange={(e) => void run('setup', { material: e.target.value })}>
          {Object.entries(MATERIALS).map(([id, m]) => (
            <option key={id} value={id}>
              {m.label} ({m.density} g/cm³)
            </option>
          ))}
        </select>
      </label>
      <NumberField label="Infill" unit="%" value={s.infill} min={0} max={100} step={5} onCommit={(v) => v !== null && void run('setup', { infill: v })} testId="mass-infill" />
      <NumberField label="Walls" unit="lines" value={s.walls} min={0} max={50} step={1} onCommit={(v) => v !== null && void run('setup', { walls: Math.round(v) })} />
      <LengthField label="Line width" kind="length" value={s.lineMm} min={0.05} step={0.02} disabled={busy} onCommit={(v) => void run('setup', { lineMm: v })} />
      <button className="primary block" disabled={busy} data-test="mass-weigh" onClick={() => void run('properties')}>
        {busy ? s.busy : 'Weigh'}
      </button>
      {r && (
        <div className="pl-card live" data-test="mass-reading">
          <div className="kv">
            <span className="name">Mass</span>
            <span>
              <b>{g(r.total.mass)} g</b>
              {s.scale !== 1 && <span className="pl-aside" title="Calibrated from a print on the scales"> calibrated ×{s.scale.toFixed(3)}</span>}
            </span>
          </div>
          <div className="kv">
            <span className="name">Balance point</span>
            <span>({at(len, r.total.com)})</span>
          </div>
          {r.bodies.length > 1 &&
            r.bodies.map((b) => (
              <div key={b.body} className="kv">
                <span className="pl-aside" title={b.material ? `${b.material}, ${b.as === 'printed' ? 'printed' : 'solid'}${b.assumed ? ' (none set)' : ''}` : undefined}>
                  {b.body}
                </span>
                <span className="pl-aside">
                  {g(b.mass)} g at ({at(len, b.com)})
                </span>
              </div>
            ))}
          {r.embedded?.map((e) => (
            <div key={e.id} className="kv" title="Encased in the print, counted in the mass">
              <span className="pl-aside">{e.what}</span>
              <span className="pl-aside">
                {g(e.mass)} g at ({at(len, e.com)})
              </span>
            </div>
          ))}
          {r.bodies.some((b) => !b.closed) && <Status tone="warn">A body’s mesh has holes: its volume is not to trust.</Status>}
          <details>
            <summary>Inertia</summary>
            {r.bodies.map((b) => (
              <p key={b.body} className="hint">
                {/* units-ok: inertia is kept and shown in g·mm², as the commands give it. */}
                {b.body}: principal {b.principal.moments.map((m) => m.toExponential(2)).join(', ')} g·mm²
              </p>
            ))}
          </details>
        </div>
      )}

      <div className="sec-head">Calibrate</div>
      <div className="toolrow">
        <input className="pl-input" type="number" step="0.1" min={0} placeholder="Weighed, g" aria-label="Weighed print, grams" value={grams} onChange={(e) => setGrams(e.target.value)} />
        <button disabled={busy || !(Number(grams) > 0)} title="Scale the density so the reading matches the scales" onClick={() => void run('calibrate', { grams: Number(grams) })}>
          Calibrate
        </button>
        {s.scale !== 1 && (
          <button title="Back to the material’s figures" onClick={() => void run('calibrate', { reset: true })}>
            Reset
          </button>
        )}
      </div>

      <div className="sec-head">Target and ballast</div>
      <div className="toolrow">
        <input className="pl-input" type="number" step="1" min={0} placeholder="Mass wanted, g" aria-label="Mass wanted, grams" value={tMass} onChange={(e) => setTMass(e.target.value)} />
      </div>
      <div className="toolrow">
        {['X', 'Y', 'Z'].map((a, i) => (
          <input key={a} className="pl-input" type="number" placeholder={`Balance ${a}`} aria-label={`Balance point ${a}, ${len.word()}`} value={tCom[i]} onChange={(e) => setTCom(Object.assign([...tCom], { [i]: e.target.value }) as [string, string, string])} />
        ))}
      </div>
      <div className="toolrow">
        <button
          disabled={busy || (!(Number(tMass) > 0) && tCom.some((x) => x.trim() === ''))}
          onClick={() => {
            const com = tCom.every((x) => Number.isFinite(mmOf(len, x))) ? (tCom.map((x) => mmOf(len, x)) as V3) : undefined
            // What the fields show is the target: a field left empty drops its part.
            void run('target', { mass: Number(tMass) > 0 ? Number(tMass) : null, com: com ?? null })
          }}
        >
          Set target
        </button>
        {s.target && <button onClick={() => void run('target', { clear: true })}>Clear</button>}
      </div>
      <label className="mass-row">
        <span>Filler</span>
        <select value={s.filler} aria-label="Ballast filler" disabled={busy} onChange={(e) => void run('setup', { filler: e.target.value })}>
          {Object.entries(FILLERS).map(([id, f]) => (
            <option key={id} value={id} title={f.note}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <button className="block" disabled={busy || !s.target} data-test="mass-ballast" onClick={() => void run('ballast')}>
        Plan the ballast
      </button>
      {s.pocket && (
        <div className="pl-card live" data-test="mass-pocket">
          <Status tone={s.pocket.fits ? 'ok' : 'bad'}>{s.pocket.fits ? `Pocket ${s.pocket.size.map((x) => len.fmt(x, 1)).join(' × ')} at (${at(len, s.pocket.at)})` : s.pocket.why}</Status>
          <p className="hint">
            {g(s.pocket.fillerMass)} g of {FILLERS[s.filler]?.label.toLowerCase()}
            {s.pocket.count ? ` — about ${s.pocket.count} BBs` : ''}, {g(s.pocket.removedMass)} g of part cut away{s.pocket.wallMass ? `, ${g(s.pocket.wallMass)} g of walls round it` : ''}.
          </p>
          <button className="primary block" disabled={busy || !s.pocket.fits} title="Cut it into the body as Reverse Engineer features" onClick={() => void run('apply')}>
            Cut the pocket
          </button>
        </div>
      )}
    </div>
  )
}
