// SPDX-License-Identifier: AGPL-3.0-only
// The Boards workspace's commands (pcb.*): a KiCad board read, brought into
// Reverse Engineer as bodies (the board named after its file, its edge
// connectors after their references), an enclosure made round it with
// Generate's board_box, and its fabrication package and DRC — KiCad's
// kicad-cli doing the KiCad work on this computer, through the agent's
// server.

import { runCommand, runWithin } from '../../../src/commands/registry'
import { anyObject, arr, bool, bytes, enumOf, num, obj, oneOf, str } from '../../../src/commands/schema'
import { readStateSections } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { boardIn, boardSpecOf, connectorBoxes, placeBodies, type BodyRow, type KicadBoard } from '../core/boardSpec'
import { answered, askServer, Cancelled, progressed } from './pcbAsk'
import { usePcb, type DrcResult, type FabResult, type Imported, type Naming, type Tools } from '../state/pcbStore'

const st = () => usePcb.getState()
const invalid = (m: string): never => {
  throw new CommandError('invalid_input', m)
}
const r2 = (x: number) => Math.round(x * 100) / 100
const now = () => new Date().toISOString()

/** The asks running, for Stop. */
const running = new Set<AbortController>()
function stopper(signal?: AbortSignal) {
  const ctl = new AbortController()
  const onAbort = () => ctl.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  running.add(ctl)
  return { signal: ctl.signal, done: () => (running.delete(ctl), signal?.removeEventListener('abort', onAbort)) }
}

/** An ask of the server, the panel told what is under way; its failure as
 *  a command's. */
async function ask(action: Parameters<typeof askServer>[0], data: Record<string, unknown>, what: string, ctx: { progress(t: string): void; signal?: AbortSignal }, timeoutMs?: number) {
  const s = stopper(ctx.signal)
  usePcb.setState({ busy: what, progress: '' })
  try {
    return await askServer(action, data, {
      signal: s.signal,
      ...(timeoutMs ? { timeoutMs } : {}),
      progress: (_phase, detail) => {
        usePcb.setState({ progress: detail })
        ctx.progress(detail)
      },
    })
  } catch (e) {
    if (e instanceof Cancelled) throw new CommandError('failed', 'Stopped.')
    throw new CommandError('failed', e instanceof Error ? e.message : String(e))
  } finally {
    s.done()
    if (!running.size) usePcb.setState({ busy: null, progress: '' })
  }
}

const pathIn = str('The board: the full path of its .kicad_pcb file on this computer; the one open by default.', { minLength: 1 })

function pathOf(given?: string): string {
  const p = (given ?? st().path).trim()
  if (!p) invalid('No board: give path, the .kicad_pcb file (pcb.open).')
  if (!/\.kicad_pcb$/i.test(p)) invalid(`${p.split(/[\\/]/).pop()} is not a KiCad board — give the .kicad_pcb file.`)
  return p
}

/** What the page keeps of a board: the read, without its parts list. */
function kept(u: unknown): KicadBoard {
  const b = boardIn(u)
  return { name: b.name, file: b.file, schematic: b.schematic ?? null, thickness: b.thickness, origin: b.origin, size: b.size, outline: b.outline, holes: b.holes, connectors: b.connectors, footprints: b.footprints }
}

const boardOut = (b: KicadBoard) => ({
  name: b.name,
  file: b.file,
  size: b.size.map(r2),
  thickness: b.thickness,
  holes: b.holes.map((h) => ({ ref: h.ref, x: h.x, y: h.y, d: h.d })),
  connectors: b.connectors.map((c) => ({ ref: c.ref, kind: c.kind, side: c.side, centre: c.centre, face: c.face, opening: c.opening })),
  footprints: b.footprints,
})

interface ReverseBody extends BodyRow {}
const reverseBodies = (): ReverseBody[] => (readStateSections().reverse as { bodies?: ReverseBody[] } | undefined)?.bodies ?? []

