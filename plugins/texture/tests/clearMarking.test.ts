// SPDX-License-Identifier: AGPL-3.0-only
// texture.clear_marking: the panel's Clear marking as a command — the
// marking off the part and its count to nothing, the layers' paint left as
// it was, and no step of the history.
import { describe, expect, it } from 'vitest'
import { installCommandHost, type CommandHost } from '../../../src/commands/host'
import { useMark } from '../../../src/state/markStore'
import { textureCommands } from '../app/textureCommands'
import { useTexture } from '../state/textureStore'

const command = (name: string) => textureCommands.find((c) => c.name === name)!

describe('clearing the marking', () => {
  it('is a command, read-only and needing the viewport, as show_mask is', () => {
    const c = command('clear_marking')
    expect(c.readOnly).toBe(true)
    expect(c.scene).toBe(true)
    expect(command('show_mask').readOnly).toBe(true)
  })

  it('takes the marking off the part and leaves the layer’s paint', async () => {
    let cleared = 0
    const scene = { clearPaint: () => void cleared++ }
    const stop = installCommandHost({ session: { sceneRef: { current: scene } } } as unknown as CommandHost)
    try {
      const paint = new Uint32Array([1, 2, 3])
      useTexture.getState().setMask(0, paint)
      useMark.getState().setCount(42)
      const out = (await command('clear_marking').run({} as never, { progress: () => {}, signal: new AbortController().signal } as never)) as { cleared: number }
      expect(out.cleared).toBe(42)
      expect(cleared).toBe(1)
      expect(useMark.getState().count).toBe(0)
      expect(useTexture.getState().layers[0].mask).toBe(paint)
    } finally {
      stop()
    }
  })

  it('needs the viewport', async () => {
    const stop = installCommandHost({ session: { sceneRef: { current: null } } } as unknown as CommandHost)
    let code = ''
    try {
      await command('clear_marking').run({} as never, { progress: () => {}, signal: new AbortController().signal } as never)
    } catch (e) {
      code = (e as { code: string }).code
    } finally {
      stop()
    }
    expect(code).toBe('unavailable')
  })
})
