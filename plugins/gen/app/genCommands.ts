// SPDX-License-Identifier: AGPL-3.0-only
// The Generate workspace's commands (gen.*): the generators and their
// parameters; values set for the panel; a part made and brought into
// Reverse Engineer as bodies of its own (an Import feature, saved with the
// project, to cut, fillet and export like any other); or the file alone.

import { runCommand } from '../../../src/commands/registry'
import { anyObject, bool, enumOf, num, obj, str } from '../../../src/commands/schema'
import { readStateSections } from '../../../src/commands/stateSections'
import { type Command, CommandError } from '../../../src/plugins/api'
import { generatorOf, GENERATORS, matchParts, valuesOf, type Generator, type Value } from '../core/generators'
import type { GenPart } from '../core/genWorker'
import { build, stop } from './genClient'
import { setupOf, useGen } from '../state/genStore'

const st = () => useGen.getState()
const IDS = GENERATORS.map((g) => g.id)
const r2 = (x: number) => Math.round(x * 100) / 100

function generator(id?: string): Generator {
  const g = generatorOf(id ?? st().generator)
  if (!g) throw new CommandError('invalid_input', `There is no generator "${id}" (there are ${IDS.join(', ')}).`)
  return g
}

/** The values to build with: those set for the generator, then those given. */
function values(g: Generator, given?: Record<string, unknown>): Record<string, Value> {
  try {
    return valuesOf(g, given ?? {}, { ...g.defaults, ...(st().values[g.id] ?? {}) })
  } catch (e) {
    throw new CommandError('invalid_input', e instanceof Error ? e.message : String(e))
  }
}

const partOut = (p: GenPart) => ({ name: p.name, volume: Math.round(p.volume), size: p.box.max.map((x, i) => r2(x - p.box.min[i])), min: p.box.min.map(r2) })

export function describeGen() {
  const s = st()
  return {
    setup: setupOf(s),
    ...(s.made ? { made: { generator: s.made.generator, bodies: s.made.bodies, parts: s.made.parts.map(partOut) } } : {}),
  }
}

const genIn = enumOf(IDS, `The generator: ${IDS.join(', ')}; the one picked in the panel by default.`)
const paramsIn = anyObject('Parameter values by key (gen.list gives each generator’s keys, ranges and defaults); the rest as set in the panel.')

const list: Command<{ generator?: string }> = {
  name: 'list',
  title: 'The generators and their parameters',
  description: 'Each generator: what it makes, its parameters (key, kind, range, unit, what it does), the defaults and the values set now. generator narrows it to one. Changes nothing.',
  input: obj({ generator: genIn }),
  readOnly: true,
  run: async ({ generator: id }) => {
    const gs = id ? [generator(id)] : GENERATORS
    return {
      picked: st().generator,
      generators: gs.map((g) => ({ id: g.id, label: g.label, blurb: g.blurb, params: g.params.map(({ length, ...p }) => (length ? { ...p, unit: 'mm' } : p)), defaults: g.defaults, values: { ...g.defaults, ...(st().values[g.id] ?? {}) } })),
    }
  },
}

const set: Command<{ generator?: string; params?: Record<string, unknown>; reset?: boolean }> = {
  name: 'set',
  title: 'Pick a generator and set its values',
  description: 'Pick the generator the panel shows and set its values, checked as gen.make checks them; reset: true takes that generator back to its defaults. Makes nothing. One undo step.',
  input: obj({ generator: genIn, params: paramsIn, reset: bool('Back to the defaults.') }),
  label: ({ generator: id }) => `generator ${id ?? st().generator}`,
  run: async ({ generator: id, params, reset }) => {
    const g = generator(id)
    const v = reset ? valuesOf(g, params ?? {}) : values(g, params)
    st().set({ generator: g.id })
    st().setValues(g.id, v)
    return { generator: g.id, values: v }
  },
}

/** Builds one at a time — a make's bodies are told apart from what was
 *  there before it — with the panel told it is busy. A stop also ends
 *  those waiting their turn. */
let queue: Promise<unknown> = Promise.resolve()
let waitingTurn = 0
let stops = 0
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const asked = stops
  waitingTurn++
  useGen.setState({ busy: true })
  const mine = queue.then(async () => {
    if (stops !== asked) throw new CommandError('failed', 'Stopped.')
    return job()
  })
  const settle = () => {
    if (--waitingTurn === 0) useGen.setState({ busy: false, status: '' })
  }
  queue = mine.then(settle, settle)
  return mine
}

async function run(g: Generator, v: Record<string, Value>, out: 'step' | 'stl' | 'info', signal?: AbortSignal, chord?: number) {
  useGen.setState({ busy: true, status: `Building ${g.label.toLowerCase()}…` })
  try {
    return await build({ generator: g.id, params: v, out, ...(chord ? { chord } : {}) }, signal)
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    throw new CommandError('failed', m === 'Stopped.' ? 'Stopped.' : `${g.label} could not be built: ${m}`)
  }
}

interface ReverseBody {
  id: number
  name: string
  bounds?: { min: [number, number, number]; max: [number, number, number] } | null
}
const reverseBodies = () => (readStateSections().reverse as { bodies?: ReverseBody[] } | undefined)?.bodies ?? []

