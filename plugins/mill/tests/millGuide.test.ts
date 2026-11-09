// SPDX-License-Identifier: AGPL-3.0-only
// The mill guide names only tools that exist with every plugin installed —
// each code span that opens with one, its input after it — and guide.read
// serves it.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { registerCoreCommands } from '../../../src/commands/core'
import { listGuides } from '../../../src/commands/guides'
import { listCommands, runCommand } from '../../../src/commands/registry'
import { installPlugins } from '../../../src/plugins/registry'

const TEXT = readFileSync(new URL('../guides/mill.md', import.meta.url), 'utf8').split('\r\n').join('\n')

describe('the mill guide', () => {
  it('names only tools that exist', () => {
    installPlugins()
    registerCoreCommands()
    const known = new Set(listCommands().map((c) => c.name.split('.').join('_')))
    const named = [...new Set([...TEXT.matchAll(/`([a-z][a-z0-9]*_[a-z0-9_]+)(?=[ `])/g)].map((m) => m[1]))]
    expect(named.filter((n) => !known.has(n))).toEqual([])
    expect(named).toEqual(expect.arrayContaining(['mill_check', 'mill_export', 'setup_add', 'part_review', 'fit_set']))
  })

  it('is served by guide.read', async () => {
    installPlugins()
    registerCoreCommands()
    expect(listGuides().map((g) => g.id)).toContain('mill')
    const read = (await runCommand('guide.read', { topic: 'mill' })) as { guides: { topic: string; text: string }[] }
    expect(read.guides[0].text).toMatch(/mill_export \{ setup: "S3" \}/)
  })
})
