// SPDX-License-Identifier: AGPL-3.0-only
// The material library: FreeCAD's cards as converted (a few figures read
// back against the cards, their units turned), every entry credited with
// its licence, the Machining cards given their bulk figures, the fork's
// own entries beside them, the names a material is found by, the credit
// in the imprint wherever the library is bundled, and the setups reader
// keyed by body id. And the cards loaded, not linked: a static asset with
// its licence texts beside it, read at run time (here from disk), never
// imported into the bundle, the lookups answering the fork's own until
// it is in.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  CARDS_ASSET,
  ensureMaterials,
  isBundledMaterial,
  library,
  LIBRARY_ALIASES,
  libraryMaterial,
  libraryNote,
  MATERIAL_IDS,
  MATERIALS,
  materialsFor,
  parseCards,
  resetMaterialLibrary,
  searchLibrary,
  useMaterialLibrary,
} from '../materials'
import { PRINTED, printFillOf } from '../materials/printed'
import { assignedReady, resolveAssignment, useAssigned } from '../materials/assigned'
import { isPrinted, setupFor, setupsOf } from '../setups'
import { sharedNotices } from '../../../src/plugins/notices'
import { setAssetReader } from '../../../src/plugins/assets'
import { MaterialNotices } from '../materials/Notices'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const MATERIALS_DIR = fileURLToPath(new URL('../materials/', import.meta.url))

describe('the library', () => {
  beforeAll(() => ensureMaterials())

  it('reads FreeCAD’s cards in the app’s units', () => {
    // Standard/Metal/Steel/Steel-S235JR.FCMat: 7800 kg/m^3, 210000 MPa, 235/360 MPa, 0.000011 m/m/K.
    expect(libraryMaterial('steel-s235jr')).toMatchObject({ name: 'S235JR', category: 'metal', family: 'steel', standard: 'EN 10025 1.0037', density: 7.8, youngsMPa: 210000, shearMPa: 81000, poisson: 0.3, yieldMPa: 235, ultimateMPa: 360, elongationPct: 26, thermal: { expansion: 11 } })
    // Ti-6Al-4V: moduli in GPa, expansion in µm/m/K, conductivity in S/m.
    expect(libraryMaterial('ti-6al-4v')).toMatchObject({ density: 4.43, youngsMPa: 114000, shearMPa: 44000, yieldMPa: 910, thermal: { conductivity: 6.7, specificHeat: 553, expansion: 8.6 }, electrical: { conductivity: 0.580013 } })
    // PLA-Generic: 0.000041 m/m/K is 41 µm/(m·K); named apart from the filament.
    expect(libraryMaterial('pla-generic')).toMatchObject({ name: 'PLA (generic)', density: 1.24, youngsMPa: 3640, thermal: { conductivity: 0.13, specificHeat: 1800, expansion: 41 } })
    expect(libraryMaterial('reinforcement-fib-b500')).toMatchObject({ category: 'metal', family: 'steel' })
  })
  it('credits every entry, FreeCAD’s with the card, its author and licence', () => {
    const LIBRARY = library()
    const licences = new Set(LIBRARY.map((m) => m.source.license))
    expect([...licences].sort()).toEqual(['AGPL-3.0-only', 'CC-BY-3.0', 'LGPL-2.0-or-later'])
    const freecad = LIBRARY.filter((m) => m.source.from === 'FreeCAD')
    expect(freecad.length).toBe(131)
    expect(freecad.filter((m) => m.source.license === 'LGPL-2.0-or-later').length).toBe(100)
    expect(freecad.filter((m) => m.source.license === 'CC-BY-3.0').length).toBe(31)
    expect(freecad.every((m) => m.source.card && m.source.uuid)).toBe(true)
    // One card names no author.
    expect(freecad.filter((m) => !m.source.author).map((m) => m.id)).toEqual(['alzn4-5mg1f35'])
    expect(libraryMaterial('pla-generic')!.source).toMatchObject({ card: 'Standard/Thermoplast/PLA-Generic.FCMat', author: 'Uwe Stöhr', license: 'CC-BY-3.0' })
    // Five metal cards carry no License line: said so.
    expect(freecad.filter((m) => m.source.licenseNote).length).toBe(5)
    expect(LIBRARY.filter((m) => m.source.from === 'fork').every((m) => m.source.basis)).toBe(true)
    expect(new Set(LIBRARY.map((m) => m.id)).size).toBe(LIBRARY.length)
  })
  it('gives the Machining cards cutting data and bulk figures said where from', () => {
    const mild = libraryMaterial('mild-steel')!
    expect(mild.machining).toEqual({ speedHSS: 25, speedCarbide: 70, kc: 2298, mc: 0.2 })
    expect(mild).toMatchObject({ bulkFrom: 'steel-s235jr', density: 7.8, yieldMPa: 235 })
    expect(libraryMaterial('hard-wood')).toMatchObject({ category: 'wood', density: 0.75, densitySource: 'the card’s description' })
    expect(library().filter((m) => m.machining).length).toBe(13)
    expect(library().filter((m) => m.machining).every((m) => m.density! > 0)).toBe(true)
  })
  it('keeps the filaments by the ids projects carry, their printing figures apart', () => {
    for (const id of MATERIAL_IDS) {
      expect(libraryMaterial(id)!.density).toBe(MATERIALS[id].density)
      expect(libraryMaterial(id)!.source.from).toBe('fork')
      expect(PRINTED[id].Exy).toBe(libraryMaterial(id)!.youngsMPa)
    }
    expect(Object.keys(PRINTED).sort()).toEqual([...MATERIAL_IDS].sort())
    expect(libraryMaterial('pom')).toMatchObject({ density: 1.42, category: 'thermoplast' })
  })
  it('finds a material by alias and by words, any case', () => {
    for (const id of Object.values(LIBRARY_ALIASES)) expect(libraryMaterial(id)?.id).toBe(id)
    expect(libraryMaterial('Delrin')?.id).toBe('pom')
    expect(libraryMaterial('tpu')?.id).toBe('tpu-95a')
    expect(libraryMaterial('toString')).toBeUndefined()
    expect(searchLibrary({ q: 'stainless' }).length >= 1).toBe(true)
    expect(searchLibrary({ q: '6061' }).map((m) => m.id)).toEqual(['aluminum-6061-t6'])
    expect(searchLibrary({ category: 'wood' }).every((m) => m.category === 'wood')).toBe(true)
  })
  it('makes a custom material whole over its base', () => {
    expect(resolveAssignment({ custom: { name: 'My steel', base: 'steel-generic', yieldMPa: 400 } })).toMatchObject({ id: 'custom', name: 'My steel', custom: true, bulkFrom: 'steel-generic', density: 7.9, yieldMPa: 400 })
    expect(resolveAssignment('unobtainium')).toBe(null)
  })
})

