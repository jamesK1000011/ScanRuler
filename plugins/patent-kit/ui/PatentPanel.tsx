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
import { NumberField } from '../../../src/ui/NumberField'
import { useLength, type BoundLength } from '../../../src/app/useUnits'
import { Busy, Notes, Pager, Paper, Status } from '../../_shared/ui/kit'
import { VIEW_NAMES } from '../../_shared/lineart/views'
import { SECTIONS, type Section } from '../core/model'
import { usePatent } from '../state/patentStore'
import { bodiesNow } from '../app/patentCommands'

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

async function save(format: 'zip' | 'pdf' | 'spec' | 'md') {
  const r = await run('save', { format }, 'Saving…')
  if (r) saveFile((r.file as FileOut).name, new Blob([(r.file as FileOut).bytes as BlobPart], { type: (r.file as FileOut).mimeType }))
  if (r?.note) useStore.getState().setStatus(String(r.note))
}

export function PatentSheet() {
  const url = usePatentView((s) => s.url)
  return <Paper url={url} alt="Patent drawing sheet" testId="patent-sheet" fit />
}

const SECTION_NAMES: Record<Section, string> = {
  title: 'Title',
  field: 'Field of the invention',
  background: 'Background',
  summary: 'Summary',
  drawings: 'Brief description of the drawings',
  detailed: 'Detailed description',
  claims: 'Claims',
  abstract: 'Abstract',
}

const figureName = (f: Json, len: BoundLength) =>
  f.kind === 'section' ? `Section on ${f.section?.axis} = ${len.fmt(f.section?.offset ?? 0, 2)}` : `${f.kind === 'exploded' ? 'Exploded ' : ''}${typeof f.view === 'string' ? f.view : 'custom'} view`

