// SPDX-License-Identifier: AGPL-3.0-only
import type { RGBAImage } from './index'
export const PRESET_SIZE: number
export const CUSTOM_SIZE: number
export function fitDimensions(w: number, h: number, maxSize: number): { w: number; h: number }
export function fitImage(img: RGBAImage, maxSize: number): RGBAImage
export function prepareMap(img: RGBAImage, opts?: { textureSmoothing?: number; invertTexture?: boolean }): RGBAImage
