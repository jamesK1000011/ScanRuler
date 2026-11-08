// SPDX-License-Identifier: AGPL-3.0-only
// thread-match's section of the 3D Measure panel: a cylinder fitted in a
// threaded bore or on a boss, named against the standards — or the sizes
// this scan can't tell apart and what to measure by hand to settle it; a
// size looked up by name; and which families to try. Every control runs a
// thread.* command, the same ones the readout and the browser checks use.

import { useState } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { useLength, type BoundLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { NumberField } from '../../../src/ui/NumberField'
import { Status } from '../../_shared/ui/kit'
import { FAMILIES, type Family } from '../core/tables'
import { useThreadMatch } from '../state/threadStore'
import './thread.css'

type Json = Record<string, unknown>
const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
const run = (name: string, input: Json = {}) => runCommand(`thread.${name}`, input)

/** thread.identify's answer, as far as the section reads it. */
export interface IdentifyAnswer {
  verdict: 'match' | 'ambiguous' | 'none'
  confidence?: 'high' | 'low'
  best?: { designation: string; form: string; major: number; pitch: number; tpi?: number; taper: string; source: string; note?: string } | null
  tied?: string[]
  deciding?: { measure: string; expect: { designation: string; value: string }[]; separation: string }[]
  ruledOut?: { designation: string; by: string[] }[]
  reads?: { pitch: number; major: number | null; minor: number | null; internal: boolean | null; leftHanded: boolean | null; starts?: number }
  canModel?: boolean
  note: string
  sizeWarning?: string
}

/** thread.lookup's answer. */
export interface LookupAnswer {
  designation: string
  form: string
  major: number
  pitch: number
  tpi?: number
  minorExternal: number
  minorInternal: number
  angle: number
  taper: string
  source: string
  tapDrillApprox: number
  canModel: boolean
  note?: string
}

/** A pitch as the family names it: threads per inch for the inch sizes. */
const pitchText = (len: BoundLength, pitch: number, tpi?: number) => (tpi ? `${tpi} per inch` : len.fmt(pitch, 3))

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="kv">
      <span className="pl-aside">{k}</span>
      <span className="pl-aside">{v}</span>
    </div>
  )
}

function Answer({ a }: { a: IdentifyAnswer }) {
  const len = useLength()
  const what = a.reads?.internal === true ? 'Bore' : a.reads?.internal === false ? 'Boss' : 'Thread'
  return (
    <div className="pl-card live" data-test="thread-answer">
      {a.verdict === 'match' && a.best && (
        <>
          <div className="kv">
            <span className="name" data-test="thread-best">
              {a.best.designation}
            </span>
            <span className="pl-aside">{`${a.confidence ?? 'low'} confidence`}</span>
          </div>
          <Kv k="Form" v={a.best.form} />
          <Kv k="Major Ø" v={len.fmt(a.best.major, 2)} />
          <Kv k="Pitch" v={pitchText(len, a.best.pitch, a.best.tpi)} />
          {a.best.taper !== 'parallel' && <Kv k="Taper" v={a.best.taper} />}
          {a.best.note && <p className="hint">{a.best.note}</p>}
        </>
      )}
      {a.verdict === 'ambiguous' && (
        <>
          <Status tone="warn" testId="thread-tied">{`Can't tell apart: ${(a.tied ?? []).join(', ')}`}</Status>
          {(a.deciding ?? []).slice(0, 2).map((d, i) => (
            <div key={i} className="thread-decide">
              <p className="hint">
                {i === 0 ? <b>To settle it: </b> : <b>Or: </b>}
                {d.measure}.
              </p>
              {d.expect.map((e) => (
                <Kv key={e.designation} k={e.designation} v={e.value} />
              ))}
            </div>
          ))}
        </>
      )}
      {a.verdict === 'none' && <Status tone="idle" testId="thread-none">{a.note}</Status>}
      {a.reads && (
        <>
          <Kv k={`${what} reads`} v={`${a.reads.major !== null ? `Ø${len.fmt(a.reads.major, 2)}, ` : ''}pitch ${len.fmt(a.reads.pitch, 3)}`} />
          {a.reads.leftHanded && <Kv k="Hand" v="Left" />}
          {a.reads.starts !== undefined && a.reads.starts > 1 && <Kv k="Starts" v={String(a.reads.starts)} />}
        </>
      )}
      {(a.ruledOut ?? []).map((r) => (
        <p key={r.designation} className="hint">
          {`${r.designation} fits by size too; set aside by ${r.by.join(', ')}.`}
        </p>
      ))}
      {a.sizeWarning && <Status tone="warn">{a.sizeWarning}</Status>}
    </div>
  )
}

