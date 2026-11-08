// SPDX-License-Identifier: AGPL-3.0-only
// Circuit JSON — tscircuit's low-level description of a board, the file
// `tsci build` writes — read here with no tscircuit code: the elements the
// Circuit workspace builds solids and figures from, each checked field by
// field, those that do not check set aside with why.
//
// The element shapes follow the zod schemas of tscircuit's circuit-json
// package (github.com/tscircuit/circuit-json, ISC licence, © tscircuit Inc.;
// read at commit a612096, v0.0.547): pcb_board, pcb_component, pcb_smtpad,
// pcb_plated_hole, pcb_hole, pcb_via, pcb_trace (its wire, via and
// through_pad route points), pcb_copper_pour, pcb_cutout, source_component
// and cad_component, and the *_error / *_warning elements a build leaves.
// Lengths are millimetres when they are numbers (circuit-json's base unit);
// a string carries its unit ("1.6mm", "10mil"). Angles are degrees.

export type Layer = 'top' | 'bottom' | `inner${number}`
export interface Pt {
  x: number
  y: number
}

/** A copper or drill outline in the board's plane. */
export type Outline =
  | { kind: 'circle'; x: number; y: number; r: number }
  /** A rectangle centred on (x, y), turned rot degrees anticlockwise, its corners rounded r. */
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rot: number; r: number }
  /** A rectangle with fully round ends — a slot or a pill pad. */
  | { kind: 'pill'; x: number; y: number; w: number; h: number; rot: number }
  | { kind: 'polygon'; points: Pt[] }

export interface Board {
  id: string
  center: Pt
  width: number
  height: number
  thickness: number
  layers: number
  /** The outline's corners, when it is not the rectangle. */
  outline: Pt[] | null
  material: string
}

export interface Pad {
  id: string
  layer: Layer
  outline: Outline
  component: string | null
  port: string | null
}

export interface PlatedHole {
  id: string
  layers: Layer[]
  /** The copper on each of its layers. */
  pad: Outline
  drill: Outline
  component: string | null
  port: string | null
}

export interface Hole {
  id: string
  drill: Outline
}

export interface Via {
  id: string
  x: number
  y: number
  outer: number
  drill: number
  layers: Layer[]
  trace: string | null
}

export interface Segment {
  a: Pt
  b: Pt
  /** Width at a and at b — the same unless the wire tapers. */
  w0: number
  w1: number
  layer: Layer
}

export interface RouteVia {
  x: number
  y: number
  from: Layer
  to: Layer
  drill: number | null
  outer: number | null
}

export interface Trace {
  id: string
  source: string | null
  segments: Segment[]
  vias: RouteVia[]
}

export interface Component {
  id: string
  source: string | null
  name: string | null
  center: Pt
  width: number
  height: number
  rotation: number
  layer: Layer
  /** How tall it stands off the board, from its cad_component, when one says. */
  tall: number | null
}

export interface Pour {
  id: string
  layer: Layer
  outline: Outline
}

export interface Note {
  type: string
  message: string
}

export interface Problem {
  /** Where: the element's index and type. */
  at: string
  why: string
}

export interface CircuitBoard {
  boards: Board[]
  pads: Pad[]
  platedHoles: PlatedHole[]
  holes: Hole[]
  vias: Via[]
  traces: Trace[]
  components: Component[]
  pours: Pour[]
  /** Openings cut through the board: holes in its outline. */
  cutouts: Outline[]
  /** The build's own *_error and *_warning elements. */
  errors: Note[]
  warnings: Note[]
  /** Elements counted by type. */
  counts: Record<string, number>
  /** Elements that did not check, and were left out. */
  problems: Problem[]
  /** Elements read but not built from: silkscreen, brep pours … by type. */
  unbuilt: Record<string, number>
}

export class CircuitJsonError extends Error {}

// ---- units ------------------------------------------------------------------------

