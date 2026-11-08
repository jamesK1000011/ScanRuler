// SPDX-License-Identifier: AGPL-3.0-only
// 3D model libraries searched through their official APIs, from this
// computer: Sketchfab (search needs no account; a download takes the
// person's own API token), Thingiverse (an app token) and Cults3D (the
// person's user name and API key; Cults keeps its files on its site, so a
// Cults hit is a page to open, not a file to take). Tokens come from the
// Keychain or the secrets file (secrets.js) and never appear in an answer.
// Thumbnails are fetched here and handed on as data, so the page itself
// reaches no third-party server.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { take } from './catalog.js'
import { zipStore } from './zip.js'
import { getSecret } from './secrets.js'
import { home } from './slicer.js'

export const LIBRARIES = {
  sketchfab: { label: 'Sketchfab', account: 'catalog:sketchfab', secret: 'your API token (sketchfab.com → Settings → Password & API) — only to download; search needs none', needsKeyToSearch: false, files: true },
  thingiverse: { label: 'Thingiverse', account: 'catalog:thingiverse', secret: 'an app token (thingiverse.com/developers → create an app → App Token)', needsKeyToSearch: true, files: true },
  cults3d: { label: 'Cults3D', account: 'catalog:cults3d', secret: 'your user name and API key as user:key (cults3d.com → your account → API)', needsKeyToSearch: true, files: false },
  polyhaven: { label: 'Poly Haven', account: null, secret: null, needsKeyToSearch: false, files: true },
}

const setUp = (id) => `node mcp/src/extras/secrets.js set ${LIBRARIES[id].account}`

const PER = 12

/** A library's API address — its own unless SCANRULER_<LIBRARY>_API names
 *  another (a proxy, or a stand-in for tests). */
const api = (env, id, own) => (env[`SCANRULER_${id.toUpperCase()}_API`] ?? own).replace(/\/$/, '')
const THUMB_MAX = 200_000

/** Thrown when the page cancels: not an error to report. */
export class Cancelled extends Error {
  constructor() {
    super('Cancelled.')
    this.cancelled = true
  }
}

async function http(url, { headers = {}, method = 'GET', body, timeoutMs = 15_000, as = 'json', signal } = {}) {
  if (signal?.aborted) throw new Cancelled()
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  const stop = () => ctl.abort()
  signal?.addEventListener('abort', stop, { once: true })
  try {
    const r = await fetch(url, { method, headers: { 'User-Agent': 'ScanRuler catalog (scanruler-mcp)', Accept: as === 'json' ? 'application/json' : '*/*', ...headers }, body, signal: ctl.signal, redirect: 'follow' })
    if (r.status === 403 && /challenge/i.test(r.headers.get('cf-mitigated') ?? '')) throw Object.assign(new Error(`${new URL(url).host} is asking for a browser check (Cloudflare) and its API can't answer through it now — try again later, or search the others.`), { ours: true })
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error(`${new URL(url).host} refused the key (${r.status}) — check it is set and current.`), { ours: true })
    if (r.status === 429) throw Object.assign(new Error(`${new URL(url).host} asks to slow down (429): try again in a minute.`), { ours: true })
    if (!r.ok) throw Object.assign(new Error(`${new URL(url).host} answered ${r.status}.`), { ours: true })
    if (as !== 'json') return new Uint8Array(await r.arrayBuffer())
    const text = await r.text()
    try {
      return JSON.parse(text)
    } catch {
      throw Object.assign(new Error(`${new URL(url).host} answered with a page, not data — it may be down or changed its API.`), { ours: true })
    }
  } catch (e) {
    if (signal?.aborted) throw new Cancelled()
    if (e.ours || e instanceof Cancelled) throw e
    if (e.name === 'AbortError') throw new Error(`${new URL(url).host} did not answer in ${timeoutMs / 1000} s.`)
    // Never the fetch's own words past a network code: a bad header's
    // message quotes the header, and the header is the key.
    if (e instanceof TypeError && typeof e.cause?.code === 'string') throw new Error(`${new URL(url).host} could not be reached — check this computer is online (${e.cause.code}).`)
    if (/^\S+ (refused the key|asks to slow down|answered \d+)/.test(e.message ?? '')) throw e
    throw new Error(`${new URL(url).host}: the request could not be made — check the library's key is set right (it is not shown here).`)
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', stop)
  }
}

