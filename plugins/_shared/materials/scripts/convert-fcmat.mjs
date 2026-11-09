// SPDX-License-Identifier: AGPL-3.0-only
// FreeCAD's material cards (FCMat, YAML) to the compact table the app reads,
// public/materials/freecad-cards.json — a static asset the library fetches
// on first use, never bundled: the cards are loaded, not linked
// (CONTRIBUTING.md). Run again when the cards change:
//
//   node plugins/_shared/materials/scripts/convert-fcmat.mjs <Resources>
//
// <Resources> is FreeCAD's src/Mod/Material/Resources — the folder holding
// Materials/{Standard,Machining} and Models. The cards' data stays under
// each card's own licence (LGPL-2.0-or-later, CC-BY-3.0, GPL-2.0-or-later),
// which every entry carries with its author; the licence texts lie beside
// the file and plugins/_shared/materials/MATERIALS-LICENSES.md credits them. This script is the fork's own.
//
// The cards are a small subset of YAML (nested maps, quoted scalars, folded
// `>-` text, comments; the one list, a model's Inherits, unused, reads as
// keys), read here without a YAML library so that the script
// needs nothing installed. Every figure is turned into the app's units —
// g/cm³, MPa, W/(m·K), J/(kg·K), µm/(m·K), m/min, N/mm² — and checked
// against the unit FreeCAD's model for it declares, so a card in a unit the
// script does not know stops it rather than being read wrong.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The subset of YAML the cards use: a map of maps and scalars. */
export function readYaml(text) {
  const root = {}
  const stack = [{ indent: -1, map: root }]
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed === '---') continue
    const indent = line.length - line.trimStart().length
    const m = /^([^:#]+?):(?:\s+(.*))?$/.exec(trimmed)
    if (!m) throw new Error(`Line ${i + 1}: not a key: "${trimmed}"`)
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()
    const parent = stack[stack.length - 1].map
    const key = m[1].trim()
    const raw = m[2]?.trim() ?? ''
    if (raw === '') {
      const map = {}
      parent[key] = map
      stack.push({ indent, map })
    } else if (raw === '>-' || raw === '>' || raw === '|' || raw === '|-') {
      // Folded or literal text: the lines indented under the key.
      const body = []
      while (i + 1 < lines.length) {
        const next = lines[i + 1]
        if (next.trim() && next.length - next.trimStart().length <= indent) break
        body.push(next.trim())
        i++
      }
      parent[key] = raw.startsWith('>') ? body.join(' ').replace(/\s+/g, ' ').trim() : body.join('\n').trim()
    } else parent[key] = scalar(raw)
  }
  return root
}

function scalar(raw) {
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return raw.slice(1, -1)
  const n = Number(raw)
  return raw !== '' && Number.isFinite(n) ? n : raw
}

/** A quantity as a card writes it ("7800 kg/m^3", "114 GPa") in the app's
 *  unit for the property; undefined for none, 0 read as none (the cards
 *  write 0 for a figure not known). */
const UNITS = {
  Density: { to: 'g/cm³', from: { 'kg/m^3': 1e-3 } },
  YoungsModulus: { to: 'MPa', from: { MPa: 1, GPa: 1e3 } },
  ShearModulus: { to: 'MPa', from: { MPa: 1, GPa: 1e3 } },
  UltimateTensileStrength: { to: 'MPa', from: { MPa: 1 } },
  YieldStrength: { to: 'MPa', from: { MPa: 1 } },
  CompressiveStrength: { to: 'MPa', from: { MPa: 1 } },
  PoissonRatio: { to: '', from: { '': 1 } },
  UltimateStrain: { to: '%', from: { '': 1 } },
  ThermalConductivity: { to: 'W/(m·K)', from: { 'W/m/K': 1 } },
  SpecificHeat: { to: 'J/(kg·K)', from: { 'J/kg/K': 1, 'kJ/kg/K': 1e3 } },
  ThermalExpansionCoefficient: { to: 'µm/(m·K)', from: { 'm/m/K': 1e6, '1/K': 1e6, 'µm/m/K': 1 } },
  SurfaceSpeedHSS: { to: 'm/min', from: { 'm/min': 1 } },
  SurfaceSpeedCarbide: { to: 'm/min', from: { 'm/min': 1 } },
  UnitCuttingForce: { to: 'N/mm²', from: { 'N/mm^2': 1 } },
  ChipThicknessExponent: { to: '', from: { '': 1 } },
}

