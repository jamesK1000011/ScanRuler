// SPDX-License-Identifier: AGPL-3.0-only
// The FEA workspace's panel: the body and the way it is printed, its
// material, the holds and loads (faces selected in Reverse Engineer, or
// the faces facing a way), the mesh, Solve with its progress and Cancel,
// and the answer — its worst safety factor, where and how it fails — with
// the field on the part and its scale. Every button runs a fea.* command.

import { useEffect, useState } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { useAgentLink } from '../../../src/commands/agentLink'
import { colormapById, rampColor } from '../../../src/core/field/colormap'
import { usePrefs } from '../../../src/state/prefsStore'
import { fmtLen, toDisplay, unitWord, type DisplayUnits } from '../../../src/core/units'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { Status } from '../../_shared/ui/kit'
import { bodies as listBodies, builtFor, FIELDS, MATERIAL_IDS, MATERIALS, staleness, wasCancelled } from '../app/feaCommands'
import { resolveAssignment, useAssigned } from '../../_shared/materials/assigned'
import { useAssignedMaterials } from '../../_shared/materials/useLibrary'
import { PRINTED } from '../../_shared/materials/printed'
import { setupFor } from '../../_shared/setups'
import { useFea, type Field, type Load } from '../state/feaStore'
import { rangeOf } from '../viewer/resultLayer'
import './fea.css'

const report = (e: unknown) => {
  // A solve the person stopped is not an error.
  if (wasCancelled(e)) return
  useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
}
const run = (name: string, input: Record<string, unknown> = {}) => runCommand(`fea.${name}`, input).catch(report)

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
const GRAVITY: { id: string; label: string; v: [number, number, number] }[] = [
  { id: '-z', label: 'Pulling −Z (down)', v: [0, 0, -1] },
  { id: '+z', label: 'Pulling +Z', v: [0, 0, 1] },
  { id: '-x', label: 'Pulling −X', v: [-1, 0, 0] },
  { id: '+x', label: 'Pulling +X', v: [1, 0, 0] },
  { id: '-y', label: 'Pulling −Y', v: [0, -1, 0] },
  { id: '+y', label: 'Pulling +Y', v: [0, 1, 0] },
]
const FIELD_WORDS: Record<Field, string> = { safety: 'Safety factor', vonMises: 'Stress (von Mises), MPa', displacement: 'Displacement', across: 'Across the layers, MPa', shear: 'Between-layer shear, MPa' }
/** A field's name, with the length unit shown for displacement. */
const fieldWords = (f: Field, units: DisplayUnits) => (f === 'displacement' ? `${FIELD_WORDS[f]}, ${unitWord(units)}` : FIELD_WORDS[f])
/** A movement in the units shown; a tiny one in powers of ten. */
const moveText = (mm: number, units: DisplayUnits) => (mm !== 0 && Math.abs(mm) < 0.01 ? `${toDisplay(mm, units).toExponential(2)} ${unitWord(units)}` : fmtLen(mm, units, 3))

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
        <button disabled={busy} aria-label={`${kind === 'hold' ? 'Hold' : 'Load'} the faces selected in Reverse Engineer`} title="The faces selected on the body in Reverse Engineer" onClick={() => void run(kind, { selected: true, ...extra() })}>
          Selected faces
        </button>
        <select value={facing} aria-label={`${kind === 'hold' ? 'Hold' : 'Load'}: faces facing`} onChange={(e) => setFacing(e.target.value)}>
          {FACING.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <button disabled={busy} aria-label={`${kind === 'hold' ? 'Hold' : 'Load'} the flat faces facing that way`} title="Every flat face facing that way" onClick={() => void run(kind, { where: { kind: 'plane', between: [FACING.find((f) => f.id === facing)!.n], withinDeg: 5 }, ...extra() })}>
          Add
        </button>
      </div>
    </div>
  )
}

