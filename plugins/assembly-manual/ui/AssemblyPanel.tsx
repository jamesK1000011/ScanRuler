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
import { subAssemblies } from '../core/assembly'
import { stepLabels } from '../core/manual'
import { DEFAULT_SETTINGS } from '../core/model'
import { PRESETS, THEMES, themeOf } from '../core/themes'
import { TextField } from '../../_shared/ui/kit'
import { useAsm } from '../state/asmStore'

type Json = Record<string, any>
type FileOut = { name: string; mimeType: string; bytes: Uint8Array }

export const useAsmView = create<{ url: string | null; page: number; pages: number; on: number[]; onStage: boolean; checked: Json | null; review: Json[] | null; busy: string | null }>(() => ({ url: null, page: 1, pages: 0, on: [], onStage: true, checked: null, review: null, busy: null }))

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
  const r = await run('render', { page, format: 'png' }, page === 0 ? 'Drawing the cover…' : `Drawing page ${page + 1}…`)
  if (!r) return
  const f = r.file as FileOut
  const old = useAsmView.getState().url
  if (old) URL.revokeObjectURL(old)
  useAsmView.setState({ url: URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mimeType })), page, pages: (r.pages as number) - 1, on: (r.steps as number[]) ?? [] })
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
  const [sub, setSub] = useState('')
  const busy = v.busy !== null
  const set = { ...DEFAULT_SETTINGS, ...st.settings }
  const placed = new Set(st.steps.flatMap((s) => s.place.map((p) => p.part)))
  const subs = subAssemblies(st.steps)
  const labels = stepLabels(st.steps)
  const rows = bom(st.parts)
  const left = [...st.parts.map((p) => p.name), ...[...subs.keys()].filter((n) => n !== sub.trim())].filter((n) => !placed.has(n) && !(subs.get(sub.trim()) ?? []).includes(n))
  const preset = PRESETS.find((p) => Object.entries(p.settings).every(([k, val]) => set[k as keyof typeof set] === val))
  const pageLabel = v.page === 0 ? 'Cover' : v.on.length ? `Page ${v.page + 1} of ${v.pages + 1} · ${v.on.length === 1 ? `step ${labels[v.on[0] - 1]}` : `steps ${labels[v.on[0] - 1]}–${labels[v.on[v.on.length - 1] - 1]}`}` : `Page ${v.page + 1} of ${v.pages + 1} · hardware`
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
          Layout
          <InfoDot title="Presets">
            {PRESETS.map((p) => (
              <p key={p.id}>
                <b>{p.name}</b> — {p.about}
              </p>
            ))}
            <p>A preset only sets the switches below; change any after.</p>
          </InfoDot>
        </div>
        <label className="field">
          <span>Preset</span>
          <select data-test="asm-preset" value={preset?.id ?? ''} disabled={busy} onChange={(e) => e.target.value && void run('settings', { preset: e.target.value })}>
            {!preset && <option value="">Your own mix</option>}
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Steps a page</span>
          <select data-test="asm-layout" value={set.layout} disabled={busy} onChange={(e) => void run('settings', { layout: e.target.value })}>
            <option value="one">One</option>
            <option value="two">Two</option>
            <option value="grid4">Four</option>
            <option value="grid6">Six</option>
            <option value="auto">By size (auto)</option>
          </select>
        </label>
        <label className="field">
          <span>Parts list</span>
          <select value={set.partsBox} disabled={busy} onChange={(e) => void run('settings', { partsBox: e.target.value })}>
            <option value="side">Column at the side</option>
            <option value="corner">Box in the corner</option>
          </select>
        </label>
        <label className="checkrow">
          <input type="checkbox" checked={set.words === 'hide'} disabled={busy} onChange={(e) => void run('settings', { words: e.target.checked ? 'hide' : 'show' })} />
          Pictures only on the pages (the HTML keeps the words)
        </label>
        <label className="checkrow">
          <input type="checkbox" checked={set.hardwarePage} disabled={busy} onChange={(e) => void run('settings', { hardwarePage: e.target.checked })} />
          Hardware at 1:1 after the cover
        </label>
        <details className="pl-fold">
          <summary>About the product (cover)</summary>
          <TextField label="Product, model or part no." value={set.product ?? ''} disabled={busy} onCommit={(product) => void run('settings', { product })} />
          <TextField label="Version of this manual" value={set.version ?? ''} disabled={busy} onCommit={(version) => void run('settings', { version })} />
          <TextField label="Made by, and how to reach them" value={set.publisher ?? ''} disabled={busy} onCommit={(publisher) => void run('settings', { publisher })} />
          <TextField label="What it is for" value={set.intendedUse ?? ''} rows={2} disabled={busy} onCommit={(intendedUse) => void run('settings', { intendedUse })} />
          <TextField label="Safety (on the cover, as a WARNING)" value={set.safety ?? ''} rows={2} disabled={busy} onCommit={(safety) => void run('settings', { safety })} />
          <TextField label="Taking apart and disposal" value={set.disposal ?? ''} rows={2} disabled={busy} onCommit={(disposal) => void run('settings', { disposal })} />
        </details>
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
                <span className="pl-num">{labels[i]}</span>
                {s.sub && <span className="pl-num" title="Built apart as a sub-assembly">{s.sub}</span>}
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
              <Notes items={(s.warnings ?? []).map((w) => ({ level: w.level === 'notice' ? 'note' : w.level === 'danger' ? 'error' : 'warn', rule: w.level.toUpperCase(), text: w.text }))} />
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
              {left.map((n) => (
                <label key={n} title={subs.has(n) ? 'A sub-assembly, placed whole' : undefined}>
                  <input type="checkbox" checked={pick.includes(n)} onChange={(e) => setPick(e.target.checked ? [...pick, n] : pick.filter((x) => x !== n))} />
                  {subs.has(n) ? `▣ ${n}` : n}
                </label>
              ))}
            </div>
            <label className="field">
              <span>Builds</span>
              <input type="text" list="asm-subs" value={sub} placeholder="the main assembly" title="A sub-assembly’s name builds it apart; empty builds into the main assembly" onChange={(e) => setSub(e.target.value)} />
              <datalist id="asm-subs">
                {[...subs.keys()].map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </label>
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
                  void run('step', { add: { place: pick.map((part) => ({ part, move })), ...(sub.trim() ? { sub: sub.trim() } : {}) } }).then((r) => {
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
        <div className="toolrow">
          <button
            disabled={busy}
            title="What IEC/IEEE 82079-1 asks instructions for use to carry, in this plugin’s words — a checklist, not a certificate"
            onClick={() =>
              void run('review', {}).then((r) => {
                if (r) useAsmView.setState({ review: r.items as Json[] })
              })
            }
          >
            Review against 82079
          </button>
        </div>
        {v.review && (
          <Status tone={v.review.some((x) => !x.ok && x.level !== 'note') ? 'warn' : 'ok'} testId="asm-review">
            {v.review.filter((x) => !x.ok).length ? `${v.review.filter((x) => !x.ok).length} to look at` : 'Everything it asks for is there'}
          </Status>
        )}
        {v.review && <Notes items={v.review.filter((x) => !x.ok).map((x) => ({ level: x.level, rule: x.topic, text: `${x.message}${x.fix ? ` — ${x.fix}` : ''}` }))} />}
      </div>

      <div className="group">
        <div className="sec-head">Pages</div>
        {v.url && (
          <Pager
            label={pageLabel}
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
