// SPDX-License-Identifier: AGPL-3.0-only
export interface ImagePreset { name: string; url: string; thumb: string; defaultScale: number; category: string; credit?: string; source?: string }
export const IMAGE_PRESETS: readonly ImagePreset[]
export const PRESET_CATEGORIES: readonly { id: string; label: string }[]
export const DEFAULT_FAVOURITES: readonly string[]
