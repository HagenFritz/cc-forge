# Dashboard

Live terminal dashboard for monitoring Claude Code sessions across projects. A single self-contained script (`dash.js`) using only Node stdlib modules (Node >= 22 required). Not plugin-loaded — run by hand in its own terminal tab with `node dashboard/dash.js`.

## Conventions

- One file, sectioned by `// ── Section ──` comments.
- No external dependencies; `child_process`, `fs`, `os`, `path` only.
- `--once` prints one plain frame and exits (the smoke-test flag).
- `--fixture <path>` feeds synthetic rows for deterministic output.
- `--width <n>` fixes column width (used by `--once` for reproducible frames).

## Known limitations

- Wide characters (emoji, CJK) misalign columns — widths are code points, not display cells. Declared scope boundary.
- A status string over 16 characters is truncated (`STATE_CAP`).
- Fixture rows always show `0s` age (no `<pid>.json` exists for synthetic pids); by design for deterministic output.
- The module exports nothing; in-process timing needs an instrumented copy. Exports are a one-line change if needed later.
- Transcript reads have no wall-clock guard (measured at ~1 ms cold; not addressed).
- `DASH_PROJECTS_DIR` env override exists for testing but is not a documented user-facing feature.
