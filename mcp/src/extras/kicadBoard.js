// SPDX-License-Identifier: AGPL-3.0-only
// A KiCad board file (.kicad_pcb) read here, without KiCad: the outline on
// Edge.Cuts, the board's thickness, its mounting holes and the connectors
// that sit at its edge, with where each faces out. The file is KiCad's
// s-expression text; this reads it with a parser of its own (no KiCad code
// is used — KiCad is GPL, this server AGPL, and it runs KiCad's own
// kicad-cli only as a separate program).
//
// Everything is answered in the frame `kicad-cli pcb export step
// --user-origin` draws the board in when the origin given is the centre of
// the outline's box: millimetres, x to the right, y up (KiCad's y runs
// down), the board's bottom face at z = 0. `origin` says where that centre
// is in KiCad's own coordinates.

/** Files bigger than this are not read (a board is a few MB at most). */
export const MAX_BOARD_BYTES = 100 * 1024 * 1024

/** How close a footprint's box comes to the outline's box to count as at
 *  the edge, mm. */
export const EDGE_REACH = 2.5

// ---- the s-expression -----------------------------------------------------------

/** The file as nested arrays: a list is an array, an atom or a quoted
 *  string a string. Iterative, so a deep file cannot overflow the stack. */
export function parseSexpr(text) {
  if (typeof text !== 'string') throw new Error('The board is not text.')
  const stack = []
  let top = null
  let root = null
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text.charCodeAt(i)
    if (c === 40) {
      // (
      const list = []
      if (top) top.push(list)
      else if (root === null) root = list
      else throw new Error('The board has more than one top-level list.')
      stack.push(list)
      if (stack.length > 200) throw new Error('The board is nested deeper than a KiCad file is.')
      top = list
      i++
    } else if (c === 41) {
      // )
      if (!stack.length) throw new Error('The board has a ")" with no "(" before it.')
      stack.pop()
      top = stack.length ? stack[stack.length - 1] : null
      i++
    } else if (c === 34) {
      // "
      let s = ''
      i++
      let closed = false
      while (i < n) {
        const d = text[i]
        if (d === '\\' && i + 1 < n) {
          const e = text[i + 1]
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e
          i += 2
        } else if (d === '"') {
          closed = true
          i++
          break
        } else {
          s += d
          i++
        }
      }
      if (!closed) throw new Error('The board ends inside a quoted string: the file is cut short.')
      if (!top) throw new Error('The board has text outside its lists.')
      top.push(s)
    } else if (c === 32 || c === 9 || c === 10 || c === 13) i++
    else {
      let j = i
      while (j < n) {
        const d = text.charCodeAt(j)
        if (d === 40 || d === 41 || d === 32 || d === 9 || d === 10 || d === 13 || d === 34) break
        j++
      }
      if (!top) throw new Error('The board has text outside its lists.')
      top.push(text.slice(i, j))
      i = j
    }
  }
  if (stack.length) throw new Error('The board ends before its lists close: the file is cut short.')
  if (!root) throw new Error('The board is empty.')
  return root
}

const isList = (x) => Array.isArray(x)
const find = (l, key) => (isList(l) ? l.find((x) => isList(x) && x[0] === key) : undefined)
const findAll = (l, key) => (isList(l) ? l.filter((x) => isList(x) && x[0] === key) : [])
const num = (x, fallback = NaN) => {
  const v = Number(x)
  return Number.isFinite(v) ? v : fallback
}
const xy = (l) => (l ? [num(l[1]), num(l[2])] : null)
const layerOf = (l) => {
  const ly = find(l, 'layer')
  return ly ? String(ly[1]) : null
}

// ---- geometry ------------------------------------------------------------------

const deg = Math.PI / 180

/** A footprint's place: its local point to the board's (KiCad's rotation:
 *  counter-clockwise as drawn, on y running down). */
function placer(at) {
  const [fx, fy, rot] = at
  const c = Math.cos(rot * deg)
  const s = Math.sin(rot * deg)
  return ([x, y]) => [fx + x * c + y * s, fy - x * s + y * c]
}

