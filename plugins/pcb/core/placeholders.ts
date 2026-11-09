// SPDX-License-Identifier: AGPL-3.0-only
// Parts the board's STEP has no body for — a footprint with no 3D model, or
// one kicad-cli could not find — stood in for by a box: the footprint's
// courtyard (else its fab outline, else its pads) as wide and deep, as tall
// as the file says or a stated default. Without them a clearance check or
// an enclosure would pass for parts that are not there.

import { buildStepFile, type StepSection } from '../../../src/core/exportStep'
import type { Bounds, V2 } from './boardSpec'

/** A part the server found no 3D model for (mcp/src/extras/kicad.js,
 *  unmodelledParts), in the board's frame: mm, centred, y up. */
export interface Unmodelled {
  ref: string
  footprint: string
  face: 'top' | 'bottom'
  box: { min: V2; max: V2 }
  boxFrom: string | null
  height: number
  heightFrom: string
  why: string
}

/** The parts as the server sent them: those that read. */
export function unmodelledIn(u: unknown): Unmodelled[] {
  if (!Array.isArray(u)) return []
  const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  const v2 = (p: unknown): p is V2 => Array.isArray(p) && p.length === 2 && fin(p[0]) && fin(p[1])
  return u.filter(
    (x): x is Unmodelled =>
      !!x &&
      typeof x === 'object' &&
      typeof x.ref === 'string' &&
      (x.face === 'top' || x.face === 'bottom') &&
      !!x.box &&
      v2(x.box.min) &&
      v2(x.box.max) &&
      x.box.max[0] > x.box.min[0] &&
      x.box.max[1] > x.box.min[1] &&
      fin(x.height) &&
      x.height > 0,
  )
}

/** A placeholder's box where the board came in: on its top face, or under
 *  its bottom for a part on the back. */
export function placeholderBox(p: Unmodelled, thickness: number, offset: [number, number, number]): Bounds {
  const [dx, dy, dz] = offset
  const z0 = p.face === 'top' ? dz + thickness : dz - p.height
  return { min: [p.box.min[0] + dx, p.box.min[1] + dy, z0], max: [p.box.max[0] + dx, p.box.max[1] + dy, z0 + p.height] }
}

/** The body name a placeholder goes by. */
export const placeholderName = (stem: string, p: Unmodelled) => `${stem} ${p.ref || p.footprint} (placeholder)`.slice(0, 80)

/** The placeholders as one STEP file, a solid each. */
export function placeholderStep(parts: Unmodelled[], thickness: number, offset: [number, number, number], name: string): string {
  const sections: StepSection[] = parts.map((p) => {
    const b = placeholderBox(p, thickness, offset)
    const [x0, y0, x1, y1] = [b.min[0], b.min[1], b.max[0], b.max[1]]
    // Counter-clockwise seen from +z: an outer loop.
    const corners: V2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    return {
      name: p.ref || p.footprint,
      elements: [],
      prisms: [
        {
          frame: { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] },
          outer: corners.map((from, i) => ({ kind: 'line' as const, from, to: corners[(i + 1) % 4] })),
          holes: [],
          from: b.min[2],
          to: b.max[2],
        },
      ],
    }
  })
  return buildStepFile([], name, new Date().toISOString().slice(0, 19), 'solids', sections)
}

/** The placeholders' bodies among those an import made: each the body whose
 *  box is its own. */
export function matchPlaceholders<T extends { id: number; bounds?: Bounds | null }>(parts: Unmodelled[], thickness: number, offset: [number, number, number], bodies: T[]): Map<Unmodelled, T> {
  const out = new Map<Unmodelled, T>()
  const used = new Set<number>()
  for (const p of parts) {
    const want = placeholderBox(p, thickness, offset)
    let pick: T | null = null
    let far = 0.05
    for (const b of bodies) {
      if (!b.bounds || used.has(b.id)) continue
      const d = Math.max(...[0, 1, 2].flatMap((i) => [Math.abs(b.bounds!.min[i] - want.min[i]), Math.abs(b.bounds!.max[i] - want.max[i])]))
      if (d < far) [pick, far] = [b, d]
    }
    if (pick) {
      out.set(p, pick)
      used.add(pick.id)
    }
  }
  return out
}

/** One plain line on the placeholders made. */
export function placeholderNote(parts: Unmodelled[]): string {
  if (!parts.length) return ''
  const refs = parts.map((p) => p.ref || p.footprint)
  const list = refs.length > 8 ? `${refs.slice(0, 8).join(', ')} and ${refs.length - 8} more` : refs.join(', ')
  const guessed = parts.filter((p) => p.heightFrom === 'default').length
  const who = guessed === parts.length ? (guessed === 1 ? 'It stands' : 'All stand') : guessed === 1 ? '1 stands' : `${guessed} stand`
  const tall = guessed ? ` ${who} at the default height, as the file gives none.` : ''
  return `${parts.length} part${parts.length === 1 ? ' has' : 's have'} no 3D model (${list}): each is a placeholder box from its footprint, not the real part.${tall} Add the models in KiCad for a true fit.`
}
