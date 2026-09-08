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

## Sort order

Rows follow iTerm tab order, left to right, so row N is tab N and Cmd+number lands where the table says. Ordering is (window index, tab index): "row N is tab N" holds inside the frontmost window, and further windows stack after it in iTerm's own order — Cmd+number only ever addresses the current window's tabs. Two sessions split across one tab take consecutive positions.

Stability is the point. The shipped order was `waiting` / `idle` / `busy`, which moved a row every time its status changed and broke the row-to-tab mapping the keys depend on. `waiting` still has to stand out, so it does it without moving: the STATE cell reads `waiting!`. The marker is one trailing ASCII byte — no colour, so it reads the same in a light and a dark theme, and at eight characters it fits `STATE_WIDTH` without widening the column.

Two spawns per poll feed the order — one `ps -o pid=,tty=` for every local row's pid, one `osascript` walking `windows → tabs → sessions` for each tty's position — and both run **after** the paint with the result cached in `state.tabByTty` / `state.ttyByPid`. Nothing waits on iTerm: a new tab reaches its sort position one poll late, which is invisible at a two-second interval. One query is in flight at a time, so a slow osascript cannot stack spawns. The script is guarded by `is running` (`tell application` would otherwise launch iTerm) and never activates it, and it is built from `ITERM_BUNDLE_ID` alone — no byte of a row reaches it.

Rows iTerm knows nothing about — VM rows, background sessions, a pid whose tty is gone — sort after the tabbed ones, on `startedAt` then id so they hold their relative order across ticks regardless of status. With no tab order at all (no iTerm, Linux, `--once`) the whole table falls back to the urgency sort, unannounced, the same way focus already degrades off a Mac; `ps -p` exiting non-zero because one pid is gone is the normal case, so its output is the signal there and its exit status is not. A failed or timed-out osascript keeps the previous map rather than clearing it — one hung iTerm would otherwise reshuffle every row for a tick — but only for five consecutive failures, after which both maps are cleared and the urgency fallback takes over; a `ps` failure with nothing on stdout keeps both cached maps for the same reason. The query is skipped outright off darwin, and a watchdog slightly longer than the 3 s timeout kills a wedged child, so the one-in-flight flag cannot strand.

## VM listener (`--listen`)

Bound to loopback only; the VM reaches it over an ssh reverse forward. Every request must be a `POST` carrying `x-dash-token` and `content-type: application/json`, with no `Origin` header; a body over 4 KB is rejected (4096 bytes is the largest accepted), cut off mid-stream with the socket destroyed. Anything else is rejected with 405 / 401 / 415 / 403 / 413 and touches no state.

The shared secret lives at `~/.claude/.dash-token`, 64 hex characters, created `0600` at open time and read symlink-refusingly. It is generated on the first `--listen` run and the footer says so once; getting it onto the VM, and rotating it, is step 2 of *Wiring the devbox* below. A file that is there but unusable (a symlink, oversized, malformed, or unreadable) is never overwritten: the footer says so and VM rows are off for that run, so a transient read error cannot rotate a secret the VM still holds. A token readable beyond this user gets a footer warning, not a rotation.

The token defends exactly two boundaries: a remote-triggered local request from a context that cannot read the filesystem (a browser tab, a postinstall script), and a non-root process on the devbox. A same-uid process on the Mac reads the token file and is not defended against.

Payload contract — anything else is ignored, `host` included (the host is pinned to `ro-devbox`):

