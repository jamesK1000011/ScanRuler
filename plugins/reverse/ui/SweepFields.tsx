// SPDX-License-Identifier: AGPL-3.0-only
// The Sweep box's own fields — the sketch of the profile and the sketch of
// the path, with a key that swaps them — and the Sweep key's picture, drawn
// on the app's icon grid to its rules (see src/ui/icons.tsx): the path in
// blue, a bent bar along it in ink, its section square to the path at the
// start.

import type { SketchFeature } from '../core/features'
import type { SweepRoute } from '../core/sweepRoute'
import { InfoDot } from '../../../src/ui/InfoDot'

export function SweepIcon({ size = 24 }: { size?: number }) {
  return (
    <svg className={size <= 16 ? 'icon small' : 'icon'} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path className="i-g" d="M3 7.5h6.5a7.5 7.5 0 0 1 7.5 7.5v6h-5v-6a2.5 2.5 0 0 0-2.5-2.5H3Z" />
      <path className="i-a" d="M1 10h8.5a5 5 0 0 1 5 5v8" />
    </svg>
  )
}

export function SweepFields({ profile, path, route, sketches, onChange }: { profile: number | null; path: number | null; route?: SweepRoute; sketches: readonly SketchFeature[]; onChange: (patch: { profile?: number | null; path?: number | null }) => void }) {
  const select = (label: string, value: number | null, testId: string, set: (id: number | null) => void) => (
    <label className="field">
      <span>{label}</span>
      <select data-test={testId} value={value ?? ''} onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">Select…</option>
        {sketches.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  )
  if (route) {
    const bends = route.points.length - 2
    return (
      <>
        {select('Profile', profile, 'sweep-profile', (id) => onChange({ profile: id }))}
        <p className="hint" data-test="sweep-route">
          Along a route in 3D: {route.points.length} points, {bends} bend{bends === 1 ? '' : 's'}.
          <InfoDot title="A route">
            <p>The centreline's points came by a command, as reverse.scan.tube_trace reads them, and reverse.feature.update changes them; there is no drawing them here. It moves with the part and needs no sketch. The profile stands square to it at its start, with the start on it.</p>
          </InfoDot>
        </p>
      </>
    )
  }
  return (
    <>
      {select('Profile', profile, 'sweep-profile', (id) => onChange({ profile: id }))}
      {select('Path', path, 'sweep-path', (id) => onChange({ path: id }))}
      <div className="toolrow">
        <button data-test="sweep-swap" disabled={profile === null && path === null} title="Swap the profile and path sketches" onClick={() => onChange({ profile: path, path: profile })}>
          Swap profile and path
        </button>
      </div>
      <p className="hint">
        The profile sketch's largest region is carried along the path sketch's one chain of lines and arcs, from the end nearest the profile.
        <InfoDot title="A sweep">
          <p>The section is held square to the path and turns as little as it can along it. Sketch the profile on a plane square to the path where it starts — one more than a degree off square is refused, saying by how much.</p>
          <p>The path is lines and arcs end to end — one chain, no branch; a closed path is drawn as arcs, a circle having no end to start from. Holes in the profile are swept with it.</p>
        </InfoDot>
      </p>
    </>
  )
}
