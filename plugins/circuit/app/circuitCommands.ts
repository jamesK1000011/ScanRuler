// SPDX-License-Identifier: AGPL-3.0-only
// The Circuit workspace's commands (circuit.*): tscircuit on this computer
// (tools), a project from a template (new), a build with tsci into a job
// folder (build, files), a circuit.json read in (open), its figures (stats),
// a resistance estimate per net (resistance), and the board brought into
// Reverse Engineer as solids — the board, its copper, the components'
// keep-outs (bodies). The panel's every control runs one of these.

import { runCommand, runWithin } from '../../../src/commands/registry'
import { anyObject, arr, bool, enumOf, num, obj, str } from '../../../src/commands/schema'
import { readStateSections } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { SOLID_DEFAULTS, type Part } from '../core/boardSolids'
import { CircuitJsonError, readCircuitJson } from '../core/circuitJson'
import { netsOf, piecesOf, statsOf } from '../core/geometry'
import { conductorOf, CONDUCTORS, resistanceByNet } from '../core/resistance'
import { answered, askServer, Cancelled, progressed } from './circuitAsk'
import { build as buildSolidsInWorker, stop as stopWorker } from './circuitClient'
import { DEFAULT_SETTINGS, setupOf, useCircuit, type LastBuild, type Loaded } from '../state/circuitStore'

const st = () => useCircuit.getState()
const r3 = (x: number) => Math.round(x * 1000) / 1000
const sig = (x: number) => Number(x.toPrecision(4))

const TEMPLATES = ['blank', 'led', 'pico_carrier', 'esp32_carrier', 'enclosure'] as const
const OUTPUTS = ['gerbers', 'bom', 'pnp', 'kicad_pcb', 'step', 'glb', 'pcb_svg', 'schematic_svg', 'netlist'] as const

/** Server asks running now, to stop. */
const asks = new Set<AbortController>()
async function ask<T>(action: Parameters<typeof askServer>[0], args: Record<string, unknown>, ctx?: { progress(t: string): void; signal?: AbortSignal }): Promise<T> {
  const ctl = new AbortController()
  const off = () => ctl.abort()
  ctx?.signal?.addEventListener('abort', off, { once: true })
  asks.add(ctl)
  try {
    return await askServer<T>(action, args, { signal: ctl.signal, progress: (phase, detail) => ctx?.progress(detail || phase) })
  } catch (e) {
    if (e instanceof Cancelled) throw new CommandError('failed', 'Stopped.')
    // A failed build's job comes with its error: kept for the caller.
    const result = (e as { result?: unknown } | null)?.result
    throw Object.assign(new CommandError('failed', e instanceof Error ? e.message : String(e)), result ? { result } : {})
  } finally {
    asks.delete(ctl)
    ctx?.signal?.removeEventListener('abort', off)
  }
}

/** The board read in, or why there is none. */
function loaded(): Loaded {
  const l = st().loaded
  if (!l) throw new CommandError('invalid_state', 'No board is open: circuit.open a circuit.json, or circuit.build a project first.')
  return l
}

const statsOut = (s: ReturnType<typeof statsOf>) => ({
  board: s.board && { width: r3(s.board.width), height: r3(s.board.height), thickness: r3(s.board.thickness), area: r3(s.board.area), shaped: s.board.shaped },
  layers: s.layers,
  traces: { count: s.traces.count, segments: s.traces.segments, length: r3(s.traces.length), byLayer: Object.fromEntries(Object.entries(s.traces.byLayer).map(([k, v]) => [k, r3(v)])), minWidth: s.traces.minWidth === null ? null : r3(s.traces.minWidth), tapered: s.traces.tapered },
  pads: s.pads,
  platedHoles: s.platedHoles,
  holes: s.holes,
  vias: s.vias,
  components: s.components,
  pours: s.pours,
  minDrill: s.minDrill === null ? null : r3(s.minDrill),
  nets: s.nets,
  minClearance: s.minClearance && { ...s.minClearance, mm: r3(s.minClearance.mm) },
  errors: s.errors,
  warnings: s.warnings,
})

