# cc-forge

Personal development workflow plugin for Claude Code with Toggl and GitHub integration.

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

Changes in `skills/` or `agents/` are not live until install runs. The install command copies them to `~/.claude/skills/` and `~/.claude/agents/`.

## Skills

### Core workflow

| Skill | Description |
|---|---|
| `/brainstorm` | Explore requirements and approaches |
| `/plan` | Create implementation plans |
| `/work` | Execute work plans |
| `/review` | Multi-agent code review |
| `/compound` | Document learnings |
| `/ideate` | Generate improvement ideas |
| `/deepen-plan` | Stress-test plans with targeted research |
| `/document-review` | Review requirement/plan docs |
| `/git-worktree` | Manage git worktrees |
| `/frontend-design` | Design-quality frontend code |

### Strategic

| Skill | Description |
|---|---|
| `/initiative` | Author and maintain a living high-level initiative doc at `docs/initiatives/`. Two modes: no argument drafts a new initiative; passing an existing initiative path resumes it — gathers evidence (commits, sub-plans, PR/issue activity) since last update and writes back surgically. Composes with `/create-initiative`. |

### GitHub integration

| Skill | Description |
|---|---|
| `/branch` | Create and checkout a branch from an issue number |
| `/create-issue-from-context` | Create GitHub issues from conversation context |
| `/create-initiative` | Publish an initiative as a parent GitHub issue with linked sub-tasks |
| `/ship` | Commit, push, and create a PR |

## Typical flows

**Feature development:**
```
/brainstorm → /plan → /work → /review → /ship
```

**Multi-feature initiative:**
```
/initiative                          # draft initiative doc
  → /plan <workstream>               # plan one workstream
  → /work                            # implement it
  → /initiative docs/initiatives/…  # log progress back to the doc
  → repeat per workstream
  → /create-initiative               # optionally publish to GitHub
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
