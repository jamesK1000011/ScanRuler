// SPDX-License-Identifier: AGPL-3.0-only
// The Make tab's head: the setups — how each part is made — to choose
// from, add, rename and remove; for the one chosen, its parts and its
// type's settings; and under them the chosen setup's pages (a print
// setup's Check · Slice · Send). With no setup chosen the tab's pages are
// all offered, as before there were setups. Every change runs setup.*.

import { useEffect, useState } from 'react'
import { runCommand } from '../../../src/commands/registry'
import { readStateSection } from '../../../src/commands/stateSections'
import type { HostHeaderProps } from '../../../src/plugins/api'
import { useStore } from '../../../src/state/store'
import { useShell } from '../../../src/state/shellStore'
import { InfoDot } from '../../../src/ui/InfoDot'
import { PageTabs } from '../../../src/ui/PageStrip'
import { pagesOfType, setupTypeOf, setupTypes, type Setup } from '../../_shared/setups'
import { useSetups } from '../state/setupsStore'
import './setups.css'

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
const run = (name: string, input: Record<string, unknown>) => runCommand(`setup.${name}`, input).catch(report)

interface Body {
  id: number
  name: string
  surface?: boolean
  visible?: boolean
}
const solids = (): Body[] => ((readStateSection('reverse') as { bodies?: Body[] } | undefined)?.bodies ?? []).filter((b) => !b.surface)
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function Parts({ setup }: { setup: Setup }) {
  const [, setTick] = useState(0)
  const all = solids()
  // A body is held by its id, or by its name from an older project.
  const holds = (b: Body) => setup.bodies.some((x) => x === String(b.id) || same(x, b.name))
  const gone = setup.bodies.filter((k) => !all.some((x) => k === String(x.id) || same(k, x.name)))
  if (!all.length && !gone.length) return <p className="hint">No parts yet: build or import a body first.</p>
  return (
    <div className="setup-parts" onFocus={() => setTick((t) => t + 1)} data-test="setup-parts">
      {all.map((b) => {
        const on = holds(b)
        return (
          <label key={b.id} className="checkrow" title={on ? 'Made by this setup' : 'Make it by this setup'}>
            <input type="checkbox" checked={on} onChange={() => void run('set', { id: setup.id, [on ? 'remove' : 'add']: [b.name] })} />
            {b.name}
            {b.visible === false ? ' (hidden)' : ''}
          </label>
        )
      })}
      {gone.map((b) => (
        <label key={b} className="checkrow" title="No body has this name now">
          <input type="checkbox" checked onChange={() => void run('set', { id: setup.id, remove: [b] })} />
          {/^\d+$/.test(b) ? `Body ${b}` : b} (not found)
        </label>
      ))}
    </div>
  )
}

function Details({ setup }: { setup: Setup }) {
  const type = setupTypeOf(setup.type)
  const Settings = type?.Settings
  return (
    <div className="setup-details" data-test="setup-details">
      <label className="field" title="The setup’s name">
        <span>Name</span>
        <input
          className="pl-input"
          defaultValue={setup.name}
          key={setup.name}
          maxLength={60}
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v && v !== setup.name) void run('set', { id: setup.id, name: v })
            else e.target.value = setup.name
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
      <div className="g-label">Parts made by it</div>
      <Parts setup={setup} />
      {Settings ? <Settings setup={setup} /> : !type && <p className="hint">This build cannot make a {setup.type} setup: it is kept as it is.</p>}
    </div>
  )
}

export function MakeHeader({ host, pages, workspace }: HostHeaderProps) {
  const setups = useSetups((s) => s.setups)
  const selected = useSetups((s) => s.selected)
  const [open, setOpen] = useState(false)
  const types = setupTypes()
  const [adding, setAdding] = useState('')
  const chosen = setups.find((s) => s.id === selected) ?? null
  const type = chosen ? setupTypeOf(chosen.type) : undefined
  const ids = pages.map((p) => p.id)
  const offered = type ? pagesOfType(type, ids) : ids
  const shown = pages.filter((p) => offered.includes(p.id))

  // A setup whose pages do not hold the page on screen opens its first.
  useEffect(() => {
    if (offered.length && !offered.includes(workspace)) useShell.getState().setWorkspace(offered[0])
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  const addType = adding || types[0]?.id
  return (
    <div className="makehead" data-test="make-setups">
      <div className="sec-head">
        Setups
        <InfoDot title="Setups">
          <p>A setup is one way parts are made — printed, say — and the parts made by it, with its settings. A build can have several. A setting left empty leaves each page on its own.</p>
        </InfoDot>
      </div>
      {setups.length > 0 && (
        <ul className="setup-list" role="listbox" aria-label="Setups">
          {setups.map((s) => (
            <li key={s.id} className={s.id === selected ? 'on' : undefined}>
              <button
                role="option"
                aria-selected={s.id === selected}
                data-test={`setup-${s.id}`}
                title={`${setupTypeOf(s.type)?.label ?? s.type}: ${s.bodies.length} part${s.bodies.length === 1 ? '' : 's'}`}
                onClick={() => useSetups.getState().select(s.id)}
              >
                <b>{s.name}</b>
                <small>
                  {setupTypeOf(s.type)?.label ?? s.type} · {s.bodies.length} part{s.bodies.length === 1 ? '' : 's'}
                </small>
              </button>
              <button className="x" title="Remove this setup" onClick={() => void run('remove', { id: s.id })}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="toolrow">
        {types.length > 1 && (
          <select value={addType} title="The kind of setup to add" onChange={(e) => setAdding(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id} title={t.title}>
                {t.label}
              </option>
            ))}
          </select>
        )}
        <button disabled={!addType} data-test="setup-add" title={setupTypeOf(addType ?? '')?.title ?? 'Add a setup'} onClick={() => void run('add', { type: addType })}>
          {types.length === 1 ? `New ${types[0].label.toLowerCase()} setup` : 'Add setup'}
        </button>
        {chosen && (
          <button className={open ? 'on' : undefined} data-test="setup-edit" title="Its name, parts and settings" onClick={() => setOpen(!open)}>
            {open ? 'Done' : 'Edit'}
          </button>
        )}
      </div>
      {chosen && open && <Details setup={chosen} />}
      {/* Numbered only as one setup's steps (Check, Slice, Send): with none
          chosen, every type's pages show, and Cut, Mill and Order are not
          steps 4 to 6 after Send. */}
      <PageTabs host={chosen ? host : { ...host, steps: false }} pages={shown} />
    </div>
  )
}
