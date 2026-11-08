// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { toPdf, toSvg } from '../../_shared/lineart/sheet'
import { bestView, bom, direction, issues, itemOf, partNames, stepCamera, subAssemblies } from '../core/assembly'
import { drawSteps, sweep, type AsmKernel, type PartIn } from '../core/geometry'
import { lint, parseStyleFile } from '../core/lint'
import { html, sentences } from '../core/htmlManual'
import { hardwareOutline, SIGNAL_STYLE } from '../core/extras'
import { pack, sizeOf } from '../core/layout'
import { cover, hardwarePage, manualPages, stepFigure, stepLabels, stepPage, wrap } from '../core/manual'
import { review } from '../core/review'
import { checkThemeFile, safeCss, toThemeFile } from '../core/themeFile'
import example from '../themes/example.manual-theme.json'
import { PRESETS, THEMES, themeOf } from '../core/themes'
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

  it('a body too heavy to export is left out of the sweep and named, not a crash', () => {
    const steps: Step[] = [
      { id: 's1', place: [{ part: 'Box', move: down }] },
      { id: 's2', place: [{ part: 'Lid', move: down }] },
    ]
    const r = sweep(k as AsmKernel, [fixture[0], { name: 'Lid' }], steps)
    expect(r.skipped).toEqual(['Lid'])
    expect(r.hits).toEqual([])
    expect(r.clashes).toEqual([])
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

describe('layouts, sub-assemblies and the rest', () => {
  const page = { w: 279.4, h: 215.9 }
  const many = (n: number, text = ''): Step[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, place: [{ part: 'Box', move: down }], text }))

  it('packs steps one, two, four or six a page, or by size', () => {
    expect(pack(many(5), 'one', page, 12, true).map((p) => p.length)).toEqual([1, 1, 1, 1, 1])
    expect(pack(many(5), 'two', page, 12, true).map((p) => p.length)).toEqual([2, 2, 1])
    expect(pack(many(9), 'grid4', page, 12, true).map((p) => p.length)).toEqual([4, 4, 1])
    expect(pack(many(7), 'grid6', page, 12, true).map((p) => p.length)).toEqual([6, 1])
    const two = pack(many(2), 'two', page, 12, true)[0]
    expect(two[1].frame.x).toBeGreaterThan(two[0].frame.x + two[0].frame.w)
    const twoUp = pack(many(2), 'two', { w: 215.9, h: 279.4 }, 12, false)[0]
    expect(twoUp[1].frame.y).toBeGreaterThan(twoUp[0].frame.y + twoUp[0].frame.h)
    const big: Step = { id: 'b', place: screws, tools: ['hex key'], warnings: [{ level: 'caution', text: 'Sharp edges.' }], text: 'x'.repeat(200) }
    expect(sizeOf(many(1)[0])).toBe('q')
    expect(sizeOf(big)).toBe('f')
    const auto = pack([...many(3), big, ...many(1)], 'auto', page, 12, true)
    expect(auto.map((p) => p.map((c) => c.step))).toEqual([[0, 1, 2], [3], [4]])
    for (const p of [...auto, ...pack(many(9), 'grid6', page, 12, true)])
      for (const c of p) {
        expect(c.frame.x).toBeGreaterThanOrEqual(12)
        expect(c.frame.x + c.frame.w).toBeLessThanOrEqual(page.w - 12 + 1e-6)
        expect(c.frame.y + c.frame.h).toBeLessThanOrEqual(page.h - 12 + 1e-6)
      }
  })

  it('builds a sub-assembly apart, numbers it A1, A2 and places it whole', () => {
    const steps: Step[] = [
      { id: 'a1', sub: 'Top', place: [{ part: 'Lid', move: down }] },
      { id: 'a2', sub: 'Top', place: screws },
      { id: 'm1', place: [{ part: 'Box', move: down }] },
      { id: 'm2', place: [{ part: 'Top', move: down }] },
    ]
    expect(subAssemblies(steps).get('Top')).toEqual(['Lid', 'Screw 1', 'Screw 2', 'Screw 3', 'Screw 4'])
    expect(stepLabels(steps)).toEqual(['A1', 'A2', '1', '2'])
    expect(issues(parts, steps, fixture.map((f) => f.name)).filter((x) => x.level !== 'note')).toEqual([])
    const d = drawSteps(k as AsmKernel, fixture, steps, steps.map(stepCamera), 1)
    expect(d[1].lines.some((l) => !l.fresh && l.part === 'Lid')).toBe(true)
    expect(d[1].lines.some((l) => l.part === 'Box')).toBe(false)
    expect(d[3].lines.filter((l) => l.fresh).every((l) => l.part === 'Top')).toBe(true)
    expect(d[3].lines.some((l) => !l.fresh && l.part === 'Box')).toBe(true)
    expect(d[3].paths.map((p) => p.part)).toEqual(['Top'])
    const r = sweep(k as AsmKernel, fixture, steps)
    expect(r.hits).toEqual([])
    const laid = manualPages(parts, steps, d, { ...DEFAULT_SETTINGS, layout: 'two' })
    expect(laid.steps).toEqual([[], [0, 1], [2, 3]])
    expect(laid.pageOf).toEqual([1, 1, 2, 2])
    const svg = toSvg(laid.sheets[1])
    expect(svg).toContain('Sub-assembly: Top')
    expect(svg).toContain('>A1<')
    expect(toSvg(laid.sheets[2])).toContain('>Top<')
    const bad = issues(parts, [steps[3], ...steps.slice(0, 3)], fixture.map((f) => f.name))
    expect(bad.some((x) => x.level === 'error' && /before its last step/.test(x.message))).toBe(true)
    expect(issues(parts, steps.slice(0, 3), []).some((x) => /never placed/.test(x.message) && x.part === 'Top')).toBe(true)
  }, 120_000)

  it('warnings, pictograms, wordless pages, the parts box in the corner, hardware at 1:1', () => {
    const steps: Step[] = [
      { id: 's1', place: [{ part: 'Box', move: down }], text: 'Put the box down.', icons: ['two-people', 'eye-protection'], warnings: [{ level: 'warning', text: 'The box is heavy. Lift it with two people.' }, { level: 'notice', text: 'Do not scratch the face.' }] },
      { id: 's2', place: screws, text: 'Install the screws.', icons: ['no-overtighten'] },
    ]
    const d = drawSteps(k as AsmKernel, fixture, [{ id: 'l', place: [{ part: 'Lid', move: down }] }, ...steps], [stepCamera(steps[0]), ...steps.map(stepCamera)], 1).slice(1)
    const s = { ...DEFAULT_SETTINGS, words: 'hide' as const, partsBox: 'corner' as const, hardwarePage: true }
    const laid = manualPages(parts, steps, d, s)
    expect(laid.sheets).toHaveLength(4)
    const hw = toSvg(laid.sheets[1])
    expect(hw).toContain('Hardware at 1:1')
    expect(hw).toContain('This bar is 50 mm')
    const first = toSvg(laid.sheets[2])
    expect(first).toContain('>WARNING<')
    expect(first).toContain('>NOTICE<')
    expect(first).toContain(SIGNAL_STYLE.warning.band)
    expect(first).toContain('The box is heavy.')
    expect(first).not.toContain('Put the box down.')
    expect(toSvg(manualPages(parts, steps, d, DEFAULT_SETTINGS).sheets[1])).toContain('Put the box down.')
    const o = hardwareOutline('M3×16 ISO 4762')!
    expect(o.kind).toBe('socket head screw')
    expect(o.length).toBeCloseTo(19, 5)
    expect(hardwareOutline('M4 nut ISO 4032')!.kind).toBe('hex nut')
    expect(hardwareOutline('M5 washer ISO 7089')!.height).toBe(10)
    expect(hardwareOutline('M3×10 ISO 10642')!.length).toBe(10)
    expect(hardwareOutline('PTFE tube')).toBeNull()
    const sheet = hardwarePage(parts, s)!
    const lines = sheet.marks.filter((m) => m.k === 'line' && m.w === 0.25) as { pts: number[] }[]
    const xs = lines.flatMap((m) => m.pts.filter((_, i) => i % 2 === 0))
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(19, 1)
    const doc = html(s, parts, steps, d.map((x) => stepFigure(x, parts, s, steps)))
    expect(doc).toContain('class="z535 warning"')
    expect(doc).toContain('aria-label="two people"')
    expect(doc).toContain('Hardware at 1:1')
    expect(doc).toMatch(/<svg width="21\.00mm"/)
    expect(doc).toContain('words-hide')
    expect(doc).toContain('<li>Put the box down.</li>')
  }, 120_000)

  it('presets set the settings; the 82079 review says what is missing', () => {
    for (const p of PRESETS) expect(THEMES.some((t) => t.id === p.settings.theme)).toBe(true)
    const steps: Step[] = [{ id: 's1', place: [{ part: 'Box', move: down }] }]
    const open = review(DEFAULT_SETTINGS, parts, steps, DEFAULT_STYLE)
    expect(open.filter((x) => !x.ok).map((x) => x.topic)).toEqual(['Product identified', 'Who supplies it', 'Edition', 'Intended use', 'Safety information', 'Tools', 'Every step said', 'End of life'])
    expect(open.find((x) => x.topic === 'Intended use')!.fix).toBe('asm.settings { intendedUse }')
    const done = review({ ...DEFAULT_SETTINGS, product: 'Box kit BK-1', publisher: 'A. Example', version: '1.0', intendedUse: 'A small box for parts.', safety: 'Keep from small children.', disposal: 'Recycle the plastic.' }, parts, [{ ...steps[0], text: 'Put the box down.', tools: ['none'] }], DEFAULT_STYLE)
    expect(done.filter((x) => !x.ok)).toEqual([])
    const c = toSvg(cover(parts, steps, { ...DEFAULT_SETTINGS, product: 'BK-1', intendedUse: 'For parts.', safety: 'Keep from small children.' }))
    expect(c).toContain('Intended use')
    expect(c).toContain('>WARNING<')
  })
})

