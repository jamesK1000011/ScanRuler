// SPDX-License-Identifier: AGPL-3.0-only
// The Fits tab's Calibrate from a scan page: a scanned print read against
// the CAD it was printed from (opened and aligned in Surface Deviation),
// what the print did — scale, contour and hole offsets, elephant foot — and
// what to change: slicer settings, a compensated model, and the printer's
// one calibration, the one Fits' Design page sizes holes and shafts with.
// Every control runs the fit.* command an agent does.

import { create } from 'zustand'
import { runCommand } from '../../../src/commands/registry'
import { readStateSection } from '../../../src/commands/stateSections'
import { saveFile } from '../../../src/app/exports'
import { useLength, type BoundLength } from '../../../src/app/useUnits'
import { useDeviation } from '../../../src/state/deviationStore'
import { useHistory } from '../../../src/state/historyStore'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { NumberField } from '../../../src/ui/NumberField'
import { Busy, Notes, Status, TextField } from '../../_shared/ui/kit'
import { keymaps } from '../app/fitCommands'
import { UPS } from '../core/frame'
import type { Correction, SlicerChange } from '../core/suggest'
import { useFit } from '../state/fitStore'

type Json = Record<string, unknown>
type FileOut = { name: string; mimeType: string; bytes: Uint8Array }

/** What the page holds between renders: the work running, and the answers
 *  last given — none of it the project's. */
export const useScanFitView = create<{ busy: string | null; shared: Json | null; suggest: { run: number; slicer: string; corrections: Correction[]; changes: SlicerChange[] } | null; compare: Json | null }>(() => ({
  busy: null,
  shared: null,
  suggest: null,
  compare: null,
}))

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : ((e as { message?: string })?.message ?? String(e)) })

async function run(name: string, input: Json = {}, busy?: string): Promise<Json | null> {
  if (busy) useScanFitView.setState({ busy })
  try {
    return (await runCommand(name, JSON.parse(JSON.stringify(input)) as Json)) as Json
  } catch (e) {
    report(e)
    return null
  } finally {
    if (busy) useScanFitView.setState({ busy: null })
  }
}

const download = (r: Json | null) => {
  const f = r?.file as FileOut | undefined
  if (f) saveFile(f.name, new Blob([f.bytes as BlobPart], { type: f.mimeType }))
}

const UP_WORDS: Record<string, string> = { '+z': 'Top up (+z)', '-z': 'Upside down (−z)', '+x': '+x up', '-x': '−x up', '+y': '+y up', '-y': '−y up' }
const Q_WORDS: Record<string, string> = { scaleXY: 'Scale XY', scaleZ: 'Scale Z', contour: 'Outer walls', hole: 'Holes', foot: 'Elephant foot' }
const pct = (scale: number) => `${scale >= 1 ? '+' : '−'}${Math.abs(Math.round((scale - 1) * 1e4) / 100)} %`

function KV({ k, v, test }: { k: string; v: string; test?: string }) {
  return (
    <div className="kv" data-test={test}>
      <span className="name">{k}</span>
      <span className="pl-aside">{v}</span>
    </div>
  )
}

/** The scan, the reference and the alignment fit.measure needs. */
function Parts() {
  const scan = useStore((s) => s.fileName)
  const ref = useDeviation((s) => s.nominalName)
  const aligned = useDeviation((s) => s.align !== null)
  return (
    <div className="group" data-test="scanfit-parts">
      <div className="sec-head">
        The print and its CAD
        <InfoDot title="What is read">
          <p>Open the scan of the printed part, then the CAD it was printed from in Surface Deviation, and align the two there. The reference’s flat walls, floors, holes and bosses are read on the scan.</p>
        </InfoDot>
      </div>
      <KV k="Scan" v={scan ?? 'none'} />
      <KV k="CAD" v={ref ?? 'none'} test="scanfit-reference" />
      <Status tone={aligned ? 'ok' : 'idle'} testId="scanfit-aligned">
        {aligned ? 'Aligned' : 'Not aligned yet'}
      </Status>
      {!aligned && (
        <div className="toolrow">
          <button data-test="scanfit-to-deviation" title="Open and align the CAD in Surface Deviation" onClick={() => void run('workspace.set', { workspace: 'deviation' })}>
            Align in Surface Deviation
          </button>
        </div>
      )}
    </div>
  )
}