describe('FreeCAD’s cards, loaded at run time', () => {
  afterEach(async () => {
    setAssetReader(null)
    useAssigned.setState({ assigned: {} })
    resetMaterialLibrary()
    await ensureMaterials()
  })

  it('answers the fork’s own before they are loaded, and says the rest are coming', async () => {
    resetMaterialLibrary()
    expect(useMaterialLibrary.getState().status).toBe('not-loaded')
    expect(library().every((m) => m.source.from === 'fork')).toBe(true)
    expect(libraryMaterial('pla')?.density).toBe(1.24)
    expect(libraryMaterial('brass')?.source.from).toBe('fork')
    expect(libraryMaterial('steel')).toBeUndefined()
    expect(libraryNote()).toEqual(expect.stringMatching(/not loaded yet/))
    // A name of the fork's own needs nothing loaded; any other loads them.
    expect(isBundledMaterial('PLA')).toBe(true)
    expect(isBundledMaterial('delrin')).toBe(true)
    expect(isBundledMaterial('steel')).toBe(false)
    await materialsFor(['pla', 'tpu'])
    expect(useMaterialLibrary.getState().status).toBe('not-loaded')
    await materialsFor(['pla', 'steel'])
    expect(useMaterialLibrary.getState().status).toBe('loaded')
    expect(libraryMaterial('steel')).toMatchObject({ id: 'steel-generic', density: 7.9, source: { from: 'FreeCAD' } })
    expect(libraryNote()).toBeNull()
  })

  it('loads them once however many ask, from the file under public/', async () => {
    resetMaterialLibrary()
    const asked: string[] = []
    const disk = resolve(ROOT, 'public')
    setAssetReader(async (path) => {
      asked.push(path)
      return readFileSync(join(disk, path), 'utf8')
    })
    await Promise.all([ensureMaterials(), ensureMaterials(), assignedReady(['aluminum'])])
    await ensureMaterials()
    expect(asked).toEqual([CARDS_ASSET])
    expect(library().length).toBe(131 + library().filter((m) => m.source.from === 'fork').length)
  })

  it('a body set to a card waits for them; one of the fork’s own does not', async () => {
    resetMaterialLibrary()
    useAssigned.setState({ assigned: { '1': 'pla' } })
    await assignedReady()
    expect(useMaterialLibrary.getState().status).toBe('not-loaded')
    useAssigned.setState({ assigned: { '1': 'pla', '2': { custom: { name: 'Mine', base: 'steel-s235jr', yieldMPa: 300 } } } })
    await assignedReady()
    expect(resolveAssignment(useAssigned.getState().assigned['2'])).toMatchObject({ name: 'Mine', density: 7.8, yieldMPa: 300 })
  })

  it('says why when they cannot be had, keeps the fork’s own, and tries again', async () => {
    resetMaterialLibrary()
    setAssetReader(() => Promise.reject(new Error('offline')))
    await expect(ensureMaterials()).rejects.toThrow(/FreeCAD's material cards could not be loaded \(offline\)/)
    expect(useMaterialLibrary.getState()).toMatchObject({ status: 'failed', error: 'offline' })
    expect(libraryNote()).toEqual(expect.stringMatching(/could not be loaded \(offline\)/))
    expect(libraryMaterial('petg')?.density).toBe(1.27)
    // A filament still needs nothing; steel does, and says so.
    await materialsFor(['petg'])
    await expect(materialsFor(['steel'])).rejects.toThrow(/could not be loaded/)
    setAssetReader(null)
    await ensureMaterials()
    expect(useMaterialLibrary.getState().status).toBe('loaded')
  })

  it('takes nothing but FreeCAD materials with their licence from the file', () => {
    expect(() => parseCards('{"materials": [{"id": "x", "name": "X", "category": "metal", "source": {"from": "FreeCAD"}}]}')).toThrow(/licence/)
    expect(() => parseCards('{"about": "nothing"}')).toThrow(/not a list/)
    expect(parseCards('[]')).toEqual([])
  })
})

describe('loaded, not linked', () => {
  const asset = resolve(ROOT, 'public', CARDS_ASSET)

  it('keeps the cards in one data file under public/, with each card’s author and licence and the licence texts beside it', () => {
    const file = JSON.parse(readFileSync(asset, 'utf8')) as { about: string; materials: { source: { from: string; license: string; author?: string; card?: string } }[] }
    expect(file.about).toEqual(expect.stringMatching(/FreeCAD.*LGPL-2\.0\.txt and CC-BY-3\.0\.txt beside this file/))
    expect(file.materials.length).toBe(131)
    expect(file.materials.every((m) => m.source.from === 'FreeCAD' && m.source.card)).toBe(true)
    expect(file.materials.filter((m) => m.source.license === 'LGPL-2.0-or-later').length).toBe(100)
    expect(file.materials.filter((m) => m.source.license === 'CC-BY-3.0').length).toBe(31)
    const dir = dirname(asset)
    expect(readFileSync(join(dir, 'LGPL-2.0.txt'), 'utf8')).toEqual(expect.stringMatching(/GNU LIBRARY GENERAL PUBLIC LICENSE\s+Version 2, June 1991/))
    expect(readFileSync(join(dir, 'CC-BY-3.0.txt'), 'utf8')).toEqual(expect.stringMatching(/Attribution 3\.0 Unported/))
    // The bundled table is gone: the data is in the asset alone.
    expect(existsSync(join(MATERIALS_DIR, 'freecad.json'))).toBe(false)
    expect(readdirSync(MATERIALS_DIR).filter((f) => f.endsWith('.json'))).toEqual([])
  })

  it('imports the cards into no module: every file the library bundles names them by path at most', () => {
    // The library's own module graph, followed through its relative imports.
    const seen = new Set<string>()
    const walk = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)) {
        const spec = m[1] ?? m[2]
        expect(spec).toEqual(expect.stringMatching(/^(?![^?]*\.json(\?|$))/))
        if (!spec.startsWith('.')) continue
        const base = resolve(dirname(file), spec)
        const hit = ['', '.ts', '.tsx', '/index.ts'].map((x) => base + x).find((f) => existsSync(f) && statSync(f).isFile())
        if (hit && /\.tsx?$/.test(hit)) walk(hit)
      }
    }
    walk(join(MATERIALS_DIR, 'index.ts'))
    walk(join(MATERIALS_DIR, 'assigned.ts'))
    walk(join(MATERIALS_DIR, 'useLibrary.ts'))
    expect([...seen].some((f) => f.endsWith('src/plugins/assets.ts'))).toBe(true)
    // And no source file anywhere imports the asset: it is fetched or read, never linked.
    const sources: string[] = []
    const collect = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.') || e.name.startsWith('dist')) continue
        const p = join(dir, e.name)
        if (e.isDirectory()) collect(p)
        else if (/\.(ts|tsx|mts|js|mjs)$/.test(e.name)) sources.push(p)
      }
    }
    for (const d of ['src', 'plugins']) collect(join(ROOT, d))
    const importing = sources.filter((f) => /(?:from\s*|import\s*\(\s*)['"][^'"]*freecad(?:-cards)?\.json/.test(readFileSync(f, 'utf8')))
    expect(importing).toEqual([])
  })
})

