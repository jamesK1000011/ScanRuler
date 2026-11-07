// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { toPdf, toSvg } from '../../_shared/lineart/sheet'
import { bestView, bom, direction, issues, itemOf, stepCamera } from '../core/assembly'
import { drawSteps, sweep, type AsmKernel, type PartIn } from '../core/geometry'
import { lint, parseStyleFile } from '../core/lint'
import { html, sentences } from '../core/htmlManual'
import { cover, stepFigure, stepPage, wrap } from '../core/manual'
import { THEMES, themeOf } from '../core/themes'
import { DEFAULT_SETTINGS, DEFAULT_STYLE, type Part, type Step } from '../core/model'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let k: any
let fixture: PartIn[]
const HOLES: [number, number][] = [
  [6, 6],
  [34, 6],
  [6, 34],
  [34, 34],
]

beforeAll(async () => {
  k = await (await import('occt-wasm')).OcctKernel.init()
  let box = k.makeBox(40, 40, 20)
  for (const [x, y] of HOLES) box = k.cut(box, k.translate(k.makeCylinder(1.6, 16), x, y, 5))
  let lid = k.translate(k.makeBox(40, 40, 3), 0, 0, 20)
  for (const [x, y] of HOLES) lid = k.cut(lid, k.translate(k.makeCylinder(1.7, 5), x, y, 19))
  const screw = (x: number, y: number) => k.fuse(k.translate(k.makeCylinder(1.5, 15), x, y, 8), k.translate(k.makeCylinder(2.8, 2), x, y, 23))
  fixture = [
    { name: 'Box', step: k.exportStep(box) },
    { name: 'Lid', step: k.exportStep(lid) },
    ...HOLES.map(([x, y], i) => ({ name: `Screw ${i + 1}`, step: k.exportStep(screw(x, y)) })),
  ]
}, 60_000)

const parts: Part[] = [
  { name: 'Box', body: 'Box', kind: 'part', source: 'printed' },
  { name: 'Lid', body: 'Lid', kind: 'part', source: 'printed' },
  ...[1, 2, 3, 4].map((i) => ({ name: `Screw ${i}`, body: `Screw ${i}`, kind: 'hardware' as const, designation: 'M3×16 ISO 4762' })),
]
const down: [number, number, number] = [0, 0, -1]
const screws = [1, 2, 3, 4].map((i) => ({ part: `Screw ${i}`, move: down }))

describe('the order parts go in', () => {
  it('box, lid, then screws checks clean', () => {
    const steps: Step[] = [
      { id: 's1', place: [{ part: 'Box', move: down }], text: 'Put the box on the bench.' },
      { id: 's2', place: [{ part: 'Lid', move: down }], text: 'Put the lid on the box.' },
      { id: 's3', place: screws, tools: ['2.5 mm hex key'], torque: '0.8 N·m', text: 'Install the four screws.' },
    ]
    const r = sweep(k as AsmKernel, fixture, steps)
    expect(r.hits).toEqual([])
    expect(r.clashes).toEqual([])
    expect(issues(parts, steps, fixture.map((f) => f.name))).toEqual([])
  }, 120_000)

  it('screws before the lid: the lid hits their heads on the way down', () => {
    const steps: Step[] = [
      { id: 's1', place: [{ part: 'Box', move: down }] },
      { id: 's2', place: screws },
      { id: 's3', place: [{ part: 'Lid', move: down }] },
    ]
    const r = sweep(k as AsmKernel, fixture, steps)
    expect(r.hits.length).toBe(1)
    expect(r.hits[0].part).toBe('Lid')
    expect(r.hits[0].hits).toMatch(/^Screw/)
    expect(r.hits[0].step).toBe(3)
    expect(r.hits[0].before).toBeGreaterThan(0)
    expect(r.hits[0].before).toBeLessThanOrEqual(5.1)
  }, 120_000)

  it('a part in its place overlapping another is a clash, and missing or doubled parts are flagged', () => {
    const fat = k.translate(k.makeBox(10, 10, 10), 15, 15, 15)
    const r = sweep(k as AsmKernel, [...fixture, { name: 'Block', step: k.exportStep(fat) }], [{ id: 'a', place: [{ part: 'Box', move: down }, { part: 'Block', move: down }] }])
    expect(r.clashes.map((c) => [c.part, c.with])).toEqual([['Block', 'Box']])
    const steps: Step[] = [
      { id: 'a', place: [{ part: 'Box', move: down }] },
      { id: 'b', place: [{ part: 'Box', move: down }, { part: 'Nut', move: down }] },
    ]
    const found = issues([...parts, { name: 'Washer', kind: 'hardware' }], steps, ['Box'])
    const msgs = found.map((f) => f.message).join('\n')
    expect(msgs).toMatch(/"Box" is placed in steps 1 and 2/)
    expect(msgs).toMatch(/"Nut", which is not in the parts list/)
    expect(msgs).toMatch(/"Lid" is never placed/)
    expect(msgs).toMatch(/"Lid" is body "Lid", which is not in Reverse Engineer/)
    expect(msgs).toMatch(/"Washer" is hardware with no designation/)
  }, 120_000)
})