function Lookup() {
  const len = useLength()
  const [text, setText] = useState('')
  const [row, setRow] = useState<LookupAnswer | null>(null)
  const [miss, setMiss] = useState<string | null>(null)
  const go = () => {
    if (!text.trim()) return
    run('lookup', { designation: text.trim() })
      .then((r) => {
        setRow(r as LookupAnswer)
        setMiss(null)
      })
      .catch((e: unknown) => {
        setRow(null)
        setMiss(e instanceof Error ? e.message : String(e))
      })
  }
  return (
    <>
      <div className="toolrow">
        <input
          type="text"
          aria-label="Thread size"
          placeholder="M6x1, 1/4-20 UNC, G 1/2"
          data-test="thread-lookup-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
        />
        <button data-test="thread-lookup" disabled={!text.trim()} title="Show a thread size's dimensions" onClick={go}>
          Look up
        </button>
      </div>
      {miss && <Status tone="bad">{miss}</Status>}
      {row && (
        <div className="pl-card" data-test="thread-lookup-card">
          <div className="kv">
            <span className="name">{row.designation}</span>
            <span className="pl-aside">{row.form}</span>
          </div>
          <Kv k="Major Ø" v={len.fmt(row.major, 3)} />
          <Kv k="Pitch" v={pitchText(len, row.pitch, row.tpi)} />
          <Kv k="Minor Ø, bolt" v={len.fmt(row.minorExternal, 3)} />
          <Kv k="Minor Ø, nut" v={len.fmt(row.minorInternal, 3)} />
          <Kv k="Tap drill, about" v={len.fmt(row.tapDrillApprox, 1)} />
          <Kv k="Flank angle" v={`${row.angle}°`} />
          {row.taper !== 'parallel' && <Kv k="Taper" v={row.taper} />}
          <Kv k="Standard" v={row.source} />
          {row.note && <p className="hint">{row.note}</p>}
        </div>
      )}
    </>
  )
}

function Settings() {
  const families = useThreadMatch((s) => s.families)
  const pitchFloor = useThreadMatch((s) => s.pitchFloor)
  const toggle = (id: Family, on: boolean) => {
    const next = on ? [...families, id] : families.filter((f) => f !== id)
    if (next.length) void run('settings', { families: FAMILIES.map((f) => f.id).filter((f) => next.includes(f)) }).catch(report)
  }
  return (
    <details className="thread-settings">
      <summary>Families and settings</summary>
      {FAMILIES.map((f) => (
        <label key={f.id} className="checkrow">
          <input type="checkbox" data-test={`thread-family-${f.id}`} checked={families.includes(f.id)} disabled={families.length === 1 && families.includes(f.id)} onChange={(e) => toggle(f.id, e.target.checked)} />
          <span>{f.label}</span>
        </label>
      ))}
      <NumberField
        label="Pitch floor"
        unit="%"
        value={Math.round(pitchFloor * 1000) / 10}
        step={0.1}
        min={0.2}
        testId="thread-pitch-floor"
        hint={<p>The least share of the pitch a size is told apart by — how true your scanner's scale is. Raise it for a scanner you trust less.</p>}
        onCommit={(v) => void run('settings', { pitchFloor: Math.min(5, Math.max(0.2, v)) / 100 }).catch(report)}
      />
      <div className="toolrow">
        <button title="Every family, default pitch floor" onClick={() => void run('settings', { reset: true }).catch(report)}>
          Reset
        </button>
      </div>
    </details>
  )
}

export function ThreadSection() {
  const fileName = useStore((s) => s.fileName)
  const busy = useStore((s) => s.busy)
  const elements = useStore((s) => s.elements)
  const cylinders = elements.filter((e) => e.kind === 'cylinder' && e.fit && e.status === 'done')
  const [picked, setPicked] = useState<number | null>(null)
  const [working, setWorking] = useState(false)
  const [answer, setAnswer] = useState<{ id: number; a: IdentifyAnswer } | null>(null)
  const id = cylinders.some((c) => c.id === picked) ? picked : (cylinders.at(-1)?.id ?? null)
  const identify = () => {
    if (id === null) return
    setWorking(true)
    run('identify', { axis: { kind: 'element', id } })
      .then((r) => setAnswer({ id, a: r as IdentifyAnswer }))
      .catch(report)
      .finally(() => setWorking(false))
  }
  const shown = answer && cylinders.some((c) => c.id === answer.id) ? answer : null
  return (
    <div className="group" data-test="thread-section">
      <div className="sec-head">
        Thread
        <InfoDot title="Naming a scanned thread">
          <p>
            Fit a <b>cylinder</b> in the threaded bore or on the boss, then <b>Identify</b>: the pitch, the diameter, the flank angle and the taper are
            read off the scan and matched against ISO metric, UNC, UNF, UNEF, NPT, G and R pipe threads, trapezoidal, ACME and the 3D-printing 45° form.
          </p>
          <p>
            When two sizes fit the scan equally well, it says so and names the one measurement — over ten crests, across the crests, or with a thread
            gauge — that tells them apart, with what each would read.
          </p>
          <p>A scan reads diameters a little small; a match within tolerance is normal.</p>
        </InfoDot>
      </div>
      {fileName && cylinders.length === 0 && <p className="hint">Fit a cylinder in the threaded bore or on the boss to name its thread.</p>}
      {fileName && cylinders.length > 0 && (
        <>
          <label className="field">
            <span>Cylinder</span>
            <select data-test="thread-cylinder" value={id ?? ''} onChange={(e) => setPicked(Number(e.target.value))}>
              {cylinders.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="toolrow">
            <button className="primary" data-test="thread-identify" disabled={busy || working || id === null} title="Name the thread on this cylinder" onClick={identify}>
              {working ? 'Reading…' : 'Identify'}
            </button>
          </div>
          {shown && shown.id === id && <Answer a={shown.a} />}
        </>
      )}
      <Lookup />
      <Settings />
    </div>
  )
}
