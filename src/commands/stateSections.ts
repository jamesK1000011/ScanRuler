// SPDX-License-Identifier: AGPL-3.0-only
// The plugins' parts of the session's readout (state.ts), each under its
// plugin's id. Kept apart from the readout itself so that a plugin
// registering its part at start-up does not bring the readout into the page.

const sections = new Map<string, () => unknown>()
const briefs = new Map<string, () => unknown>()

/** A plugin's part of the readout, under its id: whatever `describe` returns,
 *  as plain JSON. Called from the plugin's install(); the returned function
 *  takes it out again. Two parts under one id throw. `brief`, what a step of
 *  the history answers in its place: the few things a walk through the steps
 *  changes. */
export function registerStateSection(id: string, describe: () => unknown, brief?: () => unknown): () => void {
  if (sections.has(id)) throw new Error(`Two state sections share the id "${id}".`)
  sections.set(id, describe)
  if (brief) briefs.set(id, brief)
  return () => {
    if (sections.get(id) === describe) {
      sections.delete(id)
      briefs.delete(id)
    }
  }
}

/** Every part, read now; a part that throws reads as its error. */
export function readStateSections(): Record<string, unknown> {
  return readAll(sections)
}

/** One part, read now — another plugin's, say, read without importing it;
 *  undefined when no plugin in use registered it, or it throws. */
export function readStateSection(id: string): unknown {
  try {
    return sections.get(id)?.()
  } catch {
    return undefined
  }
}

/** Every part's brief, read now. */
export function readStateBriefs(): Record<string, unknown> {
  return readAll(briefs)
}

function readAll(parts: ReadonlyMap<string, () => unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [id, describe] of parts) {
    try {
      out[id] = describe()
    } catch (e) {
      out[id] = { error: e instanceof Error ? e.message : String(e) }
    }
  }
  return out
}