function quantity(prop, value) {
  if (value === undefined || value === null || value === '') return undefined
  const s = String(value).trim()
  const m = /^(-?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*(.*)$/.exec(s)
  if (!m) throw new Error(`${prop}: "${s}" is not a quantity`)
  const unit = UNITS[prop]
  if (!unit) throw new Error(`${prop}: no unit known`)
  const factor = unit.from[m[2]]
  if (factor === undefined) throw new Error(`${prop}: unit "${m[2]}" not known (${Object.keys(unit.from).join(', ')})`)
  const n = Number(m[1]) * factor
  return n === 0 ? undefined : Number(n.toPrecision(6))
}

/** The models' declared units, to hold the table above to them. */
function modelUnits(dir) {
  const out = {}
  for (const file of walk(dir, /\.yml$/)) {
    const model = readYaml(readFileSync(file, 'utf8')).Model ?? {}
    for (const [k, v] of Object.entries(model)) if (v && typeof v === 'object' && 'Units' in v) out[k] = String(v.Units ?? '')
  }
  return out
}

function* walk(dir, pattern) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p, pattern)
    else if (pattern.test(name)) yield p
  }
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** The folder a Standard card sits in, to the app's category. */
const CATEGORY = { Aggregate: 'aggregate', Carbon: 'carbon', Glass: 'glass', Metal: 'metal', Thermoplast: 'thermoplast', Wood: 'wood' }
/** A Machining card's Father. */
const FATHER = { Metal: 'metal', Wood: 'wood', 'Engineered Wood': 'wood' }

/** Cards left out: Default is a placeholder of density 1 kg/m³, no material. */
const SKIP = new Set(['Standard/Default.FCMat'])

/** Cards filed under another category than their folder's: B500 is
 *  reinforcing steel, kept with concrete in FreeCAD (where it is named
 *  "Reinforcement-Harry"). */
const RECATEGORY = { 'reinforcement-fib-b500': { category: 'metal', family: 'steel', name: 'Reinforcing steel B500 (fib)' } }

/** Names that would read the same as one of the printing filaments the app
 *  lists (index.ts FORK): FreeCAD's generic moulded figures, said so. */
const RENAME = { 'pla-generic': 'PLA (generic)', 'abs-generic': 'ABS (generic)' }

/** The Machining cards give cutting data only: their bulk figures are taken
 *  from the Standard card named here — the fork's choice of the nearest,
 *  said in each entry (bulkFrom) — or, where FreeCAD has none, a density:
 *  the card's own description's where it gives one, else a typical figure
 *  (balsa 0.1–0.2, MDF 0.6–0.8, particle board 0.6–0.7 g/cm³). */
const MACHINING_BULK = {
  'aluminum-hard-cast-alloy': { from: 'aluminum-generic' },
  'aluminum-soft-wrought-alloy': { from: 'aluminum-generic' },
  'austenitic-stainless-steel': { from: 'steel-x5crni18-10' },
  'gray-cast-iron': { from: 'steel-en-gjl-250' },
  'malleable-cast-iron': { from: 'steel-en-gjmb-350-10' },
  'low-alloy-steel': { from: 'steel-generic' },
  'mild-steel': { from: 'steel-s235jr' },
  'tool-steel-unhardened': { from: 'steel-generic' },
  'hard-wood': { density: 0.75, densitySource: 'the card’s description' },
  'soft-wood': { density: 0.5, densitySource: 'the card’s description' },
  'balsa-wood': { density: 0.16, densitySource: 'typical (fork-authored): 0.1–0.2 g/cm³' },
  'medium-density-fibreboard-mdf': { density: 0.75, densitySource: 'typical (fork-authored): 0.6–0.8 g/cm³' },
  'particle-board': { density: 0.65, densitySource: 'typical (fork-authored): 0.6–0.7 g/cm³' },
}

