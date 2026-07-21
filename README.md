# cc-forge

A personal reference collection of Claude Code skills, agents, and hooks for structured development workflows, code review, and research automation.

This repo is meant to be **referenced and cherry-picked**, not installed as a package. Browse the skills and agents below, copy the ones you want into your own `~/.claude/`, and adapt them. The whole thing is built around a `brainstorm → plan → work → review → compound` loop with GitHub integration on top.

## How to use it

Two ways: install the whole set as a plugin (one command, everything wired), or cherry-pick individual skills by copying folders.

### Install everything (recommended)

Clone the repo, then point Claude Code's plugin system at your local checkout:

```text
/plugin marketplace add /path/to/your/clone/cc-forge
/plugin install cc-forge
```

This installs **all skills, all agents, and the caveman hook** — the hook is wired automatically via `hooks/hooks.json`, so there's no `settings.json` editing. Restart Claude Code and you're done.

(The marketplace is named `cc-forge-local` with `source: "./"`, so add it by the **path to your clone**, not a remote `owner/repo` reference.)

> **Applying repo changes to the installed plugin.** Editing files in this clone does **not** make them live — the plugin loads from a cache copy under `~/.claude/plugins/cache/`, and agents/skills are read once at session start. `/plugin update` does **not** help for a local directory-source plugin: it compares the `version` string in `.claude-plugin/plugin.json`, so if that hasn't bumped it reports "already at the latest version" and rebuilds nothing — even when new commits added agents or skills. That's why a newly added agent shows up as `Agent type '…' not found`.
>
> To pick up any repo change (added, renamed, or deleted files), force a clean reinstall, then **restart Claude Code** so the new agents/skills load:
>
> ```bash
> /plugin uninstall cc-forge
> rm -rf ~/.claude/plugins/cache/cc-forge-local/
> /plugin install cc-forge
> ```
>
> A reinstall alone can leave stale metadata pointing at an already-deleted cache dir; the `rm -rf` guarantees the cache rebuilds from your clone's current `HEAD` (uncommitted working-tree edits included).

### Cherry-pick individual pieces

Skills and agents are plain Markdown that Claude Code loads from `~/.claude/skills/` and `~/.claude/agents/`. To grab just one, copy its folder:

```bash
cp -r skills/plan ~/.claude/skills/        # one skill
cp -r agents/research ~/.claude/agents/    # one agent category
```

Restart Claude Code after copying. Skills become available as `/<name>` slash commands; agents are dispatchable via the Task tool.

