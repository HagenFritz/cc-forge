#!/usr/bin/env node
// cc-forge — Claude Code session dashboard (workstream 1: Mac poller + table).
//
// Polls the local session registry via `claude agents --json`, enriches each
// row from ~/.claude/sessions/<pid>.json, and renders one table row per live
// session sorted waiting / idle / busy. Enter focuses the highlighted row's
// iTerm tab, `r` renames it inline, and a session turning `waiting` rings the
// bell (`--alert-idle` extends that to idle). `--once` prints a single plain
// frame and exits, with no keys, no bell, and no help line; `--fixture <path>`
// feeds rows from a JSON file through the same pipeline so the program can be
// checked without live sessions.
//
// Zero dependencies, Node >= 22, stdlib only. Run by hand:
//   node dashboard/dash.js
//
// Error posture: per-row failures stay inside the row and render blank; a
// failed poll changes the poll state and the footer, never the exit code of a
// live run. Only argument errors and --once exit non-zero. Only the restore
// path ends the process.

'use strict'

const { execFile, execFileSync } = require('child_process')
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
const STATE_CAP = 16
const AGE_WIDTH = 6
const NAME_CAP = 24
const NAME_MIN = 8
const DIR_CAP = 30
const DIR_MIN = 8
const SUMMARY_MIN = 10
const COLUMN_GAP = 4

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PID_RE = /^[0-9]{1,10}$/
const STATUS_RANK = { waiting: 0, idle: 1, busy: 2 }
const UNKNOWN_STATUS_RANK = 3

// Epoch ms plausible enough to be a real timestamp rather than a seconds value
// or a sentinel: 2020-01-01 through fifty years out.
const EPOCH_MS_MIN = 1577836800000
const EPOCH_MS_MAX = 3155760000000

const TAB_TITLE = 'claude dashboard'

// OSC 0 sets icon name and window title together; iTerm shows it on the tab.
// OSC 2 is title-only and is the fallback if a terminal ignores this one.
const ESC_ALT_ENTER = '\x1b[?1049h'
const ESC_ALT_LEAVE = '\x1b[?1049l'
const ESC_CURSOR_HIDE = '\x1b[?25l'
const ESC_CURSOR_SHOW = '\x1b[?25h'
const ESC_CURSOR_HOME = '\x1b[H'
const ESC_CLEAR_EOL = '\x1b[K'
const ESC_CLEAR_EOS = '\x1b[J'
const ESC_TITLE_SET = `\x1b]0;${TAB_TITLE}\x07`
const ESC_TITLE_RESET = '\x1b]0;\x07'

const ESC_REVERSE_ON = '\x1b[7m'
const ESC_REVERSE_OFF = '\x1b[27m'

const KEY_CTRL_C = 0x03
const KEY_ESC = 0x1b
const KEY_ENTER = 0x0d
const KEY_ENTER_LF = 0x0a
const KEY_J = 0x6a
const KEY_K = 0x6b
const KEY_Q = 0x71
const KEY_R = 0x72
const KEY_CTRL_U = 0x15
const KEY_BACKSPACE = 0x7f
const KEY_BACKSPACE_BS = 0x08
const PRINTABLE_MIN = 0x20
const PRINTABLE_MAX = 0x7e
const RENAME_MAX_CHARS = 64
const SEQ_UP = '\x1b[A'
const SEQ_DOWN = '\x1b[B'
const ESC_CSI_PREFIX = '\x1b['
const ESC_SS3_PREFIX = '\x1bO'
const ESC_SEQ_TIMEOUT_MS = 50
// Runaway guard only — a CSI ends at its final byte, an SS3 at its third.
const ESC_SEQ_MAX_BYTES = 32
const CSI_FINAL_MIN = 0x40
const CSI_FINAL_MAX = 0x7e
const SS3_SEQ_BYTES = 3
const BELL = '\x07'
const FOCUS_TIMEOUT_MS = 3000
const ITERM_BUNDLE_ID = 'com.googlecode.iterm2'
const SCRIPT_OK_PREFIX = 'ok:'
const SCRIPT_NO_MATCH = 'no-match'
const TTY_PATH_RE = /^\/dev\/tty[a-z0-9]+$/

