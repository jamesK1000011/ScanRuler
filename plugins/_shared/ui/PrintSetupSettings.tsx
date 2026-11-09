// SPDX-License-Identifier: AGPL-3.0-only
// A print setup's settings on the Make tab: the printer and nozzle, the way
// up, the layers, walls, infill and line width, and the printer's fit
// calibration. Each left empty leaves the workspaces on their own. Every
// change runs setup.set, as an agent would.

import { useEffect, useState } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { useLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { NumberInput } from '../../../src/ui/NumberField'
import { printerFitOf } from '../printerFit'
import type { Setup } from '../setups'

type Json = Record<string, unknown>

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
const change = (setup: Setup, settings: Json) => void runCommand('setup.set', { id: setup.id, settings }).catch(report)

const UP_WORDS: Record<string, string> = { '+z': 'Top up (+z)', '-z': 'Upside down (−z)', '+x': '+x up', '-x': '−x up', '+y': '+y up', '-y': '−y up' }
// printSetup.ts's UPS, written out: that file brings this one in.
const UPS = Object.keys(UP_WORDS)
const NOZZLES = ['0.2', '0.4', '0.6', '0.8']

/** The printer profiles Check has, when it is in the build. */
function usePrinters(): { id: string; label?: string }[] {
  const [list, setList] = useState<{ id: string; label?: string }[]>([])
  useEffect(() => {
    let live = true
    runCommand('dfm.profiles', {})
      .then((p) => live && setList(((p as Json).printers as { id: string; label?: string }[]) ?? []))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return list
}

function Choice({ label, title, value, options, onChange }: { label: string; title: string; value: unknown; options: [string, string][]; onChange(v: string | null): void }) {
  return (
    <label className="field" title={title}>
      <span>{label}</span>
      <select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Each page’s own</option>
        {options.map(([v, w]) => (
          <option key={v} value={v}>
            {w}
          </option>
        ))}
      </select>
    </label>
  )
}

function Figure({ label, title, value, length, unit, step, onCommit }: { label: string; title: string; value: unknown; length?: boolean; unit?: string; step: number; onCommit(v: number | null): void }) {
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
        placeholder="Own"
        onCommit={(v) => onCommit(v === null ? null : length ? len.fromDisplay(v) : v)}
      />
    </label>
  )
}

export function PrintSetupSettings({ setup }: { setup: Setup }) {
  const printers = usePrinters()
  const fit = printerFitOf(setup.fit)
  const set = (k: string) => (v: unknown) => change(setup, { [k]: v })
  return (
    <div className="setup-settings" data-test="print-setup-settings">
      <Choice label="Printer" title="Check’s printer profile" value={setup.printer} options={printers.map((p) => [p.id, p.label ?? p.id])} onChange={set('printer')} />
      <Choice label="Nozzle" title="The nozzle printed with" value={setup.nozzle} options={NOZZLES.map((n) => [n, n])} onChange={set('nozzle')} />
      <Choice label="Stands up" title="The way the layers stack on the bed" value={setup.up} options={UPS.map((u) => [u, UP_WORDS[u]])} onChange={set('up')} />
      <Figure label="Layer" title="The layer height printed at" value={setup.layerHeight} length step={0.04} onCommit={set('layerHeight')} />
      <Figure label="First layer" title="The first layer’s height" value={setup.firstLayer} length step={0.04} onCommit={set('firstLayer')} />
      <Figure label="Walls" title="Walls (perimeters)" value={setup.walls} unit="lines" step={1} onCommit={(v) => change(setup, { walls: v === null ? null : Math.round(v) })} />
      <Figure label="Infill" title="Infill, 0 (walls only) to 100 (solid)" value={setup.infill} unit="%" step={5} onCommit={set('infill')} />
      <Figure label="Line width" title="The extrusion line width" value={setup.lineMm} length step={0.02} onCommit={set('lineMm')} />
      <div className="field" title="What printed holes and shafts are sized by">
        <span>Fit</span>
        <span className="setup-fit">{fit ? fit.label.replace(/^printer fits from /, 'from ') : 'Fits’ calibration'}</span>
        {fit ? (
          <button className="x" title="Go back to Fits’ calibration" onClick={() => change(setup, { fit: null })}>
            ×
          </button>
        ) : (
          <button title="Keep Fits’ calibration with this setup" onClick={() => change(setup, { fit: 'fits' })}>
            Keep
          </button>
        )}
      </div>
    </div>
  )
}
