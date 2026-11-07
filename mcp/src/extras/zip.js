// SPDX-License-Identifier: AGPL-3.0-only
// Read one entry out of a zip archive (a .3mf): the central directory is
// read from the end of the file, the entry inflated with Node's own zlib.
// Enough for a slicer's project file; no dependency.

import { readFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

export async function zipEntries(path) {
  const buf = await readFile(path)
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
    const method = buf.readUInt16LE(at + 10)
    const size = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen)
    entries.push({ name, method, size, local })
    at += 46 + nameLen + extraLen + commentLen
  }
  const read = (entry) => {
    const l = entry.local
    const nameLen = buf.readUInt16LE(l + 26), extraLen = buf.readUInt16LE(l + 28)
    const start = l + 30 + nameLen + extraLen
    const data = buf.subarray(start, start + entry.size)
    if (entry.method === 0) return Buffer.from(data)
    if (entry.method === 8) return inflateRawSync(data)
    throw new Error(`${entry.name}: compression method ${entry.method} is not read.`)
  }
  return { entries, read }
}