| field | required | meaning |
|---|---|---|
| `sessionId` | yes | the VM session's UUID; namespaced to `ro-devbox:<id>` at ingest |
| `event` | yes | `SessionStart` / `UserPromptSubmit` → busy, `Notification` / `PermissionRequest` → waiting, `Stop` → idle, `SessionEnd` → row removed for 5 s and then re-creatable. `SubagentStop` and anything else is ignored |
| `seq` | yes | monotonic per session; an event at or below the stored value is dropped unless the row has been quiet for the sticky window, which lets an emitter whose counter reset re-register. Above 2^32 is dropped — `Number.isInteger` alone would let one forged event pin the stored value past every real one |
| `emittedAt` | no | accepted in the payload and ignored — staleness, eviction, and the displayed age all derive from the Mac-observed receipt time |
| `name`, `cwd`, `kind`, `tmuxSession` | no | passed through the same `validateRows` boundary as local rows |

A VM row that has been quiet for 10 minutes shows `stale` in the STATE cell, and one quiet for 12 hours is dropped. Both are tick-driven off the Mac receipt time — there is no heartbeat, so silence cannot be told apart from an idle session or a dead forward, and labeling it is the honest answer. Staleness is a flag on the row, not a status: the STATE cell reads `stale`, the AGE keeps counting from the last received event rather than restarting, the row holds its sort position, and a stale row that reports again does not re-ring the bell — it never left the status the bell is edge-triggered on. The next real event replaces the row outright, which clears the flag. Local rows are never aged out.

At most 256 VM rows are held; at the cap the least recently heard-from row is evicted for the new session, so a flood of fresh uuids cannot lock a real session out of the table. The sticky-end map is capped the same way, evicting the soonest-expiring record. Footer counters — rejected VM requests (a stale token copy on the VM) and dropped VM events (out of order, unknown event, or malformed) — each get their own footer line once non-zero, as do a listener that could not bind and the one-time new-token note.

## Wiring the devbox

Three per-machine steps, none of them committed — the same posture as
`~/.local/bin/ccdash`. `~/.ssh/config` and the token file live outside the repo
on both machines.

**1. The reverse forward, on the Mac.** `~/.ssh/config` already has a
`Host ro-devbox` entry (the IAP `ProxyCommand` `scripts/devbox` relies on), so
these lines are added *inside* it rather than appended as a second block:

```
Host ro-devbox
  # …existing ProxyCommand, User, IdentityFile…
  RemoteForward 45800 127.0.0.1:45801
  ControlMaster auto
  ControlPersist 10m
  ExitOnForwardFailure yes
```

The config is the only place that covers `devbox ssh`, `devbox <name>`,
`devbox cc`, and a hand-typed `ssh ro-devbox` with one edit, which is why
`scripts/devbox` needs no change. `RemoteForward` binds 45800 on the VM and
carries it to `dash.js --listen 45801` on the Mac. `ControlMaster` and
`ControlPersist` are load-bearing rather than tuning: with `RemoteForward` set, a
second concurrent connection cannot bind the VM-side port, so without a shared
connection only the first `devbox` invocation carries a working forward — and
`devbox` opens a fresh connection per invocation. `ExitOnForwardFailure yes`
turns a silent half-connection into a loud ssh error. The forward reaches the
VM's loopback only, which assumes `GatewayPorts` stays `no` on the devbox (it is
unset today); at `yes` the listener would be reachable from the whole VPC.

**2. The token, on both machines.** Run the dashboard once with `--listen` to
generate `~/.claude/.dash-token`, then copy it over and fix the mode there:

```bash
scp ~/.claude/.dash-token ro-devbox:.claude/.dash-token
ssh ro-devbox 'chmod 600 ~/.claude/.dash-token'
```

`0600` on the Mac and on the VM. `scp` preserves neither the mode nor a safe
umask, and the emitter treats a group- or other-readable token as absent
silently, so the `chmod` is not optional — the VM-side permissions guard the one
real privilege boundary in this design. Rotation is delete, restart the
dashboard, re-copy; between the restart and the re-copy the symptom is a rising
`N VM requests rejected` count in the footer, not an error.

**3. The emitter, on the VM.** cc-forge is already loaded as a plugin there, so
`git pull` in the devbox checkout plus `/reload-plugins` in a session on the VM
is the whole install — `hooks/hooks.json` is wired automatically. Non-interactive
ssh does not see `~/.local/bin/claude`, so a remote command needs `bash -lc`.

