// SPDX-License-Identifier: AGPL-3.0-only
// A cut setup's settings on the Make tab: the machine, the sheet's
// thickness and size, the kerf, the least feature, and whether the file's
// path is compensated. Each left empty takes the machine's and material's
// figure. Every change runs setup.set.

import { useLength } from '../../../src/app/useUnits'
import type { Setup } from '../../_shared/setups'
import { changeSetup, SetupChoice, SetupFigure, SetupSwitch } from '../../_shared/ui/SetupFields'

export const KIND_WORDS = [
  ['laser', 'Laser'],
  ['waterjet', 'Waterjet'],
  ['plasma', 'Plasma'],
  ['router', 'Router'],
] as const

export function CutSettings({ setup }: { setup: Setup }) {
  const len = useLength()
  const set = (k: string) => (v: unknown) => changeSetup(setup, { [k]: v })
  const sheet = Array.isArray(setup.sheet) ? (setup.sheet as number[]) : null
  const setSheet = (i: 0 | 1) => (v: number | null) => {
    if (v === null) return changeSetup(setup, { sheet: null })
    const next = [sheet?.[0] ?? v, sheet?.[1] ?? v]
    next[i] = v
    changeSetup(setup, { sheet: next })
  }
  const router = setup.machine === 'router'
  return (
    <div className="setup-settings" data-test="cut-setup-settings">
      <SetupChoice label="Machine" title="What cuts the sheet" value={setup.machine} options={KIND_WORDS} empty="Laser" onChange={set('machine')} />
      <SetupFigure label="Sheet" title="The sheet’s thickness; the part’s when empty" value={setup.thickness} length step={0.5} onCommit={set('thickness')} />
      <SetupFigure label={router ? 'Cutter' : 'Kerf'} title={router ? 'The cutter’s diameter' : 'The width the cut takes out'} value={setup.kerf} length step={0.05} onCommit={set('kerf')} />
      <SetupFigure label="Least feature" title="The narrowest web, slot or hole wanted" value={setup.minFeature} length step={0.5} onCommit={set('minFeature')} />
      <SetupFigure label="Sheet width" title={`The sheet’s width${sheet ? `: ${len.fmt(sheet[0], 0)}` : ''}`} value={sheet?.[0]} length step={10} placeholder="None" onCommit={setSheet(0)} />
      <SetupFigure label="Sheet height" title="The sheet’s height" value={sheet?.[1]} length step={10} placeholder="None" onCommit={setSheet(1)} />
      <SetupSwitch label="Compensate the kerf" title="Move the path half a kerf off the part" value={setup.compensate} onChange={set('compensate')} />
    </div>
  )
}
