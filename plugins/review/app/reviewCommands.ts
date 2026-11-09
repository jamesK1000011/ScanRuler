// SPDX-License-Identifier: AGPL-3.0-only
// part.review: is this part done? The checks the other workspaces carry —
// the body's validity, its clearance to the other bodies shown, its
// printability, its mass, the pauses for parts encased in it, the last
// strength solve — run here by name through the command registry, never
// imported, so a build without any of them stands and says which it lacks.
// One small verdict; the details are a call away in each command.
// part.spec keeps a design spec with the project for the reviews after.

import { sceneOf } from '../../../src/commands/host'
import { listCommands, runCommand, runsHeadless } from '../../../src/commands/registry'
import { bool, int, num, obj, oneOf, str } from '../../../src/commands/schema'
import { readStateSection } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { readPrinterFit } from '../../_shared/readPrinterFit'
import { line, massBounds, r1, r2, specOf, verdictOf, worstFirst, type Finding, type ReviewSpec, type Severity } from '../core/spec'
import { useReview } from '../state/reviewStore'

type Json = Record<string, unknown>

/** How many findings a review names; the rest are counted. */
const FINDINGS = 8

/** The checks that must have run for a part to pass. */
const MUST_RUN = ['reverse.body.check', 'dfm.check']

// units-ok: the command's schema, for the agent — in millimetres always.
const specSchema = obj(
  {
    minWall: num('The least wall, mm.', { minimum: 0 }),
    minClearance: num('The least gap to every other body shown, mm.', { minimum: 0 }),
    massMin: num('g.', { minimum: 0 }),
    massMax: num('g.', { minimum: 0 }),
    massTarget: num('g; with massTol, ± g (5 % by default).', { minimum: 0 }),
    massTol: num('± g about massTarget.', { minimum: 0 }),
    minSafety: num('The least safety factor of the last strength solve.', { minimum: 0 }),
    maxOverhang: num('The steepest overhang, degrees, as the printability rules read it.', { minimum: 0, maximum: 90 }),
    pauses: int('How many pauses the print takes for parts encased.', { minimum: 0 }),
  },
  [],
  'What the part is judged against; each key optional.',
)

interface Body {
  id: number
  name: string
  visible?: boolean
  surface?: boolean
}

function bodies(): Body[] {
  const r = readStateSection('reverse') as { bodies?: Body[] } | undefined
  if (!r) throw new CommandError('unavailable', 'part.review reviews a Reverse Engineer body, and this build has none.')
  return r.bodies ?? []
}

function pick(all: Body[], ref: string | number | undefined): Body {
  const solids = all.filter((b) => !b.surface)
  if (ref !== undefined) {
    const b = all.find((x) => x.id === ref || x.name === ref || x.name.toLowerCase() === String(ref).toLowerCase())
    if (!b) throw new CommandError('not_found', `No body "${ref}" — there are ${solids.map((x) => x.name).join(', ') || 'none'}.`)
    if (b.surface) throw new CommandError('invalid_input', `${b.name} is a surface, not a part.`)
    return b
  }
  if (solids.length === 0) throw new CommandError('invalid_state', 'There is no solid body to review — build one first.')
  const shown = solids.filter((b) => b.visible !== false)
  if (shown.length === 1) return shown[0]
  if (solids.length === 1) return solids[0]
  throw new CommandError('invalid_input', `Say which body to review (body): ${(shown.length ? shown : solids).map((b) => b.name).join(', ')}.`)
}

const at = (p: unknown): number[] | undefined => (Array.isArray(p) && p.every((x) => typeof x === 'number') ? p.map((x) => r1(x as number)) : undefined)

/** A review's run of the checks: each one's status, and its answer. */
class Run {
  readonly checks: Record<string, string> = {}
  readonly findings: Finding[] = []
  readonly unjudged: string[] = []
  private readonly have = new Set(listCommands().map((c) => c.name))

