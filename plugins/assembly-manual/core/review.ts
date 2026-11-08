// SPDX-License-Identifier: AGPL-3.0-only
// The manual held up against what IEC/IEEE 82079-1 asks instructions for
// use to carry — the topics in its own words here, not the standard's text:
// what the product is and who stands behind it, which edition this is,
// what it is for, its safety information and where it sits, the parts and
// the tools, every step said, and what to do with it at the end. A
// checklist for the person, not a certificate.

import { bom, subAssemblies } from './assembly'
import { lint } from './lint'
import type { AsmSettings, Part, Step, Style } from './model'

export interface ReviewItem {
  topic: string
  ok: boolean
  level: 'error' | 'warn' | 'note'
  message: string
  /** What to set to put it right. */
  fix?: string
}

export function review(s: AsmSettings, parts: Part[], steps: Step[], style: Style): ReviewItem[] {
  const out: ReviewItem[] = []
  const add = (topic: string, ok: boolean, level: ReviewItem['level'], yes: string, no: string, fix?: string) => out.push({ topic, ok, level, message: ok ? yes : no, ...(ok || !fix ? {} : { fix }) })
  add('Product identified', Boolean(s.product), 'warn', `The product is named: ${s.product}.`, 'The manual names no product, model or part number beyond its title.', 'asm.settings { product }')
  add('Who supplies it', Boolean(s.publisher), 'warn', `Supplier and contact: ${s.publisher}.`, 'No maker or contact is given, so a reader has no one to ask.', 'asm.settings { publisher }')
  add('Edition', Boolean(s.version), 'note', `Edition: ${s.version}.`, 'No version or date tells a reader which edition this is.', 'asm.settings { version }')
  add('Intended use', Boolean(s.intendedUse), 'warn', 'What the product is for is stated.', 'The manual does not say what the product is for, or what it must not be used for.', 'asm.settings { intendedUse }')
  const stepWarnings = steps.reduce((n, x) => n + (x.warnings?.length ?? 0), 0)
  add('Safety information', Boolean(s.safety) || stepWarnings > 0, 'warn', `${s.safety ? 'General safety on the cover' : 'No general safety section'}${stepWarnings ? `; ${stepWarnings} safety message${stepWarnings === 1 ? '' : 's'} in the steps` : ''}.`, 'There is no safety information: none on the cover and no step carries a warning. If nothing is hazardous, say so on the cover.', 'asm.settings { safety }, or warnings on a step')
  if (stepWarnings) add('Safety where it applies', true, 'note', 'Each safety message stands before the instructions of its step, with its signal word (ANSI Z535.6 style).', '')
  const rows = bom(parts)
  add('Parts list', rows.length > 0, 'error', `The bill of materials lists ${rows.length} item${rows.length === 1 ? '' : 's'}.`, 'There is no parts list.', 'asm.parts')
  const vague = parts.filter((p) => p.kind === 'hardware' && !p.designation)
  add('Parts identifiable', !vague.length, 'warn', 'Every hardware item has a designation to buy it by.', `${vague.length} hardware item${vague.length === 1 ? ' has' : 's have'} no designation: ${vague.map((p) => p.name).join(', ')}.`, 'asm.parts { set: [{ name, designation }] }')
  const tools = steps.some((x) => x.tools?.length)
  add('Tools', tools, 'note', 'The tools each step needs are listed.', 'No step lists a tool. If none is needed, that is fine; otherwise list them.', 'tools on a step')
  const silent = steps.map((x, i) => (x.text ? -1 : i + 1)).filter((i) => i > 0)
  add('Every step said', !silent.length, s.words === 'hide' ? 'note' : 'warn', 'Every step has instructions.', `Step${silent.length === 1 ? '' : 's'} ${silent.join(', ')} ha${silent.length === 1 ? 's' : 've'} no instructions${s.words === 'hide' ? ' — the pages carry none, but the HTML should' : ''}.`, 'asm.text')
  const unclear = steps.flatMap((x, i) => (x.text ? lint(x.text, style).map(() => i + 1) : []))
  add('Plain wording', !unclear.length, 'note', 'Every step’s words pass the style check.', `The style check flags steps ${[...new Set(unclear)].join(', ')}.`, 'asm.text')
  const subs = subAssemblies(steps)
  const joined = new Set(steps.flatMap((x) => x.place.map((p) => p.part)).filter((p) => subs.has(p)))
  const loose = [...subs.keys()].filter((n) => !joined.has(n))
  if (subs.size) add('Sub-assemblies joined', !loose.length, 'error', `Each sub-assembly (${[...subs.keys()].join(', ')}) is placed into the whole.`, `Built but never placed: ${loose.join(', ')}.`, 'a step that places it')
  add('End of life', Boolean(s.disposal), 'note', 'What to do with it at the end is said.', 'Nothing says how to take it apart, recycle or dispose of it.', 'asm.settings { disposal }')
  return out
}
