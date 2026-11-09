// SPDX-License-Identifier: AGPL-3.0-only
// The design spec kept with the project, which every review after judges
// the part against unless given another.

import { create } from 'zustand'
import type { ReviewSpec } from '../core/spec'

interface ReviewState {
  spec: ReviewSpec | null
  setSpec(spec: ReviewSpec | null): void
}

export const useReview = create<ReviewState>((set) => ({
  spec: null,
  setSpec: (spec) => set({ spec: spec && Object.keys(spec).length > 0 ? spec : null }),
}))