## Session emitter (VM side)

`hooks/cc-forge-session-emitter.cjs` is the other end of the wire, wired by `hooks/hooks.json` on `SessionStart`, `UserPromptSubmit`, `Notification` (matcher `permission_prompt`), `PermissionRequest`, `Stop`, and `SessionEnd`. It POSTs one event to `127.0.0.1:45800` — `DASH_EMIT_PORT` overrides it — which the ssh reverse forward carries to `dash.js --listen 45801` on the Mac. Those are the documented default pair; the emitter's port is the only one a VM-side change can settle.

It runs inside the user's session on every prompt, so it never waits: a 300 ms socket timeout, no response body read, silent on every failure, exit 0 on every path — a missing or malformed `~/.claude/.dash-token` just means no VM rows, and a token readable beyond the user is ignored. Only `permission_prompt` reaches the Mac as `waiting`; the matcher narrows it and the payload is checked again in code so an `idle_prompt` never shows a session as blocked. Both permission events are wired because the `Notification` variant is unreliable in an interactive TTY session, where a distinct `PermissionRequest` fires instead (anthropics/claude-code#85171) — `PermissionRequest` needs no payload check, since the event itself is the prompt, and the hook writes nothing to stdout on that path, where JSON would be read as a permission decision.

Per-session `seq` counters live at `~/.claude/dash-seq/<session-id>` (one small `0600` file, written temp+rename, removed on `SessionEnd`), since the hook is a fresh process per event. A counter that goes missing restarts at 0, which the listener's sticky window absorbs. `tmuxSession` comes from `tmux display-message -p '#S'` when `$TMUX` is set and is `null` otherwise, so a plain `devbox ssh` session still reports.

Keys (live mode only):

- `j` / Up, `k` / Down — move the highlight. `j` up and `k` down is the reverse of vi, `less`, `git`, and `tmux`, deliberately: this is a single-user tool and the binding that matches the owner's hands wins. Arrow keys are unchanged.
- Enter — focus the highlighted session's iTerm tab. On a VM row there is no pid
  to resolve, so focus instead selects the iTerm tab whose session name contains
  `ro-devbox`, then asks `tmux list-clients -F '#{client_tty}'` over ssh for the
  attached client and runs `tmux switch-client -c <tty> -t <session>` against it,
  both as argv arrays with `-o BatchMode=yes -o ConnectTimeout=2` so an unknown
  host key can never prompt on `/dev/tty`. The client is named explicitly because
  `switch-client` alone moves whichever client tmux saw last, which an iTerm
  select does not change. The AppleScript is built from the host alias alone — no
  byte of a VM row reaches it — and the tmux name reaches only the argv, never an
  interpreter. A row whose `tmuxSession` is `null` focuses the tab and says tmux
  was not detected, and no attached client says so too; an unreachable devbox is
  one transient footer line, bounded by the same 3 s timeout as each other call.
  Only the newest Enter writes the footer, so two overlapping focus attempts
  cannot report out of order, and a quit mid-flight kills the child.
- `r` — rename that session's iTerm tab (inline prompt; Enter confirms, Esc cancels, `^U` clears).
- `q` / `^C` — quit.

The bell rings once per tick when a session newly enters `waiting`.

## Known limitations

