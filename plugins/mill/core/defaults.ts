// SPDX-License-Identifier: AGPL-3.0-only
// A mill setup's figures where it leaves them unset: one 3-axis setup cut
// from above, 2 of stock round the part, a 3 end mill reaching 30, sizes
// to IT8 — a common job on a hobby or small-shop mill.

export const AXES = ['3', '3+2'] as const

export const MILL_DEFAULTS = { axes: '3', directions: ['+z'], margin: 2, minTool: 3, reach: 30, grade: 8 } as const
