// SPDX-License-Identifier: AGPL-3.0-only
// The feature list's playback (app/playback.ts) in the panel and on the
// stage: the key that starts it in the list's heading, the keys that hold
// it, step it and end it while it runs, and the caption the viewport
// carries — the step, the feature's picture, its name and what it did — for
// a recording of how the part was built. The step's number counts the
// steps shown: with the sketches skipped, the features that change the
// geometry.

import { useMemo } from 'react'
import { useLength } from '../../../src/app/useUnits'
import type { DisplayUnits } from '../../../src/core/units'
import { useStore } from '../../../src/state/store'
import { Icon } from '../../../src/ui/icons'
import { pausePlayback, playbackStepFrom, playbackSteps, resumePlayback, startPlayback, stepPlayback, stopPlayback } from '../app/playback'
import { type Feature } from '../core/features'
import { describePlaneRef } from '../core/resolve'
import { PLAYBACK_STEPS_MS, useRePrefs } from '../state/rePrefs'
import { reEditorOpen, useReverse } from '../state/reStore'
import { bodyFeatureReading, FEATURE_ICONS, keyParameter } from './featureReading'
import { KeyIcon } from './reIcons'

/** The key in the feature list's heading that plays the list from the top. */
export function PlaybackKey() {
  const total = useReverse((s) => s.features.length + s.rolledBack.length)
  const editorOpen = useReverse(reEditorOpen)
  return (
    <button
      className="x eye all playkey"
      data-test="playback-start"
      disabled={editorOpen || total === 0}
      title={editorOpen ? 'Finish what is open first' : 'Replay the build step by step (Space pauses, Esc ends)'}
      onClick={() => startPlayback()}
    >
      <KeyIcon name="play" size={13} />
      Play
    </button>
  )
}

/** The steps the playback shows of the list as it stands. */
function useSteps(): number[] {
  const features = useReverse((s) => s.features)
  const rolledBack = useReverse((s) => s.rolledBack)
  const skip = useRePrefs((s) => s.playbackSkipSketches)
  return useMemo(() => playbackSteps([...features, ...rolledBack], skip), [features, rolledBack, skip])
}

/** The playback's keys under the list's heading while it runs: back a
 *  step, hold or carry on, on a step, stop — how long a step is held,
 *  whether the viewport names it, and whether the sketches are passed
 *  over. */
export function PlaybackBar() {
  const playback = useReverse((s) => s.playback)
  const steps = useSteps()
  const stepMs = useRePrefs((s) => s.playbackStepMs)
  const caption = useRePrefs((s) => s.playbackCaption)
  const skipSketches = useRePrefs((s) => s.playbackSkipSketches)
  if (!playback) return null
  const atEnd = playbackStepFrom(playback.at, 1, steps) === null
  const holds: readonly number[] = PLAYBACK_STEPS_MS.includes(stepMs as (typeof PLAYBACK_STEPS_MS)[number]) ? PLAYBACK_STEPS_MS : [...PLAYBACK_STEPS_MS, stepMs].sort((a, b) => a - b)
  return (
    <div className="playbar" data-test="playback-bar">
      <div className="playkeys">
        <button data-test="playback-back" disabled={playbackStepFrom(playback.at, -1, steps) === null} title="One step back — the playback held there (←)" aria-label="Step back" onClick={() => stepPlayback(-1)}>
          <KeyIcon name="stepBack" size={16} />
        </button>
        {playback.playing ? (
          <button data-test="playback-pause" title="Hold the playback at this step (Space)" aria-label="Pause" onClick={() => pausePlayback()}>
            <KeyIcon name="pause" size={16} />
          </button>
        ) : (
          <button data-test="playback-play" title={atEnd ? 'Play again from the top (Space)' : 'Carry on from this step (Space)'} aria-label="Play" onClick={() => resumePlayback()}>
            <KeyIcon name="play" size={16} />
          </button>
        )}
        <button data-test="playback-forward" disabled={atEnd} title="One step on — the playback held there (→)" aria-label="Step forward" onClick={() => stepPlayback(1)}>
          <KeyIcon name="stepForward" size={16} />
        </button>
        <button data-test="playback-stop" title="End the playback (Escape)" aria-label="Stop" onClick={() => stopPlayback()}>
          <KeyIcon name="stop" size={16} />
        </button>
      </div>
      <label className="playhold" title="How long each step is held once it is built">
        <span>Hold</span>
        <select data-test="playback-hold" value={stepMs} onChange={(e) => useRePrefs.getState().setPlaybackStepMs(Number(e.target.value))}>
          {holds.map((ms) => (
            <option key={ms} value={ms}>
              {ms / 1000} s
            </option>
          ))}
        </select>
      </label>
      <label className="playcaption" title="Show each step's name in the view">
        <input type="checkbox" data-test="playback-caption" checked={caption} onChange={(e) => useRePrefs.getState().setPlaybackCaption(e.target.checked)} />
        Caption
      </label>
      <label className="playcaption" title="Skip sketches; show only steps that change the shape">
        <input type="checkbox" data-test="playback-skip-sketches" checked={skipSketches} onChange={(e) => useRePrefs.getState().setPlaybackSkipSketches(e.target.checked)} />
        Skip sketches
      </label>
    </div>
  )
}

/** What a step's caption says the feature did, in a few words. */
function captionReading(f: Feature, bodyName: (id: number) => string, units: DisplayUnits): string {
  const store = useStore.getState()
  const ctx = { sections: store.sections, elements: store.elements }
  switch (f.kind) {
    case 'sketch':
      return `on ${describePlaneRef(f.plane, ctx, units)}`
    case 'extrude':
    case 'revolve':
      return `${f.op === 'new' ? 'New body' : f.op === 'join' ? 'Join' : 'Cut'} · ${keyParameter(f, units)}`
    default:
      return bodyFeatureReading(f, bodyName, ctx, units).text
  }
}

/** The caption on the stage while the list plays: the step and its total,
 *  and the feature the step built — or, before the first, the scan. */
export function PlaybackCaption() {
  const playback = useReverse((s) => s.playback)
  const features = useReverse((s) => s.features)
  const steps = useSteps()
  const results = useReverse((s) => s.results)
  const bodies = useReverse((s) => s.bodies)
  const fileName = useStore((s) => s.fileName)
  const shown = useRePrefs((s) => s.playbackCaption)
  const units = useLength().units
  if (!playback || !shown) return null
  const f = playback.at > 0 ? features[playback.at - 1] : undefined
  const bodyName = (id: number) => bodies.find((b) => b.id === id)?.name ?? features.find((g) => g.id === id)?.name ?? `feature ${id}`
  const failed = f && results[f.id]?.status === 'failed'
  return (
    <div className="playcaption-card" data-test="playback-caption-card">
      <div className="playstep">
        Step {steps.filter((n) => n > 0 && n <= playback.at).length} / {steps.length - 1}
      </div>
      <div className="playname">
        {f ? <KeyIcon name={FEATURE_ICONS[f.kind]} size={20} /> : <Icon name="scan" size={20} />}
        <span>{f ? f.name : fileName ? 'The scan' : 'An empty stage'}</span>
      </div>
      {f && <div className={'playreading' + (failed ? ' warn' : '')}>{failed ? '⚠ did not build' : captionReading(f, bodyName, units)}</div>}
      {!f && fileName && <div className="playreading">{fileName}</div>}
    </div>
  )
}
