// SPDX-License-Identifier: AGPL-3.0-only
// Build the app's headless engine (src/headless/engine.ts) for Node: one
// module, dist-engine/engine.mjs, exporting startEngine(), with the
// packages it uses left to Node to find in this checkout's node_modules —
// which is why it is built here and run from here. scanruler-mcp runs it
// with --engine <path>, or --headless for this checkout's dist-engine; the
// plugins the build finds are in it, as they are in the page. The assets
// it reads at run time (public/materials/) are copied beside it.
//
//   npm run build:engine

import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))

await build({
  root,
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  logLevel: 'warn',
  // The page's static files are the page's.
  publicDir: false,
  build: {
    ssr: 'src/headless/engine.ts',
    outDir: 'dist-engine',
    emptyOutDir: true,
    target: 'node22',
    sourcemap: true,
    rollupOptions: { output: { entryFileNames: 'engine.mjs', format: 'es' } },
  },
  ssr: { target: 'node' },
})
// The run-time assets the engine reads rather than bundles (src/plugins/
// assets.ts), copied beside it with the licence texts that go with them:
// the material library's FreeCAD cards are loaded, not linked
// (CONTRIBUTING.md), in the engine as in the page.
const ASSETS = ['materials']
for (const dir of ASSETS) cpSync(join(root, 'public', dir), join(root, 'dist-engine', dir), { recursive: true })
console.log(`Built dist-engine/engine.mjs, with ${ASSETS.map((d) => `${d}/`).join(', ')} beside it`)
