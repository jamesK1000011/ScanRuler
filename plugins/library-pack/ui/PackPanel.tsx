// SPDX-License-Identifier: AGPL-3.0-only
// The Pack workspace's panel: what the pack says, its licence and what that
// blocks, the upstream parts and their credit, what the scrub takes out, and
// Build — a zip saved on this computer for you to upload yourself. Every
// button runs the pack.* command an agent does.

import { useState } from 'react'
import { create } from 'zustand'
import { runCommand } from '../../../src/commands/registry'
import { saveFile } from '../../../src/app/exports'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
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

function Field({ label, value, on, wide }: { label: string; value: string; on(v: string): void; wide?: boolean }) {
  return (
    <label style={{ display: 'block', margin: '3px 0' }}>
      {label}
      <br />
      {wide ? <textarea defaultValue={value} rows={3} style={{ width: '100%' }} onBlur={(e) => e.target.value !== value && on(e.target.value)} /> : <input defaultValue={value} style={{ width: '100%' }} onBlur={(e) => e.target.value !== value && on(e.target.value)} />}
    </label>
  )
}

export function PackPanel() {
  const st = usePack()
  const v = usePackView()
  const [up, setUp] = useState(EMPTY)
  const busy = v.busy !== null
  const s = st.settings
  const p = plan(s, st.upstream)
  const set = (patch: Json) => void run('settings', patch)

  return (
    <div className="panel" data-test="pack-panel">
      <div className="group">
        <div className="sec-head">
          Share this part
          <InfoDot title="A pack you upload yourself">
            <p>The model, renders, a README, a LICENSE and the upload form's text, as a zip saved here. Each upstream part's licence is checked against yours, remixes are credited, and personal details are taken out of every file. Nothing is uploaded or posted.</p>
          </InfoDot>
        </div>
        <Field label="Title" value={s.title} on={(title) => title.trim() && set({ title })} />
        <Field label="Author (as you want to be credited)" value={s.author} on={(author) => set({ author })} />
        <Field label="Summary" value={s.summary} on={(summary) => set({ summary })} wide />
        <Field label="Print settings" value={s.printSettings} on={(printSettings) => set({ printSettings })} wide />
        <div className="kv">
          <label>
            Renders{' '}
            <select value={s.renders} disabled={busy} onChange={(e) => set({ renders: Number(e.target.value) })}>
              {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label><input type="checkbox" checked={s.includeStep} disabled={busy} onChange={(e) => set({ includeStep: e.target.checked })} /> STEP</label>
          <label><input type="checkbox" checked={s.include3mf} disabled={busy} onChange={(e) => set({ include3mf: e.target.checked })} /> 3MF</label>
          <label><input type="checkbox" checked={s.includeManual} disabled={busy} onChange={(e) => set({ includeManual: e.target.checked })} /> Manual</label>
          <label><input type="checkbox" checked={s.includeNotes} disabled={busy} onChange={(e) => set({ includeNotes: e.target.checked })} /> Notes</label>
        </div>
        <div className="kv">
          <label>
            For{' '}
            <select value={s.platform} disabled={busy} onChange={(e) => set({ platform: e.target.value })}>
              {['printables', 'thangs', 'makerworld', 'thingiverse', ...st.presets.map((x) => x.id)].filter((x, i, a) => a.indexOf(x) === i).map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="group">
        <div className="sec-head">Licence</div>
        <select value={s.licence ?? ''} disabled={busy} style={{ width: '100%' }} onChange={(e) => e.target.value && void run('licence', { id: e.target.value })} data-test="pack-licence">
          <option value="">Choose a licence…</option>
          {PACK_LICENCES.map((id) => (
            <option key={id} value={id}>{LICENCES[id].name}</option>
          ))}
        </select>
        {p.blocked.map((b) => (
          <p key={b.part} className="hint" style={{ color: '#b3261e' }} data-test="pack-blocked">
            <b>{b.part}:</b> {b.why}
          </p>
        ))}
        {p.licence && !p.blocked.length && <p className="hint">Every upstream part allows it.</p>}
      </div>

      <div className="group">
        <div className="sec-head">Upstream parts</div>
        {st.upstream.map((u) => {
          const left = p.leftOut.some((x) => x.part === u.part)
          return (
            <div key={u.part} className="kv" style={{ fontSize: 12 }}>
              <span>
                <b>{u.part}</b> {u.author ? `by ${u.author}` : ''} {u.licence ? `· ${readLicence(u.licence) ? LICENCES[readLicence(u.licence)!].short : u.licence}` : ''} {left ? '· left out, linked' : ''}
              </span>
              <button title="Remove" disabled={busy} onClick={() => void run('attrib', { remove: [u.part] })}>×</button>
            </div>
          )
        })}
        <details>
          <summary>Add a part you didn't design</summary>
          {(['part', 'title', 'author', 'url', 'licence', 'source', 'body'] as const).map((k) => (
            <label key={k} style={{ display: 'block', margin: '2px 0' }}>
              {k}{' '}
              <input value={up[k]} style={{ width: '100%' }} onChange={(e) => setUp({ ...up, [k]: e.target.value })} placeholder={k === 'licence' ? 'as the page says: CC BY-SA 4.0' : k === 'source' ? 'printables, mcmaster…' : ''} />
            </label>
          ))}
          <button
            disabled={busy || !up.part.trim()}
            onClick={() =>
              void run('attrib', { set: [Object.fromEntries(Object.entries(up).filter(([, x]) => x.trim()))] }).then((r) => {
                if (r) setUp(EMPTY)
              })
            }
          >
            Add
          </button>
        </details>
      </div>

      <div className="group">
        <div className="sec-head">Build</div>
        {p.problems.map((x) => (
          <p key={x} className="hint">{x}</p>
        ))}
        {st.added.length > 0 && <p className="hint">Added: {st.added.map((a) => a.name).join(', ')}</p>}
        <div className="kv">
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
          <button
            className="primary"
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
        </div>
        {v.busy && <p className="hint">{v.busy}</p>}
        {v.scrub && (
          <ul style={{ margin: '4px 0', paddingLeft: '1.2em', fontSize: 12 }} data-test="pack-scrub">
            {v.scrub.length === 0 ? <li>Nothing private found.</li> : v.scrub.map((c, i) => <li key={i}>{c.file}: {c.what}{c.count > 1 ? ` (${c.count})` : ''}</li>)}
          </ul>
        )}
        {v.built && <p className="hint" data-test="pack-built">Saved {v.built.files.length} files. {v.built.next}</p>}
      </div>
    </div>
  )
}
