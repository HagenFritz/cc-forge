#!/usr/bin/env node
// cc-forge — UserPromptSubmit hook for the /caveman skill.
//
// Reads JSON from stdin (Claude Code's UserPromptSubmit payload). Parses the
// prompt for slash-command and natural-language activation/deactivation of
// caveman mode. Persists state in a flag file at ~/.claude/.caveman-active.
// Emits a one-line reinforcement reminder as hookSpecificOutput.additionalContext
// when the mode is active.
//
// Always exits 0 — exit 2 on UserPromptSubmit blocks and erases the prompt,
// which is catastrophic UX for a mode-tracking hook. Internal errors silent-fail.
//
// Adapted from https://github.com/JuliusBrussee/caveman (MIT). cc-forge ships
// only the lite/full/ultra subset; wenyan levels intentionally omitted.

'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

const VALID_MODES = ['lite', 'full', 'ultra']
const MAX_FLAG_BYTES = 64
const FLAG_PATH = path.join(os.homedir(), '.claude', '.caveman-active')

// --- Symlink-safe flag-file primitives (defense-in-depth) ----------------
//
// The flag path is predictable, which is a classic local-attacker target.
// safeWriteFlag uses O_NOFOLLOW + atomic temp+rename + 0600 perms; readFlag
// refuses symlinks, caps bytes, and whitelists content. Silent-fail throughout.

function safeWriteFlag(content) {
  try {
    const flagDir = path.dirname(FLAG_PATH)
    fs.mkdirSync(flagDir, { recursive: true })

    // Reject the flag file itself being a symlink (the actual clobber vector).
    try {
      if (fs.lstatSync(FLAG_PATH).isSymbolicLink()) return
    } catch (e) {
      if (e.code !== 'ENOENT') return
    }

    const tempPath = path.join(flagDir, `.caveman-active.${process.pid}.${Date.now()}`)
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW
    let fd
    try {
      fd = fs.openSync(tempPath, flags, 0o600)
      fs.writeSync(fd, String(content))
      try { fs.fchmodSync(fd, 0o600) } catch (e) { /* best-effort on Windows */ }
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
    fs.renameSync(tempPath, FLAG_PATH)
  } catch (e) {
    // silent
  }
}

function readFlag() {
  try {
    let st
    try {
      st = fs.lstatSync(FLAG_PATH)
    } catch (e) {
      return null
    }
    if (st.isSymbolicLink() || !st.isFile()) return null
    if (st.size > MAX_FLAG_BYTES) return null

    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
    const flags = fs.constants.O_RDONLY | O_NOFOLLOW
    let fd
    let out
    try {
      fd = fs.openSync(FLAG_PATH, flags)
      const buf = Buffer.alloc(MAX_FLAG_BYTES)
      const n = fs.readSync(fd, buf, 0, MAX_FLAG_BYTES, 0)
      out = buf.slice(0, n).toString('utf8')
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }

    const raw = out.trim().toLowerCase()
    if (!VALID_MODES.includes(raw)) return null
    return raw
  } catch (e) {
    return null
  }
}

function unlinkFlag() {
  try { fs.unlinkSync(FLAG_PATH) } catch (e) { /* silent */ }
}

// --- Activation / deactivation parsing -----------------------------------

function parseIntent(promptLc) {
  // Only inspect the first ~80 chars so a pasted block that mentions
  // "caveman" downstream doesn't accidentally toggle the mode.
  const head = promptLc.slice(0, 80)

  // Deactivation first — beats activation if both could match (e.g. "stop caveman").
  if (/^\/caveman\s+(off|stop|disable)\b/.test(head)) return { action: 'off' }
  if (/^\s*(please\s+)?(stop|disable|deactivate|turn off)\b.*\bcaveman\b/.test(head)) return { action: 'off' }
  if (/^\s*caveman\b.*\b(stop|disable|deactivate|turn off)\b/.test(head)) return { action: 'off' }
  if (/^\s*normal mode\b/.test(head)) return { action: 'off' }

  // Slash command activation.
  const slashMatch = /^\/caveman(?:\s+(\S+))?/.exec(head)
  if (slashMatch) {
    const arg = slashMatch[1]
    if (!arg) return { action: 'on', level: 'full' }
    if (VALID_MODES.includes(arg)) return { action: 'on', level: arg }
    return { action: 'noop' } // unknown arg → don't silently overwrite
  }

  // Natural language activation, anchored to the start of the prompt.
  if (/^\s*(please\s+)?(activate|enable|turn on|start|talk like|use)\b.*\bcaveman\b/.test(head)) {
    return { action: 'on', level: 'full' }
  }
  if (/^\s*caveman\b.*\b(mode|activate|enable|turn on|start)\b/.test(head)) {
    return { action: 'on', level: 'full' }
  }

  return { action: 'noop' }
}

// --- Reminder text (HARDCODED — see plan Key Technical Decisions) --------
//
// Inlined deliberately so a malicious SKILL.md write cannot inject content
// into the model's context window. Form is a pointer back to the rules, not
// a restatement, so drift between this string and SKILL.md is intentional
// and minimal.

function reminderFor(level) {
  return `CAVEMAN MODE ACTIVE (${level}). Apply skill rules from skills/caveman/SKILL.md. Drop articles/filler/pleasantries; code/commits/security write normal.`
}

// --- Main ----------------------------------------------------------------

let input = ''
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}')
    const prompt = (data.prompt || '').trim().toLowerCase()

    const intent = parseIntent(prompt)
    if (intent.action === 'on') {
      safeWriteFlag(intent.level)
    } else if (intent.action === 'off') {
      unlinkFlag()
    }
    // 'noop' → flag untouched

    const level = readFlag()
    if (level) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: reminderFor(level),
        },
      }))
    }
  } catch (e) {
    // silent — never exit 2 on UserPromptSubmit
  }
  process.exit(0)
})