describe('the credit in the imprint', () => {
  it('is registered by the library itself, once, so a build without the Materials plugin has it', () => {
    const ours = sharedNotices().filter((n) => n.id === 'materials')
    expect(ours.length).toBe(1)
    expect(ours[0].Notices).toBe(MaterialNotices)
  })
  it('says the cards are loaded, not linked, under which licences, and where they come from', () => {
    const text = (node: unknown): string => {
      if (node === null || node === undefined || typeof node === 'boolean') return ''
      if (typeof node === 'string' || typeof node === 'number') return String(node)
      if (Array.isArray(node)) return node.map(text).join('')
      const p = (node as { props?: { children?: unknown; href?: string } }).props ?? {}
      return (p.href ? `[${p.href}]` : '') + text(p.children)
    }
    const said = text(MaterialNotices()).replace(/\s+/g, ' ')
    expect(said).toEqual(expect.stringMatching(/loaded, not linked/))
    expect(said).toEqual(expect.stringMatching(/100 under LGPL-2\.0-or-later, 31 under CC BY 3\.0/))
    expect(said).toEqual(expect.stringMatching(/\[\/?materials\/freecad-cards\.json\]/))
    expect(said).toEqual(expect.stringMatching(/\[\/?materials\/LGPL-2\.0\.txt\]/))
    expect(said).toEqual(expect.stringMatching(/\[https:\/\/github\.com\/FreeCAD\/FreeCAD\/tree\/main\/src\/Mod\/Material\/Resources\]/))
  })
})

