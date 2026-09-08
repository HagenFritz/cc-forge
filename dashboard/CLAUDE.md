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

Bound to loopback only; the VM reaches it over an ssh reverse forward. Every request must be a `POST` carrying `x-dash-token` and `content-type: application/json`, with no `Origin` header; a body over 4 KB is rejected (4096 bytes is the largest accepted), cut off mid-stream with the socket destroyed. Anything else is rejected with 405 / 401 / 415 / 403 / 413 and touches no state.

The shared secret lives at `~/.claude/.dash-token`, 64 hex characters, created `0600` at open time and read symlink-refusingly. It is generated on the first `--listen` run and the footer says so once — copy it to the VM and `chmod 600` it there (`scp` preserves neither mode nor a safe umask). Rotation is delete, restart, re-copy. A file that is there but unusable (a symlink, oversized, malformed, or unreadable) is never overwritten: the footer says so and VM rows are off for that run, so a transient read error cannot rotate a secret the VM still holds. A token readable beyond this user gets a footer warning, not a rotation.

The token defends exactly two boundaries: a remote-triggered local request from a context that cannot read the filesystem (a browser tab, a postinstall script), and a non-root process on the devbox. A same-uid process on the Mac reads the token file and is not defended against.

Payload contract — anything else is ignored, `host` included (the host is pinned to `ro-devbox`):

| field | required | meaning |
|---|---|---|
| `sessionId` | yes | the VM session's UUID; namespaced to `ro-devbox:<id>` at ingest |
| `event` | yes | `SessionStart` / `UserPromptSubmit` → busy, `Notification` / `PermissionRequest` → waiting, `Stop` → idle, `SessionEnd` → row removed for 5 s and then re-creatable. `SubagentStop` and anything else is ignored |
| `seq` | yes | monotonic per session; an event at or below the stored value is dropped unless the row has been quiet for the sticky window, which lets an emitter whose counter reset re-register. Above 2^32 is dropped — `Number.isInteger` alone would let one forged event pin the stored value past every real one |
| `emittedAt` | yes | VM epoch ms, used for staleness comparison only — never for display, which uses the Mac receipt time |
| `name`, `cwd`, `kind`, `tmuxSession` | no | passed through the same `validateRows` boundary as local rows |

A VM row that has been quiet for 10 minutes shows `stale` in the STATE cell rather than its last known status, and one quiet for 12 hours is dropped. Both are tick-driven off the Mac receipt time — there is no heartbeat, so silence cannot be told apart from an idle session or a dead forward, and marking it is the honest answer. A stale row keeps its position, and the next real event replaces the row outright, so it returns to its real status for free. Local rows are never aged out.

At most 256 VM rows are held; at the cap the least recently heard-from row is evicted for the new session, so a flood of fresh uuids cannot lock a real session out of the table. The sticky-end map is capped the same way, evicting the soonest-expiring record. Footer counters — rejected VM requests (a stale token copy on the VM) and dropped VM events (out of order, unknown event, or malformed) — each get their own footer line once non-zero, as do a listener that could not bind and the one-time new-token note.

## Session emitter (VM side)

`hooks/cc-forge-session-emitter.cjs` is the other end of the wire, wired by `hooks/hooks.json` on `SessionStart`, `UserPromptSubmit`, `Notification` (matcher `permission_prompt`), `PermissionRequest`, `Stop`, and `SessionEnd`. It POSTs one event to `127.0.0.1:45800` — `DASH_EMIT_PORT` overrides it — which the ssh reverse forward carries to `dash.js --listen 45801` on the Mac. Those are the documented default pair; the emitter's port is the only one a VM-side change can settle.

It runs inside the user's session on every prompt, so it never waits: a 300 ms socket timeout, no response body read, silent on every failure, exit 0 on every path — a missing or malformed `~/.claude/.dash-token` just means no VM rows, and a token readable beyond the user is ignored. Only `permission_prompt` reaches the Mac as `waiting`; the matcher narrows it and the payload is checked again in code so an `idle_prompt` never shows a session as blocked. Both permission events are wired because the `Notification` variant is unreliable in an interactive TTY session, where a distinct `PermissionRequest` fires instead (anthropics/claude-code#85171) — `PermissionRequest` needs no payload check, since the event itself is the prompt, and the hook writes nothing to stdout on that path, where JSON would be read as a permission decision.

