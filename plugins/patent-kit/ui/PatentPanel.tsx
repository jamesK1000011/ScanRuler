// SPDX-License-Identifier: AGPL-3.0-only
// The Patent workspace's panel: the drawing settings, the figures, the
// reference numerals, the sheets (drawn onto the stage), the 37 CFR 1.84
// checklist, the draft and the save. Every button runs the same patent.*
// command an agent does. The only way out is Save, to this computer.

import { useState } from 'react'
import { create } from 'zustand'
import { runCommand } from '../../../src/commands/registry'
import { saveFile } from '../../../src/app/exports'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { VIEW_NAMES } from '../../_shared/lineart/views'
import { SECTIONS, type Section } from '../core/model'
import { usePatent } from '../state/patentStore'

type Json = Record<string, any>
type FileOut = { name: string; mimeType: string; bytes: Uint8Array }

/** What the panel shows that the project doesn't keep: the sheet drawn,
 *  and whether it covers the stage. */
export const usePatentView = create<{ url: string | null; sheet: number; sheets: number; onStage: boolean; findings: Json[] | null; busy: string | null }>(() => ({ url: null, sheet: 1, sheets: 0, onStage: true, findings: null, busy: null }))

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })

async function run(name: string, input: Json = {}, busy?: string): Promise<Json | null> {
  if (busy) usePatentView.setState({ busy })
  try {
    return (await runCommand(`patent.${name}`, input)) as Json
  } catch (e) {
    report(e)
    return null
  } finally {
    if (busy) usePatentView.setState({ busy: null })
  }
}

async function draw(sheet: number) {
  const r = await run('render', { sheet, format: 'png' }, `Drawing sheet ${sheet}…`)
  if (!r) return
  const f = r.file as FileOut
  const old = usePatentView.getState().url
  if (old) URL.revokeObjectURL(old)
  usePatentView.setState({ url: URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mimeType })), sheet, sheets: r.sheets as number })
}

async function save(format: 'zip' | 'pdf' | 'md') {
  const r = await run('save', { format }, 'Saving…')
  if (r) saveFile((r.file as FileOut).name, new Blob([(r.file as FileOut).bytes as BlobPart], { type: (r.file as FileOut).mimeType }))
}

export function PatentSheet() {
  const url = usePatentView((s) => s.url)
  if (!url) return null
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', background: '#e8e8e8', display: 'flex', justifyContent: 'center', padding: 16 }} data-test="patent-sheet">
      <img src={url} alt="Patent drawing sheet" style={{ maxHeight: '100%', boxShadow: '0 2px 12px rgba(0,0,0,.25)', background: '#fff' }} />
    </div>
  )
}

