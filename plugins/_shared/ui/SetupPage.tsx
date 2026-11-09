// SPDX-License-Identifier: AGPL-3.0-only
// A setup kind's page on the Make tab, for a kind with one page (cut,
// mill): its setups to pick from, the parts in the one picked, a Check
// that runs the kind's check on each of them, the findings, and the files
// it puts out. Everything runs the kind's commands, as an agent would; the
// settings are the Make tab's own, over the page.

import { useState, type ReactNode } from 'react'
import { saveBuilt } from '../../../src/app/exports'
import { runCommand } from '../../../src/commands/registry'
import { readStateSection } from '../../../src/commands/stateSections'
import { useHistory } from '../../../src/state/historyStore'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { bodyNameOf, setupsOf, setupTypeOf } from '../setups'
import { Busy, Notes, Status } from './kit'

type Json = Record<string, unknown>

interface Checked {
  body: string
  errors: number
  warnings: number
  findings: { severity: string; rule?: string; says: string }[]
  failed?: string
}

export interface PageExport {
  label: string
  title: string
  input: Json
}

export function SetupPage({ type, check, exportCommand, exports, heading, info, testId }: { type: string; check: string; exportCommand: string; exports: readonly PageExport[]; heading: string; info: ReactNode; testId: string }) {
  // The setups are another plugin's: read through the session, again on
  // every change the history records.
  useHistory((s) => s.past.length + s.future.length * 1e6 + s.revision * 1e9)
  const all = setupsOf().filter((s) => s.type === type)
  const selected = (readStateSection('setups') as { selected?: string | null } | undefined)?.selected
  const [picked, setPicked] = useState<string | null>(null)
  const setup = all.find((s) => s.id === picked) ?? all.find((s) => s.id === selected) ?? all[0] ?? null
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<{ setup: string; list: Checked[] } | null>(null)
  const label = setupTypeOf(type)?.label ?? type

  const runCheck = async () => {
    if (!setup) return
    const list: Checked[] = []
    for (const key of setup.bodies) {
      const name = bodyNameOf(key)
      setBusy(`Checking ${name}`)
      try {
        const r = (await runCommand(check, { body: /^\d+$/.test(key) ? Number(key) : key })) as Json
        list.push({ body: name, errors: Number(r.errors ?? 0), warnings: Number(r.warnings ?? 0), findings: (r.findings as Checked['findings']) ?? [] })
      } catch (e) {
        list.push({ body: name, errors: 0, warnings: 0, findings: [], failed: e instanceof Error ? e.message : String(e) })
      }
    }
    setBusy(null)
    setResults({ setup: setup.id, list })
  }
  const runExport = async (x: PageExport) => {
    if (!setup) return
    setBusy(`Making ${x.label}`)
    try {
      const r = (await runCommand(exportCommand, { setup: setup.id, ...x.input })) as { file: { name: string; mimeType: string; bytes: Uint8Array }; status?: string }
      saveBuilt({ ...r.file, status: r.status ?? `Saved ${r.file.name}.` })
    } catch (e) {
      useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }
  const shown = results && setup && results.setup === setup.id ? results.list : null

  return (
    <aside className="panel" data-test={testId}>
      <div className="group">
        <div className="sec-head">
          {heading}
          <InfoDot title={heading}>{info}</InfoDot>
        </div>
        {!all.length && <p className="hint">No {label.toLowerCase()} setup yet. Add one over this page, and pick its parts.</p>}
        {all.length > 1 && (
          <label className="field" title={`The ${label.toLowerCase()} setup shown`}>
            <span>Setup</span>
            <select value={setup?.id ?? ''} onChange={(e) => setPicked(e.target.value)}>
              {all.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {setup && !setup.bodies.length && <p className="hint">No parts in {setup.name} yet: pick them under Edit, over this page.</p>}
        {setup && setup.bodies.length > 0 && (
          <>
            <p className="hint">{setup.bodies.map(bodyNameOf).join(', ')}</p>
            <div className="toolrow">
              <button disabled={!!busy} data-test={`${testId}-check`} title="Check each part for this process" onClick={() => void runCheck()}>
                Check
              </button>
              {exports.map((x) => (
                <button key={x.label} disabled={!!busy} title={x.title} onClick={() => void runExport(x)}>
                  {x.label}
                </button>
              ))}
            </div>
          </>
        )}
        <Busy text={busy} />
        {shown?.map((c) => (
          <div key={c.body} className="pl-card" data-test={`${testId}-result`}>
            <div className="pl-cardhead">
              <span className="name">{c.body}</span>
            </div>
            {c.failed ? (
              <Status tone="bad">{c.failed}</Status>
            ) : (
              <Status tone={c.errors ? 'bad' : c.warnings ? 'warn' : 'ok'}>
                {c.errors ? 'Fix first' : c.warnings ? 'Can be made, with care' : 'No findings'} — {c.errors} error{c.errors === 1 ? '' : 's'}, {c.warnings} warning{c.warnings === 1 ? '' : 's'}
              </Status>
            )}
            <Notes items={c.findings.map((f) => ({ level: f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warn' : 'info', rule: f.rule, text: f.says }))} />
          </div>
        ))}
      </div>
    </aside>
  )
}
