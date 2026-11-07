// SPDX-License-Identifier: AGPL-3.0-only
// The card that asks the person to start a print, over whatever workspace
// is on screen, and the Print workspace's list of requests.

import { useAsks, answer, type Ask } from '../state/askStore'

const WORDS: Record<Ask['status'], string> = { waiting: 'Waiting for you', sending: 'Sending…', starting: 'Starting…', started: 'Started', cancelled: 'Cancelled — nothing was sent', failed: 'It did not start', expired: 'Expired — ask again', withdrawn: 'Withdrawn by the agent' }

function Row({ a, compact }: { a: Ask; compact?: boolean }) {
  const waiting = a.status === 'waiting'
  return (
    <div data-test="printer-ask" data-status={a.status} style={{ padding: compact ? 0 : '6px 0', borderTop: compact ? 'none' : '1px solid var(--line, #ddd)' }}>
      <div style={{ fontWeight: 600 }}>Start this print?</div>
      <div style={{ fontSize: 12, margin: '4px 0' }}>
        <div><b>Printer</b> {a.printer}</div>
        <div><b>File</b> {a.file}</div>
        {a.summary.time && <div><b>Time</b> {a.summary.time}</div>}
        {a.summary.filament && <div><b>Filament</b> {a.summary.filament}</div>}
        {a.summary.size && <div><b>Size</b> {a.summary.size}</div>}
      </div>
      {waiting ? (
        <>
          <div style={{ fontSize: 12, marginBottom: 6 }}>Check the bed is clear and the right filament is loaded.</div>
          <button className="primary" data-test="printer-start" onClick={() => void answer(a, 'start')}>Start</button>{' '}
          <button data-test="printer-cancel" onClick={() => void answer(a, 'cancel')}>Cancel</button>
        </>
      ) : (
        <div style={{ fontSize: 12 }} data-test="printer-ask-status">
          {WORDS[a.status]}
          {a.error ? `: ${a.error}` : ''}
          {!compact && ' '}
          {compact && (
            <button style={{ marginLeft: 8 }} onClick={() => useAsks.getState().dismiss(a.request)}>
              Close
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Over every workspace: the request waiting, or the answer just given. */
export function AskCard() {
  const asks = useAsks((s) => s.asks)
  const a = asks.find((x) => x.status === 'waiting' || x.status === 'sending') ?? asks.find((x) => Date.now() - Date.parse(x.at) < 15_000 && x.status !== 'waiting')
  if (!a) return null
  return (
    <div role="dialog" aria-label="Start this print?" style={{ position: 'fixed', right: 16, top: 72, zIndex: 1000, width: 280, background: 'var(--panel, #fff)', border: '2px solid var(--accent, #ff6a00)', borderRadius: 8, padding: 12, boxShadow: '0 4px 20px rgba(0,0,0,.25)' }}>
      <Row a={a} compact />
    </div>
  )
}

export function PrintPanel() {
  const asks = useAsks((s) => s.asks)
  return (
    <div className="panel" data-test="print-panel">
      <div className="group">
        <div className="sec-head">Printing</div>
        <p className="hint">Ask Claude to set up your printers, upload a sliced job and check on them. A print starts only when you press Start here, in a dialog on your Mac, or on the page it opens.</p>
        {asks.length === 0 && <p className="hint">No start requests yet.</p>}
        {asks.map((a) => (
          <Row key={a.request} a={a} />
        ))}
      </div>
    </div>
  )
}