const HELP_NORMAL = 'j/k: select  enter: focus  r: rename tab  q: quit'
const HELP_RENAME = 'enter: confirm  esc: cancel  ^U: clear'
const RENAME_PROMPT = 'Tab name: '

const EXIT_SIGNAL_BASE = 128
const SIGNAL_NUMBERS = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 }

const ERROR_BODIES = {
  missing: 'claude not found on PATH — install Claude Code, or check your PATH.',
  unsupported: 'claude agents --json failed — this build may not support the agent registry.',
  'bad-json': 'claude agents --json returned output this dashboard could not parse.',
  'fixture-missing': '--fixture file could not be read — check the path.',
  'fixture-bad-json': '--fixture file is not a JSON array of session rows.',
}

// --- Argument parsing ----------------------------------------------------
//
// Hand-rolled over process.argv so the program stays dependency-free. Kept in
// one function because later workstreams add flags (--alert-idle, a listen
// port) and they all extend here.

function parseArgs(argv) {
  const opts = { once: false, width: null, fixture: null, alertIdle: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--once') {
      opts.once = true
    } else if (arg === '--alert-idle') {
      opts.alertIdle = true
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
    return { ok: false, error: 'fixture-missing' }
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return { ok: false, error: 'fixture-bad-json' }
    return { ok: true, rows: parsed }
  } catch (e) {
    return { ok: false, error: 'fixture-bad-json' }
  }
}

// --- Row validation ------------------------------------------------------
//
// Lenient in one direction: a row without a UUID-shaped sessionId is dropped
// because there is nothing to key state on, but an unrecognized status is
// preserved verbatim — an unknown state is exactly what the user needs to see.
//
// name, cwd, and status are attacker-influenced (a cloned repo names the cwd),
// so control characters are stripped here rather than at render time: every
// path to the screen goes through a validated row.