- Wide characters (emoji, CJK) misalign columns — widths are code points, not display cells. Declared scope boundary.
- A status string over 16 characters is truncated (`STATE_CAP`).
- Fixture rows always show `0s` age (no `<pid>.json` exists for synthetic pids); by design for deterministic output.
- The module exports only `validateVmRow`, `applyVmEvent`, `newState`, `startListener`, `focusScript`, `renameScript`, `vmFocusScript`, `tmuxListClientsArgs`, `tmuxSwitchArgs`, `focusHighlighted`, `focusVmRow`, `ageOutVmRows`, `renderRows`, `sortRows`, `parseTabOrder`, `parseTtyByPid`, `tabIndexOf`, `handleKey`, and `moveHighlight` — the VM ingest seam, the focus path (which needs iTerm and a live devbox to run for real), staleness, reachable by handing `ageOutVmRows` a clock and `renderRows` the same one to get the decorated, sorted rows back, and tab-order sorting, whose two query outputs cannot be produced off a Mac: the parsers take that output as text, `sortRows` takes the resulting map, and `handleKey` covers the key bindings without a pty. Anything else, such as `refreshTabOrder`, in-process timing, or a whole rendered frame, needs an instrumented copy or a live run.
- `refreshTabOrder` and `tabOrderScript` are inspection-only seams: neither runs at all without a live macOS with iTerm, so they are deliberately not exported and are covered by the post-merge checklist rather than by a probe.
- A tab opened, closed, or dragged is reflected one poll (two seconds) later, since the tab query runs off the tick.
- Tab order is iTerm-only. In any other terminal the query returns nothing and the table sorts by urgency, silently — the same degradation focus and rename already have.
- A VM session that starts while the dashboard is down is invisible until its next event; there is no heartbeat and the dashboard never polls the VM. An idle VM session goes `stale` after 10 minutes for the same reason, which says only that nothing has been heard — not that the session is gone.
- VM rows have no SUMMARY. The emitter carries a state and a tmux session name only, so the cell is blank — reading a VM transcript would mean an ssh round trip per row per tick.
- `r` on a VM row reports that rename is local-only; it renames an iTerm tab, and a VM row has none.
- Permission prompts arrive on two different hook events and both are wired, per *Session emitter* above (anthropics/claude-code#85171). If that is fixed upstream one entry becomes redundant rather than wrong: both map to `waiting`, so a session that emits both pays one extra no-op update and no second bell.
- Transcript reads have no wall-clock guard (measured at ~1 ms cold; not addressed).
- `DASH_PROJECTS_DIR` env override exists for testing but is not a documented user-facing feature.
- A tab renamed with `r` is overwritten by Claude Code's own OSC 0 title on that session's next turn — the rename is not sticky. Mitigation is the iTerm profile toggle "Terminal may set tab/window title"; there is no scriptable lock.
- A session whose iTerm profile defines a custom title format shows the new name wrapped in that format — renaming to `foo` can render as `foo (cloud-sql-proxy)`. The rename did apply; the profile decorates it. The dashboard reads the name back after setting it and reports the rendered form when it differs from what was typed, so this no longer looks like a rename that did nothing. A separate mechanism from the OSC 0 revert above, and it fires on the first rename rather than on the next turn. Changing it means editing the profile's title format in iTerm.
- Rename input is ASCII printable only (`0x20`–`0x7e`), capped at 64 characters; other keystrokes are ignored.
- Focus and rename are iTerm-only; elsewhere a transient footer message appears and the rest of the dashboard keeps working.
- VM focus snapshots the row when Enter is pressed, so a session that ends while iTerm is being driven leaves the tmux switch pointing at a session that just went away. Accepted, for the same reason the pid-reuse window is.
- One devbox tab is assumed: focus takes the first iTerm session whose name contains the host alias, so with two `ssh ro-devbox` tabs open it may pick either. The tmux switch targets the attached client explicitly (`-c <client_tty>`, the first one `list-clients` reports), so it is not iTerm's pick that decides which session moves — but with two attached clients the tab iTerm selects and the client tmux moves can still be different ones.
- A bare Escape is delivered after a ~50 ms debounce, inherent to telling it apart from arrow keys.
- Unrecognized escape sequences (Left/Right, Home, End, function keys) are silently dropped. Both CSI (`\x1b[`) and SS3 (`\x1bO`) forms are consumed to their terminator, so no tail leaks through as literal keystrokes.
