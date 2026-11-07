// SPDX-License-Identifier: AGPL-3.0-only
// The Assembly workspace's panel: the parts and their bill of materials,
// the steps with the way each part goes in, each step's words linted as you
// write them, the check that every part can get in, the pages (drawn onto
// the stage) and the save. Every button runs the asm.* command an agent does.

import { useState } from 'react'
import { create } from 'zustand'
import { runCommand } from '../../../src/commands/registry'
import { saveFile } from '../../../src/app/exports'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { bom } from '../core/assembly'
import { lint } from '../core/lint'
import { useAsm } from '../state/asmStore'

type Json = Record<string, any>
type FileOut = { name: string; mimeType: string; bytes: Uint8Array }

export const useAsmView = create<{ url: string | null; page: number; pages: number; onStage: boolean; checked: Json | null; busy: string | null }>(() => ({ url: null, page: 1, pages: 0, onStage: true, checked: null, busy: null }))

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })

async function run(name: string, input: Json = {}, busy?: string): Promise<Json | null> {
  if (busy) useAsmView.setState({ busy })
  try {
    return (await runCommand(`asm.${name}`, input)) as Json
  } catch (e) {
    report(e)
    return null
  } finally {
    if (busy) useAsmView.setState({ busy: null })
  }
}

async function draw(page: number) {
  const r = await run('render', { page, format: 'png' }, page === 0 ? 'Drawing the cover…' : `Drawing step ${page}…`)
  if (!r) return
  const f = r.file as FileOut
  const old = useAsmView.getState().url
  if (old) URL.revokeObjectURL(old)
  useAsmView.setState({ url: URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mimeType })), page, pages: (r.pages as number) - 1 })
}

async function save(format: 'html' | 'pdf' | 'zip') {
  const r = await run('save', { format }, 'Saving…')
  if (r) saveFile((r.file as FileOut).name, new Blob([(r.file as FileOut).bytes as BlobPart], { type: (r.file as FileOut).mimeType }))
}

export function AsmPage() {
  const url = useAsmView((s) => s.url)
  if (!url) return null
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', background: '#e8e8e8', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 16 }} data-test="asm-page">
      <img src={url} alt="Manual page" style={{ maxWidth: '100%', boxShadow: '0 2px 12px rgba(0,0,0,.25)', background: '#fff' }} />
    </div>
  )
}

const MOVES = ['down', 'up', '+x', '-x', '+y', '-y']
const moveName = (m: number[]) => ({ '0,0,-1': 'down', '0,0,1': 'up', '1,0,0': '+x', '-1,0,0': '-x', '0,1,0': '+y', '0,-1,0': '-y' })[m.join(',')] ?? `[${m.join(', ')}]`

