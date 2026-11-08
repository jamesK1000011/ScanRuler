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

export interface Material {
  id: string
  label: string
  /** Secant modulus, MPa — typical for the material printed. */
  modulus: number
  /** Permissible strain for one assembly, the beam printed flat (layers in
   *  the plane it bends in) — typical, a starting point. */
  strain: number
  /** Friction against a printed part of the same, typical. */
  friction: number
}

// Typical figures, not a datasheet's: the strains are the moulded
// figures the snap-fit guides give (ABS 2.5 %, PA 4 % and the like),
// held at or under them for a printed part, PLA lower for its brittleness;
// moduli and friction as printed parts commonly measure. Print a hook
// and try it; the material's own datasheet comes first.
export const MATERIALS: Material[] = [
  { id: 'pla', label: 'PLA', modulus: 2700, strain: 0.015, friction: 0.35 },
  { id: 'petg', label: 'PETG', modulus: 1900, strain: 0.025, friction: 0.35 },
  { id: 'abs', label: 'ABS', modulus: 1900, strain: 0.025, friction: 0.5 },
  { id: 'asa', label: 'ASA', modulus: 1900, strain: 0.025, friction: 0.5 },
  { id: 'nylon', label: 'Nylon (PA)', modulus: 1200, strain: 0.04, friction: 0.3 },
  { id: 'tpu', label: 'TPU 95A', modulus: 30, strain: 0.15, friction: 0.6 },
]
export const MATERIAL_IDS = MATERIALS.map((m) => m.id)
export const materialOf = (id: string): Material | undefined => MATERIALS.find((m) => m.id === id)

/** Snap-fit guides allow about 60 % of the one-time strain for a hook
 *  that is snapped together and apart again and again. */
export const REPEATED = 0.6
/** A beam printed standing up bends across its layers, which part at
 *  about half the strain. */
export const UPRIGHT = 0.5

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
  material: { id: string; modulus: number; strain: number; friction: number }
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
  const allowed = base * (s.uses === 'repeated' ? REPEATED : 1) * (s.printed === 'upright' ? UPRIGHT : 1)
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
  if (s.printed === 'upright') notes.push('Printed standing up the beam bends across its layers: print it lying flat if you can.')
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
    material: { id: m.id, modulus: E, strain: base, friction: mu },
    notes,
  }
}
