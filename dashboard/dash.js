#!/usr/bin/env node
// cc-forge — Claude Code session dashboard (workstream 1: Mac poller + table).
//
// Polls the local session registry via `claude agents --json`, enriches each
// row from ~/.claude/sessions/<pid>.json, and renders one table row per live
// session in iTerm tab order, falling back to waiting / idle / busy when iTerm
// cannot be asked. Enter focuses the highlighted row's iTerm tab, `r` renames
// it inline, and a session turning `waiting` rings the bell (`--alert-idle`
// extends that to idle). `--once` prints a single plain
// frame and exits, with no keys, no bell, and no help line; `--fixture <path>`
// feeds rows from a JSON file through the same pipeline so the program can be
// checked without live sessions. `--listen <port>` adds an authenticated
// loopback endpoint that turns devbox hook events into rows in the same table.
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
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const path = require('path')
const os = require('os')

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 5000
const REGISTRY_MAX_BYTES = 4 * 1024 * 1024
const SESSION_FILE_MAX_BYTES = 64 * 1024
const PAYLOAD_STRING_MAX = 256
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
const TMUX_SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const VM_HOST = 'ro-devbox'

const LISTEN_HOST = '127.0.0.1'
const LISTEN_PORT_MIN = 1024
const LISTEN_PORT_MAX = 65535
const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
const TOKEN_PATH = path.join(os.homedir(), '.claude', '.dash-token')
const TOKEN_BYTES = 32
const TOKEN_RE = /^[0-9a-f]{64}$/
const TOKEN_MAX_BYTES = 128
const VM_TOKEN_HEADER = 'x-dash-token'
const VM_BODY_MAX_BYTES = 4096
const VM_EVENT_STATUS = {
  SessionStart: 'busy',
  UserPromptSubmit: 'busy',
  Notification: 'waiting',
  PermissionRequest: 'waiting',
  Stop: 'idle',
}
const VM_END_EVENT = 'SessionEnd'
// Short on purpose: a longer window turns a forged SessionEnd into a lockout
// of the real session's re-registration.
const VM_END_STICKY_MS = 5000
const VM_ROWS_MAX = 256
// There is no heartbeat, so an idle session and a dead forward look identical:
// silence is labeled rather than trusted. Ten minutes of it flags the row,
// twelve hours evicts it so ghosts do not accumulate across days.
const VM_STALE_MS = 10 * 60 * 1000
const VM_EVICT_MS = 12 * 60 * 60 * 1000
const VM_STALE_LABEL = 'stale'
// Number.isInteger(1e308) is true, so without a ceiling one forged event pins
// the stored seq beyond every real one.
const VM_SEQ_MAX = 2 ** 32
const VM_MAX_CONNECTIONS = 32

const STATUS_RANK = { waiting: 0, idle: 1, busy: 2 }
const UNKNOWN_STATUS_RANK = 3
// One ASCII byte, no colour needed — fits STATE_WIDTH (8 chars).
const WAITING_LABEL = 'waiting!'

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
const TAB_QUERY_TIMEOUT_MS = 3000
const ITERM_BUNDLE_ID = 'com.googlecode.iterm2'
const SCRIPT_OK_PREFIX = 'ok:'
const SCRIPT_NO_MATCH = 'no-match'
const TTY_PATH_RE = /^\/dev\/tty[a-z0-9]+$/
// A tmux client_tty is a device path, and on Linux it is a pts one, which
// TTY_PATH_RE does not admit.
const TMUX_CLIENT_TTY_RE = /^\/dev\/(pts\/\d{1,5}|tty[A-Za-z0-9]{1,16})$/

