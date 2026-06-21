# CC Forge - Agent Instructions

Personal reference collection of Claude Code skills, agents, and hooks with GitHub integration. Not a package — people clone it and copy what they want into `~/.claude/`.

## Structure

```
.claude-plugin/   Plugin + marketplace metadata (optional one-command install path)
agents/           Specialized subagents (research, review, workflow, test)
skills/           Slash commands (SKILL.md files)
hooks/            Claude Code hook scripts (.cjs; copied manually to ~/.claude/hooks/)
docs/             Plans, brainstorms, reviews, initiatives generated at runtime
```

## Agents

- `research/` - Code research, docs lookup, git history, issue analysis, learnings, best practices
- `review/` - Code review specialists (architecture, security, performance, patterns, simplicity, TypeScript, Python)
- `workflow/` - Bug reproduction, linting, PR comments, spec analysis
- `test/` - Test-plan critique (viability scoring + drop list)

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
- `/caveman` - Ultra-terse response mode (lite/full/ultra). Persists across turns via a `UserPromptSubmit` hook that re-injects a reminder when active. Off by default. Activate with `/caveman <level>`; deactivate with `/caveman off`, "stop caveman", or "normal mode".

**Strategic:**
- `/initiative` - Author, maintain, and optionally publish a living high-level initiative doc at `docs/initiatives/`. One altitude up from `/plan` (workstreams, not commit-sized units). Two modes: invoke with no path to author a new initiative; invoke with the path to an existing initiative doc to resume — the skill gathers repo evidence since `last_updated` and writes the update back surgically. After either mode, offers to publish to GitHub as a parent issue with linked sub-tasks. Typical flow: `/initiative` → `/plan` per workstream → `/work` → `/initiative <path>` to log progress.

**GitHub Integration:**
- `/branch` - Create and checkout a branch from an issue number (auto-detects repo)
- `/issue-from-context` - Create GitHub issues from conversation context (auto-detects repo)
- `/ship` - Commit changes, push branch, and create a PR (auto-detects repo)
- `/land` - Pre-merge step run on an open PR. Resolves the open PR for the current branch (or pass a PR number), lets you pick the directory it most affected, prepends a capped (newest-10, FIFO) provenance entry — PR link + plan link + a one-line summary it writes — to that directory's `CLAUDE.md` `## Related` section, refreshes the body prose, then commits and pushes the update onto the PR's branch so the doc change merges with the same PR. Run it just before merging; never merges the PR itself.

## Applying changes

This is a reference repo, not a package — there's no build step or install CLI. Skills and agents are plain Markdown that Claude Code loads from `~/.claude/skills/` and `~/.claude/agents/`.

To apply an edit to a skill or agent, copy the changed folder into `~/.claude/` and restart Claude Code:

```bash
cp -r skills/<name> ~/.claude/skills/
cp -r agents/<category> ~/.claude/agents/
```

Editing a file in this repo does **not** make it live — it must be copied into `~/.claude/`. (Alternatively, load the whole set via the plugin path in `.claude-plugin/`; see README.)

The `/caveman` skill additionally needs a `UserPromptSubmit` hook wired into `~/.claude/settings.json`. That's a one-time manual copy-paste documented in the README ("Caveman hook setup") — there is no installer to do it automatically.

## Agent References in Skills

When referencing agents from within SKILL.md files, use fully-qualified names:
`cc-forge:<category>:<agent-name>` (e.g., `cc-forge:research:best-practices-researcher`)

## Related

- **Reframe as reference repo** (2026-06-20): dropped the npm package + TypeScript CLI installer (`src/`, `dist/`, `package.json`, manifest, settings-patcher); the repo is now clone-and-copy. Skills/agents apply by `cp -r` into `~/.claude/`; the caveman hook is wired by a documented manual paste — [plan](docs/plans/2026-06-20-001-refactor-reframe-as-reference-repo-plan.md)
- **PR #32**: add /land — a pre-merge skill that stamps a capped PR→plan→summary provenance trail into a directory's CLAUDE.md and commits it onto the open PR — [plan](docs/plans/2026-06-11-001-feat-land-skill-plan.md)
