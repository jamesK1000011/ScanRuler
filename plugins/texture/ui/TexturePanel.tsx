// SPDX-License-Identifier: AGPL-3.0-only
// The Texture workspace's panel: the layers, each one's texture and the
// settings that matter most, the surface it covers (painted with the
// app's marking tools), how the part is built, and the buttons that build
// it. Every control is the same verb an agent's command runs.

import { useEffect, useRef, useState } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { useLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { useMark } from '../../../src/state/markStore'
import { InfoDot } from '../../../src/ui/InfoDot'
import { MarkTools } from '../../../src/ui/MarkTools'
import { NumberField } from '../../../src/ui/NumberField'
import { MAX_LAYERS, useTexture, type LayerSettings, type MaskMode } from '../state/textureStore'
import { LIBRARY, thumbOf } from '../app/textureSession'

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
const layerCmd = (input: Record<string, unknown>) => { runCommand('texture.layer', input).catch(report) }
const outputCmd = (settings: Record<string, unknown>) => { runCommand('texture.output', { settings }).catch(report) }

const MODES: { id: number; label: string }[] = [
  { id: 5, label: 'Triplanar' },
  { id: 6, label: 'Cubic' },
  { id: 3, label: 'Cylindrical' },
  { id: 8, label: 'Outline wrap' },
  { id: 4, label: 'Spherical' },
  { id: 0, label: 'Planar XY' },
  { id: 1, label: 'Planar XZ' },
  { id: 2, label: 'Planar YZ' },
]

type Estimate = { subdividedTriangles: number; maxTriangles: number; squeezed: boolean; texturedAreaMm2: number; partAreaMm2: number }
type CheckAnswer = { moved: number; kept: number; protectedVertices: number; worstMm: number }

export interface TexturePanelProps {
  onPickTexture(name: string): void
  onImage(file: File): void
  onSettings(patch: Partial<LayerSettings>): void
  onMaskMode(mode: MaskMode): void
  onUseMarking(op: 'set' | 'add' | 'remove'): void
  onShowMask(): void
  onClearMask(): void
  onClearMarking(): void
  onPreview(): void
  onEstimate(): Promise<unknown>
  onCheck(): Promise<unknown>
  onExport(format: 'stl' | '3mf'): void
  onStop(): void
  onShow(what: 'result' | 'scan'): void
}

export function TexturePanel(p: TexturePanelProps) {
  const imageInput = useRef<HTMLInputElement>(null)
  const st = useTexture()
  const fileName = useStore((s) => s.fileName)
  const marked = useMark((s) => s.count)
  const [category, setCategory] = useState('grip')
  const len = useLength()
  // The last estimate and check, as their commands answered: a change of
  // setting makes the estimate stale, a new build the check.
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [check, setCheck] = useState<CheckAnswer | null>(null)
  useEffect(() => setEstimate(null), [st.layers, st.output])
  useEffect(() => setCheck(null), [st.result])
  const L = st.layers[st.active]
  const busy = st.status === 'running'
  const s = L.settings
  const categories = [...new Set(LIBRARY.map((t) => t.category))]

  if (!fileName) return <div className="panel"><p className="hint">Open a part to texture it.</p></div>

  return (
    <div className="panel" data-test="texture-panel">
      <div className="group">
        <div className="sec-head">
          Layers
          <InfoDot title="Texture layers">
            <p>
              Up to {MAX_LAYERS} layers, bottom first. Each has its own texture, settings and the surface it covers —
              a coarse pattern on the body, a fine grip on the panels. A layer covers the ones below where it reaches,
              or adds onto them.
            </p>
          </InfoDot>
        </div>
        <div className="moderow" role="radiogroup" aria-label="Layer">
          {st.layers.map((layer, i) => (
            <button key={layer.id} role="radio" aria-checked={i === st.active} className={i === st.active ? 'on' : undefined} disabled={busy} onClick={() => layerCmd({ action: 'activate', layer: i + 1 })} title={layer.texture?.name ?? 'No texture yet'}>
              {i + 1}{layer.visible ? '' : ' (hidden)'}
            </button>
          ))}
          <button disabled={busy || st.layers.length >= MAX_LAYERS} onClick={() => layerCmd({ action: 'add' })} title="Add a layer on top">+</button>
        </div>
        <div className="kv">
          <label><input type="checkbox" checked={L.visible} disabled={busy} onChange={(e) => layerCmd({ action: 'visible', layer: st.active + 1, visible: e.target.checked })} /> Shown</label>
          {st.active > 0 && (
            <label><input type="checkbox" checked={L.blend === 'add'} disabled={busy} onChange={(e) => layerCmd({ action: 'blend', layer: st.active + 1, blend: e.target.checked ? 'add' : 'cover' })} /> Add onto the layers below</label>
          )}
          <button disabled={busy} onClick={() => layerCmd({ action: 'remove', layer: st.active + 1 })}>Remove layer</button>
        </div>
      </div>

      <div className="group">
        <div className="sec-head">Texture{L.texture ? `: ${L.texture.name}` : ''}</div>
        <div className="field">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="texture-grid" data-test="texture-grid">
          {LIBRARY.filter((t) => t.category === category).map((t) => {
            const thumb = thumbOf(t)
            return (
              <button key={t.name} className={L.texture?.kind === 'library' && L.texture.name === t.name ? 'on' : undefined} title={t.name} disabled={busy} onClick={() => p.onPickTexture(t.name)}>
                {thumb ? <img src={thumb} alt="" /> : null}
                <span>{t.name}</span>
              </button>
            )
          })}
        </div>
        <div className="field">
          <span>Your own heightmap</span>
          <button disabled={busy} title="Greyscale image: white stands out, black sinks in" style={{ flex: '0 1 172px' }} onClick={() => imageInput.current?.click()}>
            Load an image…
          </button>
          <input ref={imageInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onImage(f); e.target.value = '' }} />
        </div>
      </div>

      {L.texture && (
        <div className="group">
          <div className="sec-head">Settings</div>
          <div className="field">
            <span>Mapping</span>
            <select title="How the texture is wrapped onto the part" value={s.mappingMode} disabled={busy} onChange={(e) => p.onSettings({ mappingMode: Number(e.target.value) })}>
              {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <NumberField label="Depth" kind="length" value={s.textureHeight} step={0.05} min={0} disabled={busy} onCommit={(v) => p.onSettings({ textureHeight: v })} hint="How far white in the image stands proud of the surface." />
          <NumberField label="Tile width" kind="length" value={s.scaleU} step={0.5} min={0.01} disabled={busy} onCommit={(v) => p.onSettings({ scaleU: v })} hint="One repeat of the image across." />
          {!s.lockScale && <NumberField label="Tile height" kind="length" value={s.scaleV} step={0.5} min={0.01} disabled={busy} onCommit={(v) => p.onSettings({ scaleV: v })} />}
          <NumberField label="Rotation" unit="°" value={s.rotation} step={5} min={-360} disabled={busy} onCommit={(v) => p.onSettings({ rotation: v })} />
          <NumberField label="Edge falloff" kind="length" value={s.boundaryFalloff} step={0.5} min={0} disabled={busy} onCommit={(v) => p.onSettings({ boundaryFalloff: v })} hint="Ramp the texture in over this distance from a masked edge." />
          <div className="kv">
            <label><input type="checkbox" checked={s.lockScale} disabled={busy} onChange={(e) => p.onSettings({ lockScale: e.target.checked })} /> Square tiles</label>
            <label><input type="checkbox" checked={s.invertDisplacement} disabled={busy} onChange={(e) => p.onSettings({ invertDisplacement: e.target.checked })} /> Into the surface</label>
            <label><input type="checkbox" checked={s.symmetricDisplacement} disabled={busy} onChange={(e) => p.onSettings({ symmetricDisplacement: e.target.checked })} /> Both ways</label>
            <label><input type="checkbox" checked={s.invertTexture} disabled={busy} onChange={(e) => p.onSettings({ invertTexture: e.target.checked })} /> Invert image</label>
            <label><input type="checkbox" checked={s.stampOnce} disabled={busy} onChange={(e) => p.onSettings({ stampOnce: e.target.checked })} /> Stamp once</label>
          </div>
        </div>
      )}

      <div className="group">
        <div className="sec-head">
          Where it goes
          <InfoDot title="Painting where the texture goes">
            <p>
              <b>Keep plain</b>: paint the surfaces that must stay as they are — a mating face, a cutout, a button.
              <b> Texture only</b>: paint the panels to texture, and the rest stays plain. Switching clears the paint.
            </p>
            <p>Mark with the window, brush or lasso, then take the marking into the layer. Window and lasso take only what you can see; Mark through the part reaches behind.</p>
          </InfoDot>
        </div>
        <div className="moderow" role="radiogroup" aria-label="Mask mode">
          {(['exclude', 'include'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={L.maskMode === m} className={L.maskMode === m ? 'on' : undefined} disabled={busy} onClick={() => p.onMaskMode(m)}>
              {m === 'exclude' ? 'Keep plain' : 'Texture only'}
            </button>
          ))}
        </div>
        <MarkTools escapeNote="The marking stays until you take it into the layer or clear it." onClear={p.onClearMarking} />
        <div className="toolrow">
          <button disabled={busy || marked === 0} title="The layer's region becomes what is marked" onClick={() => p.onUseMarking('set')}>Use marking</button>
          <button disabled={busy || marked === 0} title="What is marked joins the layer's region" onClick={() => p.onUseMarking('add')}>Add</button>
          <button disabled={busy || marked === 0} title="What is marked leaves the layer's region" onClick={() => p.onUseMarking('remove')}>Remove</button>
        </div>
        <div className="field">
          <span>{L.mask ? `${L.mask.length.toLocaleString()} vertices painted` : 'Nothing painted'}</span>
          <div className="toolrow" style={{ flex: '0 1 172px' }}>
            <button disabled={busy} title="Light the layer's region on the part" onClick={p.onShowMask}>Show</button>
            <button disabled={busy || !L.mask} title="Empty the layer's region" onClick={p.onClearMask}>Clear</button>
          </div>
        </div>
      </div>

      <div className="group">
        <div className="sec-head">Output</div>
        <NumberField label="Resolution" kind="length" value={st.output.refineLength} step={0.05} min={0.02} disabled={busy} onCommit={(v) => outputCmd({ refineLength: v })} hint="Edge length the textured surface is cut into. Smaller is finer and heavier." />
        <NumberField label="Triangle budget" value={st.output.maxTriangles} step={50000} min={1000} disabled={busy} onCommit={(v) => outputCmd({ maxTriangles: Math.round(v) })} />
        <NumberField label="Plain below" unit="°" value={st.output.bottomAngleLimit} step={1} min={0} disabled={busy} onCommit={(v) => outputCmd({ bottomAngleLimit: v })} hint="Faces within this angle of facing down stay plain — the bed face." />
        <label className="checkrow">
          <input type="checkbox" checked={st.output.preserveUntextured} disabled={busy} onChange={(e) => outputCmd({ preserveUntextured: e.target.checked })} />
          <span>Leave plain faces exactly as they are</span>
        </label>
      </div>

      <div className="group">
        {busy ? (
          <>
            <p className="hint"><span className="spinner" /> {st.progress ? `${st.progress.stage} — ${Math.round(st.progress.fraction * 100)}%` : 'Working…'}</p>
            <button onClick={p.onStop}>Stop</button>
          </>
        ) : (
          <>
            <button className="primary block" disabled={!st.layers.some((x) => x.texture)} onClick={p.onPreview}>Preview</button>
            <div className="toolrow">
              <button disabled={!st.layers.some((x) => x.texture)} data-test="texture-estimate" title="Triangles before a full build" onClick={() => void p.onEstimate().then((r) => r && setEstimate(r as Estimate))}>Estimate</button>
              <button disabled={!st.layers.some((x) => x.texture)} onClick={() => p.onExport('stl')}>Export STL</button>
              <button disabled={!st.layers.some((x) => x.texture)} onClick={() => p.onExport('3mf')}>Export 3MF</button>
            </div>
            {estimate && (
              <p className="hint" data-test="texture-estimated">
                About {estimate.subdividedTriangles.toLocaleString()} triangles
                {estimate.squeezed ? `, over the budget of ${estimate.maxTriangles.toLocaleString()}: it will be decimated coarser than the resolution.` : ', within the budget.'}
                <InfoDot title="The estimate">
                  <p>The triangles the textured surface comes to at the resolution, before it is decimated to the triangle budget. Over the budget, raise the budget for the finest result, or coarsen the resolution to build faster.</p>
                  <p>{Math.round((100 * estimate.texturedAreaMm2) / Math.max(estimate.partAreaMm2, 1))}% of the part's surface is textured.</p>
                </InfoDot>
              </p>
            )}
            {st.result?.kind === 'full' && (
              <div className="toolrow">
                <button data-test="texture-check" title="Plain surfaces unchanged after export?" onClick={() => void p.onCheck().then((r) => r && setCheck(r as CheckAnswer))}>Check plain surfaces</button>
              </div>
            )}
            {check && (
              <p className="hint" data-test="texture-checked" data-ok={check.moved === 0}>
                {check.moved === 0 ? `All ${check.kept.toLocaleString()} plain vertices are where they were.` : `${check.moved.toLocaleString()} of ${check.protectedVertices.toLocaleString()} plain vertices moved.`}
                <InfoDot title="The check">
                  <p>Every vertex of the surfaces no layer textures is looked for in the exported part at the same place.{check.moved > 0 ? ` The worst moved ${len.fmt(check.worstMm, 3)}.` : ''}</p>
                  {check.moved > 0 && !st.output.preserveUntextured && <p>Leave plain faces exactly as they are is off, so the plain faces were refined and decimated: turn it on.</p>}
                  <p>Vertices where plain meets textured may move with the texture beside them; Edge falloff softens that.</p>
                </InfoDot>
              </p>
            )}
          </>
        )}
        {st.result && !busy && (
          <p className="hint">
            {st.result.kind === 'preview' ? 'Preview' : 'Built'}: {st.result.triangles.toLocaleString()} triangles in {st.result.seconds} s.
            {' '}
            <button className="linklike" onClick={() => p.onShow(st.previewShown ? 'scan' : 'result')}>{st.previewShown ? 'Show the scan' : 'Show the result'}</button>
          </p>
        )}
        {st.result?.warnings.map((w) => <p key={w} className="hint">{w}</p>)}
        {st.error && !busy && <p className="hint">{st.error}</p>}
      </div>
    </div>
  )
}