function validateRows(rawRows) {
  const rows = []
  for (const raw of rawRows) {
    if (!raw || typeof raw !== 'object') continue
    const id = typeof raw.sessionId === 'string' ? raw.sessionId : ''
    if (!UUID_RE.test(id)) continue
    const status = typeof raw.status === 'string' ? stripControls(raw.status) : ''
    rows.push({
      id,
      pid: Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : null,
      name: typeof raw.name === 'string' ? stripControls(raw.name) : '',
      cwd: typeof raw.cwd === 'string' ? stripControls(raw.cwd) : '',
      kind: typeof raw.kind === 'string' ? raw.kind : '',
      status: status || 'unknown',
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
//
// Status changes are also collected as transitions before the prior entry is
// overwritten, which is what makes the bell edge-triggered rather than a
// re-alert on every poll. A first sighting counts as a transition from null.

function observeRows(observed, rows, now) {
  const seen = new Set()
  const transitions = []
  for (const row of rows) {
    seen.add(row.id)
    const prior = observed.get(row.id)
    if (!prior || prior.status !== row.status) {
      transitions.push({ id: row.id, from: prior ? prior.status : null, to: row.status })
      observed.set(row.id, { status: row.status, since: now })
    }
  }
  for (const id of observed.keys()) {
    if (!seen.has(id)) observed.delete(id)
  }
  return transitions
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

function stripControls(text) {
  if (!text) return ''
  return text
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitize(text) {
  return truncate(stripControls(text), SUMMARY_MAX_CHARS)
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
  // An unknown status is the one thing the user most needs to read intact, so
  // the state column grows to fit the widest one present rather than clipping
  // it to the width the three known statuses happen to need.
  const stateWidth = Math.min(STATE_CAP, Math.max(STATE_WIDTH, ...rows.map((r) => Array.from(r.status).length)))
  const wantName = Math.min(NAME_CAP, Math.max(4, ...rows.map((r) => Array.from(r.nameCell).length)))
  const wantDir = Math.min(DIR_CAP, Math.max(3, ...rows.map((r) => Array.from(r.dirCell).length)))

  const beforeName = stateWidth + COLUMN_GAP + AGE_WIDTH + COLUMN_GAP
  const nameWidth = Math.max(NAME_MIN, Math.min(wantName, width - beforeName))
  const fixed = beforeName + nameWidth
  const afterDir = width - fixed - COLUMN_GAP - wantDir
  const showSummary = afterDir - COLUMN_GAP >= SUMMARY_MIN
  if (showSummary) {
    return { stateWidth, nameWidth, dirWidth: wantDir, showDir: true, showSummary: true, summaryWidth: afterDir - COLUMN_GAP }
  }

  // Summary goes first; dir then shrinks into whatever is left and is dropped
  // only when there is no room for a usable stub of it.
  const dirWidth = Math.min(wantDir, width - fixed - COLUMN_GAP)
  return { stateWidth, nameWidth, dirWidth, showDir: dirWidth >= DIR_MIN, showSummary: false, summaryWidth: 0 }
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
  const widths = [cols.stateWidth, AGE_WIDTH, cols.nameWidth]
  const headers = ['STATE', 'AGE', 'NAME']
  if (cols.showDir) {
    widths.push(cols.dirWidth)
    headers.push('DIR')
  }
  if (cols.showSummary) {
    widths.push(cols.summaryWidth)
    headers.push('SUMMARY')
  }

  const lines = [renderLine(headers, widths, width), '']
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
  const lines = frameLines(state, width, now).map((line) => truncate(line, width))
  // Applied after truncation so the escape bytes are never counted as columns.
  const row = highlightLineIndex(state)
  if (row !== -1 && lines[row] !== undefined) lines[row] = ESC_REVERSE_ON + lines[row] + ESC_REVERSE_OFF
  return lines
}

// The table occupies the top of the frame with a header line and a blank line
// under it, so a row's frame line is its highlight index plus two.
function highlightLineIndex(state) {
  if (state.poll === 'never-good' || state.lastRows.length === 0) return -1
  const index = state.highlight.index
  return index >= 0 && index < state.lastRows.length ? index + 2 : -1
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

  if (state.interactive) {
    lines.push(state.mode === 'rename' ? HELP_RENAME : HELP_NORMAL)
    lines.push('')
  }

  if (state.poll === 'stale') {
    const age = formatAge(Math.max(0, now - state.lastGoodAt))
    lines.push(`polled ${stamp(now)}  ·  ${ERROR_BODIES[state.error] || state.error} (last good poll ${age} ago)`)
  } else {
    lines.push(`polled ${stamp(now)}  ·  ${state.lastRows.length} session${state.lastRows.length === 1 ? '' : 's'}`)
  }
  if (state.transient) lines.push(state.transient)
  if (state.mode === 'rename') lines.push(RENAME_PROMPT + state.renameBuffer)
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
    return []
  }

  const rows = enrichRows(validateRows(result.rows))
  const transitions = observeRows(state.observed, rows, now)
  state.lastRows = sortRows(decorateRows(rows, state.observed, now))
  state.lastGoodAt = now
  state.error = null
  state.poll = 'good'
  return transitions
}

function newState() {
  return {
    poll: 'never-good',
    error: null,
    lastRows: [],
    lastGoodAt: null,
    observed: new Map(),
    mode: 'normal',
    interactive: false,
    highlight: { id: null, index: -1 },
    renameBuffer: '',
    renameTarget: null,
    transient: null,
  }
}

// --- Highlight -----------------------------------------------------------
//
// The selection is keyed on session id, not row position: rows re-sort as
// statuses change, so the index is derived from the id after every tick. A
// vanished session hands the selection to whatever row now sits nearest its
// old position rather than dropping it.

function reconcileHighlight(state) {
  const rows = state.lastRows
  if (rows.length === 0) {
    state.highlight = { id: null, index: -1 }
    return
  }
  const found = rows.findIndex((row) => row.id === state.highlight.id)
  if (found !== -1) {
    state.highlight.index = found
    return
  }
  if (state.highlight.index < 0) return
  const index = Math.min(state.highlight.index, rows.length - 1)
  state.highlight = { id: rows[index].id, index }
}

function moveHighlight(state, delta) {
  const rows = state.lastRows
  if (rows.length === 0) {
    state.highlight = { id: null, index: -1 }
    return
  }
  const from = state.highlight.index < 0 ? (delta > 0 ? -1 : rows.length) : state.highlight.index
  const index = Math.max(0, Math.min(rows.length - 1, from + delta))
  state.highlight = { id: rows[index].id, index }
}

// --- Tab focus -----------------------------------------------------------
//
// Enter hands the highlighted row to iTerm: pid -> tty via `ps`, tty -> tab via
// AppleScript. Both calls are async with a timeout because a hung iTerm or a
// modal dialog would otherwise freeze the paint loop, the poll timer, and every
// keystroke for as long as it takes. Nothing here can fail loudly: a dead pid,
// a missing iTerm, or a script error becomes one transient footer line.
//
// `ps -o tty=` prints the bare device name (`ttys004 `, padded and newline
// terminated) or `??` for a process with no controlling terminal, while
// AppleScript's `tty of s` returns `/dev/ttys004`. The normalized form is
// checked against a strict pattern before it reaches osascript, so no text
// derived from process output is ever interpolated unvalidated.

function normalizeTty(raw) {
  const name = String(raw || '').trim()
  if (!name || name === '??') return null
  const full = name.startsWith('/dev/') ? name : `/dev/${name}`
  return TTY_PATH_RE.test(full) ? full : null
}

// `result` is the AppleScript expression returned once a session matches. It is
// prefixed with a marker so a read-back tab name can never be mistaken for the
// no-match sentinel.
function sessionScript(tty, body, result = '"ok"') {
  return [
    `tell application id "${ITERM_BUNDLE_ID}"`,
    'repeat with w in windows',
    'repeat with t in tabs of w',
    'repeat with s in sessions of t',
    `if tty of s is "${tty}" then`,
    ...body,
    `return "${SCRIPT_OK_PREFIX}" & (${result})`,
    'end if',
    'end repeat',
    'end repeat',
    'end repeat',
    `return "${SCRIPT_NO_MATCH}"`,
    'end tell',
  ].join('\n')
}

function focusScript(tty) {
  return sessionScript(tty, ['select s', 'select t', 'select w', 'activate'])
}

// The tty reaches the script through a closed pattern, but a tab name is
// arbitrary user text, so it is escaped instead: backslashes first, then
// quotes, or the escapes added for the quotes would themselves be doubled.
function escapeAppleScriptString(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// The read-back is for reporting only. Never feed it into a later `set name`:
// a profile's title format decorates the name it is given, so a round trip
// compounds the decoration on every rename.
function renameScript(tty, name) {
  return sessionScript(tty, [`set name of s to "${escapeAppleScriptString(name)}"`], 'name of s')
}

function setTransient(state, message) {
  state.transient = message
  paint(state)
}

// Both focus and rename start the same way: a row with a live pid whose
// controlling terminal iTerm can be searched for.
function withRowTty(state, row, next) {
  if (!row) return
  if (row.pid === null || !PID_RE.test(String(row.pid))) {
    setTransient(state, 'session exited — no pid to focus.')
    return
  }
  execFile('ps', ['-o', 'tty=', '-p', String(row.pid)], { timeout: FOCUS_TIMEOUT_MS, encoding: 'utf8' }, (err, out) => {
    const tty = err ? null : normalizeTty(out)
    if (tty === null) {
      setTransient(state, 'session exited — no terminal for that pid.')
      return
    }
    next(tty)
  })
}

// One osascript call path for focus and rename. `onOk` receives whatever the
// script returned after the success marker — empty for focus, the tab's
// read-back name for rename.
function runSessionScript(state, script, verb, tty, onOk) {
  execFile('osascript', ['-e', script], { timeout: FOCUS_TIMEOUT_MS, encoding: 'utf8' }, (scriptErr, scriptOut) => {
    if (scriptErr) {
      setTransient(state, `could not ${verb} the tab — is iTerm running?`)
      return
    }
    const out = String(scriptOut).trim()
    if (!out.startsWith(SCRIPT_OK_PREFIX)) {
      setTransient(state, `no iTerm tab is attached to ${tty}.`)
      return
    }
    onOk(out.slice(SCRIPT_OK_PREFIX.length))
  })
}

function focusHighlighted(state) {
  withRowTty(state, state.lastRows[state.highlight.index], (tty) => {
    runSessionScript(state, focusScript(tty), 'focus', tty, () => setTransient(state, null))
  })
}

// --- Rename mode ---------------------------------------------------------
//
// An overlay, not a modal: the poll timer keeps running and repaints underneath,
// so `state.renameBuffer` — not the screen — is what the typed name lives in and
// a repaint mid-typing costs nothing. The cursor comes back for the duration so
// the prompt has something to type against. The rename targets the row that was
// highlighted when `r` was pressed, even if the sort has moved it since.

function enterRename(state) {
  const row = state.lastRows[state.highlight.index]
  if (!row) return
  state.mode = 'rename'
  state.renameBuffer = ''
  state.renameTarget = row.id
  write(ESC_CURSOR_SHOW)
  paint(state)
}

function exitRename(state) {
  state.mode = 'normal'
  state.renameBuffer = ''
  state.renameTarget = null
  write(ESC_CURSOR_HIDE)
  paint(state)
}

function commitRename(state) {
  const name = state.renameBuffer.trim()
  const row = state.lastRows.find((r) => r.id === state.renameTarget)
  exitRename(state)
  if (!name || !row) return
  withRowTty(state, row, (tty) => {
    runSessionScript(state, renameScript(tty, name), 'rename', tty, (actual) => {
      // A profile title format decorates the applied name, which otherwise
      // reads as the rename having done nothing at all.
      setTransient(state, actual === name ? null : `renamed — this profile's title format shows it as "${stripControls(actual)}"`)
    })
  })
}

function handleRenameKey(state, key) {
  const code = key.length === 1 ? key.charCodeAt(0) : -1
  if (code === KEY_ESC) return exitRename(state)
  if (code === KEY_ENTER || code === KEY_ENTER_LF) return commitRename(state)
  if (code === KEY_CTRL_U) {
    state.renameBuffer = ''
    return paint(state)
  }
  if (code === KEY_BACKSPACE || code === KEY_BACKSPACE_BS) {
    state.renameBuffer = state.renameBuffer.slice(0, -1)
    return paint(state)
  }
  if (code >= PRINTABLE_MIN && code <= PRINTABLE_MAX && state.renameBuffer.length < RENAME_MAX_CHARS) {
    state.renameBuffer += key
    paint(state)
  }
}

// --- Terminal writes -----------------------------------------------------
//
// A reader that closes early (`dash.js --once | head -1`) makes every later
// write raise EPIPE, which has no useful handler in a display program: the
// output has nowhere to go, so the process leaves quietly instead of printing
// a stack trace over the user's shell. A pipe reports the failure
// asynchronously as an 'error' event rather than a throw, so both are handled.

function write(text) {
  try {
    process.stdout.write(text)
    return true
  } catch (e) {
    if (isBrokenPipe(e)) quitQuietly()
    return false
  }
}

function guardStdout() {
  process.stdout.on('error', (e) => {
    if (isBrokenPipe(e)) quitQuietly()
    throw e
  })
}

function isBrokenPipe(e) {
  return Boolean(e) && (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED')
}

function quitQuietly() {
  restore()
  process.exit(0)
}

// --- Terminal restore ----------------------------------------------------
//
// One idempotent function on every exit path. fs.writeSync bypasses the stream
// layer, which may never flush once the process is already unwinding; an
// exception inside it must never stop the exit that follows.

let entered = false
let rawEnabled = false
let restored = false

function restore() {
  if (restored) return
  restored = true
  try {
    if (rawEnabled && process.stdin.isTTY) process.stdin.setRawMode(false)
  } catch (e) {
    // A stdin already torn down cannot be un-rawed; the escape writes matter more.
  }
  try {
    fs.writeSync(1, ESC_CURSOR_SHOW + (entered ? ESC_ALT_LEAVE : '') + ESC_TITLE_RESET)
  } catch (e) {
    // Nothing left to write to; the terminal is whatever the shell inherits.
  }
}

function registerRestore() {
  process.on('exit', restore)
  for (const signal of Object.keys(SIGNAL_NUMBERS)) {
    process.on(signal, () => {
      restore()
      process.exit(EXIT_SIGNAL_BASE + SIGNAL_NUMBERS[signal])
    })
  }
  const die = (e) => {
    if (isBrokenPipe(e)) return quitQuietly()
    restore()
    process.stderr.write(`dash: ${(e && e.stack) || e}\n`)
    process.exit(1)
  }
  process.on('uncaughtException', die)
  process.on('unhandledRejection', die)
}

// --- Lifecycle -----------------------------------------------------------
//
// --once prints one plain frame; the live loop owns the alternate screen and
// re-arms its timer after each tick so a slow poll delays the next one instead
// of overlapping it. The registry read is synchronous, so a tick cannot
// re-enter while one is in flight — the re-armed timer is the whole guard.

function runOnce(opts) {
  const state = newState()
  tick(state, opts)
  const width = opts.width || process.stdout.columns || DEFAULT_WIDTH
  write(buildFrame(state, width, Date.now()).join('\n') + '\n')
  return state.poll === 'never-good' ? 1 : 0
}

function runLive(opts) {
  const state = newState()
  state.interactive = true
  registerRestore()
  entered = true
  write(ESC_ALT_ENTER + ESC_CURSOR_HIDE + ESC_TITLE_SET)
  listenForKeys(state)
  process.on('SIGWINCH', () => paint(state))

  const loop = () => {
    let transitions = []
    try {
      transitions = tick(state, opts)
    } catch (e) {
      // tick is defensive, so this is drift, not an expected path: surface it
      // in the footer like a failed poll rather than killing the dashboard.
      state.error = String((e && e.message) || e)
      state.poll = state.poll === 'never-good' ? 'never-good' : 'stale'
    }
    reconcileHighlight(state)
    // One bell per tick, not one per transition: three sessions all going
    // waiting at once is one event to the person hearing it.
    if (shouldBell(transitions, opts)) write(BELL)
    state.transient = null
    paint(state)
    setTimeout(loop, POLL_INTERVAL_MS)
  }
  loop()
}

function shouldBell(transitions, opts) {
  return transitions.some((t) => t.to === 'waiting' || (opts.alertIdle && t.to === 'idle'))
}

// A pending execFile callback can land after restore() has already left the
// alt screen; its escapes would then paint over the user's shell.
function paint(state) {
  if (restored) return
  const width = process.stdout.columns || DEFAULT_WIDTH
  const lines = buildFrame(state, width, Date.now())
  write(ESC_CURSOR_HOME + lines.join(ESC_CLEAR_EOL + '\n') + ESC_CLEAR_EOL + ESC_CLEAR_EOS)
}

// --- Input ---------------------------------------------------------------
//
// A raw `data` listener rather than readline.emitKeypressEvents, which would
// install its own SIGINT and resize handling on top of the ones registered
// here. Arrow keys arrive as three bytes that Node may split across events, so
// an ESC starts a buffer armed with a short timer: a completed sequence
// dispatches and disarms, a timer expiry dispatches the bare Escape that Unit 3
// uses to cancel a rename, and a byte that cannot continue a sequence dispatches
// the Escape immediately and is then handled as its own key. The timer is
// unref'd so a pending Escape never holds the process open past `q`.
//
// Both CSI (`\x1b[`) and SS3 (`\x1bO`, which some iTerm keyboard modes use for
// Home/End/F1-F4) are recognized, and a sequence ends at its terminator rather
// than a byte count — a fixed cap left the tail of anything longer than three
// bytes to dispatch as literal keystrokes.

let escBuf = ''
let escTimer = null

function listenForKeys(state) {
  if (!process.stdin.isTTY) return
  try {
    process.stdin.setRawMode(true)
  } catch (e) {
    return
  }
  rawEnabled = true
  process.stdin.resume()
  process.stdin.on('data', (buf) => handleInput(state, buf))
}

function handleInput(state, buf) {
  for (const byte of buf) {
    // A second byte that introduces neither CSI nor SS3 means the Escape already
    // stood alone, so it dispatches now and the byte falls through to be read as
    // its own key — including another Escape, which re-arms the buffer.
    if (escBuf.length === 1 && !isEscPrefix(escBuf + String.fromCharCode(byte))) {
      disarmEscTimer()
      escBuf = ''
      handleKey(state, String.fromCharCode(KEY_ESC))
    }
    if (escBuf) {
      escBuf += String.fromCharCode(byte)
      if (isSeqComplete(escBuf, byte)) {
        const key = escBuf
        disarmEscTimer()
        escBuf = ''
        if (key === SEQ_UP || key === SEQ_DOWN) handleKey(state, key)
      }
      continue
    }
    if (byte === KEY_ESC) {
      escBuf = String.fromCharCode(byte)
      armEscTimer(state)
      continue
    }
    handleKey(state, String.fromCharCode(byte))
  }
}

function isEscPrefix(text) {
  return ESC_CSI_PREFIX.startsWith(text) || ESC_SS3_PREFIX.startsWith(text)
}

// A CSI runs to its final byte (0x40-0x7e); SS3 is always exactly three bytes.
// The byte cap only stops a malformed stream from buffering forever.
function isSeqComplete(seq, byte) {
  if (seq.length >= ESC_SEQ_MAX_BYTES) return true
  if (seq.startsWith(ESC_SS3_PREFIX)) return seq.length >= SS3_SEQ_BYTES
  return seq.length > ESC_CSI_PREFIX.length && byte >= CSI_FINAL_MIN && byte <= CSI_FINAL_MAX
}

function armEscTimer(state) {
  disarmEscTimer()
  escTimer = setTimeout(() => {
    escTimer = null
    escBuf = ''
    handleKey(state, String.fromCharCode(KEY_ESC))
  }, ESC_SEQ_TIMEOUT_MS)
  escTimer.unref()
}

function disarmEscTimer() {
  if (escTimer === null) return
  clearTimeout(escTimer)
  escTimer = null
}

function handleKey(state, key) {
  const code = key.length === 1 ? key.charCodeAt(0) : -1
  if (code === KEY_CTRL_C) {
    restore()
    process.exit(0)
  }
  if (state.mode === 'rename') return handleRenameKey(state, key)
  if (code === KEY_Q) {
    restore()
    process.exit(0)
  }
  if (code === KEY_ENTER || code === KEY_ENTER_LF) {
    if (state.highlight.index >= 0) focusHighlighted(state)
    return
  }
  if (code === KEY_R) {
    if (state.highlight.index >= 0) enterRename(state)
    return
  }
  if (code === KEY_J || key === SEQ_DOWN) {
    moveHighlight(state, 1)
    paint(state)
  } else if (code === KEY_K || key === SEQ_UP) {
    moveHighlight(state, -1)
    paint(state)
  }
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
  guardStdout()
  if (!opts.once && !process.stdout.isTTY) {
    process.stderr.write('dash: stdout is not a terminal; printing one frame as with --once.\n')
    opts.once = true
  }
  if (opts.once) {
    process.exitCode = runOnce(opts)
    return
  }
  runLive(opts)
}

if (require.main === module) main()