function Legend({ field, target }: { field: Field; target: number }) {
  const r = useFea((s) => s.result)
  const colormap = usePrefs((s) => s.colormap)
  const units = usePrefs((s) => s.units)
  if (!r) return null
  const range = rangeOf(field, r.surface.fields[field], target)
  // Displacement in the units shown; the other fields are not lengths.
  const shown = (v: number) => (field === 'displacement' ? toDisplay(v, units) : v)
  const { flip } = range
  const lo = shown(range.lo)
  const hi = shown(range.hi)
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

const MODE_WORDS: Record<string, string> = {
  'in the layers': 'in the layers',
  'layers pulled apart': 'where the layers pull apart',
  'layers sheared': 'where the layers shear',
  'layers crushed': 'where the layers are crushed',
}

function Answer({ bodyKey }: { bodyKey: string | null }) {
  const r = useFea((s) => s.result)
  useFea((s) => s.holds)
  useFea((s) => s.loads)
  const stale = staleness(bodyKey)
  const field = useFea((s) => s.field)
  const shown = useFea((s) => s.shown)
  const target = useFea((s) => s.target)
  const units = usePrefs((s) => s.units)
  if (!r) return null
  const w = r.worst
  const sf = w.safety
  const tone = sf === null ? 'idle' : sf < 1 ? 'bad' : sf < target ? 'warn' : 'ok'
  return (
    <div className="pl-card live" data-test="fea-answer">
      <Status tone={tone}>
        {sf === null ? 'No stress found' : sf < 1 ? `Breaks: safety factor ${sf}` : `Safety factor ${sf}${sf < target ? `, under the ${target} wanted` : ''}`}
      </Status>
      {stale && <Status tone="warn">Out of date: {stale}. Solve again.</Status>}
      {w.mode && (
        <p className="hint">
          Weakest {MODE_WORDS[w.mode] ?? w.mode}, at ({w.at?.join(', ')}).
        </p>
      )}
      {(w.atAHold || w.atALoad) && w.awayFromHolds && (
        <p className="hint" title="Rigid holds and point loads overstate stress right there">
          That spot is on a {w.atAHold ? 'hold' : 'load'}; away from holds and loads: {w.awayFromHolds.safety}
          {w.awayFromHolds.mode ? ` (${MODE_WORDS[w.awayFromHolds.mode] ?? w.awayFromHolds.mode})` : ''}.
        </p>
      )}
      {r.warnings?.map((x) => (
        <Status key={x} tone="warn">
          {x}
        </Status>
      ))}
      <div className="kv">
        <span className="name">Largest stress</span>
        <span>{w.vonMises} MPa</span>
      </div>
      <div className="kv">
        <span className="name">Largest movement</span>
        <span>{moveText(w.displacement, units)}</span>
      </div>
      {r.gravity && (
        <div className="kv" title={r.gravity.from === 'mass' ? 'Weighed by the Mass workspace' : 'Weighed as solid material'}>
          <span className="name">Own weight</span>
          <span>
            {r.gravity.mass} g{r.gravity.g !== 1 ? ` × ${r.gravity.g} g` : ''} · {r.gravity.weight} N
            {r.gravity.embedded ? <span className="pl-aside" title="Encased parts, carried by their pockets"> with {r.gravity.embedded} g encased</span> : null}
          </span>
        </div>
      )}
      <p className="pl-aside">
        {r.mesh.elements.toLocaleString()} elements · {fmtLen(r.mesh.size, units, 2)} · Gmsh {r.solver.gmsh ?? '?'} · CalculiX {r.solver.calculix ?? '?'}
      </p>
      <div className="toolrow">
        <select value={field} aria-label="Colour the part by" onChange={(e) => void run('show', { field: e.target.value })}>
          {FIELDS.map((f) => (
            <option key={f} value={f}>
              {fieldWords(f, units)}
            </option>
          ))}
        </select>
        <button title={shown ? 'Take the colours off' : 'Colour the part by the answer'} onClick={() => void run('show', { shown: !shown })}>
          {shown ? 'Hide' : 'Show'}
        </button>
        <button title="Take the result away" onClick={() => void run('clear', { what: 'result' })}>
          Clear
        </button>
      </div>
      {shown && <Legend field={field} target={target} />}
    </div>
  )
}

export function FeaPanel() {
  const s = useFea()
  const link = useAgentLink((x) => x.status)
  const units = usePrefs((s) => s.units)
  const busy = s.busy !== null
  const [tools, setTools] = useState<{ ready: boolean; howTo?: string; error?: string } | null>(null)
  const [bodies, setBodies] = useState<{ id: number; name: string; key: string }[]>([])
  const installed = useAssigned((x) => x.installed)
  // Loads FreeCAD's cards when a body is set to one, and draws again then.
  const { assigned } = useAssignedMaterials()
  const [target, setTarget] = useState<string | null>(null)
  // Reverse Engineer's bodies, looked at every second or two while here.
  useEffect(() => {
    let on = true
    const look = () => void listBodies().then((b) => on && setBodies(b))
    look()
    const t = setInterval(look, 1500)
    return () => {
      on = false
      clearInterval(t)
    }
  }, [])
  useEffect(() => {
    if (link !== 'connected') return
    void runCommand('fea.tools', {}).then(
      (t) => setTools(t as { ready: boolean; howTo?: string }),
      (e) => setTools({ ready: false, error: e instanceof Error ? e.message : String(e) }),
    )
  }, [link])
  const current = bodies.find((b) => s.body !== null && b.name.toLowerCase() === s.body.toLowerCase())
  const gone = s.body !== null && !current
  // The body's own material, and whether it solves as printed: in a print
  // setup, with printing figures — else solid.
  const own = current ? resolveAssignment(assigned[String(current.id)]) : null
  const printSetup = current ? setupFor(String(current.id), 'print') : null
  const ownAs = own && printSetup && !own.custom && PRINTED[own.id] ? 'printed' : 'solid'
  const upFrom = builtFor(current?.name ?? null, s.build).up
  const commitTarget = () => {
    if (target === null) return
    const v = Number(target)
    setTarget(null)
    if (v > 0 && v !== s.target) void run('setup', { target: v })
  }
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
      {tools && !tools.ready && <Status tone="warn">{tools.error ?? tools.howTo}</Status>}
      <label className="fea-row">
        <span>Body</span>
        <select value={s.body ?? ''} disabled={busy} aria-label="Body" onChange={(e) => void run('setup', { body: e.target.value })}>
          <option value="" disabled>
            {bodies.length ? 'Choose…' : 'Build one in Reverse Engineer'}
          </option>
          {gone && (
            <option value={s.body!} disabled>
              {s.body} (not there now)
            </option>
          )}
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
      {upFrom && (
        <p className="pl-aside" data-test="fea-up-from" title="Change it in the print setup on the Make tab">
          Built {upFrom.value} up, as {upFrom.setup.name} prints it
        </p>
      )}
      {installed && (
        <div className="fea-row" data-test="fea-own-material" title="Set in Reverse Engineer’s body list">
          <span>Material</span>
          {own ? (
            <span>
              {own.name} <span className="pl-aside">{ownAs}</span>
            </span>
          ) : (
            <span className="pl-aside">{current ? 'None set' : '—'}</span>
          )}
        </div>
      )}
      <label className="fea-row" title={installed ? 'For bodies with no material of their own' : undefined}>
        <span>{installed ? 'If none set' : 'Material'}</span>
        <select value={s.material} disabled={busy} aria-label={installed ? 'Material for bodies with none' : 'Material'} onChange={(e) => void run('setup', { material: e.target.value })}>
          {MATERIAL_IDS.map((m) => (
            <option key={m} value={m}>
              {MATERIALS[m].label}
            </option>
          ))}
        </select>
      </label>
      {Object.keys(s.overrides).length > 0 && (
        <p className="pl-aside">
          Your figures (MPa): {Object.entries(s.overrides).map(([k, v]) => `${k} ${v}`).join(', ')}{' '}
          <button className="x" aria-label="Back to the material’s figures" title="Back to the material’s figures" disabled={busy} onClick={() => void run('setup', { overrides: {} })}>
            ×
          </button>
        </p>
      )}
      <label className="fea-row">
        <span>Own weight</span>
        <select value={s.gravity ? (GRAVITY.find((x) => x.v.every((c, i) => Math.abs(c - s.gravity!.direction[i]) < 1e-6))?.id ?? 'custom') : 'off'} disabled={busy} aria-label="Own weight" title="The part’s weight as a load" onChange={(e) => void run('setup', { gravity: e.target.value === 'off' ? null : { direction: e.target.value } })}>
          <option value="off">Not counted</option>
          {GRAVITY.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
          {s.gravity && !GRAVITY.some((x) => x.v.every((c, i) => Math.abs(c - s.gravity!.direction[i]) < 1e-6)) && <option value="custom">Along {s.gravity.direction.map((x) => x.toFixed(2)).join(', ')}</option>}
        </select>
      </label>
      <label className="fea-row">
        <span>Mesh</span>
        <select value={s.size ? 'size' : s.fineness} disabled={busy} aria-label="Mesh" onChange={(e) => void run('setup', { fineness: e.target.value, size: null })}>
          <option value="coarse">Coarse — quick</option>
          <option value="medium">Medium</option>
          <option value="fine">Fine — slow</option>
          {s.size && <option value="size">Elements {fmtLen(s.size, units, 2)}</option>}
        </select>
      </label>
      <label className="fea-row">
        <span>Safety wanted</span>
        <input className="pl-input fea-num" type="number" min={0.1} step={0.5} value={target ?? s.target} disabled={busy} aria-label="Safety factor wanted" onChange={(e) => setTarget(e.target.value)} onBlur={commitTarget} onKeyDown={(e) => e.key === 'Enter' && commitTarget()} />
      </label>

      <div className="sec-head">Held by</div>
      {s.holds.map((h) => (
        <div key={h.name} className="kv" data-test="fea-hold">
          <span className="name">{h.name}</span>
          <span className="pl-aside">{pickWords(h)}</span>
          <button className="x" aria-label={`Remove ${h.name}`} title="Take it away" disabled={busy} onClick={() => void run('hold', { remove: h.name })}>
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
          <button className="x" aria-label={`Remove ${l.name}`} title="Take it away" disabled={busy} onClick={() => void run('load', { remove: l.name })}>
            ×
          </button>
        </div>
      ))}
      <FacesAdder kind="load" />

      <button className="primary block" disabled={busy || link !== 'connected' || (tools !== null && !tools.ready) || !s.holds.length || (!s.loads.length && !s.gravity)} data-test="fea-solve" title="Mesh and solve on your computer" onClick={() => void run('solve')}>
        Solve
      </button>
      <Busy />
      <Answer bodyKey={current?.key ?? null} />
    </div>
  )
}