/** A thumbnail as a data URL, or null: fetched here, so the page reaches no
 *  third-party server for it. */
async function thumb(url, signal, timeoutMs = 8000, local = false) {
  if (typeof url !== 'string' || !(/^https:\/\//.test(url) || (local && /^http:\/\/127\.0\.0\.1[:/]/.test(url)))) return null
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  const stop = () => ctl.abort()
  signal?.addEventListener('abort', stop, { once: true })
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'ScanRuler catalog (scanruler-mcp)' }, signal: ctl.signal, redirect: 'follow' })
    // A picture only, from a web page only, and small: read no further.
    if (!r.ok || !/^https:/.test(r.url || url) && !local) return null
    if (!/^image\//i.test(r.headers.get('content-type') ?? 'image/')) return null
    if (Number(r.headers.get('content-length') ?? 0) > THUMB_MAX) return null
    const parts = []
    let n = 0
    for await (const c of r.body ?? []) {
      n += c.length
      if (n > THUMB_MAX) {
        ctl.abort()
        return null
      }
      parts.push(c)
    }
    const b = Buffer.concat(parts)
    const type = b[0] === 0x89 ? 'image/png' : b[0] === 0x52 ? 'image/webp' : 'image/jpeg'
    return `data:${type};base64,${b.toString('base64')}`
  } catch {
    return null
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', stop)
  }
}

/** Whether a licence lets the file be passed on (library-pack reads this):
 *  Creative Commons and public domain do — but not a no-derivatives one, as
 *  a part changed for a project is a derivative; anything else, as far as
 *  this can tell, does not. */
export const mayShare = (licence) => {
  const l = String(licence ?? '').trim()
  return /^(creative commons|cc[\s-]|cc0|cc by|public domain)/i.test(l) && !/\bnd\b|no.?deriv|\bnot\b|\bno\b/i.test(l)
}

const sketchfab = {
  async search(query, page, secret, env, signal, cursor) {
    const u = new URL(`${api(env, 'sketchfab', 'https://api.sketchfab.com')}/v3/search`)
    // Sketchfab pages by an opaque cursor its answer gives (cursors.next);
    // a numeric offset only where no cursor was kept.
    const at = typeof cursor === 'string' && cursor ? cursor : page > 1 ? String((page - 1) * PER) : null
    u.search = new URLSearchParams({ type: 'models', q: query, downloadable: 'true', count: String(PER), ...(at ? { cursor: at } : {}) }).toString()
    const d = await http(u.toString(), { signal, ...(secret ? { headers: { Authorization: `Token ${secret}` } } : {}) })
    const next = typeof d.cursors?.next === 'string' ? d.cursors.next : typeof d.next === 'string' ? (new URL(d.next, u).searchParams.get('cursor') ?? null) : null
    return Object.assign((d.results ?? []).map((m) => ({
      source: 'sketchfab',
      id: m.uid,
      name: m.name,
      author: m.user?.displayName ?? m.user?.username ?? null,
      licence: m.license?.label ?? m.license?.fullName ?? null,
      url: m.viewerUrl ?? `https://sketchfab.com/3d-models/${m.uid}`,
      thumbnail: [...(m.thumbnails?.images ?? [])].sort((a, b) => a.width - b.width).find((i) => i.width >= 200)?.url ?? null,
      downloadable: m.isDownloadable !== false,
      faces: m.faceCount ?? null,
    })), { next })
  },
  async files(id, secret, env, signal) {
    if (!secret) throw new Error(`A Sketchfab download takes your API token: ${setUp('sketchfab')}`)
    const base = api(env, 'sketchfab', 'https://api.sketchfab.com')
    const d = await http(`${base}/v3/models/${encodeURIComponent(id)}/download`, { headers: { Authorization: `Token ${secret}` }, signal })
    const meta = await http(`${base}/v3/models/${encodeURIComponent(id)}`, { headers: { Authorization: `Token ${secret}` }, signal }).catch((e) => {
      if (e.cancelled) throw e
      return {}
    })
    const order = ['glb', 'gltf', 'source']
    return {
      licence: meta.license?.label ?? null,
      url: meta.viewerUrl ?? null,
      files: order.filter((k) => d[k]?.url).map((k) => ({ id: k, name: k === 'glb' ? `${id}.glb` : k === 'gltf' ? `${id}-gltf.zip` : `${id}-source.zip`, size: d[k].size ?? null, format: k === 'source' ? 'as uploaded (zip)' : k })),
      fetch: (fileId) => {
        if (!d[fileId]?.url) throw new Error(`Sketchfab model ${id} has no ${fileId} file.`)
        return http(d[fileId].url, { as: 'bytes', timeoutMs: 120_000, signal })
      },
    }
  },
}

