# cc-forge

A personal reference collection of Claude Code skills and agents, built around a `brainstorm → blueprint → work → test → ship → review → land` loop with GitHub integration on top.

This is a **personal showcase**, not a package. Browse, copy the folders or ideas you want into your own `~/.claude/`, and adapt them. The workflows are tuned to one person's setup.

## How it's wired

The clone is symlinked into Claude Code's skills directory and loads in place as the `forge@skills-dir` plugin — every skill (namespaced `/forge:<name>`) and every agent:

```bash
ln -s /path/to/your/clone/cc-forge ~/.claude/skills/cc-forge
```

Editing a file or pulling a commit is the deploy. `SKILL.md` edits are live immediately; agent, hook, and manifest changes need `/reload-plugins`. The dashboard is run by hand in its own terminal tab and is not plugin-loaded, so `/reload-plugins` does not apply to it. Launch it with `ccdash` — a one-line `~/.local/bin` wrapper you install once per machine, named that because `/bin/dash` shadows `dash` on PATH ([`dashboard/CLAUDE.md`](dashboard/CLAUDE.md) has the two commands) — or directly with `node dashboard/dash.js`. The table is `STATE AGE NAME SKILL AGENTS DIR SUMMARY` — SKILL is the slash command the session is on, AGENTS the number of subagents it has running, and SUMMARY wraps to two lines and is summarized by Haiku. That summary is one outbound Anthropic API call per session turn (~$0.0004, so pennies a day) billed to **your own** key, taken from `ANTHROPIC_API_KEY` or an `ANTHROPIC_API_KEY=` line in a repo-root `.env` (gitignored, so a clone needs its own); with no key configured the dashboard runs as it always did and shows the raw transcript text instead. Live keys: Up/Down to move the highlight (arrows only), Space to expand the highlighted session into one line per running agent — one session at a time — Enter to focus that session's iTerm tab, `r` to rename that tab, `q` to quit. Flags: `--once`, `--width <n>`, `--fixture <path>`, `--alert-idle` to bell on idle transitions as well as waiting ones, `--listen <port>` to move the VM listener off its default 45801, and `--no-listen` to turn it off. Devbox sessions sit in the same table by default — the `hooks/cc-forge-session-emitter.cjs` hook posts each state transition from the VM over an ssh reverse forward, so a permission prompt there rings the same bell. [`dashboard/CLAUDE.md`](dashboard/CLAUDE.md) has the ssh-config block, the shared token, and the VM-side install.

## Skills

Five reference docs sit alongside the commands and are not invocable: [`skills/issue-log/SKILL.md`](skills/issue-log/SKILL.md), the spec for the "stamp" comments workflow skills post to the linked GitHub issue so its thread becomes a work log; [`skills/glossary/SKILL.md`](skills/glossary/SKILL.md), the format of the personal glossary the learning skills write; [`skills/walk-protocol/SKILL.md`](skills/walk-protocol/SKILL.md), the rules the three walks share; [`skills/review-protocol/SKILL.md`](skills/review-protocol/SKILL.md), the rules `/deep-review` and `/quick-review` share; and [`skills/test-protocol/SKILL.md`](skills/test-protocol/SKILL.md), the rules `/test-plan`, `/test-plan-run`, and `/grind`'s test phase share.

Skills are named by what they do to an artifact: producers take the name of what they write (`/brainstorm`, `/blueprint`, `/test-plan`, `/deep-review`, `/quick-review`), and skills that act on an artifact already on disk are `<artifact>-<action>` (`/test-plan-run`, `/review-walk`, `/review-sweep`, `/review-push`, and the two other walks).

### Core workflow