/** Millimetres per unit, as circuit-json's strings carry them. */
const PER: Record<string, number> = { mm: 1, cm: 10, m: 1000, um: 0.001, µm: 0.001, mil: 0.0254, in: 25.4, inch: 25.4 }

/** A length in mm: a number (mm already) or a string with its unit. */
export function lengthOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const m = /^\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)\s*([a-zµ]*)\s*$/i.exec(v)
  if (!m) return null
  const unit = m[2].toLowerCase() || 'mm' // units-ok: circuit-json's base unit, an id
  const k = PER[unit]
  return k === undefined ? null : Number(m[1]) * k
}

/** An angle in degrees: a number, or a string in deg or rad. */
export function angleOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const m = /^\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)\s*(deg|rad)?\s*$/i.exec(v)
  if (!m) return null
  return m[2]?.toLowerCase() === 'rad' ? (Number(m[1]) * 180) / Math.PI : Number(m[1])
}

const LAYERS = new Set(['top', 'bottom', 'inner1', 'inner2', 'inner3', 'inner4', 'inner5', 'inner6', 'inner7', 'inner8'])

/** A layer: its name, or { name } as circuit-json also takes. */
function layerOf(v: unknown): Layer | null {
  const s = typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string' ? (v as { name: string }).name : null
  return s && LAYERS.has(s) ? (s as Layer) : null
}

// ---- reading ------------------------------------------------------------------------

/** Field readers that throw the field's name: the element is then set aside. */
class Bad extends Error {}
type O = Record<string, unknown>
const need = (o: O, k: string): number => {
  const v = lengthOf(o[k])
  if (v === null) throw new Bad(`${k} is ${o[k] === undefined ? 'missing' : 'not a length'}`)
  return v
}
const pos = (o: O, k: string): number => {
  const v = need(o, k)
  if (!(v > 0)) throw new Bad(`${k} must be above 0`)
  return v
}
const opt = (o: O, k: string, d: number): number => (o[k] === undefined ? d : need(o, k))
const optPos = (o: O, k: string, d: number): number => (o[k] === undefined ? d : pos(o, k))
const ang = (o: O, k: string): number => {
  if (o[k] === undefined) return 0
  const v = angleOf(o[k])
  if (v === null) throw new Bad(`${k} is not an angle`)
  return v
}
const pt = (v: unknown, k: string): Pt => {
  if (!v || typeof v !== 'object') throw new Bad(`${k} is not a point`)
  const x = lengthOf((v as O).x)
  const y = lengthOf((v as O).y)
  if (x === null || y === null) throw new Bad(`${k} is not a point`)
  return { x, y }
}
const pts = (v: unknown, k: string, min: number): Pt[] => {
  if (!Array.isArray(v) || v.length < min) throw new Bad(`${k} needs ${min} points or more`)
  return v.map((p, i) => pt(p, `${k}[${i}]`))
}
const lay = (o: O, k: string): Layer => {
  const l = layerOf(o[k])
  if (!l) throw new Bad(`${k} is not a layer (top, bottom, inner1–8)`)
  return l
}
const lays = (o: O, k: string): Layer[] => {
  const v = o[k]
  if (!Array.isArray(v) || !v.length) throw new Bad(`${k} is not a list of layers`)
  return v.map((x) => {
    const l = layerOf(x)
    if (!l) throw new Bad(`${k} holds ${JSON.stringify(x)}, not a layer`)
    return l
  })
}
const idOf = (o: O, k: string, i: number): string => (typeof o[k] === 'string' && o[k] ? (o[k] as string) : `${k.replace(/_id$/, '')}_${i}`)
const strOr = (o: O, k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null)

