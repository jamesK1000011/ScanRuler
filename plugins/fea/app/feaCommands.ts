// SPDX-License-Identifier: AGPL-3.0-only
// The FEA workspace's commands (fea.*): set a study up on a Reverse
// Engineer body — the way it is printed, its material, the faces that hold
// it and the loads on others — have the agent's server mesh and solve it
// with Gmsh and CalculiX, and read and show the answer. The panel's buttons
// run these, so a click and an agent take one path.

import { runCommand } from '../../../src/commands/registry'
import { anyObject, arr, bool, enumOf, int, num, obj, oneOf, str, vec3 } from '../../../src/commands/schema'
import { readStateSections } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { setupOf, useFea, type FacePick, type FeaAnswer, type Field, type Fineness, type Hold, type Load } from '../state/feaStore'
import { answered, askServer, Cancelled, progressed } from './feaAsk'

/** The printed materials the server starts from (extras/fea.js MATERIALS). */
export const MATERIAL_IDS = ['pla', 'petg', 'abs', 'asa', 'petg-cf', 'pa6-cf', 'tpu-95a'] as const
export const FIELDS: Field[] = ['safety', 'vonMises', 'displacement', 'across', 'shear']
const OVERRIDES = ['Exy', 'Ez', 'nuXY', 'nuZ', 'Gxy', 'Gz', 'Xt', 'Xc', 'Zt', 'Zc', 'S', 'Sz'] as const

const fea = () => useFea.getState()

interface ReverseBody {
  id: number
  name: string
  surface?: boolean
  faces?: number
}

function bodies(): ReverseBody[] {
  const rev = readStateSections().reverse as { bodies?: ReverseBody[] } | undefined
  return (rev?.bodies ?? []).filter((b) => !b.surface)
}

function bodyNow(): ReverseBody {
  const name = fea().body
  const all = bodies()
  if (!all.length) throw new CommandError('invalid_state', 'There is no solid body to study: build one in Reverse Engineer (or import a STEP there) first.')
  if (!name) {
    if (all.length === 1) return all[0]
    throw new CommandError('invalid_state', `Choose the body to study (fea.setup { body }): ${all.map((b) => b.name).join(', ')}.`)
  }
  const b = all.find((x) => x.name === name)
  if (!b) throw new CommandError('invalid_state', `There is no body "${name}" in Reverse Engineer now (bodies: ${all.map((x) => x.name).join(', ')}).`)
  return b
}

const facesIn = {
  faces: arr(int(undefined, { minimum: 0 }), 'The body’s faces by index, as reverse.body.describe lists them.', { minItems: 1 }),
  where: anyObject('Or a query for its faces, as reverse.body.describe takes it — { between: [[-1, 0, 0]] } the faces facing −X, { madeBy: "Boss" }, { box: … }.'),
  selected: bool('Or the faces selected on the body in Reverse Engineer now.'),
}

/** A pick of faces from the input: one way only, resolved now for
 *  "selected" (the selection does not last). */
async function pickOf(input: { faces?: number[]; where?: Record<string, unknown>; selected?: boolean }): Promise<FacePick> {
  const ways = [input.faces !== undefined, input.where !== undefined, input.selected === true].filter(Boolean).length
  if (ways !== 1) throw new CommandError('invalid_input', 'Name the faces one way: faces (indices), where (a query) or selected: true.')
  if (input.faces) return { faces: [...new Set(input.faces)] }
  if (input.where) return { where: input.where }
  const r = (await runCommand('reverse.body.selected_faces', {})) as { bodies: { body: string; faces: number[] }[] }
  if (!r.bodies.length) throw new CommandError('invalid_state', 'No face is selected in Reverse Engineer: select the faces there (Ctrl+click adds one), then come back.')
  if (r.bodies.length > 1) throw new CommandError('invalid_state', `Faces of ${r.bodies.length} bodies are selected (${r.bodies.map((b) => b.body).join(', ')}): select faces of the one body studied.`)
  const sel = r.bodies[0]
  if (!fea().body) fea().set({ body: sel.body })
  if (sel.body !== bodyNow().name) throw new CommandError('invalid_state', `The faces selected are on ${sel.body}; the study is of ${bodyNow().name}.`)
  return { faces: sel.faces }
}

const nameFor = (list: { name: string }[], base: string, given?: string) => {
  if (given?.trim()) return given.trim()
  let i = list.length + 1
  while (list.some((x) => x.name === `${base} ${i}`)) i++
  return `${base} ${i}`
}

/** The study as the readout gives it. */
export function describeFea() {
  const s = fea()
  return {
    setup: setupOf(s),
    ...(s.busy ? { busy: s.busy, ...(s.phase ? { phase: s.phase } : {}) } : {}),
    ...(s.result ? { result: brief(s.result) } : {}),
    shown: s.shown ? s.field : null,
  }
}

