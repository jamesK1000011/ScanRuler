// SPDX-License-Identifier: AGPL-3.0-only
// dfm.*: a part checked for FDM printing against a rule pack you can read
// and change — each finding where it is, how much, the limit it broke, the
// rule and where that rule's number comes from — and waived with a reason
// where it is meant.

import { commandHost, requireScene } from '../../../src/commands/host'
import { anyObject, arr, bool, enumOf, num, obj, str } from '../../../src/commands/schema'
import { type Command, CommandError } from '../../../src/plugins/api'
import { useDeviation } from '../../../src/state/deviationStore'
import { useStore } from '../../../src/state/store'
import { useThickness } from '../../../src/state/thicknessStore'
import { runChecks } from '../core/checks'
import { leastWall, probeWalls, sharpEdges, type WallSamples } from '../core/wall'
import { arrayToBuild, buildFrame, fromBuild, UPS, type BuildFrame, type Up } from '../core/frame'
import { CONSIDERATIONS, CONSIDERATIONS_CITE } from '../core/considerations'
import { paramProblem, stack, validateGuide, type Guide, type Layer, type Override, type Profile, type RulePack } from '../core/rules'
import pack from '../rules/fdm-default.json'
import { atKey, useDfm, type Checked, type DfmSettings, type NumberedFinding } from '../state/dfmStore'
import { bodyTriangles, pickBody, reverseBodies, staleReference } from './body'

const PACK = pack as RulePack
const glob = (g: Record<string, Profile>) => Object.values(g).sort((a, b) => a.id.localeCompare(b.id))
const PRINTERS = glob(import.meta.glob<Profile>('../rules/printers/*.json', { eager: true, import: 'default' }))
const MATERIALS = glob(import.meta.glob<Profile>('../rules/materials/*.json', { eager: true, import: 'default' }))
const NOZZLES = glob(import.meta.glob<Profile>('../rules/nozzles/*.json', { eager: true, import: 'default' }))
const SHIPPED_GUIDES = glob(import.meta.glob<Guide>('../rules/guides/*.json', { eager: true, import: 'default' }) as Record<string, Profile>) as Guide[]
/** The guides there are: shipped ones, and the project's imported ones. */
export const guidesNow = (): Guide[] => [...SHIPPED_GUIDES, ...useDfm.getState().guides.map((g) => ({ ...g, custom: true }))]

const r = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d

function layers(s: DfmSettings = useDfm.getState().settings): Layer[] {
  const out: Layer[] = []
  const pick = (list: Profile[], id: string | null, kind: string) => {
    if (!id) return
    const p = list.find((x) => x.id === id)
    if (p) out.push({ name: `${kind} ${p.id}`, overrides: p.overrides })
  }
  pick(NOZZLES, s.nozzle, 'nozzle')
  pick(MATERIALS, s.material, 'material')
  pick(PRINTERS, s.printer, 'printer')
  pick(guidesNow(), s.guide, 'guide')
  out.push({ name: 'project', overrides: useDfm.getState().overrides })
  return out
}

export const effective = () => stack(PACK, layers())

function weld(src: ArrayLike<number>, index: ArrayLike<number> | null): { positions: Float64Array; indices: Uint32Array } {
  const count = index ? index.length : src.length / 3
  const map = new Map<string, number>()
  const pos: number[] = []
  const indices = new Uint32Array(count)
  for (let k = 0; k < count; k++) {
    const i = index ? index[k] : k
    const key = `${Math.round(src[3 * i] * 1e4)},${Math.round(src[3 * i + 1] * 1e4)},${Math.round(src[3 * i + 2] * 1e4)}`
    let v = map.get(key)
    if (v === undefined) {
      v = map.size
      map.set(key, v)
      pos.push(src[3 * i], src[3 * i + 1], src[3 * i + 2])
    }
    indices[k] = v
  }
  return { positions: Float64Array.from(pos), indices }
}