describe('the bill of materials and the views', () => {
  it('four screws of one designation are one item of four', () => {
    expect(bom(parts).map((r) => [r.item, r.name, r.qty])).toEqual([
      [1, 'Box', 1],
      [2, 'Lid', 1],
      [3, 'Screw', 4],
    ])
    expect(itemOf(parts, 'Screw 3')).toBe(3)
  })

  it('a move down is seen from above, a move up from below', () => {
    expect(bestView([[0, 0, -1]])).toBe('iso')
    const v = bestView([[0, 0, 1]])
    expect(typeof v === 'object' && v.toward[2] < 0).toBe(true)
    expect(direction('down')).toEqual([0, 0, -1])
    expect(() => direction('sideways')).toThrow()
  })
})

describe('the instructions', () => {
  it('flags a 30-word sentence, two instructions in one, passive voice, and the word list', () => {
    const long = 'Put the lid on the box so that the four holes in the lid line up with the four holes in the box and the edges of both parts meet all round.'
    expect(long.split(' ').length).toBe(32)
    const f = lint(`${long} Tighten the screws and check the lid. The screws are tightened by hand. Utilize a hex key.`, DEFAULT_STYLE)
    expect(f.map((x) => [x.rule, x.sentence])).toEqual([
      ['length', 1],
      ['one-instruction', 2],
      ['passive', 3],
      ['imperative', 3],
      ['imperative', 4],
      ['word', 4],
    ])
    expect(lint('Put the lid on the box. Install the four screws.', DEFAULT_STYLE)).toEqual([])
    expect(lint(long, { name: 'plain', words: {} }).map((x) => x.rule)).toEqual(['length'])
    const custom = parseStyleFile('maxWords: 40\npassive: off\n- lid -> cover')
    expect(custom).toEqual({ limits: { maxWords: 40, passive: 'off' }, words: { lid: 'cover' } })
    expect(lint(long, { name: 'custom', words: {}, custom: 'maxWords: 40\n- lid -> cover' }).map((x) => x.rule)).toEqual(['word'])
  })
})

