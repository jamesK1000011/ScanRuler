// SPDX-License-Identifier: AGPL-3.0-only
// The app without a browser, for an agent's server to run in its own
// process (scanruler-mcp --engine): the session headless — no viewport, no
// page — its mesh worker in this thread, the commands registered, the
// plugins installed and each started headless where it can be. Only the
// commands marked to run so (Command.headless) are offered; any other
// answers `unavailable`, naming the page. Built for Node by
// scripts/build-engine.mjs into one module, dist-engine/engine.mjs, that
// exports startEngine(); the server finds it by path, not by import, and
// knows nothing of what is in it.
//
// One engine a process: the stores are the app's own module state.

import type { CommandInfo } from '../commands/types'

/** The app as a headless engine — what scanruler-mcp's engine link talks
 *  to. The same commands, inputs and answers as the page's. */
export interface HeadlessEngine {
  app: 'ScanRuler'
  version: string
  /** The plugins installed, by id. */
  plugins: string[]
  /** The commands that run here, as the page lists its own. */
  listCommands(): CommandInfo[]
  /** The names of the commands that need the page — what a server tells a
   *  caller of one to use the page mode for. */
  pageCommands(): string[]
  /** What does the work of a command that needs the page here, where
   *  something does (Command.headlessInstead) — what a server adds to its
   *  refusal; null where nothing does. */
  insteadOf(name: string): string | null
  /** Run a command; rejects with { code, message } as the page does. A
   *  command that needs the page is refused `unavailable`. */
  run(name: string, input: unknown, onProgress?: (text: string) => void): Promise<unknown>
  /** Link the engine to the agent's server it runs in, as a page's link to
   *  it: what it answers beyond the commands (features — the FEA solve,
   *  KiCad, tscircuit), and the notices the plugins ask those with, handed
   *  to `notice`; the answers come back as runs of their internal commands.
   *  Returns the function that unlinks it. */
  attach(server: EngineServer): () => void
  /** Every plugin stopped, the session let go. */
  stop(): Promise<void>
}

/** The agent's server an engine runs in, as attach() takes it. */
export interface EngineServer {
  version: string | null
  features: string[]
  notice(kind: string, data: Record<string, unknown>): void
}

type Listener = ((event: { data: unknown }) => void) | null

let started: Promise<HeadlessEngine> | null = null

/** The mesh worker in this thread: its module sets its onmessage on the
 *  `self` it is loaded under, and `new Worker(...)` reaches it through a
 *  timer each way, never synchronously — as a real worker does. */
async function workerInThisThread(): Promise<void> {
  let current: { onmessage: Listener } | null = null
  const scope: { onmessage: Listener; postMessage(msg: unknown): void } = {
    onmessage: null,
    postMessage: (msg) => setTimeout(() => current?.onmessage?.({ data: msg }), 0),
  }
  const g = globalThis as unknown as Record<string, unknown>
  g.self = scope
  await import('../core/meshWorker')
  g.Worker = class {
    onmessage: Listener = null
    onerror: ((e: { message: string; preventDefault(): void }) => void) | null = null
    onmessageerror: (() => void) | null = null
    constructor() {
      current = this
    }
    postMessage(msg: unknown): void {
      setTimeout(() => scope.onmessage?.({ data: msg }), 0)
    }
    terminate(): void {
      if (current === this) current = null
    }
  }
}

/** Start the engine, once a process. */
export function startEngine(): Promise<HeadlessEngine> {
  started ??= start()
  return started
}

async function start(): Promise<HeadlessEngine> {
  await workerInThisThread()
  // One after another: the modules import each other, and loaded side by
  // side a module runner can wait on itself.
  const { createSession } = await import('../app/session')
  const { MeshWorkerClient } = await import('../core/workerClient')
  const { registerCoreCommands } = await import('../commands/core')
  const { installCommandHost } = await import('../commands/host')
  const registry = await import('../commands/registry')
  const { installPlugins } = await import('../plugins/registry')
  const { CommandError } = await import('../commands/types')
  const { APP_VERSION } = await import('../version')
  const { setNoticeOut } = await import('../commands/notice')
  const { useAgentLink } = await import('../commands/agentLink')
  const session = createSession({ clientRef: { current: new MeshWorkerClient() }, sceneRef: { current: null } })
  const stops: (() => void)[] = [session.watch(), installCommandHost({ session })]
  const plugins = installPlugins()
  registerCoreCommands()
  for (const p of plugins) if (p.headless) stops.push(await p.headless())
  return {
    app: 'ScanRuler',
    version: APP_VERSION,
    plugins: plugins.map((p) => p.id),
    listCommands: () => registry.listCommands().filter((c) => registry.runsHeadless(c.name)),
    pageCommands: () => registry.listCommands().flatMap((c) => (registry.runsHeadless(c.name) ? [] : [c.name])),
    insteadOf: (name) => registry.headlessInstead(name),
    run: (name, input, onProgress) => {
      if (registry.listCommands().some((c) => c.name === name) && !registry.runsHeadless(name)) {
        const instead = registry.headlessInstead(name)
        return Promise.reject(new CommandError('unavailable', `${name} needs the ScanRuler page — a scan, the viewport or the browser — and this session runs without one (headless). ${instead ? `Headless: ${instead} Or use` : 'Use'} the page mode for it: the agent’s server started without an engine, paired with a ScanRuler tab.`))
      }
      return registry.runCommand(name, input, onProgress)
    },
    attach: (server) => {
      // Notices go out as a page's bridge sends them: never in the same
      // turn as the run that sent them.
      setNoticeOut((m) => setTimeout(() => server.notice(m.kind, m.data), 0))
      useAgentLink.setState({ status: 'connected', detail: null, server: { version: server.version, features: [...server.features] } })
      return () => {
        setNoticeOut(null)
        useAgentLink.setState({ status: 'off', detail: null, server: null })
      }
    },
    stop: async () => {
      for (const stop of stops.reverse()) stop()
    },
  }
}
