// SPDX-License-Identifier: AGPL-3.0-only
// Just enough implicit FTPS (FTP over TLS from the first byte, port 990) to
// put one file on a printer: log in, protect the data channel, passive
// mode, STOR. The data connection reuses the control connection's TLS
// session, as printers that check it require.

import tls from 'node:tls'

function lines(socket) {
  let buf = ''
  const waiting = []
  const ready = []
  socket.on('data', (d) => {
    buf += d.toString('utf8')
    let i
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 2)
      if (/^\d{3} /.test(line)) {
        const w = waiting.shift()
        if (w) w(line)
        else ready.push(line)
      }
    }
  })
  return () => new Promise((resolve) => (ready.length ? resolve(ready.shift()) : waiting.push(resolve)))
}

export async function upload({ host, port = 990, user = 'bblp', password, name, data, tlsOptions = {}, timeoutMs = 120_000 }) {
  const control = tls.connect({ host, port, rejectUnauthorized: false, ...tlsOptions })
  const fail = (m) => {
    control.destroy()
    throw new Error(`FTPS to ${host}:${port}: ${m}`)
  }
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`FTPS to ${host}:${port}: no answer in 10 s.`)), 10_000)
    control.once('secureConnect', () => {
      clearTimeout(t)
      try {
        tlsOptions.check?.(control)
        resolve()
      } catch (e) {
        control.destroy()
        reject(e)
      }
    })
    control.once('error', (e) => {
      clearTimeout(t)
      reject(new Error(`FTPS to ${host}:${port}: ${e.message}`))
    })
  })
  const next = lines(control)
  const send = async (cmd, ok) => {
    if (cmd) control.write(`${cmd}\r\n`)
    const line = await next()
    if (!ok.test(line)) fail(`${cmd ? cmd.split(' ')[0] : 'greeting'} was answered "${line}"${/^530/.test(line) ? ' — the access code is wrong' : ''}.`)
    return line
  }
  await send(null, /^220/)
  await send(`USER ${user}`, /^(331|230)/)
  await send(`PASS ${password}`, /^230/)
  await send('PBSZ 0', /^200/)
  await send('PROT P', /^200/)
  await send('TYPE I', /^200/)
  const pasv = await send('PASV', /^227/)
  const m = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(pasv)
  if (!m) fail(`PASV gave no address: "${pasv}".`)
  const dataPort = Number(m[5]) * 256 + Number(m[6])
  const session = control.getSession()
  const dataSocket = tls.connect({ host, port: dataPort, rejectUnauthorized: false, ...tlsOptions, ...(session ? { session } : {}) })
  await new Promise((resolve, reject) => {
    dataSocket.once('secureConnect', resolve)
    dataSocket.once('error', (e) => reject(new Error(`FTPS data channel: ${e.message}`)))
  })
  control.write(`STOR ${name}\r\n`)
  const started = await next()
  if (!/^(125|150)/.test(started)) {
    dataSocket.destroy()
    fail(`STOR was answered "${started}".`)
  }
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('FTPS upload timed out.')), timeoutMs)
    dataSocket.end(data, () => {
      clearTimeout(t)
      resolve()
    })
  })
  const done = await next()
  if (!/^226/.test(done)) fail(`the upload ended "${done}".`)
  control.write('QUIT\r\n')
  control.end()
  return { name, bytes: data.length }
}
