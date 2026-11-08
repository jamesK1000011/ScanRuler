// SPDX-License-Identifier: AGPL-3.0-only
// Pauses put into sliced G-code, for parts dropped in mid-print: magnets,
// nuts, bearings, weights, tags. Each pause is asked for by the height of
// a pocket's top above the bed; it goes in before the first layer whose
// bottom is at or above that height — the pocket printed open below it,
// the roof printed over the part after it.
//
// The layers are read from the G-code itself, not worked out from a layer
// height: the marker each slicer writes at a layer change (";LAYER_CHANGE"
// and ";Z:" from PrusaSlicer and OrcaSlicer, "; CHANGE_LAYER" and
// "; Z_HEIGHT:" from Bambu Studio), so a first layer of its own height or
// a variable layer height is taken as printed. The pause is written after
// the layer's first move up — filament retracted, nozzle lifted — or after
// the marker where there is none before the layer's first extrusion.
//
// The command is the printer profile's own pause where the G-code's
// settings name one (PrusaSlicer's pause_print_gcode, Bambu Studio's and
// OrcaSlicer's machine_pause_gcode), else by the printer: M601 for
// Prusa and Marlin firmware (M600 on request), PAUSE for Klipper, M400 U1
// for a Bambu Lab printer. Where the firmware shows a message (not Bambu),
// an M117 before it says what goes in.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { zipEntries, zipWrite } from './zip.js'

/** Two heights closer than this are one, mm: slicers write Z to 3 places. */
export const EPS = 0.002

export const COMMANDS = ['auto', 'M601', 'M600', 'PAUSE', 'M400 U1']

/** The most G-code read into memory to put pauses in. */
export const MAX_GCODE_BYTES = 400 * 2 ** 20

const LAYER_MARK = /^;\s*(?:LAYER_CHANGE|CHANGE_LAYER)\s*$/
const Z_MARK = /^;\s*(?:Z|Z_HEIGHT)\s*:\s*(-?[\d.]+)\s*$/
const CONFIG = /^;\s*([A-Za-z_][\w]*)\s*=\s*(.*)$/
const Z_MOVE = /^G[0-3](?:\s|$)[^;]*?\bZ\s*(-?[\d.]+)/i
const EXTRUDE = /^G[1-3](?:\s|$)[^;]*?\bE\s*([\d.]+)/i
const XY = /^G[0-3](?:\s|$)[^;]*?\b[XY]\s*-?[\d.]/i

/** The settings the slicer wrote into the G-code, by key (the first of each). */
export function configOf(lines) {
  const out = {}
  for (const raw of lines) {
    const m = CONFIG.exec(raw.trim())
    if (m && !(m[1] in out)) out[m[1]] = m[2].trim()
  }
  return out
}

/**
 * The layers as printed: each one's Z (its top), the line its marker is
 * on, and the line a pause goes in at. Throws where there are no markers,
 * or where Z goes back down (printed object by object).
 */