> Copying the `/caveman` skill this way gets the prompt but **not** its persistence hook — that needs one manual step ([Caveman hook setup](#caveman-hook-setup)). The plugin install above wires it for you; this manual step is only for the cherry-pick route.

## Skills

**Issue-log convention:** the workflow skills (brainstorm, plan, work, deep-review, review-walk, ship, land, tree, branch-from-issue, side-quest) each post a standardized "stamp" comment to the linked GitHub issue at their key event — a hidden machine-readable marker plus a short human-readable body — so an issue's thread becomes a reconstructable work log. The spec lives at [`skills/issue-log/SKILL.md`](skills/issue-log/SKILL.md) (a reference doc, not a command).

### Core workflow

| Skill | What it does | When to use |
|---|---|---|
| `/brainstorm` | Explores requirements and approaches through dialogue, then writes a right-sized requirements doc | A vague or ambitious feature idea; you want to think through options before committing to scope |
| `/plan` | Turns a feature description or requirements doc into a structured implementation plan grounded in repo patterns | Requirements are roughly defined and you need a technical approach broken into units |
| `/deepen-plan` | Stress-tests an existing plan and selectively strengthens weak sections with targeted research | A Standard/Deep or high-risk plan needs more confidence around decisions, sequencing, or risk |
| `/work` | Executes a work plan unit-by-unit, following repo patterns and testing as it goes | You have a plan and want it implemented |
| `/deep-review` | Exhaustive multi-agent code review using worktrees; writes a structured review doc | Complex, risky, or large changes that warrant deep review |
| `/review-walk` | Walks a `/deep-review` document interactively, group-by-group, with implement/defer/skip per issue; updates `Status:` inline so it's resumable; stamps the walk outcome at the end | You have a `docs/reviews/*.md` and want to act on it methodically |
| `/compound` | Documents a recently solved problem so the knowledge compounds | Right after solving something non-obvious worth recording |
| `/ideate` | Generates and critically evaluates grounded improvement ideas for the project | "What should I improve?" — you want AI-generated directions before brainstorming one |
| `/deprecate` | Plan-only safe removal of a named concept: parallel research agents find every reference, output a leaves-first plan with compat-risk flags | "Rip out X" / "retire X" — hand the resulting plan to `/work` |

**Dependencies:** these skills are self-contained Markdown. Some dispatch the agents in `agents/` (see [Agents](#agents)) — copy those too if you want the full behavior.

### Strategic

| Skill | What it does | When to use |
|---|---|---|
| `/initiative` | Authors, maintains, and optionally publishes a high-altitude living initiative doc at `docs/initiatives/` — one altitude up from `/plan` (workstreams, not commit-sized units). Two modes: no path **authors** a new initiative; passing an existing path **resumes** it by gathering evidence since `last_updated`. Optionally publishes to GitHub as a parent issue with linked sub-tasks | Multi-feature efforts that span many plans and need a durable record that survives compaction |

Typical flow: `/initiative` → `/plan` per workstream → `/work` → `/initiative <path>` to log progress.

### GitHub integration

| Skill | What it does | When to use |
|---|---|---|
| `/branch-from-issue` | Creates and checks out a git branch from an issue number or conversation context, in the **current** directory | Starting work tied to an issue, no isolation needed |
| `/tree` | Creates a git worktree — a second working directory on its own new branch, sibling to the primary checkout at `../<repo>-worktrees/<branch-name>/` — instead of checking the branch out in place. Symlinks `docs/` in so brainstorm/plan docs stay visible | Starting work you want isolated in its own directory (e.g. so the primary checkout can stay on `main`, or to run several branches concurrently in separate sessions) |
| `/issue-from-context` | Generates a GitHub issue from conversation context and adds it to a project | Something worth tracking surfaced mid-conversation |
| `/read-issue` | Fetches a GitHub issue by number and presents a structured digest | You want an issue's content summarized in-session |
| `/triage-issue` | Fetches an issue and investigates the codebase to determine if it's still present, fixed, or needs more digging; writes to `docs/triage/` | Verifying whether a reported issue still reproduces |
| `/ship` | Commits all changes per-file, pushes the branch, and creates a PR | Work is done and you want it shipped |
| `/land` | Takes an open PR to merged: stamps a capped provenance entry (PR + plan link + one-line summary) into the affected directory's `CLAUDE.md` and commits it onto the PR's branch, runs local tests, waits on GitHub Actions, fixes CI failures one confirmed re-commit at a time (max 3), squash-merges + deletes the branch, then syncs `main`. If the branch lived in a `/tree` worktree, removes that worktree too (`git worktree remove`, not a raw delete) before syncing | When a PR is ready to merge — closes the loop in one command |

**Dependency note:** the GitHub skills shell out to the `gh` CLI; have it installed and authenticated.

### Git utilities

| Skill | What it does | When to use |
|---|---|---|
| `/commit-all` | Stages and commits all unstaged changes with per-file commit messages | You want granular commits without hand-staging each file |

### Project tracking

| Skill | What it does | When to use |
|---|---|---|
| `/side-quest` | Documents out-of-scope tasks or tech debt discovered during execution, files a `follow-up`-labeled tracking issue, and stamps the originating issue | You hit something worth tracking but out of scope for the current task |
| `/stand-up` | Summarizes the past 28h of commits, PRs, and linked issues | A daily catch-up on what moved |
| `/test-plan` | Generates a manual test plan from current branch diffs (unstaged, staged, committed); saves a living doc to `docs/tests/` with pass/fail you update | You want a structured manual-testing pass over a branch's changes |

### Response mode

| Skill | What it does | When to use |
|---|---|---|
| `/caveman` | Ultra-compressed response mode (`lite` / `full` / `ultra`) — cuts token usage by dropping articles/filler/pleasantries while keeping full technical accuracy. Persists across turns via a `UserPromptSubmit` hook. Off by default | You want terse output. Activate with `/caveman <level>`; deactivate with `/caveman off`, "stop caveman", or "normal mode" |

**Dependency:** persistence requires a hook — see [Caveman hook setup](#caveman-hook-setup). Without it the skill still works, but the mode may drift back to normal prose over a long session; just re-run `/caveman <level>` if it does.

## Agents

Specialized subagents live in `agents/`, grouped by category. Copy a category folder (`cp -r agents/<category> ~/.claude/agents/`) to make them dispatchable.

| Category | Agents | Purpose |
|---|---|---|
| `research/` | best-practices-researcher, framework-docs-researcher, git-history-analyzer, issue-intelligence-analyst, learnings-researcher, repo-research-analyst | Code research, external docs, git archaeology, issue analysis, institutional learnings, repo conventions |
| `review/` | adversarial-reviewer, architecture-strategist, code-simplicity-reviewer, correctness-auditor, data-integrity-guardian, pattern-recognition-specialist, performance-oracle-{python,typescript}, python-reviewer, reliability-engineer, security-sentinel-{python,typescript}, test-coverage-reviewer, typescript-reviewer | Code-review specialists across correctness, security, performance, architecture, reliability, data integrity, simplicity, patterns, tests, and language idioms |
| `workflow/` | lint, spec-flow-analyzer | Linting and spec/flow analysis |
| `test/` | test-plan-critic | Annotates a test plan with viability scores and a drop list |

Skills reference agents by fully-qualified name (`cc-forge:<category>:<agent>`), so if you copy a skill that dispatches agents, copy the referenced agent category too.

## Caveman hook setup

> **Skip this if you installed via the plugin** (`/plugin install cc-forge`) — the hook is already wired by `hooks/hooks.json`. This section is only for the cherry-pick route, where you copied the `/caveman` skill folder by hand.

`/caveman` persists its mode by re-injecting a reminder on every prompt via a `UserPromptSubmit` hook. When you copy the skill folder manually, the hook isn't wired — do these two one-time steps:

**Step 1 — copy the hook script:**

```bash
mkdir -p ~/.claude/hooks
cp hooks/cc-forge-caveman-mode-tracker.cjs ~/.claude/hooks/
chmod +x ~/.claude/hooks/cc-forge-caveman-mode-tracker.cjs
```

**Step 2 — register it in `~/.claude/settings.json`.** Add this entry to the `UserPromptSubmit` array (replace `<HOME>` with your home directory, e.g. `/Users/you`):

```json
{
  "matcher": "",
  "hooks": [
    {
      "type": "command",
      "command": "<HOME>/.claude/hooks/cc-forge-caveman-mode-tracker.cjs",
      "timeout": 10
    }
  ]
}
```

> **Append — don't replace.** `UserPromptSubmit` is an array. If you already have hooks there, add this as a new element; do not overwrite existing entries. If `hooks.UserPromptSubmit` doesn't exist yet, create it as an array containing this one entry. If the file doesn't exist, create it as `{ "hooks": { "UserPromptSubmit": [ <the entry above> ] } }`.

Restart Claude Code. The hook reads a flag file at `~/.claude/.caveman-active` (contents = active level, absent = off) and is safe to leave installed — it does nothing unless caveman mode is active.

**To remove it:** delete `~/.claude/hooks/cc-forge-caveman-mode-tracker.cjs` and remove the entry you added from the `UserPromptSubmit` array.

> **Migrating from the old CLI?** Earlier versions of cc-forge shipped an installer that wrote `~/.claude/.cc-forge-manifest.json`. Nothing reads that file anymore — you can safely `rm ~/.claude/.cc-forge-manifest.json`.

## Typical flows

**Feature development:**
```
/brainstorm → /plan → /work → /review → /review-walk → /ship
```

**Multi-feature initiative:**
```
/initiative                        # draft initiative doc
  → /plan <workstream>             # plan one workstream
  → /work                          # implement it
  → /initiative docs/initiatives/… # log progress back to the doc
  → repeat per workstream
```

**GitHub workflow:**
```
/branch-from-issue <issue-number> → /work → /ship → /land
```

**Worktree-isolated workflow** (primary checkout stays on `main` throughout):
```
/brainstorm → /plan → /tree <issue-number>
  → cd into the printed worktree path, start a new Claude Code session there
  → /work → /deep-review → /ship → /land   # /land removes the worktree on merge
```
`/tree` is a drop-in alternative to `/branch-from-issue` for when you want the branch developed in its own directory rather than checked out in place — useful once you're running several branches at once, since each worktree is a fully separate working directory with no stashing required to switch between them.

## Structure

```
skills/          Slash commands (one SKILL.md per skill)
agents/          Subagents grouped by category (research/review/workflow/test)
hooks/           Hook scripts (currently just the caveman mode tracker)
.claude-plugin/  Plugin + marketplace metadata (optional one-command install path)
docs/            Plans, brainstorms, reviews, initiatives generated at runtime
```

## Credits

cc-forge was originally scaffolded from [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) by [Every Inc](https://every.to) (Kieran Klaassen, T.M. Chow), MIT-licensed. The core `brainstorm → plan → work → review → compound` workflow, the research/review/workflow agent categories, and several skills derive from that project; cc-forge adapts and extends them for personal use. Credit and thanks to the compound-engineering authors for the foundation.

The `/caveman` skill prompt is adapted from [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) under the MIT license. The persistence hook (`hooks/cc-forge-caveman-mode-tracker.cjs`) is an original cc-forge implementation that lifts the symlink-safe flag-file primitives from upstream. The flag file path (`~/.claude/.caveman-active`) is shared between cc-forge and upstream caveman, so installing both will coexist on the same state, with cc-forge using a strict `{lite, full, ultra}` whitelist.
