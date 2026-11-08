// SPDX-License-Identifier: AGPL-3.0-only
// scanner-profiles' section of the 3D Measure panel: which scanner this
// project's scan came from — one of your profiles, or the noise read off the
// scan — the noise read, and your profiles added and removed. Every control
// runs a scanner.* command, the same ones the readout and the browser
// checks use.

import { useState } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { useLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { InfoDot } from '../../../src/ui/InfoDot'
import { NumberField } from '../../../src/ui/NumberField'
import { Status } from '../../_shared/ui/kit'
import { useScanner } from '../state/scannerStore'
import './scanner.css'

type Json = Record<string, unknown>
const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
const run = (name: string, input: Json = {}) => runCommand(`scanner.${name}`, input).catch(report)

/** The noise scanner.add takes at most, as its schema says. */
const NOISE_MAX = 5

export interface ProfileForm {
  name: string
  noiseMm: number
  /** 0 for none. */
  spacingMm: number
  note: string
  use: boolean
}

/** The form as scanner.add takes it: a name trimmed, and a spacing of 0 or
 *  an empty note left out. Null while it can't be added. */
export function profileInput(f: ProfileForm): Json | null {
  const name = f.name.trim()
  if (!name || !(f.noiseMm > 0) || f.noiseMm > NOISE_MAX) return null
  return { name, noiseMm: f.noiseMm, ...(f.spacingMm > 0 ? { spacingMm: f.spacingMm } : {}), ...(f.note.trim() ? { note: f.note.trim() } : {}), ...(f.use ? { use: true } : {}) }
}

const BLANK: ProfileForm = { name: '', noiseMm: 0.03, spacingMm: 0, note: '', use: true }

function AddProfile({ form, setForm, open, setOpen }: { form: ProfileForm; setForm(f: ProfileForm): void; open: boolean; setOpen(o: boolean): void }) {
  const input = profileInput(form)
  const put = (p: Partial<ProfileForm>) => setForm({ ...form, ...p })
  return (
    <details className="scanner-add" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Add a profile</summary>
      <label className="field">
        <span>Name</span>
        <input className="pl-input" type="text" data-test="scanner-name" placeholder="Scanner and mode" maxLength={60} value={form.name} onChange={(e) => put({ name: e.target.value })} />
      </label>
      <NumberField
        label="Noise (1σ)"
        kind="length"
        value={form.noiseMm}
        step={0.005}
        min={0.0001}
        testId="scanner-noise-value"
        hint={<p>One standard deviation of the surface noise. Measure noise on a scan of a flat, matte part reads it.</p>}
        onCommit={(v) => put({ noiseMm: Math.min(NOISE_MAX, v) })}
      />
      <NumberField label="Point spacing" kind="length" value={form.spacingMm} step={0.01} min={0} hint={<p>Typical distance between points; 0 to leave it out.</p>} onCommit={(v) => put({ spacingMm: v })} />
      <label className="field">
        <span>Note</span>
        <input className="pl-input" type="text" placeholder="Settings, mode, spray" maxLength={120} value={form.note} onChange={(e) => put({ note: e.target.value })} />
      </label>
      <label className="checkrow">
        <input type="checkbox" checked={form.use} onChange={(e) => put({ use: e.target.checked })} />
        <span>Use it for this project</span>
      </label>
      <div className="toolrow">
        <button
          className="primary"
          data-test="scanner-add"
          disabled={!input}
          title="Keep this profile in this browser"
          onClick={() =>
            input &&
            void run('add', input).then((r) => {
              if (!r) return
              setForm(BLANK)
              setOpen(false)
            })
          }
        >
          Add
        </button>
      </div>
    </details>
  )
}

export function ScannerSection() {
  const len = useLength()
  const fileName = useStore((s) => s.fileName)
  const busy = useStore((s) => s.busy)
  const profiles = useScanner((s) => s.profiles)
  const using = useScanner((s) => s.using)
  const measured = useScanner((s) => s.measured)
  const [working, setWorking] = useState(false)
  const [form, setForm] = useState<ProfileForm>(BLANK)
  const [adding, setAdding] = useState(false)
  // The project's profile is kept by value: one made in another browser
  // is offered too, under its name.
  const foreign = using && !profiles.some((p) => p.name === using.name) ? using : null
  const measure = () => {
    setWorking(true)
    void run('noise').finally(() => setWorking(false))
  }
  return (
    <div className="group" data-test="scanner-section">
      <div className="sec-head">
        Scanner
        <InfoDot title="Scanner and scan noise">
          <p>
            How noisy the scanner is sets how small a difference can be trusted. Tolerances and thresholds elsewhere are set as a multiple of it: the chosen
            profile's noise, else the noise measured from the scan.
          </p>
          <p>
            <b>Measure noise</b> reads it off the open scan, on its flat places only — best on a scan of a flat, matte part. <b>Save as profile</b> keeps
            the reading for every project.
          </p>
          <p>Profiles are kept in this browser. The one chosen is kept with the project.</p>
        </InfoDot>
      </div>
      <label className="field">
        <span>Scanner</span>
        <select
          data-test="scanner-use"
          value={using?.name ?? ''}
          onChange={(e) => void run('use', e.target.value ? { name: e.target.value } : { measured: true })}
        >
          <option value="">Measured from the scan</option>
          {profiles.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
          {foreign && (
            <option value={foreign.name} disabled>
              {`${foreign.name} (this project's)`}
            </option>
          )}
        </select>
      </label>
      <div className="kv" data-test="scanner-noise-now">
        <span className="pl-aside">Noise (1σ)</span>
        <span className="pl-aside">{using ? len.fmt(using.noiseMm, 3) : measured ? len.fmt(measured.sigmaMm, 3) : 'not read yet'}</span>
      </div>
      {measured && (
        <div className="kv" data-test="scanner-measured">
          <span className="pl-aside">Measured</span>
          <span className="pl-aside">{`${len.fmt(measured.sigmaMm, 3)}, spacing ${len.fmt(measured.spacingMm, 3)}`}</span>
        </div>
      )}
      <div className="toolrow">
        <button data-test="scanner-noise" disabled={!fileName || busy || working} title="Read the noise off the open scan" onClick={measure}>
          {working ? 'Reading…' : 'Measure noise'}
        </button>
        <button
          data-test="scanner-save-measured"
          disabled={!measured}
          title="Keep the measured noise as a profile"
          onClick={() => {
            if (!measured) return
            setForm({ ...BLANK, noiseMm: Math.min(NOISE_MAX, measured.sigmaMm), spacingMm: measured.spacingMm })
            setAdding(true)
          }}
        >
          Save as profile
        </button>
      </div>
      {!fileName && !using && <p className="hint">Open a scan to measure its noise, or choose a profile.</p>}
      {profiles.length > 0 && (
        <div className="scanner-list">
          {profiles.map((p) => (
            <div key={p.name} className="kv" data-test="scanner-profile-row" title={p.note}>
              <span className="pl-aside">{p.name}</span>
              <span className="pl-aside">
                {len.fmt(p.noiseMm, 3)}
                <button className="x" title="Remove this profile" onClick={() => void run('remove', { name: p.name })}>
                  ×
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {foreign && <Status tone="idle">{`This project uses ${foreign.name}, not among your profiles.`}</Status>}
      <AddProfile form={form} setForm={setForm} open={adding} setOpen={setAdding} />
    </div>
  )
}
