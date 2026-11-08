// SPDX-License-Identifier: AGPL-3.0-only
// A change that runs another change: within it, at once, not queued behind
// itself (which would wait until the command timeout).
import { afterEach, expect, it } from 'vitest'
import { registerCommands, runCommand, runWithin } from '../src/commands/registry'
import { obj } from '../src/commands/schema'
import type { Command } from '../src/commands/types'

let inner = 0
const innerCmd: Command = { name: 'inner', title: 'Inner', description: 'A change.', input: obj({}), run: async () => ({ n: ++inner }) }
const outerCmd: Command = {
  name: 'outer',
  title: 'Outer',
  description: 'A change that runs another.',
  input: obj({}),
  run: async () => ({ inner: await runWithin('nest.inner', {}) }),
}
const off = registerCommands('nest', [innerCmd, outerCmd] as Command<never>[])
afterEach(() => (inner = 0))

it('a change runs another within it, without waiting on itself', async () => {
  const r = await Promise.race([runCommand('nest.outer', {}), new Promise((_, no) => setTimeout(() => no(new Error('hung')), 2000))])
  expect(r).toEqual({ inner: { n: 1 } })
})

it('outside a change it is refused, not run', async () => {
  await expect(runWithin('nest.inner', {})).rejects.toThrow(/within a change/)
  off()
})