| Skill | What it does | When to use |
|---|---|---|
| `/brainstorm` | Explores requirements through dialogue, writes a right-sized requirements doc | A vague or ambitious idea; you want to think before committing to scope |
| `/brainstorm-walk` | **Optional.** Walks a requirements doc one `R`-bullet at a time with a plain-English teach moment, then accept / modify / remove / add term / skip. Non-`R` sections render once as read-only context; `remove` tombstones without renumbering; `add term` captures to the glossary without losing your place. Writes `**Reviewed:**` inline so it's resumable. Hard-stops on a doc whose requirements aren't `R`-numbered | You want to understand or correct requirements before they're planned |
| `/blueprint` | Turns a description or requirements doc into an implementation plan grounded in repo patterns | Requirements are roughly defined and you need a technical approach in units |
| `/blueprint-deepen` | Stress-tests a plan and strengthens weak sections with targeted research | A high-risk or deep plan needs more confidence |
| `/blueprint-walk` | **Optional.** Walks a plan one unit at a time with a plain-English teach moment, then accept / modify / remove / add term / skip. `remove` tombstones without renumbering; `add term` captures to the glossary without losing your place. Writes `**Reviewed:**` inline so it's resumable | You want to understand or correct a plan before any code is written |
| `/work` | Executes a plan unit by unit: one Opus subagent per unit, strictly serial, with the orchestrator reviewing each diff, committing, and stamping the issue. Writes no tests and runs no suite | You have a plan and want it implemented |
| `/test-plan` | Proposes the test cases for the branch: three lenses in parallel — spec (no file tools), blast-radius, surface — into a synthesizer that tags each case `auto`/`browser`/`manual`, applies the keep and drop rules, caps `auto` at 15, and writes `docs/tests/*.md` with a Drop List. Stops for review; writes no test files | Work is done and you want a reviewable list of what to test |
| `/test-plan-run` | Runs one scope of a reviewed test plan — `auto` writes the tests through an outside-observer writer that never sees the diff and runs the assurance filters (collect, pass, N reruns), `browser` drives the flows, `manual` walks the cards one at a time. Records `Status:`, a `**Filter:**` line, and a `## Receipts` block in the doc, and reports receipts rather than "tests pass". Leaves the tests uncommitted for `/ship` | `/test-plan-run [auto\|browser\|manual]`; no argument runs auto then browser |
| `/grind` | Executes a whole plan **autonomously as a sequence of PRs**: per slice, worktree → Opus builds → `/grind` writes and runs the tests and opens the PR → review fleet → `/grind` triages → Opus fixes → squash-merge on green CI. Halts on red; resumable via a `## PR Breakdown` table | A plan you trust, ground to merged `main` without babysitting. Needs no required-reviews protection |
| `/deep-review` | Exhaustive multi-agent code review; writes a review doc | Complex, risky, or large changes |
| `/quick-review` | The lite sibling of `/deep-review`: a fixed roster of correctness + simplicity, plus at most one language reviewer picked by the diff's dominant extension (files changed, not lines). Same review doc, so the downstream skills consume it unchanged. Reviews what's checked out here — never creates a worktree or switches branches | A small diff where the full fleet is overkill |
| `/review-walk` | Walks a review doc one finding at a time (P1 → P2 → P3) as compact cards with a plain-text implement / defer / wont-fix / term / explain line; updates `Status:` inline; defer files a tracking issue on the spot | You have a `docs/reviews/*.md` and want to act on it |
| `/review-sweep` | **Optional.** Takes the quick wins from a review doc unattended: reads the cited code, implements only Small+high/medium (and P1 Medium+high) findings, marks reviewer misreads `wont-fix`, and leaves the rest `open` with a `**Sweep:**` reason. Zero prompts; edits inline and uncommitted | You want the cheap-and-certain fixes applied before walking the rest by hand |
| `/review-push` | Commits and pushes the review fixes and posts a PR comment of what was fixed, deferred, and skipped | After `/review-walk`, before landing from another machine |
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
| `/ship` | Commits per file (tests included), pushes — the suite runs once, in CI, off that push — and creates a PR whose pre-merge checklist holds only what CI cannot run | Work is done and tests are written |
| `/land` | Merges an open PR with zero prompts: runs the PR's pre-merge checklist, waits on CI, squash-merges, removes the worktree, syncs `main`, stamps the issue. Red halts | A PR is ready to merge |

GitHub skills shell out to `gh`; have it installed and authenticated.

### Git utilities

| Skill | What it does | When to use |
|---|---|---|
| `/commit-all` | Commits all changes, one commit per file | Granular commits without hand-staging |

### Project tracking