export const settings: Command<Partial<DfmSettings>> = {
  name: 'settings',
  title: 'What the part is printed on',
  description: `Choose the profiles the rules are stacked from — nozzle (${NOZZLES.map((p) => p.id).join(', ')}; 0.4 by default), material (${MATERIALS.map((p) => p.id).join(', ')}), printer (${PRINTERS.map((p) => p.id).join(', ')}), and a published guide stacked over them (${SHIPPED_GUIDES.map((g) => g.id).join(', ')}, or one imported with dfm.guides) — which way of the part stands up on the bed (up, +z by default), and what is checked: the scan (default), the reference part, or a Reverse Engineer body as it stands now (target body; body names it, by name or id — the one solid body shown by default). null clears a profile. Call with nothing to read them. Kept with the project.`,
  input: obj({
    up: enumOf(UPS, 'Which way of the part stands up on the bed.'),
    nozzle: { oneOf: [enumOf(NOZZLES.map((p) => p.id)), { type: 'null' }], description: 'The nozzle profile, or null.' },
    material: { oneOf: [enumOf(MATERIALS.map((p) => p.id)), { type: 'null' }], description: 'The material profile, or null.' },
    printer: { oneOf: [enumOf(PRINTERS.map((p) => p.id)), { type: 'null' }], description: 'The printer profile, or null.' },
    guide: { oneOf: [str(), { type: 'null' }], description: 'A published guide whose numbers stack over the profiles (dfm.guides lists them), or null.' },
    target: enumOf(['scan', 'reference', 'body'], 'What is checked.'),
    body: { oneOf: [str(undefined, { minLength: 1 }), num(), { type: 'null' }], description: 'For target body: the body, by name or id; null for the one solid body shown.' },
  }),
  history: false,
  run: async (p) => {
    if (p.guide && !guidesNow().some((g) => g.id === p.guide)) throw new CommandError('not_found', `No guide "${p.guide}" — have ${guidesNow().map((g) => g.id).join(', ')}.`)
    // A body named is looked for now, while the name can still be put right.
    if (p.body !== undefined && p.body !== null && reverseBodies()) pickBody(p.body)
    if (Object.keys(p).length) useDfm.getState().set(p)
    return { settings: useDfm.getState().settings }
  },
}

export const profiles: Command<Record<string, never>> = {
  name: 'profiles',
  title: 'Profiles and the rule pack',
  description: 'The rule pack and the profiles there are to stack on it — nozzles, materials, printers — each with what it changes, and the ones chosen. Changes nothing.',
  input: obj({}),
  readOnly: true,
  run: async () => ({
    pack: { id: PACK.id, label: PACK.label, version: PACK.version, rules: PACK.rules.map((x) => x.id) },
    nozzles: NOZZLES,
    materials: MATERIALS,
    printers: PRINTERS,
    guides: guidesNow().map(({ id, label, publisher, url, read, custom }) => ({ id, label, publisher, url, read, ...(custom ? { custom } : {}) })),
    chosen: useDfm.getState().settings,
  }),
}

export const rules: Command<{ action?: 'list' | 'set' | 'clear'; rule?: string; params?: Record<string, number>; severity?: 'error' | 'warning' | 'info'; disabled?: boolean }> = {
  name: 'rules',
  title: 'The rules in force',
  description:
    'list (the default): every rule as the chosen profiles and this project leave it — its check, severity, parameters, and which layer set each (default, nozzle, material, printer, project) — with its rationale and the source of its numbers. set: this project’s own change to a rule (params merged, severity, disabled), kept with the project. clear: drop the project’s change to a rule. A rule’s change moves the next dfm.check.',
  input: obj({
    action: enumOf(['list', 'set', 'clear'], 'list by default.'),
    rule: str('The rule id: thin-wall, overhang, bridge, small-hole, bed-contact, tall-thin, trapped-volume, mesh-health.'),
    params: anyObject('For set: parameters by name, numbers ({ "maxDeg": 55 }).'),
    severity: enumOf(['error', 'warning', 'info'], 'For set.'),
    disabled: bool('For set: switch the rule off (true) or on.'),
  }),
  history: false,
  run: async ({ action = 'list', rule, params, severity, disabled }) => {
    if (action !== 'list') {
      const base = PACK.rules.find((x) => x.id === rule)
      if (!base) throw new CommandError('not_found', `No rule "${rule}" — have ${PACK.rules.map((x) => x.id).join(', ')}.`)
      if (action === 'clear') useDfm.getState().setOverride(base.id, null)
      else {
        for (const [k, v] of Object.entries(params ?? {})) {
          if (!(k in base.params)) throw new CommandError('invalid_input', `${base.id} has no parameter ${k} — it has ${Object.keys(base.params).join(', ') || 'none'}.`)
          const bad = paramProblem(base.id, k, v)
          if (bad) throw new CommandError('invalid_input', `${base.id}.${k} is ${bad}.`)
        }
        const prev: Override = useDfm.getState().overrides[base.id] ?? {}
        useDfm.getState().setOverride(base.id, { ...prev, ...(params ? { params: { ...(prev.params ?? {}), ...params } } : {}), ...(severity ? { severity } : {}), ...(disabled !== undefined ? { disabled } : {}) })
      }
    }
    return { rules: effective(), projectOverrides: useDfm.getState().overrides }
  },
}

