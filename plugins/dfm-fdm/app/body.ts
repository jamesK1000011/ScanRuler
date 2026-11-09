// SPDX-License-Identifier: AGPL-3.0-only
// A Reverse Engineer body as dfm checks it: read from that workspace's state
// and meshed by its own export command, run here — never imported, so this
// plugin stands without it — and the body's stamp, which tells a reference
// part made from a body that has changed since.

import { runCommand } from '../../../src/commands/registry'
import { readStateSection } from '../../../src/commands/stateSections'
import { CommandError } from '../../../src/plugins/api'
import type { NominalMadeFrom } from '../../../src/state/deviationStore'
import { readBinaryStl } from '../core/stl'

export interface ReverseBody {
  id: number
  name: string
  visible: boolean
  surface?: boolean
  /** A hash of the body's mesh; another once the body changes. */
  stamp?: string
}

/** The bodies as they stand, or null with no Reverse Engineer in this build. */
export function reverseBodies(): ReverseBody[] | null {
  const r = readStateSection('reverse') as { bodies?: ReverseBody[] } | undefined
  return r ? (r.bodies ?? []) : null
}

/** The body named (by name or id), or the one solid body shown. */
export function pickBody(ref: string | number | null): ReverseBody {
  const all = reverseBodies()
  if (!all) throw new CommandError('unavailable', 'Checking a body needs the Reverse engineer workspace, and this build has none.')
  const solids = all.filter((b) => !b.surface)
  if (ref !== null && ref !== undefined) {
    const b = all.find((x) => x.id === ref || x.name === ref)
    if (!b) throw new CommandError('not_found', `No body "${ref}" — have ${solids.map((x) => x.name).join(', ') || 'none'}.`)
    if (b.surface) throw new CommandError('invalid_input', `${b.name} is a surface — only a solid body can be printed.`)
    return b
  }
  if (!solids.length) throw new CommandError('invalid_state', 'There is no solid body to check — build one in Reverse engineer first, or set target: scan.')
  const shown = solids.filter((b) => b.visible)
  if (shown.length === 1) return shown[0]
  if (solids.length === 1) return solids[0]
  throw new CommandError('invalid_input', `Say which body to check (dfm.settings body): ${solids.map((x) => x.name).join(', ')}.`)
}

/** The chord the body is meshed to for the check: fine enough for a small
 *  hole's circle and a thin wall, coarse enough to stay quick. */
const CHORD_MM = 0.05

/** The body's triangles as it stands now, corners x y z after x y z. */
export async function bodyTriangles(body: ReverseBody): Promise<{ soup: Float64Array; stamp?: string }> {
  const r = (await runCommand('reverse.export.stl', { bodies: [body.id], chord: CHORD_MM })) as { file?: { bytes: Uint8Array }; bodies?: { id: number; stamp?: string }[] }
  if (!r?.file?.bytes) throw new CommandError('failed', `${body.name} gave no mesh.`)
  try {
    const soup = readBinaryStl(r.file.bytes)
    const stamp = r.bodies?.find((b) => b.id === body.id)?.stamp ?? body.stamp
    return { soup, ...(stamp ? { stamp } : {}) }
  } catch (e) {
    throw new CommandError('failed', `${body.name}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Why a reference made from bodies is an older copy of them, or null:
 *  a body it was made from has changed (another stamp) or is gone. */
export function staleReference(made: NominalMadeFrom | null): string | null {
  if (!made || made.by !== 'reverse') return null
  const now = reverseBodies()
  if (!now) return null
  // A body not meshed yet (a project still building) has no stamp to go by:
  // not counted as changed.
  const changed = made.parts.filter((p) => {
    const b = now.find((x) => x.id === p.id)
    return !b || (b.stamp !== undefined && b.stamp !== p.stamp)
  })
  if (!changed.length) return null
  const one = changed.length === 1
  return `Checked an older copy: ${changed.map((p) => p.name).join(', ')} changed since the reference part was made. Check the body itself to see ${one ? 'it' : 'them'} as ${one ? 'it is' : 'they are'} now.`
}
