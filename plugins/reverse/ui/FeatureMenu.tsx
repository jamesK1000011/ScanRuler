// SPDX-License-Identifier: AGPL-3.0-only
// A feature row's menu, opened by a right click on the row: leave the
// feature out of the build or build it again — and every feature of its
// kind at once, or every round and chamfer, a draft of the part that
// rebuilds in a moment while the rest is modelled, the rounds coming back
// as they were. And the key in a feature's row that suppresses it — where
// a sketch's row has its eye, hiding a feature's tool hiding nothing — and
// the row a suppressed feature has in the list: greyed, struck through.

import { useEffect, useState, type ReactElement, type RefObject } from 'react'
import { dependentsOf, type Feature } from '../core/features'
import { reEditorOpen, useReverse } from '../state/reStore'
import { useStore } from '../../../src/state/store'
import { Icon } from '../../../src/ui/icons'
import { KeyIcon, type KeyIconName } from './reIcons'
import { useDismiss } from '../../../src/ui/useDismiss'

/** The rows the list draws a feature as, above and below the rollback bar,
 *  in the list's order. */
const ROWS = '[data-test="feature-row"], [data-test="feature-row-rolled"]'

/** What a kind of feature is called in the menu's "every …" — the kinds
 *  worth switching all at once. */
const KIND_WORDS: Partial<Record<Feature['kind'], string>> = {
  fillet: 'fillet',
  chamfer: 'chamfer',
  hole: 'hole',
  thread: 'thread',
  draft: 'draft',
  deleteFace: 'delete face',
  pattern: 'pattern',
  shell: 'shell',
  mirror: 'mirror',
  extrude: 'extrude',
  revolve: 'revolve',
}

interface MenuItem {
  label: string
  title: string
  ids: number[]
  on: boolean
}

/** What the menu offers for a feature: itself, every feature of its kind,
 *  and — on a round or a chamfer — every round and chamfer. */
function itemsFor(f: Feature, all: readonly Feature[]): MenuItem[] {
  const items: MenuItem[] = [
    f.suppressed
      ? { label: 'Build again', title: `Put ${f.name} back into the build, as it was`, ids: [f.id], on: false }
      : { label: 'Suppress', title: `Leave ${f.name} out of the build, settings kept`, ids: [f.id], on: true },
  ]
  const group = (kinds: Feature['kind'][], name: string) => {
    const of = all.filter((g) => kinds.includes(g.kind))
    if (of.length < 2) return
    const on = of.filter((g) => !g.suppressed)
    const off = of.filter((g) => g.suppressed)
    if (on.length > 0) items.push({ label: `Suppress every ${name} (${on.length})`, title: `Leave every ${name} out of the build`, ids: on.map((g) => g.id), on: true })
    if (off.length > 0) items.push({ label: `Build every ${name} again (${off.length})`, title: `Put every suppressed ${name} back into the build`, ids: off.map((g) => g.id), on: false })
  }
  const word = KIND_WORDS[f.kind]
  if (word) group([f.kind], word)
  if ((f.kind === 'fillet' || f.kind === 'chamfer') && all.some((g) => g.kind === 'fillet') && all.some((g) => g.kind === 'chamfer')) group(['fillet', 'chamfer'], 'round and chamfer')
  return items
}

/**
 * The menu of the list's rows: a right click on a feature's row opens it
 * where the pointer is; a click on an item, outside it, Escape or a scroll
 * closes it. `locked` — a box open, the bar moved by something else —
 * keeps it shut. Returns the menu to draw, or null.
 */
export function useFeatureMenu(list: RefObject<HTMLElement | null>, locked: boolean): ReactElement | null {
  const [open, setOpen] = useState<{ x: number; y: number; feature: Feature } | null>(null)
  useEffect(() => {
    const el = list.current
    if (!el) return
    const onMenu = (e: MouseEvent) => {
      const row = (e.target as Element | null)?.closest?.(ROWS)
      if (!row || locked) return
      const re = useReverse.getState()
      const feature = [...re.features, ...re.rolledBack][[...el.querySelectorAll(ROWS)].indexOf(row)]
      if (!feature) return
      e.preventDefault()
      setOpen({ x: e.clientX, y: e.clientY, feature })
    }
    el.addEventListener('contextmenu', onMenu)
    return () => el.removeEventListener('contextmenu', onMenu)
  })
  useDismiss(open !== null, () => setOpen(null), { escape: 'pass', outside: '.re-menu' })
  if (!open) return null
  const re = useReverse.getState()
  const items = itemsFor(open.feature, [...re.features, ...re.rolledBack])
  // Kept on the screen: opened near the right or bottom edge, it opens
  // leftward or upward.
  const left = Math.min(open.x, window.innerWidth - 240)
  const top = Math.min(open.y, window.innerHeight - 12 - items.length * 28)
  return (
    <div className="re-menu" role="menu" data-test="feature-menu" style={{ left, top }}>
      <div className="re-menu-head">{open.feature.name}</div>
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          title={item.title}
          onClick={() => {
            setOpen(null)
            if (reEditorOpen(useReverse.getState())) return
            useReverse.getState().setSuppressed(item.ids, item.on)
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/** The key in a built feature's row, where a sketch's row has its eye: a
 *  click suppresses the feature. */
export function SuppressKey({ feature, locked }: { feature: Feature; locked: boolean }) {
  return (
    <button className="x eye" data-test="feature-suppress" disabled={locked} title={locked ? 'Finish what is open first' : `Suppress ${feature.name}, settings kept`} onClick={() => useReverse.getState().setSuppressed([feature.id], true)}>
      <KeyIcon name="built" size={14} />
    </button>
  )
}

/** The row of a suppressed feature: its kind and name greyed and struck
 *  through, the suppress key struck through too — a click on it builds the
 *  feature again — and the bin. Opened for editing once it is built
 *  again. */
export function SuppressedRow({ feature, icon, locked }: { feature: Feature; icon: KeyIconName; locked: boolean }) {
  const restore = () => useReverse.getState().setSuppressed([feature.id], false)
  const remove = () => {
    const re = useReverse.getState()
    if (dependentsOf(feature.id, [...re.features, ...re.rolledBack]).length > 0) useStore.getState().setError(`${feature.name} is built on by a later feature — delete that first.`)
    else re.removeFeature(feature.id)
  }
  return (
    <div className="kv ghost suppressed" data-test="feature-row" data-suppressed="true" title={`${feature.name} is suppressed. Right-click for its menu`}>
      <span className="kind">
        <KeyIcon name={icon} size={15} />
      </span>
      <span className="name">{feature.name}</span>
      <b>suppressed</b>
      <button className="x edit" disabled title={`Build ${feature.name} again to edit it`}>
        <Icon name="edit" size={14} />
      </button>
      <button className="x eye off" data-test="feature-unsuppress" disabled={locked} title={locked ? 'Finish what is open first' : `Suppressed — build ${feature.name} again`} onClick={restore}>
        <KeyIcon name="suppressed" size={14} />
      </button>
      <button className="x" disabled={locked} title={`Delete ${feature.name}`} onClick={remove}>
        <Icon name="bin" size={14} />
      </button>
    </div>
  )
}