/** The least wall read on a CAD part and where (in the part's frame),
 *  against the limit, with how it was read. */
function wallReading(w: WallSamples, limit: number, frame: BuildFrame) {
  const l = leastWall(w, { edges: false })
  const at = [0, 0, 0]
  if (l) fromBuild(frame, l.at[0], l.at[1], l.at[2], at)
  const edges = sharpEdges(w, limit, 1.5 * Math.max(w.spacing, limit)).map((e) => {
    const p = [0, 0, 0]
    fromBuild(frame, e.at[0], e.at[1], e.at[2], p)
    return { at: p.map((v) => r(v)), length: r(e.length, 1) }
  })
  return {
    ...(l ? { least: r(l.least), at: at.map((v) => r(v)), thin: l.least < limit } : { least: null, over: w.reach }),
    ...(edges.length ? { sharpEdges: edges } : {}),
    limit,
    spacing: r(w.spacing),
    samples: w.thickness.length,
  }
}

/** Open but not drawn: still coming in (busy), or not on the stage at all
 *  (invalid_state). Not unavailable — that is a session with no viewport,
 *  which requireScene answers. */
const notOnStage = (loading: boolean, what: string) =>
  loading ? new CommandError('busy', `${what} is still opening — check again once it is in.`) : new CommandError('invalid_state', `${what} is not on the stage.`)

