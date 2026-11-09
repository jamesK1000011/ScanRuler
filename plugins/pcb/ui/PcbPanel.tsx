// SPDX-License-Identifier: AGPL-3.0-only
// Electronics › KiCad's panel: the board file, its import, the enclosure,
// the fab package and the DRC. Every control runs a pcb.* command.

import { useEffect, useState } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { useStore } from '../../../src/state/store'
import { useLength } from '../../../src/app/useUnits'
import { saveFile } from '../../../src/app/exports'
import { InfoDot } from '../../../src/ui/InfoDot'
import { NumberField } from '../../../src/ui/NumberField'
import { Busy, Status, TextField } from '../../_shared/ui/kit'
import { usePcb } from '../state/pcbStore'
import './pcb.css'

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
const run = (name: string, input: Record<string, unknown> = {}) => runCommand(`pcb.${name}`, input).catch(report)

interface Param {
  key: string
  label: string
  kind: string
  min?: number
  step?: number
  tip: string
}

/** The enclosure's settings shown here; the rest are in Generate. */
const SHOWN = ['standoff', 'headroom', 'gap', 'wall', 'margin', 'inserts', 'cutouts']

const SIDE: Record<string, string> = { '+x': 'right', '-x': 'left', '+y': 'back', '-y': 'front' }

/** pcb.plan's answer, as far as the preview reads it. */
interface Plan {
  notes: string[]
  plan?: {
    W: number
    D: number
    height: number
    standoffs: { ref?: string; screw: string | null; note?: string }[]
    openings: { side: string; label?: string; w: number; lo: number; hi: number; round: boolean }[]
  }
}

async function fabNow() {
  const r = (await run('fab')) as { file?: { name: string; mimeType: string; bytes: Uint8Array } } | undefined
  if (r?.file) saveFile(r.file.name, new Blob([r.file.bytes as BlobPart], { type: r.file.mimeType }))
}

