// SPDX-License-Identifier: AGPL-3.0-only
// The review's part of a project file: the design spec, under review.spec.

import type { ProjectSection } from '../../../src/app/projectSections'
import { specOf, type ReviewSpec } from '../core/spec'
import { useReview } from '../state/reviewStore'

interface SavedReview {
  version: 1
  spec: ReviewSpec
}

export const reviewSection: ProjectSection<SavedReview> = {
  key: 'review',
  collect() {
    const spec = useReview.getState().spec
    return spec ? { version: 1, spec } : undefined
  },
  prepare(value) {
    if (value === undefined) return () => useReview.getState().setSpec(null)
    const v = value as SavedReview
    if (!v || v.version !== 1) throw new Error('The review part of the project is not one this ScanRuler reads.')
    const spec = specOf(v.spec)
    if (typeof spec === 'string') throw new Error(`The project’s design spec does not read: ${spec}.`)
    return () => useReview.getState().setSpec(spec)
  },
  hasContent: () => true,
  watch(changed) {
    return useReview.subscribe((s, prev) => {
      if (s.spec !== prev.spec) changed()
    })
  },
}