const thingiverse = {
  async search(query, page, secret, env, signal) {
    if (!secret) throw Object.assign(new Error('needs a key'), { missing: true })
    const u = new URL(`${api(env, 'thingiverse', 'https://api.thingiverse.com')}/search/${encodeURIComponent(query)}/`)
    u.search = new URLSearchParams({ type: 'things', per_page: String(PER), page: String(page), sort: 'relevant' }).toString()
    const d = await http(u.toString(), { headers: { Authorization: `Bearer ${secret}` }, signal })
    const hits = Array.isArray(d) ? d : (d.hits ?? [])
    return hits.map((t) => ({ source: 'thingiverse', id: String(t.id), name: t.name, author: t.creator?.name ?? null, licence: t.license ?? null, url: t.public_url, thumbnail: t.preview_image ?? t.thumbnail ?? null, downloadable: true }))
  },
  async files(id, secret, env, signal) {
    if (!secret) throw new Error(`Thingiverse takes an app token: ${setUp('thingiverse')}`)
    const h = { headers: { Authorization: `Bearer ${secret}` }, signal }
    const base = api(env, 'thingiverse', 'https://api.thingiverse.com')
    const [thing, files] = await Promise.all([http(`${base}/things/${encodeURIComponent(id)}`, h), http(`${base}/things/${encodeURIComponent(id)}/files`, h)])
    const list = (Array.isArray(files) ? files : []).filter((f) => f && f.id != null).map((f) => {
      const name = typeof f.name === 'string' && f.name.trim() ? f.name : `file-${f.id}`
      return { id: String(f.id), name, size: Number.isFinite(f.size) ? f.size : null, format: (name.split('.').pop() ?? '').toLowerCase(), download: f.download_url ?? f.public_url }
    })
    return {
      licence: thing.license ?? null,
      url: thing.public_url ?? null,
      files: list.map(({ download, ...f }) => f),
      fetch: (fileId) => {
        const f = list.find((x) => x.id === fileId)
        if (!f?.download) throw new Error(`Thing ${id} has no file ${fileId}.`)
        // The token goes to Thingiverse's own API only, never to another
        // host a file address names.
        const same = (() => {
          try {
            return new URL(f.download).host === new URL(base).host
          } catch {
            return false
          }
        })()
        return http(f.download, { ...(same ? h : { signal }), as: 'bytes', timeoutMs: 120_000 })
      },
    }
  },
}

const cults3d = {
  async search(query, page, secret, env, signal) {
    if (!secret || !secret.includes(':')) throw Object.assign(new Error('needs a key'), { missing: true })
    const q = `query($q: String!, $n: Int!, $o: Int!) { creationsSearchBatch(query: $q, limit: $n, offset: $o) { total results { slug name(locale: EN) url(locale: EN) illustrationImageUrl creator { nick } license { name(locale: EN) } price(currency: USD) { cents } } } }`
    const d = await http(`${api(env, 'cults3d', 'https://cults3d.com')}/graphql`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(secret).toString('base64')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, variables: { q: query, n: PER, o: (page - 1) * PER } }), signal })
    if (d.errors?.length) throw new Error(`Cults3D: ${d.errors[0].message}`)
    return (d.data?.creationsSearchBatch?.results ?? []).map((c) => ({ source: 'cults3d', id: c.slug, name: c.name, author: c.creator?.nick ?? null, licence: c.license?.name ?? null, url: c.url, thumbnail: c.illustrationImageUrl ?? null, downloadable: false, price: c.price?.cents ? `$${(c.price.cents / 100).toFixed(2)}` : 'free' }))
  },
  async files() {
    throw new Error('Cults3D keeps its files on its site: open the page and download there; catalog_watch brings the file in.')
  },
}

