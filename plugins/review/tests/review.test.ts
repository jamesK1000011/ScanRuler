// SPDX-License-Identifier: AGPL-3.0-only
// part.review against the other workspaces' commands faked by name: a part
// that passes, one with an error to fix, a spec it is judged by (given, or
// kept with part.spec and the project), a limit nothing could judge, a
// check not in the build, one that needs the page, one that fails, an
// answer kept small — and the printing checks judging a printed part,
// informing on one whose process is not said, skipped for any other.
import { describe, expect, it } from 'vitest'
import { registerCommands, runCommand } from '../../../src/commands/registry'
import { registerStateSection } from '../../../src/commands/stateSections'
import { CommandError, type Command } from '../../../src/commands/types'
import { reviewSection } from '../app/projectSection'
import { reviewCommands } from '../app/reviewCommands'
import { massBounds, processOf, specOf, verdictOf } from '../core/spec'
import { useReview } from '../state/reviewStore'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

registerCommands('part', reviewCommands)

const bodies = [
  { id: 1, name: 'Grip', visible: true },
  { id: 2, name: 'Case', visible: true },
  { id: 3, name: 'Skin', visible: true, surface: true },
]
registerStateSection('reverse', () => ({ bodies }))
let calibration: Json | undefined
registerStateSection('fits', () => (calibration ? { calibration } : {}))

/** What each faked command answers, set per test; a function throws. */
const answers: Record<string, Json | (() => never)> = {}
const asked: Record<string, Json> = {}
const offs: Record<string, () => void> = {}
function fake(full: string, headless = true) {
  const [ns, ...rest] = full.split('.')
  const command: Command = {
    name: rest.join('.'),
    title: full,
    description: 'A fake.',
    input: { type: 'object' },
    readOnly: true,
    headless,
    run: async (input) => {
      asked[full] = input
      const a = answers[full]
      return typeof a === 'function' ? a() : a
    },
  }
  offs[full] = registerCommands(ns, [command] as Command<never>[])
}
const NAMES = ['reverse.body.check', 'reverse.body.clearance', 'dfm.check', 'mass.properties', 'hw.pauses', 'fea.results']
for (const n of NAMES) fake(n)

function good() {
  answers['reverse.body.check'] = { bodies: [{ id: 1, name: 'Grip', ok: true, valid: true, closed: true, volume: 48000.04 }] }
  answers['reverse.body.clearance'] = { against: [{ id: 2, name: 'Case', gap: 0.412, verdict: 'pass' }], pass: true }
  answers['dfm.check'] = { verdict: 'no findings', errors: 0, warnings: 0, wall: { least: 1.6, at: [1, 2, 3], limit: 0.8 }, findings: [] }
  answers['mass.properties'] = { total: { mass: 41.25 }, bodies: [{ body: 'Grip', closed: true }] }
  answers['hw.pauses'] = { pauses: [{ layer: 12 }] }
  answers['fea.results'] = { current: true, setup: { body: 'Grip' }, worst: { safety: 3.1, at: [0, 0, 1] }, target: 2 }
  useReview.getState().setSpec(null)
  calibration = undefined
}
/** A review of Grip, printed unless the test says otherwise. */
const review = (input: Json = {}) => runCommand('part.review', { body: 'Grip', process: 'fdm', ...input }) as Promise<Json>

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return (e as { code: string }).code
  }
  return 'ran'
}

