// SPDX-License-Identifier: AGPL-3.0-only
// A picture of this tab as the person sees it — panels, stage, dialogs and
// all — by the browser's own screen capture, asked for this tab only. The
// browser asks the person each time; only a click of theirs can start it,
// so an agent can read a shot but never take one. The stream is stopped as
// soon as the one frame is in hand.

import { useShots, type Shot } from '../state/shotStore'
import { announce } from './marks'

const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

function workspaceNow(): string | null {
  const on = document.querySelector('.modeswitch button.on')
  return (on?.querySelector('.wtxt')?.textContent ?? on?.getAttribute('aria-label') ?? on?.textContent ?? '').trim().split('\n')[0] || null
}

async function grab(stream: MediaStream): Promise<{ png: Uint8Array; width: number; height: number }> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  await video.play()
  // The first frames of a capture can still be the page as it was before
  // the browser's prompt closed: a few frames on, it is the page as it is.
  for (let i = 0; i < 6; i++) await frame()
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) throw new Error('The capture gave no picture.')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(video, 0, 0, width, height)
  video.srcObject = null
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('The picture could not be encoded.')
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height }
}

/** Ask the browser for this tab, take one frame, stop. Hides `hide` (the
 *  button and its card) while the frame is taken. */
export async function takeShot(hide: HTMLElement | null): Promise<Shot | null> {
  const st = useShots.getState()
  if (st.busy) return null
  if (!navigator.mediaDevices?.getDisplayMedia) {
    useShots.setState({ error: 'This browser cannot capture a tab. Chrome, Edge and Firefox can; Safari only from 17.' })
    return null
  }
  useShots.setState({ busy: true, error: null, open: null })
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: 10, width: { ideal: 7680 }, height: { ideal: 4320 } },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude',
    } as DisplayMediaStreamOptions)
    if (hide) hide.style.visibility = 'hidden'
    const { png, width, height } = await grab(stream)
    const shot: Shot = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      png,
      url: URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' })),
      width,
      height,
      note: '',
      workspace: workspaceNow(),
      marks: [],
    }
    useShots.getState().add(shot)
    announce(shot)
    return shot
  } catch (e) {
    const name = e instanceof DOMException ? e.name : ''
    useShots.setState({ error: name === 'NotAllowedError' || name === 'AbortError' ? null : e instanceof Error ? e.message : String(e) })
    return null
  } finally {
    for (const t of stream?.getTracks() ?? []) t.stop()
    if (hide) hide.style.visibility = ''
    useShots.setState({ busy: false })
  }
}

export const fileName = (s: Shot) => `scanruler-${s.at.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)}.png`