const partOut = (p: Part) => ({ name: p.name, kind: p.kind, volume: r3(p.volume), size: p.box.max.map((x, i) => r3(x - p.box.min[i])), min: p.box.min.map(r3) })

export function describeCircuit() {
  const s = st()
  return {
    settings: s.settings,
    project: s.project,
    lastBuild: s.lastBuild,
    tools: s.tools.checked ? { ready: s.tools.ready, version: s.tools.version } : null,
    ...(s.loaded ? { loaded: { name: s.loaded.name, from: s.loaded.from, elements: Object.values(s.loaded.board.counts).reduce((a, b) => a + b, 0), problems: s.loaded.board.problems.length, errors: s.loaded.board.errors.length, warnings: s.loaded.board.warnings.length, stats: statsOut(s.loaded.stats) } } : {}),
    ...(s.made ? { made: { bodies: s.made.bodies, notes: s.made.notes } } : {}),
  }
}

// ---- tscircuit on this computer ---------------------------------------------------

interface ToolsAnswer {
  ready: boolean
  tsci: { path: string; via: string; version: string | null } | null
  howTo?: string
  templates?: unknown[]
}

const tools: Command<Record<string, never>> = {
  name: 'tools',
  title: 'Is tscircuit installed',
  description: 'Ask the agent’s server whether tscircuit’s command line (tsci) is installed on this computer: its path, version, the build flags and export formats its --help lists, how to install it when not (npm install -g tscircuit), and the project templates circuit.new makes. Needs the agent connection. Changes nothing.',
  input: obj({}),
  readOnly: true,
  long: true,
  timeoutMs: 360_000,
  run: async (_i, ctx) => {
    const a = await ask<ToolsAnswer>('tools', {}, ctx)
    useCircuit.setState({ tools: { ready: a.ready, version: a.tsci?.version ?? null, path: a.tsci?.path ?? null, howTo: a.howTo ?? null, checked: true } })
    return a
  },
}

// ---- a project ---------------------------------------------------------------------

interface NewAnswer {
  project: string
  entry: string
  values: Record<string, unknown>
  files: string[]
}

/** The Generate workspace's project box as set there, as the enclosure
 *  template takes it: its inside, inside corner, and its corner bosses as
 *  keep-outs where it has screws. The bosses stand as gen's enclosure.ts
 *  puts them: radius 3.5 mm, 0.4 mm into both walls, or on the diagonal
 *  into a round wider than a boss. */
async function fromBox(): Promise<Record<string, unknown>> {
  let v: Record<string, unknown>
  try {
    const r = (await runWithin('gen.list', { generator: 'project_box' })) as { generators: { values: Record<string, unknown> }[] }
    v = r.generators[0].values
  } catch {
    throw new CommandError('invalid_state', 'fromBox takes the Generate workspace’s project box, and Generate is not in this build.')
  }
  const n = (k: string) => Number(v[k])
  const [width, depth, corner, wall] = [n('width'), n('depth'), n('corner'), n('wall')]
  const BOSS = 3.5
  const inR = Math.max(0, corner - wall)
  const keepouts: { x: number; y: number; r: number }[] = []
  if (v.screws === true) {
    const cx = width / 2 - wall - inR
    const cy = depth / 2 - wall - inR
    const off = inR > BOSS - 0.4 ? (inR - BOSS + 0.4) / Math.SQRT2 : inR - BOSS + 0.4
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) keepouts.push({ x: sx * (cx + off), y: sy * (cy + off), r: BOSS })
  }
  return { inside_width: width - 2 * wall, inside_depth: depth - 2 * wall, corner: inR, keepouts }
}

