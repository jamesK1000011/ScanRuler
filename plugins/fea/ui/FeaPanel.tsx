// SPDX-License-Identifier: AGPL-3.0-only
// The FEA workspace's panel: the body and the way it is printed, its
// material, the holds and loads (faces selected in Reverse Engineer, or
// the faces facing a way), the mesh, Solve with its progress and Cancel,
// and the answer — its worst safety factor, where and how it fails — with
// the field on the part and its scale. Every button runs a fea.* command.

import { useEffect, useState } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { readStateSections } from '../../../src/commands/stateSections'
import { useAgentLink } from '../../../src/commands/agentLink'
import { colormapById, rampColor } from '../../../src/core/field/colormap'
import { usePrefs } from '../../../src/state/prefsStore'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { Status } from '../../_shared/ui/kit'
import { FIELDS, MATERIAL_IDS } from '../app/feaCommands'
import { useFea, type Field, type Load } from '../state/feaStore'
import { rangeOf } from '../viewer/resultLayer'
import './fea.css'

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
const run = (name: string, input: Record<string, unknown> = {}) => runCommand(`fea.${name}`, input).catch(report)

const MATERIAL_WORDS: Record<string, string> = { pla: 'PLA', petg: 'PETG', abs: 'ABS', asa: 'ASA', 'petg-cf': 'PETG-CF', 'pa6-cf': 'PA6-CF', 'tpu-95a': 'TPU 95A' }
const BUILD: { id: string; label: string; v: [number, number, number] }[] = [
  { id: '+z', label: 'As it stands (+Z up)', v: [0, 0, 1] },
  { id: '-z', label: 'Upside down', v: [0, 0, -1] },
  { id: '+x', label: 'On its −X end (+X up)', v: [1, 0, 0] },
  { id: '-x', label: 'On its +X end (−X up)', v: [-1, 0, 0] },
  { id: '+y', label: 'On its −Y side (+Y up)', v: [0, 1, 0] },
  { id: '-y', label: 'On its +Y side (−Y up)', v: [0, -1, 0] },
]
const FACING: { id: string; label: string; n: [number, number, number] }[] = [
  { id: '+x', label: 'facing +X', n: [1, 0, 0] },
  { id: '-x', label: 'facing −X', n: [-1, 0, 0] },
  { id: '+y', label: 'facing +Y', n: [0, 1, 0] },
  { id: '-y', label: 'facing −Y', n: [0, -1, 0] },
  { id: '+z', label: 'facing +Z (top)', n: [0, 0, 1] },
  { id: '-z', label: 'facing −Z (bottom)', n: [0, 0, -1] },
]
const FIELD_WORDS: Record<Field, string> = { safety: 'Safety factor', vonMises: 'Stress (von Mises), MPa', displacement: 'Displacement, mm', across: 'Across the layers, MPa', shear: 'Between-layer shear, MPa' }

const buildId = (v: number[]) => BUILD.find((b) => b.v.every((x, i) => Math.abs(x - v[i]) < 1e-6))?.id ?? 'custom'
const pickWords = (p: { faces?: number[]; where?: Record<string, unknown> }) => {
  if (p.faces) return `faces ${p.faces.join(', ')}`
  const n = (p.where?.between as number[][] | undefined)?.[0]
  const f = n && FACING.find((x) => x.n.every((c, i) => c === n[i]))
  return f ? `faces ${f.label}` : 'faces by query'
}
const loadWords = (l: Load) => (l.force ? `${l.force.map((x) => +x.toFixed(2)).join(', ')} N` : `${l.pressure} MPa`)

function Busy() {
  const busy = useFea((s) => s.busy)
  const phase = useFea((s) => s.phase)
  const since = useFea((s) => s.since)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [])
  if (!busy) return null
  const secs = since ? Math.floor((Date.now() - since) / 1000) : 0
  return (
    <div className="toolrow" aria-live="polite" data-test="fea-busy">
      <p className="hint" style={{ flex: 1 }}>
        <span className="spinner" /> {phase ? `${phase[0].toUpperCase()}${phase.slice(1)}…` : busy} {secs >= 2 ? `${secs} s` : ''}
      </p>
      <button style={{ flex: 'none' }} data-test="fea-cancel" title="Stop the solve" onClick={() => void run('cancel')}>
        Cancel
      </button>
    </div>
  )
}

