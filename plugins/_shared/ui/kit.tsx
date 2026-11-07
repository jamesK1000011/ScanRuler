// SPDX-License-Identifier: AGPL-3.0-only
// The plugins' shared faceplate parts (kit.css): a page on the stage, a
// pager, a list of findings, a busy line, prose fields. Built on the app's
// own rows and tokens, so a plugin's panel reads as one of the app's.

import type { ReactNode } from 'react'
import './kit.css'

export type Level = 'ok' | 'note' | 'info' | 'warn' | 'warning' | 'error' | 'fail' | 'block'

/** The page drawn for the stage, on the stage's colour. `fit`: the whole
 *  page in view rather than its width. */
export function Paper({ url, alt, testId, fit }: { url: string | null; alt: string; testId: string; fit?: boolean }) {
  if (!url) return null
  return (
    <div className={`pl-stage${fit ? ' fit' : ''}`} data-test={testId}>
      <img className="pl-paper" src={url} alt={alt} />
    </div>
  )
}

/** ‹ label › */
export function Pager({ label, onPrev, onNext, canPrev, canNext }: { label: string; onPrev(): void; onNext(): void; canPrev: boolean; canNext: boolean }) {
  return (
    <div className="pl-pager">
      <button title="Previous" disabled={!canPrev} onClick={onPrev}>
        ‹
      </button>
      <b>{label}</b>
      <button title="Next" disabled={!canNext} onClick={onNext}>
        ›
      </button>
    </div>
  )
}

export function Notes({ items, testId }: { items: { level?: string; rule?: string; text: ReactNode }[]; testId?: string }) {
  if (!items.length) return null
  return (
    <ul className="pl-notes" data-test={testId}>
      {items.map((n, i) => (
        <li key={i} className="pl-note" data-level={n.level ?? 'note'}>
          {n.rule && <code>{n.rule}</code>}
          {n.text}
        </li>
      ))}
    </ul>
  )
}

export function Status({ tone, children, testId }: { tone: 'ok' | 'warn' | 'bad' | 'idle'; children: ReactNode; testId?: string }) {
  return (
    <div className="pl-status" data-tone={tone} data-test={testId}>
      {children}
    </div>
  )
}

export function Busy({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p className="pl-busy">
      <span className="spinner" />
      {text}
    </p>
  )
}

/** A label over a full-width text field or box, committed when it loses the
 *  focus — the panel's prose fields. */
export function TextField({ label, value, onCommit, rows, placeholder, disabled, testId, info }: { label: ReactNode; value: string; onCommit(v: string): void; rows?: number; placeholder?: string; disabled?: boolean; testId?: string; info?: ReactNode }) {
  const commit = (v: string) => v !== value && onCommit(v)
  return (
    <label className="pl-stack">
      <span>
        {label}
        {info}
      </span>
      {rows ? (
        <textarea key={value} className="pl-text" rows={rows} defaultValue={value} placeholder={placeholder} disabled={disabled} data-test={testId} onBlur={(e) => commit(e.target.value)} />
      ) : (
        <input key={value} className="pl-input" type="text" defaultValue={value} placeholder={placeholder} disabled={disabled} data-test={testId} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      )}
    </label>
  )
}