/** A pad's copper outline, from an smtpad's shape. */
function smtOutline(o: O): Outline {
  const x = () => need(o, 'x')
  const y = () => need(o, 'y')
  switch (o.shape) {
    case 'circle':
      return { kind: 'circle', x: x(), y: y(), r: pos(o, 'radius') }
    case 'rect':
    case 'rotated_rect': {
      const w = pos(o, 'width')
      const h = pos(o, 'height')
      const r = Math.max(0, opt(o, 'corner_radius', opt(o, 'rect_border_radius', 0)))
      return { kind: 'rect', x: x(), y: y(), w, h, rot: o.shape === 'rotated_rect' ? ang(o, 'ccw_rotation') : 0, r: Math.min(r, w / 2, h / 2) }
    }
    case 'pill':
    case 'rotated_pill': {
      const w = pos(o, 'width')
      const h = pos(o, 'height')
      const r = pos(o, 'radius')
      const rot = o.shape === 'rotated_pill' ? ang(o, 'ccw_rotation') : 0
      // A pill whose radius is less than half its narrow side is a rounded rectangle.
      return r < Math.min(w, h) / 2 - 1e-9 ? { kind: 'rect', x: x(), y: y(), w, h, rot, r } : { kind: 'pill', x: x(), y: y(), w, h, rot }
    }
    case 'polygon':
      return { kind: 'polygon', points: pts(o.points, 'points', 3) }
    default:
      throw new Bad(`shape ${JSON.stringify(o.shape)} is not an smtpad shape`)
  }
}

/** A drilled opening's outline: circle, square, rect, oval or pill. */
function drillOf(shape: unknown, o: O, x: number, y: number, rot: number): Outline {
  switch (shape) {
    case 'circle':
      return { kind: 'circle', x, y, r: pos(o, 'hole_diameter') / 2 }
    case 'square': {
      const d = pos(o, 'hole_diameter')
      return { kind: 'rect', x, y, w: d, h: d, rot, r: 0 }
    }
    case 'rect':
      return { kind: 'rect', x, y, w: pos(o, 'hole_width'), h: pos(o, 'hole_height'), rot, r: 0 }
    case 'oval':
    case 'pill':
    case 'rotated_pill':
      return { kind: 'pill', x, y, w: pos(o, 'hole_width'), h: pos(o, 'hole_height'), rot }
    default:
      throw new Bad(`hole_shape ${JSON.stringify(shape)} is not one read`)
  }
}

function platedOf(o: O): Pick<PlatedHole, 'pad' | 'drill'> {
  const x = need(o, 'x')
  const y = need(o, 'y')
  const hx = x + opt(o, 'hole_offset_x', 0)
  const hy = y + opt(o, 'hole_offset_y', 0)
  switch (o.shape) {
    case 'circle': {
      const outer = pos(o, 'outer_diameter')
      const d = pos(o, 'hole_diameter')
      if (d >= outer) throw new Bad('hole_diameter must be less than outer_diameter')
      return { pad: { kind: 'circle', x, y, r: outer / 2 }, drill: { kind: 'circle', x, y, r: d / 2 } }
    }
    case 'oval':
    case 'pill': {
      const rot = ang(o, 'ccw_rotation')
      return { pad: { kind: 'pill', x, y, w: pos(o, 'outer_width'), h: pos(o, 'outer_height'), rot }, drill: { kind: 'pill', x, y, w: pos(o, 'hole_width'), h: pos(o, 'hole_height'), rot } }
    }
    case 'circular_hole_with_rect_pad':
    case 'pill_hole_with_rect_pad':
    case 'rotated_pill_hole_with_rect_pad': {
      const w = pos(o, 'rect_pad_width')
      const h = pos(o, 'rect_pad_height')
      const r = Math.min(Math.max(0, opt(o, 'rect_border_radius', 0)), w / 2, h / 2)
      const pad: Outline = { kind: 'rect', x, y, w, h, rot: ang(o, 'rect_ccw_rotation'), r }
      const drill = o.shape === 'circular_hole_with_rect_pad' ? drillOf('circle', o, hx, hy, 0) : drillOf('pill', o, hx, hy, ang(o, 'hole_ccw_rotation'))
      return { pad, drill }
    }
    case 'hole_with_polygon_pad': {
      // The pad's outline is taken as offsets from (x, y), turned by ccw_rotation.
      const rot = (ang(o, 'ccw_rotation') * Math.PI) / 180
      const c = Math.cos(rot)
      const s = Math.sin(rot)
      const points = pts(o.pad_outline, 'pad_outline', 3).map((p) => ({ x: x + p.x * c - p.y * s, y: y + p.x * s + p.y * c }))
      const hs = o.hole_shape === 'circle' ? 'circle' : 'pill'
      return { pad: { kind: 'polygon', points }, drill: drillOf(hs, o, hx, hy, hs === 'pill' ? ang(o, 'ccw_rotation') : 0) }
    }
    default:
      throw new Bad(`shape ${JSON.stringify(o.shape)} is not a plated hole shape`)
  }
}