  async call<T = Json>(name: string, input: Json, notFound?: string): Promise<T | null> {
    if (!this.have.has(name)) {
      this.checks[name] = 'skipped: not in build'
      return null
    }
    // With no page (the app run headless) a command not marked to run so
    // needs one; run here it would not be refused, so it is passed over.
    if (!runsHeadless(name) && sceneOf() === null) {
      this.checks[name] = 'skipped: page only'
      return null
    }
    try {
      const out = (await runCommand(name, input)) as T
      this.checks[name] = 'ran'
      return out
    } catch (e) {
      const code = (e as { code?: string }).code
      const message = e instanceof Error ? e.message : String(e)
      this.checks[name] = code === 'unavailable' ? 'skipped: page only' : code === 'not_found' && notFound ? `skipped: ${notFound}` : `failed: ${line(message, 120)}`
      return null
    }
  }

  find(source: string, severity: Severity, says: string, where?: number[] | string): void {
    this.findings.push({ source, severity, says: line(says), ...(where !== undefined ? { at: where } : {}) })
  }
}

interface ReviewIn {
  body?: string | number
  spec?: Json
}

const review: Command<ReviewIn> = {
  name: 'review',
  title: 'Is the part done?',
  // units-ok: the command's description, for the agent — in millimetres always.
  description:
    'One verdict on a Reverse Engineer body — the one solid body shown by default — from the checks this build has: reverse.body.check (valid, closed), reverse.body.clearance (against every other body shown; minClearance as the least gap), dfm.check on the body (printability, CAD walls included), mass.properties (encased parts included), hw.pauses (pauses for encased parts, with their pocket warnings) and fea.results (the last strength solve, when it is of this body and still holds). Answers verdict — pass, fix (an error to put right) or unknown (a check that must run did not, or part of the spec could not be judged: unjudged says which); findings, worst first (source: the command, severity, says, at); figures (volume mm³, mass g, wall mm, gap mm, safety, pauses); checks: each command ran, skipped (not in build, page only, or why) or failed (why); the spec judged against and printerFit, the printer calibration in use. spec: a design spec for this review, over the one part.spec keeps with the project. Each command gives its details when run alone. Changes nothing.',
  input: obj({
    body: oneOf([str(undefined, { minLength: 1 }), num()], 'The body, by name or id; the one solid body shown by default.'),
    spec: specSchema,
  }),
  readOnly: true,
  long: true,
  headless: true,
  timeoutMs: 15 * 60_000,
  run: async ({ body: ref, spec: given }) => {
    let spec: ReviewSpec = { ...(useReview.getState().spec ?? {}) }
    if (given !== undefined) {
      const s = specOf(given)
      if (typeof s === 'string') throw new CommandError('invalid_input', `spec: ${s}.`)
      spec = { ...spec, ...s }
    }
    const all = bodies()
    const b = pick(all, ref)
    const run = new Run()
    const figures: Json = {}

    // Valid and closed.
    const checked = await run.call<{ bodies?: Json[]; failed?: { name: string }[] }>('reverse.body.check', { body: b.id, audit: false })
    const c = checked?.bodies?.[0]
    if (c) {
      if (typeof c.volume === 'number') figures.volume = r1(c.volume)
      for (const p of ((c.problems as string[] | undefined) ?? []).slice(0, 3)) run.find('reverse.body.check', 'error', p)
      for (const w of ((c.warnings as string[] | undefined) ?? []).slice(0, 2)) run.find('reverse.body.check', 'warning', w)
    }
    for (const f of checked?.failed ?? []) run.find('reverse.body.check', 'warning', `${f.name} failed to build: it is missing from the body.`)

    // Clear of the other bodies shown.
    const others = all.filter((x) => x.id !== b.id && !x.surface && x.visible !== false)
    if (others.length === 0) {
      run.checks['reverse.body.clearance'] = 'skipped: no other body shown'
      if (spec.minClearance !== undefined) run.unjudged.push('minClearance: no other body shown')
    } else {
      const cl = await run.call<{ against?: { name: string; gap: number; overlap?: number; verdict: string; why?: string }[] }>('reverse.body.clearance', { body: b.id, against: others.map((x) => x.id), ...(spec.minClearance !== undefined ? { min: spec.minClearance } : {}) })
      const rows = cl?.against ?? []
      if (rows.length) figures.gap = r2(Math.min(...rows.map((r) => r.gap)))
      for (const r of rows.filter((x) => x.verdict === 'fail')) {
        run.find('reverse.body.clearance', 'error', r.overlap ? `Runs into ${r.name}: ${r2(r.overlap)} mm³ shared.` : `${r2(r.gap)} mm gap to ${r.name}, under the ${spec.minClearance} asked for.`, r.name)
      }
      if (!cl && spec.minClearance !== undefined) run.unjudged.push('minClearance: the clearance did not run')
    }

    // Printable.
    const dfm = await run.call<Json>('dfm.check', { body: b.id })
    if (dfm) {
      const wall = dfm.wall as { least?: number | null; at?: number[] } | undefined
      if (typeof wall?.least === 'number') figures.wall = r2(wall.least)
      const skipped = ((dfm.skipped as { rule: string }[] | undefined) ?? []).map((x) => x.rule)
      for (const f of (dfm.findings as Json[] | undefined) ?? []) {
        if (f.waived) continue
        let severity = f.severity as Severity
        let says = `${f.id} ${f.rule}: ${f.value} ${f.unit ?? ''} against ${f.limit}${typeof f.says === 'string' ? ` — ${f.says}` : ''}`
        if (f.rule === 'overhang' && spec.maxOverhang !== undefined && typeof f.value === 'number') {
          if (f.value > spec.maxOverhang) {
            severity = 'error'
            says = `${f.id} overhang ${f.value}°, past the spec’s ${spec.maxOverhang}°.`
          } else severity = 'info'
        }
        run.find('dfm.check', severity, says, at(f.at))
      }
      if (spec.minWall !== undefined) {
        if (typeof wall?.least !== 'number') run.unjudged.push('minWall: no wall reading')
        else if (wall.least < spec.minWall) run.find('dfm.check', 'error', `Least wall ${r2(wall.least)} mm, under the spec’s ${spec.minWall} mm.`, at(wall.at))
      }
      if (spec.maxOverhang !== undefined && skipped.includes('overhang')) run.unjudged.push('maxOverhang: the overhang rule did not run')
    } else {
      if (spec.minWall !== undefined) run.unjudged.push('minWall: the printability check did not run')
      if (spec.maxOverhang !== undefined) run.unjudged.push('maxOverhang: the printability check did not run')
    }

    // Its mass, the parts encased in it counted.
    const bounds = massBounds(spec)
    const mass = await run.call<{ total?: { mass: number }; bodies?: { closed?: boolean }[]; embeddedMass?: number; note?: string }>('mass.properties', { bodies: [b.name] })
    if (mass?.total) {
      const g = mass.total.mass
      figures.mass = r1(g)
      if (mass.bodies?.some((x) => x.closed === false)) run.find('mass.properties', 'warning', 'The mesh is not closed: its volume and mass are not to trust.')
      if (bounds && (g < bounds.min - 1e-9 || g > bounds.max + 1e-9)) {
        const want = Number.isFinite(bounds.min) && Number.isFinite(bounds.max) ? `${r1(bounds.min)} to ${r1(bounds.max)} g` : Number.isFinite(bounds.min) ? `at least ${r1(bounds.min)} g` : `at most ${r1(bounds.max)} g`
        run.find('mass.properties', 'error', `Weighs ${r1(g)} g; the spec asks ${want}.`)
      }
    } else if (bounds) run.unjudged.push('mass: the weighing did not run')

    // The pauses for parts encased in it.
    const hw = await run.call<{ pauses?: unknown[]; warnings?: string[]; gone?: string; unplaced?: string }>('hw.pauses', { bodies: [b.name] })
    if (hw) {
      const n = hw.pauses?.length ?? 0
      figures.pauses = n
      for (const w of (hw.warnings ?? []).slice(0, 3)) run.find('hw.pauses', 'warning', w)
      if (hw.gone) run.find('hw.pauses', 'warning', hw.gone)
      if (hw.unplaced) run.find('hw.pauses', 'warning', hw.unplaced)
      if (spec.pauses !== undefined && n !== spec.pauses) run.find('hw.pauses', 'error', `${n} pause${n === 1 ? '' : 's'}; the spec asks ${spec.pauses}.`)
    } else if (spec.pauses !== undefined) run.unjudged.push('pauses: the pause list did not run')

    // The last strength solve, when it is of this body and still holds.
    const fea = await run.call<{ current?: boolean; stale?: string; setup?: { body?: string | null }; worst?: { safety: number | null; at?: number[] | null }; target?: number }>('fea.results', {}, 'nothing solved')
    let safetyJudged = false
    if (fea) {
      const of = fea.setup?.body ?? null
      if (of !== null && of.toLowerCase() !== b.name.toLowerCase()) run.checks['fea.results'] = `skipped: solved for ${of}`
      else if (fea.current === false) {
        run.checks['fea.results'] = `skipped: stale — ${line(fea.stale ?? 'changed since', 100)}`
        run.find('fea.results', 'info', 'The last strength solve no longer holds: fea.solve again.')
      } else if (typeof fea.worst?.safety === 'number') {
        const s = fea.worst.safety
        const min = spec.minSafety ?? fea.target
        figures.safety = r2(s)
        safetyJudged = true
        if (min !== undefined && s < min) run.find('fea.results', 'error', `Safety factor ${r2(s)}, under ${min}${spec.minSafety !== undefined ? ' (the spec)' : ' (the study’s target)'}.`, at(fea.worst.at))
      }
    }
    if (spec.minSafety !== undefined && !safetyJudged) run.unjudged.push(`minSafety: ${run.checks['fea.results'] === 'ran' ? 'the solve gave no safety factor' : (run.checks['fea.results'] ?? 'no solve').replace(/^skipped: /, '')}`)

    const fit = readPrinterFit()
    const missing = MUST_RUN.filter((n) => run.checks[n] !== 'ran')
    const { findings, more } = worstFirst(run.findings, FINDINGS)
    const saved = useReview.getState().spec
    return {
      body: b.name,
      verdict: verdictOf(run.findings, missing, run.unjudged),
      findings,
      ...(more > 0 ? { more } : {}),
      figures,
      checks: run.checks,
      ...(run.unjudged.length > 0 ? { unjudged: run.unjudged } : {}),
      ...(Object.keys(spec).length > 0 ? { spec: { ...spec, from: given === undefined ? 'project' : saved ? 'given over the project’s' : 'given' } } : {}),
      printerFit: fit ? fit.label : 'none — the typical printer assumed',
    }
  },
}

