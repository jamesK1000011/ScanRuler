// SPDX-License-Identifier: AGPL-3.0-only
// A zip of files, stored without compression: several outputs saved as one.

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A time as a zip entry holds it: MS-DOS time and date, local time. */
export function dosTime(d: Date): { time: number; date: number } {
  const y = Math.min(Math.max(d.getFullYear(), 1980), 2107)
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }
}

export function zip(files: { name: string; bytes: Uint8Array }[], at = new Date()): Uint8Array {
  const enc = new TextEncoder()
  const when = dosTime(at)
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = enc.encode(file.name)
    const crc = crc32(file.bytes)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true)
    local.setUint16(10, when.time, true)
    local.setUint16(12, when.date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, file.bytes.length, true)
    local.setUint32(22, file.bytes.length, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, file.bytes)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(12, when.time, true)
    c.setUint16(14, when.date, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, file.bytes.length, true)
    c.setUint32(24, file.bytes.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    central.push(new Uint8Array(c.buffer), name)
    offset += 30 + name.length + file.bytes.length
  }
  const size = central.reduce((s, p) => s + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, size, true)
  end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of all) {
    out.set(p, o)
    o += p.length
  }
  return out
}