function traceOf(o: O, id: string): Trace {
  if (!Array.isArray(o.route)) throw new Bad('route is not a list')
  const segments: Segment[] = []
  const vias: RouteVia[] = []
  type P = { x: number; y: number; layer: Layer; w0: number; w1: number } | null
  let prev: P = null
  for (const [i, raw] of o.route.entries()) {
    if (!raw || typeof raw !== 'object') throw new Bad(`route[${i}] is not a route point`)
    const p = raw as O
    if (p.route_type === 'wire') {
      const x = need(p, 'x')
      const y = need(p, 'y')
      const w = pos(p, 'width')
      const layer = lay(p, 'layer')
      const tapered = p.start_width !== undefined || p.end_width !== undefined
      const w0 = tapered ? optPos(p, 'start_width', w) : w
      const w1 = tapered ? optPos(p, 'end_width', w) : w
      // A wire point's width is the width from it to the next point.
      if (prev && prev.layer === layer && (prev.x !== x || prev.y !== y)) segments.push({ a: { x: prev.x, y: prev.y }, b: { x, y }, w0: prev.w0, w1: prev.w1, layer })
      prev = { x, y, layer, w0, w1: tapered ? w1 : w0 }
    } else if (p.route_type === 'via') {
      const v: RouteVia = { x: need(p, 'x'), y: need(p, 'y'), from: lay(p, 'from_layer'), to: lay(p, 'to_layer'), drill: p.hole_diameter === undefined ? null : pos(p, 'hole_diameter'), outer: p.outer_diameter === undefined ? null : pos(p, 'outer_diameter') }
      vias.push(v)
      // The wire goes on from the via on its other layer.
      prev = prev ? { x: v.x, y: v.y, layer: v.to, w0: prev.w0, w1: prev.w1 } : null
    } else if (p.route_type === 'through_pad') {
      const a = pt(p.start, `route[${i}].start`)
      const b = pt(p.end, `route[${i}].end`)
      const w = pos(p, 'width')
      const l0 = lay(p, 'start_layer')
      const l1 = lay(p, 'end_layer')
      if (l0 === l1 && (a.x !== b.x || a.y !== b.y)) segments.push({ a, b, w0: w, w1: w, layer: l0 })
      prev = prev ? { x: b.x, y: b.y, layer: l1, w0: prev.w0, w1: prev.w1 } : null
    } else throw new Bad(`route[${i}].route_type ${JSON.stringify(p.route_type)} is not wire, via or through_pad`)
  }
  return { id, source: strOr(o, 'source_trace_id'), segments, vias }
}

function pourOf(o: O): Outline | null {
  if (o.shape === 'rect') {
    const c = pt(o.center, 'center')
    return { kind: 'rect', x: c.x, y: c.y, w: pos(o, 'width'), h: pos(o, 'height'), rot: ang(o, 'rotation'), r: 0 }
  }
  if (o.shape === 'polygon') return { kind: 'polygon', points: pts(o.points, 'points', 3) }
  return null
}

