// SPDX-License-Identifier: AGPL-3.0-only
// The picked bodies' material, in the bar under the body list: what they
// are made of, set or taken off with the material commands (one undo step
// each). Shown only where the material plugin is in the build; the list
// reads who has what from the shared store, not from that plugin.

import { runCommand } from '../../../src/commands/registry'
import { useStore } from '../../../src/state/store'
import { useMemo } from 'react'
import { CATEGORIES, library, useMaterialLibrary } from '../../_shared/materials'
import { useAssigned } from '../../_shared/materials/assigned'
import { useLibraryLoaded } from '../../_shared/materials/useLibrary'

const MIXED = '*'

export function BodyMaterial({ ids }: { ids: readonly number[] }) {
  const installed = useAssigned((s) => s.installed)
  const assigned = useAssigned((s) => s.assigned)
  // FreeCAD's cards are fetched when the list is first shown; until then it
  // offers the app's own, and says the rest are coming.
  const status = useLibraryLoaded(installed && ids.length > 0)
  const cards = useMaterialLibrary((s) => s.cards)
  const byCategory = useMemo(
    () => CATEGORIES.map((c) => ({ c, list: library().filter((m) => m.category === c).sort((a, b) => a.name.localeCompare(b.name)) })).filter(({ list }) => list.length > 0),
    // library() changes only when the cards arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards],
  )
  if (!installed || ids.length === 0) return null
  const now = ids.map((id) => assigned[String(id)])
  const same = now.every((a) => JSON.stringify(a) === JSON.stringify(now[0]))
  const one = now[0]
  const value = !same ? MIXED : one === undefined ? '' : typeof one === 'string' ? one : 'custom'
  const pick = (v: string) => {
    const done = v === '' ? runCommand('material.clear', { body: [...ids] }) : runCommand('material.set', { body: [...ids], material: v })
    done.catch((e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) }))
  }
  return (
    <select className="bodymat" data-test="body-material" value={value} title="What these bodies are made of" onChange={(e) => e.target.value !== MIXED && e.target.value !== 'custom' && pick(e.target.value)}>
      <option value="">No material</option>
      {value === MIXED && <option value={MIXED}>Mixed</option>}
      {value === 'custom' && typeof one === 'object' && <option value="custom">{one.custom.name}</option>}
      {/* Set to a card not here yet: shown by its id, so the list does not read as "No material". */}
      {typeof one === 'string' && same && !library().some((m) => m.id === one) && <option value={one}>{one}</option>}
      {status === 'loading' && (
        <option value="" disabled>
          Loading FreeCAD’s materials…
        </option>
      )}
      {status === 'failed' && (
        <option value="" disabled>
          FreeCAD’s materials could not be loaded
        </option>
      )}
      {byCategory.map(({ c, list }) => (
        <optgroup key={c} label={c[0].toUpperCase() + c.slice(1)}>
          {list.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
