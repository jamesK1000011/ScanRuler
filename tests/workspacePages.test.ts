// SPDX-License-Identifier: AGPL-3.0-only
// Workspaces as pages of one top-bar tab (WorkspaceTab.host): the bar shows
// the host once, in its place; a host's id opens the page last on screen,
// else its first; a page's own id wins where the two are the same; a host
// with one page left in the build still stands for it.
import { describe, expect, it } from 'vitest'
import { barTabsIn, pagesIn, resolveIn } from '../src/app/workspaceHosts'
import type { WorkspaceHost, WorkspaceTab } from '../src/plugins/api'

const HOST: WorkspaceHost = { id: 'bench', label: 'Bench', title: 'The bench', icon: 'board', order: 17, group: 'model' }
const SAME: WorkspaceHost = { id: 'send', label: 'Out', title: 'Out', icon: 'printer', order: 22, group: 'make', steps: true }
const tab = (id: string, order: number, host?: WorkspaceHost): WorkspaceTab => ({ id, label: id, title: id, icon: 'board', order, group: 'model', ...(host ? { host } : {}) })

const TABS = [tab('solo', 10), tab('c', 3, HOST), tab('a', 1, HOST), tab('b', 2, HOST), tab('check', 1, SAME), tab('send', 2, SAME)]

describe('workspace pages', () => {
  it('the bar shows each host once, with its pages in order', () => {
    const bar = barTabsIn(TABS)
    expect(bar.map((t) => t.id)).toEqual(['solo', 'bench', 'send'])
    expect(bar[1]).toMatchObject({ label: 'Bench', order: 17, group: 'model', pages: ['a', 'b', 'c'] })
    expect(bar[2]).toMatchObject({ label: 'Out', group: 'make', pages: ['check', 'send'] })
    expect(pagesIn(TABS, 'bench').map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('a host id opens the page last on screen, else the first; a page id itself', () => {
    expect(resolveIn(TABS, 'bench')).toBe('a')
    expect(resolveIn(TABS, 'bench', 'c')).toBe('c')
    expect(resolveIn(TABS, 'bench', 'check')).toBe('a')
    expect(resolveIn(TABS, 'b')).toBe('b')
    // The Print case: the host shares its id with its last page.
    expect(resolveIn(TABS, 'send', 'check')).toBe('send')
    expect(resolveIn(TABS, 'nowhere')).toBeNull()
  })

  it('a plugin missing: the host stands for the pages left', () => {
    const left = TABS.filter((t) => t.id !== 'send')
    expect(barTabsIn(left).find((t) => t.id === 'send')?.pages).toEqual(['check'])
    expect(resolveIn(left, 'send')).toBe('check')
    expect(barTabsIn(left.filter((t) => t.host?.id !== 'bench')).map((t) => t.id)).toEqual(['solo', 'send'])
  })

  it('work saved on a page whose plugin is missing opens on its tab', () => {
    const LISTED: WorkspaceHost = { ...HOST, pages: ['a', 'b', 'c', 'gone'] }
    const listed = [tab('solo', 10), tab('a', 1, LISTED), tab('b', 2, LISTED)]
    expect(resolveIn(listed, 'gone')).toBe('a')
    expect(resolveIn(listed, 'c', 'b')).toBe('b')
    expect(resolveIn(listed, 'elsewhere')).toBeNull()
    // Without the list, as before: nothing to go on.
    expect(resolveIn(TABS, 'gone')).toBeNull()
  })

  it('a workspace moved from a tab of its own into a host keeps its id', () => {
    // Wear repair was a tab of its own; as a page of Analyze, project files
    // and workspace.set still name it 'wear', and the bar no longer shows it.
    const ANALYZE: WorkspaceHost = { id: 'analyze', label: 'Analyze', title: 'Analyze', icon: 'strength', order: 20, group: 'make', pages: ['fea', 'mass', 'wear'] }
    const before = [tab('mesh', 10), tab('wear', 10.5), tab('fea', 1, ANALYZE), tab('mass', 2, ANALYZE)]
    const after = [tab('mesh', 10), tab('fea', 1, ANALYZE), tab('mass', 2, ANALYZE), tab('wear', 3, ANALYZE)]
    expect(barTabsIn(before).map((t) => t.id)).toEqual(['mesh', 'wear', 'analyze'])
    expect(barTabsIn(after).map((t) => t.id)).toEqual(['mesh', 'analyze'])
    expect(barTabsIn(after)[1].pages).toEqual(['fea', 'mass', 'wear'])
    expect(resolveIn(after, 'wear')).toBe('wear')
    expect(resolveIn(after, 'analyze', 'wear')).toBe('wear')
    // A build without wear-repair: its saved work opens on Analyze.
    expect(resolveIn(after.filter((t) => t.id !== 'wear'), 'wear')).toBe('fea')
  })
})
