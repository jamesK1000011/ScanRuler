// SPDX-License-Identifier: AGPL-3.0-only
// part.review: is this part done? The checks the other workspaces carry —
// the body's validity, its clearance to the other bodies shown, its mass,
// the last strength solve, and for a part made by 3D printing the printing
// checks — run here by name through the command registry, never imported,
// so a build without any of them stands and says which it lacks. A build
// mixes processes, part by part, and how each part is made is its setup
// (plugins/_shared/setups.ts): the printing checks judge a part in a print
// setup, inform on one in no setup, and are passed over for any other —
// whose own setup type's checks judge it instead. The wall is the part's
// however it is made: read for every part. One small verdict; the details
// are a call away in each command. part.spec keeps a design spec with the
// project.

import { sceneOf } from '../../../src/commands/host'
import { listCommands, runCommand, runsHeadless } from '../../../src/commands/registry'
import { anyObject, bool, num, obj, oneOf, str } from '../../../src/commands/schema'
import { readStateSection } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { readPrinterFit } from '../../_shared/readPrinterFit'
import { setupFor, setupTypeOf, type Setup } from '../../_shared/setups'
import { line, massBounds, processOf, r1, r2, specOf, specOver, verdictOf, worstFirst, type Finding, type ReviewSpec, type Severity } from '../core/spec'
import { useReview } from '../state/reviewStore'

type Json = Record<string, unknown>

/** How many findings a review names, and how many of the printing checks'
 *  when they only inform; the rest are counted. */
const FINDINGS = 8
const IF_PRINTED = 5

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
    processes: anyObject('How each body in no setup is made, by its name — setups (setup.add) say it for the bodies in them: "fdm" or "print" for 3D printed; any other word (laser-cut, machined, bought) is not printed; "" drops a body’s.'),
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

/** Each check's status, by command. */
type Checks = Record<string, string>

/** A review's run of the checks: each one's status, and its answer. */
class Run {
  readonly unjudged: string[] = []
  private readonly have = new Set(listCommands().map((c) => c.name))

  async call<T = Json>(checks: Checks, name: string, input: Json, notFound?: string): Promise<T | null> {
    if (!this.have.has(name)) {
      checks[name] = 'skipped: not in build'
      return null
    }
    // With no page (the app run headless) a command not marked to run so
    // needs one; run here it would not be refused, so it is passed over.
    if (!runsHeadless(name) && sceneOf() === null) {
      checks[name] = 'skipped: page only'
      return null
    }
    try {
      const out = (await runCommand(name, input)) as T
      checks[name] = 'ran'
      return out
    } catch (e) {
      const code = (e as { code?: string }).code
      const message = e instanceof Error ? e.message : String(e)
      checks[name] = code === 'unavailable' ? 'skipped: page only' : code === 'not_found' && notFound ? `skipped: ${notFound}` : `failed: ${line(message, 120)}`
      return null
    }
  }
}

const find = (into: Finding[], source: string, severity: Severity, says: string, where?: number[] | string): void => {
  into.push({ source, severity, says: line(says), ...(where !== undefined ? { at: where } : {}) })
}

interface ReviewIn {
  body?: string | number
  process?: string
  spec?: Json
}

