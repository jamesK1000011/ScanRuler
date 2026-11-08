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
/** After a tip was shown, the next one comes at once within this long. */
const WARM_MS = 600
const GAP = 6

interface Tip {
  text: string
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

    const put = () => {
      if (el && held && !el.hasAttribute('title')) el.setAttribute('title', held)
    }
    const leave = () => {
      clearTimeout(timer)
      put()
      if (el) warmUntil = Date.now() + WARM_MS
      el = null
      held = ''
      setTip(null)
    }
    const show = (target: HTMLElement, text: string) => {
      const r = target.getBoundingClientRect()
      const above = r.bottom + 40 > window.innerHeight
      setTip({ text, x: r.left + r.width / 2, y: above ? r.top - GAP : r.bottom + GAP, above })
    }
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const target = (e.target as Element | null)?.closest?.('[title]') as HTMLElement | null
      if (target === el) return
      leave()
      if (!target || !(target instanceof HTMLElement)) return
      const text = target.getAttribute('title')?.trim()
      if (!text) return
      el = target
      held = target.getAttribute('title')!
      target.removeAttribute('title')
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
    document.addEventListener('pointerover', over, true)
    document.addEventListener('pointerout', out, true)
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', away, true)
    window.addEventListener('scroll', away, true)
    window.addEventListener('blur', away)
    return () => {
      leave()
      document.removeEventListener('pointerover', over, true)
      document.removeEventListener('pointerout', out, true)
      document.removeEventListener('pointerdown', away, true)
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
      className={`hovertip${tip.above ? ' above' : ''}${tip.text.includes('\n') ? ' multi' : ''}`}
      role="tooltip"
      data-test="hover-tip"
      style={{ left: tip.x + nudge, top: tip.y }}
    >
      {tip.text}
    </div>
  )
}