function FacesAdder({ kind }: { kind: 'hold' | 'load' }) {
  const [facing, setFacing] = useState('-x')
  const [force, setForce] = useState<[string, string, string]>(['0', '0', '-10'])
  const [pressure, setPressure] = useState('')
  const [usePressure, setUsePressure] = useState(false)
  const busy = useFea((s) => s.busy !== null)
  const extra = () => {
    if (kind === 'hold') return {}
    if (usePressure) return { pressure: Number(pressure) }
    return { force: force.map(Number) }
  }
  return (
    <div className="fea-adder" data-test={`fea-add-${kind}`}>
      {kind === 'load' && (
        <div className="toolrow">
          <label className="fea-inline">
            <input type="checkbox" checked={usePressure} onChange={(e) => setUsePressure(e.target.checked)} /> Pressure
          </label>
          {usePressure ? (
            <input className="pl-input" type="number" step="0.01" value={pressure} aria-label="Pressure, MPa" placeholder="MPa" onChange={(e) => setPressure(e.target.value)} />
          ) : (
            ['X', 'Y', 'Z'].map((a, i) => (
              <input key={a} className="pl-input fea-num" type="number" value={force[i]} aria-label={`Force ${a}, N`} title={`Force ${a}, N`} onChange={(e) => setForce(Object.assign([...force], { [i]: e.target.value }) as [string, string, string])} />
            ))
          )}
          {!usePressure && <span className="pl-aside">N</span>}
        </div>
      )}
      <div className="toolrow">
        <button disabled={busy} title="The faces selected on the body in Reverse Engineer" onClick={() => void run(kind, { selected: true, ...extra() })}>
          Selected faces
        </button>
        <select value={facing} aria-label="Faces facing" onChange={(e) => setFacing(e.target.value)}>
          {FACING.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <button disabled={busy} title="Every flat face facing that way" onClick={() => void run(kind, { where: { kind: 'plane', between: [FACING.find((f) => f.id === facing)!.n], withinDeg: 5 }, ...extra() })}>
          Add
        </button>
      </div>
    </div>
  )
}

function Legend({ field, target }: { field: Field; target: number }) {
  const r = useFea((s) => s.result)
  const colormap = usePrefs((s) => s.colormap)
  if (!r) return null
  const { lo, hi, flip } = rangeOf(field, r.surface.fields[field], target)
  const map = colormapById(colormap)
  const c: [number, number, number] = [0, 0, 0]
  const stops = Array.from({ length: 9 }, (_, i) => {
    rampColor(map, flip ? 1 - i / 8 : i / 8, c)
    return `rgb(${c.join(',')}) ${(i / 8) * 100}%`
  })
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2))
  return (
    <div className="fea-legend" data-test="fea-legend">
      <div className="fea-ramp" style={{ background: `linear-gradient(to right, ${stops.join(', ')})` }} />
      <div className="kv">
        <span>{fmt(lo)}</span>
        {field === 'safety' && <span title="The safety factor wanted">target {target}</span>}
        <span>
          {field === 'safety' ? '≥ ' : ''}
          {fmt(hi)}
        </span>
      </div>
    </div>
  )
}

function Answer() {
  const r = useFea((s) => s.result)
  const field = useFea((s) => s.field)
  const shown = useFea((s) => s.shown)
  const target = useFea((s) => s.target)
  if (!r) return null
  const w = r.worst
  const sf = w.safety
  const tone = sf === null ? 'idle' : sf < 1 ? 'bad' : sf < target ? 'warn' : 'ok'
  return (
    <div className="pl-card live" data-test="fea-answer">
      <Status tone={tone}>
        {sf === null ? 'No stress found' : sf < 1 ? `Breaks: safety factor ${sf}` : `Safety factor ${sf}${sf < target ? `, under the ${target} wanted` : ''}`}
      </Status>
      {w.mode && <p className="hint">Weakest {w.mode === 'in the layers' ? 'in the layers' : `where the ${w.mode}`}, at ({w.at?.join(', ')}).</p>}
      {w.atAHold && w.awayFromHolds && (
        <p className="hint" title="A perfectly rigid hold makes stress no real mount does">
          That spot is on a hold; away from the holds: {w.awayFromHolds.safety} ({w.awayFromHolds.mode}).
        </p>
      )}
      <div className="kv">
        <span className="name">Largest stress</span>
        <span>{w.vonMises} MPa</span>
      </div>
      <div className="kv">
        <span className="name">Largest movement</span>
        <span>{w.displacement < 0.01 ? w.displacement.toExponential(2) : w.displacement.toFixed(3)} mm</span>
      </div>
      <p className="pl-aside">
        {r.mesh.elements.toLocaleString()} elements · Gmsh {r.solver.gmsh} · CalculiX {r.solver.calculix}
      </p>
      <div className="toolrow">
        <select value={field} aria-label="Colour the part by" onChange={(e) => void run('show', { field: e.target.value })}>
          {FIELDS.map((f) => (
            <option key={f} value={f}>
              {FIELD_WORDS[f]}
            </option>
          ))}
        </select>
        <button title={shown ? 'Take the colours off' : 'Colour the part by the answer'} onClick={() => void run('show', { shown: !shown })}>
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {shown && <Legend field={field} target={target} />}
    </div>
  )
}