describe('part.review', () => {
  it('passes a printed part every check passes', async () => {
    good()
    calibration = { hole: 0.3, shaft: 0.1, source: 'measured', at: '2026-11-08', profile: 'PETG' }
    const r = await review()
    expect(r.body).toBe('Grip')
    expect(r.process).toBe('printed')
    expect(r.verdict).toBe('pass')
    expect(r.findings).toEqual([])
    expect(r.figures).toEqual({ volume: 48000, gap: 0.41, wall: 1.6, mass: 41.3, safety: 3.1 })
    expect(Object.values(r.checks)).toEqual(['ran', 'ran', 'ran', 'ran'])
    expect(r.printing.checks).toEqual({ 'dfm.check': 'ran', 'hw.pauses': 'ran' })
    expect(r.printing.figures).toEqual({ pauses: 1 })
    expect(r.printing.printerFit).toMatch(/2026-11-08/)
    expect(asked['dfm.check']).toEqual({ body: 1 })
    expect(asked['reverse.body.clearance'].against).toEqual([2])
  })

  it('asks which body when more than one solid is shown and none is named', async () => {
    good()
    expect(await refusal(runCommand('part.review', {}))).toBe('invalid_input')
    expect(await refusal(review({ body: 'Skin' }))).toBe('invalid_input')
    expect(await refusal(review({ body: 'Nope' }))).toBe('not_found')
    bodies[1].visible = false
    const alone = (await runCommand('part.review', {})) as Json
    expect(alone.body).toBe('Grip')
    expect(alone.checks['reverse.body.clearance']).toBe('skipped: no other body shown')
    bodies[1].visible = true
  })

  it('says fix, worst first, with the command each finding is from', async () => {
    good()
    answers['reverse.body.clearance'] = { against: [{ id: 2, name: 'Case', gap: 0, overlap: 12.5, verdict: 'fail', why: 'overlap' }], pass: false }
    answers['dfm.check'] = {
      wall: { least: 0.6, at: [5.04, 0, 2], limit: 0.8 },
      findings: [
        { id: 'F1', rule: 'thin-wall', severity: 'error', value: 0.6, limit: 0.8, unit: 'mm', at: [5.04, 0, 2], says: 'Thicken it.' },
        { id: 'F2', rule: 'bridge', severity: 'warning', value: 14, limit: 10, unit: 'mm', at: [0, 0, 9], says: 'Shorten it.' },
        { id: 'F3', rule: 'overhang', severity: 'warning', value: 50, limit: 45, unit: '°', at: [0, 0, 4], waived: 'support planned' },
      ],
    }
    answers['hw.pauses'] = { pauses: [], warnings: ['E1: roof 0.4, under the 0.6 asked for.'] }
    const r = await review()
    expect(r.verdict).toBe('fix')
    expect(r.findings.map((f: Json) => [f.source, f.severity])).toEqual([
      ['reverse.body.clearance', 'error'],
      ['dfm.check', 'error'],
      ['dfm.check', 'warning'],
      ['hw.pauses', 'warning'],
    ])
    expect(r.findings[1].at).toEqual([5, 0, 2])
    expect(r.findings[0].says).toMatch(/Case/)
  })

  it('with the process not said, the printing checks inform and do not move the verdict', async () => {
    good()
    answers['dfm.check'] = { wall: { least: 0.6, limit: 0.8 }, findings: [{ id: 'F1', rule: 'thin-wall', severity: 'error', value: 0.6, limit: 0.8, unit: 'mm', at: [1, 1, 1] }] }
    const r = await review({ process: undefined })
    expect(r.process).toBe('unknown')
    expect(r.verdict).toBe('pass')
    expect(r.findings).toEqual([])
    expect(r.ifPrinted.findings.map((f: Json) => f.source)).toEqual(['dfm.check'])
    expect(r.ifPrinted.checks['dfm.check']).toBe('ran')
    expect(r.ifPrinted.printerFit).toMatch(/typical printer/)
    expect(r.printing).toBe(undefined)
    // The wall is the part's however it is made: a spec's least wall still judges it.
    expect((await review({ process: undefined, spec: { minWall: 1 } })).verdict).toBe('fix')
  })

  it('a part made another way skips the printing checks, and says so', async () => {
    good()
    answers['dfm.check'] = () => {
      throw new Error('not to be run')
    }
    const r = await review({ process: 'laser-cut' })
    expect(r.process).toBe('laser-cut')
    expect(r.verdict).toBe('pass')
    expect(r.printing).toEqual({ checks: { 'dfm.check': 'skipped: not printed', 'hw.pauses': 'skipped: not printed' } })
    expect(/printer/.test(JSON.stringify(r))).toBe(false)
    const walled = await review({ process: 'laser-cut', spec: { minWall: 1 } })
    expect(walled.verdict).toBe('unknown')
    expect(walled.unjudged[0]).toMatch(/laser-cut/)
  })

  it('takes the process kept for the body in the spec, and one given over it', async () => {
    good()
    await runCommand('part.spec', { spec: { processes: { Grip: 'machined', Case: 'fdm' } } })
    expect((await runCommand('part.review', { body: 'Grip' })) as Json).toMatchObject({ process: 'machined' })
    expect((await review({ process: 'print' })).process).toBe('printed')
    await runCommand('part.spec', { spec: { processes: { Grip: '' } } })
    expect(useReview.getState().spec).toEqual({ processes: { Case: 'fdm' } })
    expect(((await runCommand('part.review', { body: 'Grip' })) as Json).process).toBe('unknown')
    await runCommand('part.spec', { clear: true })
  })

  it('judges the spec given, over the one kept with the project', async () => {
    good()
    await runCommand('part.spec', { spec: { massTarget: 50, massTol: 2, minWall: 1.2 } })
    const kept = await review()
    expect(kept.verdict).toBe('fix')
    expect(kept.spec.from).toBe('project')
    expect(kept.findings[0].says).toMatch(/48 to 52 g/)
    const given = await review({ spec: { massTarget: 41, massTol: 1 } })
    expect(given.verdict).toBe('pass')
    expect(given.spec.minWall).toBe(1.2)
    expect(given.spec.from).toBe('given over the project’s')
    expect((await runCommand('part.spec', { clear: true })) as Json).toEqual({ spec: null })
  })

  it('a limit nothing could judge leaves it unknown, never pass', async () => {
    good()
    answers['fea.results'] = () => {
      throw new CommandError('not_found', 'Nothing has been solved yet: fea.solve.')
    }
    const r = await review({ spec: { minSafety: 2 } })
    expect(r.checks['fea.results']).toBe('skipped: nothing solved')
    expect(r.verdict).toBe('unknown')
    expect(r.unjudged).toEqual(['minSafety: nothing solved'])
  })

  it('passes over a stale solve, and one of another body', async () => {
    good()
    answers['fea.results'] = { current: false, stale: 'the body changed since', setup: { body: 'Grip' }, worst: { safety: 0.5 }, target: 2 }
    const stale = await review()
    expect(stale.verdict).toBe('pass')
    expect(stale.checks['fea.results']).toMatch(/^skipped: stale/)
    answers['fea.results'] = { current: true, setup: { body: 'Case' }, worst: { safety: 0.5 }, target: 2 }
    expect((await review()).checks['fea.results']).toBe('skipped: solved for Case')
  })

  it('says which checks are not in the build, need the page, or failed', async () => {
    good()
    offs['hw.pauses']()
    offs['mass.properties']()
    fake('mass.properties', false)
    answers['dfm.check'] = () => {
      throw new CommandError('failed', 'Case gave no mesh.')
    }
    const r = await review()
    expect(r.printing.checks['hw.pauses']).toBe('skipped: not in build')
    expect(r.checks['mass.properties']).toBe('skipped: page only')
    expect(r.printing.checks['dfm.check']).toBe('failed: Case gave no mesh.')
    expect(r.verdict).toBe('unknown')
    offs['mass.properties']()
    fake('mass.properties')
    fake('hw.pauses')
  })

  it('keeps its answer small', async () => {
    good()
    answers['dfm.check'] = { wall: { least: 0.5 }, findings: Array.from({ length: 30 }, (_, i) => ({ id: `F${i + 1}`, rule: 'overhang', severity: 'warning', value: 60, limit: 45, unit: '°', at: [i, 0, 0], says: 'Add support or turn the part so this face is not facing down at such a steep angle.' })) }
    const r = await review({ spec: { minWall: 0.8 } })
    expect(r.findings).toHaveLength(8)
    expect(r.more).toBe(23)
    expect(JSON.stringify(r).length).toBeLessThan(3000)
  })
})