const HELP_NORMAL = 'j: up  k: down  enter: focus  r: rename tab  q: quit'
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
  const opts = { once: false, width: null, fixture: null, alertIdle: false, listen: null }
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
    } else if (arg === '--listen') {
      const raw = argv[++i]
      const n = Number.parseInt(raw, 10)
      if (!Number.isFinite(n) || n < LISTEN_PORT_MIN || n > LISTEN_PORT_MAX) {
        throw new Error(`--listen needs a port between ${LISTEN_PORT_MIN} and ${LISTEN_PORT_MAX}, got ${raw}`)
      }
      opts.listen = n
    } else if (arg === '--fixture') {
      const raw = argv[++i]
      if (!raw) throw new Error('--fixture needs a path')
      opts.fixture = raw
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  if (opts.listen !== null && opts.once) throw new Error('--listen cannot be combined with --once — a one-shot frame cannot receive events')
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
//
// Network rows take the same door: `{ remote: true }` adds the host, tmux
// session, and id namespacing, and everything else runs the same code. Both
// the flag and the host come from the call site and never from the payload, so
// a local row can never claim to be remote and a payload can never mint id
// namespaces of its own.

function validateRows(rawRows, { remote = false } = {}) {
  const rows = []
  for (const raw of rawRows) {
    if (!raw || typeof raw !== 'object') continue
    const rawId = typeof raw.sessionId === 'string' ? raw.sessionId : ''
    if (!UUID_RE.test(rawId)) continue
    const rawStatus = typeof raw.status === 'string' ? stripControls(raw.status.slice(0, PAYLOAD_STRING_MAX)) : ''
    // Only a real `waiting` may render the marker: a payload that names the
    // rendered label itself would otherwise mint one.
    const status = rawStatus === WAITING_LABEL ? 'unknown' : rawStatus
    rows.push({
      // UUID_RE is case-insensitive, so the namespaced id is lowercased to keep
      // one row per session; rawId stays as received for display.
      id: remote ? `${VM_HOST}:${rawId.toLowerCase()}` : rawId,
      rawId,
      pid: remote ? null : (Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : null),
      name: typeof raw.name === 'string' ? stripControls(raw.name.slice(0, PAYLOAD_STRING_MAX)) : '',
      cwd: typeof raw.cwd === 'string' ? stripControls(raw.cwd.slice(0, PAYLOAD_STRING_MAX)) : '',
      // A payload that omits kind is an interactive session; '' would mark it (vm bg).
      kind: typeof raw.kind === 'string' ? stripControls(raw.kind.slice(0, PAYLOAD_STRING_MAX)) : (remote ? 'interactive' : ''),
      status: status || 'unknown',
      startedAt: isEpochMs(raw.startedAt) ? raw.startedAt : null,
      statusUpdatedAt: null,
      summary: '',
      remote,
      host: remote ? VM_HOST : null,
      tmuxSession: remote ? validTmuxSession(raw.tmuxSession) : null,
    })
  }
  return rows
}

// One VM payload in, one validated row or null out — the entry point the
// listener and its tests call.
function validateVmRow(payload) {
  return validateRows([payload], { remote: true })[0] || null
}

// Reaches an ssh argv in the focus path, so it is allow-listed rather than
// escaped. A name that fails is dropped to null; the row itself still shows.
function validTmuxSession(raw) {
  if (typeof raw !== 'string') return null
  const name = stripControls(raw)
  return TMUX_SESSION_RE.test(name) ? name : null
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
  // Before any path building: a VM cwd could otherwise mangle into a real
  // local transcript path and show another session's text.
  if (row.remote) return ''
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
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitize(text) {
  return truncate(stripControls(text), SUMMARY_MAX_CHARS)
}

// --- Sort and naming -----------------------------------------------------
//
// Tab order is the primary key: a row that moves when its status changes breaks
// the mapping between the row a person reads and the Cmd+number they press, and
// stability is worth more here than putting the urgent row first — the bell and
// the WAITING_LABEL marker carry that. Rows iTerm knows nothing about — VM rows,
// background sessions, a pid whose tty is gone — sort after the tabbed ones on a
// key that ignores status, so they hold their relative order across ticks.
//
// With no tab order at all (no iTerm, Linux, --once) the urgency sort is the
// fallback, unannounced: unknown statuses sort last there so they surface at the
// bottom rather than mixing into the known ranks.
//
// Names are per-poll: a name shared with another row in the same frame is as
// useless as an empty one, so both fall back to the cwd basename plus a short id.

function rankOf(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, status) ? STATUS_RANK[status] : UNKNOWN_STATUS_RANK
}

function byStartThenId(a, b) {
  const aStart = a.startedAt === null ? Number.MAX_SAFE_INTEGER : a.startedAt
  const bStart = b.startedAt === null ? Number.MAX_SAFE_INTEGER : b.startedAt
  if (aStart !== bStart) return aStart - bStart
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function sortRows(rows, tabIndex) {
  const tabbed = Boolean(tabIndex) && tabIndex.size > 0
  return rows.slice().sort((a, b) => {
    if (tabbed) {
      const at = tabIndex.has(a.id) ? tabIndex.get(a.id) : Number.MAX_SAFE_INTEGER
      const bt = tabIndex.has(b.id) ? tabIndex.get(b.id) : Number.MAX_SAFE_INTEGER
      if (at !== bt) return at - bt
    } else {
      const byRank = rankOf(a.status) - rankOf(b.status)
      if (byRank !== 0) return byRank
    }
    return byStartThenId(a, b)
  })
}

function resolveNames(rows) {
  // Counted per source: a VM payload naming itself after a local session must
  // not push that local row onto its fallback label.
  const counts = new Map()
  const keyOf = (row) => `${row.remote}:${row.name}`
  for (const row of rows) {
    if (row.name) counts.set(keyOf(row), (counts.get(keyOf(row)) || 0) + 1)
  }
  for (const row of rows) {
    row.label = !row.name || counts.get(keyOf(row)) > 1
      ? `${path.basename(row.cwd) || '?'} ${row.rawId.slice(0, 8)}`
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
  const stateWidth = Math.min(STATE_CAP, Math.max(STATE_WIDTH, ...rows.map((r) => Array.from(r.stateCell).length)))
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
    const cells = [row.stateCell, row.ageCell, row.nameCell]
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

// A row can be both remote and background, and two separate suffixes would cost
// eight of NAME_CAP's characters. One parenthesized group holds both.
function nameMarker(row) {
  const tags = []
  if (row.remote) tags.push('vm')
  if (row.kind !== 'interactive') tags.push('bg')
  return tags.length === 0 ? '' : ` (${tags.join(' ')})`
}

function decorateRows(rows, observed, now) {
  resolveNames(rows)
  for (const row of rows) {
    // A flag, not a status: the real status still drives the age, the sort
    // rank, and the transitions the bell reads.
    row.stateCell = row.stale ? VM_STALE_LABEL : row.status === 'waiting' ? WAITING_LABEL : row.status
    row.ageCell = formatAge(ageMsFor(row, observed, now))
    row.nameCell = row.label + nameMarker(row)
    row.dirCell = row.remote ? row.cwd : shortenDir(row.cwd)
    row.summary = row.remote ? '' : summaryFor(row)
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
  if (noTableYet(state) || state.lastRows.length === 0) return -1
  const index = state.highlight.index
  return index >= 0 && index < state.lastRows.length ? index + 2 : -1
}

// A never-good local poll is only a bare error body while there is nothing
// else to show; VM rows outrank it.
function noTableYet(state) {
  return state.poll === 'never-good' && state.vmRows.size === 0
}

function frameLines(state, width, now) {
  const lines = []
  if (noTableYet(state)) {
    lines.push(ERROR_BODIES[state.error] || `registry error: ${state.error}`)
    lines.push('')
    lines.push(`polled ${stamp(now)}  ·  no successful poll yet`)
    // Also here: a listener that never bound is exactly the case where there
    // are no VM rows to push the frame out of this branch.
    lines.push(...vmFooterLines(state))
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

  if (state.poll === 'never-good') {
    lines.push(`polled ${stamp(now)}  ·  ${ERROR_BODIES[state.error] || state.error} (no successful poll yet)`)
  } else if (state.poll === 'stale') {
    const age = formatAge(Math.max(0, now - state.lastGoodAt))
    lines.push(`polled ${stamp(now)}  ·  ${ERROR_BODIES[state.error] || state.error} (last good poll ${age} ago)`)
  } else {
    lines.push(`polled ${stamp(now)}  ·  ${state.lastRows.length} session${state.lastRows.length === 1 ? '' : 's'}`)
  }
  lines.push(...vmFooterLines(state))
  if (state.transient) lines.push(state.transient)
  if (state.mode === 'rename') lines.push(RENAME_PROMPT + state.renameBuffer)
  return lines
}

// --- Poll tick -----------------------------------------------------------
//
// One tick: read, validate, enrich, observe, decorate, fold into the poll
// state. Unit 3 wraps this in a re-armed timer; it deliberately owns no timing
// or rendering of its own.
//
// The poll state and the footer describe the *local* poll only. A failed local
// poll reuses the last good local rows rather than returning early, so VM rows
// still reach the table.

function vmRowsAsRows(state) {
  return Array.from(state.vmRows.values())
}

// Tick-driven, because silence is not an event and nothing else will wake for
// it. Compared against the Mac receipt time, so a VM clock running ahead cannot
// make a row look fresh. The flag is deliberately not a status: overwriting the
// status would reset the age, drop the row to the unknown sort rank, and make
// the return to `waiting` an entry the bell rings on. The next real event
// replaces the whole row object in applyVmEvent, which clears the flag. Local
// rows are never touched — this reads state.vmRows only.
function ageOutVmRows(state, now) {
  for (const [id, row] of state.vmRows) {
    const quiet = now - row.receivedAt
    if (quiet >= VM_EVICT_MS) {
      state.vmRows.delete(id)
    } else if (quiet >= VM_STALE_MS) {
      row.stale = true
    }
  }
}

function tick(state, opts) {
  const now = Date.now()
  const result = opts.fixture ? readFixture(opts.fixture) : readRegistry()

  if (result.ok) {
    state.lastLocalRows = enrichRows(validateRows(result.rows))
    state.lastGoodAt = now
    state.error = null
    state.poll = 'good'
  } else {
    state.error = result.error
    state.poll = state.poll === 'never-good' ? 'never-good' : 'stale'
  }

  ageOutVmRows(state, now)
  return renderRows(state, now)
}

function renderRows(state, now) {
  const rows = state.lastLocalRows.concat(vmRowsAsRows(state))
  const transitions = observeRows(state.observed, rows, now)
  state.lastRows = sortRows(decorateRows(rows, state.observed, now), tabIndexOf(state, rows))
  return transitions
}

function newState() {
  return {
    poll: 'never-good',
    error: null,
    lastRows: [],
    lastLocalRows: [],
    lastGoodAt: null,
    observed: new Map(),
    tabByTty: new Map(),
    ttyByPid: new Map(),
    vmRows: new Map(),
    vmEnded: new Map(),
    vmToken: null,
    vmAuthRejects: 0,
    vmDropped: 0,
    listenError: null,
    listenNote: null,
    mode: 'normal',
    interactive: false,
    highlight: { id: null, index: -1 },
    renameBuffer: '',
    renameTarget: null,
    transient: null,
    focusGen: 0,
  }
}

// --- VM listener ---------------------------------------------------------
//
// The first network input in this repo. Everything in this section is
// transport: authenticate, bound the body, hand one parsed object to
// applyVmEvent. Bound to 127.0.0.1, so the callers it can reach are local
// processes and whatever the ssh reverse forward carries.
//
// What the token does and does not defend is in dashboard/CLAUDE.md.
//
// The custom auth header is itself the CSRF defense: a browser cannot attach
// one cross-origin without a successful preflight, and the non-POST rejection
// kills the preflight. Requiring application/json forces a preflight for the
// same reason. The Origin check is a belt, not the buckle — curl sends no
// Origin at all — so it is never the thing to keep if the others are relaxed.

let listenServer = null

// null means there is no token file yet and the caller may create one;
// TOKEN_REFUSED means one is there but unusable, and writing over it would
// rotate a secret the VM still holds — or clobber a file this process cannot
// even read.
const TOKEN_REFUSED = Symbol('token refused')

function readToken(state) {
  let st
  try {
    st = fs.lstatSync(TOKEN_PATH)
  } catch (e) {
    return e.code === 'ENOENT' ? null : TOKEN_REFUSED
  }
  if (st.isSymbolicLink() || !st.isFile() || st.size > TOKEN_MAX_BYTES) return TOKEN_REFUSED
  if ((st.mode & 0o077) !== 0) {
    state.listenNote = `${stripControls(TOKEN_PATH)} is readable beyond this user — chmod 600 it`
  }
  let raw
  try {
    let fd
    try {
      fd = fs.openSync(TOKEN_PATH, fs.constants.O_RDONLY | O_NOFOLLOW)
      const buf = Buffer.alloc(TOKEN_MAX_BYTES)
      const n = fs.readSync(fd, buf, 0, TOKEN_MAX_BYTES, 0)
      raw = buf.slice(0, n).toString('utf8')
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
  } catch (e) {
    return TOKEN_REFUSED
  }
  const token = raw.trim()
  return TOKEN_RE.test(token) ? token : TOKEN_REFUSED
}

// 0600 at open time rather than a chmod afterwards: a secret that is briefly
// world-readable has already leaked.
function writeToken() {
  const dir = path.dirname(TOKEN_PATH)
  fs.mkdirSync(dir, { recursive: true })
  try {
    if (fs.lstatSync(TOKEN_PATH).isSymbolicLink()) return null
  } catch (e) {
    if (e.code !== 'ENOENT') return null
  }
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex')
  const temp = path.join(dir, `.dash-token.${process.pid}.${Date.now()}`)
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW
  try {
    let fd
    try {
      fd = fs.openSync(temp, flags, 0o600)
      fs.writeSync(fd, token + '\n')
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
    fs.renameSync(temp, TOKEN_PATH)
  } catch (e) {
    // Otherwise a failed write strands a live token in a 0600 file nothing reads.
    try { fs.unlinkSync(temp) } catch (e2) { /* never created */ }
    throw e
  }
  return token
}

function resolveToken(state) {
  const existing = readToken(state)
  if (existing === TOKEN_REFUSED) {
    state.listenError = `${stripControls(TOKEN_PATH)} exists but could not be read — fix or delete it; VM rows are off for this run`
    return null
  }
  if (existing !== null) return existing
  let token
  try {
    token = writeToken()
  } catch (e) {
    token = null
  }
  if (token !== null) state.listenNote = `new token at ${stripControls(TOKEN_PATH)} — copy it to the VM as 0600 for VM rows to appear`
  return token
}

function startListener(state, port) {
  state.vmToken = resolveToken(state)
  if (state.vmToken === null) {
    if (state.listenError === null) {
      state.listenError = `could not create ${stripControls(TOKEN_PATH)} — VM rows are off for this run`
    }
    return null
  }
  const server = http.createServer((req, res) => handleVmRequest(state, req, res))
  server.maxConnections = VM_MAX_CONNECTIONS
  server.on('error', (e) => {
    state.listenError = e.code === 'EADDRINUSE'
      ? `port ${port} is already in use — VM rows are off for this run`
      : `VM listener error: ${stripControls(String((e && (e.code || e.message)) || e))}`
  })
  server.listen(port, LISTEN_HOST)
  listenServer = server
  return server
}

function rejectVm(res, code) {
  res.statusCode = code
  res.end()
}

function handleVmRequest(state, req, res) {
  if (req.method !== 'POST') return rejectVm(res, 405)
  const token = req.headers[VM_TOKEN_HEADER]
  if (typeof token !== 'string' || token !== state.vmToken) {
    state.vmAuthRejects += 1
    return rejectVm(res, 401)
  }
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') return rejectVm(res, 415)
  if (req.headers.origin !== undefined) return rejectVm(res, 403)

  const chunks = []
  let size = 0
  req.on('data', (chunk) => {
    if (req.destroyed) return
    size += chunk.length
    // Cut off while streaming: measuring after the fact means the hostile bytes
    // are already in this process's heap.
    if (size > VM_BODY_MAX_BYTES) {
      rejectVm(res, 413)
      req.destroy()
      return
    }
    chunks.push(chunk)
  })
  req.on('error', () => { /* a client that vanished mid-body is not an event */ })
  req.on('end', () => {
    if (req.destroyed) return
    let payload
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (e) {
      return rejectVm(res, 400)
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return rejectVm(res, 400)
    applyVmEvent(state, payload, Date.now())
    res.statusCode = 204
    res.end()
  })
}

// --- VM event application ------------------------------------------------
//
// The other half of the listener, and the only writer of state outside tick.
// It writes state.vmRows and never state.lastRows, which the next tick
// overwrites. A handler landing just after a paint leaves the frame one event
// behind until that tick — up to one poll interval of display lag, accepted.
//
// Everything a payload contributes goes through validateVmRow: no row is ever
// built by hand here.

function dropVmEvent(state) {
  state.vmDropped += 1
}

function applyVmEvent(state, payload, now) {
  const ending = payload.event === VM_END_EVENT
  // Only the five events the emitter sends map to anything. SubagentStop is
  // deliberately not among them: a subagent finishing does not change whether
  // the human is needed, and mapping it to busy would clear a waiting row that
  // is still waiting.
  const status = ending ? 'idle' : VM_EVENT_STATUS[payload.event]
  if (status === undefined) return dropVmEvent(state)
  if (!Number.isInteger(payload.seq) || payload.seq < 0 || payload.seq > VM_SEQ_MAX) return dropVmEvent(state)

  // Built even for SessionEnd, which needs only the id: namespacing lives in
  // one place, and it is the validator's.
  const row = validateVmRow({
    sessionId: payload.sessionId,
    status,
    name: payload.name,
    cwd: payload.cwd,
    kind: payload.kind,
    tmuxSession: payload.tmuxSession,
  })
  if (row === null) return dropVmEvent(state)

  const endedUntil = state.vmEnded.get(row.id)
  if (endedUntil !== undefined) {
    if (endedUntil > now) return dropVmEvent(state)
    state.vmEnded.delete(row.id)
  }

  const prior = state.vmRows.get(row.id)
  // A lower seq is accepted once the row has gone quiet for the SessionEnd
  // window, so a stale jump or a reset emitter counter unfreezes the row on the
  // same timescale instead of dropping every later event forever.
  if (prior !== undefined && payload.seq <= prior.seq && now - prior.receivedAt <= VM_END_STICKY_MS) {
    return dropVmEvent(state)
  }

  if (ending) {
    state.vmRows.delete(row.id)
    noteVmEnd(state, row.id, now)
    return
  }
  // A loop of POSTs with fresh uuids would otherwise grow the map without
  // bound; at the cap the least recently heard-from row gives way, so a flood
  // cannot lock a real session out of the table.
  if (prior === undefined && state.vmRows.size >= VM_ROWS_MAX) {
    state.vmRows.delete(oldestKey(state.vmRows, (held) => held.receivedAt))
  }

  row.seq = payload.seq
  // Mac-observed: a VM clock even slightly ahead would pin ages at 0s forever.
  row.receivedAt = now
  state.vmRows.set(row.id, row)
}

function noteVmEnd(state, id, now) {
  for (const [key, until] of state.vmEnded) {
    if (until <= now) state.vmEnded.delete(key)
  }
  if (state.vmEnded.size >= VM_ROWS_MAX) {
    state.vmEnded.delete(oldestKey(state.vmEnded, (until) => until))
  }
  state.vmEnded.set(id, now + VM_END_STICKY_MS)
}

function oldestKey(map, at) {
  let key = null
  let oldest = Infinity
  for (const [candidate, value] of map) {
    const when = at(value)
    if (when < oldest) {
      oldest = when
      key = candidate
    }
  }
  return key
}

// A rotated token is otherwise total, silent VM-row loss: the emitter exits 0
// and says nothing, so the Mac would just show an empty table. One line each,
// not one joined line — every frame line is truncated to the terminal width,
// and the token path alone is long enough to eat the counters.
function vmFooterLines(state) {
  const lines = []
  if (state.listenError) lines.push(state.listenError)
  if (state.listenNote) lines.push(state.listenNote)
  if (state.vmAuthRejects > 0) {
    lines.push(`${state.vmAuthRejects} VM request${state.vmAuthRejects === 1 ? '' : 's'} rejected — the VM's token copy may be stale`)
  }
  if (state.vmDropped > 0) lines.push(`${state.vmDropped} VM event${state.vmDropped === 1 ? '' : 's'} dropped`)
  return lines
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

// --- Tab order -----------------------------------------------------------
//
// Row N is tab N. Two spawns feed it — one `ps` resolving every local row's pid
// to a tty, one osascript walking windows -> tabs -> sessions for each tty's
// position — and both run off the tick with the result cached in state, so the
// poll, the paint, and the key loop never wait on iTerm. The cost is that a new
// tab reaches its sort position one poll late, which is invisible at a two
// second interval.
//
// Ordering is (window index, tab index), so "row N is tab N" holds inside the
// frontmost window and further windows stack after it in iTerm's own order —
// Cmd+number only ever addresses the current window's tabs.
//
// `is running` guards the tell block because `tell application` would otherwise
// launch iTerm, and nothing here activates it: this is a read twice a second and
// it must not steal focus. The integers are coerced with `as text` so `&`
// concatenates rather than building a list, and each read is wrapped in `try`
// so a session whose `tty` cannot be read is skipped rather than aborting the
// traversal and costing the whole order.

function tabOrderScript() {
  return [
    `if application id "${ITERM_BUNDLE_ID}" is not running then return ""`,
    `tell application id "${ITERM_BUNDLE_ID}"`,
    'set out to ""',
    'repeat with wi from 1 to count of windows',
    'repeat with ti from 1 to count of tabs of window wi',
    'repeat with s in sessions of tab ti of window wi',
    'try',
    'set out to out & (wi as text) & " " & (ti as text) & " " & (tty of s) & linefeed',
    'end try',
    'end repeat',
    'end repeat',
    'end repeat',
    'return out',
    'end tell',
  ].join('\n')
}

// `<window> <tab> <tty>` per line. Sorted rather than trusted in emitted order,
// so an ordinal means (window, tab) and not "whatever the script printed first";
// two sessions split across one tab take consecutive ordinals.
function parseTabOrder(out) {
  const entries = []
  for (const line of String(out).split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length !== 3) continue
    const win = Number.parseInt(parts[0], 10)
    const tab = Number.parseInt(parts[1], 10)
    const tty = normalizeTty(parts[2])
    if (!Number.isInteger(win) || !Number.isInteger(tab) || tty === null) continue
    entries.push({ win, tab, tty })
  }
  entries.sort((a, b) => (a.win - b.win) || (a.tab - b.tab))
  const order = new Map()
  for (const entry of entries) {
    if (!order.has(entry.tty)) order.set(entry.tty, order.size)
  }
  return order
}

// `<pid> <tty>` per line, `??` for a process with no controlling terminal.
function parseTtyByPid(out) {
  const map = new Map()
  for (const line of String(out).split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length !== 2) continue
    const pid = Number.parseInt(parts[0], 10)
    const tty = normalizeTty(parts[1])
    if (!Number.isInteger(pid) || pid <= 0 || tty === null) continue
    map.set(pid, tty)
  }
  return map
}

function tabIndexOf(state, rows) {
  const index = new Map()
  for (const row of rows) {
    if (row.pid === null) continue
    const tty = state.ttyByPid.get(row.pid)
    const at = tty === undefined ? undefined : state.tabByTty.get(tty)
    if (at !== undefined) index.set(row.id, at)
  }
  return index
}

// One query in flight at a time: a slow osascript would otherwise stack two
// spawns per poll on top of the ~165 ms the poll already costs. The child is
// held so restore() and the watchdog can kill it, and the watchdog is there
// because a callback that never fires would strand the flag and freeze the
// order at whatever was last cached.
let tabQueryPending = false
let tabQueryChild = null
let tabQueryWatchdog = null
let tabQueryFailures = 0
const TAB_QUERY_WATCHDOG_MS = TAB_QUERY_TIMEOUT_MS + 500
const TAB_QUERY_FAILURES_MAX = 5

function endTabQuery() {
  if (tabQueryWatchdog !== null) {
    clearTimeout(tabQueryWatchdog)
    tabQueryWatchdog = null
  }
  tabQueryChild = null
  tabQueryPending = false
}

function abortTabQuery() {
  try {
    if (tabQueryChild) tabQueryChild.kill()
  } catch (e) {
    // Already exited, or never a real child; clearing the flag matters more.
  }
  endTabQuery()
}

function refreshTabOrder(state) {
  // osascript exists only on the Mac: elsewhere this would spawn a doomed
  // process every two seconds to learn nothing.
  if (process.platform !== 'darwin') return
  if (tabQueryPending) return
  tabQueryPending = true
  tabQueryWatchdog = setTimeout(() => {
    tabQueryWatchdog = null
    if (!tabQueryPending) return
    abortTabQuery()
  }, TAB_QUERY_WATCHDOG_MS)
  // Same PID_RE guard the two pid -> argv sites in the focus path use: one
  // out-of-range pid must not be able to blank the whole tab order.
  const pids = state.lastRows
    .filter((row) => row.pid !== null && PID_RE.test(String(row.pid)))
    .map((row) => String(row.pid))
  try {
    tabQueryChild = execFile('osascript', ['-e', tabOrderScript()], { timeout: TAB_QUERY_TIMEOUT_MS, encoding: 'utf8' }, (scriptErr, scriptOut) => {
      // A failed or timed-out query keeps the previous map rather than clearing
      // it: one hung iTerm would otherwise reshuffle every row for a tick, which
      // is the instability tab-order sorting exists to remove. Only for a
      // handful of ticks, though — a permanently broken query would otherwise
      // pin the table to a snapshot forever. An empty result (iTerm not running)
      // is a successful answer and does clear it, dropping the sort to its
      // urgency fallback with nothing said.
      if (scriptErr) {
        tabQueryFailures += 1
        if (tabQueryFailures >= TAB_QUERY_FAILURES_MAX) {
          state.tabByTty = new Map()
          state.ttyByPid = new Map()
        }
        endTabQuery()
        return
      }
      tabQueryFailures = 0
      const tabByTty = parseTabOrder(scriptOut)
      if (tabByTty.size === 0 || pids.length === 0) {
        state.tabByTty = tabByTty
        state.ttyByPid = new Map()
        endTabQuery()
        return
      }
      // `ps -p` exits non-zero as soon as one listed pid is gone, which is the
      // normal case for a row that just exited, so the output is the signal here
      // and the exit status is not. A failure with nothing on stdout is a failed
      // query rather than an empty answer, and keeps both cached maps.
      try {
        tabQueryChild = execFile('ps', ['-o', 'pid=,tty=', '-p', pids.join(',')], { timeout: TAB_QUERY_TIMEOUT_MS, encoding: 'utf8' }, (psErr, psOut) => {
          if (psErr && (typeof psOut !== 'string' || psOut.trim() === '')) {
            endTabQuery()
            return
          }
          state.tabByTty = tabByTty
          state.ttyByPid = parseTtyByPid(psOut)
          endTabQuery()
        })
      } catch (e) {
        endTabQuery()
      }
    })
  } catch (e) {
    // A spawn that throws synchronously (EMFILE, EAGAIN) must not strand the
    // flag: the next tick has to be free to try again.
    endTabQuery()
  }
}

// --- Tab focus -----------------------------------------------------------
//
// Enter hands the highlighted row to iTerm: pid -> tty via `ps`, tty -> tab via
// AppleScript. A VM row has no pid to resolve, so it takes its own path — the
// devbox tab by name, then `tmux switch-client` over ssh. Every call is async
// with a timeout because a hung iTerm, a modal dialog, or an unreachable devbox
// would otherwise freeze the paint loop, the poll timer, and every keystroke for
// as long as it takes. Nothing here can fail loudly: a dead pid, a missing
// iTerm, a script error, or a failed ssh becomes one transient footer line.
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

// `condition` is the AppleScript test that picks the session and `result` the
// expression returned once one matches; the result is prefixed with a marker so
// a read-back tab name can never be mistaken for the no-match sentinel. Both
// are assembled by the callers below from validated or constant text only.
function sessionScript(condition, body, result = '"ok"') {
  return [
    `tell application id "${ITERM_BUNDLE_ID}"`,
    'repeat with w in windows',
    'repeat with t in tabs of w',
    'repeat with s in sessions of t',
    `if ${condition} then`,
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

const FOCUS_BODY = ['select s', 'select t', 'select w', 'activate']

function focusScript(tty) {
  return sessionScript(`tty of s is "${tty}"`, FOCUS_BODY)
}

// iTerm's dictionary has no "running command" property, so the devbox tab is
// found by its session name: an `ssh ro-devbox` tab carries the alias there
// from the job name, and a remote shell that sets its own title carries it too.
// Built from VM_HOST alone — no byte of a row reaches this script, which is the
// one place a forged row could otherwise reach an interpreter.
function vmFocusScript() {
  return sessionScript(`name of s contains "${VM_HOST}"`, FOCUS_BODY)
}

// An argv array, never a shell string: a metacharacter that slipped past
// TMUX_SESSION_RE stays inert as one argument. Without BatchMode an unknown
// host key prompts on /dev/tty, which blocks for the whole timeout and paints
// over the frame. The options precede the host so ssh cannot read them as the
// remote command.
const SSH_ARGS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=2']

function tmuxListClientsArgs() {
  return SSH_ARGS.concat([VM_HOST, 'tmux', 'list-clients', '-F', '#{client_tty}'])
}

// switch-client without -c moves whichever client tmux saw most recently, and
// selecting the iTerm tab does not bump tmux activity — so with two attached
// clients the focused tab could keep showing its old session.
function tmuxSwitchArgs(clientTty, tmuxSession) {
  return SSH_ARGS.concat([VM_HOST, 'tmux', 'switch-client', '-c', clientTty, '-t', tmuxSession])
}

function firstTmuxClient(out) {
  for (const line of String(out).split('\n')) {
    const tty = line.trim()
    if (TMUX_CLIENT_TTY_RE.test(tty)) return tty
  }
  return null
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
  return sessionScript(`tty of s is "${tty}"`, [`set name of s to "${escapeAppleScriptString(name)}"`], 'name of s')
}

function setTransient(state, message) {
  state.transient = message
  paint(state)
}

// Held so restore() can kill it: quitting mid-focus would otherwise leave
// osascript or ssh running against a terminal already handed back.
let focusChild = null

function trackFocusChild(child) {
  focusChild = child
  return child
}

// Two overlapping Enter presses finish in whatever order osascript and ssh
// return, so only the newest attempt may write the footer.
function focusReporter(state) {
  const gen = ++state.focusGen
  return (message) => {
    if (gen === state.focusGen) setTransient(state, message)
  }
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

// One osascript call path for focus and rename. `report` takes the footer
// message, so a superseded focus attempt can drop it. `onOk` receives whatever
// the script returned after the success marker — empty for focus, the tab's
// read-back name for rename. `noMatch` is the message for a script that ran but
// found no session, which names a tty locally and the devbox tab remotely.
function runSessionScript(report, script, verb, noMatch, onOk) {
  trackFocusChild(execFile('osascript', ['-e', script], { timeout: FOCUS_TIMEOUT_MS, encoding: 'utf8' }, (scriptErr, scriptOut) => {
    if (scriptErr) {
      report(`could not ${verb} the tab — is iTerm running?`)
      return
    }
    const out = String(scriptOut).trim()
    if (!out.startsWith(SCRIPT_OK_PREFIX)) {
      report(noMatch)
      return
    }
    onOk(out.slice(SCRIPT_OK_PREFIX.length))
  }))
}

function focusHighlighted(state) {
  const row = state.lastRows[state.highlight.index]
  if (!row) return
  // Before withRowTty, whose contract is pid-to-tty: a VM row carries no pid by
  // design, so reaching it would report the session as exited.
  if (row.remote) return focusVmRow(state, row)
  const report = focusReporter(state)
  withRowTty(state, row, (tty) => {
    runSessionScript(report, focusScript(tty), 'focus', `no iTerm tab is attached to ${tty}.`, () => report(null))
  })
}

function focusVmRow(state, row) {
  // Snapshotted, not re-read: a session that ends mid-flight leaves the switch
  // pointing at a tmux session that just went away, which is accepted for the
  // same reason the pid-reuse window is.
  const tmuxSession = row.tmuxSession
  const report = focusReporter(state)
  runSessionScript(report, vmFocusScript(), 'focus', `no iTerm tab is running ssh ${VM_HOST}.`, () => {
    if (tmuxSession === null) {
      report(`focused the ${VM_HOST} tab — tmux session not detected.`)
      return
    }
    trackFocusChild(execFile('ssh', tmuxListClientsArgs(), { timeout: FOCUS_TIMEOUT_MS, encoding: 'utf8' }, (listErr, listOut) => {
      const clientTty = listErr ? null : firstTmuxClient(listOut)
      if (clientTty === null) {
        report(`focused the ${VM_HOST} tab, but tmux could not switch to ${tmuxSession} — no tmux client attached.`)
        return
      }
      trackFocusChild(execFile('ssh', tmuxSwitchArgs(clientTty, tmuxSession), { timeout: FOCUS_TIMEOUT_MS, encoding: 'utf8' }, (err) => {
        report(err ? `focused the ${VM_HOST} tab, but tmux could not switch to ${tmuxSession}.` : null)
      }))
    }))
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
  if (row.remote) return setTransient(state, 'rename is local-only — VM tab names come from the devbox session')
  withRowTty(state, row, (tty) => {
    runSessionScript((message) => setTransient(state, message), renameScript(tty, name), 'rename', `no iTerm tab is attached to ${tty}.`, (actual) => {
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
    if (focusChild) focusChild.kill()
  } catch (e) {
    // Already exited, or never a real child; the exit matters more.
  }
  abortTabQuery()
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
  // close() only initiates teardown — an exit handler cannot run async code, so
  // its callback never fires. unref() is the half that does the work: it stops
  // an idle-but-listening socket from holding the process open past `q`. An
  // in-flight POST is dropped rather than drained, which costs nothing because
  // the emitter never waits for a response.
  if (listenServer !== null) {
    try {
      listenServer.close()
      listenServer.unref()
    } catch (e) {
      // A socket that is already gone needs no teardown.
    }
    listenServer = null
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
  if (opts.listen !== null) startListener(state, opts.listen)
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
    // After the paint, never before it: the frame must not wait on iTerm.
    refreshTabOrder(state)
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
  // j up, k down — the reverse of vi, less, git, and tmux, deliberately: this
  // is a single-user tool and the binding that matches the owner's hands wins.
  if (code === KEY_J || key === SEQ_UP) {
    moveHighlight(state, -1)
    paint(state)
  } else if (code === KEY_K || key === SEQ_DOWN) {
    moveHighlight(state, 1)
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
    process.stderr.write(`dash: stdout is not a terminal; printing one frame as with --once${opts.listen === null ? '' : ' (--listen is inactive)'}.\n`)
    opts.once = true
  }
  if (opts.once) {
    process.exitCode = runOnce(opts)
    return
  }
  runLive(opts)
}

if (require.main === module) main()

// The only testing seam this file has: a VM payload in (validateVmRow), an
// event applied to a state (applyVmEvent over newState), the listener itself,
// which cannot otherwise be reached without a pty, the focus path — its script
// and argv builders plus both entry points, none of which can be exercised at
// all without iTerm and a live devbox — staleness, which needs a clock handed to
// ageOutVmRows and renderRows to reach the rendered cells, and tab-order
// sorting, whose two query outputs cannot be produced off a Mac: the parsers
// take that output as text, sortRows takes the resulting map, and handleKey with
// moveHighlight covers the j/k swap without a pty.
module.exports = {
  validateVmRow,
  applyVmEvent,
  newState,
  startListener,
  focusScript,
  renameScript,
  vmFocusScript,
  tmuxListClientsArgs,
  tmuxSwitchArgs,
  focusHighlighted,
  focusVmRow,
  ageOutVmRows,
  renderRows,
  sortRows,
  parseTabOrder,
  parseTtyByPid,
  tabIndexOf,
  handleKey,
  moveHighlight,
}
