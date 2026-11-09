// SPDX-License-Identifier: AGPL-3.0-only
// The material library every workspace reads: what a part is made of, as a
// property of the part — whatever makes it (printed, cut, milled, bought).
// Two tables. The fork's own entries (fork.ts: the printing filaments the
// app has always listed, and common sheet and moulded plastics FreeCAD
// lacks) are bundled and always here. FreeCAD's material cards are not:
// they are LGPL-2.0-or-later and CC-BY-3.0 data, kept in a static asset,
// public/materials/freecad-cards.json (scripts/convert-fcmat.mjs makes it;
// MATERIALS-LICENSES.md), with their licence texts beside it, and loaded at
// run time on first use — loaded, not linked (CONTRIBUTING.md). Nothing
// here imports that file; it is read by its path (src/plugins/assets.ts).
//
// So the lookups are synchronous over what is here now: the fork's entries
// at once, FreeCAD's once loaded. A command that reads materials awaits
// ensureMaterials() (or materialsFor(names), which loads only for a name
// that is not the fork's own) before it looks up; a panel reads
// useMaterialLibrary and asks for the load when it shows the list.
//
// A material here is the bulk material, solid. How a process changes it —
// a print's layers, walls and infill — is the process's data (printed.ts),
// applied only to a part in a print setup (../setups.ts).
//
// Units: density g/cm³; moduli and strengths MPa; elongation %; thermal
// conductivity W/(m·K), specific heat J/(kg·K), expansion µm/(m·K);
// electrical conductivity MS/m; cutting speeds m/min, specific cutting
// force (kc1.1) N per square millimetre of chip, mc its exponent.

import { create } from 'zustand'
import { FORK } from './fork'
import { registerSharedNotice } from '../../../src/plugins/notices'
import { readAsset } from '../../../src/plugins/assets'
import { MaterialNotices } from './Notices'

// FreeCAD's cards are offered whenever this module is in the build: their
// credit goes in the imprint from here, not from a plugin that may be left
// out.
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

/** FreeCAD's cards: the asset's path under public/ — fetched by the page,
 *  read from disk by the headless engine and the tests. */
export const CARDS_ASSET = 'materials/freecad-cards.json'

/** Where FreeCAD's cards are: not asked for yet, on their way, here, or
 *  not to be had (error says why; the next ensureMaterials tries again). */
export type CardsStatus = 'not-loaded' | 'loading' | 'loaded' | 'failed'

export interface MaterialLibraryState {
  status: CardsStatus
  /** FreeCAD's cards, once loaded; empty before. */
  cards: readonly Material[]
  error: string | null
}

/** The library's load state, for a panel to follow. */
export const useMaterialLibrary = create<MaterialLibraryState>(() => ({ status: 'not-loaded', cards: [], error: null }))

/** The fork's own, by id: always here. */
const FORK_BY_ID = new Map(FORK.map((m) => [m.id, m]))
let byId = new Map<string, Material>(FORK_BY_ID)
let all: readonly Material[] = FORK

/** Every material here now: FreeCAD's (once loaded), then the fork's. */
export function library(): readonly Material[] {
  return all
}

/** FreeCAD's cards as read from the asset: { about, materials } (or a bare
 *  list), each a material with its card's source. */
export function parseCards(text: string): Material[] {
  const data = JSON.parse(text) as unknown
  const list = Array.isArray(data) ? data : (data as { materials?: unknown } | null)?.materials
  if (!Array.isArray(list)) throw new Error('not a list of materials')
  for (const m of list as Partial<Material>[]) {
    if (typeof m?.id !== 'string' || typeof m.name !== 'string' || typeof m.category !== 'string' || m.source?.from !== 'FreeCAD' || typeof m.source.license !== 'string')
      throw new Error(`an entry is not a FreeCAD material with its licence: ${JSON.stringify(m).slice(0, 80)}`)
  }
  return list as Material[]
}