export function layersOf(lines) {
  const marks = []
  const hasChange = lines.some((l) => LAYER_MARK.test(l.trim()))
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (hasChange) {
      if (!LAYER_MARK.test(t)) continue
      // Its Z is in the comments just after it.
      let z = null
      let j = i + 1
      for (; j < lines.length && j <= i + 6 && lines[j].trim().startsWith(';'); j++) {
        const m = Z_MARK.exec(lines[j].trim())
        if (m && z === null) z = Number(m[1])
      }
      if (z === null || !Number.isFinite(z)) continue
      marks.push({ z, at: i, after: j })
    } else {
      const m = Z_MARK.exec(t)
      if (!m) continue
      let j = i + 1
      while (j < lines.length && lines[j].trim().startsWith(';') && !Z_MARK.test(lines[j].trim())) j++
      marks.push({ z: Number(m[1]), at: i, after: j })
    }
  }
  if (!marks.length) throw new Error('The G-code has no layer markers (;LAYER_CHANGE / ;Z: or ; CHANGE_LAYER / ; Z_HEIGHT:): the layers cannot be found to put a pause in.')
  // One layer per Z: a marker at the same height again (a support layer,
  // a wipe) is the same layer.
  const layers = []
  for (const m of marks) {
    const last = layers[layers.length - 1]
    if (last && m.z < last.z - EPS) throw new Error(`The layers go back down at Z ${m.z} (after ${last.z}): this G-code prints object by object, and a pause by height would stop in the wrong object. Slice with the objects printed together.`)
    if (last && Math.abs(m.z - last.z) <= EPS) continue
    layers.push(m)
  }
  // Where the pause goes: after the layer's first move up, if it comes
  // before the layer's first extrusion; else after the marker. Never inside
  // a block the printer may skip — Bambu Studio's timelapse (M622 … M623,
  // run only when the printer records one) or an object's moves (M624 …
  // M625, skipped with the object): a pause there would not stop the print.
  const depth = blockDepths(lines)
  for (let k = 0; k < layers.length; k++) {
    const L = layers[k]
    const end = k + 1 < layers.length ? layers[k + 1].at : lines.length
    let first = null // the first open place after a move up made outside a block
    let any = null // … after a move up made inside one
    let open = depth[L.after] === 0 ? L.after : null
    let liftOut = false
    let lift = false
    for (let i = L.after; i < end; i++) {
      const code = lines[i].split(';')[0].trim()
      if (code) {
        const e = EXTRUDE.exec(code)
        if (e && Number(e[1]) > 0 && XY.test(code)) break
        if (Z_MOVE.test(code)) {
          lift = true
          if (depth[i] === 0) liftOut = true
        }
      }
      if (depth[i + 1] !== 0) continue
      if (open === null) open = i + 1
      if (liftOut && first === null) first = i + 1
      if (lift && any === null) any = i + 1
      if (first !== null) break
    }
    L.insertAt = first ?? any ?? open ?? L.after
    if (depth[L.insertAt] !== 0) L.skippable = true
  }
  return layers
}

const OPENS = /^M62[24](?:\s|$)/i
const CLOSES = /^M62[35](?:\s|$)/i

/** How deep in skippable blocks the place before each line is: M622/M623
 *  (Bambu Studio's conditional blocks) and M624/M625 (an object's moves). */
export function blockDepths(lines) {
  const out = new Int32Array(lines.length + 1)
  let d = 0
  for (let i = 0; i < lines.length; i++) {
    out[i] = d
    const code = lines[i].split(';')[0].trim()
    if (OPENS.test(code)) d++
    else if (CLOSES.test(code)) d = Math.max(0, d - 1)
  }
  out[lines.length] = d
  return out
}

/** Which pause command, and whether the printer shows a message. */
export function pauseCommandOf(config, asked = 'auto', header = '') {
  const flavor = String(config.gcode_flavor ?? '').toLowerCase()
  const bambu = /bambu/i.test(String(config.printer_model ?? '')) || /^;\s*BambuStudio/m.test(header)
  if (asked && asked !== 'auto') {
    if (!COMMANDS.includes(asked)) throw new Error(`pauseCommand is one of ${COMMANDS.join(', ')}.`)
    // A command the printer does not know is passed over, and the print
    // goes on over the empty pocket: refused where the G-code names one.
    const known = bambu ? ['M400 U1'] : flavor === 'klipper' ? ['PAUSE', 'M600'] : /^marlin/.test(flavor) ? ['M601', 'M600'] : null
    if (known && !known.includes(asked)) throw new Error(`${asked} does not pause ${bambu ? 'a Bambu Lab printer' : `${flavor} firmware`}: it would go on printing over the empty pocket. Use ${known.join(' or ')}.`)
    const warn = asked === 'M600' ? (flavor === 'klipper' ? 'M600 pauses Klipper only where its config has an M600 macro: check before printing.' : 'M600 pauses only firmware built with filament change (Marlin ADVANCED_PAUSE_FEATURE): check the printer stops on it before printing.') : null
    return { lines: [asked], message: asked !== 'M400 U1', source: 'asked', ...(warn ? { warning: warn } : {}) }
  }
  const own = config.pause_print_gcode ?? config.machine_pause_gcode
  if (own && own.trim()) {
    const lines = own.split('\\n').map((l) => l.trim()).filter(Boolean)
    // A template (placeholders the slicer fills in) is not taken as is.
    if (lines.length && lines.length <= 20 && !lines.some((l) => /[{[]/.test(l.split(';')[0]))) return { lines, message: !bambu, source: config.pause_print_gcode !== undefined ? 'pause_print_gcode' : 'machine_pause_gcode' }
  }
  if (bambu) return { lines: ['M400 U1'], message: false, source: 'Bambu Lab printer' }
  if (flavor === 'klipper') return { lines: ['PAUSE'], message: true, source: 'gcode_flavor klipper' }
  // PrusaSlicer names its own printers by model alone (MK4S, MINI, XL):
  // the vendor is in the profile's name and notes.
  if (/prusa/i.test(`${config.printer_model ?? ''} ${config.printer_settings_id ?? ''} ${config.printer_notes ?? ''}`)) return { lines: ['M601'], message: true, source: `gcode_flavor ${flavor || 'prusa'}` }
  if (/^marlin/.test(flavor)) return { lines: ['M601'], message: true, source: `gcode_flavor ${flavor}`, warning: 'M601 pauses Marlin only where it is built with PARK_HEAD_ON_PAUSE (Prusa firmware always is): check the printer stops on it, or give pauseCommand M600.' }
  throw new Error(`The G-code does not say which printer it is for (gcode_flavor ${flavor || 'not set'}, no pause G-code in its profile): give pauseCommand — M601 (Prusa, Marlin with park on pause), M600 (Marlin filament change), PAUSE (Klipper) or M400 U1 (Bambu Lab).`)
}

/** A message a printer's screen can show: printable ASCII, no ; or *. */
export const messageOf = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[;*\\]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)

/** The pauses asked for, checked: 1 to 50 of { z, note? }. */
export function checkPauses(pauses) {
  if (!Array.isArray(pauses) || pauses.length === 0 || pauses.length > 50) throw new Error('pauses: a list of 1 to 50 { z, note }.')
  return pauses.map((p, i) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error(`pauses[${i}]: { z, note }.`)
    for (const k of Object.keys(p)) if (k !== 'z' && k !== 'note') throw new Error(`pauses[${i}].${k} is not taken (z, note).`)
    if (typeof p.z !== 'number' || !Number.isFinite(p.z) || p.z <= 0) throw new Error(`pauses[${i}].z: the pocket's top above the bed, mm, more than 0.`)
    if (p.note !== undefined && (typeof p.note !== 'string' || p.note.length > 200)) throw new Error(`pauses[${i}].note: words, 200 characters at most.`)
    return { z: p.z, note: p.note ?? '' }
  })
}

