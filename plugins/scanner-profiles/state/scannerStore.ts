// SPDX-License-Identifier: AGPL-3.0-only
// Scanner noise: your scanner profiles, kept in this browser across
// projects, the one this project uses, and this scan's noise as the scan
// check read it, both kept with the project.

import { create } from 'zustand'
import { planNoise, type ScanNoise } from '../../_shared/scanNoise'

export interface ScannerProfile {
  name: string
  /** One standard deviation of its surface noise, mm. */
  noiseMm: number
  /** Typical point spacing, mm. */
  spacingMm?: number
  note?: string
}

const KEY = 'scanruler.scanner-profiles'

function load(): ScannerProfile[] {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

function save(p: ScannerProfile[]) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(p))
  } catch {
    return
  }
}

interface ScannerState {
  profiles: ScannerProfile[]
  /** The project's: a profile by value (so a project opens the same
   *  elsewhere), or null for noise measured from the scan. */
  using: ScannerProfile | null
  measured: { sigmaMm: number; spacingMm: number; at: string } | null
  add(p: ScannerProfile): void
  remove(name: string): boolean
  use(p: ScannerProfile | null): void
  setMeasured(m: ScannerState['measured']): void
  replace(using: ScannerProfile | null, measured: ScannerState['measured']): void
}

export const useScanner = create<ScannerState>((set, get) => ({
  profiles: load(),
  using: null,
  measured: null,
  add: (p) => {
    const profiles = [...get().profiles.filter((x) => x.name !== p.name), p]
    save(profiles)
    set({ profiles })
  },
  remove: (name) => {
    const before = get().profiles.length
    const profiles = get().profiles.filter((x) => x.name !== name)
    save(profiles)
    set({ profiles })
    return profiles.length < before
  },
  use: (using) => set({ using }),
  setMeasured: (measured) => set({ measured }),
  replace: (using, measured) => set({ using, measured }),
}))

/** The noise to plan with — the larger of the profile's and this scan's
 *  (plugins/_shared/scanNoise.ts has the rule). */
export function noiseNow(): ScanNoise | null {
  const s = useScanner.getState()
  return planNoise(s.using, s.measured)
}
