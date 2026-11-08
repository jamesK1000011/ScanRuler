// SPDX-License-Identifier: AGPL-3.0-only
// The Fits workspace's panel: the printer (tolerance, material,
// calibration), then one tool at a time — a hole and shaft pair, a snap-fit
// hook, a hinge, a pin and socket, the test coupon, a tolerance stack —
// each field running its fit.* command, the answer under it. Every control
// runs a fit.* command.

import { useState, type ReactNode } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { useLength, type BoundLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { NumberField } from '../../../src/ui/NumberField'
import { Notes, Status } from '../../_shared/ui/kit'
import { CLASS_DEFS, CLASSES, type FitClass } from '../core/fits'
import { HINGE_DEFAULTS, PIN_DEFAULTS, SNAP_DEFAULTS, TEST_DEFAULTS } from '../core/plans'
import { MATERIALS } from '../core/snap'
import { TOOLS, useFits, type Tool } from '../state/fitsStore'
import './fits.css'

type Json = Record<string, unknown>
const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
/** Undefined values dropped: a field cleared is a field left out. */
const run = (name: string, input: Json = {}) => runCommand(`fit.${name}`, JSON.parse(JSON.stringify(input)) as Json).catch(report)
const pct = (x: number) => `${Math.round(x * 1000) / 10} %`
const N = (x: number | null) => (x === null ? 'locks' : `${x >= 10 ? x.toFixed(1) : x.toFixed(2)} N`)

const TOOL_LABEL: Record<Tool, string> = { pair: 'Hole & shaft', snap: 'Snap fit', hinge: 'Hinge', pin: 'Pin & socket', test: 'Test coupon', stack: 'Stack' }

function Row({ label, children, tip }: { label: string; children: ReactNode; tip?: string }) {
  return (
    <label className="fits-row" title={tip}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function KV({ k, v, test }: { k: string; v: ReactNode; test?: string }) {
  return (
    <div className="kv" data-test={test}>
      <span className="name">{k}</span>
      <span className="pl-aside">{v}</span>
    </div>
  )
}

/** A length field for a tool: runs the tool with the value changed. */
function L({ tool, k, label, value, min = 0, step = 0.1, hint }: { tool: string; k: string; label: string; value: number; min?: number; step?: number; hint?: string }) {
  const s = useFits()
  return <NumberField label={label} testId={`fits-${tool}-${k}`} value={value} step={step} min={min} kind="length" disabled={s.busy} hint={hint ? <p>{hint}</p> : undefined} onCommit={(v) => void run(tool, { ...(s.inputs[tool as Tool] ?? {}), [k]: v })} />
}

/** A plain number for a tool (an angle, a count). */
function Plain({ tool, k, label, value, unit, min = 0, step = 1, hint }: { tool: string; k: string; label: string; value: number; unit: string; min?: number; step?: number; hint?: string }) {
  const s = useFits()
  return <NumberField label={label} testId={`fits-${tool}-${k}`} value={value} step={step} min={min} unit={unit} disabled={s.busy} hint={hint ? <p>{hint}</p> : undefined} onCommit={(v) => void run(tool, { ...(s.inputs[tool as Tool] ?? {}), [k]: v })} />
}

function Choice<T extends string>({ tool, k, label, value, options, labels }: { tool: string; k: string; label: string; value: T; options: readonly T[]; labels?: Partial<Record<T, string>> }) {
  const s = useFits()
  return (
    <Row label={label}>
      <select value={value} aria-label={label} data-test={`fits-${tool}-${k}`} disabled={s.busy} onChange={(e) => void run(tool, { ...(s.inputs[tool as Tool] ?? {}), [k]: e.target.value })}>
        {options.map((o) => (
          <option key={o} value={o}>
            {labels?.[o] ?? o}
          </option>
        ))}
      </select>
    </Row>
  )
}

function Make({ tool, label }: { tool: 'snap' | 'hinge' | 'pin'; label: string }) {
  const s = useFits()
  const ready = s.planned?.part === tool
  return (
    <div className="toolrow">
      <button className="primary" data-test={`fits-make-${tool}`} disabled={s.busy || !ready} title="Build it and bring it into Reverse Engineer" onClick={() => void run('apply', { part: tool, params: s.inputs[tool] ?? {} })}>
        {s.busy ? s.status || 'Building…' : label}
      </button>
      {s.busy && <button onClick={() => void run('stop')}>Stop</button>}
    </div>
  )
}

function Printer({ len }: { len: BoundLength }) {
  const s = useFits()
  const cal = s.calibration
  return (
    <details className="fits-printer" data-test="fits-printer">
      <summary>
        Printer: ±{len.fmt(s.settings.tolerance, 2)}, holes −{len.fmt(cal.hole, 2)}, shafts +{len.fmt(cal.shaft, 2)} ({cal.source})
      </summary>
      <NumberField label="Tolerance ±" testId="fits-tolerance" value={s.settings.tolerance} step={0.01} min={0.005} kind="length" hint={<p>What a printed size lands within. The stack’s default and the pair’s range.</p>} onCommit={(v) => void run('set', { tolerance: v })} />
      <Row label="Material">
        <select value={s.settings.material} aria-label="Material" data-test="fits-material" onChange={(e) => void run('set', { material: e.target.value })}>
          {MATERIALS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Row>
      <NumberField label="Holes print small by" testId="fits-cal-hole" value={cal.hole} step={0.01} min={-1} kind="length" hint={<p>Diametral. Measure a test coupon, or take Print fit’s.</p>} onCommit={(v) => void run('calibrate', { hole: v, shaft: cal.shaft })} />
      <NumberField label="Shafts print big by" testId="fits-cal-shaft" value={cal.shaft} step={0.01} min={-1} kind="length" hint={<p>Diametral.</p>} onCommit={(v) => void run('calibrate', { hole: cal.hole, shaft: v })} />
      {cal.spread !== undefined && <p className="hint">From {cal.n} readings, spread ±{len.fmt(cal.spread, 3)}.</p>}
      <div className="toolrow">
        <button title="Take the offsets from Print fit’s last measured print" data-test="fits-from-printfit" onClick={() => void run('calibrate', { from: 'print-fit' })}>
          From Print fit
        </button>
        <button title="Default offsets and untested classes" onClick={() => void run('calibrate', { reset: true })}>
          Defaults
        </button>
      </div>
    </details>
  )
}

function PairTool({ len }: { len: BoundLength }) {
  const s = useFits()
  const i = s.inputs.pair ?? {}
  const a = s.answers.pair
  const nominal = (i.nominal as number) ?? 8
  const cls = (i.class as FitClass) ?? 'slip'
  const go = (p: Json) => void run('pair', { nominal, ...(i.clearance === undefined ? { class: cls } : {}), ...i, ...p })
  return (
    <>
      <NumberField label="Nominal" testId="fits-pair-nominal" value={nominal} step={0.1} min={0.5} kind="length" onCommit={(v) => go({ nominal: v })} />
      <Row label="Fit">
        <select value={i.clearance === undefined ? cls : ''} aria-label="Fit class" data-test="fits-pair-class" onChange={(e) => go({ class: e.target.value, clearance: undefined })}>
          {i.clearance !== undefined && <option value="">Clearance given</option>}
          {CLASSES.map((c) => (
            <option key={c} value={c} title={CLASS_DEFS[c].use}>
              {CLASS_DEFS[c].label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Bought part">
        <select value={(i.bought as string) ?? ''} aria-label="Bought part" data-test="fits-pair-bought" onChange={(e) => go({ bought: e.target.value || undefined, basis: undefined })}>
          <option value="">Both printed</option>
          <option value="shaft">The shaft (a dowel)</option>
          <option value="hole">The hole (a bearing)</option>
        </select>
      </Row>
      {!i.nominal && !a && (
        <button className="primary" onClick={() => go({})}>
          Size it
        </button>
      )}
      {a && (
        <div className="pl-card live" data-test="fits-pair-answer">
          <KV k="Clearance" v={`${len.fmt(a.clearance, 3)} (${a.clearance < 0 ? 'interference' : 'gap'})`} />
          <KV k="Hole" v={`print ${len.fmt(a.printed.hole, 3)}, model ${len.fmt(a.model.hole, 3)}`} test="fits-pair-hole" />
          <KV k="Shaft" v={`print ${len.fmt(a.printed.shaft, 3)}, model ${len.fmt(a.model.shaft, 3)}`} test="fits-pair-shaft" />
          <KV k="Lands" v={`${len.fmt(a.range.worst[0], 2)} to ${len.fmt(a.range.worst[1], 2)} worst, ${len.fmt(a.range.rss[0], 2)} to ${len.fmt(a.range.rss[1], 2)} RSS`} />
          {a.iso.like && <KV k="Like" v={`${a.iso.like}; printer ≈ ${a.iso.grade ? `IT${a.iso.grade}` : 'past IT18'}`} />}
          {a.strain && <KV k="Hub strain" v={`${pct(a.strain.value)} of ${pct(a.strain.limit)}`} />}
          <Notes items={a.notes.map((t) => ({ level: 'warn', text: t }))} />
        </div>
      )}
    </>
  )
}

function SnapTool({ len }: { len: BoundLength }) {
  const s = useFits()
  const i = { ...SNAP_DEFAULTS, ...(s.inputs.snap ?? {}) } as typeof SNAP_DEFAULTS & Json
  const a = s.answers.snap
  return (
    <>
      <L tool="snap" k="length" label="Beam length" value={i.length} min={0.5} hint="Root to the hook’s retaining face." />
      <L tool="snap" k="thickness" label="Thickness" value={i.thickness} min={0.2} hint="In the way it bends." />
      <L tool="snap" k="width" label="Width" value={i.width} min={0.5} />
      <L tool="snap" k="undercut" label="Undercut" value={i.undercut} min={0.1} hint="How far the hook overhangs: the beam deflects this far." />
      <Plain tool="snap" k="leadAngle" label="Lead-in" value={i.leadAngle} unit="°" min={1} hint="Face to the way it goes in; 25–35° is usual." />
      <Plain tool="snap" k="retainAngle" label="Retaining" value={i.retainAngle} unit="°" min={1} hint="Face to the way it comes out; 90 locks." />
      <Choice tool="snap" k="material" label="Material" value={(i.material as string) ?? s.settings.material} options={MATERIALS.map((m) => m.id)} labels={Object.fromEntries(MATERIALS.map((m) => [m.id, m.label]))} />
      <Choice tool="snap" k="uses" label="Used" value={(i.uses as string) ?? 'once'} options={['once', 'repeated'] as const} labels={{ once: 'Snapped once', repeated: 'Again and again' }} />
      <Choice tool="snap" k="printed" label="Printed" value={(i.printed as string) ?? 'flat'} options={['flat', 'upright'] as const} labels={{ flat: 'Lying flat', upright: 'Standing up' }} />
      <L tool="snap" k="clearance" label="Window gap" value={i.clearance} hint="The catch window’s clearance each side, as printed." />
      {a && (
        <div className="pl-card live" data-test="fits-snap-answer">
          <Status tone={a.calc.ok ? 'ok' : 'bad'}>{`Strain ${pct(a.calc.strain)} of ${pct(a.calc.allowed)} allowed`}</Status>
          <KV k="Deflect" v={N(a.calc.deflectionForce)} />
          <KV k="Push in" v={N(a.calc.matingForce)} />
          <KV k="Pull out" v={N(a.calc.separationForce)} />
          <KV k="Engages" v={len.fmt(a.engagement, 2)} />
          <KV k="Most undercut" v={len.fmt(a.calc.maxUndercut, 2)} />
          <Notes items={a.notes.map((t) => ({ level: 'warn', text: t }))} />
        </div>
      )}
      {!a && (
        <button onClick={() => void run('snap', s.inputs.snap ?? {})} data-test="fits-snap-go">
          Work it out
        </button>
      )}
      <Make tool="snap" label="Make hook and catch" />
    </>
  )
}

function HingeTool({ len }: { len: BoundLength }) {
  const s = useFits()
  const i = { ...HINGE_DEFAULTS, ...(s.inputs.hinge ?? {}) } as typeof HINGE_DEFAULTS
  const a = s.answers.hinge
  return (
    <>
      <L tool="hinge" k="length" label="Length" value={i.length} min={8} />
      <Plain tool="hinge" k="knuckles" label="Knuckles" value={i.knuckles} unit="" min={2} />
      <L tool="hinge" k="leaf" label="Leaf" value={i.leaf} min={1} hint="Each leaf, from the pin’s axis." />
      <L tool="hinge" k="thickness" label="Thickness" value={i.thickness} min={0.8} />
      <L tool="hinge" k="knuckle" label="Knuckle Ø" value={i.knuckle} min={1} />
      <L tool="hinge" k="pin" label="Pin Ø" value={i.pin} min={1.2} />
      <L tool="hinge" k="clearance" label="Radial gap" value={i.clearance} min={0.05} step={0.05} hint="Round the pin and knuckles, as printed." />
      <L tool="hinge" k="gap" label="Axial gap" value={i.gap} min={0.05} step={0.05} hint="Between knuckles, as printed." />
      {a ? (
        <div className="pl-card live" data-test="fits-hinge-answer">
          <KV k="Knuckles" v={`${a.leaves.a} + ${a.leaves.b}, ${len.fmt(a.segment, 2)} each`} />
          <KV k="Bore" v={`${len.fmt(a.bore, 3)}, wall ${len.fmt(a.wall, 2)}`} />
          <KV k="Modelled gaps" v={`${len.fmt(a.radial.model, 3)} radial, ${len.fmt(a.axial.model, 3)} axial`} />
          <Notes items={a.notes.map((t) => ({ level: 'info', text: t }))} />
        </div>
      ) : (
        <button onClick={() => void run('hinge', s.inputs.hinge ?? {})} data-test="fits-hinge-go">
          Work it out
        </button>
      )}
      <Make tool="hinge" label="Make hinge" />
    </>
  )
}

function PinTool({ len }: { len: BoundLength }) {
  const s = useFits()
  const i = { ...PIN_DEFAULTS, ...(s.inputs.pin ?? {}) } as typeof PIN_DEFAULTS & Json
  const a = s.answers.pin
  return (
    <>
      <L tool="pin" k="nominal" label="Pin Ø" value={i.nominal} min={1.5} />
      <Choice tool="pin" k="class" label="Fit" value={((i.class as string) ?? i.cls) as FitClass} options={CLASSES} labels={Object.fromEntries(CLASSES.map((c) => [c, CLASS_DEFS[c].label]))} />
      <L tool="pin" k="length" label="Pin length" value={i.length} min={1} />
      <L tool="pin" k="depth" label="Socket depth" value={i.depth} min={1} />
      <Row label="Pin">
        <select value={i.bought ? 'bought' : 'printed'} aria-label="Pin" data-test="fits-pin-bought" onChange={(e) => void run('pin', { ...(s.inputs.pin ?? {}), bought: e.target.value === 'bought' })}>
          <option value="printed">Printed</option>
          <option value="bought">Bought (a dowel)</option>
        </select>
      </Row>
      {a ? (
        <div className="pl-card live" data-test="fits-pin-answer">
          <KV k="Hole" v={`model ${len.fmt(a.fit.model.hole, 3)}`} />
          {a.geo.pin !== null && <KV k="Pin" v={`model ${len.fmt(a.geo.pin, 3)}`} />}
          <KV k="Clearance" v={`${len.fmt(a.fit.clearance, 3)}, lands ${len.fmt(a.fit.range.worst[0], 2)} to ${len.fmt(a.fit.range.worst[1], 2)}`} />
          <Notes items={a.notes.map((t) => ({ level: 'info', text: t }))} />
        </div>
      ) : (
        <button onClick={() => void run('pin', s.inputs.pin ?? {})} data-test="fits-pin-go">
          Work it out
        </button>
      )}
      <Make tool="pin" label="Make pin and socket" />
    </>
  )
}

function TestTool({ len }: { len: BoundLength }) {
  const s = useFits()
  const i = s.inputs.test ?? {}
  const a = s.answers.test
  // The form, until Make: what fit.test is run with.
  const [nominal, setNominal] = useState<number>((i.nominal as number) ?? TEST_DEFAULTS.nominal)
  const [clearances, setClearances] = useState<number[]>((i.clearances as number[]) ?? TEST_DEFAULTS.clearances)
  const [measured, setMeasured] = useState<Record<string, string>>({})
  const shown = (mm: number) => String(Math.round(len.toDisplay(mm) * 10000) / 10000)
  // The label a class was felt at: an uncompensated coupon's labels stand
  // the offsets over the clearance kept (fit.calibrate takes them off).
  const feltAt = (c: FitClass) => {
    const kept = s.settings.classes[c]
    if (!a || !kept || kept.at !== a.geo.nominal) return ''
    const shift = a.compensated ? 0 : s.calibration.hole + s.calibration.shaft
    const row = a.rows.find((r) => Math.abs(r.label - shift - kept.clearance) < 0.005)
    return row ? String(row.label) : ''
  }
  const readings = a
    ? a.rows.flatMap((r, j) => [
        ...(measured[`h${j}`] ? [{ kind: 'hole', model: r.hole.model, measured: len.fromDisplay(Number(measured[`h${j}`])) }] : []),
        ...(measured[`p${j}`] ? [{ kind: 'shaft', model: r.peg.model, measured: len.fromDisplay(Number(measured[`p${j}`])) }] : []),
      ]).filter((x) => Number.isFinite(x.measured) && x.measured > 0)
    : []
  return (
    <>
      <NumberField label="Nominal" testId="fits-test-nominal" value={nominal} step={0.5} min={2} kind="length" onCommit={setNominal} />
      <Row label="Clearances" tip="As printed, diametral, in the display units; negative for interference">
        <input
          className="pl-input"
          aria-label="Clearances"
          data-test="fits-test-clearances"
          defaultValue={clearances.map(shown).join(', ')}
          key={`${clearances.join()}-${len.units}`}
          onBlur={(e) => {
            const cs = e.target.value.split(/[,\s]+/).filter(Boolean).map((t) => len.fromDisplay(Number(t)))
            if (cs.length && cs.every(Number.isFinite)) setClearances(cs.map((c) => Math.round(c * 100) / 100))
          }}
        />
      </Row>
      <div className="toolrow">
        <button className="primary" data-test="fits-test-make" disabled={s.busy} onClick={() => void run('test', { nominal, clearances })}>
          {s.busy ? s.status || 'Building…' : 'Make coupon'}
        </button>
        {s.busy && <button onClick={() => void run('stop')}>Stop</button>}
      </div>
      {a && (
        <div className="pl-card live" data-test="fits-test-answer">
          <table className="fits-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Hole model</th>
                <th>measured</th>
                <th>Peg model</th>
                <th>measured</th>
              </tr>
            </thead>
            <tbody>
              {a.rows.map((r, j) => (
                <tr key={j}>
                  <td>{r.label > 0 ? `+${r.label}` : r.label}</td>
                  <td>{len.fmt(r.hole.model, 3)}</td>
                  <td>
                    <input className="pl-input" type="number" step="any" aria-label={`Hole ${r.label} measured`} value={measured[`h${j}`] ?? ''} onChange={(e) => setMeasured({ ...measured, [`h${j}`]: e.target.value })} />
                  </td>
                  <td>{len.fmt(r.peg.model, 3)}</td>
                  <td>
                    <input className="pl-input" type="number" step="any" aria-label={`Peg ${r.label} measured`} value={measured[`p${j}`] ?? ''} onChange={(e) => setMeasured({ ...measured, [`p${j}`]: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button disabled={readings.length === 0} data-test="fits-test-readings" title="Offsets from the sizes measured" onClick={() => void run('calibrate', { readings }).then(() => setMeasured({}))}>
            Calibrate from {readings.length} measured
          </button>
          <p className="hint">Or say which label each fit felt right at:</p>
          {CLASSES.map((c) => (
            <Row key={c} label={CLASS_DEFS[c].label} tip={CLASS_DEFS[c].use}>
              <select
                aria-label={`${CLASS_DEFS[c].label} felt right at`}
                data-test={`fits-felt-${c}`}
                value={feltAt(c)}
                onChange={(e) => void run('calibrate', { classes: { [c]: e.target.value === '' ? null : Number(e.target.value) } })}
              >
                <option value="">Not tried</option>
                {a.rows.map((r) => (
                  <option key={r.label} value={r.label}>
                    {r.label > 0 ? `+${r.label}` : r.label}
                  </option>
                ))}
              </select>
            </Row>
          ))}
        </div>
      )}
    </>
  )
}

interface StackRow {
  name?: string
  nominal: number
  sign?: 1 | -1
  tol?: number
}

function StackTool({ len }: { len: BoundLength }) {
  const s = useFits()
  const i = s.inputs.stack ?? {}
  const items = (i.items as StackRow[] | undefined) ?? [
    { name: 'Slot', nominal: 20, sign: 1 },
    { name: 'Part', nominal: 19.5, sign: -1 },
  ]
  const a = s.answers.stack
  const go = (next: StackRow[]) => void run('stack', { ...i, items: next })
  const edit = (j: number, p: Partial<StackRow>) => go(items.map((it, k) => (k === j ? { ...it, ...p } : it)))
  return (
    <>
      {items.map((it, j) => (
        <div key={j} className="fits-stack-row" data-test={`fits-stack-${j}`}>
          <input className="pl-input" aria-label="Name" defaultValue={it.name ?? ''} key={`${j}-${it.name}`} onBlur={(e) => e.target.value !== (it.name ?? '') && edit(j, { name: e.target.value })} />
          <select aria-label="Adds or takes" value={it.sign ?? 1} onChange={(e) => edit(j, { sign: Number(e.target.value) as 1 | -1 })}>
            <option value={1}>+</option>
            <option value={-1}>−</option>
          </select>
          <NumberField label="Size" value={it.nominal} step={0.1} min={0} kind="length" onCommit={(v) => edit(j, { nominal: v })} />
          <NumberField label="±" value={it.tol ?? s.settings.tolerance} step={0.01} min={0} kind="length" onCommit={(v) => edit(j, { tol: v })} />
          <button title="Take it out" aria-label="Remove" disabled={items.length < 2} onClick={() => go(items.filter((_, k) => k !== j))}>
            ×
          </button>
        </div>
      ))}
      <div className="toolrow">
        <button onClick={() => go([...items, { nominal: 1, sign: -1 }])}>Add a size</button>
        {!a && (
          <button className="primary" onClick={() => go(items)}>
            Add up
          </button>
        )}
      </div>
      {a && (
        <div className="pl-card live" data-test="fits-stack-answer">
          <Status tone={a.worst.min >= (a.below?.min ?? 0) ? 'ok' : a.rss.min >= (a.below?.min ?? 0) ? 'warn' : 'bad'}>{`Gap ${len.fmt(a.mean, 3)}`}</Status>
          <KV k="Worst case" v={`${len.fmt(a.worst.min, 3)} to ${len.fmt(a.worst.max, 3)}`} />
          <KV k="RSS" v={`${len.fmt(a.rss.min, 3)} to ${len.fmt(a.rss.max, 3)}`} />
          {a.below && <KV k="Under the least" v={pct(a.below.chance)} />}
          <KV k="Most from" v={`${a.contributions[0].name}, ${Math.round(a.contributions[0].share * 100)} %`} />
        </div>
      )}
    </>
  )
}

export function FitsPanel() {
  const s = useFits()
  const len = useLength()
  const Tool = { pair: PairTool, snap: SnapTool, hinge: HingeTool, pin: PinTool, test: TestTool, stack: StackTool }[s.tool]
  return (
    <div className="group" data-test="fits-panel">
      <div className="sec-head">
        Fits
        <InfoDot title="Fits">
          <p>Clearances and interferences for printed parts, sized to your printer. Calibrate with the test coupon; the parts are made in Reverse Engineer.</p>
        </InfoDot>
      </div>
      <Printer len={len} />
      <div className="fits-tabs" role="tablist">
        {TOOLS.map((t) => (
          <button key={t} role="tab" aria-selected={s.tool === t} className={s.tool === t ? 'on' : ''} data-test={`fits-tool-${t}`} onClick={() => void run('set', { tool: t })}>
            {TOOL_LABEL[t]}
          </button>
        ))}
      </div>
      <Tool len={len} />
      {s.made && (
        <p className="hint" data-test="fits-made">
          In Reverse Engineer: {s.made.bodies.join(', ')}.
        </p>
      )}
    </div>
  )
}