Per-session `seq` counters live at `~/.claude/dash-seq/<session-id>` (one small `0600` file, written temp+rename, removed on `SessionEnd`), since the hook is a fresh process per event. A counter that goes missing restarts at 0, which the listener's sticky window absorbs. `tmuxSession` comes from `tmux display-message -p '#S'` when `$TMUX` is set and is `null` otherwise, so a plain `devbox ssh` session still reports.

Keys (live mode only):

- `j` / Down, `k` / Up — move the highlight.
- Enter — focus the highlighted session's iTerm tab. On a VM row there is no pid
  to resolve, so focus instead selects the iTerm tab whose session name contains
  `ro-devbox` and then runs `ssh ro-devbox tmux switch-client -t <session>` as an
  argv array. The AppleScript is built from the host alias alone — no byte of a VM
  row reaches it — and the tmux name reaches only the argv, never an interpreter.
  A row whose `tmuxSession` is `null` focuses the tab and says tmux was not
  detected; an unreachable devbox is one transient footer line, bounded by the
  same 3 s timeout as the AppleScript call.
- `r` — rename that session's iTerm tab (inline prompt; Enter confirms, Esc cancels, `^U` clears).
- `q` / `^C` — quit.

The bell rings once per tick when a session newly enters `waiting`.

## Known limitations

- Wide characters (emoji, CJK) misalign columns — widths are code points, not display cells. Declared scope boundary.
- A status string over 16 characters is truncated (`STATE_CAP`).
- Fixture rows always show `0s` age (no `<pid>.json` exists for synthetic pids); by design for deterministic output.
- The module exports only `validateVmRow`, `applyVmEvent`, `newState`, `startListener`, `vmFocusScript`, `tmuxSwitchArgs`, `focusVmRow`, and `ageOutVmRows` — the VM ingest seam, the VM focus path (which needs iTerm and a live devbox to run for real), and staleness, which is only reachable by handing it a clock; anything else, such as in-process timing or a rendered frame, needs an instrumented copy or a live run.
- A VM session that starts while the dashboard is down is invisible until its next event; there is no heartbeat and the dashboard never polls the VM. An idle VM session goes `stale` after 10 minutes for the same reason, which says only that nothing has been heard — not that the session is gone.
- Transcript reads have no wall-clock guard (measured at ~1 ms cold; not addressed).
- `DASH_PROJECTS_DIR` env override exists for testing but is not a documented user-facing feature.
- A tab renamed with `r` is overwritten by Claude Code's own OSC 0 title on that session's next turn — the rename is not sticky. Mitigation is the iTerm profile toggle "Terminal may set tab/window title"; there is no scriptable lock.
- A session whose iTerm profile defines a custom title format shows the new name wrapped in that format — renaming to `foo` can render as `foo (cloud-sql-proxy)`. The rename did apply; the profile decorates it. The dashboard reads the name back after setting it and reports the rendered form when it differs from what was typed, so this no longer looks like a rename that did nothing. A separate mechanism from the OSC 0 revert above, and it fires on the first rename rather than on the next turn. Changing it means editing the profile's title format in iTerm.
- Rename input is ASCII printable only (`0x20`–`0x7e`), capped at 64 characters; other keystrokes are ignored.
- Focus and rename are iTerm-only; elsewhere a transient footer message appears and the rest of the dashboard keeps working.
- VM focus snapshots the row when Enter is pressed, so a session that ends while iTerm is being driven leaves the tmux switch pointing at a session that just went away. Accepted, for the same reason the pid-reuse window is.
- One devbox tab is assumed: focus takes the first iTerm session whose name contains the host alias, so with two `ssh ro-devbox` tabs open it may pick either. The tmux switch still lands on the right session inside whichever tab it picked.
- A bare Escape is delivered after a ~50 ms debounce, inherent to telling it apart from arrow keys.
- Unrecognized escape sequences (Left/Right, Home, End, function keys) are silently dropped. Both CSI (`\x1b[`) and SS3 (`\x1bO`) forms are consumed to their terminator, so no tail leaks through as literal keystrokes.