/** A circle through three points: its centre and radius, or null (in line). */
function circle3(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  if (Math.abs(d) < 1e-12) return null
  const a2 = a[0] ** 2 + a[1] ** 2
  const b2 = b[0] ** 2 + b[1] ** 2
  const c2 = c[0] ** 2 + c[1] ** 2
  const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d
  const cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d
  return { c: [cx, cy], r: Math.hypot(a[0] - cx, a[1] - cy) }
}

/** Points along an arc from start through mid to end, every 5° or less. */
function arcPoints(a, m, b) {
  const k = circle3(a, m, b)
  if (!k) return [a, b]
  const ang = (p) => Math.atan2(p[1] - k.c[1], p[0] - k.c[0])
  const t0 = ang(a)
  let t1 = ang(b)
  const tm = ang(m)
  // The way round that passes the middle point.
  const norm = (t) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const ccwHasMid = norm(tm - t0) <= norm(t1 - t0)
  let sweep = ccwHasMid ? norm(t1 - t0) : -norm(t0 - t1)
  if (Math.abs(sweep) < 1e-9) sweep = 2 * Math.PI
  t1 = t0 + sweep
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (5 * deg)))
  // Every 5° or less, and on each quarter the arc passes (where it reaches
  // furthest along x or y), so the outline's box is the arc's own, not its
  // chords'.
  const ts = []
  for (let i = 1; i < steps; i++) ts.push((sweep * i) / steps)
  const dir = Math.sign(sweep)
  for (let q = Math.ceil((dir * t0) / (Math.PI / 2) + 1e-9); ; q++) {
    const d = dir * q * (Math.PI / 2) - t0
    if (Math.abs(d) >= Math.abs(sweep) - 1e-9) break
    if (Math.abs(d) > 1e-9) ts.push(d)
  }
  ts.sort((x, y) => dir * (x - y))
  return [a, ...ts.map((d) => [k.c[0] + k.r * Math.cos(t0 + d), k.c[1] + k.r * Math.sin(t0 + d)]), b]
}

/** Points along a cubic Bézier (KiCad's gr_curve / bezier), 32 pieces. */
function bezierPoints([p0, p1, p2, p3]) {
  const out = []
  for (let i = 0; i <= 32; i++) {
    const t = i / 32
    const u = 1 - t
    out.push(i === 0 ? p0 : i === 32 ? p3 : [0, 1].map((j) => u * u * u * p0[j] + 3 * u * u * t * p1[j] + 3 * u * t * t * p2[j] + t * t * t * p3[j]))
  }
  return out
}

function circlePoints(c, r) {
  const steps = 72
  const out = []
  for (let i = 0; i <= steps; i++) {
    const t = (2 * Math.PI * i) / steps
    out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)])
  }
  out[steps] = out[0]
  return out
}