function cutoutOf(o: O): Outline[] {
  switch (o.shape) {
    case 'rect': {
      const c = pt(o.center, 'center')
      const w = pos(o, 'width')
      const h = pos(o, 'height')
      return [{ kind: 'rect', x: c.x, y: c.y, w, h, rot: ang(o, 'rotation'), r: Math.min(Math.max(0, opt(o, 'corner_radius', 0)), w / 2, h / 2) }]
    }
    case 'circle': {
      const c = pt(o.center, 'center')
      return [{ kind: 'circle', x: c.x, y: c.y, r: pos(o, 'radius') }]
    }
    case 'polygon':
      return [{ kind: 'polygon', points: pts(o.points, 'points', 3) }]
    case 'path': {
      // A slot along the path: a pill per leg.
      const route = pts(o.route, 'route', 2)
      const w = pos(o, 'slot_width')
      return route.slice(1).map((b, i) => {
        const a = route[i]
        const len = Math.hypot(b.x - a.x, b.y - a.y)
        return { kind: 'pill', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: len + w, h: w, rot: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI }
      })
    }
    default:
      throw new Bad(`shape ${JSON.stringify(o.shape)} is not a cutout shape`)
  }
}

const UNBUILT = /^pcb_(silkscreen|fabrication_note|note|courtyard|solder_paste|soldermask|text|copper_text|keepout|port|group|net|trace_hint|breakout|panel|stiffener|bend|thermal_spoke|ground_plane)/

/** Read a Circuit JSON document: the text of a circuit.json, or its array.
 *  Throws only when it is no Circuit JSON at all; an element that does not
 *  check is left out and listed in problems. */