export function describePcb() {
  const s = st()
  return {
    setup: { path: s.path, components: s.components, subst: s.subst, naming: s.naming, enclosure: s.enclosure, above: s.above, below: s.below, skip: s.skip },
    ...(s.board ? { board: boardOut(s.board) } : {}),
    ...(s.imported ? { imported: { at: s.imported.at, body: s.imported.body, bodies: s.imported.bodies, above: r2(s.imported.above), below: r2(s.imported.below), connectors: Object.keys(s.imported.boxes) } } : {}),
    ...(s.enclosureMade ? { enclosure: s.enclosureMade } : {}),
    ...(s.fab ? { fab: { at: s.fab.at, zip: s.fab.zip, drc: s.fab.drc } } : {}),
    ...(s.drc ? { drc: { at: s.drc.at, clean: s.drc.clean, violations: s.drc.violations, unconnected: s.drc.unconnected } } : {}),
    ...(s.busy ? { busy: s.busy } : {}),
  }
}

const tools: Command<{ fresh?: boolean }> = {
  name: 'tools',
  title: 'KiCad on this computer',
  description: 'Whether KiCad’s kicad-cli is found on this computer (through the agent’s server), its version, and which of the commands used here its --help shows with the flags they need — STEP, Gerbers, drill, placement, DRC and the parts list (the last two KiCad 8 and later). fresh: look again. Changes nothing.',
  input: obj({ fresh: bool('Look again rather than answer what was found.') }),
  readOnly: true,
  run: async ({ fresh }, ctx) => {
    const { result } = await ask('tools', { fresh: fresh === true }, 'Looking for KiCad…', ctx, 120_000)
    usePcb.setState({ tools: result as Tools })
    return result as Record<string, unknown>
  },
}

const open: Command<{ path: string }> = {
  name: 'open',
  title: 'Open a KiCad board',
  description: 'Read a .kicad_pcb (no KiCad needed): its outline, thickness, mounting holes and the connectors at its edge — each with the side it faces and the opening a wall needs for it, a typical size labelled so. Brings nothing in (pcb.import does). Coordinates in mm, centred on the outline’s box, y up, the board’s bottom at z = 0. One undo step.',
  input: obj({ path: pathIn }, ['path']),
  long: true,
  label: ({ path }) => `open ${String(path).split(/[\\/]/).pop()}`,
  run: async ({ path }, ctx) => {
    const p = pathOf(path)
    const { result } = await ask('read', { path: p }, 'Reading the board…', ctx, 60_000)
    const board = kept(result)
    const same = st().path === p
    st().set({ path: p, board, ...(same ? {} : { imported: null, enclosureMade: null, skip: [] }) })
    return { board: boardOut(board) }
  },
}