function brief(r: NonNullable<ReturnType<typeof fea>['result']>) {
  const { surface: _s, setup: _u, ...rest } = r
  void _s
  void _u
  const met = r.worst.safety !== null ? r.worst.safety >= fea().target : null
  return { ...rest, target: fea().target, met }
}

const tools: Command<Record<string, never>> = {
  name: 'tools',
  title: 'The FEA programs on this computer',
  description: 'Whether the agent’s server finds Gmsh (the mesher) and CalculiX (the solver) — FreeCAD’s own copies first, then Homebrew’s — with their versions, how to get them when not, and the printed materials it starts from, each with its stiffness and strength in and across the layers (MPa). Changes nothing.',
  input: obj({}),
  readOnly: true,
  run: async () => askServer('tools', {}, { timeoutMs: 60_000 }),
}

const setup: Command<{ body?: string; build?: [number, number, number] | string; material?: string; overrides?: Record<string, number>; fineness?: Fineness; size?: number | null; target?: number }> = {
  name: 'setup',
  title: 'Set the study up',
  description:
    'The body studied (a Reverse Engineer body, by name), the way it is printed — build: the direction the layers stack, in the part’s frame ("+z" printed as it stands; "+x" stood on its −X end) — its material (pla, petg, abs, asa, petg-cf, pa6-cf, tpu-95a) with overrides for your own figures (MPa: Exy, Ez in and across the layers; Xt, Xc in-layer tension and compression strength; Zt, Zc across; S in-layer shear, Sz between-layer shear; nuXY, nuZ; Gxy, Gz), the mesh (fineness coarse, medium, fine; or size, mm) and the safety factor wanted (target, 2 by default). Holds and loads stay unless the body changes. Returns the study.',
  input: obj({
    body: str('The body, by name.', { minLength: 1 }),
    build: oneOf([vec3('The build direction, part frame.'), enumOf(['+x', '-x', '+y', '-y', '+z', '-z'])], 'The way the layers stack.'),
    material: enumOf([...MATERIAL_IDS]),
    overrides: anyObject('Your own figures over the material’s, MPa (nuXY, nuZ plain): { "Zt": 20 }.'),
    fineness: enumOf(['coarse', 'medium', 'fine']),
    size: oneOf([num('Element size, mm.', { exclusiveMinimum: 0 }), { type: 'null' }], 'The element size, mm; null for the fineness’s.'),
    target: num('The safety factor wanted.', { exclusiveMinimum: 0 }),
  }),
  history: false,
  run: async ({ body, build, material, overrides, fineness, size, target }) => {
    const patch: Partial<ReturnType<typeof fea>> = {}
    if (body !== undefined) {
      if (!bodies().some((b) => b.name === body)) throw new CommandError('invalid_input', `There is no body "${body}" (bodies: ${bodies().map((b) => b.name).join(', ') || 'none'}).`)
      if (body !== fea().body) Object.assign(patch, { body, holds: [], loads: [] })
    }
    if (build !== undefined) {
      const NAMED: Record<string, readonly [number, number, number]> = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] }
      const v = typeof build === 'string' ? NAMED[build] : build
      if (!v) throw new CommandError('invalid_input', 'build is a direction [x, y, z], or one of +x, -x, +y, -y, +z, -z.')
      const l = Math.hypot(v[0], v[1], v[2])
      if (!(l > 0)) throw new CommandError('invalid_input', 'build must be a direction, not zero.')
      patch.build = [v[0] / l, v[1] / l, v[2] / l]
    }
    if (material !== undefined) patch.material = material
    if (overrides !== undefined) {
      for (const [k, v] of Object.entries(overrides)) {
        if (!(OVERRIDES as readonly string[]).includes(k)) throw new CommandError('invalid_input', `${k} is not a material figure — ${OVERRIDES.join(', ')}.`)
        if (typeof v !== 'number' || !Number.isFinite(v) || (!k.startsWith('nu') && v <= 0)) throw new CommandError('invalid_input', `${k} must be a number${k.startsWith('nu') ? '' : ' above 0'}.`)
      }
      patch.overrides = overrides
    }
    if (fineness !== undefined) patch.fineness = fineness
    if (size !== undefined) patch.size = size ?? undefined
    if (target !== undefined) patch.target = target
    fea().set(patch)
    return describeFea()
  },
}

