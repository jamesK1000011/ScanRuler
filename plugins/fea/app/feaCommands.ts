// SPDX-License-Identifier: AGPL-3.0-only
// The FEA workspace's commands (fea.*): set a study up on a Reverse
// Engineer body — the way it is printed, its material, the faces that hold
// it and the loads on others — have the agent's server mesh and solve it
// with Gmsh and CalculiX, and read and show the answer. The panel's buttons
// run these, so a click and an agent take one path.

import { runCommand } from '../../../src/commands/registry'
import { anyObject, arr, bool, enumOf, int, num, obj, oneOf, str, vec3 } from '../../../src/commands/schema'
import { useShell } from '../../../src/state/shellStore'
import { type Command, CommandError } from '../../../src/plugins/api'
import { setupOf, useFea, type FacePick, type FeaAnswer, type FeaSetup, type FeaWire, type Field, type Fineness, type Hold, type Load } from '../state/feaStore'
import { answered, askServer, Cancelled, progressed } from './feaAsk'
import { MATERIAL_IDS, MATERIAL_NAMES, materialId, MATERIALS } from '../../_shared/materials'
import { readStateSections } from '../../../src/commands/stateSections'
import { useAgentLink } from '../../../src/commands/agentLink'
import { materialKeyOf, studyMaterial, type StudyMaterial } from './feaMaterial'

/** The printed materials the server starts from: the shared table
 *  (plugins/_shared/materials/), which extras/fea.js MATERIALS matches. */
export { MATERIAL_IDS, MATERIALS }
const NAMED: Record<string, readonly [number, number, number]> = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] }
const direction = (v: readonly number[] | string, what: string): [number, number, number] => {
  const d = typeof v === 'string' ? NAMED[v] : v
  if (!d) throw new CommandError('invalid_input', `${what} is a direction [x, y, z], or one of +x, -x, +y, -y, +z, -z.`)
  const l = Math.hypot(d[0], d[1], d[2])
  if (!(l > 0)) throw new CommandError('invalid_input', `${what} must be a direction, not zero.`)
  return [d[0] / l, d[1] / l, d[2] / l]
}
export const FIELDS: Field[] = ['safety', 'vonMises', 'displacement', 'across', 'shear']
const OVERRIDES = ['Exy', 'Ez', 'nuXY', 'nuZ', 'Gxy', 'Gz', 'Xt', 'Xc', 'Zt', 'Zc', 'S', 'Sz'] as const

const fea = () => useFea.getState()

interface ReverseBody {
  id: number
  name: string
  surface?: boolean
  faces: number
  key: string
}

