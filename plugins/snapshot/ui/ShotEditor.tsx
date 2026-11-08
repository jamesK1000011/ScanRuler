// SPDX-License-Identifier: AGPL-3.0-only
// The markup view: the shot as large as the window allows, and tools to
// mark it — numbered pins with a comment each, arrows, boxes, circles and a
// pen, in three colours. Done keeps the marks with the shot and tells the
// agent; the shot itself is never changed.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { announce, drawMarks } from '../app/marks'
import { useShots, type ShotMark } from '../state/shotStore'

type Tool = ShotMark['kind']
const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'pin', label: 'Pin', key: 'P' },
  { id: 'arrow', label: 'Arrow', key: 'A' },
  { id: 'box', label: 'Box', key: 'B' },
  { id: 'circle', label: 'Circle', key: 'C' },
  { id: 'pen', label: 'Pen', key: 'D' },
]
const COLOURS = ['#e5262b', '#f2b705', '#1877c0']

export function ShotEditor() {
  const { shots, editing } = useShots()
  const shot = shots.find((s) => s.id === editing)
  const [marks, setMarks] = useState<ShotMark[]>([])
  const [note, setNote] = useState('')
  const [tool, setTool] = useState<Tool>('pin')
  const [colour, setColour] = useState(COLOURS[0])
  const [draft, setDraft] = useState<ShotMark | null>(null)
  const [focusPin, setFocusPin] = useState<number | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const img = useRef<HTMLImageElement | null>(null)
  const [fit, setFit] = useState({ w: 0, h: 0, s: 1 })

  useEffect(() => {
    if (!shot) return
    setMarks(shot.marks)
    setNote(shot.note)
    const i = new Image()
    i.onload = () => {
      img.current = i
      resize()
    }
    i.src = shot.url
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot?.id])

  const resize = () => {
    if (!shot || !stage.current) return
    const r = stage.current.getBoundingClientRect()
    const s = Math.min((r.width - 24) / shot.width, (r.height - 24) / shot.height, 1)
    setFit({ w: Math.round(shot.width * s), h: Math.round(shot.height * s), s })
  }
  useEffect(() => {
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  })

  useEffect(() => {
    const c = canvas.current
    if (!c || !img.current || !shot || !fit.w) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(fit.w * dpr)
    c.height = Math.round(fit.h * dpr)
    const g = c.getContext('2d')!
    g.setTransform(fit.s * dpr, 0, 0, fit.s * dpr, 0, 0)
    g.drawImage(img.current, 0, 0, shot.width, shot.height)
    drawMarks(g, draft ? [...marks, draft] : marks, shot.width)
  }, [marks, draft, fit, shot])

  const close = () => useShots.setState({ editing: null })
  const done = () => {
    if (!shot) return
    useShots.getState().setMarks(shot.id, marks)
    useShots.getState().note(shot.id, note.trim())
    const now = useShots.getState().shots.find((s) => s.id === shot.id)
    close()
    if (now) announce(now)
  }

  useEffect(() => {
    if (!shot) return
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return
      if (e.key === 'Escape') close()
      else if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        setMarks((m) => m.slice(0, -1))
      } else {
        const t = TOOLS.find((x) => x.key === e.key.toUpperCase())
        if (t) setTool(t.id)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  if (!shot) return null
  const at = (e: ReactPointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / fit.s, (e.clientY - r.top) / fit.s]
  }
  const pins = marks.filter((m) => m.kind === 'pin')
  const nextPin = pins.reduce((n, m) => Math.max(n, m.n ?? 0), 0) + 1

  return (
    <div className="sn-editor" role="dialog" aria-label="Mark up the screenshot" data-test="snapshot-editor">
      <div className="sn-editor-stage" ref={stage}>
        <canvas
          ref={canvas}
          data-test="snapshot-canvas"
          style={{ width: fit.w, height: fit.h, cursor: tool === 'pin' ? 'copy' : 'crosshair' }}
          onPointerDown={(e) => {
            const [x, y] = at(e)
            if (tool === 'pin') {
              setMarks([...marks, { kind: 'pin', pts: [x, y], color: colour, n: nextPin, comment: '' }])
              setFocusPin(nextPin)
              return
            }
            ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)
            setDraft({ kind: tool, pts: [x, y, x, y], color: colour })
          }}
          onPointerMove={(e) => {
            if (!draft) return
            const [x, y] = at(e)
            setDraft(draft.kind === 'pen' ? { ...draft, pts: [...draft.pts, x, y] } : { ...draft, pts: [draft.pts[0], draft.pts[1], x, y] })
          }}
          onPointerUp={() => {
            if (!draft) return
            const [x0, y0] = draft.pts
            const [x1, y1] = draft.pts.slice(-2)
            if (Math.hypot(x1 - x0, y1 - y0) * fit.s > 4 || (draft.kind === 'pen' && draft.pts.length > 6)) setMarks([...marks, draft])
            setDraft(null)
          }}
        />
      </div>
      <aside className="sn-editor-side">
        <div className="sec-head">Mark up</div>
        <div className="moderow" role="toolbar" aria-label="Tools">
          {TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id ? 'on' : ''} title={`${t.label} (${t.key})`} data-test={`snapshot-tool-${t.id}`} onClick={() => setTool(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="sn-colours" role="radiogroup" aria-label="Colour">
          {COLOURS.map((c) => (
            <button key={c} role="radio" aria-checked={colour === c} className={colour === c ? 'on' : ''} style={{ background: c }} title={c} onClick={() => setColour(c)} />
          ))}
          <span className="grow" />
          <button disabled={!marks.length} title="Undo (⌘Z)" onClick={() => setMarks(marks.slice(0, -1))}>
            Undo
          </button>
          <button disabled={!marks.length} onClick={() => setMarks([])}>
            Clear
          </button>
        </div>
        <div className="sec-head">
          Pins <b>{pins.length || ''}</b>
        </div>
        {!pins.length && <p className="hint">Click the shot to drop a numbered pin, then say what is wrong there.</p>}
        {pins.map((p) => (
          <label key={p.n} className="sn-pin">
            <span className="sn-pin-n" style={{ background: p.color }}>
              {p.n}
            </span>
            <input
              className="pl-input"
              type="text"
              autoFocus={focusPin === p.n}
              data-test={`snapshot-pin-${p.n}`}
              placeholder="What’s wrong here?"
              value={p.comment ?? ''}
              onChange={(e) => setMarks(marks.map((m) => (m === p ? { ...m, comment: e.target.value } : m)))}
            />
            <button className="x" title="Remove the pin" onClick={() => setMarks(marks.filter((m) => m !== p))}>
              ×
            </button>
          </label>
        ))}
        <div className="sec-head">Note</div>
        <textarea className="pl-text" rows={3} value={note} placeholder="What to look at overall" onChange={(e) => setNote(e.target.value)} />
        <div className="pl-actions">
          <button className="primary" data-test="snapshot-done" onClick={done}>
            Done
          </button>
          <button onClick={close}>Cancel</button>
        </div>
        <p className="hint">Done keeps the marks with the shot and tells the agent. The shot underneath is kept as taken.</p>
      </aside>
    </div>
  )
}
