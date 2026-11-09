// SPDX-License-Identifier: AGPL-3.0-only
// Files the app reads at run time rather than bundles: a static asset under
// public/, fetched by its path when first needed. The page fetches it from
// where the build is served; Node (the headless engine, the tests) reads it
// from disk. What is kept out of the bundle this way is kept out on
// purpose — the material library's FreeCAD cards are loaded, not linked
// (CONTRIBUTING.md) — so nothing here is imported, only read.
//
// The headless engine says where its copies are (setAssetReader): the
// engine build copies them beside dist-engine/engine.mjs.

/** Reads an asset's text by its path under public/ ("materials/x.json"). */
export type AssetReader = (path: string) => Promise<string>

let reader: AssetReader | null = null

/** Read assets this way from now on; null for the default. */
export function setAssetReader(next: AssetReader | null): void {
  reader = next
}

/** An asset's text, by its path under public/. Rejects, saying which, when
 *  it cannot be had. */
export function readAsset(path: string): Promise<string> {
  return (reader ?? defaultReader)(path)
}

interface NodeProcess {
  versions?: { node?: string }
}
const inNode = (): boolean => typeof (globalThis as { process?: NodeProcess }).process?.versions?.node === 'string'

/** A reader of files on disk: the first of the folders that has the path.
 *  For Node only. */
export function diskAssetReader(roots: readonly URL[]): AssetReader {
  return async (path) => {
    // Named through a variable, so the page's bundle neither follows nor
    // stubs it: only Node ever runs this.
    const fsName = 'node:fs/promises'
    const { readFile } = (await import(/* @vite-ignore */ fsName)) as { readFile(url: URL, enc: 'utf8'): Promise<string> }
    let last: unknown
    for (const root of roots) {
      try {
        return await readFile(new URL(path, root), 'utf8')
      } catch (e) {
        last = e
      }
    }
    throw new Error(`${path} is not in ${roots.map((r) => r.href).join(' or ')}: ${last instanceof Error ? last.message : String(last)}`)
  }
}

async function defaultReader(path: string): Promise<string> {
  // In the sources (the tests): this checkout's public/. Through a
  // variable, so the page's build does not take it for an asset to emit.
  const sourcesPublic = '../../public/'
  if (inNode()) return diskAssetReader([new URL(sourcesPublic, import.meta.url)])(path)
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/*$/, '/')
  let res: Response
  try {
    res = await fetch(`${base}${path}`)
  } catch {
    throw new Error(`${path} could not be fetched: check the connection and try again.`)
  }
  if (!res.ok) throw new Error(`${path} could not be fetched: ${res.status} ${res.statusText}`.trimEnd() + '.')
  return res.text()
}
