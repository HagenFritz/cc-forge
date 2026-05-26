# cc-forge

Personal development workflow plugin for Claude Code with GitHub integration.

## Installation

```bash
npm run build && node dist/cli.mjs install
```

This copies all skills and agents to `~/.claude/`. Restart Claude Code after installing.

### Other commands

```bash
node dist/cli.mjs install --dry-run   # Print planned changes without writing
node dist/cli.mjs install --yes       # Skip interactive confirms
node dist/cli.mjs uninstall           # Remove installed files and settings entries
node dist/cli.mjs uninstall --dry-run # Print planned removals without touching anything
node dist/cli.mjs doctor              # Check installation health
```

`install` also copies any cc-forge hooks into `~/.claude/hooks/` and (on first install) patches `~/.claude/settings.json` to register them. Ownership of every cc-forge-written settings.json entry is tracked in `~/.claude/.cc-forge-manifest.json` so `uninstall` removes exactly what install added — nothing more.

### Manifest format

`~/.claude/.cc-forge-manifest.json` is a stable, agent-readable record of everything cc-forge owns in your `~/.claude/settings.json`. Schema:

```json
{
  "version": 1,
  "entries": [
    {
      "uuid": "b68b6ab2-cfea-4916-ab37-4ae87acbe561",
      "kind": "settings-hook",
      "event": "UserPromptSubmit",
      "commandPath": "/Users/you/.claude/hooks/cc-forge-caveman-mode-tracker.cjs",
      "createdAt": "2026-05-22T17:23:42.875Z"
    }
  ]
}
```

Agents may read this file to inspect what cc-forge has installed; do not modify it directly. Use `cc-forge doctor --json` for a structured health report that combines manifest state with settings.json wiring and hook state.

### Agent interface

cc-forge exposes machine-friendly surfaces for non-interactive use:

| Action | Command / file |
|---|---|
| Install non-interactively | `cc-forge install --yes` |
| Preview install changes | `cc-forge install --dry-run` |
| Inspect health as JSON | `cc-forge doctor --json` (exit non-zero on failure) |
| Toggle caveman mode | Write `lite\|full\|ultra` to `~/.claude/.caveman-active`; `rm` to disable (see `skills/caveman/SKILL.md` for full contract) |

## After making changes

**Any time you edit a skill or agent file, re-run install to apply changes:**

```bash
npm run build && node dist/cli.mjs install
```

Changes in `skills/` or `agents/` are not live until install runs.

## Skills

### Core workflow

| Skill | Description |
|---|---|
| `/brainstorm` | Explore requirements and approaches |
| `/plan` | Create implementation plans |
| `/work` | Execute work plans |
| `/review` | Multi-agent code review |
| `/review-walk` | Interactively walk through a review doc issue-by-issue |
| `/compound` | Document learnings |
| `/ideate` | Generate improvement ideas |
| `/deepen-plan` | Stress-test plans with targeted research |
| `/document-review` | Review requirement/plan docs |
| `/deprecate` | Safely plan removal of a named concept |
| `/test-plan` | Generate a manual test plan from branch diffs |
| `/caveman` | Ultra-terse response mode (lite/full/ultra). Persists across turns via a `UserPromptSubmit` hook. Off by default; activate with `/caveman <level>`, deactivate with `/caveman off` or "stop caveman". |

### Strategic

| Skill | Description |
|---|---|
| `/initiative` | Author, maintain, and optionally publish a living initiative doc at `docs/initiatives/`. Two modes: no argument drafts a new initiative; passing an existing path resumes it. Offers GitHub publish (parent issue + linked sub-tasks) after either mode. |

### GitHub integration

| Skill | Description |
|---|---|
| `/branch` | Create and checkout a branch from an issue number |
| `/issue-from-context` | Create a GitHub issue from conversation context |
| `/read-issue` | Fetch and digest a GitHub issue by number |
| `/triage-issue` | Investigate whether a GitHub issue is still present in the codebase |
| `/ship` | Commit, push, and create a PR |

### Git utilities

| Skill | Description |
|---|---|
| `/commit-all` | Stage and commit all changes with per-file messages |

### Project tracking

| Skill | Description |
|---|---|
| `/side-quest` | Track out-of-scope tasks discovered during execution |
| `/stand-up` | Summarize the past 28h of commits, PRs, and issues |

## Typical flows

**Feature development:**
```
/brainstorm → /plan → /work → /review → /review-walk → /ship
```

**Multi-feature initiative:**
```
/initiative                          # draft initiative doc
  → /plan <workstream>               # plan one workstream
  → /work                            # implement it
  → /initiative docs/initiatives/…  # log progress back to the doc
  → repeat per workstream
```

**GitHub workflow:**
```
/branch <issue-number> → /work → /ship
```

## Structure

```
src/          CLI source (TypeScript)
skills/       Slash commands (SKILL.md files, copied to ~/.claude/skills/)
agents/       Subagents (copied to ~/.claude/agents/)
.claude-plugin/  Plugin metadata
docs/         Plans, brainstorms, initiatives generated at runtime
```

## Development

```bash
npm run build      # Compile TypeScript
npm run typecheck  # Type-check without emitting
npm run dev        # Watch mode
```

## Credits

The `/caveman` skill prompt is adapted from [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) under the MIT license. The persistence hook (`hooks/cc-forge-caveman-mode-tracker.cjs`) is an original cc-forge implementation that lifts the symlink-safe flag-file primitives from upstream. The flag file path (`~/.claude/.caveman-active`) is shared between cc-forge and upstream caveman, so installing both will coexist on the same state with cc-forge using a strict `{lite, full, ultra}` whitelist.