const importCmd: Command<{ path?: string; components?: boolean; subst?: boolean; dnp?: boolean }> = {
  name: 'import',
  title: 'Bring the board into Reverse Engineer',
  description:
    'Export the board as STEP with kicad-cli and bring it into Reverse Engineer: the board a body named after its file (coloured green), each part a body of its own, the edge connectors named after their references ("board J1"). components: false brings the bare board only; subst (default true) uses KiCad’s STEP models where a footprint names a VRML one. Measures how far the parts reach above and below the board, and each edge connector’s 3D box, for pcb.enclosure. Returns the bodies, those measurements and kicad-cli’s warnings (3D models it could not find). One undo step.',
  input: obj({ path: pathIn, components: bool('With the parts (default: as set, true).'), subst: bool('STEP models for VRML ones (default: as set, true).'), dnp: bool('Keep parts marked do-not-populate (default false).') }),
  long: true,
  timeoutMs: 900_000,
  label: () => 'import board',
  run: async ({ path, components, subst, dnp }, ctx) => {
    const p = pathOf(path)
    const withParts = components ?? st().components
    const subs = subst ?? st().subst
    ctx.progress('kicad-cli: exporting the board as STEP…')
    const { result, bytes: step } = await ask('import', { path: p, components: withParts, subst: subs, dnp: dnp === true }, 'Exporting the board…', ctx)
    if (!step?.byteLength) throw new CommandError('failed', 'kicad-cli gave no STEP.')
    const r = result as { board: unknown; kicad?: string; warnings?: string[]; step?: { name?: string } }
    const board = kept(r.board)
    ctx.signal?.throwIfAborted()
    const before = reverseBodies()
    const had = new Set(before.map((b) => b.id))
    ctx.progress('Bringing the board into Reverse Engineer…')
    await runWithin('reverse.import.step', { bytes: step, name: `${board.name}.step` })
    const fresh = reverseBodies().filter((b) => !had.has(b.id))
    const placed = placeBodies(board, fresh)
    // Names: the board after its file, its edge connectors after their references.
    const taken = new Set([...before, ...fresh].map((b) => b.name.toLowerCase()))
    const rename = async (b: BodyRow, want0: string, color?: string) => {
      taken.delete(b.name.toLowerCase())
      let want = want0
      for (let n = 2; taken.has(want.toLowerCase()); n++) want = `${want0} ${n}`
      try {
        await runWithin('reverse.body.set', { body: b.id, name: want, ...(color ? { color } : {}) })
      } catch {
        want = b.name
      }
      taken.add(want.toLowerCase())
      return want
    }
    const boardBody = placed.board ? await rename(placed.board, board.name, '#2e7d32') : null
    const named: Record<string, string> = {}
    for (const [ref, b] of Object.entries(placed.connectors)) named[ref] = await rename(b, `${board.name} ${ref}`)
    const imported: Imported = {
      at: now(),
      body: boardBody,
      bodies: fresh.length,
      components: withParts,
      above: placed.above,
      below: placed.below,
      offset: placed.offset,
      boxes: connectorBoxes(placed),
      kicad: r.kicad ?? null,
      warnings: (r.warnings ?? []).slice(0, 30),
    }
    const same = st().path === p
    st().set({ path: p, board, imported, components: withParts, subst: subs, ...(same ? {} : { enclosureMade: null, skip: [] }) })
    const off = placed.offset.some((x) => Math.abs(x) > 0.05)
    return {
      board: boardBody,
      bodies: fresh.length,
      connectors: named,
      above: r2(placed.above),
      below: r2(placed.below),
      ...(off ? { offset: placed.offset.map(r2), note: 'The board came in off where it was asked to (its middle or bottom not at 0): the enclosure is moved to match.' } : {}),
      ...(boardBody ? {} : { note: 'No body the board’s size was found among those brought in: the enclosure is made in the board’s own frame.' }),
      warnings: imported.warnings,
      kicad: imported.kicad,
      status: `${board.name}: ${fresh.length} bodies in Reverse Engineer.`,
    }
  },
}

/** board_box's parameters, from Generate: its keys, kinds and ranges. */
async function boxParams(): Promise<{ key: string; kind: string; min?: number; max?: number }[]> {
  try {
    const r = (await runCommand('gen.list', { generator: 'board_box' })) as { generators: { params: { key: string; kind: string; min?: number; max?: number }[] }[] }
    return r.generators[0].params
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    throw new CommandError('failed', /no command|There is no command|board_box/i.test(m) ? 'The enclosure is made by the Generate workspace, which this build does not have.' : m)
  }
}

