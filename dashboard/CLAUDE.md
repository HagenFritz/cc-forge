# Dashboard

Live terminal dashboard for monitoring Claude Code sessions across projects. A single self-contained script (`dash.js`) using only Node stdlib modules (Node >= 22 required). Not plugin-loaded — run by hand in its own terminal tab.

## Install

Run it directly with `node dashboard/dash.js`, or install the `ccdash` launcher once per machine (not committed — per-machine, like `~/.local/bin/devbox`):

```bash
cat > ~/.local/bin/ccdash <<'EOF'
#!/usr/bin/env bash
#
# ccdash — launch the cc-forge session dashboard from anywhere.
# Named ccdash, not dash: macOS ships /bin/dash (the Almquist shell) and /bin
# precedes ~/.local/bin on PATH. Per-machine install, not committed to the
# repo. Install: write this file, then chmod +x. See dashboard/CLAUDE.md.
set -euo pipefail

target="/Users/hfritz/Misc/cc-forge/dashboard/dash.js"

[ -f "$target" ] || {
  echo "ccdash: dashboard not found at $target — has the cc-forge checkout moved?" >&2
  exit 1
}

exec node "$target" "$@"
EOF
chmod +x ~/.local/bin/ccdash
```

The path is hardcoded, and the guard turns a moved checkout into a clear message instead of a Node `MODULE_NOT_FOUND` trace.


## Conventions

- One file, sectioned by `// ── Section ──` comments.
- No external dependencies; `child_process`, `crypto`, `fs`, `http`, `os`, `path` only.

Flags:

- `--once` prints one plain frame and exits (the smoke-test flag). No keys, no bell, no help line.
- `--width <n>` fixes column width (used by `--once` for reproducible frames).
- `--fixture <path>` feeds synthetic rows for deterministic output.
- `--alert-idle` also bells on idle transitions; waiting-only by default.
- `--listen <port>` accepts VM session events on `127.0.0.1:<port>` (1024–65535). Live mode only — it cannot be combined with `--once`.

## VM listener (`--listen`)

Bound to loopback only; the VM reaches it over an ssh reverse forward. Every request must be a `POST` carrying `x-dash-token` and `content-type: application/json`, with no `Origin` header and a body under 4 KB (cut off mid-stream, socket destroyed). Anything else is rejected with 405 / 401 / 415 / 403 / 413 and touches no state.

The shared secret lives at `~/.claude/.dash-token`, 64 hex characters, created `0600` at open time and read symlink-refusingly. It is generated on the first `--listen` run and the footer says so once — copy it to the VM and `chmod 600` it there (`scp` preserves neither mode nor a safe umask). Rotation is delete, restart, re-copy.

The token defends exactly two boundaries: a remote-triggered local request from a context that cannot read the filesystem (a browser tab, a postinstall script), and a non-root process on the devbox. A same-uid process on the Mac reads the token file and is not defended against.

Payload contract — anything else is ignored, `host` included (the host is pinned to `ro-devbox`):

| field | required | meaning |
|---|---|---|
| `sessionId` | yes | the VM session's UUID; namespaced to `ro-devbox:<id>` at ingest |
| `event` | yes | `SessionStart` / `UserPromptSubmit` → busy, `Notification` → waiting, `Stop` → idle, `SessionEnd` → row removed for 5 s and then re-creatable. `SubagentStop` and anything else is ignored |
| `seq` | yes | monotonic per session; an event at or below the stored value is dropped |
| `emittedAt` | yes | VM epoch ms, used for staleness comparison only — never for display, which uses the Mac receipt time |
| `name`, `cwd`, `kind`, `tmuxSession` | no | passed through the same `validateRows` boundary as local rows |

At most 256 VM rows are held; new session ids are refused once full. Footer counters — rejected VM requests (a stale token copy on the VM) and dropped VM events (out of order, unknown event, malformed, or the row cap) — each get their own footer line once non-zero, as do a listener that could not bind and the one-time new-token note.

Keys (live mode only):

- `j` / Down, `k` / Up — move the highlight.
- Enter — focus the highlighted session's iTerm tab.
- `r` — rename that session's iTerm tab (inline prompt; Enter confirms, Esc cancels, `^U` clears).
- `q` / `^C` — quit.

The bell rings once per tick when a session newly enters `waiting`.

## Known limitations

- Wide characters (emoji, CJK) misalign columns — widths are code points, not display cells. Declared scope boundary.
- A status string over 16 characters is truncated (`STATE_CAP`).
- Fixture rows always show `0s` age (no `<pid>.json` exists for synthetic pids); by design for deterministic output.
- The module exports only `validateVmRow`, `applyVmEvent`, `newState`, and `startListener` — the VM ingest seam; anything else, such as in-process timing or a rendered frame, needs an instrumented copy or a live run.
- A VM session that starts while the dashboard is down is invisible until its next event; there is no heartbeat and the dashboard never polls the VM.
- Transcript reads have no wall-clock guard (measured at ~1 ms cold; not addressed).
- `DASH_PROJECTS_DIR` env override exists for testing but is not a documented user-facing feature.
- A tab renamed with `r` is overwritten by Claude Code's own OSC 0 title on that session's next turn — the rename is not sticky. Mitigation is the iTerm profile toggle "Terminal may set tab/window title"; there is no scriptable lock.
- A session whose iTerm profile defines a custom title format shows the new name wrapped in that format — renaming to `foo` can render as `foo (cloud-sql-proxy)`. The rename did apply; the profile decorates it. The dashboard reads the name back after setting it and reports the rendered form when it differs from what was typed, so this no longer looks like a rename that did nothing. A separate mechanism from the OSC 0 revert above, and it fires on the first rename rather than on the next turn. Changing it means editing the profile's title format in iTerm.
- Rename input is ASCII printable only (`0x20`–`0x7e`), capped at 64 characters; other keystrokes are ignored.
- Focus and rename are iTerm-only; elsewhere a transient footer message appears and the rest of the dashboard keeps working.
- A bare Escape is delivered after a ~50 ms debounce, inherent to telling it apart from arrow keys.
- Unrecognized escape sequences (Left/Right, Home, End, function keys) are silently dropped. Both CSI (`\x1b[`) and SS3 (`\x1bO`) forms are consumed to their terminator, so no tail leaks through as literal keystrokes.
