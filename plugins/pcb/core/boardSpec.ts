// SPDX-License-Identifier: AGPL-3.0-only
// A KiCad board as the agent's server reads it (mcp/src/extras/kicadBoard.js)
// and the bodies it became in Reverse Engineer: which body is the board,
// which are its edge connectors, how far its parts reach above and below
// it — and from those, the board as Generate's board enclosure takes it
// (BoardSpec, the plain numbers gen.make's board input is).

export type Side = '+x' | '-x' | '+y' | '-y'
export type V2 = [number, number]

export interface Opening {
  width: number
  height: number | null
  zc: number | null
  shape: 'rect' | 'round'
  /** The kind's typical size, not this part's own. */
  typical: boolean
}

export interface BoardConnector {
  ref: string
  value: string
  footprint: string
  kind: string
  label: string
  x: number
  y: number
  rot: number
  face: 'top' | 'bottom'
  side: Side
  inset: number
  centre: number
  box: { min: V2; max: V2 }
  opening: Opening
}

/** The board as read from its file, in the frame it is imported in: mm,
 *  centred on the outline's box, y up, its bottom face at z = 0. */
export interface KicadBoard {
  name: string
  file?: string
  schematic?: string | null
  thickness: number
  origin: V2
  size: V2
  outline: V2[]
  holes: { ref: string | null; x: number; y: number; d: number; plated: boolean; from: string }[]
  connectors: BoardConnector[]
  footprints: { count: number; top: number; bottom: number }
  layers?: { name: string }[]
}

export interface Bounds {
  min: [number, number, number]
  max: [number, number, number]
}

export interface BodyRow {
  id: number
  name: string
  bounds?: Bounds | null
}

/** What an import found among its bodies. */
export interface Placed {
  /** The board's own body. */
  board: BodyRow | null
  /** Each edge connector's body, by reference. */
  connectors: Record<string, BodyRow>
  /** Where the board's bottom and middle came in (KiCad's STEP puts its
   *  bottom face at z = 0 and the middle where asked: this checks it). */
  offset: [number, number, number]
  /** How far the parts reach above the board's top face and below its
   *  bottom, from the bodies' boxes. */
  above: number
  below: number
}

const centre = (b: Bounds, i: number) => (b.min[i] + b.max[i]) / 2

/** The board's body and its connectors' among the bodies an import made. */
export function placeBodies(board: KicadBoard, bodies: BodyRow[]): Placed {
  const boxed = bodies.filter((b): b is BodyRow & { bounds: Bounds } => !!b.bounds)
  // The board: its box the outline's size and the board's thickness.
  let best: (BodyRow & { bounds: Bounds }) | null = null
  let far = Infinity
  for (const b of boxed) {
    const w = b.bounds.max[0] - b.bounds.min[0]
    const d = b.bounds.max[1] - b.bounds.min[1]
    const t = b.bounds.max[2] - b.bounds.min[2]
    const miss = Math.abs(w - board.size[0]) + Math.abs(d - board.size[1]) + 2 * Math.abs(t - board.thickness)
    if (miss < far) [best, far] = [b, miss]
  }
  const boardBody = best && far < 2 ? best : null
  const offset: [number, number, number] = boardBody ? [centre(boardBody.bounds, 0), centre(boardBody.bounds, 1), boardBody.bounds.min[2]] : [0, 0, 0]
  const top = offset[2] + board.thickness
  const bottom = offset[2]
  let above = 0
  let below = 0
  for (const b of boxed) {
    if (b === boardBody) continue
    above = Math.max(above, b.bounds.max[2] - top)
    below = Math.max(below, bottom - b.bounds.min[2])
  }
  // Each connector: the body whose middle stands nearest the middle of its
  // footprint's box, within the box and a little round it.
  const connectors: Record<string, BodyRow> = {}
  const taken = new Set<number>()
  for (const c of board.connectors) {
    const cx = (c.box.min[0] + c.box.max[0]) / 2 + offset[0]
    const cy = (c.box.min[1] + c.box.max[1]) / 2 + offset[1]
    const reach = 1.5
    let pick: BodyRow | null = null
    let d0 = Infinity
    for (const b of boxed) {
      if (b === boardBody || taken.has(b.id)) continue
      const bx = centre(b.bounds, 0)
      const by = centre(b.bounds, 1)
      if (bx < c.box.min[0] + offset[0] - reach || bx > c.box.max[0] + offset[0] + reach || by < c.box.min[1] + offset[1] - reach || by > c.box.max[1] + offset[1] + reach) continue
      // On the board's face the connector sits on.
      if (c.face === 'top' ? b.bounds.max[2] < top - 0.01 : b.bounds.min[2] > bottom + 0.01) continue
      const d = Math.hypot(bx - cx, by - cy)
      if (d < d0) [pick, d0] = [b, d]
    }
    if (pick) {
      connectors[c.ref] = pick
      taken.add(pick.id)
    }
  }
  return { board: boardBody, connectors, offset, above: Math.max(0, above), below: Math.max(0, below) }
}

