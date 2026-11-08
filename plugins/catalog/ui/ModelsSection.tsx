// SPDX-License-Identifier: AGPL-3.0-only
// Find a model: the model libraries searched from the panel — Sketchfab,
// Thingiverse, Cults3D — through the agent's server, which holds their keys.
// Results come back as cards with a picture, the designer and the licence;
// a model's files are listed and one brought into the imports folder with
// its licence recorded, then opened as the reference or the scan.

import { useAgentLink } from '../../../src/commands/agentLink'
import { runCommand } from '../../../src/commands/registry'
import { useStore } from '../../../src/state/store'
import { CopyButton } from '../../../src/ui/CopyButton'
import { InfoDot } from '../../../src/ui/InfoDot'
import { Status } from '../../_shared/ui/kit'
import { ask, useModels, type Library, type ModelFile, type ModelHit } from '../state/modelsStore'

const LIBS: { id: Library; label: string; note: string }[] = [
  { id: 'sketchfab', label: 'Sketchfab', note: 'Searches with no account; downloads take your Sketchfab API token' },
  { id: 'thingiverse', label: 'Thingiverse', note: 'Takes a Thingiverse app token' },
  { id: 'cults3d', label: 'Cults3D', note: 'Takes your Cults3D user name and API key; its files stay on its site' },
]

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
const mayShare = (l: string | null) => /creative commons|^cc[\s-]|cc0|public domain/i.test(l ?? '')
const size = (b: number | null) => (b === null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)

async function search(more = false) {
  const s = useModels.getState()
  const page = more ? s.page + 1 : 1
  useModels.setState({ busy: more ? 'More…' : 'Searching…', ...(more ? {} : { open: null, taken: null }) })
  try {
    const r = await ask<{ results: ModelHit[]; missing?: Record<string, string>; errors?: Record<string, string> }>('search', { query: s.query.trim(), sources: s.libraries, page })
    useModels.setState({ hits: more ? [...(s.hits ?? []), ...r.results] : r.results, page, missing: r.missing ?? {}, errors: r.errors ?? {} })
  } catch (e) {
    report(e)
  } finally {
    useModels.setState({ busy: null })
  }
}

async function openFiles(hit: ModelHit) {
  useModels.setState({ busy: 'Reading its files…', taken: null })
  try {
    const r = await ask<{ files: ModelFile[]; licence: string | null }>('files', { source: hit.source, id: hit.id })
    useModels.setState({ open: { hit, files: r.files, licence: r.licence ?? hit.licence } })
  } catch (e) {
    report(e)
  } finally {
    useModels.setState({ busy: null })
  }
}

async function bringIn(hit: ModelHit, file: ModelFile, licence: string | null) {
  useModels.setState({ busy: `Bringing in ${file.name}…` })
  try {
    const r = await ask<{ taken: string[]; url: string | null; licence: string | null; redistribute: boolean }>('take', { source: hit.source, id: hit.id, file: file.id }, 300_000)
    for (const p of r.taken) {
      const name = p.split(/[\\/]/).pop()!
      await runCommand('catalog.provenance', { action: 'record', file: name, source: hit.source, ...(r.url ?? hit.url ? { url: r.url ?? hit.url } : {}), ...(r.licence ?? licence ? { licence: r.licence ?? licence } : {}), redistribute: r.redistribute, note: `${hit.name}${hit.author ? ` by ${hit.author}` : ''}` })
    }
    useModels.setState({ taken: { hit, paths: r.taken } })
  } catch (e) {
    report(e)
  } finally {
    useModels.setState({ busy: null })
  }
}

async function openAs(path: string, as: 'reference' | 'scan') {
  const discard = as === 'scan' && Boolean(useStore.getState().fileName) && window.confirm('Open it as the scan in place of the one open now? Unsaved work on that scan is lost.')
  if (as === 'scan' && useStore.getState().fileName && !discard) return
  useModels.setState({ busy: 'Opening…' })
  try {
    await ask('open', { path, as, ...(discard ? { discard: true } : {}) }, 300_000)
  } catch (e) {
    report(e)
  } finally {
    useModels.setState({ busy: null })
  }
}

function Card({ hit }: { hit: ModelHit }) {
  const busy = useModels((s) => s.busy !== null)
  const shared = mayShare(hit.licence)
  return (
    <div className="cat-card" data-test="catalog-model" data-source={hit.source}>
      <a className="cat-thumb" href={hit.url} target="_blank" rel="noopener noreferrer" title={`Open ${hit.name} on ${LIBS.find((l) => l.id === hit.source)?.label}`}>
        {hit.thumbnail ? <img src={hit.thumbnail} alt="" /> : <span>No picture</span>}
        <i>{LIBS.find((l) => l.id === hit.source)?.label}</i>
      </a>
      <div className="cat-card-name" title={hit.name}>
        {hit.name}
      </div>
      <div className="cat-card-by">{hit.author ? `by ${hit.author}` : ' '}</div>
      <div className={`cat-licence ${shared ? 'ok' : 'warn'}`} title={hit.licence ? `${hit.licence}\n${shared ? 'May be shared on, crediting the designer' : 'For your own use: not to be shared on'}` : 'Licence not given here — see the page'}>
        {hit.licence ?? 'Licence on the page'}
        {hit.price && hit.price !== 'free' ? ` · ${hit.price}` : ''}
      </div>
      {hit.downloadable ? (
        <button disabled={busy} data-test="catalog-model-files" onClick={() => void openFiles(hit)}>
          Files…
        </button>
      ) : (
        <a className="button" href={hit.url} target="_blank" rel="noopener noreferrer" title="Its files are downloaded on its own site">
          On the site ↗
        </a>
      )}
    </div>
  )
}

