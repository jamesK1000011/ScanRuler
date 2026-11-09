// SPDX-License-Identifier: AGPL-3.0-only
// The data this app loads rather than links stays out of its code: FreeCAD's
// material cards (LGPL-2.0-or-later and CC-BY-3.0 data, CONTRIBUTING.md
// "loaded, not linked") are a file of their own, fetched at run time, with
// their licence texts beside them. license-checker cannot see them — they are
// no npm package — so this reads a build for them:
//
//   node scripts/check-loaded-assets.mjs [dist]
//
// Fails, listing each, when a script in the build carries a card (found by
// its UUID, which no code of ours names), or when the build lacks the file or
// a licence text beside it. Run after `npm run build` (CI does); a
// dist-engine/ built by `npm run build:engine` is checked the same way.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = resolve(process.argv[2] ?? join(root, 'dist'))

/** Each loaded asset: where it is under public/, the licence texts that go
 *  with it, and what in it marks a copy of its data. */
const ASSETS = [
  {
    file: 'materials/freecad-cards.json',
    licences: ['materials/LGPL-2.0.txt', 'materials/CC-BY-3.0.txt'],
    marks: (text) => JSON.parse(text).materials.map((m) => m.source.uuid).filter(Boolean),
  },
]

function* scripts(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* scripts(path)
    else if (/\.(m?js|cjs)$/.test(name)) yield path
  }
}

if (!existsSync(dist)) {
  console.error(`No build at ${dist}: run npm run build first.`)
  process.exit(2)
}
const problems = []
const code = [...scripts(dist)].map((path) => ({ path, text: readFileSync(path, 'utf8') }))
for (const a of ASSETS) {
  for (const f of [a.file, ...a.licences]) if (!existsSync(join(dist, f))) problems.push(`${f} is not in the build`)
  const marks = a.marks(readFileSync(join(root, 'public', a.file), 'utf8'))
  for (const { path, text } of code) {
    const found = marks.filter((m) => text.includes(m))
    if (found.length) problems.push(`${relative(root, path)} carries ${found.length} entr${found.length === 1 ? 'y' : 'ies'} of ${a.file} (${found[0]}…): load it, do not import it`)
  }
}
if (problems.length) {
  console.error(`Loaded, not linked — broken:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(`Loaded, not linked: ${ASSETS.map((a) => a.file).join(', ')} beside the build, in none of its ${code.length} scripts.`)