export const check: Command<{ only?: string[]; detail?: 'brief' | 'full' }> = {
  name: 'check',
  title: 'Check the part for FDM printing',
  description:
    'Check the part (the scan by default; dfm.settings target: scan, reference, or body — a Reverse Engineer body meshed as it stands now, so edits since are checked) against the rules in force: thin walls (on the scan from its thickness map; on a body or the reference part read by rays into the material from samples over the faces, round inserts and pockets too — wall gives the least wall read, where, and the limit; a taper to a knife edge, such as a stacking lip, is not a thin wall: it comes back as an info finding and in wall.sharpEdges, where and about how long), overhangs past the angle — and flat undersides held on one side only, which print in air — flat ceilings bridging further than the limit, upright holes too small to print open, too little of the footprint on the bed, a part too tall for its base, closed cavities, and open or non-manifold edges. Each finding: an id (F1 …), the rule, severity, value against limit with its unit, where it is (at, mm, in the part’s frame), the area it covers, and what to do. A finding at a place waived before (dfm.waive) comes back waived, with the reason. skipped says which rules could not run and why. only: just these rules. part names what was read; stale says the reference part was made from a body that has changed since — an older copy was checked. Kept until the next check; dfm.report writes them out.',
  input: obj({ only: arr(enumOf(PACK.rules.map((x) => x.id)), 'Just these rules.', { minItems: 1 }), detail: enumOf(['brief', 'full'], 'full adds each finding’s says text.') }),
  history: false,
  timeoutMs: 5 * 60_000,
  run: async ({ only, detail = 'brief' }, ctx) => {
    const s = useDfm.getState().settings
    const frame = buildFrame(s.up as Up)
    let mesh: { positions: Float64Array; indices: Uint32Array }
    let thickness: Float32Array | null = null
    const skippedExtra: { rule: string; why: string }[] = []
    let checked: Checked
    if (s.target === 'scan') {
      checked = { target: 'scan', part: useStore.getState().fileName ?? 'part' }
      if (!useStore.getState().fileName) throw new CommandError('no_scan', 'There is no part open — open it with scan.open (or import.open), or set target: reference.')
      const sm = requireScene('Checking the part').scanMesh()
      if (!sm) throw notOnStage(useStore.getState().busy, 'The part')
      mesh = { positions: arrayToBuild(frame, sm.positions), indices: sm.indices }
      const wantThin = !only || only.includes('thin-wall')
      if (wantThin) {
        ctx.progress('Measuring the wall thickness')
        const worker = commandHost().session.clientRef.current
        const t = useThickness.getState()
        try {
          const res = await worker!.thickness({ method: t.method, coneRays: t.method === 'ray' ? t.coneRays : 0, coneAngleDeg: t.coneAngleDeg, normalDeviationDeg: t.normalDeviationDeg, maxThickness: t.maxThickness })
          if (res.values.length === sm.positions.length / 3) thickness = res.values
          else skippedExtra.push({ rule: 'thin-wall', why: `the thickness map has ${res.values.length} values for ${sm.positions.length / 3} vertices` })
        } catch (e) {
          skippedExtra.push({ rule: 'thin-wall', why: `the wall thickness could not be measured: ${e instanceof Error ? e.message : String(e)}` })
        } finally {
          // The worker's progress line is the status bar's: put it away once done.
          if (/^Measuring wall thickness/.test(useStore.getState().statusText ?? '')) useStore.getState().setStatus('')
        }
      }
    } else if (s.target === 'body') {
      const body = pickBody(s.body)
      ctx.progress(`Meshing ${body.name}`)
      const { soup, stamp } = await bodyTriangles(body)
      const w = weld(soup, null)
      mesh = { positions: arrayToBuild(frame, w.positions), indices: w.indices }
      checked = { target: 'body', part: body.name, ...(stamp ? { stamp } : {}) }
    } else {
      const dev = useDeviation.getState()
      if (!dev.nominalName) throw new CommandError('invalid_state', 'No reference part is open — deviation.open_reference, or set target: scan or body.')
      const g = requireScene('Checking the part').nominalGeometry()
      if (!g) throw notOnStage(dev.nominalBusy, 'The reference part')
      const w = weld(g.getAttribute('position').array as ArrayLike<number>, g.getIndex()?.array ?? null)
      mesh = { positions: arrayToBuild(frame, w.positions), indices: w.indices }
      const stale = staleReference(dev.nominalMadeFrom)
      checked = { target: 'reference', part: dev.nominalName, ...(stale ? { stale } : {}) }
    }
    const inForce = effective().filter((x) => !only || only.includes(x.id))
    // A body or a reference is CAD: its walls are read at samples over its
    // faces — round an insert or a magnet's pocket too — where the scan's
    // are read by the thickness map.
    let wall: WallSamples | null = null
    const thinRule = inForce.find((x) => x.id === 'thin-wall' && !x.disabled)
    if (s.target !== 'scan' && thinRule) {
      ctx.progress('Reading the wall thickness')
      const minMm = thinRule.params.minMm
      wall = probeWalls(mesh.positions, mesh.indices, { spacing: minMm / 2, reach: Math.max(8 * minMm, 5) })
    }
    ctx.progress(`Checking ${inForce.filter((x) => !x.disabled).length} rules`)
    const { findings, skipped } = runChecks({ ...mesh, thickness, wall }, inForce.map((x) => (x.id === 'thin-wall' && !thickness && !wall ? { ...x, disabled: true } : x)))
    // Back into the part's own frame for the places.
    const tmp = [0, 0, 0]
    const waivers = useDfm.getState().waivers
    const numbered: NumberedFinding[] = findings
      .sort((a, b) => ['error', 'warning', 'info'].indexOf(a.severity) - ['error', 'warning', 'info'].indexOf(b.severity))
      .map((f, i) => {
        fromBuild(frame, f.at[0], f.at[1], f.at[2], tmp)
        const at: [number, number, number] = [r(tmp[0]), r(tmp[1]), r(tmp[2])]
        const w = waivers.find((x) => x.rule === f.rule && x.at.join() === atKey(at).join())
        return { ...f, id: `F${i + 1}`, at, ...(w ? { waived: w.reason } : {}) }
      })
    const allSkipped = [...skippedExtra.filter((x) => !only || only.includes(x.rule)), ...skipped.filter((x) => !skippedExtra.some((y) => y.rule === x.rule))]
    const reading = wall && thinRule ? wallReading(wall, thinRule.params.minMm, frame) : null
    if (reading) checked = { ...checked, wall: { least: reading.least, limit: reading.limit } }
    useDfm.getState().result(numbered, allSkipped, checked)
    const open = numbered.filter((f) => !f.waived)
    const count = (sev: string) => open.filter((f) => f.severity === sev).length
    return {
      target: s.target,
      part: checked.part,
      ...(checked.stamp ? { stamp: checked.stamp } : {}),
      ...(checked.stale ? { stale: checked.stale } : {}),
      profiles: layers().map((l) => l.name),
      verdict: count('error') ? 'fix before printing' : count('warning') ? 'printable with care' : 'no findings',
      errors: count('error'),
      warnings: count('warning'),
      info: count('info'),
      waived: numbered.length - open.length,
      ...(reading ? { wall: reading } : {}),
      findings: numbered.map(({ says, ...f }) => (detail === 'full' ? { ...f, says } : { id: f.id, rule: f.rule, severity: f.severity, value: f.value, limit: f.limit, unit: f.unit, at: f.at, ...(f.areaMm2 !== undefined ? { areaMm2: f.areaMm2 } : {}), ...(f.waived ? { waived: f.waived } : {}), says })),
      ...(allSkipped.length ? { skipped: allSkipped } : {}),
    }
  },
}