function Opened() {
  const open = useModels((s) => s.open)
  const taken = useModels((s) => s.taken)
  const busy = useModels((s) => s.busy !== null)
  if (!open) return null
  const { hit, files, licence } = open
  return (
    <div className="pl-card live" data-test="catalog-model-open">
      <div className="pl-cardhead">
        <span className="name" title={hit.name}>
          {hit.name}
        </span>
        <button className="x" title="Close" onClick={() => useModels.setState({ open: null, taken: null })}>
          ×
        </button>
      </div>
      <Status tone={mayShare(licence) ? 'ok' : 'warn'}>{licence ? `${licence}${mayShare(licence) ? '' : ' — for your own use'}` : 'Read the licence on its page before you use it'}</Status>
      {files.length === 0 && <p className="hint">No files offered here.</p>}
      {files.map((f) => (
        <div key={f.id} className="kv">
          <span className="name" title={f.name}>
            {f.name}
          </span>
          <span className="pl-aside">{[f.format.toUpperCase(), size(f.size)].filter(Boolean).join(' · ')}</span>
          <button disabled={busy} data-test="catalog-model-take" title="Download it into the imports folder, with its licence recorded" onClick={() => void bringIn(hit, f, licence)}>
            Bring in
          </button>
        </div>
      ))}
      {taken && taken.hit.id === hit.id && (
        <div className="cat-taken" data-test="catalog-model-taken">
          {taken.paths.map((p) => (
            <div key={p}>
              <p className="hint" title={p}>
                Brought in: <b>{p.split(/[\\/]/).pop()}</b>, its licence recorded below.
              </p>
              <div className="toolrow">
                <button disabled={busy} title="Open it as the reference part, to compare the scan with" onClick={() => void openAs(p, 'reference')}>
                  Open as reference
                </button>
                <button disabled={busy} title="Open it as the part to work on" onClick={() => void openAs(p, 'scan')}>
                  Open as scan
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ModelsSection() {
  const st = useModels()
  const link = useAgentLink((s) => s.status)
  const busy = st.busy !== null
  const off = link !== 'connected'
  return (
    <div className="group" data-test="catalog-models">
      <div className="sec-head">
        Find a model
        <InfoDot title="Find a model">
          <p>Searches the model libraries through their own APIs — Sketchfab, Thingiverse and Cults3D — from your computer, with their keys kept in your Keychain. This page only sees the results.</p>
          <p>Bring in downloads a file into the imports folder and records where it came from and its licence; Share then credits it, or leaves it out if it may not be passed on.</p>
        </InfoDot>
      </div>
      {off && <p className="hint">Needs the agent connection (Settings → Agents, or open ScanRuler from Claude): the libraries are asked from your computer, where their keys are.</p>}
      <div className="toolrow">
        <input className="pl-input" type="text" value={st.query} placeholder="608 bearing holder, M18 battery mount…" disabled={busy || off} data-test="catalog-model-query" onChange={(e) => useModels.setState({ query: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && st.query.trim() && void search()} />
        <button className="primary" style={{ flex: 'none' }} disabled={busy || off || !st.query.trim() || !st.libraries.length} data-test="catalog-model-search" onClick={() => void search()}>
          Search
        </button>
      </div>
      <div className="pl-chips">
        {LIBS.map((l) => (
          <label key={l.id} title={st.missing[l.id] ? `Needs its key — ${st.missing[l.id]}` : l.note}>
            <input type="checkbox" checked={st.libraries.includes(l.id)} onChange={(e) => useModels.setState({ libraries: e.target.checked ? [...st.libraries, l.id] : st.libraries.filter((x) => x !== l.id) })} />
            {l.label}
          </label>
        ))}
      </div>
      {Object.entries(st.missing).map(([id, how]) => {
        const cmd = how?.match(/node mcp\S*.*$/)?.[0] ?? ''
        return (
          <div key={id} className="cat-missing" data-test="catalog-model-missing">
            <span>
              <b>{LIBS.find((l) => l.id === id)?.label}</b> needs its key: {how?.replace(/:\s*node mcp.*$/, '')}. In Terminal, in the ScanRuler folder:
            </span>
            <code>{cmd}</code>
            {cmd && <CopyButton label="Copy" onCopy={() => void navigator.clipboard.writeText(cmd)} />}
          </div>
        )
      })}
      {Object.entries(st.errors).map(([id, e]) => (
        <div key={id} className="cat-fit">
          <Status tone="bad">
            {LIBS.find((l) => l.id === id)?.label}: {e}
          </Status>
        </div>
      ))}
      {st.busy && (
        <p className="hint" data-test="catalog-model-busy">
          <span className="spinner" /> {st.busy}
        </p>
      )}
      <Opened />
      {st.hits && st.hits.length === 0 && <p className="hint">Nothing found. Try the words a listing would use — what it is, what it fits.</p>}
      {st.hits && st.hits.length > 0 && (
        <>
          <div className="cat-grid" data-test="catalog-model-grid">
            {st.hits.map((h) => (
              <Card key={`${h.source}:${h.id}`} hit={h} />
            ))}
          </div>
          <button className="block" disabled={busy} onClick={() => void search(true)}>
            More results
          </button>
        </>
      )}
    </div>
  )
}
