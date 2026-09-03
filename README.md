# cc-forge

A personal reference collection of Claude Code skills, agents, and hooks, built around a `brainstorm → blueprint → work → review → compound` loop with GitHub integration on top.

This is a **personal showcase**, not a package. Browse, copy the folders or ideas you want into your own `~/.claude/`, and adapt them. The workflows are tuned to one person's setup.

## How it's wired

The clone is symlinked into Claude Code's skills directory and loads in place as the `forge@skills-dir` plugin — every skill (namespaced `/forge:<name>`), every agent, and the caveman hook:

```bash
ln -s /path/to/your/clone/cc-forge ~/.claude/skills/cc-forge
```

Editing a file or pulling a commit is the deploy. `SKILL.md` edits are live immediately; agent, hook, and manifest changes need `/reload-plugins`. The dashboard (`node dashboard/dash.js`) is run by hand in its own terminal tab and is not plugin-loaded, so `/reload-plugins` does not apply to it.

## Skills

Two reference docs sit alongside the commands and are not invocable: [`skills/issue-log/SKILL.md`](skills/issue-log/SKILL.md), the spec for the "stamp" comments workflow skills post to the linked GitHub issue so its thread becomes a work log, and [`skills/glossary/SKILL.md`](skills/glossary/SKILL.md), the format of the personal glossary the learning skills write.

### Core workflow

| Skill | What it does | When to use |
|---|---|---|
| `/brainstorm` | Explores requirements through dialogue, writes a right-sized requirements doc | A vague or ambitious idea; you want to think before committing to scope |
| `/blueprint` | Turns a description or requirements doc into an implementation plan grounded in repo patterns | Requirements are roughly defined and you need a technical approach in units |
| `/deepen-blueprint` | Stress-tests a plan and strengthens weak sections with targeted research | A high-risk or deep plan needs more confidence |
| `/walk-blueprint` | **Optional.** Walks a plan one unit at a time with a plain-English teach moment, then accept / modify / remove / add term / skip. `remove` tombstones without renumbering; `add term` captures to the glossary without losing your place. Writes `**Reviewed:**` inline so it's resumable | You want to understand or correct a plan before any code is written |
| `/work` | Executes a plan unit by unit: one Opus subagent per unit, strictly serial, with the orchestrator reviewing each diff, committing, and stamping the issue | You have a plan and want it implemented |
| `/grind` | Executes a whole plan **autonomously as a sequence of PRs**: per slice, worktree → Opus builds and opens the PR → review fleet → `/grind` triages → Opus fixes → squash-merge on green CI. Halts on red; resumable via a `## PR Breakdown` table | A plan you trust, ground to merged `main` without babysitting. Needs no required-reviews protection |
| `/deep-review` | Exhaustive multi-agent code review; writes a review doc | Complex, risky, or large changes |
| `/review-walk` | Walks a review doc group by group with implement / defer / skip per issue; updates `Status:` inline; offers tracking issues for deferrals | You have a `docs/reviews/*.md` and want to act on it |
| `/push-review` | Commits and pushes the review fixes and posts a PR comment of what was fixed, deferred, and skipped | After `/review-walk`, before landing from another machine |
| `/catch-up` | Fast-forwards a worktree branch and reports incoming commits and review-status changes | Picking up commits pushed from another machine |
| `/compound` | Documents a recently solved problem so the knowledge compounds | Right after solving something non-obvious |
| `/compact-prep` | Writes a fresh-agent handoff doc to `docs/handoff/` and prints the `@`-reference to paste after `/compact` | Context is getting full and you want the next session to resume cleanly |
| `/ideate` | Generates and critically evaluates improvement ideas for the project | "What should I improve?" |
| `/deprecate` | Plan-only safe removal of a named concept: finds every reference, outputs a leaves-first plan | "Rip out X" — hand the plan to `/work` |

### Strategic

| Skill | What it does | When to use |
|---|---|---|
| `/initiative` | Authors or resumes a living initiative doc at `docs/initiatives/` — workstreams, one altitude above `/blueprint`; optionally publishes as a parent issue with sub-tasks | Multi-feature efforts spanning many plans |

### GitHub integration

| Skill | What it does | When to use |
|---|---|---|
| `/branch-from-issue` | Creates and checks out a branch from an issue number, in the **current** directory | Starting issue work, no isolation needed |
| `/tree` | Creates a git worktree on its own branch at `../<repo>-worktrees/<branch>/`, with `docs/` symlinked in | Work you want in its own directory, e.g. several branches at once |
| `/issue-from-context` (alias `/ifc`) | Creates a GitHub issue from conversation context. `--prefix <str>` prepends a title prefix; `--who <names>` assigns teammates by first name | Something worth tracking surfaced mid-conversation |
| `/read-issue` | Fetches an issue and presents a structured digest | You want an issue summarized in-session |
| `/triage-issue` | Investigates whether an issue is still present, fixed, or needs digging; writes to `docs/triage/` | Verifying a report still reproduces |
| `/ship` | Commits per file, pushes, and creates a PR | Work is done |
| `/land` | Merges an open PR with zero prompts: runs the PR's pre-merge checklist, waits on CI, squash-merges, removes the worktree, syncs `main`, stamps the issue. Red halts | A PR is ready to merge |