/** An opening in a wall, as gen's board enclosure takes it (BoardOpening). */
export interface SpecOpening {
  side: Side
  centre: number
  width: number
  z0: number
  z1: number
  shape?: 'round'
  label?: string
}

/** The board as gen's board enclosure takes it (BoardSpec). */
export interface BoardSpec {
  name?: string
  outline: V2[]
  thickness: number
  above: number
  below: number
  holes: { x: number; y: number; d: number; ref?: string }[]
  openings: SpecOpening[]
}

/** How far parts are taken to reach when nothing was imported to measure
 *  them: an upright connector's height, and through-hole pins' tails. */
export const GUESS = { above: 12, below: 2.5, height: 5 }

/** Each connector's 3D box, from the import, in the board's frame (its
 *  bottom at z = 0, its middle where the outline's is). */
export type ConnectorBoxes = Record<string, Bounds>

const r3 = (x: number) => Math.round(x * 1000) / 1000

/**
 * The board for the enclosure: outline, thickness, holes; the parts' reach
 * (given, else measured on import, else guessed — said so in notes); an
 * opening for each edge connector: a known kind at its typical size,
 * placed on its 3D box where the import gave one; any other kind sized by
 * its 3D box, else by its footprint and a guessed height.
 */
export function boardSpecOf(board: KicadBoard, opts: { above?: number | null; below?: number | null; measured?: { above: number; below: number } | null; boxes?: ConnectorBoxes; skip?: string[] } = {}): { spec: BoardSpec; notes: string[] } {
  const notes: string[] = []
  const T = board.thickness
  const pickReach = (given: number | null | undefined, measured: number | undefined, guess: number, what: string) => {
    if (typeof given === 'number' && Number.isFinite(given)) return given
    if (typeof measured === 'number') return measured
    // units-ok: the board's numbers are an API in mm, answered to the agent in mm.
    notes.push(`The parts’ reach ${what} the board is a guess (${guess} mm): import the board with its parts to measure it, or set it.`)
    return guess
  }
  const above = pickReach(opts.above, opts.measured?.above, GUESS.above, 'above')
  const below = pickReach(opts.below, opts.measured?.below, GUESS.below, 'below')
  const openings: SpecOpening[] = []
  for (const c of board.connectors) {
    if (opts.skip?.includes(c.ref)) continue
    const along = c.side === '+y' || c.side === '-y' ? 0 : 1
    const box = opts.boxes?.[c.ref]
    const label = `${c.ref} ${c.label}`
    let centreAt = c.centre
    let width = c.opening.width
    let z0: number
    let z1: number
    if (box) centreAt = (box.min[along] + box.max[along]) / 2
    if (c.opening.height !== null && c.opening.zc !== null) {
      const h = c.opening.height
      const zc = c.opening.zc
      ;[z0, z1] = c.face === 'top' ? [T + zc - h / 2, T + zc + h / 2] : [-zc - h / 2, -zc + h / 2]
      // units-ok: the board's numbers are an API in mm, answered to the agent in mm.
      if (c.opening.typical) notes.push(`${label}: a typical opening (${c.opening.width} × ${h} mm) — check the part’s sheet.`)
    } else if (box) {
      width = box.max[along] - box.min[along]
      ;[z0, z1] = [box.min[2], box.max[2]]
      if (c.face === 'top') z0 = Math.max(z0, T)
      else z1 = Math.min(z1, 0)
    } else {
      const h = GUESS.height
      ;[z0, z1] = c.face === 'top' ? [T, T + h] : [-h, 0]
      // units-ok: the board's numbers are an API in mm, answered to the agent in mm.
      notes.push(`${label}: no 3D model to size it by — its footprint’s width and a ${h} mm height guessed.`)
    }
    if (!(z1 > z0) || !(width > 0)) continue
    openings.push({ side: c.side, centre: r3(centreAt), width: r3(width), z0: r3(z0), z1: r3(z1), ...(c.opening.shape === 'round' ? { shape: 'round' as const } : {}), label })
  }
  if (!board.holes.length) notes.push('The board has no mounting holes: there are no standoffs, and it rests on nothing — add holes in KiCad, or support it in the box yourself.')
  // The tallest opening raises the reach, so the box has room for it.
  const tallest = Math.max(0, ...openings.map((o) => o.z1 - T))
  const deepest = Math.max(0, ...openings.map((o) => -o.z0))
  return {
    spec: {
      name: board.name,
      outline: board.outline,
      thickness: T,
      above: r3(Math.max(above, tallest)),
      below: r3(Math.max(below, deepest)),
      holes: board.holes.map((h) => ({ x: h.x, y: h.y, d: h.d, ...(h.ref ? { ref: h.ref } : {}) })),
      openings,
    },
    notes,
  }
}

