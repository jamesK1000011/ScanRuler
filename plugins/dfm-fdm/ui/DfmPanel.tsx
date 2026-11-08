// SPDX-License-Identifier: AGPL-3.0-only
// The Printability workspace's panel: what the part is printed on (nozzle,
// material, printer, a published guide), the check and its findings — each
// with its value against the limit, where it is, why, and a waiver with a
// reason — the rules in force and who set them, the guides compared on the
// stage, a guide imported or exported as JSON, the design review, and the
// report. Every button runs the dfm.* command an agent does.

import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { runCommand } from '../../../src/commands/registry'
import { saveFile } from '../../../src/app/exports'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { Busy, Notes, Status } from '../../_shared/ui/kit'
import { UPS } from '../core/frame'
import { useDfm } from '../state/dfmStore'
import './dfm.css'

type Json = Record<string, any>
type FileOut = { name: string; mimeType: string; bytes: Uint8Array }

export const useDfmView = create<{ busy: string | null; profiles: Json | null; rules: Json[] | null; compare: Json | null; onStage: boolean; review: Json[] | null; open: string | null; why: Json | null; waiving: string | null }>(() => ({
  busy: null,
  profiles: null,
  rules: null,
  compare: null,
  onStage: false,
  review: null,
  open: null,
  why: null,
  waiving: null,
}))

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e) })

async function run(name: string, input: Json = {}, busy?: string): Promise<Json | null> {
  if (busy) useDfmView.setState({ busy })
  try {
    return (await runCommand(`dfm.${name}`, input)) as Json
  } catch (e) {
    report(e)
    return null
  } finally {
    if (busy) useDfmView.setState({ busy: null })
  }
}

const loadProfiles = async () => {
  const p = await run('profiles')
  const r = await run('rules')
  useDfmView.setState({ profiles: p, rules: (r?.rules as Json[]) ?? null })
}

const UP_WORDS: Record<string, string> = { '+z': 'Top up (+z)', '-z': 'Upside down (−z)', '+x': '+x up', '-x': '−x up', '+y': '+y up', '-y': '−y up' }
const RULE_WORDS: Record<string, string> = {
  'thin-wall': 'Thin wall',
  overhang: 'Overhang',
  bridge: 'Bridge',
  'small-hole': 'Small hole',
  'bed-contact': 'Bed contact',
  'tall-thin': 'Tall and thin',
  'trapped-volume': 'Closed cavity',
  'mesh-health': 'Mesh',
  'build-volume': 'Build volume',
}
const PARAM_WORDS: Record<string, string> = { minMm: 'min', maxDeg: 'max', maxMm: 'max', minDiameterMm: 'min Ø', minShare: 'min share', maxRatio: 'max ratio', minVolumeMm3: 'min', xMm: 'x', yMm: 'y', zMm: 'z', dualXMm: 'dual x', minAreaMm2: 'area ≥' }
const unitOf = (k: string) => (/Deg$/.test(k) ? '°' : /Mm3$/.test(k) ? ' mm³' : /Mm2$/.test(k) ? ' mm²' : /Mm$/.test(k) ? ' mm' : '')
const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2)).replace(/\.?0+$/, '')

function ProfileSelect({ label, value, list, field }: { label: string; value: string | null; list: Json[]; field: string }) {
  const busy = useDfmView((s) => s.busy !== null)
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value ?? ''}
        disabled={busy}
        onChange={async (e) => {
          await run('settings', { [field]: e.target.value || null })
          await loadProfiles()
        }}
      >
        <option value="">None</option>
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label ?? p.id}
          </option>
        ))}
      </select>
    </label>
  )
}

