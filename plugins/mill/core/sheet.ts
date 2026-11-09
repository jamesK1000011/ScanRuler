// SPDX-License-Identifier: AGPL-3.0-only
// The setup sheet a milled part goes to the machinist with: per part, the
// material and its cutting data, the machine's axes, the tool directions,
// the stock, the least tool and reach, the IT grade, the wall and the
// check's findings — as JSON for a program and as Markdown for a person.
// Lengths in millimetres, as the file says.

type V3 = [number, number, number]

/** A part as the sheet takes it: mill.check's answer. */
export interface SheetPart {
  body: string
  setup: string | null
  material: { id: string; name: string; category: string } | null
  axes: string
  directions: (string | number[])[]
  tool: { minDiameter: number; reach: number }
  grade: number
  stock: { size: V3; min: V3; max: V3; fits: boolean; margin?: number; given?: boolean }
  part: { size: V3 }
  wall: { least: number | null; min: number } | null
  machining: Record<string, unknown> | null
  findings: { severity: string; rule: string; says: string; at?: number[] }[]
  errors: number
  warnings: number
}

export function setupSheet(parts: readonly SheetPart[], opts: { title: string; note?: string; step: string }): { json: Record<string, unknown>; markdown: string } {
  const json = {
    title: opts.title,
    units: 'millimetres',
    file: opts.step,
    ...(opts.note ? { note: opts.note } : {}),
    parts: parts.map((p) => ({
      body: p.body,
      setup: p.setup,
      material: p.material,
      machining: p.machining,
      axes: p.axes,
      directions: p.directions,
      tool: p.tool,
      grade: `IT${p.grade}`,
      stock: p.stock,
      part: p.part,
      wall: p.wall,
      findings: p.findings,
    })),
  }
  const x = (v: readonly number[]) => v.join(' × ')
  const lines: string[] = [`# Setup sheet: ${opts.title}`, '', `Model: \`${opts.step}\`. Lengths in millimetres. No toolpaths: the CAM makes those.`]
  if (opts.note) lines.push('', `> ${opts.note}`)
  for (const p of parts) {
    const speeds = p.machining ? Object.entries(p.machining).map(([k, v]) => `${k} ${v}`).join(', ') : null
    lines.push(
      '',
      `## ${p.body}`,
      '',
      `| | |`,
      `|---|---|`,
      `| Material | ${p.material ? p.material.name : 'not set'}${speeds ? ` (cutting data: ${speeds})` : ''} |`,
      `| Machine | ${p.axes === '3+2' ? '3+2 axis, indexed' : '3 axis'} |`,
      `| Tool directions | ${p.directions.map((d) => (typeof d === 'string' ? d : `[${d.join(', ')}]`)).join(', ')} |`,
      `| Part | ${x(p.part.size)} |`,
      `| Stock | ${x(p.stock.size)} from (${p.stock.min.join(', ')})${p.stock.given ? '' : `, ${p.stock.margin ?? 0} round the part`}${p.stock.fits ? '' : ' — the part does not fit' } |`,
      `| Least tool | ⌀${p.tool.minDiameter}, reaching ${p.tool.reach} |`,
      `| Sizes hold | IT${p.grade} |`,
      `| Least wall | ${p.wall?.least ?? 'not read'} (wanted ${p.wall?.min ?? '—'}) |`,
      '',
      p.findings.length ? `Findings: ${p.errors} error${p.errors === 1 ? '' : 's'}, ${p.warnings} warning${p.warnings === 1 ? '' : 's'}.` : 'No findings.',
    )
    if (p.findings.length) lines.push('', ...p.findings.map((f) => `- **${f.severity}** (${f.rule}): ${f.says}${f.at ? ` — at (${f.at.join(', ')})` : ''}`))
  }
  return { json, markdown: lines.join('\n') + '\n' }
}
