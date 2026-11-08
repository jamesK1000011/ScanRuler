// SPDX-License-Identifier: AGPL-3.0-only
// snapshot.*: the agent's side of the camera button. It reads the shots
// the person took — with the marks they drew on them, their numbered pins
// and comments, and their note — and can wait for the next one. It cannot
// take one: only the person's click starts a capture. snapshot.saved is
// the server's, telling the page where it wrote a shot.

import { bool, int, obj, str } from '../../../src/commands/schema'
import { type Command, CommandError } from '../../../src/plugins/api'
import { fileName } from './capture'
import { composite, pinsOf } from './marks'
import { KEEP, useShots, type Shot } from '../state/shotStore'

const about = (s: Shot, index: number) => ({
  index,
  id: s.id,
  at: s.at,
  workspace: s.workspace,
  note: s.note || null,
  width: s.width,
  height: s.height,
  marks: s.marks.length,
  pins: pinsOf(s),
  ...(s.path ? { savedTo: s.path } : {}),
})

const latest: Command<{ index?: number; id?: string; original?: boolean }> = {
  name: 'latest',
  title: 'Look at the person’s screenshot',
  description: `The screenshot the person took of ScanRuler with the camera button (bottom right) — the newest, or index 1, 2… for older ones (up to ${KEEP} kept) — as a picture with the marks they drew on it: numbered pins, arrows, boxes, circles, strokes. Also when it was taken, the workspace on screen, their note, each pin's number, comment and place, and the file it was saved to beside the scan. original: true for the picture without the marks. Call it when the person says they took a screenshot, when an answer says they did, or when they ask you to look at what they see. You cannot take one: only their click can.`,
  input: obj({ index: int('0 the newest (the default), 1 the one before, …', { minimum: 0 }), id: str('A shot by its id, in place of index.'), original: bool('The picture without the marks.') }),
  readOnly: true,
  history: false,
  returnsImage: true,
  run: async ({ index = 0, id, original }) => {
    const shots = useShots.getState().shots
    if (!shots.length) throw new CommandError('not_found', 'No screenshot yet. Ask the person to press the camera button at the bottom right of ScanRuler and choose this tab.')
    const at = id ? shots.findIndex((x) => x.id === id) : index
    const s = shots[at]
    if (!s) throw new CommandError('not_found', id ? `No screenshot ${id} — it may have been discarded.` : `There ${shots.length === 1 ? 'is 1 screenshot' : `are ${shots.length} screenshots`}: index 0 to ${shots.length - 1}.`)
    const marked = !original && s.marks.length > 0
    const bytes = original ? s.png : await composite(s)
    return { ...about(s, at), of: shots.length, picture: marked ? 'with the marks' : 'as taken', file: { name: fileName(s).replace(/\.png$/, marked ? '-marked.png' : '.png'), mimeType: 'image/png', bytes } }
  },
}

const list: Command<Record<string, never>> = {
  name: 'list',
  title: 'The person’s screenshots',
  description: 'The screenshots the person has taken this session, newest first: when, the workspace on screen, their note, their pins and comments, and where each was saved — no pictures (snapshot.latest { index } shows one).',
  input: obj({}),
  readOnly: true,
  history: false,
  run: async () => ({ shots: useShots.getState().shots.map(about) }),
}

const wait: Command<{ timeoutSeconds?: number }> = {
  name: 'wait',
  title: 'Wait for the person’s next screenshot',
  description: 'Waits until the person takes a screenshot or finishes marking one up, then answers what snapshot.list says of it — for "I’ll show you": call it and the answer comes when they press the camera. timeoutSeconds: how long to wait (120 by default, 600 at most); then it answers that none came.',
  input: obj({ timeoutSeconds: int(undefined, { minimum: 1, maximum: 600 }) }),
  readOnly: true,
  long: true,
  history: false,
  timeoutMs: 610_000,
  run: async ({ timeoutSeconds = 120 }) => {
    const stamp = (s: Shot | undefined) => (s ? `${s.id}:${s.marks.length}:${s.note}` : '')
    const before = stamp(useShots.getState().shots[0])
    const got = await new Promise<Shot | null>((resolve) => {
      const timer = setTimeout(() => {
        stop()
        resolve(null)
      }, timeoutSeconds * 1000)
      const stop = useShots.subscribe((st) => {
        const top = st.shots[0]
        if (top && stamp(top) !== before && st.editing !== top.id) {
          clearTimeout(timer)
          stop()
          resolve(top)
        }
      })
    })
    if (!got) return { came: false, note: `No screenshot in ${timeoutSeconds} s.` }
    return { came: true, ...about(got, 0), next: 'snapshot.latest shows it.' }
  },
}

const saved: Command<{ id: string; path: string }> = {
  name: 'saved',
  title: 'Where the server saved a screenshot',
  description: 'The agent’s server telling the page where it wrote a screenshot.',
  input: obj({ id: str(), path: str() }, ['id', 'path']),
  readOnly: true,
  history: false,
  internal: true,
  run: async ({ id, path }) => {
    useShots.getState().saved(id, path)
    return { ok: true }
  },
}

export const shotCommands = [latest, list, wait, saved]
