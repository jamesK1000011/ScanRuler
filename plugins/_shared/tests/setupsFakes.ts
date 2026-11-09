// SPDX-License-Identifier: AGPL-3.0-only
// The command registry as the setups reader reaches it, faked for its
// test: setup.set run within a change, recorded and applied to the setups
// the test holds.

export const calls: { name: string; input: Record<string, unknown> }[] = []
export const handlers: Record<string, (input: never) => unknown> = {}
export async function runWithin(name: string, input: Record<string, unknown>): Promise<unknown> {
  calls.push({ name, input })
  return handlers[name]?.(input as never)
}
export const runCommand = runWithin