| Skill | What it does | When to use |
|---|---|---|
| `/side-quest` | Files a `follow-up` tracking issue for out-of-scope work and stamps the originating issue | Something worth tracking but out of scope right now |
| `/stand-up` | Summarizes the past 28h of commits, PRs, and linked issues | Daily catch-up |

### Response mode

| Skill | What it does | When to use |
|---|---|---|
| `/tldr` | Caps **one** response at N sentences in plain language; identifiers and paths never paraphrased | `/tldr <n> [question]` for a straight short answer |

### Learning

| Skill | What it does | When to use |
|---|---|---|
| `/term-add` | Captures a term into `~/.claude/glossary.md`: normalizes it (typos fixed, glossary casing), drafts a two-sentence plain-English definition, an example, a near-miss, and a related term, and prints the entry back. Never asks you to define it | You hit a word you don't know |
| `/term-quiz` | Quizzes you with Leitner spaced repetition (boxes at 1/3/7/14/30/90 days): overdue terms first, question type escalating with the box, Claude grades on meaning, state written back per item. Misses get a multiple-choice scaffold after grading and a re-ask at the close | `/term-quiz [n]` (default 8). Intervals are minimum waits, so sporadic use is fine |

The glossary is one unversioned file outside every repo, yours to hand-edit. The `add term` action in `/brainstorm-walk`, `/blueprint-walk`, and `/review-walk` writes to it through `/term-add`.

## Agents

Subagents live in `agents/`, grouped by category. Skills reference them as `forge:<category>:<agent>`, so copy the referenced category along with any skill that dispatches agents.

| Category | Agents | Purpose |
|---|---|---|
| `research/` | best-practices-researcher, framework-docs-researcher, git-history-analyzer, issue-intelligence-analyst, learnings-researcher, repo-research-analyst | External docs, git archaeology, issue analysis, institutional learnings, repo conventions |
| `review/` | adversarial-reviewer, architecture-strategist, code-simplicity-reviewer, correctness-auditor, data-integrity-guardian, pattern-recognition-specialist, performance-oracle-{python,typescript}, python-reviewer, reliability-engineer, security-sentinel-{python,typescript}, test-coverage-reviewer, typescript-reviewer | Review specialists across correctness, security, performance, architecture, reliability, simplicity, tests, and language idioms |
| `workflow/` | lint, spec-flow-analyzer | Linting and spec/flow analysis |
| `test-plan/` | blast-radius-lens, spec-lens, surface-lens, test-synthesizer, test-writer | Three lenses propose test cases from different views of a change, a synthesizer filters and writes the plan, and a writer turns the `auto` cases into tests |

## Typical flows

**Feature development** (bracketed steps optional):
```
/brainstorm → [/brainstorm-walk] → /blueprint → [/blueprint-deepen] → [/blueprint-walk] → /work → /test-plan → /test-plan-run → /ship → /quick-review | /deep-review → [/review-sweep] → /review-walk → /review-push → /land
```

**Multi-feature initiative:**
```
/initiative → /blueprint <workstream> → /work → /test-plan → /test-plan-run → /initiative <path>   # repeat per workstream
```

**Worktree-isolated** (primary checkout stays on `main`):
```
/brainstorm → [/brainstorm-walk] → /blueprint → [/blueprint-deepen] → [/blueprint-walk] → /tree <issue> → [new session] → /work → /test-plan → /test-plan-run → /ship → /quick-review | /deep-review → [/review-sweep] → /review-walk → /review-push → /land
```

`/tree` replaces `/branch-from-issue` when you want the branch in its own directory; `/land` removes the worktree on merge.

## Structure

```
skills/          Slash commands (one SKILL.md per skill)
agents/          Subagents grouped by category (research/review/workflow/test)
hooks/           Hook scripts + hooks.json (auto-wired when the plugin loads; currently empty)
dashboard/       Live terminal dashboard for monitoring sessions (run as `ccdash`, not plugin-loaded)
.claude-plugin/  Plugin manifest (makes the symlinked clone load as forge@skills-dir)
docs/            Plans, brainstorms, reviews, tests, initiatives generated at runtime
```

## Credits

Scaffolded from [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) by [Every Inc](https://every.to) (Kieran Klaassen, T.M. Chow), MIT-licensed — the core workflow, the agent categories, and several skills derive from it.