const hold: Command<{ name?: string; faces?: number[]; where?: Record<string, unknown>; selected?: boolean; remove?: string }> = {
  name: 'hold',
  title: 'Hold the part by faces',
  description: 'Faces held still — bolted down, clamped, glued: every point on them stays put. Name the faces by index, by a query (where) or as selected in Reverse Engineer (selected: true). remove: a hold by name. Returns the holds.',
  input: obj({ name: str('Its name; "Hold n" when left out.'), ...facesIn, remove: str('A hold to take away, by name.') }),
  history: false,
  run: async ({ name, remove, ...pick }) => {
    if (remove !== undefined) {
      if (!fea().holds.some((h) => h.name === remove)) throw new CommandError('not_found', `No hold "${remove}" — ${fea().holds.map((h) => h.name).join(', ') || 'none'}.`)
      fea().set({ holds: fea().holds.filter((h) => h.name !== remove) })
      return { holds: fea().holds }
    }
    bodyNow()
    const p = await pickOf(pick)
    const h: Hold = { name: nameFor(fea().holds, 'Hold', name), ...p }
    fea().set({ holds: [...fea().holds.filter((x) => x.name !== h.name), h] })
    return { holds: fea().holds }
  },
}

const load: Command<{ name?: string; faces?: number[]; where?: Record<string, unknown>; selected?: boolean; force?: [number, number, number]; pressure?: number; remove?: string }> = {
  name: 'load',
  title: 'Load faces',
  description: 'A load on faces: force [x, y, z] in newtons, the whole of it spread over the faces by area (a hand pushing, a weight hanging: 1 kg is about 9.8 N), or a pressure in MPa pushing on them (1 bar is 0.1 MPa). Name the faces by index, by a query (where) or as selected in Reverse Engineer (selected: true). remove: a load by name. Returns the loads.',
  input: obj({ name: str('Its name; "Load n" when left out.'), ...facesIn, force: vec3('Total force, N, in the part’s frame.'), pressure: num('Pressure, MPa; positive pushes on the faces.'), remove: str('A load to take away, by name.') }),
  history: false,
  run: async ({ name, remove, force, pressure, ...pick }) => {
    if (remove !== undefined) {
      if (!fea().loads.some((l) => l.name === remove)) throw new CommandError('not_found', `No load "${remove}" — ${fea().loads.map((l) => l.name).join(', ') || 'none'}.`)
      fea().set({ loads: fea().loads.filter((l) => l.name !== remove) })
      return { loads: fea().loads }
    }
    const hasForce = force !== undefined && force.some((x) => x !== 0)
    const hasPressure = pressure !== undefined && pressure !== 0
    if (hasForce === hasPressure) throw new CommandError('invalid_input', 'Give the load as a force [x, y, z] in N, or a pressure in MPa — one of them, not zero.')
    bodyNow()
    const p = await pickOf(pick)
    const l: Load = { name: nameFor(fea().loads, 'Load', name), ...p, ...(hasForce ? { force } : { pressure }) }
    fea().set({ loads: [...fea().loads.filter((x) => x.name !== l.name), l] })
    return { loads: fea().loads }
  },
}

const clear: Command<{ what?: 'holds' | 'loads' | 'result' | 'all' }> = {
  name: 'clear',
  title: 'Clear the study',
  description: 'Take away the holds, the loads, the result, or all of the study (what; all by default).',
  input: obj({ what: enumOf(['holds', 'loads', 'result', 'all']) }),
  history: false,
  run: async ({ what = 'all' }) => {
    if (what === 'holds') fea().set({ holds: [] })
    else if (what === 'loads') fea().set({ loads: [] })
    else if (what === 'result') useFea.setState({ result: null, shown: false })
    else fea().reset()
    return describeFea()
  },
}

/** The work under way, for its Cancel. */
let current: AbortController | null = null
export const cancelSolve = () => current?.abort()

async function trianglesOf(body: string, p: FacePick): Promise<number[]> {
  const r = (await runCommand('reverse.body.face_triangles', { body, ...(p.faces ? { faces: p.faces } : { where: p.where }) })) as { triangles: Float32Array }
  return Array.from(r.triangles)
}

