// SPDX-License-Identifier: AGPL-3.0-only
// A sliced job read back from its G-code, line by line: the slicer's own
// totals from the header and footer comments where it writes them (time,
// filament length and weight, layer count — OrcaSlicer, Bambu Studio and
// PrusaSlicer each have their spelling), and what the moves themselves
// say — the layers and their heights, extrusion by feature type, travel,
// retractions. Whatever is estimated rather than counted is labelled so.

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const TIME_PATTERNS = [/estimated printing time \(normal mode\)\s*=\s*([0-9dhms\s]+)/i, /total estimated time\s*[:=]\s*([0-9dhms\s]+)/i, /model printing time\s*[:=]\s*([0-9dhms\s]+)/i]
const LENGTH_PATTERNS = [/^;\s*filament used \[mm\]\s*=\s*([\d.,\s]+)$/i, /^;\s*total filament length \[mm\]\s*[:=]\s*([\d.,\s]+)$/i]
const WEIGHT_PATTERNS = [/^;\s*filament used \[g\]\s*=\s*([\d.,\s]+)$/i, /^;\s*total filament weight \[g\]\s*[:=]\s*([\d.,\s]+)$/i]
const LAYERS_PATTERNS = [/^;\s*total layer number\s*[:=]\s*(\d+)/i, /^;\s*total layers count\s*[:=]\s*(\d+)/i]

/** "1h 2m 3s", "1d 2h 3m 4s", "62m 3s" → seconds. */
export function parseDuration(text) {
  let s = 0
  for (const [, n, u] of String(text).matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/gi)) s += Number(n) * { d: 86400, h: 3600, m: 60, s: 1 }[u.toLowerCase()]
  return s || null
}

const sum = (text) => String(text).split(/[,\s]+/).filter(Boolean).map(Number).filter(Number.isFinite).reduce((a, b) => a + b, 0)

/** Feature names, every slicer's spelling to one word. */
function feature(type) {
  const t = type.trim().toLowerCase()
  if (/outer|external perimeter/.test(t)) return 'outer wall'
  if (/inner wall|perimeter/.test(t)) return 'inner wall'
  if (/overhang/.test(t)) return 'overhang wall'
  if (/bridge/.test(t)) return 'bridge'
  if (/top/.test(t)) return 'top surface'
  if (/bottom/.test(t)) return 'bottom surface'
  if (/solid/.test(t)) return 'solid infill'
  if (/infill/.test(t)) return 'sparse infill'
  if (/support/.test(t)) return 'support'
  if (/skirt|brim/.test(t)) return 'skirt / brim'
  if (/wipe|prime|tower/.test(t)) return 'prime tower'
  return t
}

export async function readGcode(path) {
  const totals = { seconds: null, filamentMm: null, filamentG: null, layers: null }
  const byType = new Map()
  const layers = []
  let layer = null
  let x = 0, y = 0, z = 0, e = 0
  let relE = false, relXYZ = false, type = 'unknown'
  let travelMm = 0, travels = 0, retractions = 0, extrudedMm = 0
  const startLayer = (zz) => {
    layer = { z: Math.round(zz * 1000) / 1000, extrudedMm: 0, moves: 0 }
    layers.push(layer)
  }
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const raw of rl) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith(';')) {
      for (const p of TIME_PATTERNS) {
        const m = p.exec(line)
        if (m && totals.seconds === null) totals.seconds = parseDuration(m[1])
      }
      for (const p of LENGTH_PATTERNS) {
        const m = p.exec(line)
        if (m && totals.filamentMm === null) totals.filamentMm = sum(m[1])
      }
      for (const p of WEIGHT_PATTERNS) {
        const m = p.exec(line)
        if (m && totals.filamentG === null) totals.filamentG = sum(m[1])
      }
      for (const p of LAYERS_PATTERNS) {
        const m = p.exec(line)
        if (m && totals.layers === null) totals.layers = Number(m[1])
      }
      const t = /^;\s*(?:TYPE|FEATURE)\s*:\s*(.+)$/i.exec(line)
      if (t) type = feature(t[1])
      const zc = /^;\s*Z\s*:\s*([\d.]+)/.exec(line)
      if (zc) startLayer(Number(zc[1]))
      continue
    }
    const code = line.split(';')[0].trim()
    const word = code.split(/\s+/)[0].toUpperCase()
    if (word === 'M82') relE = false
    else if (word === 'M83') relE = true
    else if (word === 'G90') relXYZ = false
    else if (word === 'G91') relXYZ = true
    else if (word === 'G92') {
      const m = /E(-?[\d.]+)/i.exec(code)
      if (m) e = Number(m[1])
    } else if (word === 'G10') retractions++
    else if (word === 'G0' || word === 'G1') {
      const val = (k) => {
        const m = new RegExp(`${k}(-?[\\d.]+)`, 'i').exec(code)
        return m ? Number(m[1]) : null
      }
      const nx = val('X'), ny = val('Y'), nz = val('Z'), ne = val('E')
      const tx = nx === null ? x : relXYZ ? x + nx : nx
      const ty = ny === null ? y : relXYZ ? y + ny : ny
      const tz = nz === null ? z : relXYZ ? z + nz : nz
      const de = ne === null ? 0 : relE ? ne : ne - e
      if (ne !== null) e = relE ? e + ne : ne
      const dist = Math.hypot(tx - x, ty - y)
      if (de > 0 && dist > 0) {
        extrudedMm += de
        byType.set(type, (byType.get(type) ?? 0) + de)
        if (!layer || tz > layer.z + 1e-6) startLayer(tz)
        layer.extrudedMm += de
        layer.moves++
      } else if (de < 0 && dist === 0) retractions++
      else if (dist > 0 && de <= 0) {
        travelMm += dist
        travels++
      }
      x = tx
      y = ty
      z = tz
    }
  }
  const printed = layers.filter((l) => l.moves > 0)
  const heights = printed.map((l, i) => (i === 0 ? l.z : l.z - printed[i - 1].z)).map((h) => Math.round(h * 1000) / 1000)
  return {
    totals,
    counted: {
      layers: printed.length,
      firstLayerMm: heights[0] ?? null,
      layerHeightsMm: [...new Set(heights.slice(1))].sort((a, b) => a - b),
      heightMm: printed.length ? printed[printed.length - 1].z : 0,
      extrudedFilamentMm: Math.round(extrudedMm * 10) / 10,
      travelMm: Math.round(travelMm),
      travels,
      retractions,
      byFeatureMm: Object.fromEntries([...byType].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    },
    heuristic: {
      // Travels per retraction: high means long moves without one, where
      // oozing filament strings across.
      travelsPerRetraction: retractions ? Math.round((travels / retractions) * 10) / 10 : null,
      note: 'Estimated from the moves, not printed: a guide to stringing risk, not a measurement.',
    },
    layers: printed.map((l) => ({ z: l.z, extrudedMm: Math.round(l.extrudedMm * 10) / 10 })),
  }
}
