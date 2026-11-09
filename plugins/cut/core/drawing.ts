// SPDX-License-Identifier: AGPL-3.0-only
// The parts' profiles as one cutting file: laid out flat in rows, each
// part's outline and holes as the drawing's own lines, arcs and circles —
// or, kerf-compensated, as the cutter's path (circles stay circles; any
// other loop a polyline of short lines) — handed to the app's sheet
// exporters (src/core/flat/dxf.ts, svg.ts) as their edge pieces.

import type { FlatDrawingInput } from '../../../src/core/flat/drawing'
import type { FlatFit } from '../../../src/core/flat/types'
import { boxOf, movePiece, moveTo, offsetLoop, polygonOf, rowPack, type Piece, type Placed, type Profile, type Pt } from './profile'

export interface PartIn {
  name: string
  profiles: Profile[]
}

export interface Laid {
  input: FlatDrawingInput
  placed: (Placed & { name: string; size: [number, number] })[]
  sheets: number
  size: [number, number]
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0
const base = { sigma: 0, usedPoints: 0 }

/** A piece as the drawing's own shape. */
export function fitOf(p: Piece): FlatFit[] {
  switch (p.kind) {
    case 'line':
      return [lineFit(p.a, p.b)].filter((x): x is FlatFit => x !== null)
    case 'circle':
      return [{ kind: 'circle', center: p.center, radius: p.radius, ...base }]
    case 'arc': {
      // The drawing's arcs run counter-clockwise from start.
      const start = p.sweep < 0 ? p.start + p.sweep : p.start
      return [{ kind: 'arc', center: p.center, radius: p.radius, start: ((start % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), sweep: Math.abs(p.sweep), ...base }]
    }
    case 'curve':
      return p.points.slice(1).flatMap((q, i) => [lineFit(p.points[i], q)].filter((x): x is FlatFit => x !== null))
  }
}

function lineFit(a: Pt, b: Pt): FlatFit | null {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (L < 1e-9) return null
  return { kind: 'line', center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dir: [(b[0] - a[0]) / L, (b[1] - a[1]) / L], length: L, ...base }
}

/** Every part placed, as one drawing. kerf with compensate moves each
 *  loop's path off the material by half of it. */
export function layOut(parts: readonly PartIn[], opts: { gap: number; sheet?: [number, number] | null; compensate: boolean; kerf: number; labels: boolean; title: string; note: string }): Laid {
  const boxes = parts.map((p) => boxOf(p.profiles.flatMap((x) => polygonOf(x.outer, 0.05))))
  // The cutter's path stands half a kerf out: the room kept for it too.
  const grow = opts.compensate ? opts.kerf : 0
  const sizes = boxes.map((b) => [b.max[0] - b.min[0] + grow, b.max[1] - b.min[1] + grow] as [number, number])
  const pack = rowPack(sizes, opts.gap, opts.sheet ?? null)
  const pieces: FlatFit[] = []
  const notes: { text: string; at: Pt }[] = []
  pack.placed.forEach((pl) => {
    const part = parts[pl.index]
    const m = moveTo(boxes[pl.index], pl.turned, [pl.at[0] + grow / 2, pl.at[1] + grow / 2])
    for (const prof of part.profiles) {
      for (const loop of [prof.outer, ...prof.holes]) {
        const moved = { ...loop, pieces: loop.pieces.map((q) => movePiece(q, m)) }
        if (!opts.compensate) {
          for (const q of moved.pieces) pieces.push(...fitOf(q))
          continue
        }
        // A quarter turn keeps the way a loop runs: its area's sign says
        // which side the path goes.
        const off = offsetLoop(moved, opts.kerf / 2)
        if ('circle' in off) pieces.push({ kind: 'circle', center: off.circle.center, radius: off.circle.radius, ...base })
        else off.polygon.forEach((a, i) => {
          const f = lineFit(a, off.polygon[(i + 1) % off.polygon.length])
          if (f) pieces.push(f)
        })
      }
    }
    if (opts.labels) notes.push({ text: part.name, at: [pl.at[0], pl.at[1] - 2 * opts.gap / 3] })
  })
  const pad = opts.gap
  const input: FlatDrawingInput = {
    bounds: { min: [-pad, -pad - (opts.labels ? opts.gap : 0)], max: [pack.width + pad, pack.height + pad] },
    chains: null,
    chainUnit: { x: 1, y: 1 },
    edgePieces: pieces,
    elements: [],
    notes,
    alignDir: null,
    turns: 0,
    mirror: false,
    // units-ok: the drawing's own unit id — a cutting file is in millimetres.
    unit: 'mm',
    title: opts.title,
    scaleNote: opts.note,
  }
  return {
    input,
    placed: pack.placed.map((pl) => ({ ...pl, name: parts[pl.index].name, size: [r4(sizes[pl.index][0]), r4(sizes[pl.index][1])] as [number, number] })),
    sheets: Math.max(1, ...pack.placed.map((p) => p.sheet)),
    size: [pack.width, pack.height],
  }
}
