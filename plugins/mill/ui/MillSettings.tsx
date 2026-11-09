// SPDX-License-Identifier: AGPL-3.0-only
// A mill setup's settings on the Make tab: the machine's axes, the tool
// directions, the stock margin, the least tool, the reach and the IT grade.
// Each left empty takes the default. Every change runs setup.set.

import type { Setup } from '../../_shared/setups'
import { changeSetup, SetupChoice, SetupFigure } from '../../_shared/ui/SetupFields'

const WAYS = ['+z', '-z', '+x', '-x', '+y', '-y'] as const
const WAY_WORDS: Record<string, string> = { '+z': 'From above', '-z': 'From below', '+x': 'From +x', '-x': 'From −x', '+y': 'From +y', '-y': 'From −y' }
const GRADES = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((g) => [String(g), `IT${g}`] as const)

export function MillSettings({ setup }: { setup: Setup }) {
  const set = (k: string) => (v: unknown) => changeSetup(setup, { [k]: v })
  const dirs = Array.isArray(setup.directions) ? (setup.directions as unknown[]) : ['+z']
  const toggle = (w: string) => {
    const on = dirs.includes(w)
    const next = on ? dirs.filter((d) => d !== w) : [...dirs, w]
    changeSetup(setup, { directions: next.length ? next : null })
  }
  return (
    <div className="setup-settings" data-test="mill-setup-settings">
      <SetupChoice label="Machine" title="3 axis, or 3+2 indexed" value={setup.axes} options={[['3', '3 axis'], ['3+2', '3+2 axis']]} empty="3 axis" onChange={set('axes')} />
      <div className="field" title="Where the tool comes from; each a setup on 3 axis">
        <span>Tool from</span>
        <span className="toolrow">
          {WAYS.map((w) => (
            <button key={w} className={dirs.includes(w) ? 'on' : undefined} title={WAY_WORDS[w]} onClick={() => toggle(w)}>
              {w}
            </button>
          ))}
        </span>
      </div>
      <SetupFigure label="Stock margin" title="Stock round the part, each side" value={setup.margin} length step={1} onCommit={set('margin')} />
      <SetupFigure label="Least tool" title="The smallest end mill’s diameter" value={setup.minTool} length step={0.5} onCommit={set('minTool')} />
      <SetupFigure label="Reach" title="How deep the longest tool reaches" value={setup.reach} length step={5} onCommit={set('reach')} />
      <SetupChoice label="Sizes hold" title="The ISO tolerance grade, for Fits" value={Number.isInteger(setup.grade) ? String(setup.grade) : undefined} options={GRADES} empty="IT8" onChange={(v) => changeSetup(setup, { grade: v === null ? null : Number(v) })} />
    </div>
  )
}
