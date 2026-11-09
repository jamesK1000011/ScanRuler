// SPDX-License-Identifier: AGPL-3.0-only
// The brief both servers get, word for word the same part: a Gridfinity bin
// two cells by one, four units high, magnets, one divider, a 10 mm label
// ledge; checked against a 0.8 mm least wall and 40 g, printed in PLA on a
// 0.4 mm nozzle; the stacking lip's thin top waived as the standard's.
export const BRIEF = {
  params: { x: 2, y: 1, units: 4, magnets: true, dividersX: 1, label: 10 },
  spec: { minWall: 0.8, massMax: 40 },
  material: 'pla',
  waiveReason: 'Gridfinity stacking lip: thin top edge is part of the standard',
  expect: { size: [83.5, 41.5, 32.4] },
}