const area = (pts) => {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

function boxOf(points) {
  if (!points.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of points) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return { min: [x0, y0], max: [x1, y1] }
}

/**
 * One graphic item as pieces of outline: each an open polyline, or a closed
 * loop (a circle, a rectangle, a polygon). `place` carries a footprint's
 * local points onto the board. `ends`: every other piece's end points, to
 * settle which way a KiCad 5 arc (centre, start, angle) runs.
 */
function pieces(item, place = (p) => p) {
  const kind = String(item[0]).replace(/^(gr|fp)_/, '')
  const P = (l) => {
    const p = xy(l)
    return p && p.every(Number.isFinite) ? place(p) : null
  }
  if (kind === 'line') {
    const a = P(find(item, 'start'))
    const b = P(find(item, 'end'))
    return a && b ? [{ open: [a, b] }] : []
  }
  if (kind === 'arc') {
    const s = P(find(item, 'start'))
    const m = P(find(item, 'mid'))
    const e = P(find(item, 'end'))
    if (s && m && e) return [{ open: arcPoints(s, m, e) }]
    // KiCad 5: start is the centre, end the arc's start, angle its sweep.
    const angle = num(find(item, 'angle')?.[1])
    if (s && e && Number.isFinite(angle)) {
      const r = Math.hypot(e[0] - s[0], e[1] - s[1])
      const t0 = Math.atan2(e[1] - s[1], e[0] - s[0])
      const both = [1, -1].map((dir) => {
        const t1 = t0 + dir * angle * deg
        const mid = [s[0] + r * Math.cos((t0 + t1) / 2), s[1] + r * Math.sin((t0 + t1) / 2)]
        const end = [s[0] + r * Math.cos(t1), s[1] + r * Math.sin(t1)]
        return arcPoints(e, mid, end)
      })
      return [{ open: both[0], alt: both[1] }]
    }
    return []
  }
  if (kind === 'circle') {
    const c = P(find(item, 'center'))
    const e = P(find(item, 'end'))
    if (!c || !e) return []
    const r = Math.hypot(e[0] - c[0], e[1] - c[1])
    return r > 0 ? [{ loop: circlePoints(c, r), circle: { c, r } }] : []
  }
  if (kind === 'rect') {
    const a = xy(find(item, 'start'))
    const b = xy(find(item, 'end'))
    if (!a || !b) return []
    const pts = [a, [b[0], a[1]], b, [a[0], b[1]]].map((p) => place(p))
    return [{ loop: [...pts, pts[0]] }]
  }
  if (kind === 'poly') {
    // Its corners, and (KiCad 7 on) arcs among them: (arc (start) (mid) (end)).
    const pts = []
    for (const q of find(item, 'pts') ?? []) {
      if (!isList(q)) continue
      if (q[0] === 'xy') {
        const p = P(q)
        if (p) pts.push(p)
      } else if (q[0] === 'arc') {
        const [s, m, e] = ['start', 'mid', 'end'].map((k) => P(find(q, k)))
        if (s && m && e) {
          const run = arcPoints(s, m, e)
          const last = pts[pts.length - 1]
          pts.push(...(last && Math.hypot(last[0] - s[0], last[1] - s[1]) < 1e-6 ? run.slice(1) : run))
        }
      }
    }
    if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts.pop()
    return pts.length >= 3 ? [{ loop: [...pts, pts[0]] }] : []
  }
  if (kind === 'curve') {
    // A cubic Bézier: four control points.
    const ctl = findAll(find(item, 'pts'), 'xy').map((p) => P(p))
    return ctl.length === 4 && ctl.every(Boolean) ? [{ open: bezierPoints(ctl) }] : []
  }
  return []
}

/** Open pieces chained end to end into loops; what does not close is left
 *  over. tol: how far two ends may stand apart and still meet, mm. */
function chain(open, tol = 0.05) {
  const left = open.map((p) => ({ ...p }))
  // A KiCad 5 arc runs the way whose end meets another piece.
  const ends = (except) => left.flatMap((p) => (p === except ? [] : [p.open[0], p.open[p.open.length - 1]]))
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol
  for (const p of left) {
    if (!p.alt) continue
    const others = ends(p)
    const meets = (pts) => others.some((q) => near(q, pts[pts.length - 1]))
    if (!meets(p.open) && meets(p.alt)) p.open = p.alt
    delete p.alt
  }
  const loops = []
  const unclosed = []
  while (left.length) {
    let path = left.shift().open.slice()
    for (let grew = true; grew && !near(path[0], path[path.length - 1]); ) {
      grew = false
      const tail = path[path.length - 1]
      for (let i = 0; i < left.length; i++) {
        const q = left[i].open
        if (near(q[0], tail)) path = path.concat(q.slice(1))
        else if (near(q[q.length - 1], tail)) path = path.concat(q.slice(0, -1).reverse())
        else continue
        left.splice(i, 1)
        grew = true
        break
      }
    }
    if (path.length > 2 && near(path[0], path[path.length - 1])) loops.push(path)
    else unclosed.push(path)
  }
  return { loops, unclosed }
}

// ---- the board ------------------------------------------------------------------

/** The kinds of edge connector, with the opening each needs in a wall —
 *  typical figures (check the part's datasheet): width along the wall and
 *  height across it, its centre's height above the board face it sits on;
 *  `fromBox`: the width comes from the footprint's own extent instead. */
export const CONNECTOR_KINDS = [
  { kind: 'usb_c', label: 'USB-C receptacle', test: /USB[_-]?C(?![a-z])|USB.?Type.?C/i, width: 8.94, height: 3.26, zc: 1.63 },
  { kind: 'micro_usb', label: 'Micro-USB receptacle', test: /micro.?usb|USB[_-]?Micro/i, width: 7.5, height: 2.6, zc: 1.3 },
  { kind: 'mini_usb', label: 'Mini-USB receptacle', test: /mini.?usb|USB[_-]?Mini/i, width: 7.7, height: 3.9, zc: 1.95 },
  { kind: 'usb_a', label: 'USB-A receptacle', test: /USB[_-]?A(?![a-z])|USB.?Type.?A/i, width: 13.1, height: 5.7, zc: 2.85 },
  { kind: 'barrel_jack', label: 'DC barrel jack', test: /barrel.?jack|DC.?jack|PJ-?0\d\d/i, width: 9, height: 9, zc: 6.5, shape: 'round' },
  { kind: 'rj45', label: 'RJ45 jack', test: /RJ45|8P8C/i, width: 15.9, height: 13.4, zc: 6.7 },
  { kind: 'pin_header', label: 'Pin header', test: /Pin(Header|Socket)_\d+x\d+/i, fromBox: true },
  { kind: 'jst', label: 'JST connector', test: /JST[_-]?(PH|XH|SH|GH|ZH|EH|PA|VH)/i, fromBox: true },
]

/** JST housings' height above the board, by series (typical). */
const JST_HEIGHT = { PH: 6, XH: 7, SH: 4.3, GH: 4.3, ZH: 5, EH: 6, PA: 7, VH: 9.5 }

/** A footprint is a connector by its reference (J, P, CN, X, USB) or its
 *  library; which kind by its name. */
const CONNECTOR_REF = /^(J|P|CN|X|USB|CON)\d/i

export function connectorKind(fp) {
  const text = `${fp.footprint} ${fp.value ?? ''}`
  const k = CONNECTOR_KINDS.find((c) => c.test.test(text))
  if (k) return k
  if (CONNECTOR_REF.test(fp.ref ?? '') || /^Connector/i.test(fp.footprint)) return { kind: 'other', label: 'Connector', fromBox: true }
  return null
}

/** The opening a connector needs, before any margin: its kind's typical
 *  size, or its footprint's extent along the wall (along: mm). Height for
 *  a kind sized from its box: a pin header's or JST's typical; for any
 *  other, unknown until its 3D model's box is read (null). */
function openingOf(k, fp, along) {
  if (k.kind === 'pin_header') {
    const m = /_(\d+)x(\d+)_P([\d.]+)mm(?:_(\w+))?/i.exec(fp.footprint)
    const pitch = m ? Number(m[3]) : 2.54
    const rows = m ? Math.min(Number(m[1]), Number(m[2])) : 1
    const horizontal = /Horizontal/i.test(fp.footprint)
    // Angled: the pins come out level at the board; upright: the plug comes
    // down from above, so the opening runs the pins' height (8.5 mm).
    const height = horizontal ? rows * pitch : 8.5
    return { width: along, height, zc: height / 2, shape: 'rect', typical: true }
  }
  if (k.kind === 'jst') {
    const series = /JST[_-]?(PH|XH|SH|GH|ZH|EH|PA|VH)/i.exec(fp.footprint)?.[1]?.toUpperCase()
    const height = JST_HEIGHT[series] ?? 6
    return { width: along, height, zc: height / 2, shape: 'rect', typical: true, series: series ?? null }
  }
  if (k.fromBox) return { width: along, height: null, zc: null, shape: 'rect', typical: false }
  return { width: k.width, height: k.height, zc: k.zc, shape: k.shape ?? 'rect', typical: true }
}

/**
 * The board read from its file's text. `name`: what to call it (the file's
 * name without .kicad_pcb). Throws, saying why, on a file that is not a
 * KiCad board or whose outline does not close.
 */
export function readBoard(text, { name = 'board', edgeReach = EDGE_REACH } = {}) {
  if (typeof text === 'string' && text.length > MAX_BOARD_BYTES) throw new Error('The board file is over 100 MB — not one this reads.')
  const root = parseSexpr(text)
  if (root[0] !== 'kicad_pcb') throw new Error(`Not a KiCad board: the file begins with (${String(root[0]).slice(0, 30)}, not (kicad_pcb.`)
  const version = num(find(root, 'version')?.[1], null)
  const generator = find(root, 'generator')?.[1] ?? null
  const general = find(root, 'general')
  let thickness = num(find(general, 'thickness')?.[1], NaN)
  if (!Number.isFinite(thickness) || thickness <= 0) {
    // The stackup's layers summed, if the general block says nothing.
    const layers = findAll(find(find(root, 'setup'), 'stackup'), 'layer')
    const sum = layers.reduce((s, l) => s + num(find(l, 'thickness')?.[1], 0), 0)
    thickness = sum > 0 ? sum : 1.6
  }
  const layers = findAll(root, 'layers').flatMap((l) => l.slice(1)).filter(isList).map((l) => ({ name: String(l[1]), type: String(l[2] ?? ''), user: l[3] !== undefined ? String(l[3]) : null }))

  // The outline: every Edge.Cuts item on the board and in its footprints.
  const edge = []
  for (const item of root) if (isList(item) && /^gr_(line|arc|circle|rect|poly|curve)$/.test(item[0]) && layerOf(item) === 'Edge.Cuts') edge.push(...pieces(item))
  const footprints = []
  for (const f of root) {
    if (!isList(f) || (f[0] !== 'footprint' && f[0] !== 'module')) continue
    const at = find(f, 'at')
    const place = placer([num(at?.[1], 0), num(at?.[2], 0), num(at?.[3], 0)])
    const prop = (key) => {
      const p = findAll(f, 'property').find((x) => String(x[1]).toLowerCase() === key)
      if (p) return String(p[2] ?? '')
      const t = findAll(f, 'fp_text').find((x) => x[1] === key)
      return t ? String(t[2] ?? '') : null
    }
    const attr = find(f, 'attr')?.slice(1).map(String) ?? []
    const pads = findAll(f, 'pad').map((p) => {
      const pat = find(p, 'at')
      const size = find(p, 'size')
      const drill = find(p, 'drill')
      // (drill 3.2) or (drill oval 1.2 2.4): the smaller across an oval.
      const dvals = drill ? drill.slice(1).filter((x) => !isList(x) && x !== 'oval').map(Number).filter(Number.isFinite) : []
      const local = [num(pat?.[1], 0), num(pat?.[2], 0)]
      return {
        number: String(p[1] ?? ''),
        type: String(p[2] ?? ''),
        shape: String(p[3] ?? ''),
        at: place(local),
        // The pad's angle is written whole (the footprint's turn in it).
        rot: num(pat?.[3], 0),
        size: [num(size?.[1], 0), num(size?.[2], 0)],
        drill: dvals.length ? Math.min(...dvals) : 0,
      }
    })
    const graphics = f.filter((x) => isList(x) && /^fp_(line|arc|circle|rect|poly|curve)$/.test(x[0]))
    for (const g of graphics) if (layerOf(g) === 'Edge.Cuts') edge.push(...pieces(g, place))
    const ptsOn = (re) => graphics.filter((g) => re.test(layerOf(g) ?? '')).flatMap((g) => pieces(g, place).flatMap((p) => p.open ?? p.loop))
    const padPts = pads.flatMap((p) => {
      const [w, h] = p.size
      const c = Math.cos(p.rot * deg)
      const s = Math.sin(p.rot * deg)
      return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [p.at[0] + x * c + y * s, p.at[1] - x * s + y * c])
    })
    const courtyard = boxOf(ptsOn(/^[FB]\.CrtYd$/))
    const fab = boxOf(ptsOn(/^[FB]\.Fab$/))
    const padBox = boxOf(padPts)
    footprints.push({
      ref: prop('reference') ?? '',
      value: prop('value') ?? '',
      footprint: String(f[1] ?? ''),
      layer: layerOf(f) ?? 'F.Cu',
      at: [num(at?.[1], 0), num(at?.[2], 0)],
      rot: num(at?.[3], 0),
      attr,
      pads,
      box: courtyard ?? fab ?? padBox,
      boxFrom: courtyard ? 'courtyard' : fab ? 'fab' : padBox ? 'pads' : null,
    })
  }

  const loops = edge.filter((p) => p.loop).map((p) => ({ pts: p.loop, circle: p.circle ?? null }))
  const chained = chain(edge.filter((p) => p.open))
  loops.push(...chained.loops.map((pts) => ({ pts, circle: null })))
  if (!loops.length) throw new Error(chained.unclosed.length ? `The outline on Edge.Cuts does not close: ${chained.unclosed.length} open run${chained.unclosed.length > 1 ? 's' : ''} — close it in KiCad (Inspect → Board Setup or DRC finds the gap).` : 'The board has no outline on Edge.Cuts: draw one in KiCad first.')
  loops.sort((a, b) => Math.abs(area(b.pts)) - Math.abs(area(a.pts)))
  const outer = loops[0]
  const ob = boxOf(outer.pts)
  const cx = (ob.min[0] + ob.max[0]) / 2
  const cy = (ob.min[1] + ob.max[1]) / 2
  // KiCad's frame to the STEP's: centred, y up.
  const T = ([x, y]) => [r4(x - cx), r4(cy - y)]
  const inside = (p) => pointIn(p, outer.pts)

  // Mounting holes: MountingHole footprints, and footprints that are only
  // unplated holes; circles on Edge.Cuts inside the outline too.
  const holes = []
  for (const f of footprints) {
    const drilled = f.pads.filter((p) => p.drill > 0)
    if (!drilled.length) continue
    const mounting = /MountingHole/i.test(f.footprint) || f.pads.every((p) => p.type === 'np_thru_hole')
    if (!mounting) continue
    const big = drilled.reduce((a, b) => (b.drill > a.drill ? b : a))
    if (big.drill < 1) continue
    const [x, y] = T(big.at)
    holes.push({ ref: f.ref, x, y, d: r4(big.drill), plated: big.type === 'thru_hole', from: 'footprint', footprint: f.footprint })
  }
  for (const l of loops.slice(1)) {
    if (!l.circle || l.circle.r * 2 < 1 || l.circle.r * 2 > 10 || !inside(l.circle.c)) continue
    const [x, y] = T(l.circle.c)
    if (holes.some((h) => Math.hypot(h.x - x, h.y - y) < 0.1)) continue
    holes.push({ ref: null, x, y, d: r4(l.circle.r * 2), plated: false, from: 'Edge.Cuts circle' })
  }

  // Connectors at the edge: which side of the outline's box each faces, how
  // far in it stands (negative: out over the edge), and its opening.
  const connectors = []
  for (const f of footprints) {
    const k = connectorKind(f)
    if (!k || !f.box) continue
    const b = f.box
    const gaps = { '-x': b.min[0] - ob.min[0], '+x': ob.max[0] - b.max[0], '+y': b.min[1] - ob.min[1], '-y': ob.max[1] - b.max[1] }
    const [side, gap] = Object.entries(gaps).reduce((a, e) => (e[1] < a[1] ? e : a))
    if (gap > edgeReach) continue
    const lo = T(b.min)
    const hi = T(b.max)
    const box = { min: [Math.min(lo[0], hi[0]), Math.min(lo[1], hi[1])], max: [Math.max(lo[0], hi[0]), Math.max(lo[1], hi[1])] }
    const alongX = side === '+y' || side === '-y'
    const along = r4(alongX ? box.max[0] - box.min[0] : box.max[1] - box.min[1])
    const opening = openingOf(k, f, along)
    const [x, y] = T(f.at)
    connectors.push({
      ref: f.ref,
      value: f.value,
      footprint: f.footprint,
      kind: k.kind,
      label: k.label,
      x,
      y,
      rot: f.rot,
      face: f.layer.startsWith('B.') ? 'bottom' : 'top',
      side,
      inset: r4(gap),
      // Where along the wall: the box's middle, not the footprint's origin
      // (which KiCad puts at pin 1 on many connectors).
      centre: r4(alongX ? (box.min[0] + box.max[0]) / 2 : (box.min[1] + box.max[1]) / 2),
      box: { min: box.min.map(r4), max: box.max.map(r4) },
      boxFrom: f.boxFrom,
      opening,
    })
  }

  const outline = outer.pts.map(T)
  const cutouts = loops.slice(1).filter((l) => !l.circle || l.circle.r * 2 > 10).filter((l) => inside(l.pts[0])).map((l) => l.pts.map(T))
  // Loops outside the biggest: more boards in the file (a panel), left out.
  const others = loops.slice(1).filter((l) => !inside(l.pts[0])).length
  return {
    name,
    format: version,
    generator,
    thickness: r4(thickness),
    layers,
    origin: [r4(cx), r4(cy)],
    size: [r4(ob.max[0] - ob.min[0]), r4(ob.max[1] - ob.min[1])],
    outline: simplify(outline),
    cutouts: cutouts.map(simplify),
    ...(chained.unclosed.length ? { unclosed: chained.unclosed.length } : {}),
    ...(others ? { others, note: `${others} more outline${others > 1 ? 's' : ''} outside this one (a panel?): only the biggest board is read.` } : {}),
    holes,
    connectors,
    footprints: { count: footprints.length, top: footprints.filter((f) => !f.layer.startsWith('B.')).length, bottom: footprints.filter((f) => f.layer.startsWith('B.')).length },
    components: footprints.map((f) => {
      const [x, y] = T(f.at)
      return { ref: f.ref, footprint: f.footprint, x, y, face: f.layer.startsWith('B.') ? 'bottom' : 'top', dnp: f.attr.includes('dnp') }
    }),
  }
}

