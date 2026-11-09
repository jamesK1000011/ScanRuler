// SPDX-License-Identifier: AGPL-3.0-only
// Make › Order's commands (pcbo.*): a circuit board in a PCB order setup,
// checked against the fab (pcbo.check) and its files gathered for the order
// (pcbo.package). The board is Electronics' — KiCad's (pcb.*) or
// tscircuit's (circuit.*) — reached only through their commands and their
// parts of the session, so a build without either still stands: this says
// which it needs. Both run headless, as KiCad and tscircuit do through the
// agent's server.

import { unzipSync } from 'fflate'
import { runCommand } from '../../../src/commands/registry'
import { bool, num, obj, oneOf, str } from '../../../src/commands/schema'
import { readStateSection } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { bodyKeyOf, bodyNameOf, setupFor, setupsFor, setupsOf, settingsOf, type Setup } from '../../_shared/setups'
import { zip } from '../../_shared/zip'
import { useOrder } from '../state/orderStore'
import { judge, listFindings, orderOf, orderSheet, refsIn, worstFirst, type BoardFigures, type Finding, type Order, type SheetFile } from './pcboCommandCore'

type Json = Record<string, unknown>
type Source = 'kicad' | 'tscircuit'

const invalid = (m: string): never => {
  throw new CommandError('invalid_input', m)
}
const same = (a: string, b: string) => a === b || a.toLowerCase() === b.toLowerCase()
const now = () => new Date().toISOString()
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'board'

// ---- what Electronics holds -------------------------------------------------------

interface PcbReadout {
  setup?: { path?: string }
  board?: { name: string; size?: [number, number]; thickness?: number; stats?: { copperLayers: number | null; minTrack: number | null; minDrill: number | null; parts?: { placed?: number } }; rules?: { clearance: number | null; from?: string } | null }
  imported?: { body: string | null }
  enclosure?: { bodies: string[] }
}
interface CircuitReadout {
  lastBuild?: { job: string; ok: boolean; files: string[]; failure?: string } | null
  loaded?: { name: string; from?: { job?: string } }
  made?: { bodies: string[] }
}
const pcbNow = () => readStateSection('pcb') as PcbReadout | undefined
const circuitNow = () => readStateSection('circuit') as CircuitReadout | undefined

// ---- which setup, which board ----------------------------------------------------

const orderSetups = () => setupsOf().filter((s) => s.type === 'pcb')

interface Target {
  setup: Setup | null
  /** The bodies, by name. */
  bodies: string[]
}

/** The setup asked for — by setup (id or name), by a body in it, or the
 *  one the Make tab shows, or the only one. */
function targetOf({ setup, body }: { setup?: string; body?: string | number }): Target {
  if (setup !== undefined) {
    const s = setupsOf().find((x) => x.id === setup || same(x.name, setup))
    if (!s) throw new CommandError('not_found', `No setup "${setup}" — the PCB order setups are ${orderSetups().map((x) => `${x.id} ${x.name}`).join(', ') || 'none: setup.add { type: "pcb", bodies: [the board] }'}.`)
    if (s.type !== 'pcb') invalid(`${s.name} (${s.id}) is a ${s.type} setup, not a PCB order: its part is made another way.`)
    return { setup: s, bodies: s.bodies.map(bodyNameOf) }
  }
  if (body !== undefined) {
    const s = setupFor(body, 'pcb')
    return s ? { setup: s, bodies: s.bodies.map(bodyNameOf) } : { setup: null, bodies: [bodyNameOf(bodyKeyOf(body))] }
  }
  const all = orderSetups()
  const sel = (readStateSection('setups') as { selected?: string | null } | undefined)?.selected
  const s = all.find((x) => x.id === sel) ?? (all.length === 1 ? all[0] : null)
  if (!s) invalid(all.length ? `Which board? Give setup: ${all.map((x) => `${x.id} ${x.name}`).join(', ')}.` : 'No PCB order setup: setup.add { type: "pcb", bodies: [the board] } records one.')
  return { setup: s!, bodies: s!.bodies.map(bodyNameOf) }
}

/** Where the board comes from: as set, else the body that is KiCad's
 *  board or one of tscircuit's, else the one of the two that has a board. */
