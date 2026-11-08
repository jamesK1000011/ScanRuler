// SPDX-License-Identifier: AGPL-3.0-only
// Quick tooltips for every control that has a title: the app's own and every
// plugin's, with no change to them. The browser's tooltip waits a second or
// more, and an icon-only key is then a guess or a click. Here the title shows
// after a short pause, at once while moving from one key to the next, in the
// app's own faceplate, and is put back on the element when the pointer
// leaves, so anything reading it still finds it. Touch is left alone: a tap
// is not a hover.

import { useEffect, useRef, useState } from 'react'

const DELAY_MS = 350
/** Held this much longer on the same key, the brief tip gives the whole. */
const MORE_MS = 1200

/** The tip first shown: the name on its first line, and of what follows its
 *  first phrase — to the first full stop, dash, colon or semicolon after a
 *  few words, cut at about 90 characters. The whole comes on a longer hover. */
export function brief(text: string): string {
  const [head, ...rest] = text.split('\n')
  const body = rest.join(' ').trim()
  const cut = (t: string) => {
    const m = /^(.{12,}?)(?:\.\s|\s—\s|:\s|;\s|\s\()/.exec(t)
    let out = (m ? m[1] : t).trim()
    if (out.length > 90) out = `${out.slice(0, 88).replace(/\s+\S*$/, '')}…`
    return out
  }
  if (!rest.length) return cut(head)
  return body ? `${head}\n${cut(body)}` : head
}
/** After a tip was shown, the next one comes at once within this long. */
const WARM_MS = 600
const GAP = 6

interface Tip {
  text: string
  full: boolean
  x: number
  y: number
  above: boolean
}

export function HoverTips() {
  const [tip, setTip] = useState<Tip | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let el: HTMLElement | null = null
    let held = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let warmUntil = 0
    // After a press, what moves under a still pointer (a tab strip scrolling
    // its open tab into view) is not a hover: wait for the pointer to move.
    let pressed = false

    const put = () => {
      if (el && held && !el.hasAttribute('title')) el.setAttribute('title', held)
    }
    const leave = () => {
      clearTimeout(timer)
      clearTimeout(more)
      put()
      if (el) warmUntil = Date.now() + WARM_MS
      el = null
      held = ''
      setTip(null)
    }
    let more: ReturnType<typeof setTimeout> | undefined
    const show = (target: HTMLElement, text: string) => {
      const r = target.getBoundingClientRect()
      const above = r.bottom + 120 > window.innerHeight
      const at = { x: r.left + r.width / 2, y: above ? r.top - GAP : r.bottom + GAP, above }
      const short = brief(text)
      setTip({ text: short, full: short === text, ...at })
      clearTimeout(more)
      if (short !== text) more = setTimeout(() => el === target && setTip({ text, full: true, ...at }), MORE_MS)
    }
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || pressed) return
      const target = (e.target as Element | null)?.closest?.('[title], button[aria-label], [role=button][aria-label], [role=tab][aria-label]') as HTMLElement | null
      if (target === el) return
      leave()
      if (!target || !(target instanceof HTMLElement)) return
      const titled = target.hasAttribute('title')
      // A key's accessible name, when it has no title and shows no words.
      const text = (titled ? target.getAttribute('title') : target.textContent?.trim() ? null : target.getAttribute('aria-label'))?.trim()
      if (!text) return
      el = target
      held = titled ? target.getAttribute('title')! : ''
      if (titled) target.removeAttribute('title')
      clearTimeout(timer)
      if (Date.now() < warmUntil) show(target, text)
      else timer = setTimeout(() => el === target && show(target, text), DELAY_MS)
    }
    const out = (e: PointerEvent) => {
      if (!el) return
      const to = e.relatedTarget as Node | null
      if (to && el.contains(to)) return
      leave()
    }
    const away = () => {
      warmUntil = 0
      leave()
    }
    const press = () => {
      pressed = true
      away()
    }
    const moved = () => {
      pressed = false
    }
    document.addEventListener('pointerover', over, true)
    document.addEventListener('pointerout', out, true)
    document.addEventListener('pointerdown', press, true)
    document.addEventListener('pointermove', moved, true)
    document.addEventListener('keydown', away, true)
    window.addEventListener('scroll', away, true)
    window.addEventListener('blur', away)
    return () => {
      leave()
      document.removeEventListener('pointerover', over, true)
      document.removeEventListener('pointerout', out, true)
      document.removeEventListener('pointerdown', press, true)
      document.removeEventListener('pointermove', moved, true)
      document.removeEventListener('keydown', away, true)
      window.removeEventListener('scroll', away, true)
      window.removeEventListener('blur', away)
    }
  }, [])

  // Kept inside the window: measured once drawn, then nudged in from an edge.
  const [nudge, setNudge] = useState(0)
  useEffect(() => {
    const b = box.current
    if (!tip || !b) return setNudge(0)
    const w = b.offsetWidth
    const left = tip.x - w / 2
    setNudge(left < 6 ? 6 - left : left + w > window.innerWidth - 6 ? window.innerWidth - 6 - (left + w) : 0)
  }, [tip])

  if (!tip) return null
  return (
    <div
      ref={box}
      className={`hovertip${tip.above ? ' above' : ''}${tip.text.includes('\n') ? ' multi' : ''}${tip.full ? '' : ' brief'}`}
      role="tooltip"
      data-test="hover-tip"
      style={{ left: tip.x + nudge, top: tip.y }}
    >
      {tip.text}
    </div>
  )
}
