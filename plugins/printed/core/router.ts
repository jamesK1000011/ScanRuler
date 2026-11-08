// SPDX-License-Identifier: AGPL-3.0-only
// A small router for two-point nets on one sheet: A* on a square grid with
// moves along the axes and on the diagonals (orthogonal and 45° runs), a
// cost for every change of heading, around keep-outs, other nets' pads and
// the runs already there, each kept a clearance away. One net at a time,
// in the order given; a net routed becomes a run the next keeps clear of.
// No rip-up, no reordering: a net that can't get through is reported, not
// forced. Pure, millimetres on the sheet.

import { pointSegment2, tidy, type V2 } from './geometry'

export type Keepout = { rect: [number, number, number, number] } | { circle: [number, number, number] }

/** Something already on the sheet that a new run keeps clear of: a run
 *  (a polyline of width w) or a pad (a disc). */
export type Obstacle = { net: string; points: V2[]; width: number } | { net: string; center: V2; radius: number }

export interface RouteAsk {
  net: string
  from: V2
  to: V2
  width: number
}

export interface RouterOpts {
  /** The grid's pitch, mm. */
  grid: number
  /** Copper to copper, mm: edge to edge. */
  clearance: number
  /** [uMin, vMin, uMax, vMax] the runs stay inside. */
  bounds: [number, number, number, number]
  keepouts: Keepout[]
  obstacles: Obstacle[]
  /** Added for each change of heading, in grid steps (default 0.5). */
  turnCost?: number
  /** The most cells searched before giving up (default 400 000). */
  maxCells?: number
}

export interface Routed {
  net: string
  points: V2[]
  length: number
}

export interface Failed {
  net: string
  why: string
}

export const MAX_GRID_CELLS = 400_000

const DIRS: V2[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]

/** The keep-out grown by `by` contains p. */
function inKeepout(k: Keepout, p: V2, by: number): boolean {
  if ('rect' in k) {
    const [u0, v0, u1, v1] = k.rect
    const dx = Math.max(Math.min(u0, u1) - p[0], 0, p[0] - Math.max(u0, u1))
    const dy = Math.max(Math.min(v0, v1) - p[1], 0, p[1] - Math.max(v0, v1))
    return Math.hypot(dx, dy) < by
  }
  const [u, v, r] = k.circle
  return Math.hypot(p[0] - u, p[1] - v) < r + by
}

function nearObstacle(o: Obstacle, p: V2, half: number, clear: number): boolean {
  if ('center' in o) return Math.hypot(p[0] - o.center[0], p[1] - o.center[1]) < o.radius + half + clear
  const need = o.width / 2 + half + clear
  if (o.points.length === 1) return Math.hypot(p[0] - o.points[0][0], p[1] - o.points[0][1]) < need
  for (let i = 1; i < o.points.length; i++) if (pointSegment2(p, o.points[i - 1], o.points[i]) < need) return true
  return false
}

/** A binary heap on f. */
class Heap {
  private a: number[] = []
  private f: Float64Array
  constructor(f: Float64Array) {
    this.f = f
  }
  get size() {
    return this.a.length
  }
  push(i: number) {
    const a = this.a
    a.push(i)
    let k = a.length - 1
    while (k > 0) {
      const p = (k - 1) >> 1
      if (this.f[a[p]] <= this.f[a[k]]) break
      ;[a[p], a[k]] = [a[k], a[p]]
      k = p
    }
  }
  pop(): number {
    const a = this.a
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let k = 0
      for (;;) {
        const l = 2 * k + 1, r = l + 1
        let m = k
        if (l < a.length && this.f[a[l]] < this.f[a[m]]) m = l
        if (r < a.length && this.f[a[r]] < this.f[a[m]]) m = r
        if (m === k) break
        ;[a[m], a[k]] = [a[k], a[m]]
        k = m
      }
    }
    return top
  }
}

/**
 * One net from `from` to `to`, on a grid laid with a node on `from`: the
 * shortest path of axis and diagonal steps, with a cost per change of
 * heading, through cells whose centres are clear of everything by the
 * clearance and half the width — and half a diagonal step more, so the
 * straight between two clear cells is clear too. Null where none is.
 */