function sourceOf(settings: Json, bodies: string[]): Source | null {
  if (settings.source === 'kicad' || settings.source === 'tscircuit') return settings.source
  const p = pcbNow()
  const c = circuitNow()
  if (p?.imported?.body && bodies.some((b) => same(b, p.imported!.body!))) return 'kicad'
  if (c?.made?.bodies.some((m) => bodies.some((b) => same(b, m)))) return 'tscircuit'
  const kicad = !!p?.board
  const tsc = !!c?.loaded
  return kicad && !tsc ? 'kicad' : tsc && !kicad ? 'tscircuit' : null
}

const NO_SOURCE = 'Which board this is cannot be told: no body of it is KiCad’s or tscircuit’s board. Set source (kicad or tscircuit) on the setup, or bring the board in (pcb.import, circuit.bodies).'

interface CircuitStats {
  name: string
  board: { width: number; height: number; thickness: number } | null
  layers: { declared: number | null; withCopper: string[] }
  traces: { minWidth: number | null }
  minDrill: number | null
  minClearance: { mm: number } | null
  refs?: string[]
  errors: number
}

/** The board's figures from its source, and what could not be read. */
async function figuresOf(src: Source): Promise<{ figures: BoardFigures; notes: Finding[]; refs: string[] | null; placed: number | null }> {
  if (src === 'kicad') {
    const b = pcbNow()?.board
    if (pcbNow() === undefined) throw new CommandError('failed', 'The board is KiCad’s, and this build has no Electronics › KiCad.')
    if (!b) throw new CommandError('invalid_state', 'No KiCad board open: pcb.open its .kicad_pcb first.')
    const s = b.stats
    const rules = b.rules ?? null
    const notes: Finding[] = s ? [] : [{ severity: 'info', rule: 'figures', says: 'The board was read before its traces and holes were: open it again (pcb.open) for them.' }]
    return {
      figures: { source: 'kicad', name: b.name, size: b.size ?? null, thickness: b.thickness ?? null, layers: s?.copperLayers ?? null, minTrace: s?.minTrack ?? null, minSpace: rules?.clearance ?? null, spaceFrom: rules?.clearance != null ? 'rules' : null, rulesFrom: rules?.from ?? null, minDrill: s?.minDrill ?? null },
      notes,
      refs: null,
      placed: s?.parts?.placed ?? null,
    }
  }
  let s: CircuitStats
  try {
    s = (await runCommand('circuit.stats', {})) as CircuitStats
  } catch (e) {
    if (e instanceof CommandError && e.code === 'unknown_command') throw new CommandError('failed', 'The board is tscircuit’s, and this build has no Electronics › tscircuit.')
    throw e
  }
  const layers = s.layers.declared ?? (s.layers.withCopper.length || null)
  return {
    figures: { source: 'tscircuit', name: s.name.replace(/\.json$/i, '').replace(/\.circuit$/i, ''), size: s.board ? [s.board.width, s.board.height] : null, thickness: s.board?.thickness ?? null, layers, minTrace: s.traces.minWidth, minSpace: s.minClearance?.mm ?? null, spaceFrom: s.minClearance ? 'measured' : null, minDrill: s.minDrill },
    notes: s.errors > 0 ? [{ severity: 'error', rule: 'build', says: `The board’s circuit.json holds ${s.errors} error${s.errors === 1 ? '' : 's'} (tscircuit’s own checks): circuit.open lists them.` }] : [],
    refs: s.refs ?? null,
    placed: null,
  }
}

/** The board's enclosure is a part of its own — made by a print, cut or
 *  mill setup, never ordered with the board. */
function enclosureOf(bodies: string[]): { findings: Finding[]; words: string | null; bodies: string[]; setups: string[] } {
  const box = pcbNow()?.enclosure?.bodies ?? []
  if (!box.length) return { findings: [], words: null, bodies: [], setups: [] }
  const findings: Finding[] = []
  const here = box.filter((e) => bodies.some((b) => same(b, e)))
  if (here.length) findings.push({ severity: 'error', rule: 'enclosure', says: `${here.join(', ')} ${here.length === 1 ? 'is' : 'are'} the board’s enclosure, not the board: take ${here.length === 1 ? 'it' : 'them'} out of this setup and into a print, cut or mill setup.` })
  const setups = [...new Set(box.flatMap((e) => setupsFor(e).filter((s) => s.type !== 'pcb').map((s) => `${s.name} (${s.id})`)))]
  const words = setups.length ? `The enclosure (${box.join(', ')}) is made by ${setups.join(', ')}.` : `The enclosure (${box.join(', ')}) is in no setup yet: setup.add { type: "print", bodies: [${box.map((b) => JSON.stringify(b)).join(', ')}] } records how it is made.`
  if (!setups.length) findings.push({ severity: 'info', rule: 'enclosure', says: words })
  return { findings, words, bodies: box, setups }
}

