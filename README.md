# cc-forge

A personal reference collection of Claude Code skills, agents, and hooks for structured development workflows, code review, and research automation.

This repo is a **personal showcase**, not a package for others to install. Browse the skills and agents below, copy the ideas (or individual folders) you want into your own `~/.claude/`, and adapt them. The whole thing is built around a `brainstorm → blueprint → work → review → compound` loop with GitHub integration on top. Fair warning: the workflows are tuned to one person's setup and won't translate wholesale.

## How it's wired (skills-directory plugin)

The clone is symlinked into Claude Code's skills directory, where any folder containing `.claude-plugin/plugin.json` loads as a plugin **in place** — no marketplace, no install step, no cache copy:

```bash
ln -s /path/to/your/clone/cc-forge ~/.claude/skills/cc-forge
```

The next `claude` session loads it as `forge@skills-dir`: all skills (namespaced `/forge:<name>`), all agents, and the caveman hook (wired automatically via `hooks/hooks.json`). Verify with `claude plugin list`.

Because the plugin is read from the clone itself, **editing a file or pulling a commit is the deploy** — the next session just has it. Mid-session, `SKILL.md` edits take effect immediately; changes to agents, hooks, or manifests need `/reload-plugins` (or a new session).

> **Migrating from the old marketplace install?** Earlier versions of this repo were installed via `/plugin marketplace add` + `/plugin install`, which copies the plugin into `~/.claude/plugins/cache/` — a snapshot that goes stale the moment the clone changes, and that `/plugin update` won't refresh for a directory-source plugin (it compares the manifest `version` string, which never bumps). If that's your setup, remove it and symlink instead:
>
> ```bash
> claude plugin uninstall cc-forge@cc-forge-local
> claude plugin marketplace remove cc-forge-local
> rm -rf ~/.claude/plugins/cache/cc-forge-local/
> ln -s /path/to/your/clone/cc-forge ~/.claude/skills/cc-forge
> ```

### Cherry-pick individual pieces

Skills and agents are plain Markdown. To grab just one into your own setup, copy its folder:

```bash
cp -r skills/blueprint ~/.claude/skills/        # one skill
cp -r agents/research ~/.claude/agents/    # one agent category
```

Restart Claude Code after copying. Skills copied this way are un-namespaced (`/blueprint`, not `/forge:blueprint`); agents are dispatchable via the Task tool — but note skills that reference agents use the `forge:<category>:<name>` qualified form, which only resolves when the whole repo loads as a plugin.