/** The connector boxes from the bodies an import placed, in the board's
 *  frame (the import's offset taken off). */
export function connectorBoxes(placed: Placed): ConnectorBoxes {
  const out: ConnectorBoxes = {}
  const [dx, dy, dz] = placed.offset
  for (const [ref, b] of Object.entries(placed.connectors)) {
    if (!b.bounds) continue
    out[ref] = { min: [b.bounds.min[0] - dx, b.bounds.min[1] - dy, b.bounds.min[2] - dz], max: [b.bounds.max[0] - dx, b.bounds.max[1] - dy, b.bounds.max[2] - dz] }
  }
  return out
}

/** A board as the server sent it (or a project file kept it), checked
 *  enough to use: throws on one that is not a board; a hole or connector
 *  that does not read is left out, so one bad entry does not stop the rest. */
export function boardIn(u: unknown): KicadBoard {
  const b = u as KicadBoard
  const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  const v2 = (p: unknown) => Array.isArray(p) && p.length === 2 && fin(p[0]) && fin(p[1])
  if (!b || typeof b !== 'object' || typeof b.name !== 'string' || !fin(b.thickness) || !(b.thickness > 0) || !Array.isArray(b.outline) || b.outline.length < 3 || !b.outline.every(v2) || !Array.isArray(b.holes) || !Array.isArray(b.connectors) || !v2(b.size)) throw new Error('The server’s answer is not a board this page reads — the agent’s server may be older or newer than this page.')
  const SIDES = ['+x', '-x', '+y', '-y']
  const holeOk = (h: KicadBoard['holes'][number]) => !!h && typeof h === 'object' && fin(h.x) && fin(h.y) && fin(h.d) && h.d > 0
  const openingOk = (o: Opening) => !!o && typeof o === 'object' && fin(o.width) && o.width > 0 && (o.height === null || fin(o.height)) && (o.zc === null || fin(o.zc)) && (o.shape === 'rect' || o.shape === 'round')
  const connOk = (c: BoardConnector) =>
    !!c && typeof c === 'object' && typeof c.ref === 'string' && SIDES.includes(c.side) && fin(c.centre) && (c.face === 'top' || c.face === 'bottom') && !!c.box && v2(c.box.min) && v2(c.box.max) && openingOk(c.opening)
  return { ...b, origin: v2(b.origin) ? b.origin : [0, 0], holes: b.holes.filter(holeOk), connectors: b.connectors.filter(connOk) }
}

/** A connector's 3D boxes as a project file kept them: those that read. */
export function boxesIn(u: unknown): ConnectorBoxes {
  const out: ConnectorBoxes = {}
  if (!u || typeof u !== 'object') return out
  const v3 = (p: unknown): p is [number, number, number] => Array.isArray(p) && p.length === 3 && p.every((x) => typeof x === 'number' && Number.isFinite(x))
  for (const [ref, b] of Object.entries(u as Record<string, unknown>)) {
    const x = b as Bounds | null
    if (x && typeof x === 'object' && v3(x.min) && v3(x.max)) out[ref] = { min: x.min, max: x.max }
  }
  return out
}
