// SPDX-License-Identifier: AGPL-3.0-only
// A local linter for instructions. Its rules are its own and the project's
// word list: no text from ASD-STE100 or any other standard is reproduced.
// ste100 sets the limits that standard's writers keep to (short sentences,
// one instruction each, active voice, the verb first); plain loosens them;
// custom reads the user's own style file.

import type { Style } from './model'

export interface Limits {
  maxWords: number
  passive: 'warn' | 'note' | 'off'
  oneInstruction: boolean
  imperative: boolean
}

export interface LintFinding {
  rule: 'length' | 'passive' | 'one-instruction' | 'imperative' | 'word'
  level: 'warn' | 'note'
  sentence: number
  message: string
}

const PRESETS: Record<'ste100' | 'plain', Limits> = {
  ste100: { maxWords: 20, passive: 'warn', oneInstruction: true, imperative: true },
  plain: { maxWords: 30, passive: 'note', oneInstruction: false, imperative: false },
}

/** The verbs an instruction starts with. Grow it with the project's words. */
export const ACTIONS = new Set(
  'adjust align apply attach bend check clean clip close connect cut disconnect do drill engage examine fasten fit fold glue hold insert install keep lay lift loosen lower make measure mount move open place position press pull push put release remove repeat replace rotate screw seat set slide snap tap tighten turn use wait wipe'.split(' '),
)

/** The limits a style file sets: lines like "maxWords: 25", "passive: off",
 *  "oneInstruction: on", "imperative: off", and "- avoid -> use". */
export function parseStyleFile(md: string): { limits: Partial<Limits>; words: Record<string, string> } {
  const limits: Partial<Limits> = {}
  const words: Record<string, string> = {}
  for (const raw of md.split('\n')) {
    const line = raw.trim()
    let m = /^maxWords\s*:\s*(\d+)/i.exec(line)
    if (m) limits.maxWords = Number(m[1])
    m = /^passive\s*:\s*(warn|note|off)/i.exec(line)
    if (m) limits.passive = m[1].toLowerCase() as Limits['passive']
    m = /^oneInstruction\s*:\s*(on|off)/i.exec(line)
    if (m) limits.oneInstruction = m[1].toLowerCase() === 'on'
    m = /^imperative\s*:\s*(on|off)/i.exec(line)
    if (m) limits.imperative = m[1].toLowerCase() === 'on'
    m = /^[-*]\s*(.+?)\s*->\s*(.+)$/.exec(line)
    if (m) words[m[1].toLowerCase()] = m[2]
  }
  return { limits, words }
}

export function limitsOf(style: Style): { limits: Limits; words: Record<string, string> } {
  if (style.name !== 'custom') return { limits: PRESETS[style.name], words: style.words }
  const file = parseStyleFile(style.custom ?? '')
  return { limits: { ...PRESETS.plain, ...file.limits }, words: { ...style.words, ...file.words } }
}

export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const words = (s: string) => s.match(/[A-Za-z0-9×°'’-]+/g) ?? []

export function lint(text: string, style: Style): LintFinding[] {
  const { limits, words: avoid } = limitsOf(style)
  const out: LintFinding[] = []
  sentences(text).forEach((s, i) => {
    const n = i + 1
    const w = words(s)
    if (w.length > limits.maxWords) out.push({ rule: 'length', level: 'warn', sentence: n, message: `Sentence ${n} has ${w.length} words; keep instructions to ${limits.maxWords} or fewer.` })
    if (limits.passive !== 'off' && /\b(is|are|was|were|be|been|being)\s+(\w+ed|\w+en|put|set|cut|held|made|done)\b/i.test(s)) out.push({ rule: 'passive', level: limits.passive, sentence: n, message: `Sentence ${n} reads passive ("${/\b(is|are|was|were|be|been|being)\s+\w+/i.exec(s)![0]}"); say who does it, or start with the verb.` })
    const body = s.replace(/^(if|when|before|after|while)\b[^,]*,\s*/i, '')
    const first = words(body)[0]?.toLowerCase()
    if (limits.imperative && first && !ACTIONS.has(first) && !/^(do not|don't|caution|warning|note)\b/i.test(body)) out.push({ rule: 'imperative', level: 'note', sentence: n, message: `Sentence ${n} starts with "${words(body)[0]}"; start an instruction with its verb.` })
    if (limits.oneInstruction) {
      const verbs = words(body).filter((x, j, all) => ACTIONS.has(x.toLowerCase()) && (j === 0 || /^(and|then)$/i.test(all[j - 1])))
      if (verbs.length > 1) out.push({ rule: 'one-instruction', level: 'warn', sentence: n, message: `Sentence ${n} gives ${verbs.length} instructions (${verbs.join(', ')}); give one per sentence.` })
    }
    const lower = ` ${s.toLowerCase()} `
    for (const [bad, good] of Object.entries(avoid)) if (lower.includes(` ${bad} `) || lower.includes(` ${bad},`) || lower.includes(` ${bad}.`)) out.push({ rule: 'word', level: 'warn', sentence: n, message: `Sentence ${n}: write "${good}", not "${bad}".` })
  })
  return out
}
