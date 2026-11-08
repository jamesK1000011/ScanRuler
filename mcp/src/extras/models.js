// SPDX-License-Identifier: AGPL-3.0-only
// 3D model libraries searched through their official APIs, from this
// computer: Sketchfab (search needs no account; a download takes the
// person's own API token), Thingiverse (an app token) and Cults3D (the
// person's user name and API key; Cults keeps its files on its site, so a
// Cults hit is a page to open, not a file to take). Tokens come from the
// Keychain or the secrets file (secrets.js) and never appear in an answer.
// Thumbnails are fetched here and handed on as data, so the page itself
// reaches no third-party server.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { take } from './catalog.js'
import { getSecret } from './secrets.js'
import { home } from './slicer.js'

export const LIBRARIES = {
  sketchfab: { label: 'Sketchfab', account: 'catalog:sketchfab', secret: 'your API token (sketchfab.com → Settings → Password & API) — only to download; search needs none', needsKeyToSearch: false, files: true },
  thingiverse: { label: 'Thingiverse', account: 'catalog:thingiverse', secret: 'an app token (thingiverse.com/developers → create an app → App Token)', needsKeyToSearch: true, files: true },
  cults3d: { label: 'Cults3D', account: 'catalog:cults3d', secret: 'your user name and API key as user:key (cults3d.com → your account → API)', needsKeyToSearch: true, files: false },
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
    if (r.status === 401 || r.status === 403) throw new Error(`${new URL(url).host} refused the key (${r.status}) — check it is set and current.`)
    if (r.status === 429) throw new Error(`${new URL(url).host} asks to slow down (429): try again in a minute.`)
    if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}.`)
    return as === 'json' ? await r.json() : new Uint8Array(await r.arrayBuffer())
  } catch (e) {
    if (signal?.aborted) throw new Cancelled()
    if (e.name === 'AbortError') throw new Error(`${new URL(url).host} did not answer in ${timeoutMs / 1000} s.`)
    if (e instanceof TypeError) throw new Error(`${new URL(url).host} could not be reached — check this computer is online (${String(e.cause?.code ?? e.message).slice(0, 60)}).`)
    throw e
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', stop)
  }
}

/** A thumbnail as a data URL, or null: fetched here, so the page reaches no
 *  third-party server for it. */
async function thumb(url, signal, timeoutMs = 8000) {
  if (!url || !/^(https:\/\/|http:\/\/127\.0\.0\.1[:/])/.test(url)) return null
  try {
    const b = await http(url, { as: 'bytes', timeoutMs, signal })
    if (b.length > THUMB_MAX) return null
    const type = b[0] === 0x89 ? 'image/png' : b[0] === 0x52 ? 'image/webp' : 'image/jpeg'
    return `data:${type};base64,${Buffer.from(b).toString('base64')}`
  } catch {
    return null
  }
}

/** Whether a licence lets the file be passed on (library-pack reads this):
 *  Creative Commons and public domain do; anything else, as far as this can
 *  tell, does not. */
export const mayShare = (licence) => /creative commons|^cc[\s-]|cc0|public domain/i.test(licence ?? '')

const sketchfab = {
  async search(query, page, secret, env, signal) {
    const u = new URL(`${api(env, 'sketchfab', 'https://api.sketchfab.com')}/v3/search`)
    u.search = new URLSearchParams({ type: 'models', q: query, downloadable: 'true', count: String(PER), ...(page > 1 ? { cursor: String((page - 1) * PER) } : {}) }).toString()
    const d = await http(u.toString(), { signal, ...(secret ? { headers: { Authorization: `Token ${secret}` } } : {}) })
    return (d.results ?? []).map((m) => ({
      source: 'sketchfab',
      id: m.uid,
      name: m.name,
      author: m.user?.displayName ?? m.user?.username ?? null,
      licence: m.license?.label ?? m.license?.fullName ?? null,
      url: m.viewerUrl ?? `https://sketchfab.com/3d-models/${m.uid}`,
      thumbnail: [...(m.thumbnails?.images ?? [])].sort((a, b) => a.width - b.width).find((i) => i.width >= 200)?.url ?? null,
      downloadable: m.isDownloadable !== false,
      faces: m.faceCount ?? null,
    }))
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
    const list = (Array.isArray(files) ? files : []).map((f) => ({ id: String(f.id), name: f.name, size: f.size ?? null, format: (f.name.split('.').pop() ?? '').toLowerCase(), download: f.download_url ?? f.public_url }))
    return {
      licence: thing.license ?? null,
      url: thing.public_url ?? null,
      files: list.map(({ download, ...f }) => f),
      fetch: (fileId) => {
        const f = list.find((x) => x.id === fileId)
        if (!f?.download) throw new Error(`Thing ${id} has no file ${fileId}.`)
        return http(f.download, { ...h, as: 'bytes', timeoutMs: 120_000 })
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

const PROVIDERS = { sketchfab, thingiverse, cults3d }

/** Which libraries are set up, never the key itself. */
export async function librariesStatus(env = process.env) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(LIBRARIES).map(async ([id, l]) => {
        const has = (await getSecret(l.account, env)) !== null
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
export async function searchModels({ query, sources, page = 1, thumbnails = true, signal, deadlineMs = SEARCH_DEADLINE_MS, thumbsMs = THUMBS_DEADLINE_MS } = {}, env = process.env) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('Say what to search for.')
  const ids = (sources?.length ? sources : Object.keys(LIBRARIES)).filter((s) => s in LIBRARIES)
  if (!ids.length) throw new Error(`No library to search — ${Object.keys(LIBRARIES).join(', ')}.`)
  const results = []
  const missing = {}
  const errors = {}
  await Promise.all(
    ids.map(async (id) => {
      const ctl = new AbortController()
      const stop = () => ctl.abort()
      signal?.addEventListener('abort', stop, { once: true })
      try {
        const asked = (async () => PROVIDERS[id].search(query.trim().slice(0, 200), Math.max(1, Math.min(50, page | 0)), await getSecret(LIBRARIES[id].account, env), env, ctl.signal))()
        const hits = await within(asked, deadlineMs, `did not answer in ${Math.round(deadlineMs / 1000)} s — it may be down or slow; try again, or search the others`)
        results.push(...hits)
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
  if (thumbnails) await Promise.all(mixed.map(async (r) => (r.thumbnail = await thumb(r.thumbnail, signal, thumbsMs))))
  if (signal?.aborted) throw new Cancelled()
  return { query: query.trim(), page, results: mixed, ...(Object.keys(missing).length ? { missing } : {}), ...(Object.keys(errors).length ? { errors } : {}) }
}

/** A model's files, to pick one to take. */
export async function modelFiles({ source, id, signal } = {}, env = process.env) {
  if (!(source in LIBRARIES)) throw new Error(`No library "${source}" — ${Object.keys(LIBRARIES).join(', ')}.`)
  const r = await PROVIDERS[source].files(String(id), await getSecret(LIBRARIES[source].account, env), env, signal)
  return { source, id: String(id), licence: r.licence, url: r.url, files: r.files }
}

/** A model's file brought into the imports folder (unpacked if a zip), with
 *  its source, page and licence in the provenance ledger beside it. */
export async function takeModel({ source, id, file, to, signal } = {}, env = process.env) {
  if (!(source in LIBRARIES)) throw new Error(`No library "${source}".`)
  const r = await PROVIDERS[source].files(String(id), await getSecret(LIBRARIES[source].account, env), env, signal)
  const pick = r.files.find((f) => f.id === String(file ?? '')) ?? r.files[0]
  if (!pick) throw new Error(`${LIBRARIES[source].label} model ${id} has no file to download.`)
  const bytes = await r.fetch(pick.id)
  if (signal?.aborted) throw new Cancelled()
  const stage = join(home(env), 'downloads', source)
  await mkdir(stage, { recursive: true })
  const path = join(stage, pick.name.replace(/[^\w.() -]+/g, '_'))
  await writeFile(path, bytes)
  const got = await take({ file: path, to, source, url: r.url ?? undefined, licence: r.licence ?? undefined, redistribute: mayShare(r.licence) }, env)
  return { ...got, source, id: String(id), file: pick.name, licence: r.licence, url: r.url, redistribute: mayShare(r.licence) }
}