const make: Command<{ generator?: string; params?: Record<string, unknown>; name?: string }> = {
  name: 'make',
  title: 'Make the part in Reverse Engineer',
  description:
    'Build the part and bring it into Reverse Engineer as bodies of their own — an Import feature saved with the project, to cut, fillet, check and export like any other (reverse.feature.add, reverse.export.stl). Values as set (gen.set) unless given here; name names the bodies (the generator’s names otherwise, with 2, 3 … after a name taken). Each part stands on z = 0, centred on the origin; a lid lies beside its box. Returns the bodies, each part’s volume (mm³) and size (mm).',
  input: obj({ generator: genIn, params: paramsIn, name: str('What to call the bodies (up to 60 characters).', { minLength: 1 }) }),
  long: true,
  timeoutMs: 300_000,
  label: ({ generator: id }) => `make ${generatorOf(id ?? st().generator)?.label.toLowerCase() ?? 'part'}`,
  run: async ({ generator: id, params, name: given }, ctx) => {
    const g = generator(id)
    const v = values(g, params)
    const name = given?.trim()
    if (given !== undefined && !name) throw new CommandError('invalid_input', 'name: give some letters, or leave it out.')
    if (name !== undefined && name.length > 60) throw new CommandError('invalid_input', 'name: up to 60 characters.')
    return inTurn(async () => {
      ctx.progress(`Building ${g.label.toLowerCase()}…`)
      const a = await run(g, v, 'step', ctx.signal)
      if (!a.step) throw new CommandError('failed', `${g.label} gave no STEP.`)
      ctx.signal?.throwIfAborted()
      const before = reverseBodies()
      const had = new Set(before.map((b) => b.id))
      const base = (name ?? a.parts.map((p) => p.name).join(' + ')).replace(/[\\/:*?"<>|]+/g, ' ').trim() || g.label
      await runCommand('reverse.import.step', { bytes: new TextEncoder().encode(a.step), name: `${base}.step` })
      const fresh = reverseBodies().filter((b) => !had.has(b.id))
      // Each part to the body that stands where it does (the file's order
      // is not promised), then named after it.
      const partOf = matchParts(a.parts, fresh)
      const taken = new Set([...before, ...fresh].map((b) => b.name.toLowerCase()))
      const bodies: string[] = []
      for (const [i, b] of fresh.entries()) {
        const part = partOf[i]
        const want0 = name ? (fresh.length > 1 ? `${name} ${part?.name ?? i + 1}` : name) : (part?.name ?? b.name)
        taken.delete(b.name.toLowerCase())
        let want = want0
        for (let n = 2; taken.has(want.toLowerCase()); n++) want = `${want0} ${n}`
        if (want !== b.name) await runCommand('reverse.body.set', { body: b.id, name: want }).catch(() => (want = b.name))
        taken.add(want.toLowerCase())
        bodies.push(want)
      }
      const parts = fresh.map((_, i) => partOf[i]).filter((p): p is GenPart => !!p)
      useGen.setState({ made: { generator: g.id, params: v, parts: parts.length === fresh.length ? parts : a.parts, bodies } })
      return { generator: g.id, values: v, bodies, parts: a.parts.map(partOut), status: `${g.label}: ${bodies.join(', ')} in Reverse Engineer.` }
    })
  },
}

const exportFile: Command<{ generator?: string; params?: Record<string, unknown>; format?: 'step' | 'stl'; chord?: number }> = {
  name: 'export',
  title: 'The part as a file',
  description: 'Build the part and hand back the file alone — STEP (the default) or binary STL in mm, meshed to chord (how far a triangle may stand off a curved face, 0.02 mm by default) — without bringing it into the project. Values as set unless given here. Returns the file and each part’s volume and size.',
  input: obj({ generator: genIn, params: paramsIn, format: enumOf(['step', 'stl'], 'step (the default) or stl.'), chord: num('mm; 0.02 by default.', { exclusiveMinimum: 0, maximum: 1 }) }),
  readOnly: true,
  long: true,
  returnsFile: true,
  timeoutMs: 300_000,
  run: async ({ generator: id, params, format = 'step', chord }, ctx) => {
    const g = generator(id)
    const v = values(g, params)
    ctx.progress(`Building ${g.label.toLowerCase()}…`)
    const a = await inTurn(() => run(g, v, format, ctx.signal, chord))
    const base = a.parts.map((p) => p.name).join(' + ').replace(/[\\/:*?"<>|]+/g, ' ').trim()
    const file = format === 'stl' ? { name: `${base}.stl`, mimeType: 'model/stl', bytes: a.stl as Uint8Array } : { name: `${base}.step`, mimeType: 'model/step', bytes: new TextEncoder().encode(a.step ?? '') }
    if (!file.bytes?.length) throw new CommandError('failed', `${g.label} gave an empty file.`)
    return { file, parts: a.parts.map(partOut) }
  },
}

const measure: Command<{ generator?: string; params?: Record<string, unknown> }> = {
  name: 'measure',
  title: 'Size the part without making it',
  description: 'Build the part and say each part’s volume (mm³) and size (mm) — a check of the values before gen.make. Values as set unless given here. Changes nothing.',
  input: obj({ generator: genIn, params: paramsIn }),
  readOnly: true,
  long: true,
  timeoutMs: 300_000,
  run: async ({ generator: id, params }, ctx) => {
    const g = generator(id)
    const v = values(g, params)
    const a = await inTurn(() => run(g, v, 'info', ctx.signal))
    return { generator: g.id, values: v, parts: a.parts.map(partOut) }
  },
}

const stopCmd: Command<Record<string, never>> = {
  name: 'stop',
  title: 'Stop the build',
  description: 'Stop the part being built, if one is. Nothing is brought in.',
  input: obj({}),
  interrupts: true,
  history: false,
  run: async () => {
    const was = st().busy
    stops++
    stop('Stopped.')
    return { stopped: was }
  },
}

export const genCommands: Command[] = [list, set, make, exportFile, measure, stopCmd] as Command[]