const orderOut = (o: Order) => ({
  fab: o.fab.id,
  layers: o.layers,
  layersFrom: o.layersFrom,
  thickness: o.thickness,
  thicknessFrom: o.thicknessFrom,
  finish: o.finish,
  finishFrom: o.finishFrom,
  quantity: o.quantity,
  assembly: o.assembly,
})
const fabOut = (o: Order) => ({ id: o.fab.id, label: o.fab.label, typical: true, limits: o.limits, layers: o.fab.layers, thickness: o.fab.thickness, finishes: o.fab.finishes, maxSize: o.fab.maxSize, assembly: o.fab.assembly, note: o.fab.note })
const setupOut = (s: Setup | null) => (s ? { id: s.id, name: s.name, bodies: s.bodies.map(bodyNameOf) } : null)

interface DrcAnswer {
  clean: boolean
  violations: number
  unconnected: number
  items?: { severity: string | null; description: string }[]
  report?: string
}

function drcFindings(r: DrcAnswer): Finding[] {
  if (r.clean) return []
  const out: Finding[] = [{ severity: 'error', rule: 'drc', says: `DRC: ${r.violations} violation${r.violations === 1 ? '' : 's'}, ${r.unconnected} unconnected — pcb.drc lists them with where they are.` }]
  for (const i of (r.items ?? []).slice(0, 3)) out.push({ severity: i.severity === 'error' ? 'error' : 'warning', rule: 'drc', says: `DRC: ${i.description}` })
  return out
}

// ---- pcbo.check ---------------------------------------------------------------

const refIn = { setup: str('The PCB order setup, by id (S1) or name; the one the Make tab shows by default.', { minLength: 1 }), body: oneOf([str(undefined, { minLength: 1 }), num()], 'Or the board, by body name or id: its setup’s order.') }

const check: Command<{ setup?: string; body?: string | number; drc?: boolean }> = {
  name: 'check',
  title: 'Check a board for its order',
  description:
    'A board in a PCB order setup checked for the fab: the design rule check (KiCad: pcb.drc; tscircuit: the build’s and circuit.json’s own errors); its figures — size, copper layers, the narrowest trace, the least space between copper (tscircuit measures it; KiCad gives the least its .kicad_pro rules allow, which DRC holds it to), the smallest drill — against the fab profile’s typical figures (or the setup’s limits); the order’s layers, thickness, finish and assembly against what the fab usually offers; for SMT assembly, the BOM and CPL of the last pcbo.package, each part in both (and on the board). An enclosure body put in this setup is an error: it is made by its own setup. setup or body (a body in no PCB order setup: judged on the generic profile). drc: false skips the DRC. Returns verdict (ok, fix, or unknown when DRC did not run), findings worst first (severity, rule, says), the figures, the order as resolved (each value with where it came from), the fab (typical: never the fab’s own word) and the enclosure. part.review runs this for a body in a PCB order setup. Changes nothing.',
  input: obj({ ...refIn, drc: bool('Run the DRC (default true).') }),
  readOnly: true,
  long: true,
  timeoutMs: 600_000,
  run: async ({ setup, body, drc = true }) => {
    const t = targetOf({ setup, body })
    const settings = t.setup ? settingsOf(t.setup) : {}
    const src = sourceOf(settings, t.bodies)
    const findings: Finding[] = []
    const enc = enclosureOf(t.bodies)
    findings.push(...enc.findings)
    if (!t.setup) findings.push({ severity: 'info', rule: 'setup', says: `${t.bodies[0]} is in no PCB order setup: judged on the generic profile. setup.add { type: "pcb", bodies: [${JSON.stringify(t.bodies[0])}] } records its order.` })
    if (t.setup && !t.bodies.length) findings.push({ severity: 'info', rule: 'setup', says: 'The setup holds no body yet: the board open is checked.' })
    if (!src) {
      findings.push({ severity: 'error', rule: 'source', says: NO_SOURCE })
      const o = orderOf(settings, null)
      return answer(t, null, o, [...findings, ...judge(null, o)], null, { ran: false, why: 'no board' }, enc)
    }
    const fig = await figuresOf(src)
    findings.push(...fig.notes)
    const o = orderOf(settings, fig.figures)
    findings.push(...judge(fig.figures, o))
    let ran: { ran: boolean; why?: string; clean?: boolean; violations?: number; unconnected?: number; report?: string; from?: string } = { ran: false, why: 'drc: false' }
    if (drc && src === 'kicad') {
      try {
        const r = (await runCommand('pcb.drc', {})) as DrcAnswer
        findings.push(...drcFindings(r))
        ran = { ran: true, from: 'pcb.drc', clean: r.clean, violations: r.violations, unconnected: r.unconnected, ...(r.report ? { report: r.report } : {}) }
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e)
        ran = { ran: false, why }
        findings.push({ severity: 'warning', rule: 'drc', says: `DRC did not run: ${why}` })
      }
    } else if (drc) {
      const lb = circuitNow()?.lastBuild
      if (lb && !lb.ok) findings.push({ severity: 'error', rule: 'build', says: `The last tscircuit build failed${lb.failure ? `: ${lb.failure}` : ''}.` })
      ran = { ran: true, from: 'tscircuit', clean: !findings.some((f) => f.rule === 'build') }
    }
    if (o.assembly === 'smt') {
      const p = t.setup ? useOrder.getState().packaged[t.setup.id] : undefined
      if (p) findings.push(...listFindings(p.bom, p.cpl, { refs: fig.refs, placed: fig.placed }).map((f) => ({ ...f, says: `${f.says} (the package of ${p.at.slice(0, 16).replace('T', ' ')})` })))
      else findings.push({ severity: 'info', rule: 'lists', says: 'The BOM and CPL are checked once pcbo.package has gathered them.' })
    }
    return answer(t, fig.figures, o, findings, src, ran, enc)
  },
}

