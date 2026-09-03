#!/usr/bin/env node
// cc-forge — Claude Code session dashboard (workstream 1: Mac poller + table).
//
// Polls the local session registry via `claude agents --json`, enriches each
// row from ~/.claude/sessions/<pid>.json, and renders one table row per live
// session sorted waiting / idle / busy. `--once` prints a single plain frame
// and exits; `--fixture <path>` feeds rows from a JSON file through the same
// pipeline so the program can be checked without live sessions.
//
// Zero dependencies, Node >= 22, stdlib only. Run by hand:
//   node dashboard/dash.js
//
// Error posture: per-row failures stay inside the row and render blank; a
// failed poll changes the poll state and the footer, never the exit code of a
// live run. Only argument errors and --once exit non-zero.

'use strict'

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 5000
const REGISTRY_MAX_BYTES = 4 * 1024 * 1024
const SESSION_FILE_MAX_BYTES = 64 * 1024
const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions')
const PROJECTS_DIR = process.env.DASH_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects')

const TAIL_BYTES = 256 * 1024
const TAIL_RETRY_BYTES = 1024 * 1024
const SUMMARY_MAX_CHARS = 400

const DEFAULT_WIDTH = 80
const STATE_WIDTH = 8
const AGE_WIDTH = 6
const NAME_CAP = 24
const NAME_MIN = 8
const DIR_CAP = 30
const DIR_MIN = 8
const SUMMARY_MIN = 10
const COLUMN_GAP = 2

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PID_RE = /^[0-9]{1,10}$/
const STATUS_RANK = { waiting: 0, idle: 1, busy: 2 }
const UNKNOWN_STATUS_RANK = 3

// Epoch ms plausible enough to be a real timestamp rather than a seconds value
// or a sentinel: 2020-01-01 through fifty years out.
const EPOCH_MS_MIN = 1577836800000
const EPOCH_MS_MAX = 3155760000000

const ERROR_BODIES = {
  missing: 'claude not found on PATH — install Claude Code, or check your PATH.',
  unsupported: 'claude agents --json failed — this build may not support the agent registry.',
  'bad-json': 'claude agents --json returned output this dashboard could not parse.',
}

// --- Argument parsing ----------------------------------------------------
//
// Hand-rolled over process.argv so the program stays dependency-free. Kept in
// one function because later workstreams add flags (--alert-idle, a listen
// port) and they all extend here.

