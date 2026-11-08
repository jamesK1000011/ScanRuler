// SPDX-License-Identifier: AGPL-3.0-only
// What a printed circuit conducts with, and the arithmetic of it: the
// conductive filaments (volume resistivity along the layers and through
// them, as their makers publish it — typical figures, not a guarantee of
// a given print), copper wire by AWG (its diameter from the gauge's
// definition, its resistance from copper's resistivity, never copied from
// a table), copper tape, and conductive paint by its sheet resistance.
// Pure: millimetres, ohms, amperes, watts.

/** A conductor printed or laid in. Resistivity in Ω·cm, as makers give it. */
export interface Material {
  id: string
  name: string
  /** Along the layers (in the XY plane), Ω·cm. */
  along: number
  /** Through the layers (along Z), Ω·cm. */
  through: number
  /** Where the figures come from. */
  source: string
  /** The hot end range the maker gives, °C. */
  printTemp?: [number, number]
  /** The most it should be kept at in use, °C, where the maker says. */
  maxUseC?: number
  notes: string[]
}

/** Typical figures, as published by the makers (see README.md). */
export const MATERIALS: readonly Material[] = [
  {
    id: 'protopasta',
    name: 'Protopasta conductive PLA',
    along: 30,
    through: 115,
    source: 'Proto-pasta, Conductive PLA page: printed parts 30 Ω·cm along the layers (X/Y), 115 Ω·cm against them (Z); molded resin 15 Ω·cm.',
    printTemp: [215, 230],
    maxUseC: 50,
    notes: ['Typical figures: a print measures higher where layers bond poorly. Use below 50 °C (the maker’s figure).', 'Kilohms over a few centimetres: signals, touch pads and low-current LEDs, not power.'],
  },
  {
    id: 'electrifi',
    name: 'Multi3D Electrifi',
    along: 0.006,
    through: 0.006,
    source: 'Multi3D Electrifi, as listed by MatterHackers: 0.006 Ω·cm, printed at 130–160 °C. No through-layer figure is published: taken as the same.',
    printTemp: [130, 160],
    notes: ['Low heat resistance: it prints at 130–160 °C and softens well below PLA’s print temperature — keep the current low and the part cool.', 'No through-layer figure is published; vias and upright runs use the along-layer figure.'],
  },
] as const

/** Copper at 20 °C, Ω·m: the default for wire and tape. */
export const COPPER_OHM_M = 1.68e-8

/** The user's own filament. */
export function customMaterial(along: number, through?: number): Material {
  return { id: 'custom', name: 'Your filament', along, through: through ?? along, source: 'Entered.', notes: through === undefined ? ['No through-layer figure given: the along-layer figure is used for vias and upright runs.'] : [] }
}

export const materialOf = (id: string): Material | undefined => MATERIALS.find((m) => m.id === id)

/** Ω·cm to Ω·mm. */
export const OHM_MM_PER_OHM_CM = 10

/**
 * Resistivity along a unit direction d through a layered print, Ω·cm:
 * current forced along d sees the resistivity tensor (along, along,
 * through) projected on it, ρ = ρ_along·(1 − d_z²) + ρ_through·d_z².
 */
export function resistivityAlong(m: Pick<Material, 'along' | 'through'>, dz: number): number {
  const z2 = Math.min(1, dz * dz)
  return m.along * (1 - z2) + m.through * z2
}

/** A run's resistance, Ω: ρ (Ω·cm) over length (mm) and cross-section (mm²). */
export function runResistance(rhoOhmCm: number, lengthMm: number, areaMm2: number): number {
  return (rhoOhmCm * OHM_MM_PER_OHM_CM * lengthMm) / areaMm2
}

// ---- copper wire ------------------------------------------------------------------------

/** A gauge's diameter, mm, from the AWG's definition: 0.005 in at 36,
 *  92 to the power of (36 − n)/39 times that. 0, 00, 000, 0000 are 0, −1,
 *  −2, −3. */
export function awgDiameter(n: number): number {
  return 0.127 * Math.pow(92, (36 - n) / 39)
}

export const AWG_MIN = -3
export const AWG_MAX = 40

/** Ω per metre of a round copper conductor of diameter d mm. */
export function wireOhmPerM(dMm: number, rhoOhmM = COPPER_OHM_M): number {
  const a = (Math.PI * dMm * dMm) / 4 / 1e6
  return rhoOhmM / a
}

/** The gauges from `from` to `to`: diameter, area and Ω/m, worked out. */
export function awgTable(from = 10, to = 30, rhoOhmM = COPPER_OHM_M) {
  const out = []
  for (let n = from; n <= to; n++) {
    const d = awgDiameter(n)
    out.push({ awg: n, diameter: sig(d), area: sig((Math.PI * d * d) / 4), ohmPerM: sig(wireOhmPerM(d, rhoOhmM)) })
  }
  return out
}

/** Copper of resistivity ρ (Ω·m) in Ω·cm. */
export const copperOhmCm = (rhoOhmM = COPPER_OHM_M) => rhoOhmM * 100

// ---- heat and drop ----------------------------------------------------------------------

export interface Load {
  /** Ω. */
  resistance: number
  /** mm. */
  length: number
  /** A. */
  current: number
}

/** The drop, the power, and the power per metre of run at a current. */
export function loadOf({ resistance, length, current }: Load) {
  const volts = current * resistance
  const watts = current * current * resistance
  const wPerM = length > 0 ? watts / (length / 1000) : 0
  return { volts, watts, wPerM }
}

/** The current at which a run of `ohmPerM` dissipates `wPerM`, A. */
export const currentFor = (ohmPerM: number, wPerM: number) => (ohmPerM > 0 ? Math.sqrt(wPerM / ohmPerM) : Infinity)

/** Six significant figures: what an answer gives. */
export const sig = (x: number) => (Number.isFinite(x) ? Number(x.toPrecision(6)) + 0 : x)