export function PcbPanel() {
  const s = usePcb()
  const len = useLength()
  const [params, setParams] = useState<{ params: Param[]; defaults: Record<string, number | boolean> } | null>(null)
  useEffect(() => {
    // The enclosure's parameters as Generate lists them.
    runCommand('gen.list', { generator: 'board_box' })
      .then((r) => {
        const g = (r as { generators: { params: Param[]; defaults: Record<string, number | boolean> }[] }).generators[0]
        setParams({ params: g.params, defaults: g.defaults })
      })
      .catch(() => setParams(null))
  }, [])
  const [preview, setPreview] = useState<Plan | null>(null)
  // A change of board or setting makes the preview stale.
  useEffect(() => setPreview(null), [s.board, s.enclosure, s.above, s.below, s.skip, s.imported])
  const busy = s.busy !== null
  const b = s.board
  const values = { ...(params?.defaults ?? {}), ...s.enclosure }
  return (
    <div className="group" data-test="pcb-panel">
      <div className="sec-head">
        Boards
        <InfoDot title="Boards">
          <p>A KiCad board brought in as solids, a box made round it, and its files for the board house. KiCad’s own kicad-cli does the KiCad work, on this computer, through the agent connection.</p>
        </InfoDot>
      </div>
      <div className="kv" data-test="pcb-tools">
        <span className="name">KiCad</span>
        <span className="pl-aside">{s.tools ? (s.tools.found ? `${s.tools.version ?? '?'}${s.tools.ready ? '' : ' — not usable'}` : 'not found') : 'not checked'}</span>
        <button disabled={busy} title="Look for kicad-cli on this computer" onClick={() => void run('tools', { fresh: true })}>
          Check
        </button>
      </div>
      {s.tools?.note && <Status tone={s.tools.ready ? 'idle' : 'warn'}>{s.tools.note}</Status>}

      <TextField label="Board file" value={s.path} placeholder="/path/to/board.kicad_pcb" disabled={busy} testId="pcb-path" onCommit={(v) => void (v.trim() ? run('open', { path: v.trim() }) : run('close'))} />
      {b && (
        <div className="pl-card live" data-test="pcb-board">
          <div className="kv">
            <span className="name">{b.name}</span>
            <span className="pl-aside">
              {len.fmt(b.size[0], 1)} × {len.fmt(b.size[1], 1)} × {len.fmt(b.thickness, 2)}
            </span>
          </div>
          <p className="hint">
            {b.holes.length} mounting hole{b.holes.length === 1 ? '' : 's'}, {b.connectors.length} connector{b.connectors.length === 1 ? '' : 's'} at the edge, {b.footprints.count} footprints
          </p>
          {b.connectors.map((c) => (
            <label key={c.ref} className="pcb-row" title={`${c.footprint}${c.opening.typical ? ' — typical opening size' : ''}`}>
              <input type="checkbox" aria-label={`Opening for ${c.ref}`} disabled={busy} checked={!s.skip.includes(c.ref)} onChange={(e) => void run('set', { skip: e.target.checked ? s.skip.filter((r) => r !== c.ref) : [...s.skip, c.ref] })} />
              <span>
                {c.ref} {c.label}
              </span>
              <span className="pl-aside">{SIDE[c.side]}</span>
            </label>
          ))}
        </div>
      )}

      <div className="pcb-checks">
        <label title="Bring the parts in with the board, each a body">
          <input type="checkbox" disabled={busy} checked={s.components} onChange={(e) => void run('set', { components: e.target.checked })} /> With parts
        </label>
        <label title="KiCad’s STEP models in place of VRML ones of the same name">
          <input type="checkbox" disabled={busy} checked={s.subst} onChange={(e) => void run('set', { subst: e.target.checked })} /> STEP models
        </label>
      </div>
      <div className="toolrow">
        <button className="primary" disabled={busy || !s.path} data-test="pcb-import" title="Export the board as STEP and bring it into Reverse Engineer" onClick={() => void run('import')}>
          Import
        </button>
      </div>
      {s.imported && (
        <div className="pl-card" data-test="pcb-imported">
          <div className="kv">
            <span className="name">{s.imported.body ?? 'Imported'}</span>
            <span className="pl-aside">{s.imported.bodies} bodies</span>
          </div>
          <p className="hint">
            Parts reach {len.fmt(s.imported.above, 1)} above, {len.fmt(s.imported.below, 1)} below.
            {s.imported.warnings.length ? ` KiCad: ${s.imported.warnings.length} warning${s.imported.warnings.length === 1 ? '' : 's'} (3D models not found).` : ''}
          </p>
          {(s.imported.placeholders?.length ?? 0) > 0 && (
            <Status tone="warn" testId="pcb-placeholders">
              No 3D model for {s.imported.placeholders!.join(', ')}: placeholder boxes stand in for them, not the real parts.
            </Status>
          )}
        </div>
      )}

      <div className="sec-head">Enclosure</div>
      {!params && <Status tone="idle">The enclosure comes from the Generate workspace.</Status>}
      {params &&
        params.params
          .filter((p) => SHOWN.includes(p.key))
          .map((p) =>
            p.kind === 'bool' ? (
              <label key={p.key} className="pcb-row" title={p.tip}>
                <input type="checkbox" aria-label={p.label} disabled={busy} checked={values[p.key] === true} onChange={(e) => void run('set', { enclosure: { [p.key]: e.target.checked } })} />
                <span>{p.label}</span>
              </label>
            ) : (
              <NumberField key={p.key} label={p.label} testId={`pcb-${p.key}`} value={values[p.key] as number} step={p.step ?? 0.1} min={p.min ?? 0} kind="length" disabled={busy} hint={<p>{p.tip}</p>} onCommit={(v) => void run('set', { enclosure: { [p.key]: v } })} />
            ),
          )}
      <NumberField label="Parts above" testId="pcb-above" value={s.above ?? s.imported?.above ?? 0} step={0.5} min={0} kind="length" disabled={busy} hint={<p>How far the parts reach above the board; measured on import unless set here.</p>} onCommit={(v) => void run('set', { above: v })} />
      <NumberField label="Parts below" testId="pcb-below" value={s.below ?? s.imported?.below ?? 0} step={0.5} min={0} kind="length" disabled={busy} hint={<p>How far pins and parts reach below the board.</p>} onCommit={(v) => void run('set', { below: v })} />
      <div className="toolrow">
        <button disabled={busy || !b || !params} data-test="pcb-plan" title="Sizes, standoffs and openings, nothing made" onClick={() => void run('plan').then((r) => r && setPreview(r as Plan))}>
          Preview
        </button>
        <button className="primary" disabled={busy || !b || !params} data-test="pcb-enclosure" title="Make the box and lid round the board in Reverse Engineer" onClick={() => void run('enclosure')}>
          Make enclosure
        </button>
        <button disabled={busy || (!Object.keys(s.enclosure).length && s.above === null && s.below === null)} title="Reset the enclosure settings and re-measure the parts" onClick={() => void run('set', { reset: true, above: null, below: null })}>
          Defaults
        </button>
      </div>
      {preview?.plan && (
        <div className="pl-card" data-test="pcb-plan-result">
          <div className="kv">
            <span className="name">Box</span>
            <span className="pl-aside">
              {len.fmt(preview.plan.W, 1)} × {len.fmt(preview.plan.D, 1)} × {len.fmt(preview.plan.height, 1)}
            </span>
          </div>
          <p className="hint">
            {preview.plan.standoffs.filter((x) => x.screw).length} standoff{preview.plan.standoffs.filter((x) => x.screw).length === 1 ? '' : 's'}
            {preview.plan.standoffs.some((x) => x.screw) ? ` (${[...new Set(preview.plan.standoffs.map((x) => x.screw).filter(Boolean))].join(', ')})` : ''}, {preview.plan.openings.length} opening{preview.plan.openings.length === 1 ? '' : 's'}
            {preview.plan.standoffs.some((x) => x.note) && (
              <InfoDot title="Standoffs">
                <p>Some mounting holes get no standoff, or a standoff shorter than its insert: {preview.plan.standoffs.filter((x) => x.note).map((x) => x.ref ?? 'a hole').join(', ')}. A taller standoff or a thicker floor gives an insert its length.</p>
              </InfoDot>
            )}
          </p>
          {preview.plan.openings.map((o, i) => (
            <div key={i} className="kv">
              <span className="name">{o.label ?? 'Opening'}</span>
              <span className="pl-aside">
                {SIDE[o.side] ?? o.side}, {o.round ? `⌀${len.fmt(o.w, 1)}` : `${len.fmt(o.w, 1)} × ${len.fmt(o.hi - o.lo, 1)}`}
              </span>
            </div>
          ))}
          {preview.notes.length > 0 && (
            <Status tone="warn">
              {preview.notes.length} size{preview.notes.length === 1 ? '' : 's'} guessed
              <InfoDot title="Guessed sizes">
                <p>An opening sized as a typical part, or from its footprint with no 3D model, or the parts’ reach not measured. Check each part’s sheet, import the board with its parts, or set the reach above.</p>
              </InfoDot>
            </Status>
          )}
        </div>
      )}
      {s.enclosureMade && <p className="hint">Made: {s.enclosureMade.bodies.join(', ')}.</p>}

      <div className="sec-head">Fabrication</div>
      <label className="pcb-row" title="File naming: fab (JLCPCB, PCBWay) or KiCad’s own">
        <span>File names</span>
        <select value={s.naming} disabled={busy} aria-label="File names" onChange={(e) => void run('set', { naming: e.target.value })}>
          <option value="fab">Board house (JLCPCB, PCBWay)</option>
          <option value="kicad">KiCad’s own</option>
        </select>
      </label>
      <div className="toolrow">
        <button disabled={busy || !s.path} data-test="pcb-fab" title="Gerbers, drills, placement, parts list and DRC, zipped" onClick={() => void fabNow()}>
          Fab package
        </button>
        <button disabled={busy || !s.path} data-test="pcb-drc" title="KiCad’s design rule check" onClick={() => void run('drc')}>
          Check rules
        </button>
      </div>
      {s.fab && (
        <div className="pl-card" data-test="pcb-fab-result">
          <p className="hint" title={s.fab.job}>
            {s.fab.files.length} files, saved in {s.fab.job.split(/[\\/]/).pop()}
          </p>
          {s.fab.notes.map((n) => (
            <p key={n} className="hint">
              {n}
            </p>
          ))}
        </div>
      )}
      {s.drc && (
        <div className="pl-card" data-test="pcb-drc-result">
          <Status tone={s.drc.clean ? 'ok' : 'warn'}>{s.drc.clean ? 'No violations.' : `${s.drc.violations} violation${s.drc.violations === 1 ? '' : 's'}, ${s.drc.unconnected} unconnected`}</Status>
          {s.drc.items.slice(0, 8).map((i, n) => (
            <p key={n} className="hint">
              {i.severity}: {i.description}
            </p>
          ))}
        </div>
      )}
      <Busy text={s.busy ? `${s.busy}${s.progress ? ` ${s.progress}` : ''}` : null} />
      {busy && (
        <div className="toolrow">
          <button onClick={() => void run('stop')}>Stop</button>
        </div>
      )}
    </div>
  )
}
