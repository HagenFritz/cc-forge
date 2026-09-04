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
- No external dependencies; `child_process`, `fs`, `os`, `path` only.

Flags:

- `--once` prints one plain frame and exits (the smoke-test flag). No keys, no bell, no help line.
- `--width <n>` fixes column width (used by `--once` for reproducible frames).
- `--fixture <path>` feeds synthetic rows for deterministic output.
- `--alert-idle` also bells on idle transitions; waiting-only by default.

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
- The module exports only `validateVmRow`, the VM-payload ingest point; anything else, such as in-process timing, needs an instrumented copy.
- Transcript reads have no wall-clock guard (measured at ~1 ms cold; not addressed).
- `DASH_PROJECTS_DIR` env override exists for testing but is not a documented user-facing feature.
- A tab renamed with `r` is overwritten by Claude Code's own OSC 0 title on that session's next turn — the rename is not sticky. Mitigation is the iTerm profile toggle "Terminal may set tab/window title"; there is no scriptable lock.
- A session whose iTerm profile defines a custom title format shows the new name wrapped in that format — renaming to `foo` can render as `foo (cloud-sql-proxy)`. The rename did apply; the profile decorates it. The dashboard reads the name back after setting it and reports the rendered form when it differs from what was typed, so this no longer looks like a rename that did nothing. A separate mechanism from the OSC 0 revert above, and it fires on the first rename rather than on the next turn. Changing it means editing the profile's title format in iTerm.
- Rename input is ASCII printable only (`0x20`–`0x7e`), capped at 64 characters; other keystrokes are ignored.
- Focus and rename are iTerm-only; elsewhere a transient footer message appears and the rest of the dashboard keeps working.
- A bare Escape is delivered after a ~50 ms debounce, inherent to telling it apart from arrow keys.
- Unrecognized escape sequences (Left/Right, Home, End, function keys) are silently dropped. Both CSI (`\x1b[`) and SS3 (`\x1bO`) forms are consumed to their terminator, so no tail leaks through as literal keystrokes.
