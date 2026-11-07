// SPDX-License-Identifier: AGPL-3.0-only
// Copy BumpMesh's texturing engine into this plugin (plugins/texture/bumpmesh/),
// from a BumpMesh checkout — the same files BumpMesh itself runs, so the Texture
// workspace and BumpMesh's own Export give the same mesh. Run after pulling
// BumpMesh:
//
//   node plugins/texture/scripts/sync-engine.mjs [path/to/bumpmesh]   (default ../bumpmesh)
//
// Copies engine/{index,maps,writers}.js, every js/ module they import, the
// library textures and their thumbnails, and records the BumpMesh commit in
// bumpmesh/VERSION.json. threeCompat.js is replaced by a plain import: the
// plugin is bundled, so 'three' always resolves.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const plugin = resolve(here, '..')
const src = resolve(process.argv[2] ?? join(plugin, '..', '..', '..', 'bumpmesh'))
const dest = join(plugin, 'bumpmesh')
if (!existsSync(join(src, 'js', 'exportPipeline.js')) || !existsSync(join(src, 'engine', 'index.js'))) {
  console.error(`No BumpMesh checkout with engine/ at ${src}`)
  process.exit(1)
}

const files = new Set()
function walk(file) {
  if (files.has(file)) return
  files.add(file)
  for (const m of readFileSync(file, 'utf8').matchAll(/from\s+'(\.[^']+)'/g)) walk(resolve(dirname(file), m[1]))
}
// The type declarations beside the engine are the plugin's own: keep them.
const keep = ['engine/index.d.ts', 'engine/maps.d.ts', 'engine/writers.d.ts', 'js/presetTextures.d.ts'].map((f) => [f, existsSync(join(dest, f)) ? readFileSync(join(dest, f)) : null])
for (const f of ['engine/index.js', 'engine/maps.js', 'engine/writers.js', 'js/presetTextures.js']) walk(join(src, f))

rmSync(dest, { recursive: true, force: true })
for (const f of files) {
  const out = join(dest, relative(src, f))
  mkdirSync(dirname(out), { recursive: true })
  let text = readFileSync(f, 'utf8')
  if (f.endsWith('threeCompat.js')) {
    text = "// SPDX-License-Identifier: AGPL-3.0-only\n// Vendored by plugins/texture/scripts/sync-engine.mjs: bundled, 'three' always resolves.\nimport * as THREE from 'three';\nexport { THREE };\n"
  }
  writeFileSync(out, text)
}
// Library textures: the full images (the page sizes them as BumpMesh does) and thumbnails.
mkdirSync(join(dest, 'textures', 'thumbs'), { recursive: true })
for (const name of readdirSync(join(src, 'textures'))) {
  if (/\.(png|jpe?g|webp)$/i.test(name)) cpSync(join(src, 'textures', name), join(dest, 'textures', name))
}
for (const name of readdirSync(join(src, 'textures', 'thumbs'))) cpSync(join(src, 'textures', 'thumbs', name), join(dest, 'textures', 'thumbs', name))
cpSync(join(src, 'LICENSE'), join(dest, 'LICENSE'))
for (const [f, bytes] of keep) if (bytes) writeFileSync(join(dest, f), bytes)

let commit = null
try { commit = execSync('git rev-parse HEAD', { cwd: src }).toString().trim() } catch {}
const engineVersion = /ENGINE_VERSION = '([^']+)'/.exec(readFileSync(join(src, 'engine', 'index.js'), 'utf8'))?.[1]
const appVersion = /APP_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(join(src, 'js', 'version.js'), 'utf8'))?.[1]
writeFileSync(join(dest, 'VERSION.json'), JSON.stringify({ engine: engineVersion, bumpmesh: appVersion, commit, synced: new Date().toISOString() }, null, 2) + '\n')
console.log(`Synced ${files.size} engine files and the textures from ${src} (BumpMesh ${appVersion}, engine ${engineVersion}${commit ? `, ${commit.slice(0, 8)}` : ''}).`)
