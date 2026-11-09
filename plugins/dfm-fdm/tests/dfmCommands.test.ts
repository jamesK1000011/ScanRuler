// SPDX-License-Identifier: AGPL-3.0-only
// The dfm commands against a stage and app faked in dfmFakes: a part not on
// the stage told apart from a session with no viewport.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/commands/host', () => import('./dfmFakes'))
vi.mock('../../../src/commands/schema', () => import('./dfmFakes'))
vi.mock('../../../src/commands/registry', () => import('./dfmFakes'))
vi.mock('../../../src/commands/stateSections', () => import('./dfmFakes'))
vi.mock('../../../src/plugins/api', () => import('./dfmFakes'))
vi.mock('../../../src/state/store', () => import('./dfmFakes'))
vi.mock('../../../src/state/deviationStore', () => import('./dfmFakes'))
vi.mock('../../../src/state/thicknessStore', () => import('./dfmFakes'))

import { app, calls, deviation, stage } from './dfmFakes'
import { dfmCommands } from '../app/dfmCommands'
import { useDfm } from '../state/dfmStore'

type Run = (input: Record<string, unknown>, ctx: unknown) => Promise<Record<string, any>> // eslint-disable-line @typescript-eslint/no-explicit-any
const run = (name: string, input: Record<string, unknown> = {}) => (dfmCommands as unknown as { name: string; run: Run }[]).find((c) => c.name === name)!.run(input, { progress() {} })

function fresh() {
  useDfm.getState().reset()
  Object.assign(stage, { scene: true, scan: null, reference: null })
  Object.assign(app, { fileName: null, busy: false, statusText: '' })
  Object.assign(deviation, { nominalName: null, nominalBusy: false, nominalMadeFrom: null })
  calls.length = 0
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return (e as { code?: string }).code ?? 'none'
  }
  return 'ok'
}

describe('a part that is not there to check', () => {
  it('needs the page when there is no viewport, and is not on the stage otherwise', async () => {
    fresh()
    app.fileName = 'part.stl'
    stage.scene = false
    expect(await codeOf(run('check'))).toBe('unavailable')
    stage.scene = true
    expect(await codeOf(run('check'))).toBe('invalid_state')
    app.busy = true
    expect(await codeOf(run('check'))).toBe('busy')
  })
  it('the same for the reference part', async () => {
    fresh()
    useDfm.getState().set({ target: 'reference' })
    expect(await codeOf(run('check'))).toBe('invalid_state')
    deviation.nominalName = 'bracket.stl'
    stage.scene = false
    expect(await codeOf(run('check'))).toBe('unavailable')
    stage.scene = true
    expect(await codeOf(run('check'))).toBe('invalid_state')
    deviation.nominalBusy = true
    expect(await codeOf(run('check'))).toBe('busy')
  })
})
