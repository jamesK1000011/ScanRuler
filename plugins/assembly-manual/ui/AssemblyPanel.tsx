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
import { Busy, Notes, Pager, Paper, Status } from '../../_shared/ui/kit'
import { bom } from '../core/assembly'
import { lint } from '../core/lint'
import { THEMES, themeOf } from '../core/themes'
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
  return <Paper url={url} alt="Manual page" testId="asm-page" />
}

const MOVES = ['down', 'up', '+x', '-x', '+y', '-y']
const MOVE_WORDS: Record<string, string> = { down: 'down', up: 'up', '+x': 'along +x', '-x': 'along −x', '+y': 'along +y', '-y': 'along −y' }
const moveName = (m: number[]) => ({ '0,0,-1': 'down', '0,0,1': 'up', '1,0,0': '+x', '-1,0,0': '-x', '0,1,0': '+y', '0,-1,0': '-y' })[m.join(',')] ?? `[${m.join(', ')}]`

/** "Screw 1 down, Screw 2 down" as "4 × Screw down". */
function placements(place: { part: string; move: number[] }[]) {
  const groups = new Map<string, number>()
  for (const p of place) {
    const key = `${p.part.replace(/\s*\d+$/, '')}\u0000${MOVE_WORDS[moveName(p.move)] ?? moveName(p.move)}`
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  return [...groups].map(([k, n]) => {
    const [part, move] = k.split('\u0000')
    return `${n > 1 ? `${n} × ` : ''}${n > 1 ? part : place.find((p) => p.part.replace(/\s*\d+$/, '') === part)!.part} ${move}`
  }).join(', ')
}

export function AssemblyPanel() {
  const st = useAsm()
  const v = useAsmView()
  const [pick, setPick] = useState<string[]>([])
  const [move, setMove] = useState('down')
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [accent, setAccent] = useState<string | null>(null)
  const busy = v.busy !== null
  const placed = new Set(st.steps.flatMap((s) => s.place.map((p) => p.part)))
  const rows = bom(st.parts)
  const left = st.parts.filter((p) => !placed.has(p.name))
  const none = !st.steps.length
  const issues = v.checked ? (v.checked.issues as Json[]).filter((x) => x.level !== 'note') : []

  return (
    <aside className="panel" data-test="asm-panel">
      <div className="group">
        <div className="sec-head">
          Assembly manual
          <InfoDot title="How it works">
            <p>List the parts — bodies in Reverse Engineer, in their assembled places — then the steps that put them in and the way each moves.</p>
            <p>Check sweeps every part in along its move against what is already there. Pages are drawn with the parts in place in grey and the step’s own in black.</p>
          </InfoDot>
        </div>
        <label className="field">
          <span>Title</span>
          <input
            key={st.settings.title}
            type="text"
            defaultValue={st.settings.title}
            disabled={busy}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            onBlur={(e) => e.target.value.trim() && e.target.value !== st.settings.title && void run('settings', { title: e.target.value.trim() })}
          />
        </label>
        <label className="field">
          <span>
            Look
            <InfoDot title="Themes">
              {THEMES.map((t) => (
                <p key={t.id}>
                  <b>{t.name}</b> — {t.about}
                </p>
              ))}
              <p>The theme sets the saved HTML’s type, colours and layout, and the accent and balloons on the PDF pages. The colour key puts your own accent over it.</p>
            </InfoDot>
          </span>
          <span className="pl-inline" style={{ flex: '0 1 172px', minWidth: 108 }}>
            <select className="grow" data-test="asm-theme" value={themeOf(st.settings).id} disabled={busy} onChange={(e) => void run('settings', { theme: e.target.value })}>
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              type="color"
              title={st.settings.accent ? 'Your accent — right-click for the theme’s own' : 'The theme’s accent — pick your own'}
              value={accent ?? themeOf(st.settings).accent}
              disabled={busy}
              style={{ width: 28, height: 26, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
              onChange={(e) => setAccent(e.target.value)}
              onBlur={() => {
                if (accent && accent !== themeOf(st.settings).accent) void run('settings', { accent })
                setAccent(null)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                if (st.settings.accent) void run('settings', { accent: '' })
              }}
            />
          </span>
        </label>
        <label className="field">
          <span>
            Writing style
            <InfoDot title="Writing style">
              <p>Each step’s words are checked as you write them. STE habits: one instruction a sentence, short sentences, the verb first, no “should”. Plain English is looser. A style file of your own can add words to avoid.</p>
            </InfoDot>
          </span>
          <select value={st.style.name} disabled={busy} onChange={(e) => void run('style', { name: e.target.value })}>
            <option value="ste100">STE habits</option>
            <option value="plain">Plain English</option>
            {st.style.custom && <option value="custom">My style file</option>}
          </select>
        </label>
      </div>

      <div className="group">
        <div className="sec-head">
          Parts <b>{rows.length || ''}</b>
        </div>
        {st.parts.length === 0 && <p className="hint">Name the bodies in Reverse Engineer, then take them in as parts.</p>}
        <div>
          {rows.map((r) => (
            <div className="kv" key={r.item} data-test="asm-bom">
              <span className="pl-num">{r.item}</span>
              <span className="name">
                {r.qty} × {r.name}
              </span>
              <span className="pl-aside">{r.designation ?? r.source ?? ''}</span>
            </div>
          ))}
        </div>
        <div className="toolrow">
          <button disabled={busy} onClick={() => void run('parts', { fromBodies: true })}>
            Take in the bodies
          </button>
        </div>
        {st.parts.some((p) => p.kind === 'part' && /\d+$/.test(p.name)) && (
          <p className="hint">Parts named “Screw 1”, “Screw 2”… with one designation come out as one item with a count: set it with asm.parts, or ask the agent.</p>
        )}
      </div>

      <div className="group">
        <div className="sec-head">
          Steps <b>{st.steps.length || ''}</b>
        </div>
        {st.steps.map((s, i) => {
          const t = texts[s.id] ?? s.text ?? ''
          const found = t ? lint(t, st.style) : []
          return (
            <div key={s.id} className="pl-card" data-test="asm-step">
              <div className="pl-cardhead">
                <span className="pl-num">{i + 1}</span>
                <span className="pl-aside" title={s.place.map((p) => `${p.part} ${moveName(p.move)}`).join(', ')}>
                  {placements(s.place)}
                </span>
                <button className="x edit" title="Earlier" disabled={busy || i === 0} onClick={() => void run('step', { move: { id: s.id, to: i } })}>
                  ↑
                </button>
                <button className="x edit" title="Later" disabled={busy || i === st.steps.length - 1} onClick={() => void run('step', { move: { id: s.id, to: i + 2 } })}>
                  ↓
                </button>
                <button className="x" title="Remove the step" disabled={busy} onClick={() => void run('step', { remove: s.id })}>
                  ×
                </button>
              </div>
              <textarea
                className="pl-text"
                rows={2}
                value={t}
                placeholder="Put the lid on the box."
                onChange={(e) => setTexts({ ...texts, [s.id]: e.target.value })}
                onBlur={() => texts[s.id] !== undefined && texts[s.id] !== (s.text ?? '') && void run('text', { step: s.id, text: texts[s.id] })}
              />
              <Notes testId="asm-lint" items={found.map((f) => ({ level: 'warn', text: f.message }))} />
            </div>
          )
        })}
        {left.length > 0 && (
          <div className="pl-card live">
            <div className="pl-cardhead">
              <span className="name">New step</span>
              <span className="pl-aside">tick the parts it puts in</span>
            </div>
            <div className="pl-chips">
              {left.map((p) => (
                <label key={p.name}>
                  <input type="checkbox" checked={pick.includes(p.name)} onChange={(e) => setPick(e.target.checked ? [...pick, p.name] : pick.filter((x) => x !== p.name))} />
                  {p.name}
                </label>
              ))}
            </div>
            <div className="toolrow">
              <select value={move} title="The way the parts go in" onChange={(e) => setMove(e.target.value)}>
                {MOVES.map((m) => (
                  <option key={m} value={m}>
                    Moving {MOVE_WORDS[m]}
                  </option>
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
        )}
      </div>

      <div className="group">
        <div className="sec-head">Check</div>
        <div className="toolrow">
          <button
            disabled={busy || none}
            onClick={() =>
              void run('check', {}, 'Sweeping each part in…').then((r) => {
                if (r) useAsmView.setState({ checked: r })
              })
            }
          >
            Check it goes together
          </button>
        </div>
        {v.checked && (
          <Status tone={v.checked.ok ? 'ok' : 'bad'} testId="asm-check">
            {v.checked.ok ? 'Every part gets in' : 'Something is in the way'}
          </Status>
        )}
        <Notes items={issues.map((x) => ({ level: x.level, text: x.message }))} />
      </div>

      <div className="group">
        <div className="sec-head">Pages</div>
        {v.url && (
          <Pager
            label={v.page === 0 ? 'Cover' : `Step ${v.page} of ${v.pages}`}
            canPrev={!busy && v.page > 0}
            canNext={!busy && v.page < v.pages}
            onPrev={() => void draw(v.page - 1)}
            onNext={() => void draw(v.page + 1)}
          />
        )}
        <div className="toolrow">
          <button className={v.url ? '' : 'primary'} disabled={busy || none} onClick={() => void draw(v.url ? v.page : 1)}>
            {v.url ? 'Redraw' : 'Draw'}
          </button>
        </div>
        <label className="checkrow">
          <input type="checkbox" checked={v.onStage} onChange={(e) => useAsmView.setState({ onStage: e.target.checked })} />
          Show the page on the stage
        </label>
        <Busy text={v.busy} />
      </div>

      <div className="divider" />
      <div className="tailrow">
        <button className="primary block" disabled={busy || none} onClick={() => void save('zip')}>
          Save the manual (.zip)
        </button>
        <div className="toolrow">
          <button disabled={busy || none} onClick={() => void save('html')}>
            Save HTML
          </button>
          <button disabled={busy || none} onClick={() => void save('pdf')}>
            Save PDF
          </button>
        </div>
      </div>
    </aside>
  )
}
