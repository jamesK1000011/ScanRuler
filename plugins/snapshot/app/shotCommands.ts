// SPDX-License-Identifier: AGPL-3.0-only
// snapshot.*: the agent's side of the camera button. It reads the shots
// the person took — the newest, or one by its place in the list — with
// the note they wrote on it. It cannot take one: only the person's click
// starts a capture.

import { int, obj } from '../../../src/commands/schema'
import { type Command, CommandError } from '../../../src/plugins/api'
import { fileName } from './capture'
import { KEEP, useShots, type Shot } from '../state/shotStore'

const about = (s: Shot, index: number) => ({ index, at: s.at, workspace: s.workspace, note: s.note || null, width: s.width, height: s.height })

const latest: Command<{ index?: number }> = {
  name: 'latest',
  title: 'Look at the person’s screenshot',
  description: `The screenshot the person took of ScanRuler with the camera button (bottom right) — the newest, or index 1, 2… for older ones (up to ${KEEP} are kept, in the page's memory only) — as a picture, with when it was taken, the workspace on screen and the note they wrote on it. Call it when the person says they took a screenshot or asks you to look at what they see. You cannot take one: only their click can.`,
  input: obj({ index: int('0 the newest (the default), 1 the one before, …', { minimum: 0 }) }),
  readOnly: true,
  history: false,
  returnsImage: true,
  run: async ({ index = 0 }) => {
    const shots = useShots.getState().shots
    if (!shots.length) throw new CommandError('not_found', 'No screenshot yet. Ask the person to press the camera button at the bottom right of ScanRuler and choose this tab.')
    const s = shots[index]
    if (!s) throw new CommandError('not_found', `There ${shots.length === 1 ? 'is 1 screenshot' : `are ${shots.length} screenshots`}: index 0 to ${shots.length - 1}.`)
    return { ...about(s, index), of: shots.length, file: { name: fileName(s), mimeType: 'image/png', bytes: s.png } }
  },
}

const list: Command<Record<string, never>> = {
  name: 'list',
  title: 'The person’s screenshots',
  description: 'The screenshots the person has taken this session, newest first: when, the workspace on screen and their note — no pictures (snapshot.latest { index } shows one).',
  input: obj({}),
  readOnly: true,
  history: false,
  run: async () => ({ shots: useShots.getState().shots.map(about) }),
}

export const shotCommands = [latest, list]
