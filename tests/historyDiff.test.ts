// SPDX-License-Identifier: AGPL-3.0-only
// history.diff: what a change did to the modelled part, against a
// checkpoint or the part before the last change that changed it — a check
// that changes nothing in between is passed over — with the review's
// checks the change moves. The part is a fake plugin's share
// (registerPartDigest).
import { describe, expect, it } from 'vitest'
import { registerCoreCommands } from '../src/commands/core'
import { diffParts, registerPartDigest, type BodyDigest, type ItemDigest, type PartDigest } from '../src/commands/partDigest'
import { registerCommands, runCommand } from '../src/commands/registry'
import { obj } from '../src/commands/schema'
import type { Command } from '../src/commands/types'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const box = (x: number) => ({ min: [0, 0, 0], max: [x, 10, 10] })
let bodies: BodyDigest[] = [{ id: 1, name: 'Grip', visible: true, volume: 1000, area: 600, faces: 6, box: box(10), stamp: 'aaaa0001' }]
let features: ItemDigest[] = [{ id: 'feature 1', name: 'Sketch 1', sig: 's1' }, { id: 'feature 2', name: 'Extrude 1', sig: 'e1' }]
let embeds: ItemDigest[] = []

registerPartDigest('fake', () => ({ bodies: bodies.map((b) => ({ ...b })), features: [...features], embeds: [...embeds] }))
registerCoreCommands()

const change = (name: string, apply: () => void): Command => ({ name, title: name, description: 'A change.', input: obj({}), run: async () => (apply(), {}) })
registerCommands('demo', [
  change('grow', () => {
    bodies = [{ ...bodies[0], volume: 1200, area: 640, box: box(12), stamp: 'aaaa0002' }]
    features = [...features.slice(0, 1), { id: 'feature 2', name: 'Extrude 1', sig: 'e2' }]
  }),
  change('look', () => {}),
  change('hole', () => {
    features = [...features, { id: 'feature 3', name: 'Hole 1', sig: 'h1' }]
    embeds = [{ id: 'encased E1', name: 'E1 (magnet 6x2 in Grip)', sig: 'm1' }]
    bodies = [{ ...bodies[0], volume: 1150, faces: 9, stamp: 'aaaa0003' }]
  }),
] as Command<never>[])

async function refused(name: string, input: Json): Promise<string> {
  try {
    await runCommand(name, input)
  } catch (e) {
    return (e as { code: string }).code
  }
  return 'ran'
}

describe('history.diff', () => {
  it('says what the last change that changed the part did, past a change that did nothing', async () => {
    await runCommand('demo.grow')
    await runCommand('demo.look')
    const d = (await runCommand('history.diff')) as Json
    expect(d.since.change).toBe('demo.grow')
    expect(d.changed).toBe(true)
    expect(d.bodies.changed).toEqual([{ id: 1, name: 'Grip', stamp: ['aaaa0001', 'aaaa0002'], volume: 200, area: 40, size: [2, 0, 0] }])
    expect(d.features).toEqual({ added: [], removed: [], edited: ['Extrude 1'] })
    expect(d.recheck).toEqual(['reverse.body.check', 'reverse.body.clearance', 'dfm.check', 'mass.properties', 'fea.results'])
  })

  it('against a checkpoint, counts every change since, encased parts with them', async () => {
    const mark = (await runCommand('history.checkpoint')) as { checkpoint: string }
    await runCommand('demo.hole')
    const d = (await runCommand('history.diff', { since: mark.checkpoint })) as Json
    expect(d.since.checkpoint).toBe(mark.checkpoint)
    expect(d.features.added).toEqual(['Hole 1'])
    expect(d.embeds.added).toEqual(['E1 (magnet 6x2 in Grip)'])
    expect(d.bodies.changed[0].faces).toBe(3)
    expect(d.bodies.changed[0].volume).toBe(-50)
    expect(d.recheck).toContain('hw.pauses')
  })

  it('refuses a checkpoint it never gave', async () => {
    expect(await refused('history.diff', { since: 'cp999999' })).toBe('not_found')
  })
})

describe('the difference itself', () => {
  const part = (b: BodyDigest[], f: ItemDigest[] = [], e: ItemDigest[] = []): PartDigest => ({ bodies: b, features: f, embeds: e })
  const grip: BodyDigest = { id: 1, name: 'Grip', visible: true, volume: 10, area: 20, faces: 6, box: box(10), stamp: 'a' }

  it('is empty, and moves no check, when nothing changed', () => {
    const d = diffParts(part([grip]), part([{ ...grip }]))
    expect(d.changed).toBe(false)
    expect(d.recheck).toEqual([])
  })

  it('names bodies added and removed, and a body only hidden moves only the clearance', () => {
    const lid: BodyDigest = { ...grip, id: 2, name: 'Lid' }
    const d = diffParts(part([grip, lid]), part([{ ...grip, visible: false }, { ...grip, id: 3, name: 'Cap' }]))
    expect(d.bodies.added).toEqual(['Cap'])
    expect(d.bodies.removed).toEqual(['Lid'])
    expect(d.bodies.changed).toEqual([{ id: 1, name: 'Grip', shown: false }])
    const hidden = diffParts(part([grip]), part([{ ...grip, visible: false }]))
    expect(hidden.recheck).toEqual(['reverse.body.clearance'])
  })

  it('tells a body moved from one resized', () => {
    const d = diffParts(part([grip]), part([{ ...grip, box: { min: [0, 0, 5], max: [10, 10, 15] } }]))
    expect(d.bodies.changed[0]).toEqual({ id: 1, name: 'Grip', moved: [0, 0, 5] })
  })

  it('a feature renamed in place is edited, not added', () => {
    const d = diffParts(part([grip], [{ id: 'f1', name: 'A', sig: '1' }]), part([grip], [{ id: 'f1', name: 'B', sig: '2' }]))
    expect(d.features).toEqual({ added: [], removed: [], edited: ['B'] })
    expect(d.recheck).toEqual([])
  })
})
