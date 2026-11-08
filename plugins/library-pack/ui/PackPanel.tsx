// SPDX-License-Identifier: AGPL-3.0-only
// The Pack workspace's panel: what the pack says, its licence and what that
// blocks, the upstream parts and their credit, what the scrub takes out, and
// Build — a zip saved on this computer for you to upload yourself. Every
// button runs the pack.* command an agent does.

import { useRef, useState } from 'react'
import { create } from 'zustand'
import { runCommand } from '../../../src/commands/registry'
import { saveFile } from '../../../src/app/exports'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { Busy, Notes, Status, TextField } from '../../_shared/ui/kit'
import { LICENCES, PACK_LICENCES, readLicence } from '../core/licence'
import { plan } from '../core/plan'
import { usePack } from '../state/packStore'

type Json = Record<string, any>
type FileOut = { name: string; mimeType: string; bytes: Uint8Array }

export const usePackView = create<{ scrub: Json[] | null; built: Json | null; busy: string | null }>(() => ({ scrub: null, built: null, busy: null }))

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })

async function run(name: string, input: Json = {}, busy?: string): Promise<Json | null> {
  if (busy) usePackView.setState({ busy })
  try {
    return (await runCommand(`pack.${name}`, input)) as Json
  } catch (e) {
    report(e)
    return null
  } finally {
    if (busy) usePackView.setState({ busy: null })
  }
}

const EMPTY = { part: '', title: '', author: '', url: '', licence: '', source: '', body: '' }
/** A plan's problem as the person reads it here: what to fill in, not the
 *  command the agent would call. */
const forPerson = (t: string) =>
  t
    .replace(/^No licence chosen yet: pack\.licence \{ id \}\./, 'No licence chosen yet: pick one under Licence.')
    .replace(/^No author \(the copyright holder\) yet: pack\.settings \{ author \}\./, 'No author yet: fill in “Credit me as”.')
    .replace(/ \(pack\.attrib\)\.$/, ' — add them under Upstream parts.')

const UP_FIELDS: { k: keyof typeof EMPTY; label: string; hint?: string }[] = [
  { k: 'part', label: 'Name in this project' },
  { k: 'title', label: 'Its title' },
  { k: 'author', label: 'Designer' },
  { k: 'url', label: 'Page', hint: 'https://…' },
  { k: 'licence', label: 'Licence', hint: 'as the page says: CC BY-SA 4.0' },
  { k: 'source', label: 'Where from', hint: 'printables, mcmaster…' },
  { k: 'body', label: 'Body it is', hint: 'the body’s name in Reverse Engineer' },
]
/** What pack.add takes: models, slicer projects, pictures, drawings, notes. */
const ADD_ACCEPT = '.stl,.3mf,.step,.stp,.obj,.png,.jpg,.jpeg,.webp,.gif,.svg,.dxf,.pdf,.md,.txt'

async function addFile(f: File) {
  const bytes = new Uint8Array(await f.arrayBuffer())
  await run('add', { bytes, name: f.name }, 'Adding the file…')
}

const PLATFORM_NAMES: Record<string, string> = { printables: 'Printables', thangs: 'Thangs', makerworld: 'MakerWorld', thingiverse: 'Thingiverse' }