const newProject: Command<{ name: string; template?: string; params?: Record<string, unknown>; dir?: string; fromBox?: boolean }> = {
  name: 'new',
  title: 'Start a board project',
  description:
    'Make a tscircuit project folder on this computer from a template — package.json, tsconfig.json and the board in index.circuit.tsx — and make it the workspace’s project: blank (a board of a size, M3 corner holes), led (a header, a resistor sized for the LED, the LED), pico_carrier and esp32_carrier (sockets for a Raspberry Pi Pico or an ESP32-DevKitC, a power LED, holes), enclosure (a board the size of a box’s inside less a clearance, notched round keep-out circles). params: the template’s values (circuit.tools lists them; lengths in mm). fromBox: true fills the enclosure template from the Generate workspace’s project box as set — its inside, corner and screw bosses. In the ScanRuler folder’s circuits/ unless dir is given. Then edit the .tsx and circuit.build.',
  input: obj(
    {
      name: str('The project’s name and folder: letters, digits, . _ -.', { minLength: 1 }),
      template: enumOf(TEMPLATES, 'blank by default.'),
      params: anyObject('The template’s values by key.'),
      dir: str('The folder to make it in, if not the circuits folder.'),
      fromBox: bool('enclosure: take the size and bosses from Generate’s project box.'),
    },
    ['name'],
  ),
  long: true,
  timeoutMs: 120_000,
  label: ({ name }) => `new board ${name}`,
  run: async ({ name, template = 'blank', params, dir, fromBox: box }, ctx) => {
    if (box && template !== 'enclosure') throw new CommandError('invalid_input', 'fromBox goes with the enclosure template.')
    const p = box ? { ...(await fromBox()), ...(params ?? {}) } : params
    const a = await ask<NewAnswer>('new', { name, template, ...(p ? { params: p } : {}), ...(dir ? { dir } : {}) }, ctx)
    useCircuit.setState({ project: { folder: a.project, entry: a.entry } })
    return a
  },
}

interface JobAnswer {
  job: string
  folder: string
  ok: boolean
  seconds?: number
  files?: Record<string, string>
  exportsFailed?: { format: string; said: string }[]
  summary?: { errorCount?: number; warningCount?: number; errors?: { type: string; message: string }[] }
}

const lastOf = (j: JobAnswer): LastBuild => ({
  job: j.job,
  folder: j.folder,
  ok: j.ok,
  files: Object.keys(j.files ?? {}),
  errors: (j.summary?.errors ?? []).slice(0, 20),
  warnings: j.summary?.warningCount ?? 0,
  failed: (j.exportsFailed ?? []).map((f) => f.format),
  seconds: j.seconds ?? null,
})

const buildCmd: Command<{ project?: string; entry?: string; outputs?: string[]; routing?: boolean; partsEngine?: boolean; open?: boolean }> = {
  name: 'build',
  title: 'Build the project with tscircuit',
  description:
    'Build the project with tsci on this computer, into a job folder of its own: circuit.json, and the outputs asked for — gerbers (a zip), bom and pnp (bom.csv and pick_and_place.csv, from the Gerbers zip), kicad_pcb (for KiCad, or the Boards workspace: pcb.open with files["board.kicad_pcb"]), step, glb, pcb_svg, schematic_svg, netlist. Every flag and format is checked against the installed tsci first and refused by name if it lacks one. project: the workspace’s project unless given (a name in the circuits folder, or a folder). routing: false skips the autorouter; partsEngine: false skips the parts lookup. open (true by default) opens the board built (circuit.open). Returns the job: its files and the build’s DRC, routing and placement errors.',
  input: obj({
    project: str('A project name or folder; the workspace’s project by default.'),
    entry: str('The board file, relative to the project.'),
    outputs: arr(enumOf(OUTPUTS), 'Files beside circuit.json.'),
    routing: bool('Autoroute (true by default).'),
    partsEngine: bool('Look parts up (true by default).'),
    open: bool('Open the board built (true by default).'),
  }),
  readOnly: true,
  long: true,
  timeoutMs: 15 * 60_000,
  run: async ({ project, entry, outputs = [], routing, partsEngine, open = true }, ctx) => {
    const p = project ?? st().project.folder
    if (!p) throw new CommandError('invalid_state', 'No project: circuit.new makes one, or give project (circuit.files lists them).')
    useCircuit.setState({ busy: true, status: 'Building with tscircuit…' })
    let j: JobAnswer
    try {
      j = await ask<JobAnswer>('build', { project: p, ...(entry ? { entry } : {}), outputs, ...(routing === false ? { routing } : {}), ...(partsEngine === false ? { partsEngine } : {}) }, { progress: (t) => (useCircuit.setState({ status: t }), ctx.progress(t)), signal: ctx.signal })
    } catch (e) {
      const failed = (e as { result?: JobAnswer })?.result
      if (failed?.job) useCircuit.setState({ lastBuild: lastOf(failed) })
      throw e
    } finally {
      useCircuit.setState({ busy: false, status: '' })
    }
    // The build is the project's last whichever project it was of: it is
    // not an undo step (the files are on disk), but is saved with the project.
    useCircuit.setState({ lastBuild: lastOf(j) })
    let opened: unknown = null
    if (open && j.ok) opened = await runCommand('circuit.open', { job: j.job })
    return { ...j, ...(opened ? { opened } : {}) }
  },
}

