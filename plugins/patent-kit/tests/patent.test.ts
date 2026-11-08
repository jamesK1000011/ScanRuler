// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { hlr, lengthOf } from '../../_shared/lineart/hlr'
import { textWidth, toPdf, toSvg, type Mark } from '../../_shared/lineart/sheet'
import { camera } from '../../_shared/lineart/views'
import { crc32, zip } from '../../_shared/zip'
import { briefDescription, expand, numeralsIn, toMarkdown } from '../core/draft'
import { SPEC_MARGIN, specification } from '../core/spec'
import { drawFigures, shortest, type DrawKernel } from '../core/drawings'
import { layout, MARGIN, PAPER, segmentsCross } from '../core/layout'
import { DEFAULT_SETTINGS, type Figure, type Numeral } from '../core/model'
import { assignBodies, renumber, retoken, syncBodies } from '../core/numerals'
import { check } from '../core/rules'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let k: any

beforeAll(async () => {
  const mod = await import('occt-wasm')
  k = await mod.OcctKernel.init()
}, 60_000)

const shaft = () => k.fuse(k.makeCylinder(10, 20), k.translate(k.makeCylinder(5, 30), 0, 0, 20))

describe('hidden lines', () => {
  it('a cube shows 4 edges from the front and 9 in perspective', () => {
    const cube = k.makeBox(10, 10, 10)
    expect(hlr(k, cube, camera('front')).visible.length).toBe(4)
    const iso = hlr(k, cube, camera('iso'))
    expect(iso.visible.length).toBe(9)
    expect(iso.hidden.length).toBe(3)
  })

  it('a stepped shaft from the front: its two sides each step, three circles edge-on, the step’s inner circle behind the shoulder', () => {
    const v = hlr(k, shaft(), camera('front'))
    expect(v.visible.length).toBe(7)
    expect(lengthOf(v.visible)).toBeCloseTo(2 * 20 + 2 * 30 + 20 + 20 + 10, 3)
    expect(v.hidden.length).toBe(5)
  })
})

const step = (shape: unknown) => k.exportStep(shape) as string

describe('the shortest edge', () => {
  it('an edge in pieces is one edge, and the kernel’s scraps are not counted', () => {
    // A 10 mm edge the hidden-line pass split in two, a 2 mm edge at a right
    // angle off its end, and a 0.001 mm scrap.
    const lines = [
      [0, 0, 4, 0],
      [4, 0, 10, 0.1],
      [10, 0.1, 10, 2.1],
      [20, 20, 20.001, 20],
    ]
    expect(shortest(lines)).toBeCloseTo(2, 6)
    expect(shortest([[0, 0, 0.02, 0]])).toBe(Infinity)
  })
})