export function readCircuitJson(input: string | unknown): CircuitBoard {
  let doc: unknown = input
  if (typeof input === 'string') {
    try {
      doc = JSON.parse(input)
    } catch (e) {
      throw new CircuitJsonError(`Not JSON: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (!Array.isArray(doc)) throw new CircuitJsonError('Circuit JSON is a list of elements; this is not a list.')
  const out: CircuitBoard = { boards: [], pads: [], platedHoles: [], holes: [], vias: [], traces: [], components: [], pours: [], cutouts: [], errors: [], warnings: [], counts: {}, problems: [], unbuilt: {} }
  const names = new Map<string, string>()
  const tall = new Map<string, number>()
  // Names and heights first: a component may come before its source.
  for (const e of doc) {
    if (!e || typeof e !== 'object') continue
    const o = e as O
    if (o.type === 'source_component' && typeof o.source_component_id === 'string' && typeof o.name === 'string') names.set(o.source_component_id, o.name)
    if (o.type === 'cad_component' && typeof o.pcb_component_id === 'string' && o.size && typeof o.size === 'object') {
      const z = lengthOf((o.size as O).z)
      if (z !== null && z > 0) tall.set(o.pcb_component_id, z)
    }
  }
  if (!doc.some((e) => e && typeof e === 'object' && typeof (e as O).type === 'string')) throw new CircuitJsonError('No element in it has a type: it is not Circuit JSON.')
  for (const [i, e] of doc.entries()) {
    if (!e || typeof e !== 'object' || typeof (e as O).type !== 'string') {
      out.problems.push({ at: `[${i}]`, why: 'not an element (no type)' })
      continue
    }
    const o = e as O
    const type = o.type as string
    out.counts[type] = (out.counts[type] ?? 0) + 1
    try {
      switch (type) {
        case 'pcb_board': {
          const center = o.center === undefined ? { x: 0, y: 0 } : pt(o.center, 'center')
          const outline = o.outline === undefined ? null : pts(o.outline, 'outline', 3)
          let width = o.width === undefined ? null : pos(o, 'width')
          let height = o.height === undefined ? null : pos(o, 'height')
          if (outline && (width === null || height === null)) {
            const xs = outline.map((p) => p.x)
            const ys = outline.map((p) => p.y)
            width = Math.max(...xs) - Math.min(...xs)
            height = Math.max(...ys) - Math.min(...ys)
          }
          if (width === null || height === null) throw new Bad('width and height, or an outline, are needed')
          const layers = o.num_layers === undefined ? 2 : Number(o.num_layers)
          if (!Number.isInteger(layers) || layers < 1 || layers > 10) throw new Bad('num_layers is not 1 to 10')
          out.boards.push({ id: idOf(o, 'pcb_board_id', i), center, width, height, thickness: optPos(o, 'thickness', 1.4), layers, outline, material: typeof o.material === 'string' ? o.material : 'fr4' })
          break
        }
        case 'pcb_smtpad':
          out.pads.push({ id: idOf(o, 'pcb_smtpad_id', i), layer: lay(o, 'layer'), outline: smtOutline(o), component: strOr(o, 'pcb_component_id'), port: strOr(o, 'pcb_port_id') })
          break
        case 'pcb_plated_hole':
          out.platedHoles.push({ id: idOf(o, 'pcb_plated_hole_id', i), layers: lays(o, 'layers'), ...platedOf(o), component: strOr(o, 'pcb_component_id'), port: strOr(o, 'pcb_port_id') })
          break
        case 'pcb_hole': {
          const x = need(o, 'x')
          const y = need(o, 'y')
          out.holes.push({ id: idOf(o, 'pcb_hole_id', i), drill: drillOf(o.hole_shape, o, x, y, ang(o, 'ccw_rotation')) })
          break
        }
        case 'pcb_via': {
          const outer = optPos(o, 'outer_diameter', 0.6)
          const drill = optPos(o, 'hole_diameter', 0.25)
          if (drill >= outer) throw new Bad('hole_diameter must be less than outer_diameter')
          const layers = o.layers !== undefined ? lays(o, 'layers') : [o.from_layer, o.to_layer].map((l) => layerOf(l)).filter((l): l is Layer => !!l)
          if (layers.length < 2) throw new Bad('layers are needed')
          out.vias.push({ id: idOf(o, 'pcb_via_id', i), x: need(o, 'x'), y: need(o, 'y'), outer, drill, layers, trace: strOr(o, 'pcb_trace_id') })
          break
        }
        case 'pcb_trace':
          out.traces.push(traceOf(o, idOf(o, 'pcb_trace_id', i)))
          break
        case 'pcb_component': {
          const id = idOf(o, 'pcb_component_id', i)
          const source = strOr(o, 'source_component_id')
          out.components.push({ id, source, name: source ? (names.get(source) ?? null) : null, center: pt(o.center, 'center'), width: Math.max(0, need(o, 'width')), height: Math.max(0, need(o, 'height')), rotation: ang(o, 'rotation'), layer: lay(o, 'layer'), tall: tall.get(id) ?? null })
          break
        }
        case 'pcb_copper_pour': {
          const outline = pourOf(o)
          if (!outline) {
            out.unbuilt[`pcb_copper_pour (${String(o.shape)})`] = (out.unbuilt[`pcb_copper_pour (${String(o.shape)})`] ?? 0) + 1
            break
          }
          out.pours.push({ id: idOf(o, 'pcb_copper_pour_id', i), layer: lay(o, 'layer'), outline })
          break
        }
        case 'pcb_cutout':
          out.cutouts.push(...cutoutOf(o))
          break
        default: {
          const message = typeof o.message === 'string' ? o.message : ''
          if (/_error$/.test(type)) out.errors.push({ type, message })
          else if (/_warning$/.test(type)) out.warnings.push({ type, message })
          else if (UNBUILT.test(type)) out.unbuilt[type] = (out.unbuilt[type] ?? 0) + 1
        }
      }
    } catch (err) {
      if (!(err instanceof Bad)) throw err
      out.problems.push({ at: `[${i}] ${type}`, why: err.message })
    }
  }
  return out
}

/** The board a document is about: its one board, or the first of several. */
export const boardOf = (c: CircuitBoard): Board | null => c.boards[0] ?? null