describe('the manual', () => {
  it('draws each step with the new parts black and the rest grey, and lays out its pages', () => {
    const steps: Step[] = [
      { id: 's1', place: [{ part: 'Box', move: down }], text: 'Put the box on the bench.' },
      { id: 's2', place: [{ part: 'Lid', move: down }], text: 'Put the lid on the box.' },
      { id: 's3', place: screws, tools: ['2.5 mm hex key'], torque: '0.8 N·m', text: 'Install the four screws. Tighten them in a cross pattern.' },
    ]
    const d = drawSteps(k as AsmKernel, fixture, steps, steps.map(stepCamera), DEFAULT_SETTINGS.explode)
    expect(d[0].lines.every((l) => l.fresh && l.part === 'Box')).toBe(true)
    const third = d[2]
    expect(third.lines.some((l) => !l.fresh && l.part === 'Lid')).toBe(true)
    expect(third.lines.some((l) => l.fresh && l.part.startsWith('Screw'))).toBe(true)
    expect(third.paths).toHaveLength(4)
    const pages = steps.map((s, i) => stepPage(i, s, d[i], parts, steps.length, DEFAULT_SETTINGS))
    const svg = toSvg(pages[2])
    expect(svg).toContain('>Step<')
    expect(pages[2].marks.some((m) => m.k === 'text' && m.text === '3' && m.bold && m.h === 6.5)).toBe(true)
    expect(svg).toContain('4 × Screw')
    expect(svg).toContain('M3×16 ISO 4762')
    expect(svg).toContain('Torque: 0.8 N·m')
    expect(svg).toMatch(/stroke="#999999"/)
    const balloons = pages[2].marks.filter((m) => m.k === 'text' && m.text === '3' && m.h === 2.6)
    expect(balloons.length).toBe(2)
    expect(balloons.every((m) => m.k === 'text' && m.rgb === '#ffffff')).toBe(true)
    const technical = stepPage(2, steps[2], d[2], parts, steps.length, { ...DEFAULT_SETTINGS, theme: 'technical' })
    expect(technical.marks.some((m) => m.k === 'text' && m.text === 'Step 3' && m.rgb === themeOf({ theme: 'technical' }).accent)).toBe(true)
    const picture = stepPage(2, steps[2], d[2], parts, steps.length, { ...DEFAULT_SETTINGS, theme: 'picture' })
    expect(picture.marks.every((m) => !m.rgb || m.rgb === '#000000' || m.rgb === '#ffffff')).toBe(true)
    const mine = stepPage(2, steps[2], d[2], parts, steps.length, { ...DEFAULT_SETTINGS, accent: '#2a9d4b' })
    expect(mine.marks.some((m) => m.rgb === '#2a9d4b')).toBe(true)
    for (const p of pages) for (const m of p.marks) if (m.k !== 'text') for (let i = 0; i < m.pts.length; i += 2) {
      expect(m.pts[i]).toBeGreaterThanOrEqual(0)
      expect(m.pts[i]).toBeLessThanOrEqual(p.w)
    }
    const c = cover(parts, steps, DEFAULT_SETTINGS)
    expect(toSvg(c)).toContain('Bill of materials')
    const figures = steps.map((_, i) => stepFigure(d[i], parts, DEFAULT_SETTINGS))
    expect(figures[2].marks.some((m) => m.k === 'text' && m.text === 'Step')).toBe(false)
    for (const t of THEMES) {
      const doc = html({ ...DEFAULT_SETTINGS, title: 'Box kit', theme: t.id }, parts, steps, figures)
      expect(doc).toMatch(/<td class="item"><span class="balloon">3<\/span><\/td><td class="qty">4×<\/td><td>Screw<\/td><td class="des">M3×16 ISO 4762<\/td>/)
      expect(doc).toContain(`--accent:${t.accent}`)
      expect(doc).toContain(`badge-${t.badge} balloons-${t.balloon}`)
      expect(doc).toContain('<li>Install the four screws.</li><li>Tighten them in a cross pattern.</li>')
      expect(doc).toContain('<div class="torque">0.8 N·m</div>')
      expect(doc).toContain('href="#step-3"')
      expect(doc).toContain('@media print')
      expect(doc).not.toMatch(/<script|<link|@import|url\(/)
    }
    expect(sentences('Put the lid on. Align the holes.\nTighten them.')).toEqual(['Put the lid on.', 'Align the holes.', 'Tighten them.'])
    expect(sentences('Use an M3×10 screw, 2.5 mm hex key.')).toHaveLength(1)
    const pdf = new TextDecoder('latin1').decode(toPdf([c, ...pages]))
    expect(pdf).toContain('/Count 4')
    expect(pdf).toContain('/Helvetica-Bold')
    expect(pdf).toMatch(/0\.094 0\.467 0\.753 rg/)
    expect(wrap('one two three four five six', 3.5, 20).length).toBeGreaterThan(1)
  }, 120_000)
})

describe('stays local', () => {
  it('has no network code', () => {
    const files: string[] = []
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) {
          if (n !== 'scripts' && n !== 'tests') walk(p)
        } else if (/\.(ts|tsx)$/.test(n)) files.push(p)
      }
    }
    walk(join(__dirname, '..'))
    expect(files.length).toBeGreaterThan(4)
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/)
  })
})
