// SPDX-License-Identifier: AGPL-3.0-only
// The Catalog workspace's panel: name a standard part from what was measured,
// look a size up, find a part's CAD on the catalogues and model libraries,
// and the record of where each file in the project came from. Every button
// runs the same catalog.* command an agent does. Downloads themselves are the
// person's: a link opens the page, and the agent's catalog_watch or
// catalog_take brings the file in.

import { useState } from 'react'
import { create } from 'zustand'
import { runCommand } from '../../../src/commands/registry'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { useLength } from '../../../src/app/useUnits'
import { Busy, Status } from '../../_shared/ui/kit'
import { KINDS, type Kind } from '../core/standards'
import { SOURCES } from '../core/links'
import { useCatalog } from '../state/catalogStore'
import { ModelsSection } from './ModelsSection'
import './catalog.css'

type Json = Record<string, any>

const useCatalogView = create<{ busy: string | null; matches: Json | null; found: Json[] | null; links: Json[] | null; query: string }>(() => ({ busy: null, matches: null, found: null, links: null, query: '' }))

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })

async function run(name: string, input: Json = {}, busy?: string): Promise<Json | null> {
  if (busy) useCatalogView.setState({ busy })
  try {
    return (await runCommand(`catalog.${name}`, input)) as Json
  } catch (e) {
    report(e)
    return null
  } finally {
    if (busy) useCatalogView.setState({ busy: null })
  }
}

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)} %`

/** Name a standard part from the dimensions measured on it. */
function Identify() {
  const len = useLength()
  const busy = useCatalogView((s) => s.busy !== null)
  const matches = useCatalogView((s) => s.matches)
  const [kind, setKind] = useState<Kind>('socket-head-screw')
  const [dims, setDims] = useState<Record<string, string>>({})
  const info = KINDS.find((k) => k.kind === kind)!
  const typed = Object.fromEntries(
    Object.keys(info.dims)
      .map((k) => [k, len.fromDisplay(Number(dims[k]))] as const)
      .filter(([k, v]) => dims[k]?.trim() && Number.isFinite(v) && v > 0),
  )
  const go = async () => {
    const r = await run('match', { dims: typed, kind }, 'Matching…')
    if (r) useCatalogView.setState({ matches: r })
  }
  return (
    <div className="group">
      <div className="sec-head">
        Identify a part
        <InfoDot title="Identify a part">
          <p>Measure the part — element fits, a section, or calipers — and type what you read. The standard sizes that fit come back best first, with how far off the worst dimension is.</p>
          <p>Worn, printed or a maker's own range fits loosely; under about 3 % off is a good fit.</p>
        </InfoDot>
      </div>
      <label className="field">
        <span>Kind</span>
        <select
          value={kind}
          disabled={busy}
          onChange={(e) => {
            setKind(e.target.value as Kind)
            setDims({})
            useCatalogView.setState({ matches: null })
          }}
        >
          {KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {Object.entries(info.dims).map(([k, words]) => (
        <label className="field" key={k} title={`${k}: ${words}`}>
          <span>{words[0].toUpperCase() + words.slice(1)}</span>
          <span className="unitfield">
            <input type="number" min={0} step={len.step(0.01)} value={dims[k] ?? ''} disabled={busy} data-test={`catalog-dim-${k}`} placeholder="—" onChange={(e) => setDims({ ...dims, [k]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && Object.keys(typed).length && void go()} />
            <i>{len.word()}</i>
          </span>
        </label>
      ))}
      <button className="primary block" disabled={busy || !Object.keys(typed).length} data-test="catalog-match" onClick={() => void go()}>
        Find the size
      </button>
      {matches && (
        <div className="cat-list" data-test="catalog-matches">
          <div className="cat-fit">
            <Status tone={matches.fit === 'good' ? 'ok' : matches.fit === 'loose' ? 'warn' : 'bad'}>{matches.fit === 'good' ? 'A good fit' : matches.fit === 'loose' ? 'A loose fit — check another dimension' : 'Nothing close'}</Status>
          </div>
          {(matches.matches as Json[]).map((m) => (
            <button key={m.designation} className="kv cat-row" title={`${m.standard}\n${(m.agree as Json[] | undefined)?.map((a) => `${a.dim}: ${len.fmt(a.nominal, 2)} nominal, ${len.fmt(a.measured, 2)} measured`).join('\n') ?? ''}\n\nClick to look for its CAD`} onClick={() => useCatalogView.setState({ query: `${m.designation} ${m.standard}` })}>
              <span className="name">{m.designation}</span>
              <span className="pl-aside">{m.standard}</span>
              <b>{pct(m.worst)}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A size's nominal dimensions by name. */
function Lookup() {
  const len = useLength()
  const busy = useCatalogView((s) => s.busy !== null)
  const found = useCatalogView((s) => s.found)
  const [name, setName] = useState('')
  const go = async () => {
    const r = await run('lookup', { designation: name.trim() }, 'Looking up…')
    useCatalogView.setState({ found: r ? (r.parts as Json[]) : null })
  }
  return (
    <div className="group">
      <div className="sec-head">Look up a size</div>
      <div className="toolrow">
        <input className="pl-input" type="text" value={name} placeholder="M5 socket head, 608, M8 washer…" aria-label="Look up a standard part" disabled={busy} data-test="catalog-lookup-name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && void go()} />
        <button disabled={busy || !name.trim()} style={{ flex: 'none' }} onClick={() => void go()}>
          Look up
        </button>
      </div>
      {found && (
        <div className="cat-list" data-test="catalog-found">
          {found.slice(0, 12).map((p) => {
            const words = KINDS.find((k) => k.kind === p.kind)?.dims ?? {}
            return (
              <div key={`${p.kind}-${p.designation}`} className="cat-part">
                <div className="kv">
                  <span className="name">{p.designation}</span>
                  <span className="pl-aside">{p.standard}</span>
                </div>
                <dl className="pl-facts">
                  {Object.entries(p.dims as Record<string, number>).map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt>{(words as Record<string, string>)[k] ?? k}</dt>
                      <dd>{len.fmt(v, 2)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )
          })}
          {found.length > 12 && <p className="hint">And {found.length - 12} more: name the size more closely.</p>}
        </div>
      )}
    </div>
  )
}

/** Search pages on the catalogues and model libraries. */
function FindCad() {
  const busy = useCatalogView((s) => s.busy !== null)
  const query = useCatalogView((s) => s.query)
  const links = useCatalogView((s) => s.links)
  const [only, setOnly] = useState<string[]>(SOURCES.map((s) => s.id))
  const go = async () => {
    const r = await run('links', { query: query.trim(), sources: only })
    useCatalogView.setState({ links: r ? (r.links as Json[]) : null })
  }
  return (
    <div className="group">
      <div className="sec-head">
        Catalogues
        <InfoDot title="Catalogues">
          <p>For a part a maker sells — a screw, a bearing, a motor — opens each catalogue's own search in your browser. You sign in where a site asks and click download yourself — nothing is fetched behind your back.</p>
          <p>Ask Claude to watch your downloads: what arrives is brought into the project with its source and licence, and recorded below.</p>
        </InfoDot>
      </div>
      <div className="toolrow">
        <input className="pl-input" type="text" value={query} placeholder="M5 x 16 socket head ISO 4762, 608 bearing…" aria-label="Search the catalogues" disabled={busy} data-test="catalog-query" onChange={(e) => useCatalogView.setState({ query: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && query.trim() && only.length > 0 && void go()} />
        <button disabled={busy || !query.trim() || !only.length} style={{ flex: 'none' }} data-test="catalog-links" onClick={() => void go()}>
          Search
        </button>
      </div>
      <div className="pl-chips">
        {SOURCES.map((s) => (
          <label key={s.id} title={s.terms}>
            <input type="checkbox" checked={only.includes(s.id)} onChange={(e) => setOnly(e.target.checked ? [...only, s.id] : only.filter((x) => x !== s.id))} />
            {s.label}
          </label>
        ))}
      </div>
      {links && (
        <div className="cat-list" data-test="catalog-link-list">
          {links.map((l) => (
            <a key={l.source} className="kv cat-row" href={l.url} target="_blank" rel="noopener noreferrer" title={`${l.terms}\n\n${l.url}`}>
              <span className="name">{l.label}</span>
              <span className="pl-aside">{l.kind === 'catalogue' ? 'Catalogue' : 'Model library'}</span>
              <b>Open ↗</b>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

const EMPTY = { file: '', source: 'printables', url: '', licence: '', redistribute: false }

/** Where each file in the project came from. */
function Provenance() {
  const parts = useCatalog((s) => s.parts)
  const busy = useCatalogView((s) => s.busy !== null)
  const [draft, setDraft] = useState(EMPTY)
  const [open, setOpen] = useState(false)
  const save = async () => {
    const r = await run('provenance', { action: 'record', file: draft.file.trim(), source: draft.source, ...(draft.url.trim() ? { url: draft.url.trim() } : {}), ...(draft.licence.trim() ? { licence: draft.licence.trim() } : {}), redistribute: draft.redistribute })
    if (r) {
      setDraft(EMPTY)
      setOpen(false)
    }
  }
  return (
    <div className="group">
      <div className="sec-head">
        Where parts came from <b>{parts.length || ''}</b>
        <InfoDot title="Where parts came from">
          <p>Each file brought into the project: where from, its page, its licence and whether it may be shared on. Kept with the project.</p>
          <p>Share (Library Pack) leaves out anything not to be shared on and links its page instead.</p>
        </InfoDot>
      </div>
      {parts.length === 0 && <p className="hint">Nothing recorded yet. A download brought in by Claude is recorded here; add one by hand below.</p>}
      {parts.map((p) => (
        <div key={p.file} className="pl-card" data-test="catalog-record">
          <div className="pl-cardhead">
            <span className="name" title={p.file}>
              {p.file}
            </span>
            <button className="x" title="Forget this record" disabled={busy} onClick={() => void run('provenance', { action: 'forget', file: p.file })}>
              ×
            </button>
          </div>
          <dl className="pl-facts">
            <dt>From</dt>
            <dd>{SOURCES.find((s) => s.id === p.source)?.label ?? p.source}</dd>
            {p.licence && (
              <>
                <dt>Licence</dt>
                <dd title={p.licence}>{p.licence}</dd>
              </>
            )}
            {p.url && /^https?:\/\//i.test(p.url) && (
              <>
                <dt>Page</dt>
                <dd>
                  <a href={p.url} target="_blank" rel="noopener noreferrer" title={p.url}>
                    {p.url.replace(/^https?:\/\/(www\.)?/, '')}
                  </a>
                </dd>
              </>
            )}
          </dl>
          <Status tone={p.redistribute ? 'ok' : 'warn'}>{p.redistribute ? 'May be shared on' : 'Not to be shared on — linked instead'}</Status>
        </div>
      ))}
      <details className="pl-fold" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Record a file by hand</summary>
        <label className="field pl-field">
          <span>File</span>
          <input className="pl-input" type="text" value={draft.file} placeholder="bracket.step" onChange={(e) => setDraft({ ...draft, file: e.target.value })} />
        </label>
        <label className="field">
          <span>From</span>
          <select value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })}>
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            <option value="other">Somewhere else</option>
          </select>
        </label>
        <label className="field pl-field">
          <span>Page</span>
          <input className="pl-input" type="text" value={draft.url} placeholder="https://…" onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
        </label>
        <label className="field pl-field">
          <span>Licence</span>
          <input className="pl-input" type="text" value={draft.licence} placeholder="as the page says: CC BY 4.0" onChange={(e) => setDraft({ ...draft, licence: e.target.value })} />
        </label>
        <label className="checkrow">
          <input type="checkbox" checked={draft.redistribute} onChange={(e) => setDraft({ ...draft, redistribute: e.target.checked })} />
          <span>Its licence lets it be shared on</span>
        </label>
        <button className="block" disabled={busy || !draft.file.trim()} onClick={() => void save()}>
          Record it
        </button>
      </details>
    </div>
  )
}

export function CatalogPanel() {
  const busy = useCatalogView((s) => s.busy)
  return (
    <aside className="panel" data-test="catalog-panel">
      <Busy text={busy} />
      <ModelsSection />
      <Identify />
      <Lookup />
      <FindCad />
      <Provenance />
    </aside>
  )
}
