// SPDX-License-Identifier: AGPL-3.0-only
// The library's own entries, beside FreeCAD's cards: the printing filaments
// the app has always listed, and sheet, moulded and bought-part materials
// FreeCAD's library lacks. Typical figures, each with where it comes from;
// a supplier's data sheet comes first, and a custom material takes it.
//
// The filaments' figures are the solid material as the app knows it: the
// makers' in-layer figures for bars printed at 100 % infill (Bambu Lab's
// data sheets, ISO 527, X-Y specimens) — what the Strength workspace has
// always started from. A moulded part of the same plastic is somewhat
// stiffer and stronger. How printing changes a part — weaker across its
// layers, walls round a sparse infill — is printed.ts's, not the
// material's.

import type { Material } from './index'

const FORK_LICENSE = 'AGPL-3.0-only'
const own = (basis: string) => ({ from: 'fork' as const, license: FORK_LICENSE, basis })
const BAMBU = 'Bambu Lab data sheets (ISO 527, X-Y specimens at 100 % infill); density as the app has always used'
const TYPICAL = 'typical figures from makers’ data sheets for the unfilled grade; check your supplier’s'

export const FORK: Material[] = [
  { id: 'pla', name: 'PLA', category: 'thermoplast', family: 'filament', density: 1.24, youngsMPa: 2680, poisson: 0.35, yieldMPa: 39, ultimateMPa: 39, compressiveMPa: 60, source: own(BAMBU) },
  { id: 'petg', name: 'PETG', category: 'thermoplast', family: 'filament', density: 1.27, youngsMPa: 2000, poisson: 0.38, yieldMPa: 42, ultimateMPa: 42, compressiveMPa: 55, source: own(BAMBU) },
  { id: 'abs', name: 'ABS', category: 'thermoplast', family: 'filament', density: 1.04, youngsMPa: 2000, poisson: 0.35, yieldMPa: 33, ultimateMPa: 33, compressiveMPa: 50, source: own(BAMBU) },
  { id: 'asa', name: 'ASA', category: 'thermoplast', family: 'filament', density: 1.07, youngsMPa: 1950, poisson: 0.35, yieldMPa: 35, ultimateMPa: 35, compressiveMPa: 50, source: own(BAMBU) },
  { id: 'petg-cf', name: 'PETG-CF', category: 'thermoplast', family: 'filament', kind: 'carbon-fibre filled', density: 1.3, youngsMPa: 2460, poisson: 0.34, yieldMPa: 35, ultimateMPa: 35, compressiveMPa: 50, source: own(BAMBU) },
  { id: 'pa6-cf', name: 'PA6-CF', category: 'thermoplast', family: 'filament', kind: 'carbon-fibre filled', density: 1.17, youngsMPa: 4430, poisson: 0.33, yieldMPa: 102, ultimateMPa: 102, compressiveMPa: 90, source: own(BAMBU) },
  {
    id: 'tpu-95a',
    name: 'TPU 95A',
    category: 'thermoplast',
    family: 'filament',
    kind: 'elastomer',
    density: 1.21,
    youngsMPa: 26,
    poisson: 0.45,
    ultimateMPa: 30,
    note: 'Flexible; its figures hold only near small strain.',
    source: own(BAMBU),
  },
  // Sheet and moulded plastics (acrylic is FreeCAD's: acrylic-glass-generic).
  { id: 'pc', name: 'Polycarbonate (PC)', category: 'thermoplast', family: 'sheet and moulded', density: 1.2, youngsMPa: 2400, poisson: 0.37, yieldMPa: 65, elongationPct: 100, source: own(`${TYPICAL} (e.g. Covestro Makrolon general-purpose grades)`) },
  { id: 'hdpe', name: 'HDPE', category: 'thermoplast', family: 'sheet and moulded', density: 0.95, youngsMPa: 1000, poisson: 0.42, yieldMPa: 25, source: own(`${TYPICAL}; HDPE ranges widely (modulus 0.8–1.4 GPa)`) },
  { id: 'pom', name: 'POM (acetal, Delrin)', category: 'thermoplast', family: 'sheet and moulded', kind: 'homopolymer', density: 1.42, youngsMPa: 3100, poisson: 0.35, yieldMPa: 70, source: own(`${TYPICAL} (e.g. DuPont Delrin 100); copolymer grades a little lower`) },
  // Bought parts FreeCAD has no card for.
  { id: 'brass', name: 'Brass (free-cutting, CuZn39Pb3)', category: 'metal', family: 'copper', standard: 'EN 12164 CW614N', density: 8.47, youngsMPa: 97000, poisson: 0.34, yieldMPa: 250, ultimateMPa: 430, source: own(`${TYPICAL}; drawn rod`) },
]