export function AssemblyPanel() {
  const st = useAsm()
  const v = useAsmView()
  const [pick, setPick] = useState<string[]>([])
  const [move, setMove] = useState('down')
  const [texts, setTexts] = useState<Record<string, string>>({})
  const busy = v.busy !== null
  const placed = new Set(st.steps.flatMap((s) => s.place.map((p) => p.part)))
  const rows = bom(st.parts)

  return (
    <div className="panel" data-test="asm-panel">
      <div className="group">
        <div className="sec-head">
          Assembly manual
          <InfoDot title="How it works">
            <p>List the parts — bodies in Reverse Engineer, in their assembled places — then the steps that put them in and the way each moves. Check sweeps every part in along its move against what is already there. Pages are drawn with the parts in place in grey and the step's own in black.</p>
          </InfoDot>
        </div>
        <div className="kv">
          <label>
            Title <input defaultValue={st.settings.title} disabled={busy} onBlur={(e) => e.target.value.trim() && e.target.value !== st.settings.title && void run('settings', { title: e.target.value.trim() })} />
          </label>
          <label>
            Style{' '}
            <select value={st.style.name} disabled={busy} onChange={(e) => void run('style', { name: e.target.value })}>
              <option value="ste100">STE habits</option>
              <option value="plain">Plain English</option>
              {st.style.custom && <option value="custom">My style file</option>}
            </select>
          </label>
        </div>
      </div>

      <div className="group">
        <div className="sec-head">Parts</div>
        {st.parts.length === 0 && <p className="hint">Name the bodies in Reverse Engineer, then take them in as parts.</p>}
        <table style={{ width: '100%', fontSize: 12 }}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item}>
                <td style={{ width: '2em' }}><b>{r.item}</b></td>
                <td>{r.qty} × {r.name}</td>
                <td style={{ color: 'var(--muted, #777)' }}>{r.designation ?? r.source ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="kv">
          <button disabled={busy} onClick={() => void run('parts', { fromBodies: true })}>Take in the bodies</button>
        </div>
        {st.parts.some((p) => p.kind === 'part' && /\d+$/.test(p.name)) && (
          <p className="hint">Parts named "Screw 1", "Screw 2"… with one designation come out as one item with a count: set it with asm.parts, or ask the agent.</p>
        )}
      </div>

      <div className="group">
        <div className="sec-head">Steps</div>
        {st.steps.map((s, i) => {
          const t = texts[s.id] ?? s.text ?? ''
          const found = t ? lint(t, st.style) : []
          return (
            <div key={s.id} style={{ borderTop: '1px solid var(--line, #ddd)', padding: '6px 0' }} data-test="asm-step">
              <div className="kv">
                <b>Step {i + 1}</b>
                <span>{s.place.map((p) => `${p.part} ${moveName(p.move)}`).join(', ')}</span>
                <button title="Earlier" disabled={busy || i === 0} onClick={() => void run('step', { move: { id: s.id, to: i } })}>↑</button>
                <button title="Later" disabled={busy || i === st.steps.length - 1} onClick={() => void run('step', { move: { id: s.id, to: i + 2 } })}>↓</button>
                <button title="Remove the step" disabled={busy} onClick={() => void run('step', { remove: s.id })}>×</button>
              </div>
              <textarea rows={2} style={{ width: '100%' }} value={t} placeholder="Put the lid on the box." onChange={(e) => setTexts({ ...texts, [s.id]: e.target.value })} onBlur={() => texts[s.id] !== undefined && texts[s.id] !== (s.text ?? '') && void run('text', { step: s.id, text: texts[s.id] })} />
              {found.length > 0 && (
                <ul style={{ margin: '2px 0', paddingLeft: '1.2em', fontSize: 11 }} data-test="asm-lint">
                  {found.map((f, j) => (
                    <li key={j}>{f.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
        <div style={{ borderTop: '1px solid var(--line, #ddd)', paddingTop: 6 }}>
          <div className="hint">New step: tick the parts it puts in</div>
          <div className="kv" style={{ flexWrap: 'wrap' }}>
            {st.parts
              .filter((p) => !placed.has(p.name))
              .map((p) => (
                <label key={p.name}>
                  <input type="checkbox" checked={pick.includes(p.name)} onChange={(e) => setPick(e.target.checked ? [...pick, p.name] : pick.filter((x) => x !== p.name))} /> {p.name}
                </label>
              ))}
          </div>
          <div className="kv">
            moving{' '}
            <select value={move} onChange={(e) => setMove(e.target.value)}>
              {MOVES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <button
              disabled={busy || pick.length === 0}
              onClick={() =>
                void run('step', { add: { place: pick.map((part) => ({ part, move })) } }).then((r) => {
                  if (r) setPick([])
                })
              }
            >
              Add step
            </button>
          </div>
        </div>
      </div>

      <div className="group">
        <div className="sec-head">Check</div>
        <div className="kv">
          <button
            disabled={busy || !st.steps.length}
            onClick={() =>
              void run('check', {}, 'Sweeping each part in…').then((r) => {
                if (r) useAsmView.setState({ checked: r })
              })
            }
          >
            Check it goes together
          </button>
          {v.checked && <span data-test="asm-check">{v.checked.ok ? 'Every part gets in' : 'Something is in the way'}</span>}
        </div>
        {v.checked && (
          <ul style={{ margin: '4px 0', paddingLeft: '1.2em', fontSize: 12 }}>
            {(v.checked.issues as Json[]).filter((x) => x.level !== 'note').map((x, i) => (
              <li key={i}>{x.message}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="group">
        <div className="sec-head">Pages</div>
        <div className="kv">
          <button className="primary" disabled={busy || !st.steps.length} onClick={() => void draw(v.url ? v.page : 1)}>Draw</button>
          <button disabled={busy || !v.url || v.page <= 0} onClick={() => void draw(v.page - 1)}>‹</button>
          <span>{v.url ? (v.page === 0 ? 'Cover' : `Step ${v.page} of ${v.pages}`) : ''}</span>
          <button disabled={busy || !v.url || v.page >= v.pages} onClick={() => void draw(v.page + 1)}>›</button>
          <label>
            <input type="checkbox" checked={v.onStage} onChange={(e) => useAsmView.setState({ onStage: e.target.checked })} /> On the stage
          </label>
        </div>
        {v.busy && <p className="hint">{v.busy}</p>}
        <div className="kv">
          <button disabled={busy || !st.steps.length} onClick={() => void save('html')}>Save HTML</button>
          <button disabled={busy || !st.steps.length} onClick={() => void save('pdf')}>Save PDF</button>
          <button disabled={busy || !st.steps.length} onClick={() => void save('zip')}>Both (.zip)</button>
        </div>
      </div>
    </div>
  )
}
