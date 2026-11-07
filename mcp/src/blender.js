// SPDX-License-Identifier: AGPL-3.0-only
// A Blender file turned into GLB by the Blender installed on this computer,
// for the import-plus plugin to open: ScanRuler's page cannot read .blend
// itself, and no library outside Blender can. Blender runs in the
// background with its factory settings and with scripts kept in the .blend
// switched off (--disable-autoexec), and the one line of Python this server
// hands it only exports glTF. Nothing goes over the network.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, extname, join, resolve } from 'node:path'

/** Where Blender is looked for when BLENDER_PATH does not say. */
export function blenderCandidates(env = process.env, platform = process.platform) {
  const onPath = (env.PATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, platform === 'win32' ? 'blender.exe' : 'blender'))
  const standard =
    platform === 'darwin'
      ? ['/Applications/Blender.app/Contents/MacOS/Blender', join(env.HOME ?? '', 'Applications/Blender.app/Contents/MacOS/Blender')]
      : platform === 'win32'
        ? ['C:/Program Files/Blender Foundation/Blender/blender.exe']
        : ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender']
  const given = [env.SCANRULER_MCP_BLENDER, env.BLENDER_PATH].filter((p) => p && p !== 'auto')
  return [...given, ...standard, ...onPath]
}

export function findBlender(env = process.env, platform = process.platform) {
  return blenderCandidates(env, platform).find((p) => existsSync(p)) ?? null
}

const EXPORT = [
  'import bpy, os',
  "bpy.ops.export_scene.gltf(filepath=os.environ['SCANRULER_GLB_OUT'], export_format='GLB', export_apply=True, use_selection=False)",
].join('\n')

/** Convert `path` (a .blend) to GLB at `out` (default: a temp folder), with
 *  the Blender at `blender`. Resolves to where it went and how large it is. */
export async function convertBlend({ path, out, blender = findBlender(), timeoutMs = 180_000 }) {
  if (!path) throw new Error('blender_convert needs path: the .blend file.')
  const source = resolve(path)
  if (extname(source).toLowerCase() !== '.blend') throw new Error(`${basename(source)} is not a .blend file.`)
  if (!blender) throw new Error('Blender was not found on this computer. Install it, or set SCANRULER_MCP_BLENDER in this server’s environment to its executable (on a Mac, /Applications/Blender.app/Contents/MacOS/Blender), or export a .glb from Blender yourself and open that.')
  if (!existsSync(source)) throw new Error(`There is no file ${source}.`)
  const target = resolve(out ?? join(tmpdir(), 'scanruler-blender', `${basename(source, extname(source))}.glb`))
  await mkdir(dirname(target), { recursive: true })
  const started = Date.now()
  const args = ['--background', '--factory-startup', '--disable-autoexec', source, '--python-expr', EXPORT]
  const log = await new Promise((resolveRun, reject) => {
    const child = spawn(blender, args, { env: { ...process.env, SCANRULER_GLB_OUT: target }, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    child.stdout.on('data', (d) => (text = (text + d).slice(-4000)))
    child.stderr.on('data', (d) => (text = (text + d).slice(-4000)))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Blender took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`))
    }, timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`Blender could not be started (${blender}): ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolveRun(text)
      else reject(new Error(`Blender stopped with code ${code}: ${text.trim().split('\n').slice(-3).join(' ')}`))
    })
  })
  if (!existsSync(target)) throw new Error(`Blender finished but wrote no GLB: ${String(log).trim().split('\n').slice(-3).join(' ')}`)
  const size = (await stat(target)).size
  return { path: target, bytes: size, seconds: Math.round((Date.now() - started) / 100) / 10, blender, next: `Open it with import_open { path: "${target}" } — or import_inspect first to see its parts and size.` }
}
