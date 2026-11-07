// SPDX-License-Identifier: AGPL-3.0-only
// A sheet drawn to a PNG on the page, from the same marks as its SVG and
// PDF: what an agent looks at to check a drawing.

import { textWidth, type Sheet } from './sheet'

const CAP = 0.718

export async function toPng(s: Sheet, pxPerMm = 4): Promise<Uint8Array> {
  if (typeof OffscreenCanvas === 'undefined') throw new Error('A picture of a sheet needs the browser.')
  const canvas = new OffscreenCanvas(Math.round(s.w * pxPerMm), Math.round(s.h * pxPerMm))
  const g = canvas.getContext('2d')
  if (!g) throw new Error('No 2D canvas here.')
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.scale(pxPerMm, pxPerMm)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const m of s.marks) {
    const grey = `rgb(${Array(3).fill(Math.round(('grey' in m ? (m.grey ?? 0) : 0) * 255)).join(',')})`
    if (m.k === 'text') {
      g.fillStyle = '#000000'
      g.font = `${m.h / CAP}px Helvetica, Arial, sans-serif`
      const w = textWidth(m.text, m.h)
      g.fillText(m.text, m.anchor === 'middle' ? m.x - w / 2 : m.anchor === 'end' ? m.x - w : m.x, m.y)
      continue
    }
    g.beginPath()
    g.moveTo(m.pts[0], m.pts[1])
    for (let i = 2; i < m.pts.length; i += 2) g.lineTo(m.pts[i], m.pts[i + 1])
    if (m.k === 'fill') {
      g.closePath()
      g.fillStyle = grey
      g.fill()
    } else {
      g.strokeStyle = grey
      g.lineWidth = m.w
      g.setLineDash(m.dash ?? [])
      g.stroke()
    }
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}
