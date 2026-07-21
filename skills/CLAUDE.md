# Skills

Slash-command skills for Claude Code. Each subdirectory is one skill with a `SKILL.md` (YAML frontmatter — `name`, `description`, `argument-hint`, `allowed-tools`, plus `user-invocable: false` + `disable-model-invocation: true` for reference-only skills — followed by the workflow prose). Claude Code loads these from `~/.claude/skills/`; editing a file here goes live only after re-running the plugin install or copying the folder into `~/.claude/`.

A pre-commit hook runs `scripts/sync-workflows.sh`, which regenerates `.devin/workflows/*.md` (gitignored) from every `SKILL.md` here — except reference-only skills (`user-invocable: false`), which are skipped.

`issue-log/` is one such reference skill: it holds the issue-log stamp spec (envelope, event registry, shared rules) that the workflow skills' stamp blocks link to. When touching any stamp block, change shared rules only in the spec.

## Related

- **PR #59** (2026-07-21): issue-log stamp convention — new skills/issue-log reference spec (marker v1, event registry, reader contract) + ten skills stamp their key events onto the linked issue; posting hardened to --body-file after deep-review — [plan](docs/plans/2026-07-21-001-feat-issue-log-standard-plan.md)
- **PR #55** (2026-07-15): add /tree, /preview, /unpreview for a git-worktree dev workflow (primary checkout stays on main; feature work in sibling worktrees), and fix /ship + /land to operate correctly from inside a worktree
- **PR #40** (2026-06-23): /land now reconciles CLAUDE.md body prose with the merged diff (not just appends); /ship splits Test Plan into Pre-merge/Post-merge; added scripts/sync-workflows.sh
