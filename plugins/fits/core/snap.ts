// SPDX-License-Identifier: AGPL-3.0-only
// The cantilever snap-fit hook: a beam of constant rectangular section,
// fixed at its root, deflected at its tip by the hook's undercut as it goes
// in. The standard beam formulas (as in the Bayer/Covestro snap-fit design
// guide and every plastics design text after it):
//
//   strain at the root     ε = 1.5 · t · y / L²
//   deflection force       P = b · t² · Es · ε / (6 · L)
//   mating force           W = P · (µ + tan α) / (1 − µ · tan α)
//   separation force       the same with the retaining angle α′
//
// t the beam's thickness (in the way it bends), y the undercut, L the
// beam's length from root to hook, b its width, Es the secant modulus at
// that strain, µ the friction between the parts, α the angle of the face
// to the way the parts move. Where µ · tan α′ ≥ 1 the hook locks: no pull
// takes it apart without the beam being lifted by hand.

import { MATERIAL_ALIASES } from '../../_shared/materials'

export interface Material {
  id: string
  label: string
  /** Secant modulus, MPa, in the plane of the layers. */
  modulus: number
  /** Permissible strain for one assembly, the beam printed flat (bending
   *  in the plane of its layers). */
  strain: number
  /** The share of it a beam printed standing up (bending across its
   *  layers) takes: the printed strain at break or peak force across the
   *  layers over that along them. */
  upright: number
  /** Friction against a part of the same. */
  friction: number
  /** Where the strain comes from, in a word: 'printed' (a maker's figures
   *  for printed bars) or 'typical' (no published printed figure found). */
  basis: 'printed' | 'typical'
}

// Ids, labels and moduli as the other workspaces have them: the ids those
// of plugins/_shared/materials.ts (nylon, unfilled, is Fits' own), the
// moduli the in-plane ones of the Strength workspace's table (mcp/src/
// extras/fea.js Exy), which plugins/fits/tests/fits.test.ts holds them to.
//
// The strains: two-thirds of what printed bars reach before they yield or
// peak, flat, the lower where two sources differ — the margin Bayer's snap-fit guide keeps for polycarbonate
// (Makrolon: 4 % allowed, against about 6 % at yield; Snap-Fit Joints for
// Plastics, Table 2). Printed figures: Prusament PLA, yield 2.9 % flat,
// 1.9–2.2 % upright, and Prusament PETG, yield 3.5 % (Prusa Research's
// data sheets, ISO 527); BASF Innofil3D's comparison sheet (printed,
// ISO 527), strain at peak force flat / upright: PLA 2.1 / 1.1 %, PET
// 3.0 / 1.3 %, ABS 2.4 / 0.7 %, ASA 2.6 / 1.0 % — whence the upright
// shares (ABS bends across its layers at under a third). Friction: Bayer's
// guide (Table 3), plastic on steel times its factor for the same plastic
// on itself — ABS 0.50–0.65 × 1.2, PA 0.30–0.40 × 1.5; PLA's and PETG's
// are not in it. Nylon's and TPU's strains have no printed figure behind
// them: typical, said so. Print a hook and try it; the material's own data
// sheet comes first.
export const MATERIALS: Material[] = [
  { id: 'pla', label: 'PLA', modulus: 2680, strain: 0.014, upright: 0.5, friction: 0.35, basis: 'printed' },
  { id: 'petg', label: 'PETG', modulus: 2000, strain: 0.02, upright: 0.4, friction: 0.35, basis: 'printed' },
  { id: 'abs', label: 'ABS', modulus: 2000, strain: 0.016, upright: 0.3, friction: 0.6, basis: 'printed' },
  { id: 'asa', label: 'ASA', modulus: 1950, strain: 0.017, upright: 0.4, friction: 0.6, basis: 'printed' },
  { id: 'nylon', label: 'Nylon (PA, unfilled)', modulus: 1200, strain: 0.04, upright: 0.5, friction: 0.45, basis: 'typical' },
  { id: 'tpu-95a', label: 'TPU 95A', modulus: 26, strain: 0.15, upright: 0.5, friction: 0.6, basis: 'typical' },
]
export const MATERIAL_IDS = MATERIALS.map((m) => m.id)
/** Every name a material is taken by: its id, and the older names (tpu). */
export const MATERIAL_NAMES = [...MATERIAL_IDS, ...Object.keys(MATERIAL_ALIASES).filter((a) => MATERIAL_IDS.includes(MATERIAL_ALIASES[a]))]
export const materialOf = (id: string): Material | undefined => MATERIALS.find((m) => m.id === (Object.hasOwn(MATERIAL_ALIASES, id) ? MATERIAL_ALIASES[id] : id))

/** Snap-fit guides allow about 60 % of the one-time strain for a hook
 *  that is snapped together and apart again and again (Bayer, Table 2). */
export const REPEATED = 0.6

