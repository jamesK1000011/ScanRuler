// SPDX-License-Identifier: AGPL-3.0-only
// The Print tab's Slice step, between Check and Send. Slicing is the agent's
// server's (slicer_* tools: OrcaSlicer, Bambu Studio and PrusaSlicer on this
// computer); a page cannot start a program. What the page holds that goes
// into a slice is shown here: the pauses for parts dropped in mid-print
// (hw.pauses) and the slicer changes a measured print asks for
// (fit.suggest) — each read by the command an agent reads it with, and only
// where the plugin that answers it is in the build.

import { create } from 'zustand'
import { listCommands, runCommand } from '../../../src/commands/registry'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { Notes } from '../../_shared/ui/kit'

type Json = Record<string, unknown>
type Pause = { layer: number; z: number; printZ: number; items: { what: string }[] }
type Change = { quantity: string; key: string | null; from: number | null; to: number | null; unit: string; note?: string }

export const useSliceView = create<{ pauses: Pause[] | null; changes: { slicer: string; changes: Change[] } | null; busy: boolean }>(() => ({ pauses: null, changes: null, busy: false }))

// The commands are registered once, at start-up, before the first render.
let names: Set<string> | null = null
const has = (name: string) => (names ??= new Set(listCommands().map((c) => c.name))).has(name)

async function read(name: string): Promise<Json | null> {
  useSliceView.setState({ busy: true })
  try {
    return (await runCommand(name, {})) as Json
  } catch (e) {
    useStore.setState({ errorText: e instanceof Error ? e.message : ((e as { message?: string })?.message ?? String(e)) })
    return null
  } finally {
    useSliceView.setState({ busy: false })
  }
}

export function SlicePanel() {
  const v = useSliceView()
  const pausesOn = has('hw.pauses')
  const fitOn = has('fit.suggest')
  return (
    <aside className="panel" data-test="slice-panel">
      <div className="group">
        <div className="sec-head">
          Slice
          <InfoDot title="Where slicing runs">
            <p>OrcaSlicer, Bambu Studio or PrusaSlicer slice on this computer, run by the agent’s server when its slicer tools are on (SCANRULER_MCP_EXTRAS names slicer). Ask the agent to slice the part; it reads time, filament and layers back and can compare two runs.</p>
            <p>Nothing is sent to a printer from here: that is the Send step, and a print starts only on your Start.</p>
          </InfoDot>
        </div>
        <p className="hint">Ask the agent to slice. What this project adds to the slice:</p>
      </div>
      {pausesOn && (
        <div className="group" data-test="slice-pauses">
          <div className="sec-head">
            Pauses
            <InfoDot title="Parts dropped in mid-print">
              <p>The layers the print stops at for nuts, magnets or ballast to go in, at the layer heights set in Hardware. They go into the G-code as the slicer writes it.</p>
            </InfoDot>
          </div>
          <div className="toolrow">
            <button data-test="slice-read-pauses" title="The layers the print pauses at" disabled={v.busy} onClick={() => void read('hw.pauses').then((r) => r && useSliceView.setState({ pauses: (r.pauses as Pause[]) ?? [] }))}>
              Read the pauses
            </button>
          </div>
          {v.pauses && (v.pauses.length === 0 ? <p className="hint">No pauses: nothing is dropped in.</p> : <Notes items={v.pauses.map((p) => ({ text: `Layer ${p.layer} (Z ${p.printZ}): ${p.items.map((i) => i.what).join(', ')}` }))} />)}
        </div>
      )}
      {fitOn && (
        <div className="group" data-test="slice-corrections">
          <div className="sec-head">
            Corrections
            <InfoDot title="From a measured print">
              <p>What the last print measured in Fits › Calibrate from a scan asks the slicer to change, added to the values in use.</p>
            </InfoDot>
          </div>
          <div className="toolrow">
            <button data-test="slice-read-corrections" title="The slicer changes the last measured print asks for" disabled={v.busy} onClick={() => void read('fit.suggest').then((r) => r && useSliceView.setState({ changes: { slicer: String(r.slicer), changes: (r.changes as Change[]) ?? [] } }))}>
              Read the corrections
            </button>
          </div>
          {v.changes && (v.changes.changes.length === 0 ? <p className="hint">Nothing worth changing.</p> : <Notes items={v.changes.changes.map((c) => ({ text: c.to === null ? `${c.key ?? c.quantity}: ${c.note ?? 'not in this slicer'}` : `${c.key ?? c.quantity}: ${c.from ?? '–'} → ${c.to}${c.unit ? ` ${c.unit}` : ''}` }))} />)}
        </div>
      )}
    </aside>
  )
}