function answer(t: Target, figures: BoardFigures | null, o: Order, all: Finding[], src: Source | null, drc: Json, enc: ReturnType<typeof enclosureOf>) {
  const findings = worstFirst(all)
  const verdict: 'ok' | 'fix' | 'unknown' = findings.some((f) => f.severity === 'error') ? 'fix' : drc.ran ? 'ok' : 'unknown'
  if (t.setup) useOrder.setState((s) => ({ checked: { ...s.checked, [t.setup!.id]: { at: now(), verdict, findings, board: figures?.name ?? null, source: src } } }))
  return {
    setup: setupOut(t.setup),
    board: figures ? { name: figures.name, source: src, bodies: t.bodies } : null,
    verdict,
    findings,
    figures,
    drc,
    order: orderOut(o),
    fab: fabOut(o),
    ...(enc.bodies.length ? { enclosure: { bodies: enc.bodies, setups: enc.setups } } : {}),
  }
}

// ---- pcbo.package -------------------------------------------------------------

interface FabAnswer {
  file?: { bytes: Uint8Array }
  job?: string
  drc?: DrcAnswer | null
  notes?: string[]
}

const dec = new TextDecoder()
const enc8 = new TextEncoder()

/** KiCad's fab package split as a fab order wants it: the Gerbers and
 *  drill files zipped to upload, the lists and the DRC report apart. */
async function fromKicad(stem: string): Promise<{ files: { name: string; bytes: Uint8Array; what: string }[]; bom: string | null; cpl: string | null; notes: string[]; findings: Finding[]; job: string | null }> {
  let r: FabAnswer
  try {
    r = (await runCommand('pcb.fab', { naming: 'fab', drc: true })) as FabAnswer
  } catch (e) {
    if (e instanceof CommandError && e.code === 'unknown_command') throw new CommandError('failed', 'The board is KiCad’s, and this build has no Electronics › KiCad.')
    throw e
  }
  if (!r.file?.bytes?.byteLength) throw new CommandError('failed', 'KiCad gave no fab package.')
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(r.file.bytes)
  } catch {
    throw new CommandError('failed', 'KiCad’s fab package is not a zip this reads.')
  }
  const fab = Object.entries(entries).filter(([n]) => !n.includes('/') && !n.endsWith('/'))
  const one = (re: RegExp) => Object.entries(entries).find(([n]) => re.test(n))?.[1] ?? null
  const bom = one(/^assembly\/.*-bom\.csv$/i)
  const cpl = one(/^assembly\/.*-pos\.csv$/i)
  const files = [{ name: `${stem}-gerbers.zip`, bytes: zip(fab.map(([name, bytes]) => ({ name, bytes }))), what: `Gerbers and drill files (${fab.length}): upload this` }]
  for (const [n, bytes] of Object.entries(entries)) if (n.startsWith('reports/')) files.push({ name: n, bytes, what: 'KiCad’s DRC report' })
  return { files, bom: bom ? dec.decode(bom) : null, cpl: cpl ? dec.decode(cpl) : null, notes: r.notes ?? [], findings: r.drc ? drcFindings(r.drc) : [], job: r.job ?? null }
}