const review: Command<ReviewIn> = {
  name: 'review',
  title: 'Is the part done?',
  // units-ok: the command's description, for the agent — in millimetres always.
  description:
    'One verdict on a Reverse Engineer body — the one solid body shown by default — from the checks this build has: reverse.body.check (valid, closed), reverse.body.clearance (against every other body shown; minClearance as the least gap), mass.properties (encased parts included) and fea.results (the last strength solve, when it is of this body and still holds); and the printing checks — dfm.check on the body (printability and walls) and hw.pauses (pauses and roofs for parts encased mid-print). How the part is made is its setup (setup.of): in a print setup — the printing checks judge it, under printing, with that setup’s printer, nozzle, layers and fit calibration; in a setup of another kind — they are skipped as not printed, and that kind’s own checks judge it, under made; in none — they run where the build has them and inform under ifPrinted, never moving the verdict. process overrides the setup ("fdm" or "print" printed; any other word — laser-cut, machined, bought — not printed); the spec’s processes stand in for a body in no setup. The wall is read however the part is made (dfm.wall for a part not printed), so minWall is judged for every part. Answers process and processFrom (given, the setup, the spec’s processes, or not said); verdict — pass, fix (an error to put right) or unknown (a check that must run did not, or part of the spec could not be judged: unjudged says which); findings, worst first (source: the command, severity, says, at); figures (volume mm³, mass g, material and as — printed or solid — as weighed, wall mm, gap mm, safety); checks: each command ran, skipped (not in build, page only, or why) or failed (why); the spec judged against. The printing group carries its own checks, figures (pauses) and printerFit, the printer calibration in use. spec: a design spec for this review, over the one part.spec keeps with the project. Each command gives its details when run alone. Changes nothing.',
  input: obj({
    body: oneOf([str(undefined, { minLength: 1 }), num()], 'The body, by name or id; the one solid body shown by default.'),
    process: str('How the part is made, over its setup: "fdm" or "print" for 3D printed; any other word (laser-cut, machined, bought) is not printed; its setup’s by default.', { minLength: 1 }),
    spec: specSchema,
  }),
  readOnly: true,
  long: true,
  headless: true,
  timeoutMs: 15 * 60_000,
  run: async ({ body: ref, process: asked, spec: given }) => {
    let spec: ReviewSpec = { ...(useReview.getState().spec ?? {}) }
    if (given !== undefined) {
      const s = specOf(given)
      if (typeof s === 'string') throw new CommandError('invalid_input', `spec: ${s}.`)
      spec = specOver(spec, s, given)
    }
    const all = bodies()
    const b = pick(all, ref)
    // How it is made: the process given, else its setup — a print setup's
    // part is printed, any other setup's made its way — else the spec's
    // word for it (from before setups), else not said.
    const setup: Setup | null = setupFor(b.name)
    const proc = asked !== undefined ? processOf(asked) : setup ? (setup.type === 'print' ? processOf('print') : { kind: 'other' as const, as: setupTypeOf(setup.type)?.label.toLowerCase() ?? setup.type }) : processOf(spec.processes?.[b.name])
    const procFrom = asked !== undefined ? 'given' : setup ? `setup ${setup.name} (${setup.id})` : spec.processes?.[b.name] ? 'the spec’s processes' : 'not said'
    const run = new Run()
    const checks: Checks = {}
    const findings: Finding[] = []
    const figures: Json = {}

    // Valid and closed.
    const checked = await run.call<{ bodies?: Json[]; failed?: { name: string }[] }>(checks, 'reverse.body.check', { body: b.id, audit: false })
    const c = checked?.bodies?.[0]
    if (c) {
      if (typeof c.volume === 'number') figures.volume = r1(c.volume)
      for (const p of ((c.problems as string[] | undefined) ?? []).slice(0, 3)) find(findings, 'reverse.body.check', 'error', p)
      for (const w of ((c.warnings as string[] | undefined) ?? []).slice(0, 2)) find(findings, 'reverse.body.check', 'warning', w)
    }
    for (const f of checked?.failed ?? []) find(findings, 'reverse.body.check', 'warning', `${f.name} failed to build: it is missing from the body.`)

    // Clear of the other bodies shown.
    const others = all.filter((x) => x.id !== b.id && !x.surface && x.visible !== false)
    if (others.length === 0) {
      checks['reverse.body.clearance'] = 'skipped: no other body shown'
      if (spec.minClearance !== undefined) run.unjudged.push('minClearance: no other body shown')
    } else {
      const cl = await run.call<{ against?: { name: string; gap: number; overlap?: number; verdict: string }[] }>(checks, 'reverse.body.clearance', { body: b.id, against: others.map((x) => x.id), ...(spec.minClearance !== undefined ? { min: spec.minClearance } : {}) })
      const rows = cl?.against ?? []
      if (rows.length) figures.gap = r2(Math.min(...rows.map((r) => r.gap)))
      for (const r of rows.filter((x) => x.verdict === 'fail')) {
        find(findings, 'reverse.body.clearance', 'error', r.overlap ? `Runs into ${r.name}: ${r2(r.overlap)} mm³ shared.` : `${r2(r.gap)} mm gap to ${r.name}, under the ${spec.minClearance} asked for.`, r.name)
      }
      if (!cl && spec.minClearance !== undefined) run.unjudged.push('minClearance: the clearance did not run')
    }

    // Its mass, the parts encased in it counted.
    const bounds = massBounds(spec)
    const mass = await run.call<{ total?: { mass: number }; bodies?: { closed?: boolean; material?: string; as?: string; assumed?: boolean }[] }>(checks, 'mass.properties', { bodies: [b.name] })
    if (mass?.total) {
      const g = mass.total.mass
      figures.mass = r1(g)
      // What it was weighed in: the body's own material, or the one assumed.
      const row = mass.bodies?.[0]
      if (row?.material) {
        figures.material = row.material
        if (row.as) figures.as = row.as
        if (row.assumed) find(findings, 'mass.properties', 'info', `No material set — weighed as ${row.material}${row.as === 'printed' ? ' as printed' : ''}. material.set gives the body its own.`)
      }
      if (mass.bodies?.some((x) => x.closed === false)) find(findings, 'mass.properties', 'warning', 'The mesh is not closed: its volume and mass are not to trust.')
      if (bounds && (g < bounds.min - 1e-9 || g > bounds.max + 1e-9)) {
        const want = Number.isFinite(bounds.min) && Number.isFinite(bounds.max) ? `${r1(bounds.min)} to ${r1(bounds.max)} g` : Number.isFinite(bounds.min) ? `at least ${r1(bounds.min)} g` : `at most ${r1(bounds.max)} g`
        find(findings, 'mass.properties', 'error', `Weighs ${r1(g)} g; the spec asks ${want}.`)
      }
    } else if (bounds) run.unjudged.push('mass: the weighing did not run')

    // The last strength solve, when it is of this body and still holds.
    const fea = await run.call<{ current?: boolean; stale?: string; setup?: { body?: string | null }; worst?: { safety: number | null; at?: number[] | null }; target?: number }>(checks, 'fea.results', {}, 'nothing solved')
    let safetyJudged = false
    if (fea) {
      const of = fea.setup?.body ?? null
      if (of !== null && of.toLowerCase() !== b.name.toLowerCase()) checks['fea.results'] = `skipped: solved for ${of}`
      else if (fea.current === false) {
        checks['fea.results'] = `skipped: stale — ${line(fea.stale ?? 'changed since', 100)}`
        find(findings, 'fea.results', 'info', 'The last strength solve no longer holds: fea.solve again.')
      } else if (typeof fea.worst?.safety === 'number') {
        const sf = fea.worst.safety
        const min = spec.minSafety ?? fea.target
        figures.safety = r2(sf)
        safetyJudged = true
        if (min !== undefined && sf < min) find(findings, 'fea.results', 'error', `Safety factor ${r2(sf)}, under ${min}${spec.minSafety !== undefined ? ' (the spec)' : ' (the study’s target)'}.`, at(fea.worst.at))
      }
    }
    if (spec.minSafety !== undefined && !safetyJudged) run.unjudged.push(`minSafety: ${checks['fea.results'] === 'ran' ? 'the solve gave no safety factor' : (checks['fea.results'] ?? 'no solve').replace(/^skipped: /, '')}`)

    // The printing checks: judging a printed part, informing on one whose
    // process is not said, passed over for any other.
    const pChecks: Checks = {}
    const pFindings: Finding[] = []
    const pFigures: Json = {}
    if (proc.kind === 'other') {
      pChecks['dfm.check'] = 'skipped: not printed'
      pChecks['hw.pauses'] = 'skipped: not printed'
      // The wall alone, read however the part is made.
      const w = await run.call<{ least?: number | null; at?: number[] }>(checks, 'dfm.wall', { body: b.id, ...(spec.minWall !== undefined ? { min: spec.minWall } : {}) })
      if (typeof w?.least === 'number') figures.wall = r2(w.least)
      if (spec.minWall !== undefined) {
        if (!w) run.unjudged.push('minWall: the wall reading did not run')
        else if (typeof w.least !== 'number') run.unjudged.push('minWall: no wall reading')
        else if (w.least < spec.minWall) find(findings, 'dfm.wall', 'error', `Least wall ${r2(w.least)} mm, under the spec’s ${spec.minWall} mm.`, at(w.at))
      }
    } else {
      const dfm = await run.call<Json>(pChecks, 'dfm.check', { body: b.id })
      if (dfm) {
        const wall = dfm.wall as { least?: number | null; at?: number[] } | undefined
        // The wall is the part's, however it is made: it is judged by the
        // spec either way.
        if (typeof wall?.least === 'number') figures.wall = r2(wall.least)
        for (const f of (dfm.findings as Json[] | undefined) ?? []) {
          if (f.waived) continue
          find(pFindings, 'dfm.check', f.severity as Severity, `${f.id} ${f.rule}: ${f.value} ${f.unit ?? ''} against ${f.limit}${typeof f.says === 'string' ? ` — ${f.says}` : ''}`, at(f.at))
        }
        if (spec.minWall !== undefined) {
          if (typeof wall?.least !== 'number') run.unjudged.push('minWall: no wall reading')
          else if (wall.least < spec.minWall) find(findings, 'dfm.check', 'error', `Least wall ${r2(wall.least)} mm, under the spec’s ${spec.minWall} mm.`, at(wall.at))
        }
      } else if (spec.minWall !== undefined) run.unjudged.push('minWall: the wall reading did not run')
      const hw = await run.call<{ pauses?: unknown[]; warnings?: string[]; gone?: string; unplaced?: string }>(pChecks, 'hw.pauses', { bodies: [b.name] })
      if (hw) {
        pFigures.pauses = hw.pauses?.length ?? 0
        for (const w of (hw.warnings ?? []).slice(0, 3)) find(pFindings, 'hw.pauses', 'warning', w)
        if (hw.gone) find(pFindings, 'hw.pauses', 'warning', hw.gone)
        if (hw.unplaced) find(pFindings, 'hw.pauses', 'warning', hw.unplaced)
      }
    }
    const fit = readPrinterFit(b.name)
    const printerFit = fit ? fit.label : 'none — the typical printer assumed'

    // A setup of another kind judges the part by its own type's checks:
    // each answer's findings read as they come (severity, says, at).
    const made: { setup: string; checks: Checks } | null = setup && setup.type !== 'print' && asked === undefined ? { setup: `${setup.name} (${setup.id})`, checks: {} } : null
    const mFindings: Finding[] = []
    if (made) {
      const type = setupTypeOf(setup!.type)
      if (!type) made.checks[setup!.type] = 'skipped: not in build'
      for (const c of type?.checks ?? []) {
        const out = await run.call<{ findings?: Json[] }>(made.checks, c.command, c.input ? c.input({ id: b.id, name: b.name }) : { body: b.name })
        for (const f of out?.findings ?? []) {
          if (f.waived) continue
          const sev = (['error', 'warning', 'info'] as const).find((x) => x === f.severity) ?? 'info'
          find(mFindings, c.command, sev, typeof f.says === 'string' ? f.says : String(f.rule ?? 'finding'), at(f.at))
        }
      }
    }

    const judged = proc.kind === 'printed' ? [...findings, ...pFindings] : [...findings, ...mFindings]
    const missing = [
      ...(checks['reverse.body.check'] === 'ran' ? [] : ['reverse.body.check']),
      ...(proc.kind === 'printed' && pChecks['dfm.check'] !== 'ran' ? ['dfm.check'] : []),
      ...(made ? Object.entries(made.checks).filter(([, v]) => v !== 'ran').map(([k]) => k) : []),
    ]
    const shown = worstFirst(judged, FINDINGS)
    const saved = useReview.getState().spec
    const informed = worstFirst(pFindings, IF_PRINTED)
    const pFig = Object.keys(pFigures).length > 0 ? { figures: pFigures } : {}
    return {
      body: b.name,
      process: proc.kind === 'other' ? proc.as : proc.kind,
      processFrom: procFrom,
      verdict: verdictOf(judged, missing, run.unjudged),
      findings: shown.findings,
      ...(shown.more > 0 ? { more: shown.more } : {}),
      figures,
      checks,
      ...(run.unjudged.length > 0 ? { unjudged: run.unjudged } : {}),
      ...(proc.kind === 'printed'
        ? { printing: { checks: pChecks, ...pFig, printerFit } }
        : proc.kind === 'unknown'
          ? { ifPrinted: { checks: pChecks, findings: informed.findings, ...(informed.more > 0 ? { more: informed.more } : {}), ...pFig, printerFit } }
          : { printing: { checks: pChecks } }),
      ...(made ? { made } : {}),
      ...(Object.keys(spec).length > 0 ? { spec: { ...spec, from: given === undefined ? 'project' : saved ? 'given over the project’s' : 'given' } } : {}),
    }
  },
}

