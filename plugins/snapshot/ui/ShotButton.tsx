// SPDX-License-Identifier: AGPL-3.0-only
// The camera button, bottom right over every workspace, and the card the
// shot just taken comes up in: a note to go with it, Save, Copy, Discard.

import { useRef } from 'react'
import { saveFile } from '../../../src/app/exports'
import { IconFrame } from '../../../src/ui/icons'
import { fileName, takeShot } from '../app/capture'
import { useShots } from '../state/shotStore'
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
  const { shots, open, busy, error } = useShots()
  const box = useRef<HTMLDivElement>(null)
  const shot = shots.find((s) => s.id === open)

  return (
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
          <img src={shot.url} alt="The screenshot" className="sn-thumb" />
          <textarea
            className="pl-text"
            rows={2}
            placeholder="What to look at — “the Patent panel’s numerals are off”"
            defaultValue={shot.note}
            data-test="snapshot-note"
            onBlur={(e) => useShots.getState().note(shot.id, e.target.value.trim())}
          />
          <p className="hint">Ask Claude to look at your screenshot: it reads it with snapshot_latest. It stays in this tab until you close it.</p>
          <div className="pl-actions">
            <button onClick={() => saveFile(fileName(shot), new Blob([shot.png as BlobPart], { type: 'image/png' }))}>Save PNG</button>
            <button
              onClick={async (e) => {
                const b = e.currentTarget
                b.textContent = (await copy(shot.png)) ? 'Copied' : 'Copy failed'
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
        title="Screenshot this tab for Claude — your browser asks which tab to share; choose this one"
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
  )
}
