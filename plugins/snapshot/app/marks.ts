// SPDX-License-Identifier: AGPL-3.0-only
// The person's marks drawn onto a shot — on the markup view's canvas as
// they draw, and onto the picture the agent gets: pins numbered, arrows,
// boxes, circles, strokes, each line thick enough to read on the whole
// window's picture.

import { notifyAgent } from '../../../src/plugins/api'
import { useShots, type Shot, type ShotMark } from '../state/shotStore'

/** Line width for a picture this wide. */
export const strokeFor = (width: number) => Math.max(2, Math.round(width / 420))

export function drawMarks(g: CanvasRenderingContext2D, marks: ShotMark[], width: number) {
  const lw = strokeFor(width)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const m of marks) {
    g.strokeStyle = m.color
    g.fillStyle = m.color
    g.lineWidth = lw
    const p = m.pts
    if (m.kind === 'pen' && p.length >= 4) {
      g.beginPath()
      g.moveTo(p[0], p[1])
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1])
      g.stroke()
    } else if (m.kind === 'box' && p.length >= 4) {
      g.strokeRect(Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.abs(p[2] - p[0]), Math.abs(p[3] - p[1]))
    } else if (m.kind === 'circle' && p.length >= 4) {
      g.beginPath()
      g.ellipse((p[0] + p[2]) / 2, (p[1] + p[3]) / 2, Math.abs(p[2] - p[0]) / 2 || 1, Math.abs(p[3] - p[1]) / 2 || 1, 0, 0, Math.PI * 2)
      g.stroke()
    } else if (m.kind === 'arrow' && p.length >= 4) {
      const [x0, y0, x1, y1] = p
      const a = Math.atan2(y1 - y0, x1 - x0)
      const h = lw * 6
      g.beginPath()
      g.moveTo(x0, y0)
      g.lineTo(x1 - Math.cos(a) * h * 0.6, y1 - Math.sin(a) * h * 0.6)
      g.stroke()
      g.beginPath()
      g.moveTo(x1, y1)
      g.lineTo(x1 - Math.cos(a - 0.45) * h, y1 - Math.sin(a - 0.45) * h)
      g.lineTo(x1 - Math.cos(a + 0.45) * h, y1 - Math.sin(a + 0.45) * h)
      g.closePath()
      g.fill()
    } else if (m.kind === 'pin' && p.length >= 2) {
      const r = lw * 6
      g.beginPath()
      g.arc(p[0], p[1], r, 0, Math.PI * 2)
      g.fill()
      g.lineWidth = Math.max(1, lw * 0.6)
      g.strokeStyle = '#ffffff'
      g.stroke()
      g.fillStyle = '#ffffff'
      g.font = `bold ${Math.round(r * 1.15)}px system-ui, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(String(m.n ?? ''), p[0], p[1] + r * 0.05)
      if (m.comment) {
        const size = Math.round(r * 0.95)
        g.font = `600 ${size}px system-ui, sans-serif`
        const text = m.comment.length > 80 ? `${m.comment.slice(0, 79)}…` : m.comment
        const w = g.measureText(text).width + size
        const x = Math.min(p[0] + r * 1.4, width - w - 4)
        const y = p[1] - size * 0.8
        g.fillStyle = 'rgba(255, 255, 255, 0.94)'
        g.strokeStyle = m.color
        g.lineWidth = Math.max(1, lw * 0.5)
        g.beginPath()
        g.rect(x, y, w, size * 1.6)
        g.fill()
        g.stroke()
        g.fillStyle = '#111111'
        g.textAlign = 'left'
        g.fillText(text, x + size / 2, y + size * 0.82)
      }
    }
  }
}

const imageOf = (s: Shot) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The screenshot could not be read back.'))
    img.src = s.url
  })

/** The shot with its marks on it, as PNG bytes; the shot itself if it has
 *  none. */
export async function composite(s: Shot): Promise<Uint8Array> {
  if (!s.marks.length) return s.png
  const img = await imageOf(s)
  const canvas = document.createElement('canvas')
  canvas.width = s.width
  canvas.height = s.height
  const g = canvas.getContext('2d')!
  g.drawImage(img, 0, 0, s.width, s.height)
  drawMarks(g, s.marks, s.width)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('The marked screenshot could not be encoded.')
  return new Uint8Array(await blob.arrayBuffer())
}

/** The numbered pins and their comments, where they are in the picture —
 *  in pixels and as a share of its width and height. */
export const pinsOf = (s: Shot) =>
  s.marks
    .filter((m) => m.kind === 'pin')
    .map((m) => ({ n: m.n, comment: m.comment ?? '', x: Math.round(m.pts[0]), y: Math.round(m.pts[1]), at: `${Math.round((m.pts[0] / s.width) * 100)}% across, ${Math.round((m.pts[1] / s.height) * 100)}% down` }))

/** Tell the agent's server about a shot — taken, or marked up since. */
export function announce(s: Shot) {
  notifyAgent('snapshot', {
    id: s.id,
    at: s.at,
    workspace: s.workspace,
    note: s.note || null,
    marks: s.marks.length,
    pins: s.marks.filter((m) => m.kind === 'pin').length,
    save: useShots.getState().save,
  })
}
