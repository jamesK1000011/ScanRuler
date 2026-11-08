// SPDX-License-Identifier: AGPL-3.0-only
// The card that asks the person to start a print, over whatever workspace
// is on screen, and the Print workspace's list of requests.

import { Status } from '../../_shared/ui/kit'
import { InfoDot } from '../../../src/ui/InfoDot'
import { useAsks, answer, type Ask } from '../state/askStore'

const WORDS: Record<Ask['status'], string> = { waiting: 'Waiting for you', sending: 'Sending…', starting: 'Starting…', started: 'Started', cancelled: 'Cancelled — nothing was sent', failed: 'It did not start', expired: 'Expired — ask again', withdrawn: 'Withdrawn by the agent' }
const TONE: Record<Ask['status'], 'ok' | 'warn' | 'bad' | 'idle'> = { waiting: 'warn', sending: 'warn', starting: 'warn', started: 'ok', cancelled: 'idle', failed: 'bad', expired: 'idle', withdrawn: 'idle' }

const ASKS = {
  start: { ask: 'Start this print?', button: 'Start', check: 'Check the bed is clear and the right filament is loaded.', done: 'Started', failed: 'It did not start' },
  resume: { ask: 'Resume this print?', button: 'Resume', check: 'Check whatever made it pause is put right: the nozzle, the filament, the part on the bed.', done: 'Resumed', failed: 'It did not resume' },
}
const asks = (a: Ask) => ASKS[a.verb ?? 'start']
const statusWord = (a: Ask) => (a.status === 'started' ? asks(a).done : a.status === 'failed' ? asks(a).failed : WORDS[a.status])

function Facts({ a }: { a: Ask }) {
  const rows: [string, string | undefined][] = [
    ['Printer', a.printer],
    ['File', a.file],
    ['Time', a.summary.time],
    ['Filament', a.summary.filament],
    ['Size', a.summary.size],
  ]
  return (
    <dl className="pl-facts">
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd className={k === 'File' ? 'wrap' : undefined} title={v}>
              {v}
            </dd>
          </div>
        ))}
    </dl>
  )
}

function Answer({ a, onClose }: { a: Ask; onClose?: () => void }) {
  if (a.status === 'waiting') {
    return (
      <>
        <p className="hint">{asks(a).check}</p>
        <div className="pl-actions">
          <button className="primary" data-test="printer-start" onClick={() => void answer(a, 'start')}>
            {asks(a).button}
          </button>
          <button data-test="printer-cancel" onClick={() => void answer(a, 'cancel')}>
            Cancel
          </button>
        </div>
      </>
    )
  }
  return (
    <div className="pl-inline">
      <span className="grow" data-test="printer-ask-status">
        <Status tone={TONE[a.status]}>
          {statusWord(a)}
          {a.error ? `: ${a.error}` : ''}
        </Status>
      </span>
      {onClose && (
        <button className="x" title="Close" onClick={onClose}>
          ×
        </button>
      )}
    </div>
  )
}

/** Over every workspace: the request waiting, or the answer just given. */
export function AskCard() {
  const list = useAsks((s) => s.asks)
  const inPrint = useAsks((s) => s.inPrint)
  const a = list.find((x) => x.status === 'waiting' || x.status === 'sending') ?? list.find((x) => Date.now() - Date.parse(x.at) < 15_000 && x.status !== 'waiting')
  if (!a || inPrint) return null
  return (
    <div className="pl-ask" role="dialog" aria-label={asks(a).ask} data-test="printer-ask" data-status={a.status}>
      <div className="sec-head">{asks(a).ask}</div>
      <Facts a={a} />
      <Answer a={a} onClose={() => useAsks.getState().dismiss(a.request)} />
    </div>
  )
}

export function PrintPanel() {
  const list = useAsks((s) => s.asks)
  return (
    <aside className="panel" data-test="print-panel">
      <div className="group">
        <div className="sec-head">
          Printing
          <InfoDot title="Who starts a print">
            <p>Ask Claude to set up your printers, upload a sliced job and check on them. A print starts only when you press Start — on the card here, in a dialog on your Mac, or on the page it opens, as each printer is set.</p>
            <p>Access codes and keys stay in your Keychain; they never reach this page or the agent.</p>
          </InfoDot>
          <b>{list.length || ''}</b>
        </div>
        {list.length === 0 && <p className="hint">No start requests yet. When the agent asks to start a print, it shows here and over whatever you are doing.</p>}
        {list.map((a) => (
          <div key={a.request} className={`pl-card${a.status === 'waiting' ? ' live' : ''}`} data-test="printer-ask" data-status={a.status}>
            <div className="pl-cardhead">
              <span className="name">{a.printer}</span>
              <span className="pl-aside">{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <Facts a={a} />
            <Answer a={a} />
          </div>
        ))}
      </div>
    </aside>
  )
}
