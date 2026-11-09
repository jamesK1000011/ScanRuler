// SPDX-License-Identifier: AGPL-3.0-only
// The Wear repair workspace's panel: what the part should be (its own other
// half mirrored, or a part aligned in Surface Deviation), the regions tagged
// worn or keep, the settings, the wear read, the repaired STL, and the
// pre-warp loop against a print. Every control runs the wear.* command an
// agent does, so the two go through the same code.

import { create } from 'zustand'
import { runCommand } from '../../../src/commands/registry'
import { saveFile } from '../../../src/app/exports'
import { useLength, type BoundLength } from '../../../src/app/useUnits'
import { useDeviation } from '../../../src/state/deviationStore'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { NumberField } from '../../../src/ui/NumberField'
import { Busy, Notes, Status } from '../../_shared/ui/kit'
import { useWear } from '../state/wearStore'
import { draftOf, NEW_DRAFT, nextName, referenceWords, regionOf, regionWords, symmetryAxis, verdictWords, type Draft } from './panelModel'

type Json = Record<string, unknown>
type FileOut = { name: string; mimeType: string; bytes: Uint8Array }

interface RegionRead {
  name: string
  points: number
  lost: number
  added: number
  mean: number
  rms: number
  pointsLost: number
  pointsAdded: number
}

interface DiffAnswer {
  sizeWarning?: string
  scatter?: number
  floor?: { mm: number; by: 'scatter' | 'noise' }
  scanNoise?: { sigmaMm: number; from: string }
  note?: string
  tolerance: number
  regions: RegionRead[]
}

interface RebuildAnswer {
  moved: number
  largestMoveMm: number
  before: { name: string; lost: number; added: number; pointsLost: number }[]
  after: { name: string; lost: number; added: number; pointsLost: number }[]
}

interface PrewarpAnswer {
  run: number
  rms: number
  largest: number
  unread?: number
}

/** What the panel holds between renders: the work running, the region
 *  being drawn up, and the answers last given — none of it the project's. */
export const useWearView = create<{
  busy: string | null
  draft: Draft
  placing: boolean
  plane: 'x' | 'y' | 'z'
  symmetryNote: string | null
  gain: number
  smooth: number
  diff: DiffAnswer | null
  rebuild: RebuildAnswer | null
  prewarp: PrewarpAnswer | null
}>(() => ({
  busy: null,
  draft: { ...NEW_DRAFT, name: 'Worn 1' },
  placing: false,
  plane: 'x',
  symmetryNote: null,
  gain: 1,
  smooth: 2,
  diff: null,
  rebuild: null,
  prewarp: null,
}))

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : ((e as { message?: string })?.message ?? String(e)) })

async function run(name: string, input: Json = {}, busy?: string): Promise<Json | null> {
  if (busy) useWearView.setState({ busy })
  try {
    return (await runCommand(name, JSON.parse(JSON.stringify(input)) as Json)) as Json
  } catch (e) {
    report(e)
    return null
  } finally {
    if (busy) useWearView.setState({ busy: null })
  }
}

const download = (r: Json | null) => {
  const f = r?.file as FileOut | undefined
  if (f) saveFile(f.name, new Blob([f.bytes as BlobPart], { type: f.mimeType }))
}

/** A click on the part while placing: the new region's centre. */
export function placeAt(point: [number, number, number]): boolean {
  const v = useWearView.getState()
  if (!v.placing) return false
  useWearView.setState({ placing: false, draft: { ...v.draft, centre: [point[0], point[1], point[2]] } })
  return true
}

const signed = (len: BoundLength, mm: number) => `${mm > 0 ? '+' : mm < 0 ? '−' : ''}${len.fmt(Math.abs(mm), 3)}`

function KV({ k, v, test }: { k: string; v: string; test?: string }) {
  return (
    <div className="kv" data-test={test}>
      <span className="name">{k}</span>
      <span className="pl-aside">{v}</span>
    </div>
  )
}