export interface SnapIn {
  /** Beam length, root to the hook's retaining face. */
  length: number
  /** Beam thickness, in the way it bends. */
  thickness: number
  /** Beam width. */
  width: number
  /** The hook's undercut: how far it deflects going in. */
  undercut: number
  /** Lead-in face to the way it goes in, degrees. */
  leadAngle?: number
  /** Retaining face to the way it comes out, degrees; 90 square. */
  retainAngle?: number
  material?: string
  /** In place of the material's own. */
  modulus?: number
  strain?: number
  friction?: number
  uses?: 'once' | 'repeated'
  printed?: 'flat' | 'upright'
}

export interface SnapOut {
  strain: number
  allowed: number
  /** strain / allowed: over 1 the beam is strained past its limit. */
  ratio: number
  ok: boolean
  deflectionForce: number
  matingForce: number | null
  separationForce: number | null
  locks: boolean
  /** The most undercut this beam takes, and the shortest beam for this
   *  undercut, at the allowed strain. */
  maxUndercut: number
  minLength: number
  material: { id: string; modulus: number; strain: number; friction: number; upright: number }
  notes: string[]
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0
const rad = (deg: number) => (deg * Math.PI) / 180

/** The force to push the faces past each other at angle α, or null where
 *  the face cannot be pushed past at all (µ tan α ≥ 1). */
export function wedgeForce(p: number, mu: number, deg: number): number | null {
  if (deg >= 90) return null
  const t = Math.tan(rad(deg))
  const den = 1 - mu * t
  return den <= 1e-9 ? null : (p * (mu + t)) / den
}

export function snap(s: SnapIn): SnapOut {
  const m = materialOf(s.material ?? 'petg')
  if (!m) throw new RangeError(`material: one of ${MATERIAL_IDS.join(', ')}.`)
  const E = s.modulus ?? m.modulus
  const mu = s.friction ?? m.friction
  const base = s.strain ?? m.strain
  const { length: L, thickness: t, width: b, undercut: y } = s
  const lead = s.leadAngle ?? 30
  const ret = s.retainAngle ?? 90
  for (const [k, v] of [['length', L], ['thickness', t], ['width', b], ['undercut', y]] as const) if (!(v > 0)) throw new RangeError(`${k}: above 0.`)
  if (!(lead > 0 && lead < 90)) throw new RangeError('leadAngle: between 0 and 90 degrees.')
  if (!(ret > 0 && ret <= 90)) throw new RangeError('retainAngle: above 0, up to 90 degrees.')
  if (L < 3 * t) throw new RangeError(`A beam ${L} long and ${t} thick is no cantilever (under 3 × its thickness): the formulas don’t hold.`)
  const allowed = base * (s.uses === 'repeated' ? REPEATED : 1) * (s.printed === 'upright' ? m.upright : 1)
  const eps = (1.5 * t * y) / (L * L)
  const P = (b * t * t * E * eps) / (6 * L)
  const W = wedgeForce(P, mu, lead)
  const S = wedgeForce(P, mu, ret)
  const locks = S === null
  const notes: string[] = []
  const ratio = eps / allowed
  if (ratio > 1) notes.push(`The root strains ${r4(eps * 100)} %, past the ${r4(allowed * 100)} % allowed: lengthen the beam (≥ ${r4(Math.sqrt((1.5 * t * y) / allowed))}), thin it, or take less undercut (≤ ${r4((allowed * L * L) / (1.5 * t))}).`)
  if (W === null) notes.push(`The lead-in at ${lead}° is too steep to push past with this friction (µ·tan α ≥ 1): take a shallower lead-in, 25–35° being usual.`)
  if (locks) notes.push(ret >= 90 ? 'A square retaining face: it holds until the beam is lifted by hand.' : `The retaining face at ${ret}° locks with this friction (µ·tan α′ ≥ 1): it holds until the beam is lifted.`)
  if (s.printed === 'upright') notes.push(`Printed standing up the beam bends across its layers, which part at about ${Math.round(m.upright * 100)} % of the strain: print it lying flat if you can.`)
  if (m.basis === 'typical' && s.strain === undefined) notes.push(`${m.label}’s permissible strain (${r4(m.strain * 100)} %) is typical, not from printed test bars: try a hook, or give strain from the filament’s data sheet.`)
  if (y > t * 1.5) notes.push('An undercut deeper than 1.5 × the beam’s thickness: the hook’s head is long and weak at its neck.')
  if (b < 3 * t) notes.push('A beam narrower than 3 × its thickness twists: the formulas take a plate-like beam.')
  return {
    strain: r4(eps),
    allowed: r4(allowed),
    ratio: r4(ratio),
    ok: ratio <= 1 && W !== null,
    deflectionForce: r4(P),
    matingForce: W === null ? null : r4(W),
    separationForce: S === null ? null : r4(S),
    locks,
    maxUndercut: r4((allowed * L * L) / (1.5 * t)),
    minLength: r4(Math.sqrt((1.5 * t * y) / allowed)),
    material: { id: m.id, modulus: E, strain: base, friction: mu, upright: m.upright },
    notes,
  }
}