> Copying the `/caveman` skill this way gets the prompt but **not** its persistence hook — that needs one manual step ([Caveman hook setup](#caveman-hook-setup)). The symlink setup above wires it for you; this manual step is only for the cherry-pick route.

## Skills

**Issue-log convention:** the workflow skills (brainstorm, plan, work, deep-review, review-walk, ship, land, tree, branch-from-issue, side-quest) each post a standardized "stamp" comment to the linked GitHub issue at their key event — a hidden machine-readable marker plus a short human-readable body — so an issue's thread becomes a reconstructable work log. The spec lives at [`skills/issue-log/SKILL.md`](skills/issue-log/SKILL.md) (a reference doc, not a command).

### Core workflow

| Skill | What it does | When to use |
|---|---|---|
| `/brainstorm` | Explores requirements and approaches through dialogue, then writes a right-sized requirements doc | A vague or ambitious feature idea; you want to think through options before committing to scope |
| `/blueprint` | Turns a feature description or requirements doc into a structured implementation plan grounded in repo patterns | Requirements are roughly defined and you need a technical approach broken into units |
| `/deepen-blueprint` | Stress-tests an existing plan and selectively strengthens weak sections with targeted research | A Standard/Deep or high-risk plan needs more confidence around decisions, sequencing, or risk |
| `/walk-blueprint` | **Optional.** Walks a `/blueprint` plan interactively, one implementation unit at a time: each unit's fields verbatim, a plain-English teach moment, then accept / modify / remove / add term / skip. `modify` rewrites the unit in place and `remove` tombstones it as `retired` without renumbering — both after a before/after confirm; `skip` is reported as *unreviewed*, never accepted. `add term` hands the term to `/term-add` in quiet mode — one line back, no advance, so looking something up never costs your place. Writes `**Reviewed:**` inline in the plan so it's resumable | You want to actually understand a plan — or correct it — before any code is written. Skipping it changes nothing about how the plan runs |
| `/work` | Executes a work plan unit-by-unit via orchestrated dispatch: one Opus subagent per unit (strictly serial), with the orchestrator reviewing each diff, committing, stamping the issue, and carrying a rolling digest of prior units into every next brief | You have a plan and want it implemented |
| `/grind` | Executes a whole plan **autonomously as a sequence of PRs**. Slices the plan into PR-sized groups, confirms that breakdown once, then per slice runs unattended: worktree → Opus subagent builds and opens the PR → Fable subagent reviews and posts comments → `/grind` triages the feedback itself → Opus subagent applies accepted fixes → final look → squash-merge on green CI. Serial (slice N merges before N+1 branches), resumable via a `## PR Breakdown` table in the plan doc, and halts the whole run on a blocked slice | You have a plan you trust and want it ground all the way to merged `main` without babysitting each PR. Needs a repo without required-reviews branch protection |
| `/deep-review` | Exhaustive multi-agent code review using worktrees; writes a structured review doc | Complex, risky, or large changes that warrant deep review |
| `/review-walk` | Walks a `/deep-review` document interactively, group-by-group, with implement/defer/skip per issue; updates `Status:` inline so it's resumable; at walk end, offers tracking issues for deferred items (shared issue template) and stamps the outcome | You have a `docs/reviews/*.md` and want to act on it methodically |
| `/compound` | Documents a recently solved problem so the knowledge compounds | Right after solving something non-obvious worth recording |
| `/ideate` | Generates and critically evaluates grounded improvement ideas for the project | "What should I improve?" — you want AI-generated directions before brainstorming one |
| `/deprecate` | Plan-only safe removal of a named concept: parallel research agents find every reference, output a leaves-first plan with compat-risk flags | "Rip out X" / "retire X" — hand the resulting plan to `/work` |

**Dependencies:** these skills are self-contained Markdown. Some dispatch the agents in `agents/` (see [Agents](#agents)) — copy those too if you want the full behavior.

### Strategic

| Skill | What it does | When to use |
|---|---|---|
| `/initiative` | Authors, maintains, and optionally publishes a high-altitude living initiative doc at `docs/initiatives/` — one altitude up from `/blueprint` (workstreams, not commit-sized units). Two modes: no path **authors** a new initiative; passing an existing path **resumes** it by gathering evidence since `last_updated`. Optionally publishes to GitHub as a parent issue with linked sub-tasks | Multi-feature efforts that span many plans and need a durable record that survives compaction |

Typical flow: `/initiative` → `/blueprint` per workstream → `/work` → `/initiative <path>` to log progress.

### GitHub integration

| Skill | What it does | When to use |
|---|---|---|
| `/branch-from-issue` | Creates and checks out a git branch from an issue number or conversation context, in the **current** directory | Starting work tied to an issue, no isolation needed |
| `/tree` | Creates a git worktree — a second working directory on its own new branch, sibling to the primary checkout at `../<repo>-worktrees/<branch-name>/` — instead of checking the branch out in place. Symlinks `docs/` in so brainstorm/blueprint docs stay visible | Starting work you want isolated in its own directory (e.g. so the primary checkout can stay on `main`, or to run several branches concurrently in separate sessions) |
| `/issue-from-context` (alias `/ifc`) | Generates a GitHub issue from conversation context and adds it to a project. `--prefix <str>` prepends a verbatim title prefix; `--who <names>` assigns teammates by first name through a hardcoded name → login map | Something worth tracking surfaced mid-conversation |
| `/read-issue` | Fetches a GitHub issue by number and presents a structured digest | You want an issue's content summarized in-session |
| `/triage-issue` | Fetches an issue and investigates the codebase to determine if it's still present, fixed, or needs more digging; writes to `docs/triage/` | Verifying whether a reported issue still reproduces |
| `/ship` | Commits all changes per-file, pushes the branch, and creates a PR | Work is done and you want it shipped |
| `/land` | Takes an open PR to merged with zero prompts: waits on its existing CI checks (local suite gates only when the PR reports no checks), squash-merges + deletes the branch, removes the `/tree` worktree when a clean one holds it, syncs `main`, and stamps the linked issue. Never pushes a commit; red halts with the failing output — no fix commits | When a PR is ready to merge — closes the loop in one command |

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
| `/tldr` | Caps **one** response at N sentences and states it in plain language — short common words, active voice, no jargon the answer doesn't need, though identifiers, error strings, and file paths are never paraphrased. Code blocks and paths don't count against N. No hook, no persistence | `/tldr <n> [question]` when you want a straight short answer. One-shot — the next response only |

**Dependency:** persistence requires a hook — see [Caveman hook setup](#caveman-hook-setup). Without it the skill still works, but the mode may drift back to normal prose over a long session; just re-run `/caveman <level>` if it does.

### Learning

| Skill | What it does | When to use |
|---|---|---|
| `/term-add` | Captures a term into a personal glossary at `~/.claude/glossary.md`: drafts a plain-English definition (two sentences at most), a one-sentence example, a near-miss (`Not`), and a related term, writes the entry, and prints it back. Never asks you to define the term — hand-editing the file is the correction path | You hit a word you don't know and want it saved without derailing what you were doing |
| `/term-quiz` | Quizzes you on glossary terms with Leitner spaced repetition (boxes at 1/3/7/14/30/90 days). Overdue terms first, question type escalating with the box — cued recall, generation, discrimination, contrast, teach-a-junior — Claude grades on meaning, and the new box and due date are written back per item before the feedback. Misses get a multiple-choice scaffold *after* grading and are re-asked once at the close | `/term-quiz [n]` (default 8) whenever you want to actually retain what you captured. Intervals are minimum waits, so sporadic use is fine |

The glossary is one file, outside every repo, unversioned, and yours to hand-edit. Its format — entry shape, dedupe, backup, write protocol, dates, and the Leitner ladder — lives in [`skills/glossary/SKILL.md`](skills/glossary/SKILL.md), a reference doc rather than a command, cited by `/term-add`, `/term-quiz`, and `/walk-blueprint`. These skills are repo-independent and post no issue stamps.

## Agents

Specialized subagents live in `agents/`, grouped by category. Copy a category folder (`cp -r agents/<category> ~/.claude/agents/`) to make them dispatchable.

| Category | Agents | Purpose |
|---|---|---|
| `research/` | best-practices-researcher, framework-docs-researcher, git-history-analyzer, issue-intelligence-analyst, learnings-researcher, repo-research-analyst | Code research, external docs, git archaeology, issue analysis, institutional learnings, repo conventions |
| `review/` | adversarial-reviewer, architecture-strategist, code-simplicity-reviewer, correctness-auditor, data-integrity-guardian, pattern-recognition-specialist, performance-oracle-{python,typescript}, python-reviewer, reliability-engineer, security-sentinel-{python,typescript}, test-coverage-reviewer, typescript-reviewer | Code-review specialists across correctness, security, performance, architecture, reliability, data integrity, simplicity, patterns, tests, and language idioms |
| `workflow/` | lint, spec-flow-analyzer | Linting and spec/flow analysis |
| `test/` | test-plan-critic | Annotates a test plan with viability scores and a drop list |

Skills reference agents by fully-qualified name (`forge:<category>:<agent>`), so if you copy a skill that dispatches agents, copy the referenced agent category too.

## Caveman hook setup

> **Skip this if the repo is symlinked into `~/.claude/skills/`** — the hook is already wired by `hooks/hooks.json`. This section is only for the cherry-pick route, where you copied the `/caveman` skill folder by hand.

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
/brainstorm → /blueprint → [/walk-blueprint] → /work → /review → /review-walk → /ship
```
Bracketed steps are optional. `/walk-blueprint` is a guided read-through of the plan before implementation starts — useful for understanding or correcting a plan you didn't write yourself; leave it out and the rest of the flow is identical.

**Multi-feature initiative:**
```
/initiative                        # draft initiative doc
  → /blueprint <workstream>             # plan one workstream
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
/brainstorm → /blueprint → [/walk-blueprint] → /tree <issue-number>
  → cd into the printed worktree path, start a new Claude Code session there
  → /work → /deep-review → /ship → /land   # /land removes the worktree on merge
```
`/tree` is a drop-in alternative to `/branch-from-issue` for when you want the branch developed in its own directory rather than checked out in place — useful once you're running several branches at once, since each worktree is a fully separate working directory with no stashing required to switch between them.

## Structure

```
skills/          Slash commands (one SKILL.md per skill)
agents/          Subagents grouped by category (research/review/workflow/test)
hooks/           Hook scripts (currently just the caveman mode tracker)
.claude-plugin/  Plugin manifest (makes the symlinked clone load as forge@skills-dir)
docs/            Plans, brainstorms, reviews, initiatives generated at runtime
```

## Credits

cc-forge was originally scaffolded from [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) by [Every Inc](https://every.to) (Kieran Klaassen, T.M. Chow), MIT-licensed. The core `brainstorm → plan → work → review → compound` workflow, the research/review/workflow agent categories, and several skills derive from that project; cc-forge adapts and extends them for personal use. Credit and thanks to the compound-engineering authors for the foundation.

The `/caveman` skill prompt is adapted from [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) under the MIT license. The persistence hook (`hooks/cc-forge-caveman-mode-tracker.cjs`) is an original cc-forge implementation that lifts the symlink-safe flag-file primitives from upstream. The flag file path (`~/.claude/.caveman-active`) is shared between cc-forge and upstream caveman, so installing both will coexist on the same state, with cc-forge using a strict `{lite, full, ultra}` whitelist.