const filesCmd: Command<{ project?: string; job?: string }> = {
  name: 'files',
  title: 'Projects, builds and their files',
  description: 'With nothing: the board projects and the latest builds on this computer. With project or job: its files. Changes nothing.',
  input: obj({ project: str('A project name or folder.'), job: str('A build’s job id.') }),
  readOnly: true,
  long: true,
  run: async (a, ctx) => ask('files', a, ctx),
}

// ---- a board read in --------------------------------------------------------------

const MAX_TEXT = 50 * 2 ** 20

function load(text: string, name: string, from: Loaded['from']): Loaded {
  if (text.length > MAX_TEXT) throw new CommandError('invalid_input', `The circuit.json is ${Math.round(text.length / 2 ** 20)} MB — more than the 50 MB this reads.`)
  let board
  try {
    board = readCircuitJson(text)
  } catch (e) {
    if (e instanceof CircuitJsonError) throw new CommandError('invalid_input', `${name}: ${e.message}`)
    throw e
  }
  const pieces = piecesOf(board)
  return { name, from, text, board, stats: statsOf(board, pieces, netsOf(pieces)) }
}

const open: Command<{ job?: string; path?: string; json?: string; name?: string }> = {
  name: 'open',
  title: 'Open a circuit.json',
  description:
    'Read a board’s Circuit JSON (tscircuit’s circuit.json) into the workspace: a build’s by job (circuit.build gives it), a file of a project or build by path (through the agent’s server), or its text as json. Every element is checked; those that do not check are left out and listed (problems). Returns the board’s figures (as circuit.stats), the build’s own errors and warnings, and the problems. One undo step.',
  input: obj({ job: str('A build’s job id.'), path: str('A circuit.json in a project or build.'), json: str('The Circuit JSON text.'), name: str('What to call it.') }),
  long: true,
  timeoutMs: 300_000,
  label: ({ name, job }) => `open ${name ?? job ?? 'circuit.json'}`,
  run: async ({ job, path, json, name }, ctx) => {
    const given = [job, path, json].filter((x) => x !== undefined).length
    if (given !== 1) throw new CommandError('invalid_input', 'Give one of job, path or json.')
    let text: string
    let from: Loaded['from'] = {}
    if (json !== undefined) text = json
    else {
      const r = await ask<{ path: string; text?: string }>('read', job !== undefined ? { job, path: 'circuit.json' } : { path: path as string }, ctx)
      if (typeof r.text !== 'string') throw new CommandError('invalid_input', `${r.path} is not a text file.`)
      text = r.text
      from = job !== undefined ? { job } : { path: r.path }
    }
    const l = load(text, (name?.trim() || (job ? `${job} circuit.json` : path ? path.split(/[\\/]/).pop()! : 'circuit.json')).slice(0, 120), from)
    useCircuit.setState({ loaded: l, made: null, resistance: null })
    return { name: l.name, stats: statsOut(l.stats), errors: l.board.errors.slice(0, 50), warnings: l.board.warnings.slice(0, 50), problems: l.board.problems.slice(0, 50), unbuilt: l.board.unbuilt }
  },
}