const BULK_KEYS = ['density', 'youngsMPa', 'shearMPa', 'poisson', 'yieldMPa', 'ultimateMPa', 'compressiveMPa', 'elongationPct', 'thermal', 'electrical']

function entryOf(card, rel) {
  const g = card.General ?? {}
  const models = card.Models ?? {}
  const pick = (prop) => {
    for (const model of Object.values(models)) if (model && typeof model === 'object' && prop in model) return quantity(prop, model[prop])
    return undefined
  }
  const raw = (prop) => {
    for (const model of Object.values(models)) if (model && typeof model === 'object' && prop in model) return model[prop]
    return undefined
  }
  const parts = rel.split('/')
  const machining = parts[0] === 'Machining'
  const id = machining ? slug(g.Name) : slug(basename(rel, '.FCMat'))
  const father = models.Father?.Father
  const category = machining ? FATHER[father] : CATEGORY[parts[1]]
  if (!category) throw new Error(`${rel}: no category (${parts[1]}, ${father})`)
  const family = machining ? (Object.keys(card.Inherits ?? {})[0] ?? '').toLowerCase() || undefined : parts[1] === 'Metal' && parts.length > 3 ? parts[2].toLowerCase() : undefined
  const std = models.MaterialStandard ?? {}
  const thermal = { conductivity: pick('ThermalConductivity'), specificHeat: pick('SpecificHeat'), expansion: pick('ThermalExpansionCoefficient') }
  const cond = raw('ElectricalConductivity')
  const electrical = cond !== undefined ? { conductivity: electrical0(cond) } : undefined
  const machiningData = models.Machinability
    ? { speedHSS: pick('SurfaceSpeedHSS'), speedCarbide: pick('SurfaceSpeedCarbide'), kc: pick('UnitCuttingForce'), mc: pick('ChipThicknessExponent') }
    : undefined
  const e = {
    id,
    name: RENAME[id] ?? String(g.Name),
    category,
    ...(family ? { family } : {}),
    ...(std.KindOfMaterial ? { kind: String(std.KindOfMaterial) } : {}),
    ...(std.StandardCode || std.MaterialNumber ? { standard: [std.StandardCode, std.MaterialNumber].filter(Boolean).join(' ') } : {}),
    density: pick('Density'),
    youngsMPa: pick('YoungsModulus'),
    shearMPa: pick('ShearModulus'),
    poisson: pick('PoissonRatio'),
    yieldMPa: pick('YieldStrength'),
    ultimateMPa: pick('UltimateTensileStrength'),
    compressiveMPa: pick('CompressiveStrength'),
    elongationPct: pick('UltimateStrain'),
    ...(Object.values(thermal).some((v) => v !== undefined) ? { thermal } : {}),
    ...(electrical ? { electrical } : {}),
    ...(machiningData ? { machining: machiningData } : {}),
    ...(g.Description ? { note: String(g.Description) } : {}),
    source: {
      from: 'FreeCAD',
      card: rel,
      uuid: String(g.UUID),
      // One card (AlZn4-5Mg1F35) names no author.
      ...(g.Author ? { author: String(g.Author) } : {}),
      // The five metal cards that carry no License line came with FreeCAD's
      // library under its LGPL; said so, not left blank.
      license: g.License ? String(g.License) : 'LGPL-2.0-or-later',
      ...(g.License ? {} : { licenseNote: 'no License line in the card; FreeCAD’s material library is LGPL-2.0-or-later' }),
      ...(g.SourceURL ? { url: String(g.SourceURL) } : {}),
    },
  }
  return prune(e)
}

