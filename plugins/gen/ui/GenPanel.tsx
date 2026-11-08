// SPDX-License-Identifier: AGPL-3.0-only
// The Generate workspace's panel: the generator, its values, and Make.
// Every control runs a gen.* command.

import { useState } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { useStore } from '../../../src/state/store'
import { useLength } from '../../../src/app/useUnits'
import { InfoDot } from '../../../src/ui/InfoDot'
import { NumberField } from '../../../src/ui/NumberField'
import { Status } from '../../_shared/ui/kit'
import { generatorOf, GENERATORS, type Param, type Value } from '../core/generators'
import { useGen } from '../state/genStore'
import './gen.css'

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
const run = (name: string, input: Record<string, unknown> = {}) => runCommand(`gen.${name}`, input).catch(report)

/** A count, run when left or on Enter, not on every key. */
function CountField({ p, value, disabled, onCommit }: { p: Param; value: number; disabled: boolean; onCommit(v: number): void }) {
  const [text, setText] = useState<string | null>(null)
  const commit = () => {
    if (text === null) return
    const v = Number(text)
    setText(null)
    if (text.trim() !== '' && Number.isFinite(v) && v !== value) onCommit(v)
  }
  return (
    <label className="gen-row" title={p.tip}>
      <span>{p.label}</span>
      <input className="pl-input" type="number" step={p.step} min={p.min} max={p.max} aria-label={p.label} disabled={disabled} data-test={`gen-${p.key}`} value={text ?? value} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      {p.unit && <span className="pl-aside">{p.unit}</span>}
    </label>
  )
}

export function GenPanel() {
  const s = useGen()
  const len = useLength()
  const g = generatorOf(s.generator) ?? GENERATORS[0]
  const values: Record<string, Value> = { ...g.defaults, ...(s.values[g.id] ?? {}) }
  const why = g.check(values)
  const setOne = (key: string, v: Value) => void run('set', { generator: g.id, params: { [key]: v } })
  return (
    <div className="group" data-test="gen-panel">
      <div className="sec-head">
        Generate
        <InfoDot title="Generate">
          <p>Standard parts made to size as solids. Make brings one into Reverse Engineer as bodies to cut, fillet, check and export.</p>
        </InfoDot>
      </div>
      <label className="gen-row">
        <span>Part</span>
        <select value={g.id} aria-label="Generator" disabled={s.busy} data-test="gen-generator" onChange={(e) => void run('set', { generator: e.target.value })}>
          {GENERATORS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">{g.blurb}</p>
      {g.params.map((p) =>
        p.kind === 'bool' ? (
          <label key={p.key} className="gen-row" title={p.tip}>
            <span>{p.label}</span>
            <input type="checkbox" aria-label={p.label} disabled={s.busy} data-test={`gen-${p.key}`} checked={values[p.key] === true} onChange={(e) => setOne(p.key, e.target.checked)} />
          </label>
        ) : (
          p.length ? (
            <NumberField key={p.key} label={p.label} testId={`gen-${p.key}`} value={values[p.key] as number} step={p.step ?? 0.1} min={p.min ?? 0} kind="length" disabled={s.busy} hint={<p>{p.tip}</p>} onCommit={(v) => setOne(p.key, v)} />
          ) : (
            <CountField key={p.key} p={p} value={values[p.key] as number} disabled={s.busy} onCommit={(v) => setOne(p.key, Math.round(v))} />
          )
        ),
      )}
      {why && <Status tone="warn">{why}</Status>}
      <div className="toolrow">
        <button className="primary" disabled={s.busy || !!why} data-test="gen-make" title="Build it and bring it into Reverse Engineer" onClick={() => void run('make')}>
          {s.busy ? s.status || 'Building…' : 'Make'}
        </button>
        {s.busy ? (
          <button onClick={() => void run('stop')}>Stop</button>
        ) : (
          <button disabled={!s.values[g.id]} title="Back to the defaults" onClick={() => void run('set', { generator: g.id, reset: true })}>
            Defaults
          </button>
        )}
      </div>
      {s.made && (
        <div className="pl-card live" data-test="gen-made">
          {s.made.parts.map((p, i) => (
            <div key={i} className="kv">
              <span className="name">{s.made?.bodies[i] ?? p.name}</span>
              <span className="pl-aside">
                {p.box.max.map((x, j) => len.fmt(x - p.box.min[j], 1)).join(' × ')}, {len.vol(p.volume, 0)}
              </span>
            </div>
          ))}
          <p className="hint">In Reverse Engineer as bodies: export them there as STEP or STL.</p>
        </div>
      )}
    </div>
  )
}