const stats: Command<Record<string, never>> = {
  name: 'stats',
  title: 'The board’s figures',
  description: 'The open board’s figures, computed from its Circuit JSON: size, thickness, area; layers declared and those with copper; traces (count, total length, by layer, the narrowest); pads, holes, vias, components; the smallest drill; the nets the copper makes (pieces that touch); and the least clearance between copper of two nets on a layer, with what it is between. mm. Changes nothing.',
  input: obj({}),
  readOnly: true,
  run: async () => {
    const l = loaded()
    return { name: l.name, ...statsOut(l.stats), problems: l.board.problems.length }
  },
}

const resistance: Command<{ conductor?: string; thickness?: number }> = {
  name: 'resistance',
  title: 'Trace resistance by net',
  description: `An estimate of each net’s trace resistance, trace by trace, for a conductor: ${CONDUCTORS.map((c) => `${c.id} (${c.label}${c.typical ? ', typical' : ''})`).join(', ')}. R = ρ·L/(w·t) per run, a taper integrated, each via’s plated barrel (copper, 25 µm wall) or filled column (printed, across the layers) through the board. thickness: the trace’s, mm — 0.035 for 1 oz copper, a printed trace’s height otherwise; the conductor’s own unless given. A trace’s figure is its run end to end; a net’s series figure is every trace of it end to end, the most any path through it can be. Ω. Changes nothing.`,
  input: obj({ conductor: enumOf(CONDUCTORS.map((c) => c.id), 'The settings’ conductor by default.'), thickness: num('mm.', { exclusiveMinimum: 0, maximum: 20 }) }),
  readOnly: true,
  run: async ({ conductor, thickness }) => {
    const l = loaded()
    const c = conductorOf(conductor ?? st().settings.conductor) ?? conductorOf('copper')!
    const t = thickness ?? (conductor === undefined ? st().settings.thickness : null) ?? c.thickness
    const nets = resistanceByNet(l.board, { conductor: c, thickness: t, boardThickness: l.board.boards[0]?.thickness ?? 1.6 })
    useCircuit.setState({ resistance: { conductor: c.id, thickness: t, nets } })
    return {
      conductor: { id: c.id, label: c.label, rhoPlaneOhmCm: sig(c.rhoPlane / 10), rhoThroughOhmCm: sig(c.rhoThrough / 10), typical: c.typical, source: c.source },
      thickness: t,
      nets: nets.map((n) => ({ net: n.net, joins: n.joins, length: r3(n.length), seriesOhms: sig(n.seriesOhms), traces: n.traces.map((x) => ({ trace: x.trace, length: r3(x.length), minWidth: x.minWidth === null ? null : r3(x.minWidth), vias: x.vias, ohms: sig(x.ohms), viaOhms: sig(x.viaOhms) })) })),
    }
  },
}

// ---- settings ----------------------------------------------------------------------

const partsIn = obj({ board: bool(), copperTop: bool(), copperBottom: bool(), keepouts: bool() }, [], 'Which solids circuit.bodies makes.')