GitHub skills shell out to `gh`; have it installed and authenticated.

### Local testing & git utilities

| Skill | What it does | When to use |
|---|---|---|
| `/preview` | Merges a worktree branch into a disposable `preview/*` branch in the primary checkout, so running dev servers pick it up | Live-testing a worktree branch without restarting anything |
| `/unpreview` | Returns the primary checkout to `main` and deletes the `preview/*` branch | Done previewing |
| `/commit-all` | Commits all changes, one commit per file | Granular commits without hand-staging |

### Project tracking

| Skill | What it does | When to use |
|---|---|---|
| `/side-quest` | Files a `follow-up` tracking issue for out-of-scope work and stamps the originating issue | Something worth tracking but out of scope right now |
| `/stand-up` | Summarizes the past 28h of commits, PRs, and linked issues | Daily catch-up |
| `/test-plan` | Generates a manual test plan from the branch diff; saves a living doc to `docs/tests/` | A structured manual-testing pass |

### Response mode

| Skill | What it does | When to use |
|---|---|---|
| `/caveman` | Ultra-terse mode (`lite` / `full` / `ultra`), persisted across turns by a hook | `/caveman <level>` for terse output; `/caveman off` to stop |
| `/tldr` | Caps **one** response at N sentences in plain language; identifiers and paths never paraphrased | `/tldr <n> [question]` for a straight short answer |

### Learning

| Skill | What it does | When to use |
|---|---|---|
| `/term-add` | Captures a term into `~/.claude/glossary.md`: normalizes it (typos fixed, glossary casing), drafts a two-sentence plain-English definition, an example, a near-miss, and a related term, and prints the entry back. Never asks you to define it | You hit a word you don't know |
| `/term-quiz` | Quizzes you with Leitner spaced repetition (boxes at 1/3/7/14/30/90 days): overdue terms first, question type escalating with the box, Claude grades on meaning, state written back per item. Misses get a multiple-choice scaffold after grading and a re-ask at the close | `/term-quiz [n]` (default 8). Intervals are minimum waits, so sporadic use is fine |

The glossary is one unversioned file outside every repo, yours to hand-edit. `/walk-blueprint`'s `add term` writes to it through `/term-add`.

## Agents

Subagents live in `agents/`, grouped by category. Skills reference them as `forge:<category>:<agent>`, so copy the referenced category along with any skill that dispatches agents.

| Category | Agents | Purpose |
|---|---|---|
| `research/` | best-practices-researcher, framework-docs-researcher, git-history-analyzer, issue-intelligence-analyst, learnings-researcher, repo-research-analyst | External docs, git archaeology, issue analysis, institutional learnings, repo conventions |
| `review/` | adversarial-reviewer, architecture-strategist, code-simplicity-reviewer, correctness-auditor, data-integrity-guardian, pattern-recognition-specialist, performance-oracle-{python,typescript}, python-reviewer, reliability-engineer, security-sentinel-{python,typescript}, test-coverage-reviewer, typescript-reviewer | Review specialists across correctness, security, performance, architecture, reliability, simplicity, tests, and language idioms |
| `workflow/` | lint, spec-flow-analyzer | Linting and spec/flow analysis |
| `test/` | test-plan-critic | Scores a test plan's cases and appends a drop list |

## Typical flows

**Feature development** (bracketed steps optional):
```
/brainstorm → /blueprint → [/walk-blueprint] → /work → /deep-review → /review-walk → /ship → /land
```

**Multi-feature initiative:**
```
/initiative → /blueprint <workstream> → /work → /initiative <path>   # repeat per workstream
```

**Worktree-isolated** (primary checkout stays on `main`):
```
/brainstorm → /blueprint → /tree <issue> → new session in the worktree → /work → /deep-review → /ship → /land
```

`/tree` replaces `/branch-from-issue` when you want the branch in its own directory; `/land` removes the worktree on merge.

## Structure

```
skills/          Slash commands (one SKILL.md per skill)
agents/          Subagents grouped by category (research/review/workflow/test)
hooks/           Hook scripts (the caveman mode tracker)
dashboard/       Live terminal dashboard for monitoring sessions (not plugin-loaded)
.claude-plugin/  Plugin manifest (makes the symlinked clone load as forge@skills-dir)
docs/            Plans, brainstorms, reviews, initiatives generated at runtime
```

## Credits

Scaffolded from [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) by [Every Inc](https://every.to) (Kieran Klaassen, T.M. Chow), MIT-licensed — the core workflow, the agent categories, and several skills derive from it.

The `/caveman` prompt is adapted from [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) (MIT). The persistence hook is original to cc-forge and shares the `~/.claude/.caveman-active` flag file with upstream, so both can coexist.