/** Step 1: what the part should be. */
function Reference() {
  const ref = useWear((s) => s.reference)
  const scan = useStore((s) => s.fileName)
  const refName = useDeviation((s) => s.nominalName)
  const aligned = useDeviation((s) => s.align !== null)
  const plane = useWearView((v) => v.plane)
  const symmetryNote = useWearView((v) => v.symmetryNote)
  const busy = useWearView((v) => v.busy) !== null
  const symmetry = async () => {
    const r = await run('align.symmetry', {}, 'Finding the symmetry plane…')
    // Aligning shows 3D Measure; come back here.
    await run('workspace.set', { workspace: 'wear' })
    if (!r) return
    // The alignment's note names the axis the plane's normal was turned
    // onto; read against that plane straight away when it does.
    const axis = symmetryAxis(r.note)
    if (axis) {
      useWearView.setState({ plane: axis, symmetryNote: `Aligned on its symmetry plane: the ${axis.toUpperCase()} plane.` })
      await run('wear.reference', { source: 'mirror', plane: axis })
    } else useWearView.setState({ symmetryNote: 'Aligned on its symmetry plane. Choose which plane it is.' })
  }
  return (
    <div className="group" data-test="wear-reference">
      <div className="sec-head">
        1 · What it should be
        <InfoDot title="The reference">
          <p>The surface wear is read and repaired against.</p>
          <p>
            <b>Mirror</b>: the part’s own other half, when it is symmetric and only one side is worn. Align it on its symmetry plane first, so the plane is X, Y or Z through the origin.
          </p>
          <p>
            <b>Aligned part</b>: the CAD, a scan of an unworn twin, or a catalog download, opened and aligned in Surface Deviation.
          </p>
        </InfoDot>
      </div>
      <KV k="Scan" v={scan ?? 'none'} test="wear-scan" />
      <Status tone={ref ? 'ok' : 'idle'} testId="wear-reference-now">
        {referenceWords(ref, refName)}
      </Status>
      <label className="field pl-field">
        <span>Mirror plane</span>
        <select value={plane} aria-label="Mirror plane" data-test="wear-plane" disabled={busy} onChange={(e) => useWearView.setState({ plane: e.target.value as 'x' | 'y' | 'z' })}>
          <option value="x">X plane</option>
          <option value="y">Y plane</option>
          <option value="z">Z plane</option>
        </select>
      </label>
      <div className="toolrow">
        <button data-test="wear-use-mirror" title="Read against the mirrored other half" disabled={busy || !scan} onClick={() => void run('wear.reference', { source: 'mirror', plane })}>
          Use mirror
        </button>
        <button data-test="wear-symmetry" title="Align the part on its symmetry plane first" disabled={busy || !scan} onClick={() => void symmetry()}>
          Align on symmetry
        </button>
      </div>
      {symmetryNote && <p className="hint" data-test="wear-symmetry-note">{symmetryNote}</p>}
      <KV k="Reference part" v={refName ? `${refName}${aligned ? '' : ' (not aligned)'}` : 'none'} test="wear-reference-part" />
      <div className="toolrow">
        <button data-test="wear-use-deviation" title="Read against the part aligned in Surface Deviation" disabled={busy || !aligned} onClick={() => void run('wear.reference', { source: 'deviation' })}>
          Use aligned part
        </button>
        {!aligned && (
          <button data-test="wear-to-deviation" title="Open and align a reference in Surface Deviation" onClick={() => void run('workspace.set', { workspace: 'deviation' })}>
            Open Surface Deviation
          </button>
        )}
      </div>
    </div>
  )
}

