// SPDX-License-Identifier: AGPL-3.0-only
// The generators' client given a builder in this thread, as the app run
// headless gives it one (plugin.ts headless): a build answered by it, busy
// while it runs, and a stop that ends the wait at once — the answer that
// comes after let go.
import { afterEach, describe, expect, it } from 'vitest'
import { build, buildInThread, busy, stop } from '../app/genClient'
import type { GenAnswer, GenAsk } from '../core/genBuild'

const ask: Omit<GenAsk, 'id'> = { generator: 'gridfinity_bin', params: {}, out: 'info' }
const answer: GenAnswer = { parts: [{ name: 'Bin', volume: 1000, box: { min: [0, 0, 0], max: [42, 42, 21] } }] }

afterEach(() => buildInThread(null))

describe('a build in this thread', () => {
  it('is answered by the builder given', async () => {
    const asked: Omit<GenAsk, 'id'>[] = []
    buildInThread(async (a) => {
      asked.push(a)
      return answer
    })
    const pending = build(ask)
    expect(busy()).toBe(true)
    expect(await pending).toEqual(answer)
    expect(asked).toEqual([ask])
    expect(busy()).toBe(false)
  })

  it('says why it failed', async () => {
    buildInThread(async () => {
      throw new Error('No generator "x".')
    })
    await expect(build(ask)).rejects.toThrow('No generator "x".')
    expect(busy()).toBe(false)
  })

  it('is stopped at once, its late answer let go', async () => {
    let finish: (a: GenAnswer) => void = () => {}
    buildInThread(() => new Promise((done) => (finish = done)))
    const pending = build(ask)
    stop('Stopped.')
    await expect(pending).rejects.toThrow('Stopped.')
    finish(answer)
    expect(busy()).toBe(false)
  })
})
