#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const staged = process.argv.includes('--staged')
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const files = execFileSync('git', staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter(Boolean)

const SKIP = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|\.(png|jpe?g|gif|webp|ico|stl|3mf|step|stp|glb|wasm|pdf|zip|woff2?|ttf|otf)$|(^|\/)licences?\//i
const FIXTURE = /(^|\/)(tests?|__tests__|fixtures)\/|(^|\/)scripts\/e2e[^/]*$|\.test\.[cm]?[jt]sx?$/
const FAKE_USERS = new Set(['alexuser', 'example', 'user', 'you', 'me', 'name', 'runner', 'someone', 'username', 'yourname', 'node', 'claude', 'shared'])

const wordsFile = process.env.SCANRULER_PRIVATE_WORDS || join(process.env.SCANRULER_HOME || join(homedir(), '.scanruler'), 'private-words.txt')
const words = existsSync(wordsFile)
  ? readFileSync(wordsFile, 'utf8').split('\n').map(w => w.trim()).filter(w => w && !w.startsWith('#'))
  : []

const rules = [
  { id: 'key-material', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'token', re: /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-ant-[A-Za-z0-9-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b/ },
  { id: 'home-path', re: /(?:\/Users\/|\/home\/|[A-Za-z]:\\\\?Users\\\\?)([A-Za-z0-9._-]+)/g, user: true },
  { id: 'private-ip', re: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/, fixtureOk: true },
  { id: 'personal-email', re: /\b[A-Za-z0-9._%+-]+@(gmail|googlemail|icloud|me|mac|outlook|hotmail|live|yahoo|proton|protonmail)\.(com|me)\b/i },
]

const hits = []
for (const file of files) {
  if (SKIP.test(file)) continue
  const path = join(root, file)
  if (!existsSync(path)) continue
  const buf = readFileSync(path)
  if (buf.includes(0)) continue
  const fixture = FIXTURE.test(file)
  const lines = buf.toString('utf8').split('\n')
  lines.forEach((line, i) => {
    for (const rule of rules) {
      if (rule.fixtureOk && fixture) continue
      if (rule.user) {
        for (const m of line.matchAll(rule.re)) {
          const user = m[1].toLowerCase()
          if (FAKE_USERS.has(user) || (fixture && user.length <= 2) || user.startsWith('$') || /^[<{[]/.test(m[1])) continue
          if (!fixture && ['claude', 'runner', 'node'].includes(user)) continue
          hits.push({ file, line: i + 1, rule: rule.id, text: m[0] })
        }
        continue
      }
      const m = line.match(rule.re)
      if (m) hits.push({ file, line: i + 1, rule: rule.id, text: m[0] })
    }
    const lower = line.toLowerCase()
    for (const w of words) if (lower.includes(w.toLowerCase())) hits.push({ file, line: i + 1, rule: 'private-word', text: '(a word from your private list)' })
  })
}

if (process.argv.includes('--json')) console.log(JSON.stringify({ files: files.length, words: words.length, hits }, null, 2))
else {
  for (const h of hits) console.log(`${h.file}:${h.line}  ${h.rule}  ${h.text}`)
  console.log(`${files.length} files checked, ${words.length} private words, ${hits.length} finding${hits.length === 1 ? '' : 's'}`)
}
process.exit(hits.length ? 1 : 0)