const keep: Command<{ spec?: Json; clear?: boolean }> = {
  name: 'spec',
  title: 'Keep a design spec',
  // units-ok: the command's description, for the agent — in millimetres always.
  description:
    'Keep a design spec with the project, which every part.review after judges the part against: minWall and minClearance (mm), massMin, massMax or massTarget ± massTol (g), minSafety, and processes — how each body in no setup is made, by its name ("fdm" or "print" for 3D printed; laser-cut, machined, bought … are not; "" drops a body’s); setup.add records how parts are made, with their settings, and wins over processes. The keys given replace those kept, processes body by body, the rest stay; clear: true drops it. Call with nothing to read it. One undo step.',
  input: obj({ spec: specSchema, clear: bool('Drop the spec kept.') }),
  headless: true,
  label: ({ clear }) => (clear ? 'clear the design spec' : 'design spec'),
  run: async ({ spec, clear }) => {
    if (clear && spec !== undefined) throw new CommandError('invalid_input', 'Give a spec, or clear: true — not both.')
    if (clear) useReview.getState().setSpec(null)
    else if (spec !== undefined) {
      const s = specOf(spec)
      if (typeof s === 'string') throw new CommandError('invalid_input', `spec: ${s}.`)
      const next = specOver(useReview.getState().spec ?? {}, s, spec)
      const problem = specOf(next)
      if (typeof problem === 'string') throw new CommandError('invalid_input', `spec, with what was kept: ${problem}.`)
      useReview.getState().setSpec(next)
    }
    return { spec: useReview.getState().spec }
  },
}

export const reviewCommands = [review, keep] as Command<never>[]
