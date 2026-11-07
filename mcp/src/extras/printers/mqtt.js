// SPDX-License-Identifier: AGPL-3.0-only
// Just enough MQTT 3.1.1 over TLS to talk to a printer on the LAN: connect
// with a username and password, subscribe, publish at QoS 0, and hear what
// comes back. No library: the protocol is small and this is all of it used.

import { EventEmitter } from 'node:events'
import tls from 'node:tls'

const str = (s) => {
  const b = Buffer.from(String(s), 'utf8')
  const len = Buffer.alloc(2)
  len.writeUInt16BE(b.length)
  return Buffer.concat([len, b])
}

function remaining(n) {
  const out = []
  do {
    let byte = n % 128
    n = Math.floor(n / 128)
    if (n > 0) byte |= 0x80
    out.push(byte)
  } while (n > 0)
  return Buffer.from(out)
}

export const packet = (type, body) => Buffer.concat([Buffer.from([type]), remaining(body.length), body])

/** Whole packets off the front of a buffer: { type, flags, body }[] and what is left. */
export function parse(buf) {
  const out = []
  let i = 0
  for (;;) {
    if (buf.length - i < 2) break
    let mult = 1
    let len = 0
    let j = i + 1
    let byte
    do {
      if (j >= buf.length) return { packets: out, rest: buf.subarray(i) }
      byte = buf[j++]
      len += (byte & 0x7f) * mult
      mult *= 128
    } while (byte & 0x80)
    if (buf.length < j + len) break
    out.push({ type: buf[i] >> 4, flags: buf[i] & 0x0f, body: buf.subarray(j, j + len) })
    i = j + len
  }
  return { packets: out, rest: buf.subarray(i) }
}

export function connectPacket({ clientId, username, password, keepAlive = 60 }) {
  const flags = 0x02 | (username ? 0x80 : 0) | (password ? 0x40 : 0)
  const head = Buffer.concat([str('MQTT'), Buffer.from([4, flags, keepAlive >> 8, keepAlive & 0xff])])
  return packet(0x10, Buffer.concat([head, str(clientId), ...(username ? [str(username)] : []), ...(password ? [str(password)] : [])]))
}

export const publishPacket = (topic, payload) => packet(0x30, Buffer.concat([str(topic), Buffer.from(payload)]))
export const subscribePacket = (id, topic) => packet(0x82, Buffer.concat([Buffer.from([id >> 8, id & 0xff]), str(topic), Buffer.from([0])]))

export function readPublish(body) {
  const tl = body.readUInt16BE(0)
  return { topic: body.subarray(2, 2 + tl).toString('utf8'), payload: body.subarray(2 + tl) }
}

const CONNACK = { 1: 'the protocol version was refused', 2: 'the client id was refused', 3: 'the server is unavailable', 4: 'the username or password is wrong (the access code)', 5: 'not authorised' }

/** A connected client: emits 'message' (topic, payload). */
export class Mqtt extends EventEmitter {
  constructor(socket) {
    super()
    this.socket = socket
    this.buf = Buffer.alloc(0)
    this.nextId = 1
  }

  static connect({ host, port = 8883, username, password, tlsOptions = {}, timeoutMs = 10_000 }) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host, port, rejectUnauthorized: false, ...tlsOptions })
      const client = new Mqtt(socket)
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error(`No MQTT answer from ${host}:${port} in ${timeoutMs / 1000} s.`))
      }, timeoutMs)
      socket.once('error', (e) => {
        clearTimeout(timer)
        reject(new Error(`MQTT to ${host}:${port}: ${e.message}`))
      })
      socket.once('secureConnect', () => {
        try {
          tlsOptions.check?.(socket)
        } catch (e) {
          clearTimeout(timer)
          socket.destroy()
          reject(e)
          return
        }
        socket.write(connectPacket({ clientId: `scanruler-${Math.random().toString(36).slice(2, 10)}`, username, password }))
      })
      socket.on('data', (d) => {
        client.buf = Buffer.concat([client.buf, d])
        const { packets, rest } = parse(client.buf)
        client.buf = rest
        for (const p of packets) {
          if (p.type === 2) {
            clearTimeout(timer)
            const rc = p.body[1]
            if (rc === 0) resolve(client)
            else {
              socket.destroy()
              reject(new Error(`MQTT: ${CONNACK[rc] ?? `refused (${rc})`}.`))
            }
          } else if (p.type === 3) {
            const { topic, payload } = readPublish(p.body)
            client.emit('message', topic, payload)
          }
        }
      })
    })
  }

  subscribe(topic) {
    this.socket.write(subscribePacket(this.nextId++, topic))
  }

  publish(topic, payload) {
    this.socket.write(publishPacket(topic, typeof payload === 'string' ? payload : JSON.stringify(payload)))
  }

  /** The first message on topic that passes test, or null after timeoutMs. */
  next(topic, test = () => true, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const on = (t, payload) => {
        if (t !== topic) return
        let json
        try {
          json = JSON.parse(payload.toString('utf8'))
        } catch {
          return
        }
        if (!test(json)) return
        clearTimeout(timer)
        this.off('message', on)
        resolve(json)
      }
      const timer = setTimeout(() => {
        this.off('message', on)
        resolve(null)
      }, timeoutMs)
      this.on('message', on)
    })
  }

  end() {
    try {
      this.socket.write(Buffer.from([0xe0, 0]))
    } catch {}
    this.socket.end()
  }
}