function install(cards: readonly Material[]): void {
  // A card never takes a fork id: the fork's entries are the ones saved
  // projects mean.
  const own = cards.filter((m) => !FORK_BY_ID.has(m.id))
  all = [...own, ...FORK]
  byId = new Map(all.map((m) => [m.id, m]))
  useMaterialLibrary.setState({ status: 'loaded', cards: own, error: null })
}

let loading: Promise<void> | null = null

/** FreeCAD's cards loaded: at once when they are, else fetched (read from
 *  disk under Node) once, however many ask. Rejects, saying why, when they
 *  cannot be had; a later call tries again. */
export function ensureMaterials(): Promise<void> {
  if (useMaterialLibrary.getState().status === 'loaded') return Promise.resolve()
  loading ??= (async () => {
    useMaterialLibrary.setState({ status: 'loading', error: null })
    try {
      install(parseCards(await readAsset(CARDS_ASSET)))
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      useMaterialLibrary.setState({ status: 'failed', error })
      throw new Error(`FreeCAD's material cards could not be loaded (${error}); the app's own materials are still here: ${FORK.map((m) => m.id).join(', ')}.`)
    } finally {
      loading = null
    }
  })()
  return loading
}

/** Whether a name is one of the fork's own materials (by id or alias): one
 *  the library answers without FreeCAD's cards. */
export function isBundledMaterial(name: unknown): boolean {
  if (typeof name !== 'string') return false
  const k = name.trim().toLowerCase()
  return FORK_BY_ID.has(k) || (Object.hasOwn(LIBRARY_ALIASES, k) && FORK_BY_ID.has(LIBRARY_ALIASES[k]))
}

/** Ready to look these names up: at once when each is the fork's own (or
 *  there are none), else once FreeCAD's cards are loaded. Rejects as
 *  ensureMaterials does — so a part of steel is never weighed as nothing,
 *  and one of PLA is weighed without the cards. */
export function materialsFor(names: Iterable<unknown>): Promise<void> {
  for (const n of names) if (n !== undefined && n !== null && !isBundledMaterial(n)) return ensureMaterials()
  return Promise.resolve()
}

/** Why a material may be missing from the library now: FreeCAD's cards not
 *  loaded yet, or not to be had; null once they are in. */
export function libraryNote(): string | null {
  const { status, error } = useMaterialLibrary.getState()
  if (status === 'loaded') return null
  if (status === 'failed') return `FreeCAD's material cards could not be loaded (${error}): only the app's own materials are here.`
  return `FreeCAD's material cards are ${status === 'loading' ? 'still loading' : 'not loaded yet'}: only the app's own materials are here so far.`
}

/** For the tests: the library as it is before anything is loaded. */
export function resetMaterialLibrary(): void {
  loading = null
  all = FORK
  byId = new Map(FORK_BY_ID)
  useMaterialLibrary.setState({ status: 'not-loaded', cards: [], error: null })
}

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

/** A library material by id or alias, matched without regard to case:
 *  the fork's own always, FreeCAD's once loaded (ensureMaterials). */
export function libraryMaterial(name: unknown): Material | undefined {
  if (typeof name !== 'string') return undefined
  const k = name.trim().toLowerCase()
  return byId.get(k) ?? (Object.hasOwn(LIBRARY_ALIASES, k) ? byId.get(LIBRARY_ALIASES[k]) : undefined)
}

/** The library searched: by category, and by words that must each be in
 *  the id, name, family, kind, standard or an alias. Over what is loaded
 *  (ensureMaterials first for the whole library). */
export function searchLibrary(opts: { category?: string; q?: string } = {}): Material[] {
  const words = (opts.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const aliasesOf = new Map<string, string[]>()
  for (const [a, id] of Object.entries(LIBRARY_ALIASES)) aliasesOf.set(id, [...(aliasesOf.get(id) ?? []), a])
  return all.filter((m) => {
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
