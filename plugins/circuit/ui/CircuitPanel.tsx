// SPDX-License-Identifier: AGPL-3.0-only
// The Circuit workspace's panel: tscircuit on this computer, the project and
// its build, the board read in and its figures, the resistance estimate,
// and the solids. Every control runs a circuit.* command.

import { useRef, useState } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { useStore } from '../../../src/state/store'
import { useLength } from '../../../src/app/useUnits'
import { InfoDot } from '../../../src/ui/InfoDot'
import { NumberField } from '../../../src/ui/NumberField'
import { Status, TextField } from '../../_shared/ui/kit'
import { CONDUCTORS, conductorOf } from '../core/resistance'
import { useCircuit, type PartsOn } from '../state/circuitStore'
import './circuit.css'

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
const run = (name: string, input: Record<string, unknown> = {}) => runCommand(`circuit.${name}`, input).catch(report)

const TEMPLATES: [string, string][] = [
  ['blank', 'Blank board'],
  ['led', 'LED and resistor'],
  ['pico_carrier', 'Pico (RP2040) carrier'],
  ['esp32_carrier', 'ESP32 DevKitC carrier'],
  ['enclosure', 'Fit an enclosure'],
]
const OUTPUTS: [string, string, string][] = [
  ['gerbers', 'Gerbers', 'The fabrication zip'],
  ['bom', 'BOM', 'bom.csv'],
  ['pnp', 'Pick and place', 'pick_and_place.csv'],
  ['kicad_pcb', 'KiCad', '.kicad_pcb, for KiCad or the Boards workspace'],
  ['step', 'STEP', 'The board with its parts, as tscircuit models them'],
  ['glb', 'GLB', '3D view'],
]
const PARTS: [keyof PartsOn, string, string][] = [
  ['board', 'Board', 'The outline at its thickness, holes cut'],
  ['copperTop', 'Copper top', 'On the top face'],
  ['copperBottom', 'Copper bottom', 'Under the bottom face'],
  ['keepouts', 'Keep-outs', 'A box over each part'],
]

const ohms = (x: number) => (x >= 1e3 ? `${(x / 1e3).toPrecision(3)} kΩ` : x >= 1 ? `${x.toPrecision(3)} Ω` : `${(x * 1e3).toPrecision(3)} mΩ`)