/** The solid bodies now, from Reverse Engineer's brief list. */
export async function bodies(): Promise<ReverseBody[]> {
  try {
    const r = (await runCommand('reverse.body.names', {})) as { bodies: ReverseBody[] }
    return r.bodies.filter((b) => !b.surface)
  } catch {
    return []
  }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The body studied: the one set, or the only one; its name as Reverse
 *  Engineer has it now (matched without regard to case). */
async function bodyNow(): Promise<ReverseBody> {
  const name = fea().body
  const all = await bodies()
  if (!all.length) throw new CommandError('invalid_state', 'There is no solid body to study: build one in Reverse Engineer (or import a STEP there) first.')
  if (!name) {
    if (all.length === 1) {
      fea().set({ body: all[0].name })
      return all[0]
    }
    throw new CommandError('invalid_state', `Choose the body to study (fea.setup { body }): ${all.map((b) => b.name).join(', ')}.`)
  }
  const b = all.find((x) => same(x.name, name))
  if (!b) throw new CommandError('invalid_state', `There is no body "${name}" in Reverse Engineer now (bodies: ${all.map((x) => x.name).join(', ')}) — renamed? fea.setup { body } with its name now.`)
  if (b.name !== name) fea().set({ body: b.name })
  return b
}

const facesIn = {
  faces: arr(int(undefined, { minimum: 0 }), 'The body’s faces by index, as reverse.body.describe lists them.', { minItems: 1 }),
  where: anyObject('Or a query for its faces, as reverse.body.describe takes it — { between: [[-1, 0, 0]] } the faces facing −X, { madeBy: "Boss" }, { box: … }.'),
  selected: bool('Or the faces selected on the body in Reverse Engineer now.'),
}

/** A pick of faces from the input, one way only, resolved now: its faces'
 *  triangles kept, so a pick by index or selection stays where it was when
 *  the body is rebuilt and its faces renumbered. A query is asked again at
 *  each solve. */
async function pickOf(input: { faces?: number[]; where?: Record<string, unknown>; selected?: boolean }): Promise<FacePick> {
  const ways = [input.faces !== undefined, input.where !== undefined, input.selected === true].filter(Boolean).length
  if (ways !== 1) throw new CommandError('invalid_input', 'Name the faces one way: faces (indices), where (a query) or selected: true.')
  let pick: FacePick
  let b: ReverseBody
  if (input.selected) {
    const r = (await runCommand('reverse.body.selected_faces', {})) as { bodies: { body: string; faces: number[] }[] }
    if (!r.bodies.length) throw new CommandError('invalid_state', 'No face is selected in Reverse Engineer: select the faces there (Ctrl+click adds one), then come back.')
    if (r.bodies.length > 1) throw new CommandError('invalid_state', `Faces of ${r.bodies.length} bodies are selected (${r.bodies.map((x) => x.body).join(', ')}): select faces of the one body studied.`)
    const sel = r.bodies[0]
    if (!fea().body) fea().set({ body: sel.body })
    b = await bodyNow()
    if (!same(sel.body, b.name)) throw new CommandError('invalid_state', `The faces selected are on ${sel.body}; the study is of ${b.name}.`)
    pick = { faces: sel.faces }
  } else {
    b = await bodyNow()
    if (input.faces) {
      const bad = input.faces.find((i) => i >= b.faces)
      if (bad !== undefined) throw new CommandError('invalid_input', `${b.name} has faces 0–${b.faces - 1}; there is no face ${bad}.`)
      pick = { faces: [...new Set(input.faces)] }
    } else pick = { where: input.where }
  }
  const tris = await trianglesOf(b.name, pick)
  return { ...pick, ...(pick.faces ? { triangles: tris.triangles } : {}), bodyKey: b.key, count: tris.count }
}

/** A pick's triangles now: a query asked again; indices and selections as
 *  they were picked — the body's numbers may since mean other faces. */
async function trianglesOf(body: string, p: FacePick): Promise<{ triangles: number[]; count: number }> {
  if (p.faces && p.triangles?.length) return { triangles: p.triangles, count: p.count ?? p.faces.length }
  const r = (await runCommand('reverse.body.face_triangles', { body, ...(p.faces ? { faces: p.faces } : { where: p.where }) })) as { triangles: Float32Array; faces: number[] }
  return { triangles: Array.from(r.triangles, (x) => Math.round(x * 1e4) / 1e4), count: r.faces.length }
}

/** A hold or load as answered: without its triangles. */
const pickBrief = <T extends FacePick>(p: T) => {
  const { triangles: _t, bodyKey: _k, ...rest } = p
  void _t
  void _k
  return rest
}

const nameFor = (list: { name: string }[], base: string, given?: string) => {
  if (given?.trim()) return given.trim()
  let i = list.length + 1
  while (list.some((x) => x.name === `${base} ${i}`)) i++
  return `${base} ${i}`
}

/** What a result was made of, less the target (which judges, not solves). */
const solvedOf = (s: FeaSetup) => {
  const { target: _t, ...rest } = s
  void _t
  return JSON.stringify(rest)
}

/** Whether the last result is of the study and the body as they are now. */
export function staleness(bodyKey: string | null): string | null {
  const r = fea().result
  if (!r) return null
  if (solvedOf(r.setup) !== solvedOf(setupOf(fea()))) return 'the study has changed since'
  if (r.materialKey !== undefined && r.materialKey !== materialKeyOf(fea().body)) return 'the body’s material or setup has changed since'
  if (bodyKey !== null && r.bodyKey !== null && bodyKey !== r.bodyKey) return 'the body has changed since'
  return null
}

/** The body's key as last seen, for the readout (which cannot wait). */
let lastKey: string | null = null

/** The study as the readout gives it. */
export function describeFea() {
  const s = fea()
  const stale = staleness(lastKey)
  return {
    setup: setupOf(s),
    ...(s.busy ? { busy: s.busy, ...(s.phase ? { phase: s.phase } : {}) } : {}),
    ...(s.result ? { result: brief(s.result), ...(stale ? { stale } : {}) } : {}),
    shown: s.shown && useShell.getState().workspace === 'fea' ? s.field : null,
  }
}

function brief(r: NonNullable<ReturnType<typeof fea>['result']>) {
  const { surface: _s, setup: _u, bodyKey: _k, materialKey: _m, ...rest } = r
  void _m
  void _s
  void _u
  void _k
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

interface GravityIn {
  direction?: [number, number, number] | string
  g?: number
  from?: 'mass' | 'material'
}

const setup: Command<{ body?: string; build?: [number, number, number] | string; material?: string; overrides?: Record<string, number>; fineness?: Fineness; size?: number | null; target?: number; gravity?: GravityIn | null }> = {
  name: 'setup',
  title: 'Set the study up',
  description:
    'The body studied (a Reverse Engineer body, by name; another body clears the holds and loads), the way it is printed — build: the direction the layers stack, in the part’s frame ("+z" printed as it stands; "+x" stood on its −X end) — the material for a body with none of its own (pla, petg, abs, asa, petg-cf, pa6-cf, tpu-95a; a body set with material.set solves in its own: as printed when it is in a print setup and has printing figures, else solid, the same in every direction) with overrides for your own figures — the whole set, replacing what was there; a new material clears them (MPa: Exy, Ez in and across the layers; Xt, Xc in-layer tension and compression strength; Zt, Zc across; S in-layer shear, Sz between-layer shear; nuXY, nuZ; Gxy, Gz), the mesh (fineness coarse, medium, fine; or size, mm, which wins over fineness — null to go back to it), the safety factor wanted (target, 2 by default) and the part’s own weight as a load (gravity: { direction, "-z" by default; g, how many, 1 by default — more for a shake or a drop; from: "mass", what the Mass workspace weighs it at with its walls and infill, the default, or "material", solid } — null takes it off). Holds and loads stay unless the body changes. Returns the study.',
  input: obj({
    body: str('The body, by name.', { minLength: 1 }),
    build: oneOf([vec3('The build direction, part frame.'), enumOf(['+x', '-x', '+y', '-y', '+z', '-z'])], 'The way the layers stack.'),
    material: enumOf(MATERIAL_NAMES),
    overrides: anyObject('Your own figures over the material’s, MPa (nuXY, nuZ plain): { "Zt": 20 }.'),
    fineness: enumOf(['coarse', 'medium', 'fine']),
    size: oneOf([num('Element size, mm.', { exclusiveMinimum: 0 }), { type: 'null' }], 'The element size, mm; null for the fineness’s.'),
    target: num('The safety factor wanted.', { exclusiveMinimum: 0 }),
    gravity: oneOf(
      [
        obj({
          direction: oneOf([vec3('The way it pulls, part frame.'), enumOf(['+x', '-x', '+y', '-y', '+z', '-z'])], 'The way it pulls; -z by default.'),
          g: num('How many g; 1 by default.', { exclusiveMinimum: 0, maximum: 1000 }),
          from: enumOf(['mass', 'material'], 'What it weighs: mass (the Mass workspace, walls and infill) or material (solid).'),
        }),
        { type: 'null' },
      ],
      'The part’s own weight as a load; null takes it off.',
    ),
  }),
  run: async ({ body, build, material: named, overrides, fineness, size, target, gravity }) => {
    const material = named === undefined ? undefined : materialId(named)
    const patch: Partial<ReturnType<typeof fea>> = {}
    if (body !== undefined) {
      const all = await bodies()
      const b = all.find((x) => same(x.name, body))
      if (!b) throw new CommandError('invalid_input', `There is no body "${body}" (bodies: ${all.map((x) => x.name).join(', ') || 'none'}).`)
      // Another body: its holds and loads were the other's. The same one,
      // set at last where it was taken by default, keeps them.
      const was = fea().body
      if (was !== null && !same(was, b.name)) Object.assign(patch, { body: b.name, holds: [], loads: [] })
      else patch.body = b.name
    }
    if (build !== undefined) patch.build = direction(build, 'build')
    if (gravity === null) patch.gravity = undefined
    else if (gravity !== undefined) {
      const was = fea().gravity
      patch.gravity = {
        direction: gravity.direction !== undefined ? direction(gravity.direction, 'gravity.direction') : (was?.direction ?? [0, 0, -1]),
        g: gravity.g ?? was?.g ?? 1,
        from: gravity.from ?? was?.from ?? 'mass',
      }
    }
    if (material !== undefined && material !== fea().material) {
      patch.material = material
      // Figures given for one material are not another's.
      if (overrides === undefined && Object.keys(fea().overrides).length) patch.overrides = {}
    }
    if (overrides !== undefined) {
      for (const [k, v] of Object.entries(overrides)) {
        if (!(OVERRIDES as readonly string[]).includes(k)) throw new CommandError('invalid_input', `${k} is not a material figure — ${OVERRIDES.join(', ')}.`)
        if (typeof v !== 'number' || !Number.isFinite(v) || (!k.startsWith('nu') && v <= 0)) throw new CommandError('invalid_input', `${k} must be a number${k.startsWith('nu') ? '' : ' above 0'}.`)
        if (k.startsWith('nu') && !(v > -1 && v < 0.5)) throw new CommandError('invalid_input', `${k} is a Poisson's ratio: between -1 and 0.5 (0.3 to 0.4 for most plastics).`)
      }
      patch.overrides = overrides
    }
    if (fineness !== undefined) patch.fineness = fineness
    if (size !== undefined) {
      if (size !== null && !(size >= 0.05)) throw new CommandError('invalid_input', 'size is the element size, 0.05 mm or more.')
      patch.size = size ?? undefined
    }
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
  run: async ({ name, remove, ...pick }) => {
    if (remove !== undefined) {
      if (name !== undefined || pick.faces || pick.where || pick.selected) throw new CommandError('invalid_input', 'remove takes a hold away by name: give it alone.')
      if (!fea().holds.some((h) => h.name === remove)) throw new CommandError('not_found', `No hold "${remove}" — ${fea().holds.map((h) => h.name).join(', ') || 'none'}.`)
      fea().set({ holds: fea().holds.filter((h) => h.name !== remove) })
      return { holds: fea().holds.map(pickBrief) }
    }
    const p = await pickOf(pick)
    const h: Hold = { name: nameFor(fea().holds, 'Hold', name), ...p }
    const replaced = fea().holds.some((x) => x.name === h.name)
    fea().set({ holds: [...fea().holds.filter((x) => x.name !== h.name), h] })
    return { holds: fea().holds.map(pickBrief), added: { name: h.name, faces: h.count }, ...(replaced ? { replaced: h.name } : {}) }
  },
}

const load: Command<{ name?: string; faces?: number[]; where?: Record<string, unknown>; selected?: boolean; force?: [number, number, number]; pressure?: number; remove?: string }> = {
  name: 'load',
  title: 'Load faces',
  description: 'A load on faces: force [x, y, z] in newtons, the whole of it spread over the faces by area (a hand pushing, a weight hanging: 1 kg is about 9.8 N), or a pressure in MPa pushing on them (1 bar is 0.1 MPa). Name the faces by index, by a query (where) or as selected in Reverse Engineer (selected: true). remove: a load by name. Returns the loads.',
  input: obj({ name: str('Its name; "Load n" when left out.'), ...facesIn, force: vec3('Total force, N, in the part’s frame.'), pressure: num('Pressure, MPa; positive pushes on the faces.'), remove: str('A load to take away, by name.') }),
  run: async ({ name, remove, force, pressure, ...pick }) => {
    if (remove !== undefined) {
      if (name !== undefined || force || pressure !== undefined || pick.faces || pick.where || pick.selected) throw new CommandError('invalid_input', 'remove takes a load away by name: give it alone.')
      if (!fea().loads.some((l) => l.name === remove)) throw new CommandError('not_found', `No load "${remove}" — ${fea().loads.map((l) => l.name).join(', ') || 'none'}.`)
      fea().set({ loads: fea().loads.filter((l) => l.name !== remove) })
      return { loads: fea().loads.map(pickBrief) }
    }
    const hasForce = force !== undefined && force.some((x) => x !== 0)
    const hasPressure = pressure !== undefined && pressure !== 0
    if (hasForce === hasPressure) throw new CommandError('invalid_input', 'Give the load as a force [x, y, z] in N, or a pressure in MPa — one of them, not zero.')
    const p = await pickOf(pick)
    const l: Load = { name: nameFor(fea().loads, 'Load', name), ...p, ...(hasForce ? { force } : { pressure }) }
    const replaced = fea().loads.some((x) => x.name === l.name)
    fea().set({ loads: [...fea().loads.filter((x) => x.name !== l.name), l] })
    return { loads: fea().loads.map(pickBrief), added: { name: l.name, faces: l.count }, ...(replaced ? { replaced: l.name } : {}) }
  },
}

const clear: Command<{ what?: 'holds' | 'loads' | 'result' | 'all' }> = {
  name: 'clear',
  title: 'Clear the study',
  description: 'Take away the holds, the loads, the result, or all of the study (what; all by default).',
  input: obj({ what: enumOf(['holds', 'loads', 'result', 'all']) }),
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
/** Whether a solve under way was cancelled (not an error to show). */
export const wasCancelled = (e: unknown) => e instanceof CommandError && /was cancelled/.test(e.message)

const bytesOf = (b64: unknown): ArrayBuffer => {
  if (typeof b64 !== 'string') throw new CommandError('failed', 'The server’s answer is not one this page reads — restart it (and the agent app).')
  const bin = atob(b64)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u.buffer
}

/** The answer as the page can draw it: decoded, every field there, one per node. */
function checked(w: FeaWire): FeaAnswer {
  const old = 'The server’s answer is not one this page reads — restart it (and the agent app).'
  const s = w?.surface
  if (!w || !w.worst || !w.mesh || !s || s.encoding !== 'base64-le') throw new CommandError('failed', old)
  const positions = new Float32Array(bytesOf(s.positions))
  const index = new Uint32Array(bytesOf(s.index))
  if (positions.length !== s.vertices * 3 || index.length !== s.triangles * 3 || index.some((i) => i >= s.vertices)) throw new CommandError('failed', old)
  const fields = {} as Record<Field, Float32Array>
  for (const f of FIELDS) {
    const v = new Float32Array(bytesOf(s.fields?.[f]))
    if (v.length !== s.vertices) throw new CommandError('failed', `The server’s answer has no ${f} for each corner — restart it (and the agent app).`)
    fields[f] = v
  }
  return { ...w, surface: { positions, index, fields } }
}

const solve: Command<Record<string, never>> = {
  name: 'solve',
  title: 'Solve the study',
  description:
    'Mesh the body (quadratic tetrahedra, Gmsh) and solve it (CalculiX) on this computer through the agent’s server, in the body’s material: a printed one stiffer and stronger in its layers than across them about the build direction, any other the same every way. The answer’s material says which (as: printed or solid), and the note when the body has none set and the study’s was assumed. Returns the worst safety factor and where — the least of the in-layer check and the between-layer checks (pulled apart, sheared or crushed) — with its mode, whether it meets the target, the worst found away from holds and loads (a rigid hold makes stress no real mount does), any warnings, the largest von Mises stress (MPa) and displacement (mm), and the mesh. The result is then on the part (fea.show). Holds and loads picked by index stay where they were picked; queries are asked again. A medium mesh takes seconds to a minute; fea.cancel stops it, and other changes wait (are refused as busy) until it is done.',
  input: obj({}),
  long: true,
  timeoutMs: 2_700_000,
  history: false,
  run: async (_i, ctx) => {
    const s = fea()
    if (s.busy) throw new CommandError('busy', `A solve is under way (${s.busy}): wait, or fea.cancel.`)
    const b = await bodyNow()
    if (!s.holds.length) throw new CommandError('invalid_state', 'Hold the part somewhere first (fea.hold): with nothing held it flies off under any load.')
    if (!s.loads.length && !s.gravity) throw new CommandError('invalid_state', 'Load it first (fea.load): a force or a pressure on some faces, or its own weight (fea.setup { gravity: {} }).')
    current?.abort()
    const ctl = new AbortController()
    current = ctl
    // The registry's own stop (its time limit) stops the server too.
    const ctxSignal = (ctx as { signal?: AbortSignal } | undefined)?.signal
    ctxSignal?.addEventListener('abort', () => ctl.abort(), { once: true })
    const gen = s.gen
    const setupNow = setupOf(s)
    useFea.setState({ busy: 'Reading the part…', since: Date.now(), phase: null })
    try {
      ctx?.progress('Reading the part')
      const step = (await runCommand('reverse.export.step', { bodies: [b.name] })) as { file?: { bytes: Uint8Array } }
      if (!step?.file?.bytes) throw new CommandError('failed', `${b.name} gave no STEP.`)
      const named = async (what: string, p: FacePick) => {
        try {
          return (await trianglesOf(b.name, p)).triangles
        } catch (e) {
          throw new CommandError('invalid_state', `${what}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      const moved = s.holds.concat(s.loads as Hold[]).filter((p) => p.faces && p.bodyKey && p.bodyKey !== b.key).map((p) => p.name)
      const fixtures = await Promise.all(s.holds.map(async (h) => ({ name: h.name, triangles: await named(h.name, h) })))
      const loads = await Promise.all(s.loads.map(async (l) => ({ name: l.name, triangles: await named(l.name, l), ...(l.force ? { force: l.force } : { pressure: l.pressure }) })))
      const mat = studyMaterial(b.id, s)
      const materialKey = materialKeyOf(b.name)
      const weight = s.gravity ? await weightOf(s, b.name, mat) : null
      const job = { step: new TextDecoder().decode(step.file.bytes), build: s.build, material: mat.job, fixtures, loads, mesh: { fineness: s.fineness, ...(s.size ? { size: s.size } : {}) }, ...(weight ? { gravity: weight.gravity } : {}) }
      useFea.setState({ busy: 'Meshing and solving…' })
      const r = checked(
        await askServer<FeaWire>('solve', { job }, {
          signal: ctl.signal,
          timeoutMs: 2_600_000,
          progress: (phase, detail) => {
            useFea.setState({ phase: `${phase} ${detail}`.trim() })
            ctx?.progress(`${phase}: ${detail}`)
          },
        }),
      )
      // A study cleared or a project opened while it ran: not its answer.
      if (fea().gen !== gen) throw new CommandError('failed', 'The study was replaced while it was solved: its answer is dropped.')
      lastKey = b.key
      const solved = weight && r.gravity ? { ...r, gravity: { ...r.gravity, from: weight.from } } : r
      useFea.setState({ result: { ...solved, material: { ...solved.material, label: mat.label, as: mat.as }, at: new Date().toISOString(), setup: setupNow, bodyKey: b.key, materialKey }, shown: true })
      const older = mat.job.bulk && !useAgentLink.getState().server?.features?.includes('fea.bulk') ? ['The agent’s server running now is older than this page: it solved the solid material’s figures but judged them as a printed part’s layers, and names it after a filament. Quit the agent app and open it again.'] : []
      const notes = [...(mat.note ? [mat.note] : []), ...older, ...(moved.length ? [`The body has changed since ${moved.join(', ')} ${moved.length === 1 ? 'was' : 'were'} picked by face: held where picked. Pick again if the faces moved.`] : []), ...(weight?.note ? [weight.note] : [])]
      return { ...brief(fea().result!), ...(notes.length ? { note: notes.join(' ') } : {}) }
    } catch (e) {
      if (e instanceof Cancelled || ctl.signal.aborted) throw new CommandError('failed', 'The solve was cancelled.')
      if (e instanceof CommandError) throw e
      throw new CommandError('failed', e instanceof Error ? e.message : String(e))
    } finally {
      if (current === ctl) current = null
      useFea.setState({ busy: null, since: null, phase: null })
    }
  },
}

/** An encased part's weight, as the server takes it: its mass, g, its
 *  centre and how far it reaches from it, mm. */
export interface EncasedPoint {
  name: string
  at: number[]
  mass: number
  reach: number
}

/** The parts encased in the body (the Hardware workspace's hw.masses: a
 *  magnet, a nut in a sealed pocket), one point each — the mesh has a void
 *  where each is, so its weight is a load of its own; and those whose
 *  weight is not known, said. None where the workspace is not here. */
export async function encasedIn(body: string): Promise<{ points: EncasedPoint[]; note?: string }> {
  let r: { parts?: { id: string; what: string; mass: number; centres: number[][]; reach: number }[]; uncounted?: { id: string; what: string }[] }
  try {
    r = (await runCommand('hw.masses', { bodies: [body] })) as typeof r
  } catch (e) {
    if (e instanceof CommandError && e.code === 'unknown_command') return { points: [] }
    throw e
  }
  const points = (r.parts ?? []).flatMap((p) => p.centres.map((at, i) => ({ name: `${p.id} ${p.what}${p.centres.length > 1 ? ` (${i + 1})` : ''}`, at, mass: p.mass, reach: p.reach })))
  const left = r.uncounted ?? []
  return { points, ...(left.length ? { note: `Not in its weight, mass not known: ${left.map((u) => `${u.what} (${u.id})`).join(', ')}.` } : {}) }
}

/** What the part weighs at, for its own weight: the Mass workspace's
 *  weighing — walls, infill and calibration — as a density over the
 *  whole solid, or the solid material's when asked, or when Mass is not
 *  there or cannot weigh it (said in the note); and the parts encased in
 *  it, each a load of its own on its pocket's walls. */
async function weightOf(s: FeaSetup, body: string, mat: StudyMaterial): Promise<{ gravity: { direction: number[]; g: number; density: number; points?: EncasedPoint[] }; from: 'mass' | 'material'; note?: string }> {
  const plain = await plainWeightOf(s, body, mat)
  const held = await encasedIn(body)
  const notes = [plain.note, held.note]
  if (held.points.length && !useAgentLink.getState().server?.features?.includes('fea.encased')) notes.push('The agent’s server running now is older than this page and leaves out the encased parts’ weight: quit the agent app and open it again.')
  const note = notes.filter(Boolean).join(' ')
  return { ...plain, gravity: { ...plain.gravity, ...(held.points.length ? { points: held.points } : {}) }, ...(note ? { note } : {}) }
}

async function plainWeightOf(s: FeaSetup, body: string, mat: StudyMaterial): Promise<{ gravity: { direction: number[]; g: number; density: number }; from: 'mass' | 'material'; note?: string }> {
  const gr = s.gravity!
  const solid = { gravity: { direction: gr.direction, g: gr.g, density: mat.density }, from: 'material' as const }
  if (gr.from === 'material') return solid
  let said = 'the Mass workspace is not here'
  try {
    const r = (await runCommand('mass.properties', { bodies: [body] })) as { bodies?: { body: string; mass: number; volume: number; closed?: boolean }[] }
    const row = r.bodies?.[0]
    if (row && row.mass > 0 && row.volume > 0 && row.closed !== false) {
      // g over mm³, as g/cm³.
      const density = (row.mass / row.volume) * 1000
      // Only where both took their own setup's material: a body's own is one.
      const theirs = (readStateSections().mass as { setup?: { material?: string } } | undefined)?.setup?.material
      const other = mat.assumed && theirs && materialId(theirs) !== materialId(s.material) ? ` The Mass workspace has it in ${MATERIALS[materialId(theirs) ?? 'pla'].label}; this study in ${MATERIALS[materialId(s.material) ?? 'pla'].label}.` : ''
      return { gravity: { direction: gr.direction, g: gr.g, density }, from: 'mass', ...(other ? { note: `Own weight from the Mass workspace's weighing.${other}` } : {}) }
    }
    said = row && row.closed === false ? 'its mesh is not closed' : 'it weighed nothing'
  } catch (e) {
    if (!(e instanceof CommandError && e.code === 'unknown_command')) said = e instanceof Error ? e.message : String(e)
  }
  return { ...solid, note: `Own weight from the solid ${mat.label}: ${said}.` }
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
  description: 'The last solve’s answer, as fea.solve gave it, with the study it was of and whether it still holds (current): stale says why not — the study or the body changed since. Changes nothing.',
  input: obj({}),
  readOnly: true,
  run: async () => {
    const r = fea().result
    if (!r) throw new CommandError('not_found', 'Nothing has been solved yet: fea.solve.')
    const b = (await bodies()).find((x) => fea().body !== null && same(x.name, fea().body!))
    lastKey = b?.key ?? null
    const stale = b ? staleness(b.key) : 'the body is gone'
    return { ...brief(r), setup: r.setup, current: stale === null, ...(stale ? { stale } : {}) }
  },
}

const show: Command<{ field?: Field; shown?: boolean }> = {
  name: 'show',
  title: 'Show the answer on the part',
  description: 'Colour the part by the answer: safety (the safety factor; below 1 it breaks), vonMises (MPa), displacement (mm), across (the stress across the layers, MPa; positive pulls them apart) or shear (between the layers, MPa). shown: false takes it off. Puts the Strength workspace on screen, so view.render then pictures it.',
  input: obj({ field: enumOf(FIELDS), shown: bool() }),
  readOnly: true,
  scene: true,
  run: async ({ field, shown = true }) => {
    if (shown && !fea().result) throw new CommandError('not_found', 'Nothing has been solved yet: fea.solve.')
    useFea.setState({ ...(field ? { field } : {}), shown })
    // Drawn on the Strength workspace's stage: put it on screen, so a
    // picture (view.render) shows it.
    if (shown && useShell.getState().workspace !== 'fea') useShell.getState().setWorkspace('fea')
    return { shown: fea().shown ? fea().field : null }
  },
}

// The server's replies are read-only: queued behind the solve they
// answer, they would wait for ever.
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

/** fea.show colours the part on the stage, which a session without the
 *  page has not got; the rest run headless (Command.headless) — the solve
 *  asked of the agent's server the engine runs in, as the page asks it. */
const PAGE_ONLY: Record<string, string> = { show: 'fea.results gives the last answer — the worst safety factor and where, the largest stress and displacement; nothing is drawn.' }

export const feaCommands = ([tools, setup, hold, load, clear, solve, cancel, results, show, answer, progress] as Command<never>[]).map((c) => (PAGE_ONLY[c.name] ? { ...c, headlessInstead: PAGE_ONLY[c.name] } : { ...c, headless: true }))