/**
 * Pauses put into G-code text: each before the first layer whose bottom is
 * at or above its z (the first layer's bottom is the bed); those that fall
 * on one layer merged. Returns the new text and what was put where.
 */
export function injectPauses(text, pauses, { pauseCommand = 'auto' } = {}) {
  const asked = checkPauses(pauses)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  if (lines.some((l) => /^;\s*ScanRuler pause\b/.test(l))) throw new Error('This G-code has pauses put in already: slice again to change them.')
  const config = configOf(lines)
  // On a raft the part starts above the bed, by the raft: a pocket's
  // height from the part's bottom would pause too low.
  if (Number(config.raft_layers) > 0) throw new Error(`The part is printed on a raft (raft_layers = ${config.raft_layers}): its pockets' heights are from its own bottom, not the bed. Slice without the raft to put pauses in.`)
  const layers = layersOf(lines)
  const cmd = pauseCommandOf(config, pauseCommand, lines.slice(0, 5).join('\n'))
  const by = new Map()
  const warnings = cmd.warning ? [cmd.warning] : []
  for (const p of asked) {
    const k = layers.findIndex((L, i) => (i === 0 ? 0 : layers[i - 1].z) >= p.z - EPS)
    if (k < 1) {
      if (k === 0) throw new Error(`A pause at ${p.z} would be before the first layer.`)
      throw new Error(`A pause at ${p.z} is above the print's last layer bottom (${layers.length > 1 ? layers[layers.length - 2].z : 0}; it prints to ${layers[layers.length - 1].z}): is it the right part, placed on the bed as exported?`)
    }
    if (layers[k].skippable) throw new Error(`Layer ${k + 1} starts inside a block the printer may skip (M622/M624): a pause there might not stop the print. Slice without timelapse or object skipping, or add the pause in the slicer.`)
    const bottom = layers[k - 1].z
    if (bottom - p.z > EPS) {
      const below = k >= 2 ? layers[k - 2].z : 0
      warnings.push(`The pocket top at ${p.z} falls inside layer ${k} (${below}–${bottom}): that layer may be printed closed over it. The pause is before layer ${k + 1}; check the part goes in, or put the pocket's top on a layer boundary.`)
    }
    const had = by.get(k)
    if (had) had.asked.push(p)
    else by.set(k, { index: k, asked: [p] })
  }
  const placed = [...by.values()].sort((a, b) => a.index - b.index)
  // Put in from the last up, so the line numbers before stay right.
  for (const pl of [...placed].reverse()) {
    const L = layers[pl.index]
    const notes = [...new Set(pl.asked.map((p) => p.note).filter(Boolean))]
    const note = notes.join('; ')
    const msg = messageOf(note || 'Insert parts, then resume')
    pl.lines = [`; ScanRuler pause: before layer ${pl.index + 1}, Z ${layers[pl.index - 1].z}${note ? `: ${messageOf(note.replace(/\r?\n/g, ' ')).slice(0, 120)}` : ''}`, ...(cmd.message ? [`M117 ${msg}`] : []), ...cmd.lines]
    lines.splice(L.insertAt, 0, ...pl.lines)
  }
  return {
    text: lines.join(eol),
    command: { lines: cmd.lines, message: cmd.message, from: cmd.source },
    pauses: placed.map((pl) => ({ layer: pl.index + 1, afterLayer: pl.index, z: layers[pl.index - 1].z, printZ: layers[pl.index].z, note: [...new Set(pl.asked.map((p) => p.note).filter(Boolean))].join('; '), asked: pl.asked.map((p) => p.z), gcode: pl.lines.slice(1) })),
    layers: layers.length,
    ...(warnings.length ? { warnings } : {}),
  }
}

