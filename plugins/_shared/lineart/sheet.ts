// SPDX-License-Identifier: AGPL-3.0-only
// A drawing sheet as a list of marks in millimetres, origin top left and y
// down, written out as SVG or as PDF. Black and white unless a mark says a
// colour (rgb, '#rrggbb') — patent sheets never do; a manual's theme may.
// No fonts to embed: Helvetica and Helvetica-Bold, which every PDF reader has.

export type Mark =
  | { k: 'line'; pts: number[]; w: number; dash?: number[]; grey?: number; rgb?: string }
  | { k: 'fill'; pts: number[]; grey?: number; rgb?: string }
  | { k: 'text'; x: number; y: number; h: number; text: string; anchor?: 'start' | 'middle' | 'end'; rgb?: string; bold?: boolean }

export interface Sheet {
  w: number
  h: number
  marks: Mark[]
}

/** Helvetica's cap height as a share of the font size. */
const CAP = 0.718

/** Helvetica's advance widths, thousandths of an em, for the characters
 *  space (32) to tilde (126) — the font's own metrics, so text is measured
 *  as a PDF reader lays it out. */
const HELVETICA = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584]

/** How wide a text of cap height h comes out, mm, in Helvetica: by each
 *  character's own width; one outside ASCII as a digit. Bold runs about 6 %
 *  wider. */
export const textWidth = (text: string, h: number, bold = false) =>
  ([...text].reduce((s, c) => {
    const code = c.charCodeAt(0)
    return s + (code >= 32 && code <= 126 ? HELVETICA[code - 32] : 556)
  }, 0) / 1000) * (h / CAP) * (bold ? 1.06 : 1)

const f = (n: number) => (Math.round(n * 1000) / 1000).toString()

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** '#rrggbb' as PDF's three 0–1 figures. */
const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
const isRgb = (hex?: string): hex is string => typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)

const greyHex = (g = 0) => {
  const v = Math.round(Math.max(0, Math.min(1, g)) * 255).toString(16).padStart(2, '0')
  return `#${v}${v}${v}`
}

export function toSvg(s: Sheet): string {
  const out: string[] = [
    // units-ok: the SVG's size attribute: a sheet is drawn in millimetres
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(s.w)}mm" height="${f(s.h)}mm" viewBox="0 0 ${f(s.w)} ${f(s.h)}">`,
    `<rect width="${f(s.w)}" height="${f(s.h)}" fill="#ffffff"/>`,
  ]
  for (const m of s.marks) {
    if (m.k === 'line') {
      const d = m.pts.reduce((a, v, i) => a + (i % 2 === 0 ? `${i === 0 ? 'M' : 'L'}${f(v)} ` : `${f(v)} `), '')
      out.push(`<path d="${d.trim()}" fill="none" stroke="${isRgb(m.rgb) ? m.rgb : greyHex(m.grey)}" stroke-width="${f(m.w)}" stroke-linecap="round" stroke-linejoin="round"${m.dash ? ` stroke-dasharray="${m.dash.map(f).join(' ')}"` : ''}/>`)
    } else if (m.k === 'fill') {
      const d = m.pts.reduce((a, v, i) => a + (i % 2 === 0 ? `${i === 0 ? 'M' : 'L'}${f(v)} ` : `${f(v)} `), '')
      out.push(`<path d="${d.trim()}Z" fill="${isRgb(m.rgb) ? m.rgb : greyHex(m.grey)}" stroke="none"/>`)
    } else {
      const anchor = m.anchor ?? 'start'
      out.push(`<text x="${f(m.x)}" y="${f(m.y)}" font-family="Helvetica, Arial, sans-serif" font-size="${f(m.h / CAP)}"${m.bold ? ' font-weight="bold"' : ''} text-anchor="${anchor}" fill="${isRgb(m.rgb) ? m.rgb : '#000000'}">${esc(m.text)}</text>`)
    }
  }
  out.push('</svg>')
  return out.join('\n')
}

const PT = 72 / 25.4

/** WinAnsi codes for the characters past Latin-1 a sheet may hold. */
const WIN: Record<string, number> = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 }
const winAnsi = (t: string) => [...t].map((c) => (WIN[c] !== undefined ? String.fromCharCode(WIN[c]) : c.charCodeAt(0) < 256 ? c : '?')).join('')

/** The sheets as one PDF, a page each. */
export function toPdf(sheets: Sheet[]): Uint8Array {
  const objs: string[] = []
  const add = (body: string) => {
    objs.push(body)
    return objs.length
  }
  const catalog = add('')
  const pages = add('')
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const kids: number[] = []
  for (const s of sheets) {
    const H = s.h
    const X = (x: number) => f(x * PT)
    const Y = (y: number) => f((H - y) * PT)
    const ops: string[] = ['1 J 1 j']
    for (const m of s.marks) {
      if (m.k === 'line') {
        ops.push(`${isRgb(m.rgb) ? `${rgbOf(m.rgb).map(f).join(' ')} RG` : `${f(m.grey ?? 0)} G`} ${f(m.w * PT)} w [${(m.dash ?? []).map((d) => f(d * PT)).join(' ')}] 0 d`)
        ops.push(`${X(m.pts[0])} ${Y(m.pts[1])} m ${m.pts.slice(2).reduce((a, v, i) => a + (i % 2 === 0 ? `${X(v)} ` : `${Y(v)} l `), '')}S`)
      } else if (m.k === 'fill') {
        ops.push(`${isRgb(m.rgb) ? `${rgbOf(m.rgb).map(f).join(' ')} rg` : `${f(m.grey ?? 0)} g`} ${X(m.pts[0])} ${Y(m.pts[1])} m ${m.pts.slice(2).reduce((a, v, i) => a + (i % 2 === 0 ? `${X(v)} ` : `${Y(v)} l `), '')}h f`)
      } else {
        const size = (m.h / CAP) * PT
        const w = textWidth(m.text, m.h, m.bold)
        const x = m.anchor === 'middle' ? m.x - w / 2 : m.anchor === 'end' ? m.x - w : m.x
        ops.push(`${isRgb(m.rgb) ? `${rgbOf(m.rgb).map(f).join(' ')} rg` : '0 g'} BT /${m.bold ? 'F2' : 'F1'} ${f(size)} Tf ${X(x)} ${Y(m.y)} Td (${winAnsi(m.text).replace(/[\\()]/g, (c) => `\\${c}`)}) Tj ET`)
      }
    }
    const stream = ops.join('\n')
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${f(s.w * PT)} ${f(s.h * PT)}] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`))
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`
  objs[pages - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const bytes = new Uint8Array(pdf.length)
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff
  return bytes
}
