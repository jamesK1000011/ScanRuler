// SPDX-License-Identifier: AGPL-3.0-only
// A part judged for a sheet cut: is it a sheet part, of the sheet's
// thickness; its narrow webs and slots against the least feature; its round
// holes against that and against the thickness; a router's inside corners
// against its cutter; whether it fits the sheet. Findings as part.review
// reads them — severity, says, at (the part's frame) — from the flat read
// and the profile, so the tests need no kernel.

import type { FlatRead, V3 } from './flat'
import { fitOnSheet, insideCorners, narrowPlaces, otherHoles, polygonOf, roundHoles, type Profile, type Pt } from './profile'
import type { CutKind } from './rules'

export interface Finding {
  severity: 'error' | 'warning' | 'info'
  rule: string
  says: string
  at?: V3
}

export interface CutFigures {
  kind: CutKind
  /** The sheet's thickness the setup says, or null (the part's then). */
  sheetThickness: number | null
  kerf: number
  minFeature: number
  /** The router's cutter diameter, for its inside corners. */
  tool: number | null
  holePerThickness: number
  /** The sheet's size, or null for none given. */
  sheet: [number, number] | null
}

const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0

/** Thicknesses within this much (or 2 %) are the same sheet. */
export const thicknessMatches = (part: number, sheet: number) => Math.abs(part - sheet) <= Math.max(0.05, 0.02 * sheet)

export function checkCut(flat: FlatRead, profiles: readonly Profile[], f: CutFigures, toWorld: (p: Pt) => V3): Finding[] {
  const out: Finding[] = []
  const w = (p: Pt) => toWorld(p).map(r3) as V3
  if (!flat.normal || flat.thickness === null) {
    out.push({ severity: 'error', rule: 'flat', says: 'not a sheet part: no two flat faces face apart to be the sheet’s sides' })
    return out
  }
  for (const o of flat.offenders.slice(0, 6)) out.push({ severity: 'error', rule: 'flat', says: `face ${o.face}: ${o.why}`, at: o.at })
  if (flat.offenders.length > 6) out.push({ severity: 'error', rule: 'flat', says: `and ${flat.offenders.length - 6} more faces a straight cut does not make` })
  const t = flat.thickness
  if (f.sheetThickness !== null && !thicknessMatches(t, f.sheetThickness)) out.push({ severity: 'error', rule: 'thickness', says: `the part is ${t} thick; the setup’s sheet is ${f.sheetThickness}` })
  if (!profiles.length) {
    out.push({ severity: 'error', rule: 'profile', says: 'the section through the middle of the sheet found no closed outline' })
    return out
  }
  if (profiles.length > 1) out.push({ severity: 'info', rule: 'pieces', says: `${profiles.length} separate pieces in one body: each is cut free` })
  const tol = 1e-6
  for (const p of profiles) {
    for (const h of roundHoles(p)) {
      if (h.diameter < Math.max(f.kerf, f.tool ?? 0) - tol) out.push({ severity: 'error', rule: 'hole', says: `a hole of ${h.diameter} is narrower than the ${f.kind === 'router' ? 'cutter' : 'kerf'} (${f.tool ?? f.kerf}): it cannot be cut`, at: w(h.at) })
      else if (h.diameter < f.minFeature - tol) out.push({ severity: 'warning', rule: 'hole', says: `a hole of ${h.diameter} is under the least feature, ${f.minFeature}: drill it after, or open it up`, at: w(h.at) })
      else if (f.holePerThickness > 0 && h.diameter < f.holePerThickness * t - tol) out.push({ severity: 'warning', rule: 'hole-thickness', says: `a hole of ${h.diameter} in ${t} thick: under ${f.holePerThickness === 1 ? 'the thickness' : `${f.holePerThickness} × the thickness`} it comes out tapered or not round — drill or ream it to size`, at: w(h.at) })
    }
    for (const n of narrowPlaces(p, f.minFeature)) {
      const what = n.kind === 'web' ? 'material' : 'a slot or gap'
      if (n.kind === 'gap' && n.width < Math.max(f.kerf, f.tool ?? 0) - tol) out.push({ severity: 'error', rule: 'gap', says: `${what} ${n.width} across, narrower than the ${f.kind === 'router' ? 'cutter' : 'kerf'}: it cannot be cut`, at: w(n.at) })
      else if (n.kind === 'web' && n.width < f.kerf - tol) out.push({ severity: 'error', rule: 'web', says: `${what} ${n.width} across: the kerf takes it all`, at: w(n.at) })
      else out.push({ severity: 'warning', rule: n.kind, says: `${what} ${n.width} across, under the least feature ${f.minFeature}${n.kind === 'web' ? ': it warps, burns or breaks' : ''}`, at: w(n.at) })
    }
    // A hole that is no circle, too small for a pierce and a lead-in.
    for (const h of otherHoles(p)) if (h.least < Math.max(f.kerf, f.tool ?? 0) - tol) out.push({ severity: 'error', rule: 'gap', says: `a cut-out ${h.least} across is narrower than the ${f.kind === 'router' ? 'cutter' : 'kerf'}`, at: w(h.at) })
    if (f.kind === 'router' && f.tool) {
      const corners = insideCorners(p, f.tool / 2)
      const sharp = corners.filter((c) => c.radius === 0)
      const small = corners.filter((c) => c.radius > 0)
      if (sharp.length) out.push({ severity: 'warning', rule: 'inside-corner', says: `${sharp.length} sharp inside corner${sharp.length === 1 ? '' : 's'}: the cutter leaves its radius, ${r3(f.tool / 2)} — round ${sharp.length === 1 ? 'it' : 'them'} to that, or relieve with a dogbone where a square part goes in`, at: w(sharp[0].at) })
      for (const c of small.slice(0, 5)) out.push({ severity: 'warning', rule: 'inside-corner', says: `an inside round of ${c.radius}, under the cutter’s radius ${r3(f.tool / 2)}: it comes out at the cutter’s`, at: w(c.at) })
    }
    if (f.sheet) {
      const fit = fitOnSheet(polygonOf(p.outer, 0.05), f.sheet)
      if (!fit.fits) out.push({ severity: 'error', rule: 'sheet', says: `${fit.size[0]} × ${fit.size[1]} does not fit the ${f.sheet[0]} × ${f.sheet[1]} sheet, turned any way` })
      else if (fit.turnDeg !== 0) out.push({ severity: 'info', rule: 'sheet', says: `fits the sheet turned ${fit.turnDeg}°` })
    }
  }
  return out
}