/** Binary G-code (PrusaSlicer's .bgcode): not text to put a line into. */
export const isBinaryGcode = (buf) => buf.length >= 4 && buf.toString('latin1', 0, 4) === 'GCDE'

/**
 * Pauses put into a sliced job's files: its G-code, and — where the slicer
 * exported one — every plate's G-code inside its .3mf, with the plate's
 * MD5 beside it (Bambu printers check it) written again.
 */
export async function addPauses({ gcode, tmf, pauses, pauseCommand }) {
  if ((await stat(gcode)).size > MAX_GCODE_BYTES) throw new Error(`The G-code is over ${MAX_GCODE_BYTES / 2 ** 20} MB: too big to put pauses into here.`)
  const buf = await readFile(gcode)
  if (isBinaryGcode(buf)) throw new Error('The slicer wrote binary G-code (binary_gcode on in the printer profile): pauses go into text G-code only. Turn it off for this job, or add the pauses in the slicer.')
  const r = injectPauses(buf.toString('utf8'), pauses, { pauseCommand })
  // Written only once every file has taken its pauses: a refusal part way
  // leaves the job as the slicer wrote it, to be tried again.
  const plates = []
  let tmfOut = null
  if (tmf && existsSync(tmf)) {
    const zip = await zipEntries(tmf)
    const files = []
    for (const e of zip.entries) {
      if (e.name.endsWith('/')) {
        files.push({ name: e.name, data: Buffer.alloc(0), method: 0 })
        continue
      }
      files.push({ name: e.name, data: zip.read(e), method: e.method })
    }
    for (const f of files) {
      if (!/(^|\/)plate_\d+\.gcode$/i.test(f.name)) continue
      // Each plate on its own heights; the job's G-code was the first's,
      // and fails the job. Another plate a pause does not reach is left as
      // it was, and said so.
      let done
      try {
        done = injectPauses(f.data.toString('utf8'), pauses, { pauseCommand })
      } catch (e) {
        if (plates.length === 0) throw e
        plates.push({ plate: f.name, error: String(e.message ?? e), unchanged: true })
        continue
      }
      f.data = Buffer.from(done.text)
      const row = { plate: f.name, pauses: done.pauses.map((p) => p.layer) }
      const sum = files.find((x) => x.name === `${f.name}.md5`)
      if (sum) {
        const hex = createHash('md5').update(f.data).digest('hex')
        const old = sum.data.toString('utf8').trim()
        sum.data = Buffer.from(old && old === old.toLowerCase() && /[a-f]/.test(old) ? hex : hex.toUpperCase())
        row.md5 = true
      }
      plates.push(row)
    }
    if (plates.length) tmfOut = zipWrite(files)
  }
  await writeFile(gcode, r.text)
  if (tmfOut) await writeFile(tmf, tmfOut)
  return { ...r, text: undefined, ...(plates.length ? { plates } : {}), how: 'Put into the G-code after slicing (the slicers’ own per-layer pause is set in their app, not on their command line).' }
}