export function CompareStage() {
  const v = useDfmView()
  if (!v.onStage || !v.compare) return null
  const guides = v.compare.guides as Json[]
  const chosen = useDfm.getState().settings.guide
  return (
    <div className="pl-stage dfm-stage" data-test="dfm-compare">
      <div className="dfm-sheet">
        <div className="sec-head">
          Published guides, side by side <b>{guides.length}</b>
        </div>
        <p className="hint">None is a standard. Where they disagree the row is marked; the check uses the guide chosen in the panel.</p>
        <div className="dfm-table-wrap">
          <table className="dfm-table">
            <thead>
              <tr>
                <th>Topic</th>
                {guides.map((g) => (
                  <th key={g.id} className={g.id === chosen ? 'on' : ''}>
                    <a href={g.url} target="_blank" rel="noreferrer noopener" title={`${g.publisher}, read ${g.read}`}>
                      {g.label}
                    </a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(v.compare.rows as Json[]).map((r) => (
                <tr key={r.topic} className={r.agree === false ? 'differ' : ''}>
                  <th>
                    {r.topic}
                    {r.agree === false && <small> {fmt(r.low)}–{fmt(r.high)}</small>}
                  </th>
                  {guides.map((g) => (
                    <td key={g.id} className={g.id === chosen ? 'on' : ''}>
                      {r.values[g.id] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={() => useDfmView.setState({ onStage: false })}>Back to the part</button>
      </div>
    </div>
  )
}

function RuleRow({ r }: { r: Json }) {
  const busy = useDfmView((s) => s.busy !== null)
  const own = useDfm((s) => s.overrides[r.id])
  const [open, setOpen] = useState(false)
  const [vals, setVals] = useState<Record<string, string>>({})
  const params = Object.entries(r.params as Record<string, number>)
  const save = async (extra: Json = {}) => {
    const changed = Object.fromEntries(Object.entries(vals).map(([k, x]) => [k, Number(x)]).filter(([, n]) => Number.isFinite(n as number)))
    if (await run('rules', { action: 'set', rule: r.id, ...(Object.keys(changed).length ? { params: changed } : {}), ...extra })) {
      setVals({})
      await loadProfiles()
    }
  }
  return (
    <div className={`dfm-rule${open ? ' open' : ''}`} data-test="dfm-rule" data-rule={r.id}>
      <button className={`kv dfm-rule-head${r.disabled ? ' ghost' : ''}`} title={`${r.rationale}\n\nSource: ${r.source}`} onClick={() => setOpen(!open)}>
        <span className="name">{RULE_WORDS[r.id] ?? r.id}</span>
        <b>
          {params
            .filter(([k]) => !/Area/.test(k))
            .slice(0, 2)
            .map(([k, n]) => `${PARAM_WORDS[k] ?? k} ${fmt(n)}${unitOf(k)}`)
            .join(' · ') || '—'}
        </b>
        <span className="pl-aside">{[...new Set(Object.values(r.setBy as Record<string, string>).filter((x) => x !== 'default'))].join(', ') || 'default'}</span>
      </button>
      {open && (
        <div className="pl-card">
          {params.map(([k, n]) => (
            <label key={k} className="field">
              <span>
                {PARAM_WORDS[k] ?? k}
                {unitOf(k) && <small> ({unitOf(k).trim()})</small>}
              </span>
              <input type="number" step="any" min={0} data-test={`dfm-param-${k}`} value={vals[k] ?? String(n)} disabled={busy} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
            </label>
          ))}
          <label className="checkrow">
            <input type="checkbox" checked={!r.disabled} disabled={busy} onChange={(e) => void save({ disabled: !e.target.checked })} />
            Checked
          </label>
          <div className="toolrow">
            <button className="primary" data-test="dfm-rule-save" disabled={busy || !Object.keys(vals).length} onClick={() => void save()}>
              Set for this project
            </button>
            <button
              disabled={busy || !own}
              title="Back to the profiles' and guide's numbers"
              onClick={async () => {
                if (await run('rules', { action: 'clear', rule: r.id })) {
                  setVals({})
                  await loadProfiles()
                }
              }}
            >
              Reset
            </button>
          </div>
          <p className="hint">{r.rationale}</p>
        </div>
      )}
    </div>
  )
}

export function DfmPanel() {
  const st = useDfm()
  const v = useDfmView()
  const scan = useStore((s) => s.fileName)
  const [reason, setReason] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const busy = v.busy !== null
  const s = st.settings
  const open = st.findings.filter((f) => !f.waived)
  const errors = open.filter((f) => f.severity === 'error').length
  const warnings = open.filter((f) => f.severity === 'warning').length
  const p = v.profiles
  useEffect(() => {
    void loadProfiles()
  }, [])
  const guides = (p?.guides as Json[]) ?? []

  const check = async () => {
    const r = await run('check', { detail: 'full' }, 'Checking the part…')
    if (r) await loadProfiles()
  }

  return (
    <aside className="panel" data-test="dfm-panel">
      <div className="group">
        <div className="sec-head">
          Printed on
          <InfoDot title="How the limits are set">
            <p>The rules start from a generic pack. The nozzle, material and printer profiles change the numbers they speak to, then a published guide if you choose one, then your own changes for this project. Each rule says which of them set its numbers.</p>
          </InfoDot>
        </div>
        <label className="field">
          <span>Stands up</span>
          <select value={s.up} disabled={busy} onChange={(e) => void run('settings', { up: e.target.value })}>
            {UPS.map((u) => (
              <option key={u} value={u}>
                {UP_WORDS[u]}
              </option>
            ))}
          </select>
        </label>
        <ProfileSelect label="Nozzle" value={s.nozzle} list={(p?.nozzles as Json[]) ?? []} field="nozzle" />
        <ProfileSelect label="Material" value={s.material} list={(p?.materials as Json[]) ?? []} field="material" />
        <ProfileSelect label="Printer" value={s.printer} list={(p?.printers as Json[]) ?? []} field="printer" />
        <label className="field">
          <span>
            Guide
            <InfoDot title="Published guides">
              <p>Design numbers from service bureaus, a printer maker and a university, each with its source and the date it was read. They disagree: compare them on the stage.</p>
            </InfoDot>
          </span>
          <select
            data-test="dfm-guide"
            value={s.guide ?? ''}
            disabled={busy}
            onChange={async (e) => {
              await run('settings', { guide: e.target.value || null })
              await loadProfiles()
            }}
          >
            <option value="">None</option>
            {guides.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
                {g.custom ? ' (imported)' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="sourcerow">
          <button className={s.target === 'scan' ? 'on' : ''} disabled={busy} onClick={() => void run('settings', { target: 'scan' })}>
            The scan
          </button>
          <button className={s.target === 'reference' ? 'on' : ''} disabled={busy} onClick={() => void run('settings', { target: 'reference' })}>
            The reference part
          </button>
        </div>
      </div>

      <div className="group">
        <div className="sec-head">
          Check <b>{st.checkedAt ? st.findings.length : ''}</b>
        </div>
        <div className="toolrow">
          <button className="primary" data-test="dfm-check" disabled={busy || (!scan && s.target === 'scan')} onClick={() => void check()}>
            {st.checkedAt ? 'Check again' : 'Check the part'}
          </button>
        </div>
        {!scan && s.target === 'scan' && <p className="hint">Open a scan, or switch to the reference part.</p>}
        <Busy text={v.busy} />
        {st.checkedAt && (
          <Status tone={errors ? 'bad' : warnings ? 'warn' : 'ok'} testId="dfm-verdict">
            {errors ? 'Fix before printing' : warnings ? 'Printable with care' : 'No findings'} — {errors} error{errors === 1 ? '' : 's'}, {warnings} warning{warnings === 1 ? '' : 's'}
            {st.findings.length - open.length ? `, ${st.findings.length - open.length} waived` : ''}
          </Status>
        )}
        {st.findings.map((f) => {
          const isOpen = v.open === f.id
          return (
            <div key={f.id} className={`pl-card dfm-finding${f.waived ? ' waived' : ''}`} data-test="dfm-finding" data-severity={f.severity}>
              <button className="dfm-finding-head" onClick={() => useDfmView.setState({ open: isOpen ? null : f.id, why: null, waiving: null })}>
                <span className="pl-num">{f.id}</span>
                <span className="name">{RULE_WORDS[f.rule] ?? f.rule}</span>
                <span className="dfm-value">
                  {fmt(f.value)}
                  {f.unit.startsWith('°') ? '°' : ` ${f.unit}`} <small>/ {fmt(f.limit)}</small>
                </span>
              </button>
              {f.waived && <p className="hint">Waived: {f.waived}</p>}
              {isOpen && (
                <>
                  <p className="hint">{f.says}</p>
                  <div className="toolrow">
                    <button
                      title="Turn the view to it"
                      onClick={() => void runCommand('view.set', { frame: { at: f.at, size: Math.max(20, Math.sqrt(f.areaMm2 ?? 100) * 3) } }).catch(report)}
                    >
                      Show
                    </button>
                    <button
                      onClick={async () => {
                        const r = await run('explain', { id: f.id })
                        useDfmView.setState({ why: r?.rule ?? null })
                      }}
                    >
                      Why
                    </button>
                    {f.waived ? (
                      <button onClick={() => void run('waive', { id: f.id, undo: true }).then(() => useDfm.setState({ findings: [...useDfm.getState().findings] }))}>Unwaive</button>
                    ) : (
                      <button onClick={() => useDfmView.setState({ waiving: v.waiving === f.id ? null : f.id })}>Waive…</button>
                    )}
                  </div>
                  {v.why && (
                    <Notes
                      items={[
                        { level: 'note', rule: 'limit', text: Object.entries(v.why.params as Record<string, number>).map(([k, n]) => `${PARAM_WORDS[k] ?? k} ${fmt(n)}${unitOf(k)} (${v.why!.setBy[k]})`).join(' · ') },
                        { level: 'note', rule: 'why', text: v.why.rationale },
                        { level: 'note', rule: 'source', text: v.why.source },
                      ]}
                    />
                  )}
                  {v.waiving === f.id && (
                    <div className="pl-inline">
                      <input className="pl-input grow" type="text" value={reason} placeholder="Why it is fine — drilled after printing…" data-test="dfm-reason" onChange={(e) => setReason(e.target.value)} />
                      <button
                        disabled={!reason.trim()}
                        onClick={async () => {
                          if (await run('waive', { id: f.id, reason })) {
                            setReason('')
                            useDfmView.setState({ waiving: null })
                            useDfm.setState({ findings: [...useDfm.getState().findings] })
                          }
                        }}
                      >
                        Waive
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
        {st.skipped.length > 0 && <Notes items={st.skipped.map((x) => ({ level: 'note', rule: RULE_WORDS[x.rule] ?? x.rule, text: `not checked: ${x.why}` }))} />}
      </div>

      <div className="group">
        <div className="sec-head">
          Rules in force
          <InfoDot title="Changing a rule">
            <p>Click a rule to change its numbers for this project, or switch it off. Your change sits over every profile and guide, and goes with the project; Reset takes it back.</p>
          </InfoDot>
        </div>
        <div>
          {(v.rules ?? []).map((r) => (
            <RuleRow key={r.id} r={r} />
          ))}
        </div>
      </div>

      <div className="group">
        <div className="sec-head">
          Guides <b>{guides.length || ''}</b>
        </div>
        <div className="toolrow">
          <button
            data-test="dfm-compare-open"
            disabled={busy}
            onClick={async () => {
              const r = await run('guides', { action: 'compare' })
              if (r) useDfmView.setState({ compare: r, onStage: true })
            }}
          >
            Compare on the stage
          </button>
        </div>
        <div className="toolrow">
          <button disabled={busy} onClick={() => file.current?.click()}>
            Import JSON…
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              const r = await run('guides', { action: 'export', label: 'My printability rules' })
              if (r) saveFile('dfm-guide.json', new Blob([JSON.stringify(r.guide, null, 2)], { type: 'application/json' }))
            }}
          >
            Export rules
          </button>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            hidden
            data-test="dfm-import"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              let guide: unknown
              try {
                guide = JSON.parse(await f.text())
              } catch {
                report(`${f.name} is not JSON.`)
                return
              }
              const r = await run('guides', { action: 'import', guide })
              if (r) {
                await run('settings', { guide: r.imported })
                await loadProfiles()
              }
            }}
          />
        </div>
        {guides.some((g) => g.custom) && (
          <div>
            {guides
              .filter((g) => g.custom)
              .map((g) => (
                <div key={g.id} className="kv">
                  <span className="name">{g.label}</span>
                  <span className="pl-aside">imported</span>
                  <button className="x" title="Remove the imported guide" onClick={() => void run('guides', { action: 'remove', id: g.id }).then(loadProfiles)}>
                    ×
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="group">
        <div className="sec-head">
          Design review
          <InfoDot title="Beyond the numbers">
            <p>The questions to ask of a printed part that no rule measures — in this plugin’s words. ISO/ASTM 52910 is the standard on design for additive manufacturing; it is named, not reproduced.</p>
          </InfoDot>
        </div>
        {!v.review ? (
          <div className="toolrow">
            <button
              data-test="dfm-review"
              onClick={async () => {
                const r = await run('considerations')
                if (r) useDfmView.setState({ review: r.considerations as Json[] })
              }}
            >
              Show the questions
            </button>
          </div>
        ) : (
          <Notes
            testId="dfm-review-list"
            items={v.review.map((c) => ({
              level: c.open ? 'warn' : c.checkedBy.length ? 'ok' : 'note',
              rule: c.checkedBy.length ? (c.open ? 'flagged' : 'checked') : 'yours',
              text: `${c.topic}: ${c.ask}`,
            }))}
          />
        )}
      </div>

      <div className="divider" />
      <div className="tailrow">
        <button
          className="primary block"
          disabled={busy || !st.checkedAt}
          onClick={async () => {
            const r = await run('report', { format: 'md' })
            if (r) saveFile((r.file as FileOut).name, new Blob([(r.file as FileOut).bytes as BlobPart], { type: (r.file as FileOut).mimeType }))
          }}
        >
          Save the report (.md)
        </button>
      </div>
    </aside>
  )
}
