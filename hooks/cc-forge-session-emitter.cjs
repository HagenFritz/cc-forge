#!/usr/bin/env node
// cc-forge — session emitter hook for the dashboard's VM rows.
//
// Posts one state transition per hook event to a listener on
// 127.0.0.1:45800 (DASH_EMIT_PORT overrides), which an ssh reverse forward
// carries to `dash.js --listen 45801` on the Mac. Those two ports are the
// documented default pair; see dashboard/CLAUDE.md.
//
// This runs inside the user's session on every prompt, so it never waits: a
// 300 ms socket timeout, no response body read, every failure silent, exit 0
// on every path. A lost event is cheaper than a stalled keystroke.

'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')
const { execFileSync } = require('child_process')

const EMIT_EVENTS = new Set([
  'SessionStart',
  'UserPromptSubmit',
  'Notification',
  'PermissionRequest',
  'Stop',
  'SessionEnd',
])
const END_EVENT = 'SessionEnd'

const EMIT_HOST = '127.0.0.1'
const EMIT_PORT_DEFAULT = 45800
const SOCKET_TIMEOUT_MS = 300
const TMUX_TIMEOUT_MS = 200

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_RE = /^[0-9a-f]{64}$/
const SEQ_RE = /^[0-9]{1,10}$/
// The listener's own allow-list: a name that fails there arrives as null
// anyway, and this one reaches an ssh argv on the Mac.
const TMUX_SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const TOKEN_MAX_BYTES = 128
const SEQ_MAX_BYTES = 16
const SEQ_MAX = 2 ** 32
const CWD_MAX = 256

const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
const CLAUDE_DIR = path.join(os.homedir(), '.claude')
const TOKEN_PATH = path.join(CLAUDE_DIR, '.dash-token')
const SEQ_DIR = path.join(CLAUDE_DIR, 'dash-seq')

// --- Symlink-safe file primitives (the caveman hook's idiom) --------------

function readSmallFile(file, maxBytes) {
  try {
    const st = fs.lstatSync(file)
    if (st.isSymbolicLink() || !st.isFile() || st.size > maxBytes) return null
    let fd
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | O_NOFOLLOW)
      const buf = Buffer.alloc(maxBytes)
      const n = fs.readSync(fd, buf, 0, maxBytes, 0)
      return buf.slice(0, n).toString('utf8')
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
  } catch (e) {
    return null
  }
}

function writeSmallFile(file, content) {
  const temp = `${file}.${process.pid}.${Date.now()}`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    fs.chmodSync(path.dirname(file), 0o700)
    try {
      if (fs.lstatSync(file).isSymbolicLink()) return
    } catch (e) {
      if (e.code !== 'ENOENT') return
    }
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW
    let fd
    try {
      fd = fs.openSync(temp, flags, 0o600)
      fs.writeSync(fd, content)
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
    fs.renameSync(temp, file)
  } catch (e) {
    try { fs.unlinkSync(temp) } catch (e2) { /* never created */ }
  }
}

function readToken() {
  // The VM-side 0600 is load-bearing: a token any other local process can
  // read defends nothing, so an over-permissive file is treated as absent.
  try {
    if (fs.lstatSync(TOKEN_PATH).mode & 0o077) return null
  } catch (e) {
    return null
  }
  const raw = readSmallFile(TOKEN_PATH, TOKEN_MAX_BYTES)
  if (raw === null) return null
  const token = raw.trim()
  return TOKEN_RE.test(token) ? token : null
}

// --- Per-session sequence ------------------------------------------------
//
// A fresh process per event, so the counter has to outlive it. The Mac
// accepts a lower seq again once the row has been quiet for its sticky
// window, so a counter that resets costs one dropped event at worst.

// The successor has to stay under the listener's ceiling, which drops only
// what is strictly above it: a prior of SEQ_MAX - 1 emits SEQ_MAX, accepted
// once and then pinning the row forever.
function nextSeq(sessionId) {
  const raw = readSmallFile(path.join(SEQ_DIR, sessionId), SEQ_MAX_BYTES)
  const prior = raw !== null && SEQ_RE.test(raw.trim()) ? Number(raw.trim()) : -1
  return prior >= 0 && prior + 1 < SEQ_MAX ? prior + 1 : 0
}

function saveSeq(sessionId, seq) {
  writeSmallFile(path.join(SEQ_DIR, sessionId), String(seq))
}

function dropSeq(sessionId) {
  try { fs.unlinkSync(path.join(SEQ_DIR, sessionId)) } catch (e) { /* silent */ }
}

// --- tmux ----------------------------------------------------------------
//
// A session opened with plain `devbox ssh` has no tmux at all and must still
// report, so every failure here is a null name rather than a skipped event.

function tmuxSession() {
  if (!process.env.TMUX) return null
  const pane = process.env.TMUX_PANE
  const args = pane ? ['display-message', '-t', pane, '-p', '#S'] : ['display-message', '-p', '#S']
  try {
    const out = execFileSync('tmux', args, {
      timeout: TMUX_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim()
    return TMUX_SESSION_RE.test(out) ? out : null
  } catch (e) {
    return null
  }
}

// --- Emit ----------------------------------------------------------------

function emitPort() {
  const raw = Number(process.env.DASH_EMIT_PORT)
  return Number.isInteger(raw) && raw >= 1024 && raw <= 65535 ? raw : EMIT_PORT_DEFAULT
}

// Only the permission prompt means a human is needed; idle_prompt would
// otherwise show a session as waiting when nothing is blocked. The matcher in
// hooks.json already narrows this — the payload check is the guard for a
// matcher that stops narrowing.
function needsPermission(data) {
  const kind = data.notification_type
  if (typeof kind === 'string' && kind) return kind === 'permission_prompt'
  return /permission/i.test(String(data.message || ''))
}

// Returns the in-flight request, or null when there is nothing to send.
function emit(data) {
  const event = data.hook_event_name
  if (!EMIT_EVENTS.has(event)) return null
  if (event === 'Notification' && !needsPermission(data)) return null

  const sessionId = data.session_id
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) return null

  // Written only after the token check, so no counter is created for an event
  // that is not going out; dropped before it, so a SessionEnd arriving without
  // a token still takes the counter with it.
  const ending = event === END_EVENT
  const seq = nextSeq(sessionId)
  if (ending) dropSeq(sessionId)

  const token = readToken()
  if (token === null) return null
  if (!ending) saveSeq(sessionId, seq)

  const body = JSON.stringify({
    sessionId,
    event,
    seq,
    emittedAt: Date.now(),
    cwd: typeof data.cwd === 'string' ? data.cwd.slice(0, CWD_MAX) : undefined,
    tmuxSession: tmuxSession() || undefined,
  })

  const req = http.request({
    host: EMIT_HOST,
    port: emitPort(),
    path: '/',
    method: 'POST',
    agent: false,
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'x-dash-token': token,
    },
  })
  req.end(body)
  return req
}

// --- Main ----------------------------------------------------------------

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  let req = null
  try {
    req = emit(JSON.parse(input || '{}'))
  } catch (e) {
    // silent
  }
  if (req === null) process.exit(0)

  // Four exits, none of them a wait: the listener answered (headers are
  // enough — the event is applied before it replies), nothing was listening,
  // or the forward is half-open and the socket went quiet. The wall-clock
  // timer is the only one that covers a stalled connect, where the inactivity
  // timeout above never starts.
  const finish = () => process.exit(0)
  req.on('response', finish)
  req.on('error', finish)
  req.setTimeout(SOCKET_TIMEOUT_MS, finish)
  setTimeout(finish, SOCKET_TIMEOUT_MS)
})
