// SPDX-License-Identifier: AGPL-3.0-only
// The material library every workspace reads: what a part is made of, as a
// property of the part — whatever makes it (printed, cut, milled, bought).
// FreeCAD's material cards (freecad.json, converted by scripts/convert-
// fcmat.mjs, each entry under its card's own licence: MATERIALS-LICENSES.md)
// and the fork's own entries (fork.ts): the printing filaments the app has
// always listed, and common sheet and moulded plastics FreeCAD lacks.
//
// A material here is the bulk material, solid. How a process changes it —
// a print's layers, walls and infill — is the process's data (printed.ts),
// applied only to a part in a print setup (../setups.ts).
//
// Units: density g/cm³; moduli and strengths MPa; elongation %; thermal
// conductivity W/(m·K), specific heat J/(kg·K), expansion µm/(m·K);
// electrical conductivity MS/m; cutting speeds m/min, specific cutting
// force (kc1.1) N per square millimetre of chip, mc its exponent.

import freecad from './freecad.json'
import { FORK } from './fork'
import { registerSharedNotice } from '../../../src/plugins/notices'
import { MaterialNotices } from './Notices'

// FreeCAD's cards are in the build whenever this module is: their credit
// goes in the imprint from here, not from a plugin that may be left out.
registerSharedNotice({ id: 'materials', Notices: MaterialNotices })

export type Category = 'metal' | 'thermoplast' | 'wood' | 'glass' | 'aggregate' | 'carbon'

export const CATEGORIES: readonly Category[] = ['metal', 'thermoplast', 'wood', 'glass', 'aggregate', 'carbon']

export interface MaterialSource {
  /** FreeCAD's card, or the fork's own entry. */
  from: 'FreeCAD' | 'fork'
  /** The card, under FreeCAD's src/Mod/Material/Resources/Materials. */
  card?: string
  uuid?: string
  author?: string
  /** SPDX id of the licence the data is under. */
  license: string
  licenseNote?: string
  url?: string
  /** Where the fork's figures come from. */
  basis?: string
}

export interface Material {
  id: string
  name: string
  category: Category
  /** Steel, aluminum, copper …; for a filament, what it is printed as. */
  family?: string
  kind?: string
  /** Standard and material number: "EN 10025 1.0037". */
  standard?: string
  density?: number
  youngsMPa?: number
  shearMPa?: number
  poisson?: number
  yieldMPa?: number
  ultimateMPa?: number
  compressiveMPa?: number
  elongationPct?: number
  thermal?: { conductivity?: number; specificHeat?: number; expansion?: number }
  electrical?: { conductivity?: number }
  machining?: { speedHSS?: number; speedCarbide?: number; kc?: number; mc?: number }
  note?: string
  /** A Machining card's bulk figures: the Standard card they are from. */
  bulkFrom?: string
  densitySource?: string
  source: MaterialSource
}

/** Every material: FreeCAD's, then the fork's. */
export const LIBRARY: readonly Material[] = [...(freecad as Material[]), ...FORK]

const BY_ID = new Map(LIBRARY.map((m) => [m.id, m]))

/** Other names a material is taken by: older ids and common names. */
export const LIBRARY_ALIASES: Readonly<Record<string, string>> = {
  tpu: 'tpu-95a',
  nylon: 'pa6-generic',
  pa6: 'pa6-generic',
  pmma: 'acrylic-glass-generic',
  acrylic: 'acrylic-glass-generic',
  delrin: 'pom',
  acetal: 'pom',
  polycarbonate: 'pc',
  'stainless-304': 'steel-x5crni18-10',
  '304': 'steel-x5crni18-10',
  '316': 'steel-x5crnimo17-12-2',
  '6061': 'aluminum-6061-t6',
  steel: 'steel-generic',
  aluminum: 'aluminum-generic',
  aluminium: 'aluminum-generic',
  copper: 'copper-generic',
  titanium: 'ti-6al-4v',
}

/** A library material by id or alias, matched without regard to case. */
export function libraryMaterial(name: unknown): Material | undefined {
  if (typeof name !== 'string') return undefined
  const k = name.trim().toLowerCase()
  return BY_ID.get(k) ?? (Object.hasOwn(LIBRARY_ALIASES, k) ? BY_ID.get(LIBRARY_ALIASES[k]) : undefined)
}

/** The library searched: by category, and by words that must each be in
 *  the id, name, family, kind, standard or an alias. */
export function searchLibrary(opts: { category?: string; q?: string } = {}): Material[] {
  const words = (opts.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const aliasesOf = new Map<string, string[]>()
  for (const [a, id] of Object.entries(LIBRARY_ALIASES)) aliasesOf.set(id, [...(aliasesOf.get(id) ?? []), a])
  return LIBRARY.filter((m) => {
    if (opts.category && m.category !== opts.category) return false
    if (!words.length) return true
    const text = [m.id, m.name, m.family, m.kind, m.standard, ...(aliasesOf.get(m.id) ?? [])].filter(Boolean).join(' ').toLowerCase()
    return words.every((w) => text.includes(w))
  })
}

// ---- the printing filaments --------------------------------------------------
// The materials the printing workspaces have always listed, by the ids
// projects saved before the library carry: fork.ts holds them whole; these
// are their names and densities for Mass, Strength and Fits.

export const MATERIALS = {
  pla: { label: 'PLA', density: 1.24 },
  petg: { label: 'PETG', density: 1.27 },
  abs: { label: 'ABS', density: 1.04 },
  asa: { label: 'ASA', density: 1.07 },
  'petg-cf': { label: 'PETG-CF', density: 1.3 },
  'pa6-cf': { label: 'PA6-CF', density: 1.17 },
  'tpu-95a': { label: 'TPU 95A', density: 1.21 },
} as const satisfies Record<string, { label: string; density: number }>

export type MaterialId = keyof typeof MATERIALS

/** Every filament's id, in the order the lists show them. */
export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[]

/** Older names still taken: a project or command from before the lists
 *  were one. */
export const MATERIAL_ALIASES: Readonly<Record<string, MaterialId>> = {
  tpu: 'tpu-95a',
}

/** Every name a command takes for a filament: the ids and the aliases. */
export const MATERIAL_NAMES: string[] = [...MATERIAL_IDS, ...Object.keys(MATERIAL_ALIASES)]

/** A filament's id from its id or an alias; undefined for neither. */
export function materialId(name: unknown): MaterialId | undefined {
  if (typeof name !== 'string') return undefined
  if (Object.hasOwn(MATERIALS, name)) return name as MaterialId
  return Object.hasOwn(MATERIAL_ALIASES, name) ? MATERIAL_ALIASES[name] : undefined
}

/** A filament's solid density, g/cm³, by id or alias. */
export const densityOf = (name: unknown): number | undefined => {
  const id = materialId(name)
  return id ? MATERIALS[id].density : undefined
}