const keep: Command<{ spec?: Json; clear?: boolean }> = {
  name: 'spec',
  title: 'Keep a design spec',
  // units-ok: the command's description, for the agent — in millimetres always.
  description:
    'Keep a design spec with the project, which every part.review after judges the part against: minWall and minClearance (mm), massMin, massMax or massTarget ± massTol (g), minSafety, maxOverhang (degrees) and pauses (a count). The keys given replace those kept, the rest stay; clear: true drops it. Call with nothing to read it. One undo step.',
  input: obj({ spec: specSchema, clear: bool('Drop the spec kept.') }),
  headless: true,
  label: ({ clear }) => (clear ? 'clear the design spec' : 'design spec'),
  run: async ({ spec, clear }) => {
    if (clear && spec !== undefined) throw new CommandError('invalid_input', 'Give a spec, or clear: true — not both.')
    if (clear) useReview.getState().setSpec(null)
    else if (spec !== undefined) {
      const s = specOf(spec)
      if (typeof s === 'string') throw new CommandError('invalid_input', `spec: ${s}.`)
      const next = { ...(useReview.getState().spec ?? {}), ...s }
      const problem = specOf(next)
      if (typeof problem === 'string') throw new CommandError('invalid_input', `spec, with what was kept: ${problem}.`)
      useReview.getState().setSpec(next)
    }
    return { spec: useReview.getState().spec }
  },
}

export const reviewCommands = [review, keep] as Command<never>[]