const set: Command<{ conductor?: string; thickness?: number | null; copper?: number; keepoutHeight?: number; parts?: Partial<Record<'board' | 'copperTop' | 'copperBottom' | 'keepouts', boolean>>; project?: string; entry?: string; reset?: boolean }> = {
  name: 'set',
  title: 'Settings',
  description: 'The conductor and trace thickness the resistance is estimated for (thickness 0 goes back to the conductor’s own); the copper solids’ thickness (mm; 0.035 for 1 oz, more to print it) and a keep-out’s height where the file gives none (mm); which solids circuit.bodies makes; the project folder and its board file. reset: true puts the settings back. One undo step.',
  input: obj({
    conductor: enumOf(CONDUCTORS.map((c) => c.id)),
    thickness: num('mm; 0 for the conductor’s own.', { minimum: 0, maximum: 20 }),
    copper: num('mm.', { exclusiveMinimum: 0, maximum: 10 }),
    keepoutHeight: num('mm.', { exclusiveMinimum: 0, maximum: 200 }),
    parts: partsIn,
    project: str('A project folder or name.', { minLength: 1 }),
    entry: str('Its board file.', { minLength: 1 }),
    reset: bool('Back to the default settings.'),
  }),
  label: () => 'circuit settings',
  run: async ({ conductor, thickness, copper, keepoutHeight, parts, project, entry, reset }) => {
    if (reset) useCircuit.setState({ settings: DEFAULT_SETTINGS })
    st().setSettings({ ...(conductor ? { conductor } : {}), ...(thickness !== undefined ? { thickness: thickness === 0 || thickness === null ? null : thickness } : {}), ...(copper !== undefined ? { copper } : {}), ...(keepoutHeight !== undefined ? { keepoutHeight } : {}), ...(parts ? { parts: { ...st().settings.parts, ...parts } } : {}) })
    if (project !== undefined || entry !== undefined) useCircuit.setState({ project: { folder: project ?? st().project.folder, entry: entry ?? (project !== undefined ? null : st().project.entry) } })
    return { settings: st().settings, project: st().project }
  },
}

// ---- solids ------------------------------------------------------------------------

interface ReverseBody {
  id: number
  name: string
  bounds?: { min: [number, number, number]; max: [number, number, number] } | null
}
const reverseBodies = () => (readStateSections().reverse as { bodies?: ReverseBody[] } | undefined)?.bodies ?? []

/** Each part to the body that stands where it does. */
function matchParts(parts: Part[], bodies: ReverseBody[]): (Part | undefined)[] {
  const left = new Set(parts.map((_, i) => i))
  return bodies.map((b, i) => {
    let best = -1
    let far = Infinity
    if (b.bounds)
      for (const j of left) {
        const p = parts[j]
        const d = [0, 1, 2].reduce((s, k) => s + Math.abs(p.box.min[k] - b.bounds!.min[k]) + Math.abs(p.box.max[k] - b.bounds!.max[k]), 0)
        if (d < far) [best, far] = [j, d]
      }
    if (best < 0) best = left.has(i) ? i : ([...left][0] ?? -1)
    if (best < 0) return undefined
    left.delete(best)
    return parts[best]
  })
}

