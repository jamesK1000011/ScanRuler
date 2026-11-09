// SPDX-License-Identifier: AGPL-3.0-only
// The material library: FreeCAD's cards as converted (a few figures read
// back against the cards, their units turned), every entry credited with
// its licence, the Machining cards given their bulk figures, the fork's
// own entries beside them, the names a material is found by, the credit
// in the imprint wherever the library is bundled, and the setups reader
// keyed by body id.
import { describe, expect, it } from 'vitest'
import { LIBRARY, LIBRARY_ALIASES, libraryMaterial, MATERIAL_IDS, MATERIALS, searchLibrary } from '../materials'
import { PRINTED, printFillOf } from '../materials/printed'
import { resolveAssignment } from '../materials/assigned'
import { isPrinted, setupFor, setupsOf } from '../setups'
import { sharedNotices } from '../../../src/plugins/notices'
import { MaterialNotices } from '../materials/Notices'

describe('the library', () => {
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
    const licences = new Set(LIBRARY.map((m) => m.source.license))
    expect([...licences].sort()).toEqual(['AGPL-3.0-only', 'CC-BY-3.0', 'LGPL-2.0-or-later'])
    const freecad = LIBRARY.filter((m) => m.source.from === 'FreeCAD')
    expect(freecad.length).toBe(131)
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
    expect(LIBRARY.filter((m) => m.machining).length).toBe(13)
    expect(LIBRARY.filter((m) => m.machining).every((m) => m.density! > 0)).toBe(true)
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

describe('the credit in the imprint', () => {
  it('is registered by the library itself, once, so a build without the Materials plugin has it', () => {
    const ours = sharedNotices().filter((n) => n.id === 'materials')
    expect(ours.length).toBe(1)
    expect(ours[0].Notices).toBe(MaterialNotices)
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