export function routeOne(ask: RouteAsk, o: RouterOpts): { points: V2[] } | { fail: string } {
  const g = o.grid
  const [u0, v0, u1, v1] = o.bounds
  const half = ask.width / 2
  const slack = (g * Math.SQRT2) / 2
  // The grid, anchored on the start.
  const i0 = Math.floor((u0 - ask.from[0]) / g), i1 = Math.ceil((u1 - ask.from[0]) / g)
  const j0 = Math.floor((v0 - ask.from[1]) / g), j1 = Math.ceil((v1 - ask.from[1]) / g)
  const nu = i1 - i0 + 1, nv = j1 - j0 + 1
  if (nu * nv > (o.maxCells ?? MAX_GRID_CELLS)) return { fail: `the grid would be ${nu} × ${nv} cells: give a coarser grid or tighter bounds` }
  const at = (c: number): V2 => [ask.from[0] + (i0 + (c % nu)) * g, ask.from[1] + (j0 + Math.floor(c / nu)) * g]
  const cellOf = (p: V2) => {
    const i = Math.round((p[0] - ask.from[0]) / g) - i0, j = Math.round((p[1] - ask.from[1]) / g) - j0
    return i < 0 || j < 0 || i >= nu || j >= nv ? -1 : j * nu + i
  }
  const start = cellOf(ask.from), goal = cellOf(ask.to)
  if (start < 0 || goal < 0) return { fail: `${start < 0 ? 'its start' : 'its end'} lies outside the bounds` }
  const inside = (p: V2) => p[0] - half >= u0 - 1e-9 && p[0] + half <= u1 + 1e-9 && p[1] - half >= v0 - 1e-9 && p[1] + half <= v1 + 1e-9
  // A cell's verdict, worked out when first reached: 0 not yet, 1 clear, 2 blocked.
  const state = new Uint8Array(nu * nv)
  const blockedBy = (p: V2): string | null => {
    if (!inside(p)) return 'the bounds'
    for (const k of o.keepouts) if (inKeepout(k, p, half + o.clearance + slack)) return 'a keep-out'
    for (const ob of o.obstacles) if (ob.net !== ask.net && nearObstacle(ob, p, half, o.clearance + slack)) return `net ${ob.net}`
    return null
  }
  const clear = (c: number) => {
    if (c === start || c === goal) return true
    if (state[c] === 0) state[c] = blockedBy(at(c)) ? 2 : 1
    return state[c] === 1
  }
  // The ends themselves: clear of others by the clearance alone.
  for (const [p, word] of [[ask.from, 'start'], [ask.to, 'end']] as const) {
    for (const k of o.keepouts) if (inKeepout(k, p, half + o.clearance)) return { fail: `its ${word} lies in a keep-out` }
    for (const ob of o.obstacles) if (ob.net !== ask.net && nearObstacle(ob, p, half, o.clearance)) return { fail: `its ${word} is within the clearance of net ${ob.net}` }
  }
  const n = nu * nv
  // States: cell × heading (8), plus "no heading yet" for the start.
  const S = n * 9
  const gs = new Float64Array(S).fill(Infinity)
  const fs = new Float64Array(S).fill(Infinity)
  const came = new Int32Array(S).fill(-1)
  const done = new Uint8Array(S)
  const turn = o.turnCost ?? 0.5
  const [gu, gv] = at(goal)
  const h = (c: number) => {
    const [pu, pv] = at(c)
    const dx = Math.abs(pu - gu) / g, dy = Math.abs(pv - gv) / g
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
  }
  const heap = new Heap(fs)
  const s0 = start * 9 + 8
  gs[s0] = 0
  fs[s0] = h(start)
  heap.push(s0)
  let found = -1
  let seen = 0
  while (heap.size) {
    const s = heap.pop()
    if (done[s]) continue
    done[s] = 1
    const c = Math.floor(s / 9), hd = s % 9
    if (c === goal) {
      found = s
      break
    }
    if (++seen > (o.maxCells ?? MAX_GRID_CELLS) * 2) break
    const ci = c % nu, cj = Math.floor(c / nu)
    for (let d = 0; d < 8; d++) {
      const ni = ci + DIRS[d][0], nj = cj + DIRS[d][1]
      if (ni < 0 || nj < 0 || ni >= nu || nj >= nv) continue
      const nc = nj * nu + ni
      if (!clear(nc)) continue
      // A diagonal step squeezing between two blocked cells is no step.
      if (d % 2 === 1 && !clear(cj * nu + ni) && !clear(nj * nu + ci)) continue
      const bend = hd === 8 || hd === d ? 0 : Math.min((d - hd + 8) % 8, (hd - d + 8) % 8)
      if (bend > 2) continue // sharper than 90°: never on a trace
      const step = d % 2 ? Math.SQRT2 : 1
      const ns = nc * 9 + d
      const ng = gs[s] + step + bend * turn
      if (ng < gs[ns]) {
        gs[ns] = ng
        fs[ns] = ng + h(nc)
        came[ns] = s
        heap.push(ns)
      }
    }
  }
  if (found < 0) return { fail: 'no way through clear of the keep-outs and other nets at this grid and clearance' }
  const cells: V2[] = []
  for (let s = found; s >= 0; s = came[s]) cells.push(at(Math.floor(s / 9)))
  cells.reverse()
  // Exact ends: the start is on the grid; the end may lie off it.
  cells[0] = [ask.from[0], ask.from[1]]
  const last = cells[cells.length - 1]
  if (Math.hypot(last[0] - ask.to[0], last[1] - ask.to[1]) > 1e-9) cells.push([ask.to[0], ask.to[1]])
  return { points: tidy(cells.map((p) => [round(p[0]), round(p[1])] as V2)) }
}

const round = (x: number) => Math.round(x * 1e6) / 1e6 + 0

/** Several nets, in order; each routed becomes an obstacle to the next. */
export function routeAll(asks: RouteAsk[], o: RouterOpts): { routed: Routed[]; failed: Failed[] } {
  const obstacles = [...o.obstacles]
  const routed: Routed[] = []
  const failed: Failed[] = []
  for (const a of asks) {
    const r = routeOne(a, { ...o, obstacles })
    if ('fail' in r) {
      failed.push({ net: a.net, why: r.fail })
      continue
    }
    let L = 0
    for (let i = 1; i < r.points.length; i++) L += Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1])
    routed.push({ net: a.net, points: r.points, length: L })
    obstacles.push({ net: a.net, points: r.points, width: a.width })
  }
  return { routed, failed }
}
