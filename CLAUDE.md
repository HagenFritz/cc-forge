# CC Forge - Agent Instructions

Personal reference collection of Claude Code skills, agents, and hooks with GitHub integration. Not a package — people clone it and copy what they want into `~/.claude/`.

## Structure

```
.claude-plugin/   Plugin + marketplace metadata (one-command install path)
agents/           Specialized subagents (research, review, workflow, test)
skills/           Slash commands (SKILL.md files)
hooks/            Hook scripts (.cjs) + hooks.json (auto-wires hooks on /plugin install)
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
- `/deep-review` - Multi-agent code review (writes a review doc)
- `/compound` - Document learnings
- `/compact-prep` - Prepare a compaction handoff. Gathers objective state (git + session), asks what the next session should focus on (and confirms ambiguous state), then writes a fresh-agent-ready doc to `docs/handoff/` and prints the `@`-reference to paste after `/compact`. Always interactive; does not run `/compact` itself.
- `/ideate` - Generate improvement ideas
- `/deepen-plan` - Enhance plans with research
- `/deprecate` - Plan-only safe removal of a named concept (parallel research agents, leaves-first plan, compat-risk flags; hand off to `/work`)
- `/review-walk` - Guided execution of a `/deep-review` document. Walks issues group-by-group with a plain-English teach moment per group, then per-issue **implement / defer / skip / explain more**. Updates `Status:` inline in the review doc — durable, resumable. Auto-discovers the latest `docs/reviews/*.md` if no path is given. Falls back to issue-by-issue order on pre-enrichment review docs.
- `/caveman` - Ultra-terse response mode (lite/full/ultra). Persists across turns via a `UserPromptSubmit` hook that re-injects a reminder when active. Off by default. Activate with `/caveman <level>`; deactivate with `/caveman off`, "stop caveman", or "normal mode".

**Strategic:**
- `/initiative` - Author, maintain, and optionally publish a living high-level initiative doc at `docs/initiatives/`. One altitude up from `/plan` (workstreams, not commit-sized units). Two modes: invoke with no path to author a new initiative; invoke with the path to an existing initiative doc to resume — the skill gathers repo evidence since `last_updated` and writes the update back surgically. After either mode, offers to publish to GitHub as a parent issue with linked sub-tasks. Typical flow: `/initiative` → `/plan` per workstream → `/work` → `/initiative <path>` to log progress.

**GitHub Integration:**
- `/branch-from-issue` - Create and checkout a git branch from an issue number (auto-detects repo)
- `/issue-from-context` - Create GitHub issues from conversation context (auto-detects repo)
- `/ship` - Commit changes, push branch, and create a PR (auto-detects repo)
- `/land` - Takes an open PR all the way to merged. Resolves the open PR for the current branch (or pass a PR number), lets you pick the directory it most affected, prepends a capped (newest-10, FIFO) provenance entry — PR link + plan link + a one-line summary it writes — to that directory's `CLAUDE.md` `## Related` section, refreshes the body prose, and commits + pushes it onto the PR's branch so the doc change rides the same PR. Then runs the local test suite (skips with a note if none is detected), waits on GitHub Actions via `gh pr checks --watch`, and on CI failure proposes fixes one **user-confirmed** re-commit at a time (max 3 rounds — never unattended). Finally squash-merges + deletes the branch (asks only to override) and syncs `main`. Only claims "merged" after the merge actually succeeds.

## Applying changes

This is a reference repo, not a package — there's no build step or install CLI. Skills and agents are plain Markdown that Claude Code loads from `~/.claude/skills/` and `~/.claude/agents/`.

Two install paths (see README):
- **Plugin** (`/plugin install cc-forge`) — installs all skills, agents, and the caveman hook (the hook is auto-wired via `hooks/hooks.json`). Recommended.
- **Cherry-pick** — copy individual folders into `~/.claude/`:

```bash
cp -r skills/<name> ~/.claude/skills/
cp -r agents/<category> ~/.claude/agents/
```

Editing a file in this repo does **not** make it live — the plugin loads from a cache copy, read once at session start. `/plugin update` does **not** apply changes: it keys off the `version` in `.claude-plugin/plugin.json` and no-ops when that's unchanged, so newly added agents/skills never appear (you'll see `Agent type '…' not found`). To apply any change, force a clean reinstall then restart Claude Code: `/plugin uninstall cc-forge && rm -rf ~/.claude/plugins/cache/cc-forge-local/ && /plugin install cc-forge` (or copy the changed folder into `~/.claude/` for the cherry-pick route). See the README "Applying repo changes" note.

The `/caveman` hook is wired automatically by the plugin path via `hooks/hooks.json`. Only the cherry-pick route needs the manual `settings.json` paste documented in the README ("Caveman hook setup"). When adding a new hook in the future, add its script to `hooks/` and declare it in `hooks/hooks.json` (using `${CLAUDE_PLUGIN_ROOT}` for the path) so plugin installs pick it up automatically.

## Agent References in Skills

When referencing agents from within SKILL.md files, use fully-qualified names:
`cc-forge:<category>:<agent-name>` (e.g., `cc-forge:research:best-practices-researcher`)

## Related

- **PR #52** (2026-07-13): /deep-review deletes docs/reviews/.raw/<slug>/ after the synthesized doc is verified (never on fallback/clean-review); fixed README + CLAUDE.md plugin-reload guidance — /plugin update no-ops on an unchanged version, so use uninstall + rm -rf cache + install + restart
- **PR #49** (2026-07-09): add /compact-prep — interactive skill that gathers git+session state, asks the next session's focus, writes a fresh-agent handoff doc to docs/handoff/, and prints the @-ref to paste after /compact; also gitignore docs/reviews/ — [plan](docs/plans/2026-07-07-001-feat-compact-prep-skill-plan.md)
- **PR #43** (2026-06-25): remove document-review skill (broken agent refs, stale names), document plugin cache staleness workaround in README — [session](https://claude.ai/code/session_017p7uuzAi5nJw7s4usffXyD)
- **PR #39** (2026-06-23): /land now verifies CI and merges — after stamping CLAUDE.md it runs local tests, watches Actions, fixes failures with confirmed re-commits (max 3), squash-merges, and syncs main — [plan](docs/plans/2026-06-23-001-feat-land-merge-flow-plan.md)
- **Reframe as reference repo** (2026-06-20): dropped the npm package + TypeScript CLI installer (`src/`, `dist/`, `package.json`, manifest, settings-patcher); the repo is now clone-and-copy. Skills/agents apply by `cp -r` into `~/.claude/`; the caveman hook is wired by a documented manual paste — [plan](docs/plans/2026-06-20-001-refactor-reframe-as-reference-repo-plan.md)
- **PR #32**: add /land — a pre-merge skill that stamps a capped PR→plan→summary provenance trail into a directory's CLAUDE.md and commits it onto the open PR — [plan](docs/plans/2026-06-11-001-feat-land-skill-plan.md)