export function FeaPanel() {
  const s = useFea()
  const link = useAgentLink((x) => x.status)
  const busy = s.busy !== null
  const [tools, setTools] = useState<{ ready: boolean; howTo?: string } | null>(null)
  const bodies = ((readStateSections().reverse as { bodies?: { name: string; surface?: boolean }[] } | undefined)?.bodies ?? []).filter((b) => !b.surface)
  useEffect(() => {
    if (link !== 'connected') return
    void runCommand('fea.tools', {}).then((t) => setTools(t as { ready: boolean; howTo?: string }), () => setTools(null))
  }, [link])
  return (
    <div className="group" data-test="fea-panel">
      <div className="sec-head">
        Strength
        <InfoDot title="Strength of a printed part">
          <p>Finite elements on your computer: Gmsh meshes the part, CalculiX solves it — FreeCAD’s own copies, or Homebrew’s.</p>
          <p>Printed parts are weaker across their layers. The safety factor takes the lesser of the check in the layers and the check between them.</p>
        </InfoDot>
      </div>
      {link !== 'connected' && <p className="hint">Needs the agent connection (Settings → Agents): the solver runs on your computer.</p>}
      {tools && !tools.ready && <Status tone="warn">{tools.howTo}</Status>}
      <label className="fea-row">
        <span>Body</span>
        <select value={s.body ?? ''} disabled={busy} aria-label="Body" onChange={(e) => void run('setup', { body: e.target.value })}>
          <option value="" disabled>
            {bodies.length ? 'Choose…' : 'Build one in Reverse Engineer'}
          </option>
          {bodies.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="fea-row">
        <span>Printed</span>
        <select value={buildId(s.build)} disabled={busy} aria-label="How it is printed" onChange={(e) => void run('setup', { build: e.target.value })}>
          {BUILD.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
          {buildId(s.build) === 'custom' && <option value="custom">Along {s.build.map((x) => x.toFixed(2)).join(', ')}</option>}
        </select>
      </label>
      <label className="fea-row">
        <span>Material</span>
        <select value={s.material} disabled={busy} aria-label="Material" onChange={(e) => void run('setup', { material: e.target.value })}>
          {MATERIAL_IDS.map((m) => (
            <option key={m} value={m}>
              {MATERIAL_WORDS[m]}
            </option>
          ))}
        </select>
      </label>
      {Object.keys(s.overrides).length > 0 && <p className="pl-aside">Your figures: {Object.entries(s.overrides).map(([k, v]) => `${k} ${v}`).join(', ')}</p>}
      <label className="fea-row">
        <span>Mesh</span>
        <select value={s.fineness} disabled={busy} aria-label="Mesh" onChange={(e) => void run('setup', { fineness: e.target.value })}>
          <option value="coarse">Coarse — quick</option>
          <option value="medium">Medium</option>
          <option value="fine">Fine — slow</option>
        </select>
      </label>
      <label className="fea-row">
        <span>Safety wanted</span>
        <input className="pl-input fea-num" type="number" min={1} step={0.5} value={s.target} disabled={busy} aria-label="Safety factor wanted" onChange={(e) => Number(e.target.value) > 0 && void run('setup', { target: Number(e.target.value) })} />
      </label>

      <div className="sec-head">Held by</div>
      {s.holds.map((h) => (
        <div key={h.name} className="kv" data-test="fea-hold">
          <span className="name">{h.name}</span>
          <span className="pl-aside">{pickWords(h)}</span>
          <button className="x" title="Take it away" disabled={busy} onClick={() => void run('hold', { remove: h.name })}>
            ×
          </button>
        </div>
      ))}
      <FacesAdder kind="hold" />

      <div className="sec-head">Loads</div>
      {s.loads.map((l) => (
        <div key={l.name} className="kv" data-test="fea-load">
          <span className="name">{l.name}</span>
          <span className="pl-aside">
            {pickWords(l)} · {loadWords(l)}
          </span>
          <button className="x" title="Take it away" disabled={busy} onClick={() => void run('load', { remove: l.name })}>
            ×
          </button>
        </div>
      ))}
      <FacesAdder kind="load" />

      <button className="primary block" disabled={busy || link !== 'connected' || !s.holds.length || !s.loads.length} data-test="fea-solve" title="Mesh and solve on your computer" onClick={() => void run('solve')}>
        Solve
      </button>
      <Busy />
      <Answer />
    </div>
  )
}
