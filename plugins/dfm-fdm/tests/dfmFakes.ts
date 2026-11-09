// SPDX-License-Identifier: AGPL-3.0-only
// What the dfm commands reach outside the plugin, faked for their test: the
// viewport (a scan mesh and a reference geometry a test sets, or none), the
// app's stores they read, the command registry (Reverse Engineer's
// export.stl as a test sets it), the state sections, the schema builders,
// and CommandError.

export const stage: {
  scene: boolean
  scan: { positions: Float32Array; indices: Uint32Array } | null
  reference: { positions: Float32Array; indices: Uint32Array } | null
} = { scene: true, scan: null, reference: null }

export class CommandError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const scene = {
  scanMesh: () => stage.scan,
  nominalGeometry: () =>
    stage.reference && {
      getAttribute: () => ({ array: stage.reference!.positions }),
      getIndex: () => ({ array: stage.reference!.indices }),
    },
}
export const sceneOf = () => (stage.scene ? scene : null)
export function requireScene(what: string) {
  if (!stage.scene) throw new CommandError('unavailable', `${what} needs the viewport, and this session has none.`)
  return scene
}
export const commandHost = () => ({ session: { clientRef: { current: null } } })

const fakeStore = <T extends object>(state: T) => ({ getState: () => state, setState: (p: Partial<T>) => Object.assign(state, p) })
export const app = { fileName: null as string | null, busy: false, statusText: '', setStatus: (t: string) => void (app.statusText = t) }
export const useStore = fakeStore(app)
export const deviation = {
  nominalName: null as string | null,
  nominalBusy: false,
  nominalMadeFrom: null as { by: string; parts: { id: number; name: string; stamp: string }[] } | null,
}
export const useDeviation = fakeStore(deviation)
export const useThickness = fakeStore({ method: 'ray', coneRays: 0, coneAngleDeg: 30, normalDeviationDeg: 60, maxThickness: 10 })

export const handlers: Record<string, (input: never) => unknown> = {}
export const calls: { name: string; input: Record<string, unknown> }[] = []
export async function runCommand(name: string, input: Record<string, unknown>): Promise<unknown> {
  calls.push({ name, input })
  const h = handlers[name]
  if (!h) throw new Error(`No command ${name}.`)
  return h(input as never)
}

export const sections: { reverse?: () => unknown } = {}
export const readStateSection = (id: string) => (id === 'reverse' ? sections.reverse?.() : undefined)

const schema = (..._args: unknown[]) => ({})
export const anyObject = schema, arr = schema, bool = schema, enumOf = schema, obj = schema, str = schema, num = schema, oneOf = schema
