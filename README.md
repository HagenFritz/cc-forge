# cc-forge

Personal development workflow plugin for Claude Code with GitHub integration.

## Installation

```bash
npm run build && node dist/cli.mjs install
```

This copies all skills and agents to `~/.claude/`. Restart Claude Code after installing.

### Other commands

```bash
node dist/cli.mjs uninstall   # Remove installed skills and agents
node dist/cli.mjs doctor      # Check installation health
```

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
