// SPDX-License-Identifier: AGPL-3.0-only
// What the Wear repair panel works out without React: a region as the form
// holds it (a centre and a size, which a click on the part can set) and as
// wear.tag takes it (a box's corners), the reference and the pre-warp's
// verdict in words, lengths in the units shown.

import type { Region } from '../core/geometry'
import type { Run } from '../core/prewarp'
import type { Reference, Tag } from '../state/wearStore'

type V3 = [number, number, number]

/** The form for a new region: a sphere by its centre and radius, a box by
 *  its centre and its size along x, y and z. */
export interface Draft {
  name: string
  kind: 'worn' | 'keep'
  shape: 'sphere' | 'box'
  centre: V3
  radius: number
  size: V3
}

export const NEW_DRAFT: Draft = { name: '', kind: 'worn', shape: 'sphere', centre: [0, 0, 0], radius: 3, size: [6, 6, 6] }

/** The region wear.tag takes for the form. */
export function regionOf(d: Draft): Region {
  if (d.shape === 'sphere') return { kind: 'sphere', center: [...d.centre], radius: d.radius }
  return {
    kind: 'box',
    min: d.centre.map((c, i) => c - d.size[i] / 2) as V3,
    max: d.centre.map((c, i) => c + d.size[i] / 2) as V3,
  }
}

/** The form for a region tagged already, to change it. */
export function draftOf(t: Tag): Draft {
  const r = t.region
  if (r.kind === 'sphere') return { ...NEW_DRAFT, name: t.name, kind: t.kind, shape: 'sphere', centre: [...r.center], radius: r.radius }
  return {
    ...NEW_DRAFT,
    name: t.name,
    kind: t.kind,
    shape: 'box',
    centre: r.min.map((v, i) => (v + r.max[i]) / 2) as V3,
    size: r.min.map((v, i) => r.max[i] - v) as V3,
  }
}

/** A name not taken yet: "Worn 1", "Keep 2". */
export function nextName(tags: readonly Tag[], kind: Tag['kind']): string {
  const word = kind === 'worn' ? 'Worn' : 'Keep'
  const taken = new Set(tags.map((t) => t.name))
  let n = 1
  while (taken.has(`${word} ${n}`)) n++
  return `${word} ${n}`
}

/** A region in a few words, lengths through `fmt`. */
export function regionWords(r: Region, fmt: (mm: number) => string): string {
  if (r.kind === 'sphere') return `Ball, radius ${fmt(r.radius)}`
  return `Box ${r.max.map((v, i) => fmt(v - r.min[i])).join(' × ')}`
}

/** What the part is read against, in words. */
export function referenceWords(ref: Reference | null, referenceName: string | null): string {
  if (!ref) return 'Not chosen'
  if (ref.source === 'deviation') return referenceName ? `Aligned part: ${referenceName}` : 'Aligned part'
  const axes = ['X', 'Y', 'Z']
  const n = ref.normal
  const axis = n.findIndex((v, i) => Math.abs(v) > 0 && n.every((w, j) => j === i || w === 0))
  const through = ref.point.every((v) => v === 0) ? '' : ', moved off the origin'
  return axis >= 0 ? `Mirror across the ${axes[axis]} plane${through}` : `Mirror across a tilted plane${through}`
}

/** The pre-warp's verdict after the runs so far, as stopRule gives it, in
 *  the units shown. */
export function verdictWords(runs: readonly Run[], tolerance: number, fmt: (mm: number) => string, maxRuns = 3): { stop: boolean; text: string } {
  const last = runs.at(-1)
  if (!last) return { stop: false, text: 'No run yet.' }
  if (last.rms <= tolerance) return { stop: true, text: `Stop: the print is within ${fmt(tolerance)} of the target.` }
  const prev = runs.at(-2)
  if (prev && last.rms > 0.8 * prev.rms) return { stop: true, text: `Stop: run ${last.n} gained less than a fifth on run ${prev.n}. What is left is not a shape error; look at cooling, adhesion or the print itself.` }
  if (runs.length >= maxRuns) return { stop: true, text: `Stop: ${maxRuns} runs made.` }
  return { stop: false, text: 'Print the pre-warped model, scan it, and run again.' }
}

/** The axis align.symmetry turned the mirror plane's normal onto, read from
 *  its note ("… X turned 0.40° onto its normal …"), or null. */
export function symmetryAxis(note: unknown): 'x' | 'y' | 'z' | null {
  const m = typeof note === 'string' ? /\b([XYZ]) turned\b/.exec(note) : null
  return m ? (m[1].toLowerCase() as 'x' | 'y' | 'z') : null
}
