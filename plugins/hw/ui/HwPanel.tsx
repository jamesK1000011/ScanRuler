// SPDX-License-Identifier: AGPL-3.0-only
// The Hardware workspace's panel: the hardware and its size, the body and
// face it goes in, a pattern, the plan and the cut; the hole settings; and
// a round hole checked against the table. Every control runs a hw.*
// command.

import { useState } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { readStateSections } from '../../../src/commands/stateSections'
import { useLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { NumberField } from '../../../src/ui/NumberField'
import { Status } from '../../_shared/ui/kit'
import { FITS, type Head, headsOf, type Kind, KINDS, metricOf, sizesOf } from '../core/hardware'
import { useHw } from '../state/hwStore'
import './hw.css'

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
const run = (name: string, input: Record<string, unknown> = {}) => runCommand(`hw.${name}`, input).catch(report)

const KIND_LABEL: Record<Kind, string> = { screw: 'Screw', nut: 'Nut trap', insert: 'Heat-set insert', pilot: 'Self-tapping pilot', magnet: 'Magnet', bearing: 'Bearing' }
const HEAD_LABEL: Record<Head, string> = { socket: 'Socket cap', button: 'Button', countersunk: 'Countersunk', none: 'No head' }
const ROLE_LABEL: Record<string, string> = { head: 'Head', countersink: 'Countersink', shaft: 'Shaft', nut: 'Nut', bore: 'Hole', pocket: 'Pocket', relief: 'Relief' }

type PatternKind = 'none' | 'circle' | 'rectangle' | 'grid'

interface Form {
  kind: Kind
  size: string
  head: Head
  fit: string
  through: boolean
  depth: number
  sunk: number
  slot: number
  relief: boolean
  body: string
  face: number
  pattern: PatternKind
  count: number
  circle: number
  width: number
  height: number
  countU: number
  countV: number
  stepU: number
  stepV: number
}

const bodyNames = () => (((readStateSections().reverse as { bodies?: { name: string; surface?: boolean }[] } | undefined)?.bodies) ?? []).filter((b) => !b.surface).map((b) => b.name)

function formOf(input: Record<string, unknown> | undefined): Form {
  const i = (input ?? {}) as Partial<{ kind: Kind; size: string; head: Head; fit: string; depth: number | null; sunk: number; slot: { length: number }; relief: boolean; at: { body?: unknown; face?: unknown } }> & { pattern?: Partial<{ kind: PatternKind; count: number; diameter: number; width: number; height: number; countU: number; countV: number; stepU: number; stepV: number }> }
  const p = i.pattern ?? {}
  return {
    kind: i.kind ?? 'screw',
    size: i.size ?? 'M3',
    head: i.head ?? 'socket',
    fit: i.fit ?? '',
    through: i.depth === undefined || i.depth === null,
    depth: typeof i.depth === 'number' ? i.depth : 10,
    sunk: i.sunk ?? 0,
    slot: i.slot?.length ?? 0,
    relief: i.relief !== false,
    body: typeof i.at?.body === 'string' ? i.at.body : (bodyNames()[0] ?? ''),
    face: typeof i.at?.face === 'number' ? i.at.face : 0,
    pattern: p.kind ?? 'none',
    count: p.count ?? 4,
    circle: p.diameter ?? 30,
    width: p.width ?? 30,
    height: p.height ?? 20,
    countU: p.countU ?? 3,
    countV: p.countV ?? 2,
    stepU: p.stepU ?? 10,
    stepV: p.stepV ?? 10,
  }
}

/** The panel's form as hw.plan takes it. */
function inputOf(f: Form): Record<string, unknown> {
  const deep = f.kind === 'screw' || f.kind === 'nut'
  const pattern =
    f.pattern === 'circle' ? { kind: 'circle', count: f.count, diameter: f.circle } : f.pattern === 'rectangle' ? { kind: 'rectangle', width: f.width, height: f.height } : f.pattern === 'grid' ? { kind: 'grid', countU: f.countU, countV: f.countV, stepU: f.stepU, stepV: f.stepV } : undefined
  return {
    kind: f.kind,
    size: f.size,
    ...(f.kind === 'screw' ? { head: f.head } : {}),
    ...(deep && f.fit ? { fit: f.fit } : {}),
    ...(deep ? { depth: f.through ? null : f.depth } : {}),
    ...(f.kind === 'nut' ? { sunk: f.sunk, ...(f.slot > 0 ? { slot: { length: f.slot } } : {}) } : {}),
    ...(f.kind === 'bearing' ? { relief: f.relief } : {}),
    at: { body: f.body, face: f.face },
    ...(pattern ? { pattern } : {}),
  }
}

export function HwPanel() {
  const s = useHw()
  const len = useLength()
  const busy = s.busy !== null
  const [f, setF] = useState<Form>(() => formOf(s.plan?.input))
  const [checkFace, setCheckFace] = useState(0)
  const put = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }))
  const sizes = sizesOf(f.kind)
  const metric = metricOf(f.size)
  const heads = metric ? headsOf(metric) : []
  const bodies = bodyNames()
  const plan = s.plan
  return (
    <div className="group" data-test="hw-panel">
      <div className="sec-head">
        Hardware
        <InfoDot title="Hardware">
          <p>Holes for screws, nuts, inserts, magnets and bearings, sized from the standards with an allowance for printing, cut into a Reverse Engineer body as features you can still edit.</p>
        </InfoDot>
      </div>
      <label className="hw-row">
        <span>Kind</span>
        <select value={f.kind} aria-label="Kind" data-test="hw-kind" onChange={(e) => {
          const kind = e.target.value as Kind
          put({ kind, size: sizesOf(kind).includes(f.size) ? f.size : sizesOf(kind)[Math.min(2, sizesOf(kind).length - 1)] })
        }}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="hw-row">
        <span>Size</span>
        <select value={f.size} aria-label="Size" data-test="hw-size" onChange={(e) => put({ size: e.target.value })}>
          {sizes.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>
      {f.kind === 'screw' && (
        <label className="hw-row">
          <span>Head</span>
          <select value={heads.includes(f.head) ? f.head : 'socket'} aria-label="Head" onChange={(e) => put({ head: e.target.value as Head })}>
            {heads.map((h) => (
              <option key={h} value={h}>
                {HEAD_LABEL[h]}
              </option>
            ))}
          </select>
        </label>
      )}
      {(f.kind === 'screw' || f.kind === 'nut') && (
        <>
          <label className="hw-row">
            <span>Clearance</span>
            <select value={f.fit} aria-label="Clearance class" onChange={(e) => put({ fit: e.target.value })}>
              <option value="">As set ({s.fit})</option>
              {FITS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label className="hw-row">
            <span>Through</span>
            <input type="checkbox" aria-label="Through" checked={f.through} onChange={(e) => put({ through: e.target.checked })} />
          </label>
          {!f.through && <NumberField label="Depth" kind="length" value={f.depth} step={0.5} min={0.1} onCommit={(v) => put({ depth: v })} />}
        </>
      )}
      {f.kind === 'nut' && (
        <>
          <NumberField label="Sunk" kind="length" value={f.sunk} step={0.5} min={0} hint={<p>How deep the nut’s near face sits; 0 opens the trap at the surface.</p>} onCommit={(v) => put({ sunk: v })} />
          <NumberField label="Side slot" kind="length" value={f.slot} step={1} min={0} hint={<p>From the nut’s centre to the part’s side; 0 for none.</p>} onCommit={(v) => put({ slot: v })} />
        </>
      )}
      {f.kind === 'bearing' && (
        <label className="hw-row">
          <span>Relief</span>
          <input type="checkbox" aria-label="Relief behind the bearing" checked={f.relief} onChange={(e) => put({ relief: e.target.checked })} />
        </label>
      )}

      <div className="sec-head">Where</div>
      <label className="hw-row">
        <span>Body</span>
        <input className="pl-input" list="hw-bodies" aria-label="Body" value={f.body} onChange={(e) => put({ body: e.target.value })} />
        <datalist id="hw-bodies">
          {bodies.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </label>
      <label className="hw-row">
        <span>Face</span>
        <input className="pl-input" type="number" min={0} step={1} aria-label="Face index" title="The flat face’s index, as Reverse Engineer lists it" value={f.face} onChange={(e) => put({ face: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
      </label>
      <label className="hw-row">
        <span>Pattern</span>
        <select value={f.pattern} aria-label="Pattern" onChange={(e) => put({ pattern: e.target.value as PatternKind })}>
          <option value="none">One hole</option>
          <option value="circle">Bolt circle</option>
          <option value="rectangle">Rectangle</option>
          <option value="grid">Grid</option>
        </select>
      </label>
      {f.pattern === 'circle' && (
        <>
          <NumberField label="Holes" unit="" value={f.count} step={1} min={2} onCommit={(v) => put({ count: Math.round(v) })} />
          <NumberField label="Circle" kind="length" value={f.circle} step={1} min={0.1} onCommit={(v) => put({ circle: v })} />
        </>
      )}
      {f.pattern === 'rectangle' && (
        <>
          <NumberField label="Width" kind="length" value={f.width} step={1} min={0.1} onCommit={(v) => put({ width: v })} />
          <NumberField label="Height" kind="length" value={f.height} step={1} min={0.1} onCommit={(v) => put({ height: v })} />
        </>
      )}
      {f.pattern === 'grid' && (
        <>
          <NumberField label="Across" unit="" value={f.countU} step={1} min={1} onCommit={(v) => put({ countU: Math.round(v) })} />
          <NumberField label="Up" unit="" value={f.countV} step={1} min={1} onCommit={(v) => put({ countV: Math.round(v) })} />
          <NumberField label="Step across" kind="length" value={f.stepU} step={1} min={0.1} onCommit={(v) => put({ stepU: v })} />
          <NumberField label="Step up" kind="length" value={f.stepV} step={1} min={0.1} onCommit={(v) => put({ stepV: v })} />
        </>
      )}
      <div className="toolrow">
        <button disabled={busy || !f.body} data-test="hw-plan" title="Work out the hole without cutting it" onClick={() => void run(f.pattern === 'none' ? 'plan' : 'pattern', inputOf(f))}>
          Plan
        </button>
        <button className="primary" disabled={busy || !plan} data-test="hw-apply" title="Cut the planned hole into the body" onClick={() => void run('apply')}>
          {busy ? s.busy : 'Cut'}
        </button>
      </div>
      {plan && (
        <div className="pl-card live" data-test="hw-plan-card">
          <div className="kv">
            <span className="name">{plan.label}</span>
            <span className="pl-aside">{plan.centres.length > 1 ? `${plan.centres.length} holes` : ''}</span>
          </div>
          {plan.stale && <Status tone="warn">Settings changed: Cut plans it again with them.</Status>}
          {(plan.steps as { role: string; profile: string; diameter: number; from: number; to: number | 'through'; draftDeg?: number; teardrop?: boolean }[]).map((st, i) => (
            <div key={i} className="kv">
              <span className="pl-aside">{ROLE_LABEL[st.role] ?? st.role}</span>
              <span className="pl-aside">
                {st.profile === 'circle' ? `Ø${len.fmt(st.diameter, 2)}` : `${len.fmt(st.diameter, 2)} across flats`}
                {st.draftDeg ? ' 90° cone' : ''}
                {st.teardrop ? ', teardrop' : ''} — {st.to === 'through' ? 'through' : `to ${len.fmt(st.to, 2)}`}
              </span>
            </div>
          ))}
        </div>
      )}
      {s.made && <Status tone="ok">{`${s.made.label} cut into ${s.made.body}: ${s.made.features.length} features.`}</Status>}

      <details className="hw-settings">
        <summary>Settings</summary>
        {KINDS.map((k) => (
          <NumberField key={k} label={`${KIND_LABEL[k]} allowance`} kind="length" value={s.allowance[k]} step={0.05} min={-1} hint={<p>Added to the diameter: printed holes come out small.</p>} onCommit={(v) => void run('set', { allowance: { [k]: v } })} />
        ))}
        <label className="hw-row">
          <span>Clearance</span>
          <select value={s.fit} aria-label="Default clearance class" onChange={(e) => void run('set', { fit: e.target.value })}>
            {FITS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <NumberField label="Head margin" kind="length" value={s.headMargin} step={0.1} min={0} hint={<p>Counterbore over the head’s diameter.</p>} onCommit={(v) => void run('set', { headMargin: v })} />
        <NumberField label="Head sink" kind="length" value={s.headSink} step={0.1} min={0} hint={<p>How far the head sits below the surface.</p>} onCommit={(v) => void run('set', { headSink: v })} />
        <NumberField label="Bridge layer" kind="length" value={s.bridgeLayer} step={0.05} min={0} hint={<p>A layer left at each step of an upright hole to print over, pushed through after; 0 for none.</p>} onCommit={(v) => void run('set', { bridgeLayer: v })} />
        <NumberField label="Insert extra" kind="length" value={s.insertExtra} step={0.1} min={0} hint={<p>Hole depth past the insert’s length.</p>} onCommit={(v) => void run('set', { insertExtra: v })} />
        <NumberField label="Magnet extra" kind="length" value={s.magnetExtra} step={0.1} min={0} hint={<p>Pocket depth past the magnet.</p>} onCommit={(v) => void run('set', { magnetExtra: v })} />
        <label className="hw-row">
          <span>Teardrop</span>
          <input type="checkbox" aria-label="Teardrop level holes" checked={s.teardrop} onChange={(e) => void run('set', { teardrop: e.target.checked })} />
        </label>
        <button title="Back to the default settings" onClick={() => void run('set', { reset: true })}>
          Defaults
        </button>
      </details>

      <div className="sec-head">Check a hole</div>
      <div className="toolrow">
        <input className="pl-input" type="number" min={0} step={1} aria-label="Round face index" title="A round hole’s face index on the body above" value={checkFace} onChange={(e) => setCheckFace(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
        <button disabled={busy || !f.body} data-test="hw-check" title="Say what this hole fits" onClick={() => void run('check', { body: f.body, face: checkFace })}>
          Check
        </button>
      </div>
      {s.check && (
        <div className="pl-card live" data-test="hw-check-card">
          <div className="kv">
            <span className="name">Ø{len.fmt(s.check.diameter, 2)}</span>
            <span className="pl-aside">{s.check.depth !== undefined ? `${len.fmt(s.check.depth, 1)} deep` : ''}</span>
          </div>
          {s.check.matches.length === 0 && <p className="hint">Nothing in the table fits it closely.</p>}
          {s.check.matches.slice(0, 6).map((m, i) => (
            <div key={i} className="kv">
              <span className="pl-aside">
                {m.size} {m.role}
              </span>
              <span className="pl-aside">
                {m.fit}
                {m.shallow ? ' (shallow)' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
