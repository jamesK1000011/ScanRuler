// SPDX-License-Identifier: AGPL-3.0-only
// A drawing sheet as a list of black-and-white marks in millimetres, origin
// top left and y down, written out as SVG or as PDF. No colour, no shading,
// no fonts to embed: Helvetica, which every PDF reader has.

export type Mark =
  | { k: 'line'; pts: number[]; w: number; dash?: number[]; grey?: number }
  | { k: 'fill'; pts: number[]; grey?: number }
  | { k: 'text'; x: number; y: number; h: number; text: string; anchor?: 'start' | 'middle' | 'end' }

export interface Sheet {
  w: number
  h: number
  marks: Mark[]
}

/** Helvetica's cap height as a share of the font size. */
const CAP = 0.718

/** How wide a text of cap height h comes out, mm (Helvetica's digits are
 *  0.556 em; letters average about the same). */
export const textWidth = (text: string, h: number) => [...text].reduce((s, c) => s + (c === ' ' ? 0.278 : c === '.' ? 0.278 : /[A-Z]/.test(c) ? 0.68 : 0.556), 0) * (h / CAP)

const f = (n: number) => (Math.round(n * 1000) / 1000).toString()

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const greyHex = (g = 0) => {
  const v = Math.round(Math.max(0, Math.min(1, g)) * 255).toString(16).padStart(2, '0')
  return `#${v}${v}${v}`
}

export function toSvg(s: Sheet): string {
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(s.w)}mm" height="${f(s.h)}mm" viewBox="0 0 ${f(s.w)} ${f(s.h)}">`,
    `<rect width="${f(s.w)}" height="${f(s.h)}" fill="#ffffff"/>`,
  ]
  for (const m of s.marks) {
    if (m.k === 'line') {
      const d = m.pts.reduce((a, v, i) => a + (i % 2 === 0 ? `${i === 0 ? 'M' : 'L'}${f(v)} ` : `${f(v)} `), '')
      out.push(`<path d="${d.trim()}" fill="none" stroke="${greyHex(m.grey)}" stroke-width="${f(m.w)}" stroke-linecap="round" stroke-linejoin="round"${m.dash ? ` stroke-dasharray="${m.dash.map(f).join(' ')}"` : ''}/>`)
    } else if (m.k === 'fill') {
      const d = m.pts.reduce((a, v, i) => a + (i % 2 === 0 ? `${i === 0 ? 'M' : 'L'}${f(v)} ` : `${f(v)} `), '')
      out.push(`<path d="${d.trim()}Z" fill="${greyHex(m.grey)}" stroke="none"/>`)
    } else {
      const anchor = m.anchor ?? 'start'
      out.push(`<text x="${f(m.x)}" y="${f(m.y)}" font-family="Helvetica, Arial, sans-serif" font-size="${f(m.h / CAP)}" text-anchor="${anchor}" fill="#000000">${esc(m.text)}</text>`)
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
  const kids: number[] = []
  for (const s of sheets) {
    const H = s.h
    const X = (x: number) => f(x * PT)
    const Y = (y: number) => f((H - y) * PT)
    const ops: string[] = ['1 J 1 j']
    for (const m of s.marks) {
      if (m.k === 'line') {
        ops.push(`${f(m.grey ?? 0)} G ${f(m.w * PT)} w [${(m.dash ?? []).map((d) => f(d * PT)).join(' ')}] 0 d`)
        ops.push(`${X(m.pts[0])} ${Y(m.pts[1])} m ${m.pts.slice(2).reduce((a, v, i) => a + (i % 2 === 0 ? `${X(v)} ` : `${Y(v)} l `), '')}S`)
      } else if (m.k === 'fill') {
        ops.push(`${f(m.grey ?? 0)} g ${X(m.pts[0])} ${Y(m.pts[1])} m ${m.pts.slice(2).reduce((a, v, i) => a + (i % 2 === 0 ? `${X(v)} ` : `${Y(v)} l `), '')}h f`)
      } else {
        const size = (m.h / CAP) * PT
        const w = textWidth(m.text, m.h)
        const x = m.anchor === 'middle' ? m.x - w / 2 : m.anchor === 'end' ? m.x - w : m.x
        ops.push(`0 g BT /F1 ${f(size)} Tf ${X(x)} ${Y(m.y)} Td (${winAnsi(m.text).replace(/[\\()]/g, (c) => `\\${c}`)}) Tj ET`)
      }
    }
    const stream = ops.join('\n')
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${f(s.w * PT)} ${f(s.h * PT)}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`))
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