/** Poly Haven: CC0 models, no account, its own public API — the whole
 *  list asked once and searched here (it has no search of its own), each
 *  model a glTF with its buffers and textures. Credit "Powered by Poly
 *  Haven" where its models are shown. */
const polyhaven = {
  list: null,
  async all(env, signal) {
    const base = api(env, 'polyhaven', 'https://api.polyhaven.com')
    if (this.list && this.list.base === base && Date.now() - this.list.at < 3_600_000) return this.list.items
    const d = await http(`${base}/assets?type=models`, { signal, timeoutMs: 20_000 })
    const items = Object.entries(d && typeof d === 'object' ? d : {}).map(([id, a]) => ({ id, ...(a && typeof a === 'object' ? a : {}) }))
    this.list = { base, at: Date.now(), items }
    return items
  },
  async search(query, page, _secret, env, signal) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const text = (a) => [a.id, a.name, ...(Array.isArray(a.tags) ? a.tags : []), ...(Array.isArray(a.categories) ? a.categories : [])].join(' ').toLowerCase()
    const hits = (await this.all(env, signal)).filter((a) => words.every((w) => text(a).includes(w)))
    hits.sort((a, b) => (b.download_count ?? 0) - (a.download_count ?? 0))
    return hits.slice((page - 1) * PER, page * PER).map((a) => ({
      source: 'polyhaven',
      id: String(a.id),
      name: typeof a.name === 'string' ? a.name : String(a.id),
      author: a.authors && typeof a.authors === 'object' ? Object.keys(a.authors).join(', ') || null : null,
      licence: 'CC0 (Poly Haven)',
      url: `https://polyhaven.com/a/${encodeURIComponent(a.id)}`,
      thumbnail: typeof a.thumbnail_url === 'string' ? a.thumbnail_url : `https://cdn.polyhaven.com/asset_img/thumbs/${encodeURIComponent(a.id)}.png?width=256&height=256`,
      downloadable: true,
    }))
  },
  async files(id, _secret, env, signal) {
    const base = api(env, 'polyhaven', 'https://api.polyhaven.com')
    const d = await http(`${base}/files/${encodeURIComponent(id)}`, { signal })
    // The glTF at each resolution offered, smallest textures first: the shape
    // is the same, only the pictures grow.
    const gltf = d?.gltf && typeof d.gltf === 'object' ? d.gltf : {}
    const sizes = Object.keys(gltf).sort((a, b) => parseInt(a) - parseInt(b))
    const files = sizes.filter((k) => gltf[k]?.gltf?.url).map((k) => {
      const g = gltf[k].gltf
      const extra = Object.values(g.include ?? {}).reduce((s, f) => s + (Number(f?.size) || 0), 0)
      return { id: `gltf-${k}`, name: `${id}_${k}.zip`, size: (Number(g.size) || 0) + extra || null, format: `gltf, ${k} textures (zip)` }
    })
    return {
      licence: 'CC0 (Poly Haven)',
      url: `https://polyhaven.com/a/${encodeURIComponent(id)}`,
      files,
      fetch: async (fileId) => {
        const k = String(fileId).replace(/^gltf-/, '')
        const g = gltf[k]?.gltf
        if (!g?.url) throw new Error(`Poly Haven model ${id} has no ${fileId}.`)
        // The glTF and everything it names, kept at the paths it names them
        // by, in one zip the take unpacks into a folder of its own.
        const entries = [{ name: g.url.split('/').pop().split('?')[0], data: await http(g.url, { as: 'bytes', timeoutMs: 120_000, signal }) }]
        for (const [path, f] of Object.entries(g.include ?? {})) {
          if (!f?.url || /(^|\/)\.\.(\/|$)/.test(path)) continue
          entries.push({ name: path, data: await http(f.url, { as: 'bytes', timeoutMs: 120_000, signal }) })
        }
        return zipStore(entries)
      },
    }
  },
}

