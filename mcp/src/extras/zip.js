// SPDX-License-Identifier: AGPL-3.0-only
// Read one entry out of a zip archive (a .3mf): the central directory is
// read from the end of the file, the entry inflated with Node's own zlib.
// Enough for a slicer's project file; no dependency.

import { readFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

/** The most one entry may inflate to: a zip bomb stops here. */
export const MAX_ENTRY_BYTES = 1024 * 1024 * 1024

export async function zipEntries(path, { maxEntryBytes = MAX_ENTRY_BYTES } = {}) {
  const buf = await readFile(path)
  try {
    return entriesOf(buf, path, maxEntryBytes)
  } catch (e) {
    if (e instanceof RangeError) throw new Error(`${path} is not a readable zip (cut short or damaged).`)
    throw e
  }
}

function entriesOf(buf, path, maxEntryBytes) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  if (eocd < 0) throw new Error(`${path} is not a zip archive.`)
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  const entries = []
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) break
    const flags = buf.readUInt16LE(at + 8)
    const method = buf.readUInt16LE(at + 10)
    const size = buf.readUInt32LE(at + 20)
    const uncompressed = buf.readUInt32LE(at + 24)
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen)
    entries.push({ name, method, size, uncompressed, local, encrypted: (flags & 1) === 1 })
    at += 46 + nameLen + extraLen + commentLen
  }
  const read = (entry) => {
    if (entry.encrypted) throw new Error(`${entry.name} is locked with a password in the zip: unzip it yourself and take the file.`)
    if (entry.uncompressed > maxEntryBytes) throw new Error(`${entry.name} would unpack to ${Math.round(entry.uncompressed / 2 ** 20)} MB — more than this takes from a zip.`)
    const l = entry.local
    if (l + 30 > buf.length) throw new Error(`${path} is not a readable zip (cut short or damaged).`)
    const nameLen = buf.readUInt16LE(l + 26), extraLen = buf.readUInt16LE(l + 28)
    const start = l + 30 + nameLen + extraLen
    const data = buf.subarray(start, start + entry.size)
    if (entry.method === 0) return Buffer.from(data)
    if (entry.method === 8) {
      try {
        return inflateRawSync(data, { maxOutputLength: Math.min(maxEntryBytes, Math.max(entry.uncompressed, 1)) })
      } catch (e) {
        if (e.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|larger than/i.test(e.message)) throw new Error(`${entry.name} unpacks to more than its zip says (or more than this takes) — not taken.`)
        throw new Error(`${entry.name} could not be unpacked: the zip is damaged.`)
      }
    }
    throw new Error(`${entry.name}: compression method ${entry.method} is not read.`)
  }
  return { entries, read }
}
