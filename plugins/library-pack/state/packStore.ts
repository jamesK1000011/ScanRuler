// SPDX-License-Identifier: AGPL-3.0-only
// library-pack's settings, upstream parts and platform presets, kept with
// the project. Files added from disk stay for the session only: the
// project keeps their names, not their bytes.

import { create } from 'zustand'
import { DEFAULT_PACK, type PackSettings, type Upstream } from '../core/plan'

export interface Preset {
  id: string
  name: string
  images: { count: number; width: number; height: number }
  folders: { models: string; images: string }
  fields: { title: number; summary: number }
  note?: string
}

export interface PackData {
  settings: PackSettings
  upstream: Upstream[]
  presets: Preset[]
}

interface PackState extends PackData {
  added: { name: string; bytes: Uint8Array }[]
  set(p: Partial<PackData & { added: { name: string; bytes: Uint8Array }[] }>): void
  replace(d: PackData): void
  reset(): void
}

const empty = (): PackData => ({ settings: { ...DEFAULT_PACK }, upstream: [], presets: [] })

export const usePack = create<PackState>((set) => ({
  ...empty(),
  added: [],
  set: (p) => set(p),
  replace: (d) => set({ ...d, added: [] }),
  reset: () => set({ ...empty(), added: [] }),
}))