/** What it was printed on, and with which slicer values. */
function PrintedOn() {
  const s = useFit((st) => st.settings)
  const busy = useScanFitView((v) => v.busy) !== null
  const set = (p: Json) => void run('fit.settings', p)
  return (
    <details className="group" data-test="scanfit-settings">
      <summary className="sec-head">
        Printed on: {[s.printer, s.material].filter(Boolean).join(', ') || 'not said'}
      </summary>
      <label className="field pl-field">
        <span>Stood up</span>
        <select value={s.up} aria-label="Which way stood up" data-test="scanfit-up" disabled={busy} onChange={(e) => set({ up: e.target.value })}>
          {UPS.map((u) => (
            <option key={u} value={u}>
              {UP_WORDS[u]}
            </option>
          ))}
        </select>
      </label>
      <label className="field pl-field">
        <span>Slicer</span>
        <select value={s.slicer} aria-label="Slicer" data-test="scanfit-slicer" disabled={busy} onChange={(e) => set({ slicer: e.target.value })}>
          {keymaps().map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <TextField label="Printer" value={s.printer} testId="scanfit-printer" disabled={busy} onCommit={(v) => set({ printer: v })} />
      <TextField label="Material" value={s.material} testId="scanfit-material" disabled={busy} onCommit={(v) => set({ material: v })} />
      <TextField label="Nozzle" value={s.nozzle} testId="scanfit-nozzle" disabled={busy} onCommit={(v) => set({ nozzle: v })} />
      <NumberField label="First layer" testId="scanfit-first-layer" value={s.firstLayer} step={0.05} min={0.05} kind="length" disabled={busy} hint={<p>Its height: the slab the elephant foot is read in.</p>} onCommit={(v) => set({ firstLayer: v })} />
    </details>
  )
}

/** The printer's one calibration, as Fits holds it. */
function Calibration() {
  const shared = useScanFitView((v) => v.shared)
  // Read again whenever a step is made, undone or redone: Fits' store is
  // not this page's to watch.
  useHistory((h) => h.past.length + h.future.length * 1e4 + h.revision * 1e8)
  const fits = readStateSection('fits') as { calibration?: { hole: number; shaft: number; source: string } } | undefined
  const len = useLength()
  const runs = useFit((s) => s.runs.length)
  if (!fits?.calibration) return null
  const c = fits.calibration
  const fromScan = c.source === 'print-fit'
  return (
    <div className="pl-card" data-test="scanfit-calibration">
      <div className="pl-cardhead">
        <span className="name">
          Calibration
          <InfoDot title="One calibration">
            <p>The printer has one calibration. A measured print that fits well becomes it, and Fits’ Design page sizes its holes and shafts with it. A test coupon measured there replaces it the same way.</p>
          </InfoDot>
        </span>
        <span className="pl-aside">{fromScan ? 'from a scan' : c.source}</span>
      </div>
      <KV k="Holes print small by" v={len.fmt(c.hole, 3)} />
      <KV k="Shafts print big by" v={len.fmt(c.shaft, 3)} />
      {typeof shared?.calibrationKept === 'string' && <Notes items={[{ level: 'warn', text: shared.calibrationKept }]} />}
      {!fromScan && runs > 0 && (
        <div className="toolrow">
          <button data-test="scanfit-calibrate" title="Make the last run the calibration" onClick={() => void run('fit.calibrate', { from: 'print-fit' }).then((r) => r && useScanFitView.setState({ shared: { calibration: r.calibration } }))}>
            Use the last run
          </button>
        </div>
      )}
    </div>
  )
}

/** The last run, what to change in the slicer, and the files. */
function Result({ len }: { len: BoundLength }) {
  const last = useFit((s) => s.runs.at(-1))
  const runs = useFit((s) => s.runs.length)
  const v = useScanFitView()
  if (!last) return <p className="hint">No print measured yet.</p>
  const sol = last.solution
  const tone = sol.fit > 4 ? 'bad' : sol.fit > 2 ? 'warn' : 'ok'
  const suggest = v.suggest?.run === last.n ? v.suggest : null
  return (
    <div className="group" data-test="scanfit-result">
      <div className="sec-head">
        Run {last.n}
        <InfoDot title="Reading the run">
          <p>Scale is measured over nominal. Outer walls: how far they stand out (+ too big). Holes: how far the material stands into them (+ holes too small). The fit near 1 means a scale and offsets explain the part; over 4, look for warping or a poor alignment first.</p>
        </InfoDot>
      </div>
      <Status tone={tone} testId="scanfit-fit">{`Fit ${Math.round(sol.fit * 100) / 100}${sol.fit > 4 ? ': do not trust the offsets' : ''}`}</Status>
      <KV k="Scale X / Y" v={`${pct(sol.scale.x.value)} / ${pct(sol.scale.y.value)}`} />
      <KV k="Scale Z" v={pct(sol.scale.z.value)} />
      <KV k="Outer walls" v={`${sol.contour.value >= 0 ? '+' : '−'}${len.fmt(Math.abs(sol.contour.value), 3)}${sol.contour.determined ? '' : ' (not separated)'}`} />
      <KV k="Holes" v={`${sol.hole.value >= 0 ? '+' : '−'}${len.fmt(Math.abs(sol.hole.value), 3)}${sol.hole.determined ? '' : ' (not separated)'}`} />
      {sol.foot && <KV k="Elephant foot" v={len.fmt(sol.foot.value, 3)} />}
      <div className="toolrow">
        <button data-test="scanfit-suggest" title="What to change in the slicer" disabled={v.busy !== null} onClick={() => void run('fit.suggest').then((r) => r && useScanFitView.setState({ suggest: r as never }))}>
          Slicer changes
        </button>
        <button data-test="scanfit-export" title="The changes as an .ini to paste into the slicer" disabled={v.busy !== null} onClick={() => void run('fit.export', { format: 'ini' }).then(download)}>
          Export .ini
        </button>
        <button data-test="scanfit-compensated" title="The CAD pre-distorted so the print comes out true" disabled={v.busy !== null} onClick={() => void run('fit.compensated_mesh', {}, 'Building the model…').then(download)}>
          Compensated STL
        </button>
      </div>
      {suggest && (
        <div className="pl-card" data-test="scanfit-changes">
          <div className="pl-cardhead">
            <span className="name">{suggest.slicer}</span>
          </div>
          {suggest.changes.length === 0 && <p className="hint">Nothing worth changing.</p>}
          {suggest.changes.map((c) => (
            <KV key={c.quantity} k={c.key ?? Q_WORDS[c.quantity]} v={c.to === null ? (c.note ?? 'not in this slicer') : `${c.from ?? '–'} → ${c.to}${c.unit ? ` ${c.unit}` : ''}`} />
          ))}
        </div>
      )}
      {runs >= 2 && (
        <div className="toolrow">
          <button data-test="scanfit-compare" title="Did the last change help? The last two runs" onClick={() => void run('fit.runs', { compare: true }).then((r) => r && useScanFitView.setState({ compare: r }))}>
            Compare the last two
          </button>
        </div>
      )}
      {v.compare && (
        <Notes
          testId="scanfit-compared"
          items={((v.compare.changes as { quantity: string; before: number; after: number; better: boolean }[]) ?? []).map((c) => ({ level: c.better ? 'ok' : 'warn', text: `${c.quantity}: ${c.before} → ${c.after}${c.better ? '' : ', not closer'}` }))}
        />
      )}
    </div>
  )
}

/** Correction sets kept by name. */
function Profiles() {
  const profiles = useFit((s) => s.profiles)
  const runs = useFit((s) => s.runs.length)
  return (
    <details className="group" data-test="scanfit-profiles">
      <summary className="sec-head">Profiles {profiles.length ? `(${profiles.length})` : ''}</summary>
      {profiles.map((p) => (
        <div className="kv" key={p.name}>
          <span className="name" title={[p.printer, p.material, p.nozzle].filter(Boolean).join(', ')}>
            {p.name}
          </span>
          <button title="Make its values the ones in use" onClick={() => void run('fit.profiles', { action: 'use', name: p.name })}>
            Use
          </button>
          <button className="x" title="Remove" onClick={() => void run('fit.profiles', { action: 'remove', name: p.name })}>
            ×
          </button>
        </div>
      ))}
      {runs > 0 && <TextField key={profiles.length} label="Save as" value="" placeholder="PETG on the H2D" testId="scanfit-profile-name" onCommit={(name) => name.trim() && void run('fit.profiles', { action: 'save', name: name.trim() })} />}
    </details>
  )
}

export function ScanFitPanel() {
  const len = useLength()
  const busy = useScanFitView((v) => v.busy)
  const aligned = useDeviation((s) => s.align !== null)
  const scan = useStore((s) => s.fileName)
  const measure = async () => {
    const r = await run('fit.measure', {}, 'Measuring the print…')
    if (r) useScanFitView.setState({ shared: r, suggest: null, compare: null })
  }
  return (
    <aside className="panel" data-test="scanfit-panel">
      <Parts />
      <PrintedOn />
      <div className="toolrow">
        <button className="primary" data-test="scanfit-measure" title="Read the print’s scale, offsets and foot" disabled={busy !== null || !aligned || !scan} onClick={() => void measure()}>
          Measure the print
        </button>
      </div>
      <Busy text={busy} />
      <Result len={len} />
      <Calibration />
      <Profiles />
    </aside>
  )
}