describe('figures on sheets', () => {
  const settings = { ...DEFAULT_SETTINGS, figuresPerSheet: 2 as const }
  const figures: Figure[] = [
    { id: 'a', kind: 'view', view: 'iso' },
    { id: 'b', kind: 'view', view: 'front' },
    { id: 'c', kind: 'section', view: 'front', section: { axis: 'y', offset: 10, keep: 'above', from: 'd' } },
    { id: 'd', kind: 'view', view: 'top' },
    { id: 'e', kind: 'exploded', view: 'iso', explode: { factor: 1 } },
  ]
  let bodies: { name: string; step: string }[]
  let numerals: Numeral[]
  beforeAll(() => {
    const plate = k.cut(k.makeBox(60, 20, 8), k.translate(k.makeCylinder(4, 20), 30, 10, -5))
    const pin = k.translate(k.makeCylinder(3.8, 20), 30, 10, 4)
    bodies = [
      { name: 'Plate', step: step(plate) },
      { name: 'Pin', step: step(pin) },
    ]
    numerals = assignBodies([], [{ id: 1, name: 'Plate' }, { id: 2, name: 'Pin' }], settings).numerals
    numerals.push({ n: 14, label: 'end face', auto: false, target: { at: [60, 10, 4], body: 'Plate' } })
  })

  it('draws, numbers and checks them', () => {
    const drawings = drawFigures(k as DrawKernel, bodies, figures, numerals, { hidden: false })
    expect(drawings.map((d) => d.visible.length > 0)).toEqual([true, true, true, true, true])
    const iso = drawings[0]
    expect(iso.anchors.map((a) => a.n).sort()).toEqual([10, 12, 14])
    const top = drawings[3]
    expect(top.cuts).toHaveLength(1)
    const section = drawings[2]
    expect(section.hatch.length).toBe(2)
    const front = drawings[1]
    expect(front.missed.map((m) => m.n)).toEqual([14])
    const l = layout(figures, drawings, settings)
    expect(l.sheets).toHaveLength(3)
    const paper = PAPER.letter
    for (const e of l.extents) {
      expect(e.minX).toBeGreaterThanOrEqual(MARGIN.left - 0.01)
      expect(e.minY).toBeGreaterThanOrEqual(MARGIN.top - 0.01)
      expect(e.maxX).toBeLessThanOrEqual(paper.w - MARGIN.right + 0.01)
      expect(e.maxY).toBeLessThanOrEqual(paper.h - MARGIN.bottom + 0.01)
    }
    for (const a of l.leaders) for (const b of l.leaders) if (a !== b && a.figure === b.figure) expect(segmentsCross(a.line, b.line)).toBe(false)
    const placement = l.placements.find((p) => p.id === 'c')!
    expect(placement.hatched).toBe(true)
    expect(l.placements.find((p) => p.id === 'd')!.cutsDrawn).toEqual(['c'])
    expect(l.placements.find((p) => p.id === 'e')!.bracketed).toBe(false)
    const missed = drawings.flatMap((d, i) => d.missed.map((m) => ({ figure: i + 1, ...m })))
    const findings = check(l, figures, numerals, { detailed: 'The [[10]] holds the [[12]].' }, missed)
    const errors = findings.filter((f) => !f.ok && f.level === 'error')
    expect(errors).toEqual([])
    expect(findings.some((f) => !f.ok && /14 is in the drawings but not in the description/.test(f.message))).toBe(true)
    const svg = toSvg(l.sheets[0])
    expect(svg).toContain('FIG. 1')
    expect(svg).not.toMatch(/#(?!000000|ffffff)[0-9a-f]{6}/)
    const pdf = toPdf(l.sheets)
    const text = new TextDecoder('latin1').decode(pdf)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Count 3')
    const xref = Number(/startxref\n(\d+)/.exec(text)![1])
    expect(text.slice(xref, xref + 4)).toBe('xref')
    const offs = [...text.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]))
    offs.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`))
  }, 120_000)

  it('a section keeps its hole open: no hatch line crosses it', () => {
    const one: Figure[] = [{ id: 's', kind: 'section', view: 'front', section: { axis: 'y', offset: 10, keep: 'above' } }]
    const [d] = drawFigures(k as DrawKernel, bodies.slice(0, 1), one, [], { hidden: false })
    const l = layout(one, [d], DEFAULT_SETTINGS)
    const p = l.placements[0]
    const holeX = p.box.x + ((30 - 0) / 60) * p.box.w
    const hatchLines = l.sheets[0].marks.flatMap((m) => (m.k === 'line' ? [m] : [])).filter((m) => m.pts.length === 4 && Math.abs(Math.abs(m.pts[2] - m.pts[0]) - Math.abs(m.pts[3] - m.pts[1])) < 1e-6)
    expect(hatchLines.length).toBeGreaterThan(5)
    const r = (3.9 / 60) * p.box.w
    for (const m of hatchLines) {
      const xs = [m.pts[0], m.pts[2]].sort((a, b) => a - b)
      const midInHole = (xs[0] + xs[1]) / 2 > holeX - r && (xs[0] + xs[1]) / 2 < holeX + r && xs[0] > holeX - r - 0.5 && xs[1] < holeX + r + 0.5
      expect(midInHole).toBe(false)
    }
  }, 60_000)
})

describe('numerals and the draft', () => {
  it('a body renamed takes its numeral and every paragraph with it', () => {
    const s = DEFAULT_SETTINGS
    let { numerals } = assignBodies([], [{ id: 7, name: 'Housing' }, { id: 9, name: 'Lid' }], s)
    expect(numerals.map((n) => [n.n, n.label])).toEqual([
      [10, 'Housing'],
      [12, 'Lid'],
    ])
    const text = 'A [[10]] carries a [[12]]; the [[12#]] snaps onto the [[10]].'
    expect(expand(text, numerals)).toBe('A Housing 10 carries a Lid 12; the 12 snaps onto the Housing 10.')
    const synced = syncBodies(numerals, [{ id: 7, name: 'Base' }, { id: 9, name: 'Lid' }])
    numerals = synced.numerals
    expect(synced.renamed).toEqual([{ n: 10, from: 'Housing', to: 'Base' }])
    expect(expand(text, numerals)).toBe('A Base 10 carries a Lid 12; the 12 snaps onto the Base 10.')
    expect(assignBodies(numerals, [{ id: 7, name: 'Base' }, { id: 9, name: 'Lid' }], s).added).toEqual([])
    const r = renumber([{ n: 30, label: 'b', auto: false, target: { body: 'b' } }, { n: 14, label: 'a', auto: false, target: { body: 'a' } }], s)
    expect(r.numerals.map((n) => n.n)).toEqual([10, 12])
    expect(retoken('[[14]] and [[30#]]', r.map)).toBe('[[10]] and [[12#]]')
    expect([...numeralsIn({ detailed: 'the [[10]] and [[12#]]', claims: '[[40]]' })].sort()).toEqual([10, 12])
  })

  it('the brief description and the Markdown are marked drafts', () => {
    const figures: Figure[] = [
      { id: 'a', kind: 'view', view: 'iso' },
      { id: 'b', kind: 'section', view: 'front', section: { axis: 'y', offset: 0, keep: 'above', from: 'c' } },
      { id: 'c', kind: 'view', view: 'top' },
      { id: 'd', kind: 'exploded', view: 'iso' },
    ]
    expect(briefDescription(figures, 'the clamp')).toBe(
      'FIG. 1 is a perspective view of the clamp;\nFIG. 2 is a cross-sectional view taken along line 2–2 of FIG. 3 of the clamp;\nFIG. 3 is a top plan view of the clamp;\nFIG. 4 is an exploded perspective view of the clamp.',
    )
    const md = toMarkdown({ title: 'Clamp', detailed: 'The [[10]].' }, [{ n: 10, label: 'jaw', auto: false, target: { body: 'Jaw' } }], figures, 'the clamp')
    expect(md.match(/DRAFT — for attorney review/g)!.length).toBe(3)
    expect(md).toContain('The jaw 10.')
  })

  it('the specification is laid out as 1.52 asks: margins, numbered paragraphs, claims and abstract on their own pages', () => {
    const numerals = [{ n: 10, label: 'jaw', auto: false, target: { body: 'Jaw' } }, { n: 12, label: 'screw', auto: false, target: { body: 'Screw' } }]
    const figures: Figure[] = [{ id: 'a', kind: 'view', view: 'iso' }, { id: 'b', kind: 'view', view: 'top' }]
    const long = Array.from({ length: 40 }, (_, i) => `The [[10]] holds the [[12]] in place ${i}.`).join(' ')
    const draft = { title: 'Bench clamp', field: 'This relates to clamps.', detailed: `${long}\nThe [[12#]] turns.\n${long}`, claims: '1. A clamp comprising a jaw.\n2. The clamp of claim 1.', abstract: 'A clamp with a jaw.' }
    for (const paper of ['letter', 'a4'] as const) {
      const sp = specification(draft, numerals, figures, { ...DEFAULT_SETTINGS, paper, title: 'the clamp' })
      const W = paper === 'letter' ? 215.9 : 210
      const H = paper === 'letter' ? 279.4 : 297
      expect(sp.findings).toEqual([])
      const texts = sp.sheets.map((sh) => sh.marks.filter((m) => m.k === 'text') as Extract<Mark, { k: 'text' }>[])
      const body = texts.map((t) => t.filter((m) => !/DRAFT/.test(m.text) && m.text !== String(texts.indexOf(t) + 1)))
      for (const page of body)
        for (const m of page) {
          const x0 = m.anchor === 'middle' ? m.x - textWidth(m.text, m.h) / 2 : m.x
          expect(x0).toBeGreaterThanOrEqual(SPEC_MARGIN.left - 0.01 - (m.anchor === 'middle' ? 999 : 0))
          expect(x0 + textWidth(m.text, m.h)).toBeLessThanOrEqual(W - 20)
          expect(m.y - m.h).toBeGreaterThanOrEqual(20)
          expect(m.y).toBeLessThanOrEqual(H - 20)
          expect(m.h).toBeGreaterThanOrEqual(3.175)
        }
      const all = texts.flat().map((m) => m.text)
      expect(all.filter((t) => /^\[\d{4}\]$/.test(t))).toEqual(['[0001]', '[0002]', '[0003]', '[0004]', '[0005]', '[0006]'])
      expect(texts.flat().filter((m) => /^\[\d{4}\]$/.test(m.text)).every((m) => m.bold && m.x === SPEC_MARGIN.left)).toBe(true)
      expect(all).toContain('BENCH CLAMP')
      expect(all.join(' ')).toContain('The jaw 10 holds the screw 12 in place 0.')
      const claimsPage = texts.findIndex((t) => t.some((m) => m.text === 'CLAIMS'))
      const abstractPage = texts.findIndex((t) => t.some((m) => m.text === 'ABSTRACT'))
      expect(claimsPage).toBeGreaterThan(0)
      expect(abstractPage).toBe(claimsPage + 1)
      expect(texts[claimsPage].some((m) => /^\[\d{4}\]$/.test(m.text))).toBe(false)
      texts.forEach((t, i) => expect(t.some((m) => m.text === String(i + 1) && m.anchor === 'middle' && m.y > H - 25)).toBe(true))
      const rows = [...new Set(texts[0].filter((m) => m.x === SPEC_MARGIN.left).map((m) => m.y))].sort((a, b) => a - b)
      expect(Math.min(...rows.slice(1).map((y, i) => y - rows[i]))).toBeGreaterThanOrEqual((3.2 / 0.718) * 1.2 * 1.5 - 0.01)
    }
    const wordy = specification({ ...draft, abstract: Array(151).fill('word').join(' ') }, numerals, figures, DEFAULT_SETTINGS)
    expect(wordy.findings.map((f) => f.rule)).toContain('1.72(b)')
    const empty = specification({}, [], [], DEFAULT_SETTINGS)
    expect(empty.findings.map((f) => f.rule).sort()).toEqual(['1.72(a)', '1.72(b)', '1.75', '1.77(b)', '1.77(b)'])
    expect(new TextDecoder('latin1').decode(toPdf(specification(draft, numerals, figures, DEFAULT_SETTINGS).sheets))).toContain('/Helvetica-Bold')
  })

  it('a zip of the outputs reads back', () => {
    const z = zip([{ name: 'a.txt', bytes: new TextEncoder().encode('hello') }])
    expect(new DataView(z.buffer).getUint32(0, true)).toBe(0x04034b50)
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686)
  })
})

describe('no network', () => {
  it('nothing in patent-kit or the line-art it uses can reach the network', () => {
    const roots = [join(__dirname, '..'), join(__dirname, '..', '..', '_shared')]
    const files: string[] = []
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) {
          if (n !== 'scripts' && n !== 'tests') walk(p)
        } else if (/\.(ts|tsx|js|mjs)$/.test(n)) files.push(p)
      }
    }
    roots.forEach(walk)
    expect(files.length).toBeGreaterThan(8)
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|RTCPeerConnection|navigator\.share|window\.open|import\(\s*['"]https?:/)
  })
})
