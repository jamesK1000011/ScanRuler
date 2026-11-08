// SPDX-License-Identifier: AGPL-3.0-only
// The camera button, bottom right over every workspace, and the card the
// shot just taken comes up in: a note to go with it, Save, Copy, Discard.

import { useEffect, useRef } from 'react'
import { saveFile } from '../../../src/app/exports'
import { IconFrame } from '../../../src/ui/icons'
import { fileName, takeShot } from '../app/capture'
import { announce, composite } from '../app/marks'
import { useShots } from '../state/shotStore'
import { ShotEditor } from './ShotEditor'
import '../../_shared/ui/kit.css'
import './snapshot.css'

function CameraIcon() {
  return (
    <IconFrame size={18}>
      <path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="13.2" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </IconFrame>
  )
}

async function copy(png: Uint8Array) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as BlobPart], { type: 'image/png' }) })])
    return true
  } catch {
    return false
  }
}

export function ShotButton() {
  const { shots, open, busy, error, save } = useShots()
  const box = useRef<HTMLDivElement>(null)
  const shot = shots.find((s) => s.id === open)

  // ⌥⇧S (Alt+Shift+S) takes a shot from anywhere but a text field: the
  // key press is the person's own gesture, which screen capture needs.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== 'KeyS') return
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]')) return
      e.preventDefault()
      void takeShot(box.current)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  return (
    <>
    <ShotEditor />
    <div ref={box} className="sn-dock">
      {shot && (
        <div className="sn-card" data-test="snapshot-card">
          <div className="pl-cardhead">
            <span className="name">Screenshot</span>
            <span className="pl-aside">
              {shot.workspace ? `${shot.workspace} · ` : ''}
              {new Date(shot.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <button className="x" title="Put the card away (the shot is kept)" onClick={() => useShots.setState({ open: null })}>
              ×
            </button>
          </div>
          <img src={shot.url} alt="The screenshot" className="sn-thumb" title="Mark it up" style={{ cursor: 'pointer' }} onClick={() => useShots.setState({ editing: shot.id })} />
          {shot.marks.length > 0 && (
            <p className="hint">
              {shot.marks.length} mark{shot.marks.length === 1 ? '' : 's'}, {shot.marks.filter((m) => m.kind === 'pin').length} pin{shot.marks.filter((m) => m.kind === 'pin').length === 1 ? '' : 's'}
            </p>
          )}
          <textarea
            className="pl-text"
            rows={2}
            placeholder="What to look at — “the Patent panel’s numerals are off”"
            key={`${shot.id}:${shot.note}`}
            defaultValue={shot.note}
            data-test="snapshot-note"
            onBlur={(e) => {
              const note = e.target.value.trim()
              if (note === shot.note) return
              useShots.getState().note(shot.id, note)
              const now = useShots.getState().shots.find((x) => x.id === shot.id)
              if (now) announce(now)
            }}
          />
          <p className="hint">Claude is told about it with its next answer, and can look with snapshot_latest.</p>
          {shot.path && <p className="sn-saved" title={shot.path}>Saved to {shot.path}</p>}
          <label className="checkrow">
            <input type="checkbox" checked={save} onChange={(e) => useShots.getState().setSave(e.target.checked)} />
            Save shots beside the project
          </label>
          <div className="pl-actions">
            <button className="primary" data-test="snapshot-markup" onClick={() => useShots.setState({ editing: shot.id })}>
              Mark up
            </button>
            <button onClick={async () => saveFile(fileName(shot), new Blob([(await composite(shot)) as BlobPart], { type: 'image/png' }))}>Save PNG</button>
            <button
              onClick={async (e) => {
                const b = e.currentTarget
                b.textContent = (await copy(await composite(shot))) ? 'Copied' : 'Copy failed'
                setTimeout(() => (b.textContent = 'Copy'), 1500)
              }}
            >
              Copy
            </button>
            <button onClick={() => useShots.getState().remove(shot.id)}>Discard</button>
          </div>
        </div>
      )}
      {error && (
        <div className="sn-card">
          <p className="hint warn">{error}</p>
        </div>
      )}
      <button
        className="sn-shoot"
        data-test="snapshot-button"
        title="Screenshot this tab for Claude (⌥⇧S / Alt+Shift+S) — your browser asks which tab to share; choose this one"
        aria-label="Screenshot this tab"
        disabled={busy}
        onClick={() => void takeShot(box.current)}
        onContextMenu={(e) => {
          if (!shots.length) return
          e.preventDefault()
          useShots.setState({ open: open ? null : shots[0].id })
        }}
      >
        {busy ? <span className="spinner" /> : <CameraIcon />}
        {shots.length > 0 && <b>{shots.length}</b>}
      </button>
    </div>
    </>
  )
}
