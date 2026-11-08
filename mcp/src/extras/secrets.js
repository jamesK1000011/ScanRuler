// SPDX-License-Identifier: AGPL-3.0-only
// Credentials the person adds — a printer's access code, an API key — kept
// in the macOS Keychain, or elsewhere in a file only they can read
// (secrets.json in the ScanRuler folder, mode 600). Read here to talk to the
// device; never put in a tool's answer, a log or the repository.
//
// Add one from a terminal, where the agent never sees it:
//   node mcp/src/extras/secrets.js set printer:<name>

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SERVICE = 'scanruler'

const home = (env) => env.SCANRULER_HOME ?? join(homedir(), '.scanruler')
const useFile = (env, platform) => env.SCANRULER_SECRETS === 'file' || platform !== 'darwin'

/** A command's exit code and output. Killed after timeoutMs with code -2:
 *  `security` waits, unseen, when macOS asks the person to allow access to
 *  a Keychain item — a search that read a key then never came back. */
function run(cmd, args, timeoutMs = 0) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let timer = null
    if (timeoutMs > 0)
      timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve({ code: -2, out: '' })
      }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.on('error', () => (clearTimeout(timer), resolve({ code: -1, out: '' })))
    child.on('close', (code) => (clearTimeout(timer), resolve({ code, out })))
  })
}

/** How long a Keychain read may take before it is given up. */
export const KEYCHAIN_TIMEOUT_MS = 8_000

async function fileStore(env) {
  const f = join(home(env), 'secrets.json')
  if (!existsSync(f)) return { f, all: {} }
  let all
  try {
    all = JSON.parse(await readFile(f, 'utf8'))
  } catch {
    // Never the parser's own words: they quote the file, keys and all.
    throw new Error(`${f} is not valid JSON — fix it by hand, or delete it and set the keys again.`)
  }
  if (!all || typeof all !== 'object' || Array.isArray(all)) throw new Error(`${f} is not a list of keys — delete it and set them again.`)
  return { f, all }
}

/** A key as it is used: a string, without the spaces or newlines a paste
 *  leaves round it; anything else is no key. */
const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export async function getSecret(account, env = process.env, platform = process.platform) {
  if (useFile(env, platform)) return clean((await fileStore(env)).all[account])
  const r = await run('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w'], Number(env.SCANRULER_KEYCHAIN_TIMEOUT_MS) || KEYCHAIN_TIMEOUT_MS)
  if (r.code === -2) throw new Error(`The Keychain did not hand over "${account}" in time — macOS may be asking you to allow it: look for a Keychain window and choose Always Allow, then try again.`)
  return r.code === 0 ? clean(r.out) : null
}

export async function hasSecret(account, env = process.env, platform = process.platform) {
  return (await getSecret(account, env, platform)) !== null
}

export async function setSecret(account, value, env = process.env, platform = process.platform) {
  if (useFile(env, platform)) {
    const { f, all } = await fileStore(env)
    all[account] = value
    await mkdir(home(env), { recursive: true })
    await writeFile(f, JSON.stringify(all, null, 2), { mode: 0o600 })
    await chmod(f, 0o600)
    return { stored: 'file', where: f }
  }
  const r = await run('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', value])
  if (r.code !== 0) throw new Error('The Keychain refused it.')
  return { stored: 'keychain', where: `Keychain item "${SERVICE}", account "${account}"` }
}

export async function deleteSecret(account, env = process.env, platform = process.platform) {
  if (useFile(env, platform)) {
    const { f, all } = await fileStore(env)
    delete all[account]
    if (existsSync(f)) await writeFile(f, JSON.stringify(all, null, 2), { mode: 0o600 })
    return
  }
  await run('security', ['delete-generic-password', '-s', SERVICE, '-a', account])
}

async function ask(prompt) {
  process.stdout.write(prompt)
  const stdin = process.stdin
  if (stdin.isTTY) stdin.setRawMode(true)
  return new Promise((resolve) => {
    let v = ''
    const on = (d) => {
      for (const c of d.toString('utf8')) {
        if (c === '\r' || c === '\n') {
          stdin.off('data', on)
          if (stdin.isTTY) stdin.setRawMode(false)
          stdin.pause()
          process.stdout.write('\n')
          resolve(v)
          return
        }
        if (c === '\u0003') process.exit(130)
        if (c === '\u007f') v = v.slice(0, -1)
        else v += c
      }
    }
    stdin.resume()
    stdin.on('data', on)
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [verb, account] = process.argv.slice(2)
  if (!['set', 'has', 'delete'].includes(verb) || !account) {
    console.error('node mcp/src/extras/secrets.js set|has|delete <account>   (printer:<name>)')
    process.exit(2)
  }
  if (verb === 'set') {
    const v = await ask(`Value for ${account} (not shown): `)
    if (!v) process.exit(1)
    const r = await setSecret(account, v)
    console.log(`Stored in the ${r.where}.`)
  } else if (verb === 'has') console.log((await hasSecret(account)) ? 'yes' : 'no')
  else {
    await deleteSecret(account)
    console.log('Deleted.')
  }
}
