#!/usr/bin/env node
// cc-forge /lorem generator. Nothing is appended to the output, so chars is an
// exact prefix that may end in a space. The token-mode key is
// read from the repo-root .env only, never the environment, so Claude Code
// itself never picks it up.

'use strict'

const { execFileSync } = require('child_process')
const fs = require('fs')
const https = require('https')
const path = require('path')

const PARAGRAPHS = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
  'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.',
  'Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem. Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur.',
  'Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur. At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.',
  'Similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga. Et harum quidem rerum facilis est et expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus.',
  'Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae. Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores repellat.',
]

const UNITS = {
  c: 'chars', char: 'chars', chars: 'chars',
  w: 'words', word: 'words', words: 'words',
  p: 'paragraphs', paragraph: 'paragraphs', paragraphs: 'paragraphs',
  t: 'tokens', token: 'tokens', tokens: 'tokens',
}

const CAPS = { chars: 20000, words: 3000, paragraphs: 40, tokens: 5000 }

const ENV_PATH = path.join(__dirname, '..', '..', '.env')
const CHARS_PER_TOKEN = 2.29
const TOLERANCE = 0.02
const RESPONSE_MAX_BYTES = 64 * 1024

const USAGE = 'usage: lorem <n> [chars|words|paragraphs|tokens]'

function usageError(msg) {
  process.stderr.write(`lorem: ${msg}; ${USAGE}\n`)
  process.exit(2)
}

function parseArgs(argv) {
  if (argv.length === 0) usageError('missing count')
  if (argv.length > 2) usageError('too many arguments')
  const [countArg, unitArg = 'words'] = argv
  if (!/^[1-9][0-9]*$/.test(countArg)) usageError(`count must be a positive integer, got "${countArg}"`)
  if (!Object.hasOwn(UNITS, unitArg)) usageError(`unknown unit "${unitArg}"`)
  const unit = UNITS[unitArg]
  const n = Number(countArg)
  if (n > CAPS[unit]) usageError(`${unit} is capped at ${CAPS[unit]}`)
  return { n, unit }
}

function stream(paragraphCount, separator = ' ') {
  const out = []
  for (let i = 0; i < paragraphCount; i++) out.push(PARAGRAPHS[i % PARAGRAPHS.length])
  return out.join(separator)
}

function streamOfAtLeast(chars) {
  let count = 1
  while (stream(count).length < chars) count++
  return stream(count)
}

function charsText(n) {
  return streamOfAtLeast(n).slice(0, n)
}

function wordsText(n) {
  let count = 1
  for (;;) {
    const text = stream(count)
    const re = /\S+/g
    let match
    let seen = 0
    while ((match = re.exec(text))) {
      if (++seen === n) return text.slice(0, match.index + match[0].length)
    }
    count++
  }
}

function fail(msg) {
  process.stderr.write(`lorem: ${msg}\n`)
  process.exit(1)
}

function readKey() {
  let raw
  try {
    raw = fs.readFileSync(ENV_PATH, 'utf8')
  } catch {
    fail(`no ANTHROPIC_API_KEY found in ${ENV_PATH}`)
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const value = match[1].trim().replace(/^(['"])(.*)\1$/, '$2')
    if (value) return value
  }
  fail(`no ANTHROPIC_API_KEY found in ${ENV_PATH}`)
}

function apiError(status, raw) {
  let detail = ''
  try {
    const { type, message } = JSON.parse(raw).error
    detail = ` ${type}: ${message}`.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 300)
  } catch {}
  const what = status === 401 || status === 403 ? 'key rejected' : 'token count failed'
  return `${what} (HTTP ${status}${detail})`
}

// Never surfaces a caught error object: its message can carry the request headers, key included.
function countTokens(key, text) {
  const body = JSON.stringify({ model: 'claude-haiku-5-5', messages: [{ role: 'user', content: text }] })
  const options = {
    host: 'api.anthropic.com',
    path: '/v1/messages/count_tokens',
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    timeout: 8000,
  }
  const unreachable = () => fail('could not reach the Anthropic API to count tokens')
  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      const chunks = []
      let size = 0
      res.on('data', (chunk) => {
        size += chunk.length
        if (size > RESPONSE_MAX_BYTES) fail('token counter response too large')
        chunks.push(chunk)
      })
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode !== 200) fail(apiError(res.statusCode, raw))
        let count
        try {
          count = JSON.parse(raw).input_tokens
        } catch {}
        if (!Number.isInteger(count)) fail('unexpected response from the token counter')
        resolve(count)
      })
      res.on('error', unreachable)
    })
    req.on('timeout', unreachable)
    req.on('error', unreachable)
    req.end(body)
  })
}

async function tokensText(n) {
  const key = readKey()
  let text = charsText(Math.round(n * CHARS_PER_TOKEN))
  const [probe, first] = await Promise.all([countTokens(key, text[0]), countTokens(key, text)])
  const overhead = probe - 1
  let measured = first - overhead
  if (Math.abs(measured - n) > TOLERANCE * n) {
    text = charsText(Math.max(1, Math.round((text.length * n) / measured)))
    measured = (await countTokens(key, text)) - overhead
  }
  process.stderr.write(`lorem: ${measured} tokens by Haiku 5.5's counter\n`)
  return text
}

function generate(n, unit) {
  if (unit === 'chars') return charsText(n)
  if (unit === 'words') return wordsText(n)
  if (unit === 'paragraphs') return stream(n, '\n\n')
  return tokensText(n)
}

function copyToClipboard(text) {
  try {
    execFileSync('pbcopy', [], { input: text, stdio: ['pipe', 'ignore', 'ignore'] })
    return true
  } catch {
    return false
  }
}

async function main() {
  const { n, unit } = parseArgs(process.argv.slice(2))
  const text = await generate(n, unit)
  process.stdout.write(text)
  if (!copyToClipboard(text)) process.stderr.write('lorem: pbcopy unavailable; text not copied to the clipboard\n')
}

main()