const solve: Command<Record<string, never>> = {
  name: 'solve',
  title: 'Solve the study',
  description:
    'Mesh the body (quadratic tetrahedra, Gmsh) and solve it (CalculiX) on this computer through the agent’s server, the material stiffer and stronger in its layers than across them about the build direction. Returns the worst safety factor and where — the lesser of Hill’s check in the layers and the between-layer check (pulled apart or sheared) — with its mode, whether it meets the target, the worst found away from the holds (a rigid hold makes stress no real mount does), the largest von Mises stress (MPa) and displacement (mm), and the mesh. The result is then on the part (fea.show). A medium mesh takes seconds to a minute; fea.cancel stops it.',
  input: obj({}),
  long: true,
  timeoutMs: 1_900_000,
  history: false,
  run: async (_i, ctx) => {
    const s = fea()
    if (s.busy) throw new CommandError('busy', `A solve is under way (${s.busy}): wait, or fea.cancel.`)
    const b = bodyNow()
    if (!s.holds.length) throw new CommandError('invalid_state', 'Hold the part somewhere first (fea.hold): with nothing held it flies off under any load.')
    if (!s.loads.length) throw new CommandError('invalid_state', 'Load it first (fea.load): a force or a pressure on some faces.')
    current?.abort()
    const ctl = new AbortController()
    current = ctl
    const setupNow = setupOf(s)
    useFea.setState({ busy: 'Reading the part…', since: Date.now(), phase: null })
    try {
      ctx?.progress('Reading the part')
      const step = (await runCommand('reverse.export.step', { bodies: [b.name] })) as { file?: { bytes: Uint8Array } }
      if (!step?.file?.bytes) throw new CommandError('failed', `${b.name} gave no STEP.`)
      const fixtures = await Promise.all(s.holds.map(async (h) => ({ name: h.name, triangles: await trianglesOf(b.name, h) })))
      const loads = await Promise.all(s.loads.map(async (l) => ({ name: l.name, triangles: await trianglesOf(b.name, l), ...(l.force ? { force: l.force } : { pressure: l.pressure }) })))
      const job = { step: new TextDecoder().decode(step.file.bytes), build: s.build, material: { id: s.material, overrides: s.overrides }, fixtures, loads, mesh: { fineness: s.fineness, ...(s.size ? { size: s.size } : {}) } }
      useFea.setState({ busy: 'Meshing and solving…' })
      const r = await askServer<FeaAnswer>('solve', { job }, {
        signal: ctl.signal,
        progress: (phase, detail) => {
          useFea.setState({ phase: `${phase} ${detail}`.trim() })
          ctx?.progress(`${phase}: ${detail}`)
        },
      })
      useFea.setState({ result: { ...r, at: new Date().toISOString(), setup: setupNow }, shown: true })
      return brief(fea().result!)
    } catch (e) {
      if (e instanceof Cancelled) throw new CommandError('failed', 'The solve was cancelled.')
      if (e instanceof CommandError) throw e
      throw new CommandError('failed', e instanceof Error ? e.message : String(e))
    } finally {
      if (current === ctl) current = null
      useFea.setState({ busy: null, since: null, phase: null })
    }
  },
}

const cancel: Command<Record<string, never>> = {
  name: 'cancel',
  title: 'Stop the solve',
  description: 'Stop a solve under way: the server stops meshing or solving. Nothing changes otherwise.',
  input: obj({}),
  interrupts: true,
  history: false,
  run: async () => {
    const was = fea().busy !== null
    cancelSolve()
    return { stopped: was }
  },
}

const results: Command<Record<string, never>> = {
  name: 'results',
  title: 'The last answer',
  description: 'The last solve’s answer, as fea.solve gave it, with the study it was of and whether that is still the study set up now. Changes nothing.',
  input: obj({}),
  readOnly: true,
  run: async () => {
    const r = fea().result
    if (!r) throw new CommandError('not_found', 'Nothing has been solved yet: fea.solve.')
    return { ...brief(r), setup: r.setup, current: JSON.stringify(r.setup) === JSON.stringify(setupOf(fea())) }
  },
}

const show: Command<{ field?: Field; shown?: boolean }> = {
  name: 'show',
  title: 'Show the answer on the part',
  description: 'Colour the part by the answer: safety (the safety factor; below 1 it breaks), vonMises (MPa), displacement (mm), across (the stress across the layers, MPa; positive pulls them apart) or shear (between the layers, MPa). shown: false takes it off. view.render then pictures it.',
  input: obj({ field: enumOf(FIELDS), shown: bool() }),
  readOnly: true,
  scene: true,
  run: async ({ field, shown = true }) => {
    if (shown && !fea().result) throw new CommandError('not_found', 'Nothing has been solved yet: fea.solve.')
    useFea.setState({ ...(field ? { field } : {}), shown })
    return { shown: fea().shown ? fea().field : null }
  },
}

const answer: Command<{ req: string; ok: boolean; result?: unknown; error?: string }> = {
  name: 'answer',
  title: 'The solver’s answer',
  description: 'Used by the agent’s server: the answer to a solve the FEA workspace asked of it. Not for an agent.',
  input: obj({ req: str(), ok: bool(), result: anyObject('The answer.'), error: str() }, ['req', 'ok']),
  readOnly: true,
  history: false,
  internal: true,
  run: async (a) => ({ taken: answered(a) }),
}

const progress: Command<{ req: string; phase: string; detail?: string }> = {
  name: 'progress',
  title: 'How far the solve has got',
  description: 'Used by the agent’s server: how far a solve has got. Not for an agent.',
  input: obj({ req: str(), phase: str(), detail: str() }, ['req', 'phase']),
  readOnly: true,
  history: false,
  internal: true,
  run: async (p) => ({ taken: progressed(p) }),
}

export const feaCommands = [tools, setup, hold, load, clear, solve, cancel, results, show, answer, progress] as Command<never>[]