/** Step 2: the regions tagged worn, and those kept. */
function Regions({ len }: { len: BoundLength }) {
  const tags = useWear((s) => s.tags)
  const { draft, placing, busy } = useWearView()
  const scan = useStore((s) => s.fileName)
  const set = (p: Partial<Draft>) => useWearView.setState({ draft: { ...useWearView.getState().draft, ...p } })
  const setAxis = (key: 'centre' | 'size', i: number, v: number) => {
    const next = [...useWearView.getState().draft[key]] as [number, number, number]
    next[i] = v
    set(key === 'centre' ? { centre: next } : { size: next })
  }
  const add = async () => {
    const name = draft.name.trim() || nextName(tags, draft.kind)
    const r = await run('wear.tag', { action: 'set', name, kind: draft.kind, region: regionOf(draft) })
    if (r) useWearView.setState({ draft: { ...useWearView.getState().draft, name: nextName(useWear.getState().tags, draft.kind) }, diff: null, rebuild: null })
  }
  const axes = ['X', 'Y', 'Z']
  return (
    <div className="group" data-test="wear-regions">
      <div className="sec-head">
        2 · Regions
        <InfoDot title="Worn and keep">
          <p>
            <b>Worn</b>: an area to read and repair. <b>Keep</b>: never moved, such as a fit face, a datum, or a feature meant to differ from the other half.
          </p>
          <p>A region is a ball or a box in the part’s current frame. Click the part to place its centre, then size it. Tag generously and protect what matters with Keep.</p>
        </InfoDot>
      </div>
      {tags.length === 0 && <p className="hint">No regions yet.</p>}
      {tags.map((t) => (
        <div className="kv" key={t.name} data-test="wear-region">
          <span className="name" title="Edit this region" style={{ cursor: 'pointer' }} onClick={() => useWearView.setState({ draft: draftOf(t) })}>
            {t.name}
          </span>
          <span className="pl-aside">
            {t.kind === 'worn' ? 'Worn' : 'Keep'} · {regionWords(t.region, (mm) => len.fmt(mm, 2))}
          </span>
          <button className="x" title="Remove" disabled={busy !== null} onClick={() => void run('wear.tag', { action: 'remove', name: t.name })}>
            ×
          </button>
        </div>
      ))}
      <div className="pl-card" data-test="wear-draft">
        <div className="pl-cardhead">
          <span className="name">{tags.some((t) => t.name === draft.name) ? 'Change region' : 'New region'}</span>
        </div>
        <label className="field pl-field">
          <span>Name</span>
          <input key={draft.name} className="pl-input" type="text" defaultValue={draft.name} data-test="wear-draft-name" onBlur={(e) => set({ name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </label>
        <label className="field pl-field">
          <span>Kind</span>
          <select value={draft.kind} aria-label="Kind" data-test="wear-draft-kind" onChange={(e) => set({ kind: e.target.value as Draft['kind'] })}>
            <option value="worn">Worn: repair it</option>
            <option value="keep">Keep: never move it</option>
          </select>
        </label>
        <label className="field pl-field">
          <span>Shape</span>
          <select value={draft.shape} aria-label="Shape" data-test="wear-draft-shape" onChange={(e) => set({ shape: e.target.value as Draft['shape'] })}>
            <option value="sphere">Ball</option>
            <option value="box">Box</option>
          </select>
        </label>
        {draft.centre.map((c, i) => (
          <NumberField key={`c${i}`} label={`Centre ${axes[i]}`} testId={`wear-centre-${i}`} value={c} step="any" min={-Infinity} kind="length" onCommit={(v) => setAxis('centre', i, v)} />
        ))}
        {draft.shape === 'sphere' ? (
          <NumberField label="Radius" testId="wear-radius" value={draft.radius} step={0.5} min={0.01} kind="length" onCommit={(v) => set({ radius: v })} />
        ) : (
          draft.size.map((s, i) => <NumberField key={`s${i}`} label={`Size ${axes[i]}`} testId={`wear-size-${i}`} value={s} step={0.5} min={0} kind="length" onCommit={(v) => setAxis('size', i, v)} />)
        )}
        <div className="toolrow">
          <button data-test="wear-place" className={placing ? 'on' : undefined} title="Click the part to set the centre" disabled={!scan} onClick={() => useWearView.setState({ placing: !placing })}>
            {placing ? 'Click the part…' : 'Pick centre'}
          </button>
          <button className="primary" data-test="wear-tag" title="Tag this region" disabled={busy !== null} onClick={() => void add()}>
            {tags.some((t) => t.name === draft.name) ? 'Update' : 'Add'}
          </button>
        </div>
      </div>
      {tags.length > 0 && (
        <div className="toolrow">
          <button data-test="wear-clear" title="Remove every region" disabled={busy !== null} onClick={() => void run('wear.tag', { action: 'clear' })}>
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}

/** Tolerance, blend, how far the reference may be, and the mode. */
function Settings() {
  const s = useWear((st) => st.settings)
  const busy = useWearView((v) => v.busy) !== null
  const set = (p: Json) => void run('wear.settings', p).then(() => useWearView.setState({ diff: null, rebuild: null }))
  return (
    <details className="group" data-test="wear-settings">
      <summary className="sec-head">Settings</summary>
      <NumberField label="Tolerance" testId="wear-tolerance" value={s.tolerance} step={0.01} min={0.001} kind="length" disabled={busy} hint={<p>What counts as worn, and the pre-warp’s target. Keep it above about twice the scan’s scatter and three times the scan noise (Scanner noise), or scatter reads as wear.</p>} onCommit={(v) => set({ tolerance: v })} />
      <NumberField label="Blend" testId="wear-blend" value={s.blendMm} step={0.5} min={0} kind="length" disabled={busy} hint={<p>How far outside a worn region a repair fades out, so it meets the part without a step.</p>} onCommit={(v) => set({ blendMm: v })} />
      <NumberField label="Reach" testId="wear-reach" value={s.maxMm} step={0.5} min={0.01} kind="length" disabled={busy} hint={<p>How far the reference may be from a point and still be the same surface. Farther points are left alone.</p>} onCommit={(v) => set({ maxMm: v })} />
      <label className="field pl-field">
        <span>
          Repair
          <InfoDot title="Repair mode">
            <p>
              <b>Add back only</b> brings lost material back. <b>Add and trim</b> also trims what stands proud of the reference.
            </p>
          </InfoDot>
        </span>
        <select value={s.mode} aria-label="Repair mode" data-test="wear-mode" disabled={busy} onChange={(e) => set({ mode: e.target.value })}>
          <option value="add">Add back only</option>
          <option value="both">Add and trim</option>
        </select>
      </label>
    </details>
  )
}

/** Step 3: read the wear, and repair it. */
function Repair({ len }: { len: BoundLength }) {
  const { busy, diff, rebuild } = useWearView()
  const worn = useWear((s) => s.tags.some((t) => t.kind === 'worn'))
  const ref = useWear((s) => s.reference)
  const scan = useStore((s) => s.fileName)
  const ready = !!scan && !!ref && worn && busy === null
  const read = async () => {
    const r = await run('wear.diff', {}, 'Reading the wear…')
    if (r) useWearView.setState({ diff: r as unknown as DiffAnswer })
  }
  const repair = async () => {
    const r = await run('wear.rebuild', {}, 'Repairing…')
    if (r) {
      useWearView.setState({ rebuild: r as unknown as RebuildAnswer })
      download(r)
    }
  }
  const notes: { level: string; text: string }[] = []
  if (diff?.sizeWarning) notes.push({ level: 'warn', text: 'The scan may not be true size. Scale it from a length measured on the part first.' })
  if (diff?.note && diff.floor?.by === 'noise' && diff.scanNoise)
    notes.push({ level: 'warn', text: `The tolerance is under three times the scan noise (${len.fmt(diff.scanNoise.sigmaMm, 3)}, ${diff.scanNoise.from}): points past it may be noise, not wear. Raise it to about ${len.fmt(diff.floor.mm, 2)}.` })
  else if (diff?.note && diff.scatter !== undefined) notes.push({ level: 'warn', text: `The tolerance is under twice the scan’s scatter (${len.fmt(diff.scatter, 3)}): points past it may be scatter, not wear. Raise it to about ${len.fmt(2 * diff.scatter, 2)}.` })
  return (
    <div className="group" data-test="wear-repair">
      <div className="sec-head">
        3 · Read and repair
        <InfoDot title="Reading the wear">
          <p>
            Per worn region: <b>Lost</b> is how deep the scan stands in from the reference, <b>Added</b> how far it stands proud, with the RMS and how many points are past the tolerance.
          </p>
          <p>Repair moves each worn point onto the reference, fading out over the blend, never inside a Keep region, and saves the repaired part as an STL. A dent or worn face comes back; a piece broken off, with no surface left, does not: model it from the reference instead.</p>
        </InfoDot>
      </div>
      {!ready && busy === null && <p className="hint">{!scan ? 'Open the worn part as the scan.' : !ref ? 'Choose what it should be first.' : 'Tag a worn region first.'}</p>}
      <div className="toolrow">
        <button data-test="wear-diff" title="Measure the wear in each worn region" disabled={!ready} onClick={() => void read()}>
          Read wear
        </button>
        <button className="primary" data-test="wear-rebuild" title="Save the repaired part as an STL" disabled={!ready} onClick={() => void repair()}>
          Repair STL
        </button>
      </div>
      <Busy text={busy} />
      <Notes items={notes} testId="wear-notes" />
      {diff && (
        <div className="pl-card" data-test="wear-diff-result">
          <div className="pl-cardhead">
            <span className="name">Wear</span>
            {diff.scatter !== undefined && <span className="pl-aside">scatter {len.fmt(diff.scatter, 3)}</span>}
          </div>
          {diff.regions.map((r) => (
            <div key={r.name} data-test="wear-diff-region">
              <KV k={r.name} v={r.points ? `lost ${signed(len, r.lost)} · added ${signed(len, r.added)}` : 'no points near the reference'} />
              {r.points > 0 && <KV k="" v={`RMS ${len.fmt(r.rms, 3)} · ${r.pointsLost} in, ${r.pointsAdded} out of ${r.points}`} />}
            </div>
          ))}
        </div>
      )}
      {rebuild && (
        <div className="pl-card" data-test="wear-rebuild-result">
          <div className="pl-cardhead">
            <span className="name">Repaired</span>
            <span className="pl-aside">
              {rebuild.moved} points moved, up to {len.fmt(rebuild.largestMoveMm, 3)}
            </span>
          </div>
          {rebuild.before.map((b, i) => {
            const a = rebuild.after[i]
            return <KV key={b.name} k={b.name} v={`lost ${signed(len, b.lost)} → ${a ? signed(len, a.lost) : '–'}`} />
          })}
        </div>
      )}
    </div>
  )
}

/** On its own: a print pre-warped against its scan, run by run. */
function Prewarp({ len }: { len: BoundLength }) {
  const { busy, gain, smooth, prewarp } = useWearView()
  const runs = useWear((s) => s.runs)
  const tolerance = useWear((s) => s.settings.tolerance)
  const target = useDeviation((s) => s.nominalName)
  const aligned = useDeviation((s) => s.align !== null)
  const scan = useStore((s) => s.fileName)
  const verdict = verdictWords(runs, tolerance, (mm) => len.fmt(mm, 3))
  const go = async (fresh: boolean) => {
    const r = await run('wear.prewarp', { gain, smooth, ...(fresh ? { fresh: true } : {}) }, 'Pre-warping…')
    if (r) {
      useWearView.setState({ prewarp: r as unknown as PrewarpAnswer })
      download(r)
    }
  }
  return (
    <details className="group" data-test="wear-prewarp">
      <summary className="sec-head">Pre-warp a print {runs.length ? `(${runs.length})` : ''}</summary>
      <p className="hint">
        Open the target as the reference part and a scan of its print as the scan, aligned in Surface Deviation.
        <InfoDot title="Pre-warping">
          <p>For a print that keeps coming out distorted in a way slicer offsets don’t fix: warping, a curled corner, a sagging span.</p>
          <p>Each run moves the target back by the error the print shows, smoothed, and saves it as an STL. Print it, scan it, align it, and run again against the same target until it says stop.</p>
        </InfoDot>
      </p>
      <KV k="Target" v={target ?? 'none'} test="wear-target" />
      <KV k="Print" v={scan ?? 'none'} />
      <Status tone={aligned ? 'ok' : 'idle'}>{aligned ? 'Aligned' : 'Not aligned yet'}</Status>
      <NumberField label="Gain" testId="wear-gain" value={gain} step={0.1} min={0.2} unit="×" disabled={busy !== null} hint={<p>How much of the error to undo, 0.2 to 1.5. Lower it if runs overshoot.</p>} onCommit={(v) => useWearView.setState({ gain: Math.min(1.5, v) })} />
      <NumberField label="Smoothing" testId="wear-smooth" value={smooth} step={1} min={0} unit="rings" disabled={busy !== null} hint={<p>Neighbour rings the error is smoothed over, 0 to 10, so the scan’s scatter is not printed in.</p>} onCommit={(v) => useWearView.setState({ smooth: Math.min(10, Math.round(v)) })} />
      <div className="toolrow">
        <button className="primary" data-test="wear-prewarp-run" title="Save the pre-warped target as an STL" disabled={busy !== null || !aligned || !scan} onClick={() => void go(false)}>
          {runs.length ? `Run ${runs.length + 1}` : 'Pre-warp STL'}
        </button>
        {runs.length > 0 && (
          <button data-test="wear-prewarp-fresh" title="Count runs from 1 again" disabled={busy !== null || !aligned || !scan} onClick={() => void go(true)}>
            Start over
          </button>
        )}
      </div>
      {runs.length > 0 && (
        <div className="pl-card" data-test="wear-runs">
          {runs.map((r) => (
            <KV key={r.n} k={`Run ${r.n}`} v={`RMS ${len.fmt(r.rms, 3)}`} />
          ))}
          {prewarp && prewarp.run === runs.at(-1)?.n && <KV k="Largest" v={len.fmt(prewarp.largest, 3)} />}
          {prewarp?.unread ? <KV k="Not read" v={`${prewarp.unread} points beyond reach`} /> : null}
          <Status tone={verdict.stop ? 'ok' : 'warn'} testId="wear-verdict">
            {verdict.text}
          </Status>
        </div>
      )}
    </details>
  )
}

export function WearPanel() {
  const len = useLength()
  return (
    <aside className="panel" data-test="wear-panel">
      <Reference />
      <Regions len={len} />
      <Settings />
      <Repair len={len} />
      <Prewarp len={len} />
    </aside>
  )
}
