// SPDX-License-Identifier: AGPL-3.0-only
// The material a study solves in: the body's own (material.set), or — with
// none set — the study's (fea.setup material), as before materials were per
// part, said so. A body in a print setup whose material has printing
// figures (plugins/_shared/materials/printed.ts) solves as printed: stiffer
// and stronger in its layers than across them. Anything else solves as the
// solid material, the same in every direction: the server is sent its
// figures whole, over a preset it ignores them for, with the material's
// name and density (`bulk`) — an older server, which does not read bulk,
// still solves the figures, and only names the preset.

import { readStateSection } from '../../../src/commands/stateSections'
import { CommandError } from '../../../src/plugins/api'
import { libraryMaterial, materialId } from '../../_shared/materials'
import { assignedReady, materialOfBody, useAssigned, type ResolvedMaterial } from '../../_shared/materials/assigned'
import { PRINTED } from '../../_shared/materials/printed'
import { bodyKeyOf, setupFor } from '../../_shared/setups'

export interface StudyMaterial {
  /** What the server is sent as job.material. */
  job: { id: string; overrides: Record<string, number>; bulk?: { id: string; label: string; density: number } }
  label: string
  /** g/cm³, solid. */
  density: number
  as: 'printed' | 'solid'
  /** No material set on the body: the study's was taken. */
  assumed?: true
  note?: string
}

/** A solid material's figures as the server's transversely isotropic set,
 *  equal in every direction: strength its yield (else its ultimate), shear
 *  strength by von Mises (σ/√3), the shear modulus its own or E/2(1+ν).
 *  Missing ones named. */
export function isotropicFigures(m: Pick<ResolvedMaterial, 'youngsMPa' | 'shearMPa' | 'poisson' | 'yieldMPa' | 'ultimateMPa' | 'compressiveMPa'>): { figures: Record<string, number>; missing: string[] } {
  const E = m.youngsMPa
  const nu = m.poisson ?? 0.3
  const X = m.yieldMPa ?? m.ultimateMPa
  const missing = [E === undefined ? 'Young’s modulus (Exy, Ez)' : '', X === undefined ? 'strength (Xt, Xc, Zt, Zc, S, Sz)' : ''].filter(Boolean)
  const figures: Record<string, number> = { nuXY: nu, nuZ: nu }
  if (E !== undefined) {
    const G = m.shearMPa ?? E / (2 * (1 + nu))
    Object.assign(figures, { Exy: E, Ez: E, Gxy: G, Gz: G })
  }
  if (X !== undefined) {
    const C = m.compressiveMPa ?? X
    const S = X / Math.sqrt(3)
    Object.assign(figures, { Xt: X, Xc: C, Zt: X, Zc: C, S, Sz: S })
  }
  return { figures, missing }
}

/** studyMaterial once the material can be read: a body set to a FreeCAD
 *  card waits for the cards (loaded at run time), rather than solving in
 *  the study's filament as though it had none. */
export async function studyMaterialReady(bodyId: number | null, study: { material: string; overrides: Record<string, number> }): Promise<StudyMaterial> {
  await assignedReady([study.material])
  return studyMaterial(bodyId, study)
}

/** The study's material for a Reverse Engineer body, by id. */
export function studyMaterial(bodyId: number | null, study: { material: string; overrides: Record<string, number> }): StudyMaterial {
  const own = bodyId === null ? null : materialOfBody(bodyId)
  const setup = bodyId === null ? null : setupFor(bodyKeyOf(bodyId))
  // With no material set, the study's filament — printed, unless a setup
  // says the body is made some other way.
  const m: ResolvedMaterial | null = own ?? libraryMaterial(materialId(study.material) ?? study.material) ?? null
  if (!m) throw new CommandError('invalid_state', `No material "${study.material}": fea.setup { material }, or material.set on the body.`)
  const printed = own ? setup?.type === 'print' : setup === null || setup.type === 'print'
  const assumed = own ? {} : ({ assumed: true } as const)
  const said = own ? '' : `No material set on the body — assumed ${m.name}${printed ? ' as printed' : ''} (fea.setup; material.set gives the body its own).`
  const density = m.density ?? 1
  if (printed && !m.custom && PRINTED[m.id]) {
    return { job: { id: m.id, overrides: study.overrides }, label: m.name, density, as: 'printed', ...assumed, ...(said ? { note: said } : {}) }
  }
  const { figures, missing } = isotropicFigures(m)
  const given = Object.keys(study.overrides)
  const still = missing.filter((w) => !/\(([^)]+)\)/.exec(w)![1].split(', ').every((k) => given.includes(k)))
  if (still.length) throw new CommandError('invalid_state', `${m.name} has no ${still.join(' or ')} in the library: give the figures (fea.setup overrides), or set a material that has them (material.set { body, material: { name, base, youngsMPa, yieldMPa } }).`)
  if (m.density === undefined) throw new CommandError('invalid_state', `${m.name} has no density in the library: set one of your own with it (material.set { body, material: { name, base: "${m.id}", density } }).`)
  const ultimateOnly = m.yieldMPa === undefined && m.ultimateMPa !== undefined && !given.includes('Xt')
  const notes = [
    said,
    printed && !m.custom && !PRINTED[m.id] ? `There are no printing figures for ${m.name}: solved as the solid material, the same in every direction.` : '',
    ultimateOnly ? `${m.name} has no yield strength in the library: judged against its ultimate strength (${m.ultimateMPa} MPa), which leaves no margin against yielding — give its yield (material.set with yieldMPa, or fea.setup overrides).` : '',
  ].filter(Boolean)
  return {
    job: { id: 'pla', overrides: { ...figures, ...study.overrides }, bulk: { id: m.id, label: m.name, density: m.density } },
    label: m.name,
    density: m.density,
    as: 'solid',
    ...assumed,
    ...(notes.length ? { note: notes.join(' ') } : {}),
  }
}

/** The study body's material and setup now, as text: a result solved with
 *  others is stale. Read from the readout, which cannot wait. */
export function materialKeyOf(bodyName: string | null): string {
  if (!bodyName) return ''
  const b = (((readStateSection('reverse') ?? {}) as { bodies?: { id: number; name: string }[] }).bodies ?? []).find((x) => x.name.toLowerCase() === bodyName.toLowerCase())
  if (!b) return ''
  const setup = setupFor(bodyKeyOf(b))
  return JSON.stringify([useAssigned.getState().assigned[bodyKeyOf(b)] ?? null, setup?.type ?? null])
}