/** tscircuit's build, its outputs read through the agent's server: the
 *  last build when it holds them, else a build made for them. */
async function fromCircuit(stem: string, smt: boolean, rebuild: boolean): Promise<{ files: { name: string; bytes: Uint8Array; what: string }[]; bom: string | null; cpl: string | null; notes: string[]; findings: Finding[]; job: string | null }> {
  const need = ['gerbers.zip', ...(smt ? ['bom.csv', 'pick_and_place.csv'] : [])]
  const notes: string[] = []
  let lb = circuitNow()?.lastBuild ?? null
  if (circuitNow() === undefined) throw new CommandError('failed', 'The board is tscircuit’s, and this build has no Electronics › tscircuit.')
  if (rebuild || !lb || !lb.ok || need.some((f) => !lb!.files.includes(f))) {
    const j = (await runCommand('circuit.build', { outputs: ['gerbers', ...(smt ? ['bom', 'pnp'] : [])], open: false })) as { job: string; ok: boolean; files?: Record<string, string>; failure?: string }
    if (!j.ok) throw new CommandError('failed', `The tscircuit build failed${j.failure ? `: ${j.failure.replace(/\.$/, '')}` : ''}. Fix the board and package again.`)
    lb = { job: j.job, ok: true, files: Object.keys(j.files ?? {}) }
    notes.push(`Built for the order: job ${j.job}.`)
  }
  const job = lb.job
  const read = (path: string, entry?: string) => runCommand('circuit.read', { job, path, ...(entry ? { entry } : {}) }) as Promise<{ text?: string; entries?: { name: string }[] }>
  if (!lb.files.includes('gerbers.zip')) throw new CommandError('failed', 'The build made no Gerbers: circuit.build { outputs: ["gerbers"] } says why.')
  const listing = await read('gerbers.zip')
  const fab: { name: string; bytes: Uint8Array }[] = []
  for (const e of listing.entries ?? []) {
    if (/\.csv$/i.test(e.name)) continue
    const t = await read('gerbers.zip', e.name)
    if (typeof t.text === 'string') fab.push({ name: e.name, bytes: enc8.encode(t.text) })
  }
  if (!fab.length) throw new CommandError('failed', 'The build’s Gerbers zip holds no Gerber or drill file.')
  const text = async (path: string) => (lb!.files.includes(path) ? ((await read(path)).text ?? null) : null)
  return { files: [{ name: `${stem}-gerbers.zip`, bytes: zip(fab), what: `Gerbers and drill files (${fab.length}): upload this` }], bom: smt ? await text('bom.csv') : null, cpl: smt ? await text('pick_and_place.csv') : null, notes, findings: [], job }
}