function parseArgs(argv) {
  const opts = { once: false, width: null, fixture: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--once') {
      opts.once = true
    } else if (arg === '--width') {
      const raw = argv[++i]
      const n = Number.parseInt(raw, 10)
      if (!Number.isFinite(n) || n < 20) throw new Error(`--width needs an integer >= 20, got ${raw}`)
      opts.width = n
    } else if (arg === '--fixture') {
      const raw = argv[++i]
      if (!raw) throw new Error('--fixture needs a path')
      opts.fixture = raw
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return opts
}

// --- Registry read -------------------------------------------------------
//
// The binary is the only source of which sessions exist. Spawned with
// execFile semantics (no shell) so registry values never reach one. The
// result is discriminated so the renderer can tell "no sessions" from "no
// claude" from "unparseable output".

function readRegistry() {
  let out
  try {
    out = execFileSync('claude', ['agents', '--json'], {
      timeout: POLL_TIMEOUT_MS,
      maxBuffer: REGISTRY_MAX_BYTES,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (e) {
    if (e.code === 'ENOENT') return { ok: false, error: 'missing' }
    return { ok: false, error: 'unsupported' }
  }
  try {
    const parsed = JSON.parse(out)
    if (!Array.isArray(parsed)) return { ok: false, error: 'bad-json' }
    return { ok: true, rows: parsed }
  } catch (e) {
    return { ok: false, error: 'bad-json' }
  }
}

function readFixture(fixturePath) {
  let raw
  try {
    raw = fs.readFileSync(fixturePath, 'utf8')
  } catch (e) {
    return { ok: false, error: 'missing' }
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return { ok: false, error: 'bad-json' }
    return { ok: true, rows: parsed }
  } catch (e) {
    return { ok: false, error: 'bad-json' }
  }
}

// --- Row validation ------------------------------------------------------
//
// Lenient in one direction: a row without a UUID-shaped sessionId is dropped
// because there is nothing to key state on, but an unrecognized status is
// preserved verbatim — an unknown state is exactly what the user needs to see.

function validateRows(rawRows) {
  const rows = []
  for (const raw of rawRows) {
    if (!raw || typeof raw !== 'object') continue
    const id = typeof raw.sessionId === 'string' ? raw.sessionId : ''
    if (!UUID_RE.test(id)) continue
    rows.push({
      id,
      pid: Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : null,
      name: typeof raw.name === 'string' ? raw.name.trim() : '',
      cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
      kind: typeof raw.kind === 'string' ? raw.kind : '',
      status: typeof raw.status === 'string' && raw.status.trim() ? raw.status.trim() : 'unknown',
      startedAt: isEpochMs(raw.startedAt) ? raw.startedAt : null,
      statusUpdatedAt: null,
      summary: '',
    })
  }
  return rows
}

function isEpochMs(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= EPOCH_MS_MIN && value <= EPOCH_MS_MAX
}

// --- Row enrichment ------------------------------------------------------
//
// ~/.claude/sessions/ also holds 0600 .key secrets, so this never lists the
// directory: it opens the exact <pid>.json path built from a pid the binary
// reported, refuses symlinks and non-regular files, and treats every failure
// as an unenriched row.

function enrichRows(rows) {
  for (const row of rows) {
    const at = readStatusUpdatedAt(row.pid)
    if (at !== null) row.statusUpdatedAt = at
  }
  return rows
}

function readStatusUpdatedAt(pid) {
  if (pid === null || !PID_RE.test(String(pid))) return null
  const file = path.join(SESSIONS_DIR, `${pid}.json`)
  try {
    const st = fs.lstatSync(file)
    if (st.isSymbolicLink() || !st.isFile()) return null
    if (st.size > SESSION_FILE_MAX_BYTES) return null
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
    let fd
    let raw
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | O_NOFOLLOW)
      raw = fs.readFileSync(fd, 'utf8')
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
    const parsed = JSON.parse(raw)
    return isEpochMs(parsed.statusUpdatedAt) ? parsed.statusUpdatedAt : null
  } catch (e) {
    return null
  }
}

// --- Observed state ------------------------------------------------------
//
// The fallback when a registry file yields no statusUpdatedAt: `since` is
// stamped the first time a session is seen in a status and reset whenever the
// status changes. Ids absent from a poll are dropped so a returning session
// does not resume a stale age.

function observeRows(observed, rows, now) {
  const seen = new Set()
  for (const row of rows) {
    seen.add(row.id)
    const prior = observed.get(row.id)
    if (!prior || prior.status !== row.status) {
      observed.set(row.id, { status: row.status, since: now })
    }
  }
  for (const id of observed.keys()) {
    if (!seen.has(id)) observed.delete(id)
  }
  return observed
}

function ageMsFor(row, observed, now) {
  const base = row.statusUpdatedAt !== null ? row.statusUpdatedAt : (observed.get(row.id) || { since: now }).since
  return Math.max(0, now - base)
}

// --- Summary --------------------------------------------------------------
//
// The last assistant text of a session's transcript, read from a bounded tail
// scanned backward so a multi-megabyte file costs one small positional read.
// The path transform is lossy and each session id also names a sibling
// directory, so the exact .jsonl path is opened and the folder never listed.
// Every failure — missing file, permissions, drift in the line format — is a
// blank summary; a row never turns into an error.

const summaryCache = new Map()

function transcriptPath(row) {
  if (!UUID_RE.test(row.id) || !row.cwd) return null
  return path.join(PROJECTS_DIR, row.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${row.id}.jsonl`)
}

function summaryFor(row) {
  const file = transcriptPath(row)
  if (file === null) return ''
  try {
    const st = fs.lstatSync(file)
    if (st.isSymbolicLink() || !st.isFile()) return ''
    const cached = summaryCache.get(file)
    if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached.text
    const text = sanitize(readLastAssistantText(file, st.size))
    summaryCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, text })
    return text
  } catch (e) {
    return ''
  }
}

function readLastAssistantText(file, size) {
  const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
  let fd
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | O_NOFOLLOW)
    const st = fs.fstatSync(fd)
    if (!st.isFile()) return ''
    for (const want of [TAIL_BYTES, TAIL_RETRY_BYTES]) {
      const text = scanTail(fd, size, want)
      if (text) return text
      if (want >= size) break
    }
    return ''
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function scanTail(fd, size, want) {
  const length = Math.min(want, size)
  const start = size - length
  const buf = Buffer.allocUnsafe(length)
  const read = fs.readSync(fd, buf, 0, length, start)
  const lines = buf.toString('utf8', 0, read).split('\n')
  // A tail that starts mid-file starts mid-line; the last line may be
  // half-written. Both are dropped rather than parsed.
  if (start > 0) lines.shift()
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = assistantTextOf(lines[i])
    if (text) return text
  }
  return ''
}

function assistantTextOf(line) {
  if (!line || line[0] !== '{') return ''
  let entry
  try {
    entry = JSON.parse(line)
  } catch (e) {
    return ''
  }
  if (!entry || entry.type !== 'assistant' || entry.isSidechain === true) return ''
  const content = entry.message && entry.message.content
  if (!Array.isArray(content)) return ''
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i]
    if (block && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) return block.text
  }
  return ''
}

function sanitize(text) {
  if (!text) return ''
  const flat = text
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return truncate(flat, SUMMARY_MAX_CHARS)
}

// --- Sort and naming -----------------------------------------------------
//
// Unknown statuses sort last so they surface at the bottom rather than mixing
// into the known ranks. Names are per-poll: a name shared with another row in
// the same frame is as useless as an empty one, so both fall back to the cwd
// basename plus a short id.

function rankOf(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, status) ? STATUS_RANK[status] : UNKNOWN_STATUS_RANK
}

function sortRows(rows) {
  return rows.slice().sort((a, b) => {
    const byRank = rankOf(a.status) - rankOf(b.status)
    if (byRank !== 0) return byRank
    const aStart = a.startedAt === null ? Number.MAX_SAFE_INTEGER : a.startedAt
    const bStart = b.startedAt === null ? Number.MAX_SAFE_INTEGER : b.startedAt
    if (aStart !== bStart) return aStart - bStart
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

function resolveNames(rows) {
  const counts = new Map()
  for (const row of rows) {
    if (row.name) counts.set(row.name, (counts.get(row.name) || 0) + 1)
  }
  for (const row of rows) {
    row.label = !row.name || counts.get(row.name) > 1
      ? `${path.basename(row.cwd) || '?'} ${row.id.slice(0, 8)}`
      : row.name
  }
  return rows
}

// --- Layout --------------------------------------------------------------
//
// Fixed budgets for state, age, name, and dir; the summary absorbs whatever
// remains and is the first column dropped when there is not enough, then dir.

function formatAge(ms) {
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  return `${hours}h${String(mins % 60).padStart(2, '0')}`
}

function shortenDir(cwd) {
  const home = os.homedir()
  if (cwd === home) return '~'
  if (cwd.startsWith(home + path.sep)) return '~' + cwd.slice(home.length)
  return cwd
}

function truncate(text, width) {
  if (width <= 0) return ''
  const chars = Array.from(text)
  if (chars.length <= width) return text
  if (width === 1) return '…'
  return chars.slice(0, width - 1).join('') + '…'
}

function pad(text, width) {
  const len = Array.from(text).length
  return len >= width ? text : text + ' '.repeat(width - len)
}

function layout(rows, width) {
  const wantName = Math.min(NAME_CAP, Math.max(4, ...rows.map((r) => Array.from(r.nameCell).length)))
  const wantDir = Math.min(DIR_CAP, Math.max(3, ...rows.map((r) => Array.from(r.dirCell).length)))

  const beforeName = STATE_WIDTH + COLUMN_GAP + AGE_WIDTH + COLUMN_GAP
  const nameWidth = Math.max(NAME_MIN, Math.min(wantName, width - beforeName))
  const fixed = beforeName + nameWidth
  const afterDir = width - fixed - COLUMN_GAP - wantDir
  const showSummary = afterDir - COLUMN_GAP >= SUMMARY_MIN
  if (showSummary) {
    return { nameWidth, dirWidth: wantDir, showDir: true, showSummary: true, summaryWidth: afterDir - COLUMN_GAP }
  }

  // Summary goes first; dir then shrinks into whatever is left and is dropped
  // only when there is no room for a usable stub of it.
  const dirWidth = Math.min(wantDir, width - fixed - COLUMN_GAP)
  return { nameWidth, dirWidth, showDir: dirWidth >= DIR_MIN, showSummary: false, summaryWidth: 0 }
}

function renderLine(cells, cols, width) {
  const parts = []
  for (let i = 0; i < cells.length; i++) {
    parts.push(i === cells.length - 1 ? truncate(cells[i], cols[i]) : pad(truncate(cells[i], cols[i]), cols[i]))
  }
  return truncate(parts.join(' '.repeat(COLUMN_GAP)).replace(/\s+$/, ''), width)
}

function buildTable(rows, width) {
  const cols = layout(rows, width)
  const widths = [STATE_WIDTH, AGE_WIDTH, cols.nameWidth]
  const headers = ['STATE', 'AGE', 'NAME']
  if (cols.showDir) {
    widths.push(cols.dirWidth)
    headers.push('DIR')
  }
  if (cols.showSummary) {
    widths.push(cols.summaryWidth)
    headers.push('SUMMARY')
  }

  const lines = [renderLine(headers, widths, width)]
  for (const row of rows) {
    const cells = [row.status, row.ageCell, row.nameCell]
    if (cols.showDir) cells.push(row.dirCell)
    if (cols.showSummary) cells.push(row.summary)
    lines.push(renderLine(cells, widths, width))
  }
  return lines
}

// --- Frame ---------------------------------------------------------------
//
// A frame is plain lines: body plus a footer. The three poll states decide the
// body — an error before any good poll is the body itself; an error after one
// keeps the last good table and moves the error into the footer.

function decorateRows(rows, observed, now) {
  resolveNames(rows)
  for (const row of rows) {
    row.ageCell = formatAge(ageMsFor(row, observed, now))
    row.nameCell = row.kind === 'interactive' ? row.label : `${row.label} (bg)`
    row.dirCell = shortenDir(row.cwd)
    row.summary = summaryFor(row)
  }
  return rows
}

function stamp(now) {
  const d = new Date(now)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function buildFrame(state, width, now) {
  return frameLines(state, width, now).map((line) => truncate(line, width))
}

function frameLines(state, width, now) {
  const lines = []
  if (state.poll === 'never-good') {
    lines.push(ERROR_BODIES[state.error] || `registry error: ${state.error}`)
    lines.push('')
    lines.push(`polled ${stamp(now)}  ·  no successful poll yet`)
    return lines
  }

  if (state.lastRows.length === 0) {
    lines.push('No Claude Code sessions running. Start one with `claude` in any directory.')
  } else {
    lines.push(...buildTable(state.lastRows, width))
  }
  lines.push('')

  if (state.poll === 'stale') {
    const age = formatAge(Math.max(0, now - state.lastGoodAt))
    lines.push(`polled ${stamp(now)}  ·  ${ERROR_BODIES[state.error] || state.error} (last good poll ${age} ago)`)
  } else {
    lines.push(`polled ${stamp(now)}  ·  ${state.lastRows.length} session${state.lastRows.length === 1 ? '' : 's'}`)
  }
  return lines
}

// --- Poll tick -----------------------------------------------------------
//
// One tick: read, validate, enrich, observe, decorate, fold into the poll
// state. Unit 3 wraps this in a re-armed timer; it deliberately owns no timing
// or rendering of its own.

function tick(state, opts) {
  const now = Date.now()
  const result = opts.fixture ? readFixture(opts.fixture) : readRegistry()

  if (!result.ok) {
    state.error = result.error
    state.poll = state.poll === 'never-good' ? 'never-good' : 'stale'
    return state
  }

  const rows = enrichRows(validateRows(result.rows))
  observeRows(state.observed, rows, now)
  state.lastRows = sortRows(decorateRows(rows, state.observed, now))
  state.lastGoodAt = now
  state.error = null
  state.poll = 'good'
  return state
}

function newState() {
  return { poll: 'never-good', error: null, lastRows: [], lastGoodAt: null, observed: new Map() }
}

// --- Lifecycle (Unit 3) --------------------------------------------------
//
// The alternate-screen live loop, key handling, resize, and terminal restore
// land in Unit 3. Until then every invocation renders a single plain frame.

function runOnce(opts) {
  const state = newState()
  tick(state, opts)
  const width = opts.width || process.stdout.columns || DEFAULT_WIDTH
  process.stdout.write(buildFrame(state, width, Date.now()).join('\n') + '\n')
  return state.poll === 'never-good' ? 1 : 0
}

// --- Entry ---------------------------------------------------------------

function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`dash: ${e.message}\n`)
    process.exit(2)
  }
  if (!opts.once) {
    process.stderr.write('dash: the live loop arrives in a later unit; printing one frame.\n')
  }
  process.exitCode = runOnce(opts)
}

if (require.main === module) main()