function finding(id: string): NumberedFinding {
  const f = useDfm.getState().findings.find((x) => x.id === id)
  if (!f) throw new CommandError('not_found', useDfm.getState().checkedAt ? `No finding ${id} in the last check.` : 'Nothing checked yet — run dfm.check.')
  return f
}

export const explain: Command<{ id: string }> = {
  name: 'explain',
  title: 'Why a finding',
  description: 'One finding of the last check with its rule in full: the parameters and which profile set each, the rationale, and where the rule’s numbers come from. Changes nothing.',
  input: obj({ id: str('The finding, F1 …', { minLength: 1 }) }, ['id']),
  readOnly: true,
  run: async ({ id }) => {
    const f = finding(id)
    const rule = effective().find((x) => x.id === f.rule)!
    return { finding: f, rule: { id: rule.id, check: rule.check, severity: rule.severity, params: rule.params, setBy: rule.setBy, rationale: rule.rationale, source: rule.source } }
  },
}

export const waive: Command<{ id: string; reason?: string; undo?: boolean }> = {
  name: 'waive',
  title: 'Waive a finding',
  description: 'Accept a finding of the last check on purpose, with the reason (a hole drilled after printing, a brim planned, a bridge the printer handles) — kept with the project, and a finding of the same rule at the same place (to the millimetre) comes back waived at the next check. undo: take the waiver back.',
  input: obj({ id: str('The finding, F1 …', { minLength: 1 }), reason: str('Why it is accepted.'), undo: bool('Take the waiver back.') }, ['id']),
  history: false,
  run: async ({ id, reason, undo }) => {
    const f = finding(id)
    const at = atKey(f.at)
    if (undo) {
      if (!useDfm.getState().unwaive(f.rule, at)) throw new CommandError('not_found', `${id} is not waived.`)
      f.waived = undefined
      return { unwaived: id }
    }
    if (!reason?.trim()) throw new CommandError('invalid_input', 'A waiver needs a reason.')
    useDfm.getState().waive({ rule: f.rule, at, reason: reason.trim() })
    f.waived = reason.trim()
    return { waived: id, rule: f.rule, at: f.at, reason: f.waived }
  },
}