const set: Command<{ path?: string; components?: boolean; subst?: boolean; naming?: Naming; above?: number | null; below?: number | null; skip?: string[]; enclosure?: Record<string, unknown>; reset?: boolean }> = {
  name: 'set',
  title: 'Board and enclosure settings',
  description:
    'Settings the panel shows: components and subst for pcb.import; naming for pcb.fab (fab: Protel extensions and JLCPCB column names, which JLCPCB and PCBWay read; kicad: KiCad’s own); above and below — how far the parts reach, mm, null to measure on import; skip — edge connectors (by reference) to leave without an opening; enclosure — values for the enclosure (Generate’s board_box: wall, floor, lid, lip, clearance, corner, gap, standoff, headroom, inserts, cutouts, margin; gen.list { generator: "board_box" } gives their ranges), merged into those set; reset: the enclosure’s values back to the defaults. One undo step.',
  input: obj({
    path: pathIn,
    components: bool('Import with the parts.'),
    subst: bool('STEP models for VRML ones.'),
    naming: enumOf(['fab', 'kicad'], 'The fab package’s file names.'),
    above: oneOf([num('mm', { minimum: 0, maximum: 200 }), { type: 'null' }], 'Parts’ reach above the board, mm; null: measured.'),
    below: oneOf([num('mm', { minimum: 0, maximum: 100 }), { type: 'null' }], 'Parts’ reach below the board, mm; null: measured.'),
    skip: arr(str(), 'Edge connectors, by reference, to leave without an opening.', { maxItems: 64 }),
    enclosure: anyObject('board_box values by key.'),
    reset: bool('The enclosure’s values back to the defaults.'),
  }),
  label: () => 'board settings',
  run: async ({ path, components, subst, naming, above, below, skip, enclosure, reset }) => {
    const out: Record<string, unknown> = {}
    if (path !== undefined) {
      const p = pathOf(path)
      if (p !== st().path) st().set({ path: p, board: null, imported: null, enclosureMade: null, skip: [] })
    }
    if (components !== undefined) st().set({ components })
    if (subst !== undefined) st().set({ subst })
    if (naming !== undefined) st().set({ naming })
    if (above !== undefined) st().set({ above })
    if (below !== undefined) st().set({ below })
    if (skip !== undefined) st().set({ skip: [...new Set(skip.map((s) => s.trim()).filter(Boolean))].slice(0, 64) })
    if (enclosure !== undefined || reset) {
      const params = await boxParams()
      const next: Record<string, number | boolean> = reset ? {} : { ...st().enclosure }
      for (const [k, v] of Object.entries(enclosure ?? {})) {
        const p = params.find((q) => q.key === k)
        if (!p) invalid(`The enclosure has no "${k}" (it has ${params.map((q) => q.key).join(', ')}).`)
        if (p!.kind === 'bool') {
          if (typeof v !== 'boolean') invalid(`${k} is true or false.`)
        } else if (typeof v !== 'number' || !Number.isFinite(v) || (p!.min !== undefined && v < p!.min) || (p!.max !== undefined && v > p!.max)) invalid(`${k}: a number, ${p!.min} to ${p!.max}.`)
        next[k] = v as number | boolean
      }
      st().set({ enclosure: next })
      out.enclosure = next
    }
    const s = st()
    return { ...out, path: s.path, components: s.components, subst: s.subst, naming: s.naming, above: s.above, below: s.below, skip: s.skip }
  },
}

/** The board as the enclosure takes it, from what was read and imported. */
function specNow(above?: number | null, below?: number | null) {
  const s = st()
  if (!s.board) invalid('No board: open one (pcb.open) or import it (pcb.import) first.')
  return boardSpecOf(s.board!, { above: above !== undefined ? above : s.above, below: below !== undefined ? below : s.below, measured: s.imported?.components ? { above: s.imported.above, below: s.imported.below } : null, boxes: s.imported?.boxes, skip: s.skip })
}

const plan: Command<{ params?: Record<string, unknown>; above?: number; below?: number }> = {
  name: 'plan',
  title: 'The enclosure, worked out',
  description: 'What pcb.enclosure would make, without making it: the board as the enclosure takes it (outline, thickness, the parts’ reach, holes and the openings with their sizes — typical ones said so), each standoff (screw size, insert or pilot hole, depth) and the box’s and lid’s sizes. params override the enclosure’s values for this one look. Changes nothing.',
  input: obj({ params: anyObject('board_box values by key, for this look only.'), above: num('mm', { minimum: 0, maximum: 200 }), below: num('mm', { minimum: 0, maximum: 100 }) }),
  readOnly: true,
  long: true,
  timeoutMs: 300_000,
  run: async ({ params, above, below }) => {
    const { spec, notes } = specNow(above, below)
    const measured = (await runCommand('gen.measure', { generator: 'board_box', params: { ...st().enclosure, ...(params ?? {}) }, board: spec })) as Record<string, unknown>
    return { board: spec, notes, ...measured }
  },
}

