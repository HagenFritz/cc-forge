# CC Forge - Agent Instructions

Personal development workflow plugin with GitHub integration.

## Structure

```
.claude-plugin/   Plugin metadata
agents/           Specialized subagents (research, review, workflow)
skills/           Slash commands (SKILL.md files)
```

## Agents

- `research/` - Code research, docs lookup, git history, best practices
- `review/` - Code review specialists (architecture, security, performance, patterns, simplicity, TypeScript, Python)
- `workflow/` - Bug reproduction, linting, PR comments, spec analysis

## Skills

Core workflow: brainstorm -> plan -> work -> review -> compound

- `/brainstorm` - Explore requirements and approaches
- `/plan` - Create implementation plans
- `/work` - Execute work plans
- `/review` - Multi-agent code review
- `/compound` - Document learnings
- `/ideate` - Generate improvement ideas
- `/deepen-plan` - Enhance plans with research
- `/document-review` - Review requirement/plan docs
- `/deprecate` - Plan-only safe removal of a named concept (parallel research agents, leaves-first plan, compat-risk flags; hand off to `/work`)
- `/review-walk` - Guided execution of a `/review` document. Walks issues group-by-group with a plain-English teach moment per group, then per-issue **implement / defer / skip / explain more**. Updates `Status:` inline in the review doc — durable, resumable. Auto-discovers the latest `docs/reviews/*.md` if no path is given. Falls back to issue-by-issue order on pre-enrichment review docs.

**Strategic:**
- `/initiative` - Author, maintain, and optionally publish a living high-level initiative doc at `docs/initiatives/`. One altitude up from `/plan` (workstreams, not commit-sized units). Two modes: invoke with no path to author a new initiative; invoke with the path to an existing initiative doc to resume — the skill gathers repo evidence since `last_updated` and writes the update back surgically. After either mode, offers to publish to GitHub as a parent issue with linked sub-tasks. Typical flow: `/initiative` → `/plan` per workstream → `/work` → `/initiative <path>` to log progress.

**GitHub Integration:**
- `/branch` - Create and checkout a branch from an issue number (auto-detects repo)
- `/issue-from-context` - Create GitHub issues from conversation context (auto-detects repo)
- `/ship` - Commit changes, push branch, and create a PR (auto-detects repo)

## Development Workflow

This is a Claude Code plugin distributed as an npm package. Skills live in `skills/` and agents in `agents/`. The CLI in `src/` copies them to `~/.claude/` on install.

### After changing skills or agents, you MUST install to apply changes

```bash
npm run build && node dist/cli.mjs install
```

Do NOT assume skills are live just because files exist on disk. The install command copies `skills/` and `agents/` to `~/.claude/skills/` and `~/.claude/agents/`. Without running install, changes are only in the working tree and not available to Claude Code.

Always run `npm run build && node dist/cli.mjs install` after modifying any skill or agent file, then tell the user to restart Claude Code for changes to take effect.

### Commands

- `npm run build` — compile TypeScript to `dist/`
- `node dist/cli.mjs install` — copy skills + agents to `~/.claude/`
- `node dist/cli.mjs uninstall` — remove installed skills + agents
- `node dist/cli.mjs doctor` — check installation health

## Agent References in Skills

When referencing agents from within SKILL.md files, use fully-qualified names:
`cc-forge:<category>:<agent-name>` (e.g., `cc-forge:research:best-practices-researcher`)
