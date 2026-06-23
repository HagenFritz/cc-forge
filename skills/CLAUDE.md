# Skills

Slash-command skills for Claude Code. Each subdirectory is one skill with a `SKILL.md` (YAML frontmatter — `name`, `description`, `argument-hint`, `allowed-tools` — followed by the workflow prose). Claude Code loads these from `~/.claude/skills/`; editing a file here goes live only after re-running the plugin install or copying the folder into `~/.claude/`.

A pre-commit hook runs `scripts/sync-workflows.sh`, which regenerates `.devin/workflows/*.md` (gitignored) from every `SKILL.md` here.

## Related

- **PR #40** (2026-06-23): /land now reconciles CLAUDE.md body prose with the merged diff (not just appends); /ship splits Test Plan into Pre-merge/Post-merge; added scripts/sync-workflows.sh
