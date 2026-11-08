// SPDX-License-Identifier: AGPL-3.0-only
// Electronics › Printed wiring's panel: the method and its conductor, the
// body and face, the nets (as printed.plan takes them), plan, route and
// make; each net's resistance; the settings; export for two filaments.
// Every control runs a printed.* command.

import { useState } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { readStateSections } from '../../../src/commands/stateSections'
import { saveFile } from '../../../src/app/exports'
import { useLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { NumberField } from '../../../src/ui/NumberField'
import { Status } from '../../_shared/ui/kit'
import { MATERIALS } from '../core/materials'
import { usePrinted } from '../state/printedStore'
import './printed.css'

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
const run = (name: string, input: Record<string, unknown> = {}) => runCommand(`printed.${name}`, input).catch(report)

type Carrier = 'wire' | 'tape' | 'paint'

interface Form {
  method: 'trace' | 'channel'
  body: string
  face: number
  depth: number
  thickness: number
  carrier: Carrier
  awg: number
  outer: number
  tapeW: number
  tapeT: number
  paintOhms: number
  lay: 'pause' | 'thread'
  nets: string
}

const SAMPLE = JSON.stringify([{ name: 'LED', pads: [{ at: [-10, 0] }, { at: [10, 0] }] }], null, 1)
const bodyNames = () => (((readStateSections().reverse as { bodies?: { name: string; surface?: boolean }[] } | undefined)?.bodies) ?? []).filter((b) => !b.surface).map((b) => b.name)

function inputOf(f: Form): Record<string, unknown> | null {
  let nets: unknown
  try {
    nets = JSON.parse(f.nets)
  } catch {
    report(new Error('Nets: not JSON — a list like [{ "name": "A", "points": [[0, 0], [10, 0]] }].'))
    return null
  }
  const carrier = f.carrier === 'wire' ? { kind: 'wire', awg: f.awg, ...(f.outer > 0 ? { outer: f.outer } : {}) } : f.carrier === 'tape' ? { kind: 'tape', width: f.tapeW, thickness: f.tapeT } : { kind: 'paint', sheetResistance: f.paintOhms }
  return {
    method: f.method,
    body: f.body,
    on: { face: f.face },
    depth: f.depth,
    ...(f.method === 'trace' ? { thickness: f.thickness } : { carrier, ...(f.depth > 0 ? { lay: f.lay } : {}) }),
    nets,
  }
}

export function PrintedPanel() {
  const s = usePrinted()
  const len = useLength()
  const busy = s.busy !== null
  const bodies = bodyNames()
  const [f, setF] = useState<Form>(() => ({ method: 'trace', body: bodies[0] ?? '', face: 0, depth: s.depth, thickness: s.thickness, carrier: 'wire', awg: 22, outer: 0, tapeW: 5, tapeT: 0.06, paintOhms: 50, lay: 'pause', nets: s.plan ? JSON.stringify(s.plan.input.nets, null, 1) : SAMPLE }))
  const put = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }))
  const go = (name: 'plan' | 'route') => {
    const i = inputOf(f)
    if (i) void run(name, i)
  }
  const exportFiles = () =>
    void runCommand('printed.export', {})
      .then((r) => {
        const file = (r as { file: { name: string; bytes: Uint8Array; mimeType: string } }).file
        saveFile(file.name, new Blob([file.bytes as BlobPart], { type: file.mimeType }))
      })
      .catch(report)
  const plan = s.plan
  return (
    <div className="group" data-test="printed-panel">
      <div className="sec-head">
        Circuits
        <InfoDot title="Printed circuits">
          <p>Traces printed in a conductive filament as a body of their own, cut out of the part; or channels in the part for copper wire, tape or paint.</p>
        </InfoDot>
      </div>
      <label className="pc-row">
        <span>Method</span>
        <select value={f.method} aria-label="Method" data-test="printed-method" onChange={(e) => put({ method: e.target.value as Form['method'], depth: e.target.value === 'channel' ? 0 : s.depth })}>
          <option value="trace">Conductive traces</option>
          <option value="channel">Channels for copper</option>
        </select>
      </label>
      {f.method === 'trace' ? (
        <label className="pc-row">
          <span>Filament</span>
          <select value={s.material} aria-label="Conductive filament" title="What the traces print in" onChange={(e) => void run('set', { material: e.target.value })}>
            {MATERIALS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            <option value="custom">Your own</option>
          </select>
        </label>
      ) : (
        <>
          <label className="pc-row">
            <span>Carrier</span>
            <select value={f.carrier} aria-label="Carrier" onChange={(e) => put({ carrier: e.target.value as Carrier, ...(e.target.value === 'paint' ? { depth: 0 } : {}) })}>
              <option value="wire">Copper wire</option>
              <option value="tape">Copper tape</option>
              <option value="paint">Conductive paint</option>
            </select>
          </label>
          {f.carrier === 'wire' && (
            <>
              <NumberField label="Gauge (AWG)" unit="" value={f.awg} step={1} min={0} onCommit={(v) => put({ awg: Math.round(v) })} />
              <NumberField label="Outer Ø" kind="length" value={f.outer} step={0.1} min={0} hint={<p>Over the insulation; 0 for bare or enamelled.</p>} onCommit={(v) => put({ outer: v })} />
            </>
          )}
          {f.carrier === 'tape' && (
            <>
              <NumberField label="Tape width" kind="length" value={f.tapeW} step={0.5} min={0.1} onCommit={(v) => put({ tapeW: v })} />
              <NumberField label="Tape thickness" kind="length" value={f.tapeT} step={0.01} min={0.01} onCommit={(v) => put({ tapeT: v })} />
            </>
          )}
          {f.carrier === 'paint' && <NumberField label="Ω per square" unit="" value={f.paintOhms} step={1} min={0.001} hint={<p>From the paint’s data sheet, at the thickness it dries to.</p>} onCommit={(v) => put({ paintOhms: v })} />}
        </>
      )}

      <div className="sec-head">Where</div>
      <label className="pc-row">
        <span>Body</span>
        <input className="pl-input" list="pc-bodies" aria-label="Body" value={f.body} onChange={(e) => put({ body: e.target.value })} />
        <datalist id="pc-bodies">
          {bodies.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </label>
      <label className="pc-row">
        <span>Face</span>
        <input className="pl-input" type="number" min={0} step={1} aria-label="Face index" title="The flat face’s index, as Reverse Engineer lists it" value={f.face} onChange={(e) => put({ face: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
      </label>
      <NumberField label={f.method === 'trace' ? 'Depth' : 'Roof'} kind="length" value={f.depth} step={0.2} min={f.method === 'trace' ? -50 : 0} hint={<p>{f.method === 'trace' ? 'The trace’s top under the surface: 0 flush, negative stands proud.' : '0 for a groove open at the surface; more closes it under a roof.'}</p>} onCommit={(v) => put({ depth: v })} />
      {f.method === 'trace' && <NumberField label="Thickness" kind="length" value={f.thickness} step={0.2} min={0.01} onCommit={(v) => put({ thickness: v })} />}
      {f.method === 'channel' && f.depth > 0 && (
        <label className="pc-row">
          <span>Lay</span>
          <select value={f.lay} aria-label="How the wire goes in" onChange={(e) => put({ lay: e.target.value as Form['lay'] })}>
            <option value="pause">At a pause</option>
            <option value="thread">Threaded after</option>
          </select>
        </label>
      )}
      <label className="pc-col">
        <span>Nets</span>
        <textarea className="pl-input pc-nets" aria-label="Nets" spellCheck={false} rows={6} title="One net per line: name, points or two pads, width, vias" value={f.nets} onChange={(e) => put({ nets: e.target.value })} />
      </label>
      <div className="toolrow">
        <button disabled={busy || !f.body} data-test="printed-plan" title="Work it out without making it" onClick={() => go('plan')}>
          Plan
        </button>
        <button disabled={busy || !f.body} data-test="printed-route" title="Route two-pad nets, then plan" onClick={() => go('route')}>
          Route
        </button>
        <button className="primary" disabled={busy || !plan} data-test="printed-apply" title="Make the planned circuit in the body" onClick={() => void run('apply')}>
          {busy ? s.busy : 'Make'}
        </button>
      </div>
      {plan && (
        <div className="pl-card live" data-test="printed-plan-card">
          <div className="kv">
            <span className="name">{plan.name}</span>
            <span className="pl-aside">{plan.method === 'trace' ? 'traces' : 'channels'}</span>
          </div>
          {plan.stale && <Status tone="warn">Settings changed: Make plans it again with them.</Status>}
          {plan.nets.map((n) => (
            <div key={n.name} className="kv">
              <span className="pl-aside">{n.name}</span>
              <span className="pl-aside">{`${fmtOhms(n.resistance)}, ${len.fmt(n.length, 1)}`}</span>
            </div>
          ))}
          {plan.warnings.map((w, i) => (
            <Status key={i} tone="warn">
              {w}
            </Status>
          ))}
        </div>
      )}
      <div className="toolrow">
        <button disabled={busy || !plan} title="Resistance, drop and heat at the current" onClick={() => void run('check')}>
          Check
        </button>
        <button disabled={busy || !s.made.some((m) => m.traces)} data-test="printed-export" title="The part and traces as STLs, with which filament each takes" onClick={exportFiles}>
          Export
        </button>
      </div>
      {s.check && (
        <div className="pl-card live" data-test="printed-check-card">
          {s.check.nets.map((n) => (
            <div key={n.name} className="kv">
              <span className="pl-aside">{n.name}</span>
              <span className="pl-aside">{`${n.volts} V, ${n.watts} W at ${s.check!.current} A`}</span>
            </div>
          ))}
        </div>
      )}
      {s.made.map((m) => (
        <div key={m.id} className="kv" data-test="printed-made-row">
          <span className="pl-aside">{`${m.id} ${m.traces ?? m.body}`}</span>
          <span className="pl-aside">
            {m.pause ? `pause Z ${m.pause.top}` : `${m.nets.length} nets`}
            <button className="x" title="Take it off the list" onClick={() => void run('forget', { id: m.id })}>
              ×
            </button>
          </span>
        </div>
      ))}

      <details className="pc-settings">
        <summary>Settings</summary>
        {s.material === 'custom' && (
          <>
            <NumberField label="Ω·cm along" unit="" value={s.along} step={1} min={1e-6} hint={<p>Along the layers.</p>} onCommit={(v) => void run('set', { material: 'custom', along: v })} />
            <NumberField label="Ω·cm through" unit="" value={s.through ?? s.along} step={1} min={1e-6} hint={<p>Through the layers.</p>} onCommit={(v) => void run('set', { material: 'custom', through: v })} />
          </>
        )}
        <NumberField label="Nozzle" kind="length" value={s.nozzle} step={0.1} min={0.1} onCommit={(v) => void run('set', { nozzle: v })} />
        <NumberField label="Layer height" kind="length" value={s.layerHeight} step={0.04} min={0.01} onCommit={(v) => void run('set', { layerHeight: v })} />
        <NumberField label="Clearance" kind="length" value={s.clearance} step={0.1} min={0} hint={<p>Conductor to conductor, edge to edge.</p>} onCommit={(v) => void run('set', { clearance: v })} />
        <NumberField label="Trace width" kind="length" value={s.width} step={0.2} min={0.05} onCommit={(v) => void run('set', { width: v })} />
        <NumberField label="Current" unit="A" value={s.current} step={0.01} min={0} hint={<p>What the checks are made at.</p>} onCommit={(v) => void run('set', { current: v })} />
        <NumberField label="Heat warning" unit="W/m" value={s.heatWarn} step={0.5} min={0} hint={<p>Power per metre of run past which it warns.</p>} onCommit={(v) => void run('set', { heatWarn: v })} />
        <button title="Back to the default settings" onClick={() => void run('set', { reset: true })}>
          Defaults
        </button>
      </details>
    </div>
  )
}

const fmtOhms = (r: number) => (r >= 1e6 ? `${(r / 1e6).toPrecision(3)} MΩ` : r >= 1e3 ? `${(r / 1e3).toPrecision(3)} kΩ` : r >= 1 ? `${r.toPrecision(3)} Ω` : `${(r * 1e3).toPrecision(3)} mΩ`)