export const report: Command<{ format?: 'md' | 'json' }> = {
  name: 'report',
  title: 'The check as a report',
  description: 'The last check written out: md — a short Markdown report (the profiles, the verdict, a table of findings with what to do, the waivers with their reasons, the rules skipped); json — everything. Changes nothing.',
  input: obj({ format: enumOf(['md', 'json'], 'md by default.') }),
  readOnly: true,
  returnsFile: true,
  run: async ({ format = 'md' }) => {
    const st = useDfm.getState()
    if (!st.checkedAt) throw new CommandError('invalid_state', 'Nothing checked yet — run dfm.check.')
    const name = st.checked?.part ?? (st.settings.target === 'scan' ? useStore.getState().fileName : useDeviation.getState().nominalName) ?? 'part'
    const stem = name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '_')
    let text: string
    if (format === 'json') text = JSON.stringify({ part: name, checkedAt: st.checkedAt, ...(st.checked?.stamp ? { stamp: st.checked.stamp } : {}), ...(st.checked?.stale ? { stale: st.checked.stale } : {}), settings: st.settings, profiles: layers().map((l) => l.name), rules: effective(), findings: st.findings, skipped: st.skipped }, null, 2)
    else {
      const open = st.findings.filter((f) => !f.waived), waived = st.findings.filter((f) => f.waived)
      const row = (f: NumberedFinding) => `| ${f.id} | ${f.severity} | ${f.rule} | ${f.value} ${f.unit} (limit ${f.limit}) | ${f.at.join(', ')} | ${f.says} |`
      text = [
        `# Printability check: ${name}`,
        '',
        `Checked ${st.checkedAt.slice(0, 16).replace('T', ' ')} UTC against ${PACK.label}, with ${layers().map((l) => l.name).join(', ')}.`,
        '',
        ...(st.checked?.stale ? [`> ${st.checked.stale}`, ''] : []),
        `**${open.filter((f) => f.severity === 'error').length} errors, ${open.filter((f) => f.severity === 'warning').length} warnings, ${open.filter((f) => f.severity === 'info').length} notes, ${waived.length} waived.**`,
        '',
        ...(open.length ? ['| Id | Severity | Rule | Value | Where (mm) | What to do |', '| --- | --- | --- | --- | --- | --- |', ...open.map(row), ''] : ['No open findings.', '']),
        ...(waived.length ? ['## Waived', '', '| Id | Rule | Reason |', '| --- | --- | --- |', ...waived.map((f) => `| ${f.id} | ${f.rule} | ${f.waived} |`), ''] : []),
        ...(st.skipped.length ? ['## Not checked', '', ...st.skipped.map((x) => `- ${x.rule}: ${x.why}`), ''] : []),
      ].join('\n')
    }
    return { file: { name: `${stem}-printability.${format}`, mimeType: format === 'md' ? 'text/markdown' : 'application/json', bytes: new TextEncoder().encode(text) }, findings: st.findings.length }
  },
}

const TOPIC_ORDER = ['supported wall', 'unsupported wall', 'minimum wall', 'overhang angle', 'overhang length', 'bridge span', 'hole diameter', 'pin diameter', 'minimum feature', 'clearance, connecting or moving parts']