const enclosure: Command<{ params?: Record<string, unknown>; name?: string; above?: number; below?: number }> = {
  name: 'enclosure',
  title: 'Make an enclosure round the board',
  description:
    'Make a box round the board with Generate’s board_box and bring it into Reverse Engineer: standoffs under the mounting holes (heat-set insert holes, or pilots for self-tapping screws; screw size from the hole), room for the parts above and below (measured on import, or set: above, below), an opening in the wall for each edge connector (typical sizes for USB-C, micro-USB, barrel jack, pin header, JST and others; any other sized by its 3D model), and a lid on a lip, laid beside it. Made where the board is, so it stands round it. params: board_box values for this make (merged over those set with pcb.set). Returns the bodies, the openings and standoffs, and what was guessed. One undo step.',
  input: obj({ params: anyObject('board_box values by key.'), name: str('What to call the bodies (up to 60 characters).', { minLength: 1 }), above: num('mm', { minimum: 0, maximum: 200 }), below: num('mm', { minimum: 0, maximum: 100 }) }),
  long: true,
  timeoutMs: 300_000,
  label: () => 'make enclosure',
  run: async ({ params, name, above, below }, ctx) => {
    const { spec, notes } = specNow(above, below)
    if (name !== undefined && (!name.trim() || name.length > 60)) invalid('name: 1 to 60 characters.')
    ctx.progress('Building the enclosure…')
    usePcb.setState({ busy: 'Building the enclosure…' })
    let made: { bodies: string[]; plan?: unknown; parts?: unknown }
    try {
      made = (await runWithin('gen.make', { generator: 'board_box', params: { ...st().enclosure, ...(params ?? {}) }, board: spec, ...(name ? { name: name.trim() } : {}) }, ctx)) as typeof made
      const off = st().imported?.offset
      if (off && off.some((x) => Math.abs(x) > 0.05)) await runWithin('reverse.feature.add', { kind: 'moveBody', name: 'Enclosure to the board', bodies: made.bodies, translate: off }, ctx)
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      if (e instanceof CommandError && e.code === 'unknown_command') throw new CommandError('failed', 'The enclosure is made by the Generate workspace, which this build does not have.')
      throw e instanceof CommandError ? e : new CommandError('failed', m)
    } finally {
      if (!running.size) usePcb.setState({ busy: null })
    }
    st().set({ enclosureMade: { at: now(), bodies: made.bodies } })
    return { bodies: made.bodies, openings: spec.openings, holes: spec.holes, above: spec.above, below: spec.below, plan: made.plan, parts: made.parts, notes, status: `Enclosure: ${made.bodies.join(', ')} in Reverse Engineer.` }
  },
}

const fab: Command<{ path?: string; naming?: Naming; drc?: boolean; dnp?: boolean }> = {
  name: 'fab',
  title: 'The board’s fabrication package',
  description:
    'With kicad-cli: Gerbers (copper, mask, silkscreen, paste, outline), Excellon drill files in mm with plated and unplated holes apart, the placement list (CSV, mm), the parts list from the schematic beside the board (KiCad 8 and later) and the DRC report (drc: false to leave it out) — written to a job folder under the ScanRuler folder’s boards/ and returned as one zip. naming: fab (Protel extensions and JLCPCB’s column names, the default as set) or kicad. A second zip with the Gerbers and drill files alone waits in the job folder, to upload. Changes nothing in the project.',
  input: obj({ path: pathIn, naming: enumOf(['fab', 'kicad'], 'File names; as set by default.'), drc: bool('Run the DRC into the package (default true).'), dnp: bool('Keep do-not-populate parts in the lists.') }),
  readOnly: true,
  long: true,
  returnsFile: true,
  timeoutMs: 900_000,
  run: async ({ path, naming, drc, dnp }, ctx) => {
    const p = pathOf(path)
    const n = naming ?? st().naming
    const { result, bytes: zip } = await ask('fab', { path: p, naming: n, drc: drc !== false, dnp: dnp === true }, 'Making the fab package…', ctx)
    if (!zip?.byteLength) throw new CommandError('failed', 'kicad-cli gave no package.')
    const r = result as FabResult & { board: string }
    usePcb.setState({ fab: { at: now(), zip: r.zip, gerberZip: r.gerberZip, job: r.job, files: r.files, naming: n, drc: r.drc, notes: r.notes ?? [] } })
    return { file: { name: `${r.board}-fab.zip`, mimeType: 'application/zip', bytes: zip }, job: r.job, gerbers: r.gerberZip, files: r.files, drc: r.drc, notes: r.notes }
  },
}