describe('the setups reader', () => {
  const state = { setups: [{ id: 'a', type: 'print', name: 'Plate', bodies: [3, '4'], infill: 25 }, { id: 'b', type: 'cut', name: 'Laser', bodies: ['7'] }, { id: 'bad' }] }
  it('reads setups, bodies as keys, malformed ones left out', () => {
    expect(setupsOf(state).map((s) => [s.id, s.bodies])).toEqual([
      ['a', ['3', '4']],
      ['b', ['7']],
    ])
    expect(setupFor(3, state)?.id).toBe('a')
    expect(setupFor({ id: 7 }, state)?.type).toBe('cut')
    expect(setupFor('9', state)).toBe(null)
    expect(isPrinted('4', state)).toBe(true)
    expect(isPrinted('7', state)).toBe(false)
    expect(setupsOf(undefined)).toEqual([])
  })
  it('takes a print setup’s fill where it gives it', () => {
    const fall = { infill: 20, walls: 2, lineWidth: 0.45 }
    expect(printFillOf(setupsOf(state)[0], fall)).toEqual({ infill: 25, walls: 2, lineWidth: 0.45 })
    expect(printFillOf({ settings: { wallLoops: 3, infill: 300 } }, fall)).toEqual({ infill: 20, walls: 3, lineWidth: 0.45 })
  })
})