const bodies: Command<{ parts?: Partial<Record<'board' | 'copperTop' | 'copperBottom' | 'keepouts', boolean>>; copper?: number; keepoutHeight?: number }> = {
  name: 'bodies',
  title: 'Bring the board into Reverse Engineer',
  description:
    'Build the open board as solids and bring them into Reverse Engineer as bodies (an Import feature, saved with the project): "Board" — the outline extruded to its thickness on z = 0 to z = thickness, holes, slots and cutouts through; "Copper top" — the top layer’s pads, traces, vias and pours on the board’s top face, copper thick; "Copper bottom" — the bottom’s under its underside; each island of copper a body of its own, numbered left to right; and "Keep-out <part>" — each component’s footprint box, as tall as its 3D model says or keepoutHeight. parts, copper and keepoutHeight as set (circuit.set) unless given. Inner layers are not built. Returns the bodies, each part’s volume (mm³) and size, and what was left out.',
  input: obj({ parts: partsIn, copper: num('mm.', { exclusiveMinimum: 0, maximum: 10 }), keepoutHeight: num('mm.', { exclusiveMinimum: 0, maximum: 200 }) }),
  long: true,
  timeoutMs: 600_000,
  label: () => 'board into Reverse Engineer',
  run: async ({ parts, copper, keepoutHeight }, ctx) => {
    const l = loaded()
    if (!l.board.boards.length) throw new CommandError('invalid_state', `${l.name} has no pcb_board: there is no board to build.`)
    const s = st().settings
    const on = { ...s.parts, ...(parts ?? {}) }
    if (!Object.values(on).some(Boolean)) throw new CommandError('invalid_input', 'parts: every part is off — switch one on.')
    useCircuit.setState({ busy: true, status: 'Building the board…' })
    ctx.progress('Building the board…')
    let a
    try {
      a = await buildSolidsInWorker({ board: l.board, options: { ...SOLID_DEFAULTS, ...on, copper: copper ?? s.copper, keepoutHeight: keepoutHeight ?? s.keepoutHeight }, out: 'step' }, ctx.signal)
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      throw new CommandError('failed', m === 'Stopped.' ? 'Stopped.' : `The board could not be built: ${m}`)
    } finally {
      useCircuit.setState({ busy: false, status: '' })
    }
    if (!a.step) throw new CommandError('failed', 'The board gave no STEP.')
    ctx.signal?.throwIfAborted()
    const before = reverseBodies()
    const had = new Set(before.map((b) => b.id))
    const base = l.name.replace(/\.json$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Board'
    await runWithin('reverse.import.step', { bytes: new TextEncoder().encode(a.step), name: `${base}.step` })
    const fresh = reverseBodies().filter((b) => !had.has(b.id))
    const partOf = matchParts(a.parts, fresh)
    const taken = new Set([...before, ...fresh].map((b) => b.name.toLowerCase()))
    const names: string[] = []
    for (const [i, b] of fresh.entries()) {
      const want0 = partOf[i]?.name ?? b.name
      taken.delete(b.name.toLowerCase())
      let want = want0
      for (let n = 2; taken.has(want.toLowerCase()); n++) want = `${want0} (${n})`
      if (want !== b.name) await runWithin('reverse.body.set', { body: b.id, name: want }).catch(() => (want = b.name))
      taken.add(want.toLowerCase())
      names.push(want)
    }
    const matched = fresh.map((_, i) => partOf[i]).filter((p): p is Part => !!p)
    useCircuit.setState({ made: { bodies: names, parts: matched.length === fresh.length ? matched : a.parts, notes: a.notes } })
    return { bodies: names, parts: a.parts.map(partOut), notes: a.notes }
  },
}

const clear: Command<Record<string, never>> = {
  name: 'clear',
  title: 'Close the board',
  description: 'Put the open board away (the bodies made from it stay in Reverse Engineer). One undo step.',
  input: obj({}),
  run: async () => {
    const had = !!st().loaded
    useCircuit.setState({ loaded: null, made: null, resistance: null })
    return { closed: had }
  },
}

const stopCmd: Command<Record<string, never>> = {
  name: 'stop',
  title: 'Stop',
  description: 'Stop the build running on this computer and the solids being made, if any.',
  input: obj({}),
  interrupts: true,
  history: false,
  run: async () => {
    const was = st().busy || asks.size > 0
    for (const c of asks) c.abort()
    stopWorker('Stopped.')
    useCircuit.setState({ busy: false, status: '' })
    return { stopped: was }
  },
}

// The server's answers: internal, so an agent never answers its own ask.
const answer: Command<{ req: string; ok: boolean; result?: unknown; error?: string }> = {
  name: 'answer',
  title: 'tscircuit’s answer',
  description: 'Used by the agent’s server: the answer to an ask of the Circuit workspace. Not for an agent.',
  input: obj({ req: str(), ok: bool(), result: anyObject('The answer.'), error: str() }, ['req', 'ok']),
  readOnly: true,
  history: false,
  internal: true,
  run: async (a) => ({ taken: answered(a) }),
}

const progress: Command<{ req: string; phase: string; detail?: string }> = {
  name: 'progress',
  title: 'How far the build has got',
  description: 'Used by the agent’s server: how far a build has got. Not for an agent.',
  input: obj({ req: str(), phase: str(), detail: str() }, ['req', 'phase']),
  readOnly: true,
  history: false,
  internal: true,
  run: async (p) => ({ taken: progressed(p) }),
}

export { setupOf }
export const circuitCommands = [tools, newProject, buildCmd, filesCmd, open, stats, resistance, set, bodies, clear, stopCmd, answer, progress] as Command<never>[]