const PROVIDERS = { sketchfab, thingiverse, cults3d, polyhaven }

/** Which libraries are set up, never the key itself. */
export async function librariesStatus(env = process.env) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(LIBRARIES).map(async ([id, l]) => {
        const has = l.account ? (await getSecret(l.account, env).catch(() => null)) !== null : false
        if (!l.account) return [id, { label: l.label, key: 'none needed', search: true, download: l.files }]
        return [id, { label: l.label, key: has ? 'set' : 'not set', search: has || !l.needsKeyToSearch, download: l.files && has, ...(has ? {} : { setUp: `${l.secret}: ${setUp(id)}` }) }]
      }),
    ),
  )
}

/** A promise, or an error marked late once ms pass; the loser's outcome is
 *  dropped, so neither is left to reject unheard. */
function within(promise, ms, what) {
  let timer
  const late = new Promise((_, no) => {
    timer = setTimeout(() => no(Object.assign(new Error(what), { late: true })), ms)
  })
  promise.catch(() => {})
  late.catch(() => {})
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

/** How long a search waits for the slowest library, and then for the
 *  pictures, before answering with what it has. */
export const SEARCH_DEADLINE_MS = 20_000
export const THUMBS_DEADLINE_MS = 6_000

/** Search the libraries asked for (all by default) at once. Each answers
 *  on its own: one failing, slow or without its key leaves the rest. The
 *  whole search answers within SEARCH_DEADLINE_MS + THUMBS_DEADLINE_MS;
 *  a library past its time is named in errors, a missing picture is left
 *  out. signal (the page's Cancel) stops it all. */
export async function searchModels({ query, sources, page = 1, thumbnails = true, signal, cursors = {}, deadlineMs = SEARCH_DEADLINE_MS, thumbsMs = THUMBS_DEADLINE_MS } = {}, env = process.env) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('Say what to search for.')
  if (signal?.aborted) throw new Cancelled()
  const asked = Array.isArray(sources) ? sources : typeof sources === 'string' ? [sources] : []
  const unknown = asked.map(String).filter((s) => !Object.hasOwn(LIBRARIES, s))
  const ids = [...new Set((asked.length ? asked : Object.keys(LIBRARIES)).map(String))].filter((s) => Object.hasOwn(LIBRARIES, s))
  if (!ids.length) throw new Error(`No library to search — ${Object.keys(LIBRARIES).join(', ')}.`)
  const pageNo = Math.max(1, Math.min(50, Number(page) | 0 || 1))
  const local = Object.keys(env).some((k) => /^SCANRULER_\w+_API$/.test(k))
  const results = []
  const missing = {}
  const errors = Object.fromEntries(unknown.map((s) => [s, `no library "${s}" — ${Object.keys(LIBRARIES).join(', ')}`]))
  const next = {}
  await Promise.all(
    ids.map(async (id) => {
      const ctl = new AbortController()
      const stop = () => ctl.abort()
      signal?.addEventListener('abort', stop, { once: true })
      try {
        const key = async () => {
          if (!LIBRARIES[id].account) return null
          try {
            return await getSecret(LIBRARIES[id].account, env)
          } catch (e) {
            // A library that searches without a key still does.
            if (!LIBRARIES[id].needsKeyToSearch) return null
            throw e
          }
        }
        const going = (async () => PROVIDERS[id].search(query.trim().slice(0, 200), pageNo, await key(), env, ctl.signal, typeof cursors?.[id] === 'string' ? cursors[id].slice(0, 200) : undefined))()
        const hits = await within(going, deadlineMs, `did not answer in ${Math.round(deadlineMs / 1000)} s — it may be down or slow; try again, or search the others`)
        if (typeof hits?.next === 'string') next[id] = hits.next
        results.push(...(Array.isArray(hits) ? hits.filter((h) => h && typeof h.id === 'string' && h.id && typeof h.name === 'string').map((h) => ({ ...h, name: h.name.slice(0, 300), url: /^https?:\/\//i.test(h.url ?? '') ? h.url : null })) : []))
      } catch (e) {
        if (e.late) ctl.abort()
        if (signal?.aborted) return
        if (e.missing) missing[id] = `${LIBRARIES[id].secret}: ${setUp(id)}`
        else errors[id] = String(e.message ?? e).slice(0, 200)
      } finally {
        signal?.removeEventListener('abort', stop)
      }
    }),
  )
  if (signal?.aborted) throw new Cancelled()
  // Interleaved, so no one library fills the first screen.
  const by = ids.map((id) => results.filter((r) => r.source === id))
  const mixed = []
  for (let i = 0; by.some((l) => i < l.length); i++) for (const l of by) if (l[i]) mixed.push(l[i])
  if (thumbnails) await Promise.all(mixed.map(async (r) => (r.thumbnail = await thumb(r.thumbnail, signal, thumbsMs, local))))
  if (signal?.aborted) throw new Cancelled()
  return { query: query.trim(), page: pageNo, results: mixed, ...(Object.keys(next).length ? { cursors: next } : {}), ...(Object.keys(missing).length ? { missing } : {}), ...(Object.keys(errors).length ? { errors } : {}) }
}

/** A model's files, to pick one to take. */
export async function modelFiles({ source, id, signal } = {}, env = process.env) {
  if (!Object.hasOwn(LIBRARIES, String(source))) throw new Error(`No library "${source}" — ${Object.keys(LIBRARIES).join(', ')}.`)
  if (id === undefined || id === null || !String(id).trim()) throw new Error('Name the model (id), from a search.')
  const r = await PROVIDERS[source].files(String(id), LIBRARIES[source].account ? await getSecret(LIBRARIES[source].account, env) : null, env, signal)
  return { source, id: String(id), licence: r.licence, url: r.url, files: r.files }
}

/** A model's file brought into the imports folder (unpacked if a zip), with
 *  its source, page and licence in the provenance ledger beside it. */
export async function takeModel({ source, id, file, to, signal } = {}, env = process.env) {
  if (!Object.hasOwn(LIBRARIES, String(source))) throw new Error(`No library "${source}" — ${Object.keys(LIBRARIES).join(', ')}.`)
  if (id === undefined || id === null || !String(id).trim()) throw new Error('Name the model (id), from a search.')
  const r = await PROVIDERS[source].files(String(id), LIBRARIES[source].account ? await getSecret(LIBRARIES[source].account, env) : null, env, signal)
  const ids = r.files.map((f) => f.id).join(', ') || 'none'
  let pick
  if (file !== undefined && file !== null && String(file) !== '') {
    pick = r.files.find((f) => f.id === String(file))
    if (!pick) throw new Error(`${LIBRARIES[source].label} model ${id} has no file "${file}" — its files: ${ids}.`)
  } else {
    // The first file this takes: a CAD file or a zip, not a README.
    pick = r.files.find((f) => /\.(stl|step|stp|3mf|obj|ply|glb|gltf|fbx|3ds|dae|amf|wrl|iges|igs|blend|zip)$/i.test(f.name)) ?? r.files[0]
  }
  if (!pick) throw new Error(`${LIBRARIES[source].label} model ${id} has no file to download.`)
  const bytes = await r.fetch(pick.id)
  if (signal?.aborted) throw new Cancelled()
  const safe = pick.name.replace(/[^\w.() -]+/g, '_').replace(/^\.+/, '') || `${source}-${id}`
  // A folder of its own for each take: two at once never share a name.
  const root = join(home(env), 'downloads')
  await mkdir(root, { recursive: true })
  const stage = await mkdtemp(join(root, `${source}-`))
  try {
    const path = join(stage, safe)
    await writeFile(path, bytes)
    if (signal?.aborted) throw new Cancelled()
    const got = await take({ file: path, to, source, url: r.url ?? undefined, licence: r.licence ?? undefined, redistribute: mayShare(r.licence) }, env)
    return { ...got, source, id: String(id), file: pick.name, licence: r.licence, url: r.url, redistribute: mayShare(r.licence) }
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => {})
  }
}
