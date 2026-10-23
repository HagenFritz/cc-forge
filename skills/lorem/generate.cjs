#!/usr/bin/env node
// cc-forge — /lorem generator.
//
// Prints deterministic lorem ipsum at an exact size and copies it to the
// clipboard: `generate.cjs <n> [chars|words|paragraphs|tokens]`. Every unit is
// a prefix of one fixed ASCII stream, so output always opens with "Lorem ipsum
// dolor sit amet" and repeat runs are byte-identical. No trailing newline.
//
// Zero dependencies, Node 18+. Usage errors print one line on stderr and exit
// 2 with nothing on stdout; runtime errors exit 1. A missing or failing pbcopy
// is a stderr note, not an error.

'use strict'

const { execFileSync } = require('child_process')

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

function stream(paragraphCount) {
  const out = []
  for (let i = 0; i < paragraphCount; i++) out.push(PARAGRAPHS[i % PARAGRAPHS.length])
  return out.join('\n\n')
}

function streamOfAtLeast(chars) {
  let count = 1
  while (stream(count).length < chars) count++
  return stream(count)
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

function tokensText() {
  process.stderr.write('lorem: tokens mode is not implemented yet\n')
  process.exit(1)
}

function generate(n, unit) {
  if (unit === 'chars') return streamOfAtLeast(n).slice(0, n)
  if (unit === 'words') return wordsText(n)
  if (unit === 'paragraphs') return stream(n)
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

function main() {
  const { n, unit } = parseArgs(process.argv.slice(2))
  const text = generate(n, unit)
  process.stdout.write(text)
  if (!copyToClipboard(text)) process.stderr.write('lorem: pbcopy unavailable; text not copied to the clipboard\n')
}

if (require.main === module) main()