describe('the spec', () => {
  it('takes numbers it knows and refuses the rest', () => {
    expect(specOf({ minWall: 1, processes: { Grip: ' fdm ', Lid: '' } })).toEqual({ minWall: 1, processes: { Grip: 'fdm' } })
    expect(specOf({ wall: 1 })).toMatch(/not part of a spec/)
    expect(specOf({ pauses: 2 })).toMatch(/not part of a spec/)
    expect(specOf({ maxOverhang: 45 })).toMatch(/not part of a spec/)
    expect(specOf({ processes: { Grip: 3 } })).toMatch(/processes.Grip/)
    expect(specOf({ massMin: 5, massMax: 4 })).toMatch(/over/)
    expect(specOf({ massTol: 1 })).toMatch(/massTarget/)
  })

  it('reads fdm and print as printed, nothing said as unknown, any other word as another process', () => {
    expect(processOf('FDM')).toEqual({ kind: 'printed' })
    expect(processOf('print')).toEqual({ kind: 'printed' })
    expect(processOf(undefined)).toEqual({ kind: 'unknown' })
    expect(processOf('')).toEqual({ kind: 'unknown' })
    expect(processOf('CNC machined')).toEqual({ kind: 'other', as: 'CNC machined' })
  })

  it('holds a target without its tolerance to ±5 %', () => {
    expect(massBounds({ massTarget: 100 })).toEqual({ min: 95, max: 105 })
    expect(massBounds({ massMin: 10 })).toEqual({ min: 10, max: Infinity })
    expect(massBounds({})).toBe(null)
  })

  it('comes to fix on an error, unknown on a gap, pass otherwise', () => {
    expect(verdictOf([{ source: 'x', severity: 'error', says: '' }], [], [])).toBe('fix')
    expect(verdictOf([{ source: 'x', severity: 'warning', says: '' }], ['dfm.check'], [])).toBe('unknown')
    expect(verdictOf([], [], [])).toBe('pass')
  })

  it('is kept with the project, and a malformed one refused', () => {
    useReview.getState().setSpec({ minWall: 1.2 })
    const saved = reviewSection.collect({} as never)
    expect(saved).toEqual({ version: 1, spec: { minWall: 1.2 } })
    useReview.getState().setSpec(null)
    expect(reviewSection.collect({} as never)).toBe(undefined)
    reviewSection.prepare(saved, {} as never)()
    expect(useReview.getState().spec).toEqual({ minWall: 1.2 })
    let refused = ''
    try {
      reviewSection.prepare({ version: 1, spec: { minWall: -1 } }, {} as never)
    } catch (e) {
      refused = (e as Error).message
    }
    expect(refused).toMatch(/does not read/)
    reviewSection.prepare(undefined, {} as never)()
    expect(useReview.getState().spec).toBe(null)
  })
})