export function PackPanel() {
  const st = usePack()
  const v = usePackView()
  const [up, setUp] = useState(EMPTY)
  const fileInput = useRef<HTMLInputElement>(null)
  const busy = v.busy !== null
  const s = st.settings
  const p = plan(s, st.upstream)
  const set = (patch: Json) => void run('settings', patch)
  const licenceShort = (l: string) => (readLicence(l) ? LICENCES[readLicence(l)!].short : l)

  return (
    <aside className="panel" data-test="pack-panel">
      <div className="group">
        <div className="sec-head">
          Share this part
          <InfoDot title="A pack you upload yourself">
            <p>The model, renders, a README, a LICENSE and the upload form’s text, as a zip saved here.</p>
            <p>Upstream licences are checked against yours, remixes credited, personal details scrubbed. Nothing is uploaded.</p>
          </InfoDot>
        </div>
        <TextField label="Title" value={s.title} disabled={busy} onCommit={(title) => title.trim() && set({ title })} />
        <TextField label="Credit me as" value={s.author} disabled={busy} onCommit={(author) => set({ author })} />
        <TextField label="Summary" value={s.summary} rows={3} disabled={busy} onCommit={(summary) => set({ summary })} />
        <TextField label="Print settings" value={s.printSettings} rows={3} disabled={busy} placeholder="PETG, 0.2 mm layers, 4 walls…" onCommit={(printSettings) => set({ printSettings })} /* units-ok: example text of a slicer setting */ />
      </div>

      <div className="group">
        <div className="sec-head">In the pack</div>
        <label className="field">
          <span>Renders</span>
          <select value={s.renders} disabled={busy} onChange={(e) => set({ renders: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'None' : `${n} view${n > 1 ? 's' : ''}`}
              </option>
            ))}
          </select>
        </label>
        <div className="pl-chips">
          <label>
            <input type="checkbox" checked={s.includeStep} disabled={busy} onChange={(e) => set({ includeStep: e.target.checked })} />
            STEP
          </label>
          <label>
            <input type="checkbox" checked={s.include3mf} disabled={busy} onChange={(e) => set({ include3mf: e.target.checked })} />
            3MF project
          </label>
          <label>
            <input type="checkbox" checked={s.includeManual} disabled={busy} onChange={(e) => set({ includeManual: e.target.checked })} />
            Manual
          </label>
          <label>
            <input type="checkbox" checked={s.includeNotes} disabled={busy} onChange={(e) => set({ includeNotes: e.target.checked })} />
            Notes
          </label>
        </div>
        <label className="field">
          <span>Upload form for</span>
          <select value={s.platform} disabled={busy} onChange={(e) => set({ platform: e.target.value })}>
            {['printables', 'thangs', 'makerworld', 'thingiverse', ...st.presets.map((x) => x.id)]
              .filter((x, i, a) => a.indexOf(x) === i)
              .map((id) => (
                <option key={id} value={id}>
                  {PLATFORM_NAMES[id] ?? id}
                </option>
              ))}
          </select>
        </label>
        <div className="field">
          <span>Other files {st.added.length ? <b>{st.added.length}</b> : null}</span>
          <button disabled={busy} title="Add a 3MF, photo or drawing; kept this session only" onClick={() => fileInput.current?.click()} data-test="pack-add-file">
            Add file…
          </button>
          <input ref={fileInput} type="file" hidden accept={ADD_ACCEPT} onChange={(e) => { const f = e.target.files?.[0]; if (f) void addFile(f); e.target.value = '' }} />
        </div>
        {st.added.map((a) => (
          <div className="kv" key={a.name} data-test="pack-added">
            <span className="name">{a.name}</span>
            <span className="pl-aside">{(a.bytes.length / 1024).toFixed(0)} kB</span>
            <button className="x" disabled={busy} title={`Take ${a.name} out of the pack`} onClick={() => void run('files', { remove: [a.name] })}>×</button>
          </div>
        ))}
      </div>

      <div className="group">
        <div className="sec-head">Licence</div>
        <label className="pl-stack">
          <select value={s.licence ?? ''} disabled={busy} onChange={(e) => e.target.value && void run('licence', { id: e.target.value })} data-test="pack-licence">
            <option value="">Choose a licence…</option>
            {PACK_LICENCES.map((id) => (
              <option key={id} value={id}>
                {LICENCES[id].name}
              </option>
            ))}
          </select>
        </label>
        <Notes testId="pack-blocked" items={p.blocked.map((b) => ({ level: 'block', rule: b.part, text: b.why }))} />
        {p.licence && !p.blocked.length && <Status tone="ok">Every upstream part allows it.</Status>}
      </div>

      <div className="group">
        <div className="sec-head">
          Upstream parts <b>{st.upstream.length || ''}</b>
        </div>
        {st.upstream.length === 0 && <p className="hint">A part you didn’t design — a bolt from McMaster, a remix’s original — is credited here and its licence checked.</p>}
        <div>
          {st.upstream.map((u) => {
            const left = p.leftOut.some((x) => x.part === u.part)
            return (
              <div key={u.part} className="kv" data-test="pack-upstream">
                <span className="name" title={u.url ?? ''}>
                  {u.part}
                  {u.author ? <span className="pl-aside"> by {u.author}</span> : null}
                </span>
                <span className="pl-aside">{left ? 'left out, linked' : u.licence ? licenceShort(u.licence) : 'no licence'}</span>
                <button className="x" title="Remove" disabled={busy} onClick={() => void run('attrib', { remove: [u.part] })}>
                  ×
                </button>
              </div>
            )
          })}
        </div>
        <details className="pl-fold">
          <summary>Add a part you didn’t design</summary>
          {UP_FIELDS.map(({ k, label, hint }) => (
            <label key={k} className="pl-stack">
              <span>{label}</span>
              <input className="pl-input" type="text" value={up[k]} placeholder={hint} onChange={(e) => setUp({ ...up, [k]: e.target.value })} />
            </label>
          ))}
          <div className="toolrow">
            <button
              disabled={busy || !up.part.trim()}
              onClick={() =>
                void run('attrib', { set: [Object.fromEntries(Object.entries(up).filter(([, x]) => x.trim()))] }).then((r) => {
                  if (r) setUp(EMPTY)
                })
              }
            >
              Add the part
            </button>
          </div>
        </details>
      </div>

      <div className="group">
        <div className="sec-head">Build</div>
        <Notes items={p.problems.map((x) => ({ level: 'warn', text: forPerson(x) }))} />
        {st.added.length > 0 && <p className="hint">Added: {st.added.map((a) => a.name).join(', ')}</p>}
        <div className="toolrow">
          <button
            disabled={busy}
            onClick={() =>
              void run('scrub', {}, 'Gathering the files…').then((r) => {
                if (r) usePackView.setState({ scrub: r.changes as Json[] })
              })
            }
          >
            What the scrub takes out
          </button>
        </div>
        <Busy text={v.busy} />
        {v.scrub &&
          (v.scrub.length === 0 ? (
            <Status tone="ok" testId="pack-scrub">
              Nothing private found.
            </Status>
          ) : (
            <Notes testId="pack-scrub" items={v.scrub.map((c) => ({ level: 'ok', rule: String(c.file).replace(/^files\//, ''), text: `${c.what}${c.count > 1 ? ` (${c.count})` : ''}` }))} />
          ))}
      </div>

      <div className="divider" />
      <div className="tailrow">
        <button
          className="primary block"
          disabled={busy || !p.ok}
          onClick={() =>
            void run('build', {}, 'Building the pack…').then((r) => {
              if (!r) return
              const f = r.file as FileOut
              saveFile(f.name, new Blob([f.bytes as BlobPart], { type: f.mimeType }))
              usePackView.setState({ built: r })
            })
          }
        >
          Build the pack
        </button>
        {v.built ? (
          <Status tone="ok" testId="pack-built">
            Saved {v.built.files.length} files. {v.built.next}
          </Status>
        ) : (
          <p className="hint">A zip saved to this computer. Upload it yourself — nothing is posted from here.</p>
        )}
      </div>
    </aside>
  )
}