export function CircuitPanel() {
  const s = useCircuit()
  const len = useLength()
  const [name, setName] = useState('my-board')
  const [template, setTemplate] = useState('led')
  const [fromBox, setFromBox] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [outputs, setOutputs] = useState<string[]>(['gerbers', 'bom', 'pnp', 'kicad_pcb'])
  const st = s.loaded?.stats
  const cond = conductorOf(s.settings.conductor) ?? CONDUCTORS[0]
  const openFile = async (f: File | undefined) => {
    if (!f) return
    void run('open', { json: await f.text(), name: f.name })
  }
  return (
    <div className="group" data-test="circuit-panel">
      <div className="sec-head">
        Circuit
        <InfoDot title="Circuit">
          <p>Boards written as code with tscircuit, built on this computer through the agent connection, and brought into Reverse Engineer as solids.</p>
        </InfoDot>
      </div>

      <div className="circuit-row">
        <span>tscircuit</span>
        <span className="pl-aside" data-test="circuit-tools">
          {!s.tools.checked ? 'Not checked' : s.tools.ready ? `tsci ${s.tools.version ?? ''}` : 'Not installed'}
        </span>
        <button disabled={s.busy} title="Look for tsci on this computer" onClick={() => void run('tools')}>
          Check
        </button>
      </div>
      {s.tools.checked && !s.tools.ready && s.tools.howTo && <Status tone="warn">{s.tools.howTo}</Status>}

      <div className="sec-head">Project</div>
      <TextField label="Folder" value={s.project.folder ?? ''} placeholder="Name or folder" testId="circuit-folder" disabled={s.busy} onCommit={(v) => v.trim() && void run('set', { project: v.trim() })} />
      <label className="circuit-row" title="Template for a new project">
        <span>New</span>
        <select value={template} aria-label="Template" data-test="circuit-template" onChange={(e) => setTemplate(e.target.value)}>
          {TEMPLATES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="circuit-row" title="Folder name for the new project">
        <span>Name</span>
        <input className="pl-input" value={name} aria-label="Project name" data-test="circuit-name" onChange={(e) => setName(e.target.value)} />
      </label>
      {template === 'enclosure' && (
        <label className="checkrow" title="Size and bosses from Generate’s project box">
          <input type="checkbox" checked={fromBox} onChange={(e) => setFromBox(e.target.checked)} /> From Generate’s box
        </label>
      )}
      <div className="toolrow">
        <button disabled={s.busy || !name.trim()} data-test="circuit-new" title="Make the project folder" onClick={() => void run('new', { name: name.trim(), template, ...(template === 'enclosure' && fromBox ? { fromBox: true } : {}) })}>
          Make project
        </button>
      </div>
      <div className="circuit-outputs">
        {OUTPUTS.map(([id, label, tip]) => (
          <label key={id} className="checkrow" title={tip}>
            <input type="checkbox" checked={outputs.includes(id)} onChange={(e) => setOutputs(e.target.checked ? [...outputs, id] : outputs.filter((x) => x !== id))} /> {label}
          </label>
        ))}
      </div>
      <div className="toolrow">
        <button className="primary" disabled={s.busy || !s.project.folder} data-test="circuit-build" title="Build with tsci, then open the board" onClick={() => void run('build', { outputs })}>
          {s.busy ? s.status || 'Working…' : 'Build'}
        </button>
        {s.busy && <button onClick={() => void run('stop')}>Stop</button>}
      </div>
      {s.lastBuild && (
        <div className="pl-card live" data-test="circuit-last-build">
          <div className="kv">
            <span className="name">{s.lastBuild.ok ? 'Built' : 'Failed'}</span>
            <span className="pl-aside">{s.lastBuild.job}</span>
          </div>
          <p className="hint">{s.lastBuild.files.join(', ') || 'No files'}</p>
          {s.lastBuild.failed.length > 0 && <Status tone="warn">Not exported: {s.lastBuild.failed.join(', ')}</Status>}
          {s.lastBuild.errors.slice(0, 5).map((e, i) => (
            <p key={i} className="hint circuit-error">
              {e.message || e.type}
            </p>
          ))}
          {s.lastBuild.errors.length > 5 && <p className="hint">and {s.lastBuild.errors.length - 5} more</p>}
        </div>
      )}

      <div className="sec-head">Board</div>
      <div className="toolrow">
        <button disabled={s.busy} title="Open a circuit.json file" onClick={() => fileInput.current?.click()}>
          Open file…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          data-test="circuit-file"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            void openFile(f)
          }}
        />
        <button disabled={s.busy || !s.lastBuild?.ok} title="Open the last build’s board" onClick={() => s.lastBuild && void run('open', { job: s.lastBuild.job })}>
          Open build
        </button>
        {s.loaded && (
          <button disabled={s.busy} title="Put the board away" onClick={() => void run('clear')}>
            Close
          </button>
        )}
      </div>
      {s.loaded && st && (
        <div className="pl-card live" data-test="circuit-stats">
          <div className="kv">
            <span className="name">{s.loaded.name}</span>
          </div>
          {st.board && (
            <div className="kv">
              <span>Size</span>
              <span className="pl-aside">
                {len.fmt(st.board.width, 1)} × {len.fmt(st.board.height, 1)} × {len.fmt(st.board.thickness, 2)}
              </span>
            </div>
          )}
          <div className="kv">
            <span>Layers</span>
            <span className="pl-aside">
              {st.layers.declared ?? '?'} ({st.layers.withCopper.join(', ') || 'no copper'})
            </span>
          </div>
          <div className="kv">
            <span>Traces</span>
            <span className="pl-aside">
              {st.traces.count}, {len.fmt(st.traces.length, 1)}
            </span>
          </div>
          {st.traces.minWidth !== null && (
            <div className="kv">
              <span>Narrowest</span>
              <span className="pl-aside">{len.fmt(st.traces.minWidth, 3)}</span>
            </div>
          )}
          {st.minClearance && (
            <div className="kv" title={`${st.minClearance.a.ref} to ${st.minClearance.b.ref}, ${st.minClearance.layer}`}>
              <span>Clearance</span>
              <span className="pl-aside">{len.fmt(st.minClearance.mm, 3)}</span>
            </div>
          )}
          <div className="kv">
            <span>Nets, vias, holes</span>
            <span className="pl-aside">
              {st.nets}, {st.vias}, {st.holes + st.platedHoles}
            </span>
          </div>
          {s.loaded.board.problems.length > 0 && <Status tone="warn">{s.loaded.board.problems.length} elements did not read and were left out.</Status>}
          {s.loaded.board.errors.length > 0 && <Status tone="bad">{s.loaded.board.errors.length} build errors in the file.</Status>}
        </div>
      )}

      <div className="sec-head">
        Resistance
        <InfoDot title="Resistance">
          <p>{cond.source}</p>
        </InfoDot>
      </div>
      <label className="circuit-row" title="What the traces are made of">
        <span>Conductor</span>
        <select value={s.settings.conductor} aria-label="Conductor" data-test="circuit-conductor" disabled={s.busy} onChange={(e) => void run('set', { conductor: e.target.value })}>
          {CONDUCTORS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
              {c.typical ? ' (typical)' : ''}
            </option>
          ))}
        </select>
      </label>
      <NumberField label="Trace thickness" testId="circuit-thickness" value={s.settings.thickness ?? cond.thickness} step={0.005} min={0} kind="length" disabled={s.busy} hint={<p>Copper weight or printed height</p>} onCommit={(v) => void run('set', { thickness: v })} />
      <div className="toolrow">
        <button disabled={s.busy || !s.loaded} data-test="circuit-resistance" title="Estimate each net’s resistance" onClick={() => void run('resistance')}>
          Estimate
        </button>
      </div>
      {s.resistance && (
        <div className="pl-card live" data-test="circuit-ohms">
          {s.resistance.nets.slice(0, 8).map((n) => (
            <div key={n.net} className="kv" title={n.joins.join(', ')}>
              <span>
                Net {n.net + 1} ({n.traces.length})
              </span>
              <span className="pl-aside">
                {len.fmt(n.length, 1)}, {ohms(n.seriesOhms)}
              </span>
            </div>
          ))}
          {s.resistance.nets.length > 8 && <p className="hint">and {s.resistance.nets.length - 8} more nets</p>}
        </div>
      )}

      <div className="sec-head">Solids</div>
      {PARTS.map(([k, label, tip]) => (
        <label key={k} className="checkrow" title={tip}>
          <input type="checkbox" disabled={s.busy} checked={s.settings.parts[k]} onChange={(e) => void run('set', { parts: { [k]: e.target.checked } })} /> {label}
        </label>
      ))}
      <NumberField label="Copper" testId="circuit-copper" value={s.settings.copper} step={0.005} min={0.001} kind="length" disabled={s.busy} hint={<p>Thickness of the copper solids</p>} onCommit={(v) => v > 0 && void run('set', { copper: v })} />
      <NumberField label="Keep-out height" testId="circuit-keepout" value={s.settings.keepoutHeight} step={0.5} min={0.1} kind="length" disabled={s.busy} hint={<p>Where the file gives no part height</p>} onCommit={(v) => v > 0 && void run('set', { keepoutHeight: v })} />
      <div className="toolrow">
        <button className="primary" disabled={s.busy || !s.loaded} data-test="circuit-bodies" title="Bring the board into Reverse Engineer" onClick={() => void run('bodies')}>
          Into Reverse Engineer
        </button>
      </div>
      {s.made && (
        <div className="pl-card live" data-test="circuit-made">
          {s.made.parts.map((p, i) => (
            <div key={i} className="kv">
              <span className="name">{s.made?.bodies[i] ?? p.name}</span>
              <span className="pl-aside">{len.vol(p.volume, 2)}</span>
            </div>
          ))}
          {s.made.notes.map((n, i) => (
            <p key={i} className="hint">
              {n}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
