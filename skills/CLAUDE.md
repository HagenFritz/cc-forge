# Skills

Slash-command skills for Claude Code. Each subdirectory is one skill with a `SKILL.md` (YAML frontmatter — `name`, `description`, `argument-hint`, `allowed-tools`, plus `user-invocable: false` + `disable-model-invocation: true` for reference-only skills — followed by the workflow prose). Claude Code loads these from `~/.claude/skills/`; editing a file here goes live only after re-running the plugin install or copying the folder into `~/.claude/`.

A pre-commit hook runs `scripts/sync-workflows.sh`, which regenerates `.devin/workflows/*.md` (gitignored) from every `SKILL.md` here — except reference-only skills (`user-invocable: false`), which are skipped.

`issue-log/` is one such reference skill: it holds the issue-log stamp spec (envelope, event registry, shared rules) that the workflow skills' stamp blocks link to. When touching any stamp block, change shared rules only in the spec.

The planning skill is `blueprint/` (with `deepen-blueprint/` as its second-pass counterpart) — named to avoid colliding with Claude Code's built-in plan mode. The artifact it writes is still called a plan and still lands in `docs/plans/`; only the invocation was renamed.

Two execution paths run a plan to merged code. `work/` → `ship/` → `land/` is the confirm-gated one: each stops for user approval, and `land/` explicitly never pushes an unattended CI fix. `grind/` is the autonomous counterpart — it confirms a PR breakdown once, then builds, reviews, triages, fixes, and merges each slice without prompting. Because of that, `grind/` deliberately does **not** call the other three (their approval gates would deadlock it) and reimplements the worktree → PR → CI → merge path itself. Changes to `land/`'s merge or CI-fix logic should be mirrored into `grind/` Phases 6–7, which duplicate it by design.

## Related

- **PR #61** (2026-07-29): add /grind — autonomously executes a plan as a serial sequence of PRs (worktree → Opus build → Fable review → self-triage → Opus fix → merge on green CI); renamed /plan → /blueprint and /deepen-plan → /deepen-blueprint to clear the collision with Claude Code's built-in plan mode
- **PR #60** (2026-07-24): /tree's main-sync now fetches origin/{default-branch} (remote-tracking ref only) instead of git fetch origin {default-branch}:{default-branch}, so it no longer hard-fails when another worktree has the default branch checked out; the new worktree branches off that fetched ref directly, and the git pull fast-forward for an already-main primary checkout is now additive rather than the sole fallback
- **PR #59** (2026-07-21): issue-log stamp convention — new skills/issue-log reference spec (marker v1, event registry, reader contract) + ten skills stamp their key events onto the linked issue; posting hardened to --body-file after deep-review — [plan](docs/plans/2026-07-21-001-feat-issue-log-standard-plan.md)
- **PR #55** (2026-07-15): add /tree, /preview, /unpreview for a git-worktree dev workflow (primary checkout stays on main; feature work in sibling worktrees), and fix /ship + /land to operate correctly from inside a worktree
- **PR #40** (2026-06-23): /land now reconciles CLAUDE.md body prose with the merged diff (not just appends); /ship splits Test Plan into Pre-merge/Post-merge; added scripts/sync-workflows.sh
