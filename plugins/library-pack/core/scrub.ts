// SPDX-License-Identifier: AGPL-3.0-only
// What could identify the person or open their printer, taken out of the
// files before they are shared: absolute paths and the user name in them,
// access codes, API keys, tokens and passwords, printer serial numbers and
// addresses, e-mail addresses, the author and organisation in a STEP
// header, text in an STL header, and EXIF, XMP and text chunks in pictures.
// Every change is reported.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

export interface Change {
  file: string
  what: string
  count: number
}

const SECRET_KEYS = /(access[_ -]?code|api[_ -]?key|apikey|print_?host_?apikey|token|password|passwd|secret|auth(orization)?)/i
const SERIAL_KEYS = /(serial(_?number)?|dev_?id|device_?id|printer_?sn|\bsn\b)/i
const HOST_KEYS = /(print_?host|printhost|host_?ip|ip_?address|printer_?ip|\bhost\b)/i

const PATH = /(?:[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+([^\\/"'<>\s;,]+)(?:[\\/]+[^"'<>\r\n;,]*)?|\/(?:Users|home)\/([^/"'<>\s;,]+)(?:\/[^"'<>\r\n;,]*)?)/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const PRIVATE_IP = /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g

class Tally {
  changes = new Map<string, number>()
  add(what: string, n = 1) {
    if (n > 0) this.changes.set(what, (this.changes.get(what) ?? 0) + n)
  }
}

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? ''

/** A text file scrubbed; users are the user names found in paths so far. */
export function scrubText(text: string, t: Tally, users: Set<string>): string {
  const lineKey = (key: RegExp, label: string) => {
    text = text.replace(new RegExp(`(^|[\\n;{,]\\s*["']?)([\\w .-]*${key.source}[\\w.-]*)(["']?\\s*[:=]\\s*)("([^"\\\\]|\\\\.)*"|'[^']*'|[^\\n,}\\]]*)`, 'gim'), (all, pre, k, sep, v) => {
      const bare = String(v).trim().replace(/^["']|["']$/g, '')
      if (!bare) return all
      t.add(label)
      const quoted = /^["']/.test(String(v).trim())
      return `${pre}${k}${sep}${quoted ? '""' : ''}`
    })
    text = text.replace(new RegExp(`(<[^>]*\\bkey\\s*=\\s*"[^"]*${key.source}[^"]*"[^>]*\\bvalue\\s*=\\s*")([^"]+)(")`, 'gi'), (_all, a, _v, b) => {
      t.add(label)
      return `${a}${b}`
    })
    text = text.replace(new RegExp(`(\\b[\\w-]*${key.source}[\\w-]*\\s*=\\s*")([^"]+)(")`, 'gi'), (_all, a, _v, b) => {
      t.add(label)
      return `${a}${b}`
    })
  }
  lineKey(SECRET_KEYS, 'access codes, keys, tokens or passwords emptied')
  lineKey(SERIAL_KEYS, 'printer serial numbers emptied')
  lineKey(HOST_KEYS, 'printer addresses emptied')
  text = text.replace(PATH, (m, winUser, nixUser) => {
    const u = winUser ?? nixUser
    if (u) users.add(u)
    t.add('absolute paths cut to the file name')
    return base(m)
  })
  for (const u of users)
    if (u.length > 2)
      text = text.replace(new RegExp(`\\b${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), () => {
        t.add('the user name replaced')
        return 'user'
      })
  text = text.replace(EMAIL, () => {
    t.add('e-mail addresses removed')
    return '<email>'
  })
  text = text.replace(PRIVATE_IP, () => {
    t.add('local network addresses removed')
    return '0.0.0.0'
  })
  return text
}

/** PNG: every chunk kept but text, EXIF and time (tEXt, iTXt, zTXt, eXIf, tIME). */
export function scrubPng(b: Uint8Array, t: Tally): Uint8Array {
  if (b.length < 8 || b[0] !== 0x89 || b[1] !== 0x50) return b
  const out: Uint8Array[] = [b.subarray(0, 8)]
  let i = 8
  let dropped = 0
  while (i + 8 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7])
    const end = i + 12 + len
    if (['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(type)) dropped++
    else out.push(b.subarray(i, end))
    i = end
  }
  t.add('picture text and EXIF chunks removed', dropped)
  return concat(out)
}

/** JPEG: APP1 (EXIF, XMP), APP13 (IPTC) and comments taken out. */
export function scrubJpeg(b: Uint8Array, t: Tally): Uint8Array {
  if (b[0] !== 0xff || b[1] !== 0xd8) return b
  const out: Uint8Array[] = [b.subarray(0, 2)]
  let i = 2
  let dropped = 0
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1]
    if (marker === 0xda) {
      out.push(b.subarray(i))
      break
    }
    const len = (b[i + 2] << 8) | b[i + 3]
    const seg = b.subarray(i, i + 2 + len)
    if (marker === 0xe1 || marker === 0xed || marker === 0xfe) dropped++
    else out.push(seg)
    i += 2 + len
  }
  t.add('picture EXIF, XMP and comments removed', dropped)
  return concat(out)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** STEP: FILE_NAME's name cut to the file name, author, organisation and
 *  authorisation emptied. */
export function scrubStep(text: string, t: Tally, users: Set<string>): string {
  text = text.replace(/FILE_NAME\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*\(([^)]*)\)\s*,\s*\(([^)]*)\)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/, (_all, name, stamp, author, org, pre, sys) => {
    if (author.replace(/'/g, '').trim() || org.replace(/'/g, '').trim()) t.add('STEP author and organisation emptied')
    return `FILE_NAME('${base(name)}','${stamp}',(''),(''),'${pre}','${sys}','')`
  })
  return scrubText(text, t, users)
}

/** Binary STL: the 80-byte header blanked if it holds text. ASCII STL: the
 *  solid's name made plain. */
export function scrubStl(b: Uint8Array, t: Tally): Uint8Array {
  const head = strFromU8(b.subarray(0, Math.min(80, b.length)), true)
  if (/^solid\s/i.test(head) && /facet/i.test(strFromU8(b.subarray(0, Math.min(400, b.length)), true))) {
    const text = strFromU8(b, true)
    const named = text.replace(/^solid[^\n]*/i, 'solid part').replace(/endsolid[^\n]*/gi, 'endsolid part')
    if (named !== text) t.add('the STL solid’s name made plain')
    return strToU8(named, true)
  }
  if (/[A-Za-z]{3}/.test(head)) {
    const out = new Uint8Array(b)
    out.fill(0, 0, 80)
    out.set(strToU8('library-pack', true), 0)
    t.add('the STL header blanked')
    return out
  }
  return b
}

const TEXT = /\.(gcode|txt|md|json|xml|config|ini|model|rels|html|csv|svg)$/i

export function scrubFile(name: string, bytes: Uint8Array, users: Set<string> = new Set()): { bytes: Uint8Array; changes: Change[] } {
  const t = new Tally()
  const lower = name.toLowerCase()
  let out = bytes
  if (lower.endsWith('.3mf') || lower.endsWith('.zip')) {
    const entries = unzipSync(bytes)
    const next: Record<string, Uint8Array> = {}
    const inner: Change[] = []
    for (const [path, data] of Object.entries(entries)) {
      const r = scrubFile(path, data, users)
      next[path] = r.bytes
      inner.push(...r.changes)
    }
    for (const c of inner) t.add(c.what, c.count)
    out = zipSync(next, { level: 6 })
  } else if (lower.endsWith('.png')) out = scrubPng(bytes, t)
  else if (/\.jpe?g$/.test(lower)) out = scrubJpeg(bytes, t)
  else if (lower.endsWith('.stl')) out = scrubStl(bytes, t)
  else if (/\.(step|stp)$/.test(lower)) out = strToU8(scrubStep(strFromU8(bytes, true), t, users), true)
  else if (TEXT.test(lower)) out = strToU8(scrubText(strFromU8(bytes), t, users))
  return { bytes: out, changes: [...t.changes].map(([what, count]) => ({ file: name, what, count })) }
}