export function PatentPanel() {
  const st = usePatent()
  const v = usePatentView()
  const [section, setSection] = useState<Section>('detailed')
  const [text, setText] = useState<string | null>(null)
  const [cut, setCut] = useState({ axis: 'y', offset: 0, keep: 'above', from: '' })
  const busy = v.busy !== null
  const draftText = text ?? st.draft[section] ?? ''

  return (
    <div className="panel" data-test="patent-panel">
      <div className="group">
        <div className="sec-head">
          Patent drawings
          <InfoDot title="A draft for your attorney">
            <p>Line drawings and a draft description to take to a patent attorney. Nothing here is filed, uploaded or sent: Save writes to this computer only. The drawings aim at 37 CFR 1.84; the checklist is for the attorney to judge.</p>
          </InfoDot>
        </div>
        <div className="kv">
          <label>
            Paper{' '}
            <select value={st.settings.paper} disabled={busy} onChange={(e) => void run('settings', { paper: e.target.value })}>
              <option value="letter">US letter</option>
              <option value="a4">A4</option>
            </select>
          </label>
          <label>
            Figures a sheet{' '}
            <select value={st.settings.figuresPerSheet} disabled={busy} onChange={(e) => void run('settings', { figuresPerSheet: Number(e.target.value) })}>
              {[1, 2, 4].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={st.settings.hidden === 'dashed'} disabled={busy} onChange={(e) => void run('settings', { hidden: e.target.checked ? 'dashed' : 'omit' })} /> Hidden lines dashed
          </label>
          <label>
            Called{' '}
            <input defaultValue={st.settings.title} disabled={busy} onBlur={(e) => e.target.value.trim() && e.target.value !== st.settings.title && void run('settings', { title: e.target.value.trim() })} style={{ width: '9em' }} />
          </label>
        </div>
      </div>

      <div className="group">
        <div className="sec-head">Figures</div>
        {st.figures.length === 0 && <p className="hint">Build the part in Reverse Engineer, then plan the figures.</p>}
        <ol style={{ margin: '4px 0', paddingLeft: '1.6em' }}>
          {st.figures.map((f) => (
            <li key={f.id}>
              {f.kind === 'section' ? `Section on ${f.section?.axis} = ${f.section?.offset}` : `${f.kind === 'exploded' ? 'Exploded ' : ''}${typeof f.view === 'string' ? f.view : 'custom'} view`}{' '}
              <button title="Remove this figure" disabled={busy} onClick={() => void run('figures', { remove: [f.id] })}>×</button>
            </li>
          ))}
        </ol>
        <div className="kv">
          <button disabled={busy} onClick={() => void run('figures', { plan: 'standard' })}>Plan standard figures</button>
          <select disabled={busy} value="" onChange={(e) => e.target.value && void run('figures', { add: [{ kind: 'view', view: e.target.value }] })}>
            <option value="">Add a view…</option>
            {VIEW_NAMES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="kv">
          Section on{' '}
          <select value={cut.axis} onChange={(e) => setCut({ ...cut, axis: e.target.value })}>
            {['x', 'y', 'z'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>{' '}
          at <input type="number" value={cut.offset} style={{ width: '5em' }} onChange={(e) => setCut({ ...cut, offset: Number(e.target.value) })} /> mm, from{' '}
          <select value={cut.from} onChange={(e) => setCut({ ...cut, from: e.target.value })}>
            <option value="">—</option>
            {st.figures.map((f, i) => (
              <option key={f.id} value={f.id}>FIG. {i + 1}</option>
            ))}
          </select>{' '}
          <button disabled={busy} onClick={() => void run('figures', { add: [{ kind: 'section', view: 'front', section: { axis: cut.axis, offset: cut.offset, keep: cut.keep, ...(cut.from ? { from: cut.from } : {}) } }] })}>Add</button>
        </div>
      </div>

      <div className="group">
        <div className="sec-head">Reference numerals</div>
        <table style={{ width: '100%' }}>
          <tbody>
            {st.numerals.map((n) => (
              <tr key={n.n}>
                <td style={{ width: '3em' }}><b>{n.n}</b></td>
                <td>
                  <input defaultValue={n.label} disabled={busy} style={{ width: '100%' }} onBlur={(e) => e.target.value.trim() && e.target.value !== n.label && void run('numerals', { set: [{ n: n.n, label: e.target.value.trim(), ...('at' in n.target ? { at: n.target.at, ...(n.target.body ? { body: n.target.body } : {}) } : { body: n.target.body }) }] })} />
                </td>
                <td style={{ width: '2em' }}><button title="Remove" disabled={busy} onClick={() => void run('numerals', { remove: [n.n] })}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="kv">
          <button disabled={busy} onClick={() => void run('numerals', { assign: 'bodies' })}>Number the bodies</button>
          <button disabled={busy || !st.numerals.length} onClick={() => void run('numerals', { renumber: true })}>Renumber</button>
        </div>
        <p className="hint">A feature (a hole, a face) gets its numeral from a point on it: ask the agent to set one with patent.numerals.</p>
      </div>

      <div className="group">
        <div className="sec-head">Sheets</div>
        <div className="kv">
          <button className="primary" disabled={busy || !st.figures.length} onClick={() => void draw(1)}>Draw</button>
          <button disabled={busy || v.sheet <= 1 || !v.url} onClick={() => void draw(v.sheet - 1)}>‹</button>
          <span>{v.sheets ? `Sheet ${v.sheet} of ${v.sheets}` : ''}</span>
          <button disabled={busy || v.sheet >= v.sheets || !v.url} onClick={() => void draw(v.sheet + 1)}>›</button>
          <label>
            <input type="checkbox" checked={v.onStage} onChange={(e) => usePatentView.setState({ onStage: e.target.checked })} /> On the stage
          </label>
        </div>
        {v.busy && <p className="hint">{v.busy}</p>}
        <div className="kv">
          <button
            disabled={busy || !st.figures.length}
            onClick={() =>
              void run('check', {}, 'Checking…').then((r) => {
                if (r) usePatentView.setState({ findings: r.findings as Json[] })
              })
            }
          >
            Check against 1.84
          </button>
          {v.findings && <span data-test="patent-findings">{v.findings.length === 0 ? 'Nothing flagged' : `${v.findings.length} to look at`}</span>}
        </div>
        {v.findings && v.findings.length > 0 && (
          <ul style={{ margin: '4px 0', paddingLeft: '1.2em', fontSize: 12 }}>
            {v.findings.map((f, i) => (
              <li key={i}>
                <b>{f.rule}</b> {f.level}: {f.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="group">
        <div className="sec-head">
          Draft
          <InfoDot title="Numeral tokens">
            <p>Write [[10]] for "housing 10" and [[10#]] for the bare 10: a renamed part renames every paragraph. Every section is marked a draft for attorney review.</p>
          </InfoDot>
        </div>
        <div className="kv">
          <select
            value={section}
            onChange={(e) => {
              setSection(e.target.value as Section)
              setText(null)
            }}
          >
            {SECTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button disabled={busy} onClick={() => void run('draft', { generate: 'drawings' }).then(() => setSection('drawings'))}>Write the brief description</button>
        </div>
        <textarea value={draftText} rows={6} style={{ width: '100%' }} onChange={(e) => setText(e.target.value)} placeholder="Ask the agent to draft from your notes, or write here." />
        <button
          disabled={busy || text === null}
          onClick={() =>
            void run('draft', { section, text: draftText }).then((r) => {
              if (r) setText(null)
            })
          }
        >
          Save section
        </button>
      </div>

      <div className="group">
        <div className="sec-head">Save to this computer</div>
        <div className="kv">
          <button className="primary" disabled={busy || !st.figures.length} onClick={() => void save('zip')}>Save the kit (.zip)</button>
          <button disabled={busy || !st.figures.length} onClick={() => void save('pdf')}>Drawings (.pdf)</button>
          <button disabled={busy} onClick={() => void save('md')}>Draft (.md)</button>
        </div>
      </div>
    </div>
  )
}
