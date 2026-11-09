// SPDX-License-Identifier: AGPL-3.0-only
// The reading thread-match decides on: reverse.thread.read's pitch,
// diameters, bore or boss and noise, with the helix fold's sharper pitch,
// flank angle and taper where the fold could be read. The noise is raised
// to the scan noise to plan with (Scanner noise's, passed in as
// floorMm) where that is larger: a scan is never surer than its scanner,
// and a thread read finer than that would claim a size the scan can't
// tell from its neighbour.

import type { Reading } from './decide'
import type { ThreadShape } from './shape'

/** What thread-match takes from reverse.thread.read's answer. */
export interface ReverseRead {
  thread: boolean
  pitch: number | null
  major: number
  minor: number
  internal: boolean | null
  noise: number
  leftHanded: boolean | null
  span: [number, number]
  threaded: [number, number] | null
  windows?: { pitch: number | null }[]
}

export function readingOf(read: ReverseRead, shape: ThreadShape | null, floorMm = 0): Reading | null {
  if (read.pitch === null) return null
  const range = read.threaded ?? read.span
  const length = range[1] - range[0]
  // Without the fold, the windows' scatter stands for the pitch's error.
  const ws = (read.windows ?? []).map((w) => w.pitch).filter((p): p is number => p !== null)
  const mean = ws.length ? ws.reduce((s, v) => s + v, 0) / ws.length : read.pitch
  const sd = ws.length > 1 ? Math.sqrt(ws.reduce((s, v) => s + (v - mean) ** 2, 0) / (ws.length - 1)) : read.pitch * 0.02
  return {
    pitch: shape?.pitch ?? read.pitch,
    pitchSigma: shape?.pitchSigma ?? Math.max(sd / Math.sqrt(Math.max(1, ws.length)), read.pitch * 0.005),
    major: read.major,
    minor: read.minor,
    internal: read.internal,
    noise: Math.max(read.noise, shape?.noise ?? 0, floorMm),
    length: shape?.length ?? length,
    flankAngle: shape?.flankAngle ?? null,
    flankConfidence: shape?.flankConfidence ?? null,
    taper: shape ? shape.taper : null,
    taperSigma: shape ? shape.taperSigma : null,
    depthShare: shape ? shape.depthShare : null,
  }
}