describe('theme files', () => {
  it('reads the example, refuses a broken one, and cleans the CSS', () => {
    expect(checkThemeFile(example)).toEqual([])
    const s = { ...DEFAULT_SETTINGS, customThemes: [example as never], theme: 'garage-green' }
    expect(themeOf(s).accent).toBe('#1f6f43')
    expect(themeOf(s).custom).toBe(true)
    const doc = html(s, parts, [{ id: 's1', place: [{ part: 'Box', move: down }], text: 'Put the box down.' }], [])
    expect(doc).toContain('--accent:#1f6f43')
    expect(doc).toContain("/* the theme file's own */")
    expect(doc).toContain('text-transform: uppercase')
    const bad = checkThemeFile({ scanrulerManualTheme: 1, id: 'workshop', name: '', look: { accent: 'green', font: "x; } body { display:none", size: 99, balloon: 'square' }, layout: { layout: 'three' } })
    const said = bad.join('\n')
    for (const word of ['shipped theme', 'name:', 'look.accent', 'look.font', 'look.size', 'look.balloon', 'look.badge', 'look.sheetColour', 'layout.layout']) expect(said).toContain(word)
    const dirty = safeCss('@import url(https://evil.example/x.css);\nbody{background:url("https://evil.example/t.png")}\n.a{background:url(data:image/png;base64,AAAA)}\n</style><script>alert(1)</script>\n.b{width:expression(alert(1));color:red}\na{-moz-binding:url(x.xml#y)}')
    expect(dirty.css).not.toMatch(/@import|evil\.example|<\/style|<script|expression\(|-moz-binding/i)
    expect(dirty.css).toContain('url(data:image/png;base64,AAAA)')
    expect(dirty.css).toContain('color:red')
    expect(dirty.removed).toEqual(expect.arrayContaining(['@import', 'url() to a file or address', 'a style tag', 'markup', 'expression()', '-moz-binding']))
    expect(safeCss('x'.repeat(30_000)).css.length).toBe(20_000)
    const out = toThemeFile(THEMES[0], { ...DEFAULT_SETTINGS, accent: '#123456', layout: 'grid4' })
    expect(out.id).toBe('my-workshop')
    expect(out.look.accent).toBe('#123456')
    expect(out.layout?.layout).toBe('grid4')
    expect(checkThemeFile(out)).toEqual([])
  })
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

describe('what a part is called', () => {
  it('a counted body goes by the feature that made it; a named one keeps its name', () => {
    const features = [
      { id: 1, name: 'Base' },
      { id: 2, name: 'Lid' },
      { id: 3, name: 'Knob' },
      { id: 4, name: 'Split 1' },
    ]
    const bodies = [
      { id: 1, name: 'Solid 1' },
      { id: 2, name: 'Solid 2' },
      { id: 3, name: 'Handle' },
      { id: 4, name: 'Solid 3' },
      { id: 4.001, name: 'Solid 4' },
    ]
    const n = partNames(bodies, features)
    expect([...n.values()]).toEqual(['Base', 'Lid', 'Handle', 'Solid 3', 'Solid 4'])
  })
})