export function PatentPanel() {
  const len = useLength()
  const st = usePatent()
  const v = usePatentView()
  const [section, setSection] = useState<Section>('detailed')
  const [text, setText] = useState<string | null>(null)
  const [cut, setCut] = useState({ axis: 'y', offset: 0, keep: 'above', from: '' })
  const busy = v.busy !== null
  const draftText = text ?? st.draft[section] ?? ''
  const none = !st.figures.length
  // Read on each draw: the panel is drawn afresh on coming to the workspace,
  // after the bodies are built in Reverse Engineer.
  const noPart = bodiesNow().length === 0
  const noDraft = !Object.values(st.draft).some((v) => v && String(v).trim())
  const flagged = v.findings?.filter((f) => f.level !== 'note').length ?? 0

  return (
    <aside className="panel" data-test="patent-panel">
      <div className="group">
        <div className="sec-head">
          Drawing sheets
          <InfoDot title="A draft for your attorney">
            <p>Line drawings and a draft description to take to a patent attorney. Nothing here is filed, uploaded or sent: Save writes to this computer only.</p>
            {/* units-ok: quotes 37 CFR 1.84's limit as the rule states it */}
            <p>The drawings follow 37 CFR 1.84 — black lines, no shading, margins, numerals 3.2 mm or more. The checklist below is for the attorney to judge.</p>
          </InfoDot>
        </div>
        <label className="field">
          <span>Paper</span>
          <select value={st.settings.paper} disabled={busy} onChange={(e) => void run('settings', { paper: e.target.value })}>
            <option value="letter">US letter</option>
            <option value="a4">A4</option>
          </select>
        </label>
        <label className="field">
          <span>Figures a sheet</span>
          <select value={st.settings.figuresPerSheet} disabled={busy} onChange={(e) => void run('settings', { figuresPerSheet: Number(e.target.value) })}>
            {[1, 2, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>The device is called</span>
          <input
            key={st.settings.title}
            type="text"
            defaultValue={st.settings.title}
            disabled={busy}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            onBlur={(e) => e.target.value.trim() && e.target.value !== st.settings.title && void run('settings', { title: e.target.value.trim() })}
          />
        </label>
        <label className="checkrow">
          <input type="checkbox" checked={st.settings.hidden === 'dashed'} disabled={busy} onChange={(e) => void run('settings', { hidden: e.target.checked ? 'dashed' : 'omit' })} />
          Hidden lines dashed
        </label>
      </div>

      <div className="group">
        <div className="sec-head">
          Figures <b>{st.figures.length || ''}</b>
        </div>
        {none && <p className="hint">{noPart ? 'Build the part in Reverse Engineer first: the figures are drawn from its bodies.' : 'Plan the standard figures, or add views and sections.'}</p>}
        <div>
          {st.figures.map((f, i) => (
            <div className="kv" key={f.id} data-test="patent-figure">
              <span className="pl-num">{i + 1}</span>
              <span className="name">{figureName(f, len)}</span>
              <button className="x" title="Remove this figure" disabled={busy} onClick={() => void run('figures', { remove: [f.id] })}>
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="toolrow">
          <button disabled={busy || noPart} onClick={() => void run('figures', { plan: 'standard' })}>
            Plan standard figures
          </button>
          <select disabled={busy || noPart} value="" onChange={(e) => e.target.value && void run('figures', { add: [{ kind: 'view', view: e.target.value }] })}>
            <option value="">Add a view…</option>
            {VIEW_NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <label className="field">
          <span>Section across</span>
          <select value={cut.axis} onChange={(e) => setCut({ ...cut, axis: e.target.value })}>
            {['x', 'y', 'z'].map((a) => (
              <option key={a} value={a}>
                {a.toUpperCase()} axis
              </option>
            ))}
          </select>
        </label>
        <NumberField label={`At ${cut.axis.toUpperCase()} =`} value={cut.offset} step={1} min={-100_000} kind="length" onCommit={(offset) => setCut({ ...cut, offset })} />
        <div className="toolrow">
          <select value={cut.from} title="The figure the section is marked on" onChange={(e) => setCut({ ...cut, from: e.target.value })}>
            <option value="">Marked on no figure</option>
            {st.figures.map((f, i) => (
              <option key={f.id} value={f.id}>
                Marked on FIG. {i + 1}
              </option>
            ))}
          </select>
          <button
            disabled={busy || noPart}
            onClick={() => void run('figures', { add: [{ kind: 'section', view: 'front', section: { axis: cut.axis, offset: cut.offset, keep: cut.keep, ...(cut.from ? { from: cut.from } : {}) } }] })}
          >
            Add section
          </button>
        </div>
      </div>

      <div className="group">
        <div className="sec-head">
          Reference numerals
          <InfoDot title="Numerals">
            <p>Each part, and each feature you point at, gets a numeral on every figure it shows in. Rename one here and the draft follows.</p>
            <p>A feature — a hole, a face — gets its numeral from a point on it: ask the agent to set one with patent.numerals.</p>
          </InfoDot>
          <b>{st.numerals.length || ''}</b>
        </div>
        <div>
          {st.numerals.map((n) => (
            <div className="kv" key={n.n} data-test="patent-numeral">
              <span className="pl-num">{n.n}</span>
              <input
                key={n.label}
                className="pl-input"
                type="text"
                defaultValue={n.label}
                title={n.label}
                disabled={busy}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                onBlur={(e) =>
                  e.target.value.trim() &&
                  e.target.value !== n.label &&
                  void run('numerals', { set: [{ n: n.n, label: e.target.value.trim(), ...('at' in n.target ? { at: n.target.at, ...(n.target.body ? { body: n.target.body } : {}) } : { body: n.target.body }) }] })
                }
              />
              <button className="x" title="Remove" disabled={busy} onClick={() => void run('numerals', { remove: [n.n] })}>
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="toolrow">
          <button disabled={busy || noPart} onClick={() => void run('numerals', { assign: 'bodies' })}>
            Number the bodies
          </button>
          <button disabled={busy || !st.numerals.length} onClick={() => void run('numerals', { renumber: true })}>
            Renumber
          </button>
        </div>
      </div>

      <div className="group">
        <div className="sec-head">Sheets</div>
        {v.url ? (
          <Pager label={`Sheet ${v.sheet} of ${v.sheets}`} canPrev={!busy && v.sheet > 1} canNext={!busy && v.sheet < v.sheets} onPrev={() => void draw(v.sheet - 1)} onNext={() => void draw(v.sheet + 1)} />
        ) : null}
        <div className="toolrow">
          <button className={v.url ? '' : 'primary'} disabled={busy || none} onClick={() => void draw(v.url ? v.sheet : 1)}>
            {v.url ? 'Redraw' : 'Draw'}
          </button>
          <button
            disabled={busy || none}
            onClick={() =>
              void run('check', {}, 'Checking…').then((r) => {
                if (r) usePatentView.setState({ findings: r.findings as Json[] })
              })
            }
          >
            Check against 1.84
          </button>
        </div>
        <label className="checkrow">
          <input type="checkbox" checked={v.onStage} onChange={(e) => usePatentView.setState({ onStage: e.target.checked })} />
          Show the sheet on the stage
        </label>
        <Busy text={v.busy} />
        {v.findings && (
          <Status tone={flagged ? 'warn' : 'ok'} testId="patent-findings">
            {v.findings.length === 0 ? 'Nothing flagged' : `${v.findings.length} to look at`}
          </Status>
        )}
        {v.findings && <Notes items={v.findings.map((f) => ({ level: f.level, rule: f.rule, text: f.message }))} />}
      </div>

      <div className="group">
        <div className="sec-head">
          Draft
          <InfoDot title="Numeral tokens">
            <p>Write [[10]] for “housing 10” and [[10#]] for the bare 10: a renamed part renames every paragraph.</p>
            <p>Every section is marked a draft for attorney review.</p>
          </InfoDot>
        </div>
        <label className="field">
          <span>Section</span>
          <select
            value={section}
            title="The sections with ✓ have text"
            onChange={(e) => {
              setSection(e.target.value as Section)
              setText(null)
            }}
          >
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {st.draft[s] ? '✓ ' : ''}
                {SECTION_NAMES[s]}
              </option>
            ))}
          </select>
        </label>
        <textarea className="pl-text" value={draftText} rows={7} onChange={(e) => setText(e.target.value)} placeholder="Ask the agent to draft from your notes, or write here." />
        <div className="toolrow">
          <button disabled={busy} onClick={() => void run('draft', { generate: 'drawings' }).then(() => setSection('drawings'))}>
            Write the brief description
          </button>
          <button
            className={text !== null ? 'primary' : ''}
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
      </div>

      <div className="divider" />
      <div className="tailrow">
        <button className="primary block" disabled={busy || none} onClick={() => void save('zip')}>
          Save the kit (.zip)
        </button>
        <div className="toolrow">
          <button disabled={busy || none} onClick={() => void save('pdf')}>
            Drawings (.pdf)
          </button>
          <button disabled={busy || noDraft} title="The draft laid out as 37 CFR 1.52 asks: margins, 1½ spacing, paragraphs numbered [0001], claims and abstract on their own pages" onClick={() => void save('spec')}>
            Specification (.pdf)
          </button>
        </div>
        <div className="toolrow">
          <button disabled={busy || noDraft} onClick={() => void save('md')}>
            Draft (.md)
          </button>
        </div>
        <p className="hint">Saved to this computer only — nothing is filed or sent.</p>
      </div>
    </aside>
  )
}