export const guides: Command<{ action?: 'list' | 'compare' | 'import' | 'export' | 'remove'; ids?: string[]; guide?: Record<string, unknown>; id?: string; label?: string; publisher?: string }> = {
  name: 'guides',
  title: 'Published design guides',
  description: `Design guides from service bureaus, printer makers and universities, each a set of numbers with where they come from (publisher, url, the date it was read) — the ones a check uses (thin-wall, overhang, bridge, small-hole) and the rest to read (clearances, pins, text, tolerances).
- list (the default): the guides, shipped and imported, with their figures.
- compare: ids (all by default) side by side, topic by topic, with the spread where they disagree.
- import: guide is a JSON guide — { id, label, publisher, url?, read?, note?, overrides: { "thin-wall": { params: { minMm: 1 } }, … }, figures: [{ topic, value, unit }] } — checked against the rules and kept with the project; dfm.settings { guide } then stacks it.
- export: the rules in force now as such a guide (label, publisher: who you are), to edit and import elsewhere; or id: one guide as it is.
- remove: id, an imported guide.
No guide is a standard; they disagree, which compare shows.`,
  input: obj({
    action: enumOf(['list', 'compare', 'import', 'export', 'remove']),
    ids: arr(str(), 'For compare.'),
    guide: anyObject('For import: the guide, as JSON.'),
    id: str('For export or remove.'),
    label: str('For export of the rules in force.'),
    publisher: str('For export of the rules in force.'),
  }),
  history: false,
  run: async ({ action = 'list', ids, guide, id, label, publisher }) => {
    const all = guidesNow()
    if (action === 'import') {
      const errors = validateGuide(guide, PACK)
      if (SHIPPED_GUIDES.some((g) => g.id === (guide as unknown as Guide)?.id)) errors.push(`id: "${(guide as unknown as Guide).id}" is a shipped guide; give yours its own id.`)
      if (errors.length) throw new CommandError('invalid_input', `The guide was not imported:\n- ${errors.join('\n- ')}`)
      const g = guide as unknown as Guide
      useDfm.getState().addGuide({ ...g, figures: g.figures ?? [] })
      return { imported: g.id, guides: guidesNow().map((x) => x.id), next: `dfm.settings { guide: "${g.id}" } stacks it.` }
    }
    if (action === 'remove') {
      if (!useDfm.getState().guides.some((g) => g.id === id)) throw new CommandError('not_found', `No imported guide "${id}" — imported: ${useDfm.getState().guides.map((g) => g.id).join(', ') || 'none'}. Shipped guides cannot be removed.`)
      useDfm.getState().removeGuide(id!)
      return { removed: id, guides: guidesNow().map((x) => x.id) }
    }
    if (action === 'export') {
      if (id) {
        const g = all.find((x) => x.id === id)
        if (!g) throw new CommandError('not_found', `No guide "${id}".`)
        const { custom: _c, ...plain } = g
        return { guide: plain }
      }
      const eff = effective()
      const overrides: Record<string, Override> = Object.fromEntries(eff.map((r) => [r.id, { params: r.params, severity: r.severity, ...(r.disabled ? { disabled: true } : {}) }]))
      const today = new Date().toISOString().slice(0, 10)
      return { guide: { id: 'my-rules', label: label ?? 'My printability rules', publisher: publisher ?? 'me', read: today, note: `The rules in force on ${today}: ${layers().map((l) => l.name).join(', ')}.`, overrides, figures: [] } }
    }
    const chosen = action === 'compare' && ids?.length ? ids.map((x) => all.find((g) => g.id === x) ?? (() => { throw new CommandError('not_found', `No guide "${x}".`) })()) : all
    if (action === 'list') return { guides: chosen, chosen: useDfm.getState().settings.guide }
    const topics = [...new Set(chosen.flatMap((g) => g.figures.map((f) => f.topic)))].sort((a, b) => (TOPIC_ORDER.indexOf(a) + 1 || 99) - (TOPIC_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b))
    const rows = topics.map((topic) => {
      const values = Object.fromEntries(chosen.map((g) => {
        const f = g.figures.find((x) => x.topic === topic)
        return [g.id, f ? `${f.value}${f.unit && typeof f.value === 'number' ? ` ${f.unit}` : f.unit ? ` ${f.unit}` : ''}` : null]
      }))
      const nums = chosen.map((g) => g.figures.find((x) => x.topic === topic)?.value).filter((v): v is number => typeof v === 'number')
      return { topic, values, ...(nums.length > 1 ? { low: Math.min(...nums), high: Math.max(...nums), agree: Math.min(...nums) === Math.max(...nums) } : {}) }
    })
    return { guides: chosen.map(({ id: gid, label: l, publisher: p, url, read }) => ({ id: gid, label: l, publisher: p, url, read })), rows, disagree: rows.filter((r) => r.agree === false).map((r) => r.topic) }
  },
}

export const considerations: Command<Record<string, never>> = {
  name: 'considerations',
  title: 'Design review questions',
  description: 'The questions to ask of a printed part besides the numbers — function, orientation and strength, supports, feature size, accuracy and fits, warping, surface, closed volumes, size, assembly, after printing, material, cost, inspection — each saying which dfm rule checks it, or that it is the person\'s call. Written in this plugin\'s words; ISO/ASTM 52910 is the standard on design for additive manufacturing, named, not reproduced.',
  input: obj({}),
  readOnly: true,
  run: async () => {
    const found = new Set(useDfm.getState().findings.filter((f) => !f.waived).map((f) => f.rule))
    return {
      considerations: CONSIDERATIONS.map((c) => ({ ...c, open: c.checkedBy.some((r) => found.has(r)) })),
      cite: CONSIDERATIONS_CITE,
    }
  },
}

export const dfmCommands = [settings, profiles, rules, check, explain, waive, report, guides, considerations] as Command<never>[]