/** S/m or MS/m to MS/m. */
function electrical0(v) {
  const m = /^([0-9.eE+-]+)\s*(S\/m|MS\/m)$/.exec(String(v).trim())
  if (!m) throw new Error(`ElectricalConductivity: "${v}"`)
  return Number((Number(m[1]) / (m[2] === 'S/m' ? 1e6 : 1)).toPrecision(6))
}

function prune(o) {
  if (Array.isArray(o) || o === null || typeof o !== 'object') return o
  const out = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue
    const p = prune(v)
    if (p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length === 0) continue
    out[k] = p
  }
  return out
}

export function convert(resources) {
  const units = modelUnits(join(resources, 'Models'))
  // The table's units are the models' as FreeCAD declares them, turned.
  const declared = { Density: 'kg/m^3', YoungsModulus: 'kPa', ShearModulus: 'kPa', UltimateTensileStrength: 'kPa', YieldStrength: 'kPa', PoissonRatio: '' }
  for (const [k, u] of Object.entries(declared)) if (units[k] !== undefined && units[k] !== u) throw new Error(`FreeCAD's model gives ${k} in ${units[k]}, not ${u}: check the conversion.`)
  const dir = join(resources, 'Materials')
  const entries = []
  for (const file of walk(dir, /\.FCMat$/)) {
    const rel = relative(dir, file).split(sep).join('/')
    if (SKIP.has(rel)) continue
    entries.push(entryOf(readYaml(readFileSync(file, 'utf8')), rel))
  }
  const byId = new Map(entries.map((e) => [e.id, e]))
  if (byId.size !== entries.length) throw new Error('Two cards give one id.')
  for (const e of entries) {
    const re = RECATEGORY[e.id]
    if (re) Object.assign(e, re)
    const bulk = MACHINING_BULK[e.id]
    if (e.source.card.startsWith('Machining/')) {
      if (!bulk) throw new Error(`${e.id}: a Machining card with no bulk figures chosen`)
      if (bulk.from) {
        const from = byId.get(bulk.from)
        if (!from) throw new Error(`${e.id}: no card ${bulk.from}`)
        for (const k of BULK_KEYS) if (from[k] !== undefined && e[k] === undefined) e[k] = from[k]
        e.bulkFrom = bulk.from
      } else {
        e.density = bulk.density
        e.densitySource = bulk.densitySource
      }
    }
  }
  entries.sort((a, b) => a.category.localeCompare(b.category) || (a.family ?? '').localeCompare(b.family ?? '') || a.name.localeCompare(b.name))
  return entries
}

/** What the file says of itself, for whoever finds it without the app. */
export const CARDS_ABOUT =
  "FreeCAD's material cards (https://github.com/FreeCAD/FreeCAD, src/Mod/Material/Resources/Materials), converted to ScanRuler's units by plugins/_shared/materials/scripts/convert-fcmat.mjs. Each material keeps its card's licence (source.license: LGPL-2.0-or-later or CC-BY-3.0), author, path and UUID; the licence texts are LGPL-2.0.txt and CC-BY-3.0.txt beside this file. ScanRuler loads this file at run time and does not link it into its bundle: replace it with your own conversion and the app reads that."

/** The file the app fetches: what it is, then one material a line. */
export function cardsFile(entries) {
  return `{\n"about": ${JSON.stringify(CARDS_ABOUT)},\n"materials": [\n${entries.map((e) => JSON.stringify(e)).join(',\n')}\n]\n}\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const resources = process.argv[2]
  if (!resources) {
    console.error('Usage: node convert-fcmat.mjs <FreeCAD src/Mod/Material/Resources>')
    process.exit(2)
  }
  const entries = convert(resolve(resources))
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'public', 'materials', 'freecad-cards.json')
  writeFileSync(out, cardsFile(entries))
  const licences = entries.reduce((m, e) => ((m[e.source.license] = (m[e.source.license] ?? 0) + 1), m), {})
  console.log(`${entries.length} materials → ${relative(process.cwd(), out)}`, licences)
}
