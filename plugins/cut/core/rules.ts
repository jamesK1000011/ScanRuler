// SPDX-License-Identifier: AGPL-3.0-only
// What a sheet cut holds to, by the machine and the material, where the
// setup leaves a figure unset: the kerf, the least feature (a web, a slot,
// a hole), and the rule of thumb on holes against the thickness. Shop
// rules of thumb, not a machine's datasheet — a setup's own figures win,
// and the answers say which were assumed.

export const KINDS = ['laser', 'waterjet', 'plasma', 'router'] as const
export type CutKind = (typeof KINDS)[number]

/** A setup's machine, laser when it says none. */
export const kindOf = (s: { readonly [k: string]: unknown } | null | undefined): CutKind => ((KINDS as readonly unknown[]).includes(s?.machine) ? (s!.machine as CutKind) : 'laser')

/** The material as the rules tell it apart: the library's category. */
export type Stuff = 'metal' | 'thermoplast' | 'wood' | 'glass' | 'other'

export const stuffOf = (category: string | undefined | null): Stuff => (category === 'metal' || category === 'thermoplast' || category === 'wood' || category === 'glass' ? category : 'other')

export interface CutRules {
  /** The width the cut takes out, mm. A router's is its cutter's diameter. */
  kerf: number
  /** The least web, slot or hole, mm. */
  minFeature: number
  /** A round hole under this many thicknesses is warned of (0: no rule). */
  holePerThickness: number
  /** ± a cut size lands within, mm, for Fits. */
  tolerance: number
  /** Why these figures. */
  basis: string
}

/** The figures for a kind of machine and a material at a thickness. */
export function cutRules(kind: CutKind, stuff: Stuff, thickness: number): CutRules {
  const t = Math.max(thickness, 0)
  const r = (x: number) => Math.round(x * 1000) / 1000 + 0
  switch (kind) {
    case 'laser':
      // A metal: a hole or web about the thickness; plastics and wood melt
      // or char less across a narrow web, about half.
      return stuff === 'metal'
        ? { kerf: 0.15, minFeature: r(Math.max(0.5, t)), holePerThickness: 1, tolerance: 0.05, basis: 'laser in metal: kerf 0.15, web and hole at least the thickness' }
        : { kerf: 0.2, minFeature: r(Math.max(0.5, t / 2)), holePerThickness: stuff === 'other' ? 1 : 0.5, tolerance: 0.1, basis: `laser in ${stuff === 'other' ? 'an unset material' : stuff}: kerf 0.2, web at least half the thickness` }
    case 'waterjet':
      return { kerf: 0.9, minFeature: r(Math.max(1, t / 2)), holePerThickness: 0.5, tolerance: 0.1, basis: 'abrasive waterjet: kerf 0.9, web at least 1 or half the thickness' }
    case 'plasma':
      return { kerf: 1.5, minFeature: r(Math.max(3, 1.5 * t)), holePerThickness: 1.5, tolerance: 0.5, basis: 'plasma: kerf 1.5, holes and webs at least 1.5 thicknesses (and 3)' }
    case 'router':
      // The cutter is 1/8 in, the commonest; a web is left about a cutter
      // wide so it does not chatter or break.
      return { kerf: 3.175, minFeature: 3.175, holePerThickness: 0, tolerance: 0.1, basis: 'router: a 3.175 cutter; a slot or hole at least its diameter, an inside corner at least its radius' }
  }
}

/** Whether the machine can cut the material at all, or at the thickness:
 *  a word against, or null. */
export function unsuited(kind: CutKind, stuff: Stuff, thickness: number): { severity: 'error' | 'warning'; says: string } | null {
  if (kind === 'plasma' && stuff !== 'metal' && stuff !== 'other') return { severity: 'error', says: `plasma cuts only conductive metal, not ${stuff}` }
  if (kind === 'laser' && stuff === 'glass') return { severity: 'warning', says: 'glass cracks under a laser: waterjet it' }
  if (kind === 'laser' && stuff === 'metal' && thickness > 20) return { severity: 'warning', says: `${thickness} of metal is past most lasers (about 20): waterjet or plasma` }
  if (kind === 'laser' && stuff !== 'metal' && thickness > 25) return { severity: 'warning', says: `${thickness} thick is past most lasers in ${stuff === 'other' ? 'this material' : stuff}` }
  if (kind === 'router' && stuff === 'glass') return { severity: 'error', says: 'a router does not cut glass: waterjet it' }
  if (kind === 'router' && stuff === 'metal') return { severity: 'warning', says: 'a router cuts soft metals (aluminum, brass) slowly and steel hardly at all' }
  return null
}
