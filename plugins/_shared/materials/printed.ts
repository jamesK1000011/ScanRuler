// SPDX-License-Identifier: AGPL-3.0-only
// What printing does to a material: process data, not the material's. A
// printed part is transversely isotropic about the build direction —
// stiffer and stronger in its layers (xy) than across them (z) — and is
// walls round a sparse infill. These apply to a body only while it is in a
// print setup (../setups.ts); out of one, the part is its solid material
// (index.ts).
//
// Figures in MPa. Tensile from Bambu Lab's data sheets (ISO 527, 100 %
// infill, X-Y and Z specimens); compression, shear and Poisson's ratios
// typical; between-layer shear (Sz) left to the solver's estimate, 0.6 × Zt.
// The agent's server keeps the same table (mcp/src/extras/fea.js
// MATERIALS), which plugins/fea/tests/fea.test.ts holds to this one.

export interface PrintedFigures {
  Exy: number
  Ez: number
  nuXY: number
  nuZ: number
  Xt: number
  Xc: number
  Zt: number
  Zc: number
  S: number
}

export const PRINTED: Readonly<Record<string, PrintedFigures>> = {
  pla: { Exy: 2680, Ez: 2160, nuXY: 0.35, nuZ: 0.33, Xt: 39, Xc: 60, Zt: 35, Zc: 55, S: 25 },
  petg: { Exy: 2000, Ez: 1700, nuXY: 0.38, nuZ: 0.36, Xt: 42, Xc: 55, Zt: 30, Zc: 50, S: 26 },
  abs: { Exy: 2000, Ez: 1650, nuXY: 0.35, nuZ: 0.33, Xt: 33, Xc: 50, Zt: 20, Zc: 40, S: 22 },
  asa: { Exy: 1950, Ez: 1600, nuXY: 0.35, nuZ: 0.33, Xt: 35, Xc: 50, Zt: 22, Zc: 40, S: 22 },
  'petg-cf': { Exy: 2460, Ez: 1340, nuXY: 0.34, nuZ: 0.32, Xt: 35, Xc: 50, Zt: 29, Zc: 45, S: 22 },
  'pa6-cf': { Exy: 4430, Ez: 2170, nuXY: 0.33, nuZ: 0.3, Xt: 102, Xc: 90, Zt: 48, Zc: 70, S: 45 },
  'tpu-95a': { Exy: 26, Ez: 22, nuXY: 0.45, nuZ: 0.45, Xt: 30, Xc: 30, Zt: 20, Zc: 30, S: 15 },
}

/** How a part is printed when a print setup does not say: the Mass
 *  workspace's defaults. infill %, walls (perimeters), line width. */
export interface PrintFill {
  infill: number
  walls: number
  lineWidth: number
}

/** A print setup's fill, from whichever of its fields it carries — the
 *  setups framework's names, or Mass's own — over the fallback given. */
export function printFillOf(setup: Record<string, unknown> | null | undefined, fallback: PrintFill): PrintFill {
  const s = (setup ?? {}) as Record<string, unknown>
  const inner = (s.settings && typeof s.settings === 'object' ? s.settings : {}) as Record<string, unknown>
  const pick = (keys: string[], lo: number, hi: number, d: number) => {
    for (const k of keys) {
      for (const from of [s, inner]) {
        const v = from[k]
        if (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi) return v
      }
    }
    return d
  }
  return {
    infill: pick(['infill', 'infillPct'], 0, 100, fallback.infill),
    walls: Math.round(pick(['walls', 'perimeters', 'wallLoops'], 0, 50, fallback.walls)),
    lineWidth: pick(['lineWidth', 'lineMm'], 0.05, 3, fallback.lineWidth),
  }
}