const r4 = (x) => Math.round(x * 10000) / 10000

/** Points in a row that add nothing (on a straight run) dropped. */
function simplify(pts) {
  const out = []
  for (const p of pts) {
    const prev = out[out.length - 1]
    if (prev && Math.hypot(prev[0] - p[0], prev[1] - p[1]) < 1e-4) continue
    if (out.length >= 2) {
      const a = out[out.length - 2]
      const cross = (prev[0] - a[0]) * (p[1] - a[1]) - (prev[1] - a[1]) * (p[0] - a[0])
      if (Math.abs(cross) < 1e-6) {
        out[out.length - 1] = p
        continue
      }
    }
    out.push(p)
  }
  return out
}

function pointIn([x, y], poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** The board's own layer names to plot for a fab: copper, mask, silk,
 *  paste and the outline, as the file names them. */
export function fabLayers(board) {
  const names = board.layers.map((l) => l.name)
  const want = (re) => names.filter((n) => re.test(n))
  const copper = board.layers.filter((l) => /\.Cu$/.test(l.name) && l.type !== 'user')
  return [...copper.map((l) => l.name), ...want(/^[FB]\.Mask$/), ...want(/^[FB]\.(SilkS|Silkscreen)$/), ...want(/^[FB]\.Paste$/), ...want(/^Edge\.Cuts$/)]
}