const drc: Command<{ path?: string; parity?: boolean }> = {
  name: 'drc',
  title: 'Check the board’s design rules',
  description: 'Run KiCad’s design rule check on the board (kicad-cli pcb drc, KiCad 8 and later): violations and unconnected items by severity and kind, the first 50 with where they are (KiCad’s coordinates, mm), and the report’s path. parity: check against the schematic too. Changes nothing.',
  input: obj({ path: pathIn, parity: bool('Check against the schematic too.') }),
  readOnly: true,
  long: true,
  timeoutMs: 600_000,
  run: async ({ path, parity }, ctx) => {
    const p = pathOf(path)
    const { result } = await ask('drc', { path: p, parity: parity === true }, 'Checking the design rules…', ctx)
    const r = result as DrcResult
    usePcb.setState({ drc: { at: now(), clean: r.clean, violations: r.violations, unconnected: r.unconnected, bySeverity: r.bySeverity, items: (r.items ?? []).slice(0, 50), report: r.report } })
    return result as Record<string, unknown>
  },
}

const close: Command<Record<string, never>> = {
  name: 'close',
  title: 'Put the board away',
  description: 'Forget the board open here and what its import measured; the bodies stay in Reverse Engineer, the settings stay. One undo step.',
  input: obj({}),
  label: () => 'close board',
  run: async () => {
    const had = !!st().board || !!st().path
    st().set({ path: '', board: null, imported: null, enclosureMade: null, skip: [] })
    usePcb.setState({ fab: null, drc: null })
    return { closed: had }
  },
}

const stopCmd: Command<Record<string, never>> = {
  name: 'stop',
  title: 'Stop KiCad',
  description: 'Stop what kicad-cli is doing for this page, if anything: nothing more is brought in.',
  input: obj({}),
  interrupts: true,
  history: false,
  run: async () => {
    const was = running.size
    for (const c of running) c.abort()
    running.clear()
    usePcb.setState({ busy: null, progress: '' })
    return { stopped: was > 0 }
  },
}

const answer: Command<{ req: string; ok: boolean; result?: unknown; error?: string; bytes?: Uint8Array }> = {
  name: 'answer',
  title: 'KiCad’s answer',
  description: 'Used by the agent’s server: the answer to what the Boards workspace asked of kicad-cli. Not for an agent.',
  input: obj({ req: str(), ok: bool(), result: anyObject('The answer.'), error: str(), bytes: bytes('A file that came with it.') }, ['req', 'ok']),
  readOnly: true,
  history: false,
  internal: true,
  run: async (a) => ({ taken: answered(a) }),
}

const progress: Command<{ req: string; phase: string; detail?: string }> = {
  name: 'progress',
  title: 'How far KiCad has got',
  description: 'Used by the agent’s server: how far a kicad-cli run has got. Not for an agent.',
  input: obj({ req: str(), phase: str(), detail: str() }, ['req', 'phase']),
  readOnly: true,
  history: false,
  internal: true,
  run: async (p) => ({ taken: progressed(p) }),
}

export const pcbCommands = [tools, open, importCmd, set, plan, enclosure, fab, drc, close, stopCmd, answer, progress] as Command<never>[]