const pack: Command<{ setup?: string; rebuild?: boolean }> = {
  name: 'package',
  title: 'The board’s order package',
  description:
    'Gather what a board order needs into one folder, returned as a zip (<board>-order/): <board>-gerbers.zip — the Gerbers and drill files, the one to upload; for SMT assembly, assembly/<board>-bom.csv and assembly/<board>-cpl.csv (the placement list, JLCPCB’s columns from KiCad); <board>.step — the setup’s bodies from Reverse Engineer; KiCad’s DRC report; and order.md — the order sheet: board size, layers, thickness, finish, quantity, assembly, the fab, each file, and what to put right first. From KiCad: pcb.fab (board-house names). From tscircuit: the last build when it holds the outputs, else a build for them (rebuild: true always builds). For SMT, the BOM and CPL are checked against each other and the board: parts missing from either are findings, kept for pcbo.check. The board’s enclosure is not in it: it is made by its own setup. Changes nothing in the project.',
  input: obj({ setup: refIn.setup, rebuild: bool('tscircuit: build again even when the last build holds the outputs.') }),
  readOnly: true,
  long: true,
  returnsFile: true,
  timeoutMs: 15 * 60_000,
  run: async ({ setup, rebuild = false }, ctx) => {
    const t = targetOf({ setup })
    const s = t.setup!
    const settings = settingsOf(s)
    const src = sourceOf(settings, t.bodies)
    if (!src) throw new CommandError('invalid_state', NO_SOURCE)
    const enc = enclosureOf(t.bodies)
    if (enc.findings.some((f) => f.severity === 'error')) invalid(enc.findings.find((f) => f.severity === 'error')!.says)
    useOrder.setState({ busy: 'Gathering the order…' })
    try {
      const fig = await figuresOf(src)
      const o = orderOf(settings, fig.figures)
      const smt = o.assembly === 'smt'
      const stem = safe(fig.figures.name)
      ctx.progress(src === 'kicad' ? 'KiCad: the fab files…' : 'tscircuit: the build’s files…')
      const got = src === 'kicad' ? await fromKicad(stem) : await fromCircuit(stem, smt, rebuild)
      const files: { name: string; bytes: Uint8Array; what: string }[] = [...got.files]
      const findings: Finding[] = [...fig.notes, ...judge(fig.figures, o), ...got.findings]
      const notes = [...got.notes]
      let bomRefs: string[] | null = null
      let cplRefs: string[] | null = null
      if (smt) {
        if (got.bom !== null) files.push({ name: `assembly/${stem}-bom.csv`, bytes: enc8.encode(got.bom), what: 'BOM: the parts list' })
        if (got.cpl !== null) files.push({ name: `assembly/${stem}-cpl.csv`, bytes: enc8.encode(got.cpl), what: 'CPL: where each part is placed' })
        bomRefs = got.bom === null ? null : refsIn(got.bom)
        cplRefs = got.cpl === null ? null : refsIn(got.cpl)
        if (got.bom !== null && bomRefs === null) notes.push('The BOM has no designator column: its parts are not checked.')
        if (got.cpl !== null && cplRefs === null) notes.push('The CPL has no designator column: its parts are not checked.')
        findings.push(...listFindings(got.bom === null ? null : (bomRefs ?? []), got.cpl === null ? null : (cplRefs ?? []), { refs: fig.refs, placed: fig.placed }))
      } else notes.push('Assembly none: no BOM or CPL in the package.')
      // The board as a solid, for whoever makes what goes round it.
      if (t.bodies.length) {
        ctx.progress('The board as STEP…')
        try {
          const st = (await runCommand('reverse.export.step', { bodies: t.bodies })) as { file?: { bytes: Uint8Array } }
          if (st.file?.bytes?.byteLength) files.push({ name: `${stem}.step`, bytes: st.file.bytes, what: 'The board as a solid (STEP), from Reverse Engineer' })
        } catch (e) {
          notes.push(`No STEP: ${e instanceof Error ? e.message : String(e)}`)
        }
      } else notes.push('No STEP: the setup holds no body.')
      const sorted = worstFirst(findings)
      const sheetFiles: SheetFile[] = files.map((f) => ({ name: f.name, what: f.what }))
      const sheet = orderSheet({ setup: s.name, board: fig.figures, source: src === 'kicad' ? 'KiCad' : 'tscircuit', order: o, files: [...sheetFiles, { name: 'order.md', what: 'this sheet' }], findings: sorted, enclosure: enc.words })
      const folder = `${stem}-order`
      const all = [...files.map((f) => ({ name: `${folder}/${f.name}`, bytes: f.bytes })), { name: `${folder}/order.md`, bytes: enc8.encode(sheet) }]
      const names = all.map((f) => f.name)
      useOrder.setState((x) => ({ packaged: { ...x.packaged, [s.id]: { at: now(), name: `${folder}.zip`, files: names, bom: bomRefs, cpl: cplRefs, findings: sorted } } }))
      return {
        file: { name: `${folder}.zip`, mimeType: 'application/zip', bytes: zip(all) },
        folder,
        files: names,
        setup: setupOut(s),
        board: { name: fig.figures.name, source: src },
        order: orderOut(o),
        ...(got.job ? { job: got.job } : {}),
        findings: sorted,
        notes,
        sheet,
        status: `${names.length} files in ${folder}.zip${sorted.some((f) => f.severity === 'error') ? ` — ${sorted.filter((f) => f.severity === 'error').length} to put right first (findings)` : ''}.`,
      }
    } finally {
      useOrder.setState({ busy: null })
    }
  },
}

export const pcboCommands = ([check, pack] as Command<never>[]).map((c) => ({ ...c, headless: true }))
