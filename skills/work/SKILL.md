---
name: work
description: Execute work plans unit-by-unit through orchestrated dispatch — the main session briefs one Opus subagent per implementation unit (strictly serial), reviews each diff, has the scope observer flag deviations from the plan, commits, stamps the issue, and records every unit in a work doc under docs/work/ carrying a rolling digest of prior units into every next brief; the orchestrator never writes code itself
argument-hint: "[plan file, specification, or todo file path]"
---

# Work Plan Execution Command

Execute a work plan efficiently while maintaining quality and finishing features.

## Introduction

This command takes a work document (plan, specification, or todo file) and executes it systematically. The focus is on **shipping complete features** by understanding requirements quickly, following existing patterns, and maintaining quality throughout.

## Input Document

<input_document> #$ARGUMENTS </input_document>

## Execution Workflow

### Phase 1: Quick Start

1. **Read Plan and Clarify**

   - Read the work document completely
   - Treat the plan as a decision artifact, not an execution script
   - If the plan includes sections such as `Implementation Units`, `Work Breakdown`, `Requirements Trace`, `Files`, or `Verification`, use those as the primary source material for execution
   - Check for `Execution note` on each implementation unit — it carries a per-unit execution signal such as `Execution target: external-delegate`. Note them when creating tasks.
   - Check for a `Deferred to Implementation` or `Implementation-Time Unknowns` section — these are questions the planner intentionally left for you to resolve during execution. Note them before starting so they inform your approach rather than surprising you mid-task
   - Check for a `Scope Boundaries` section — these are explicit non-goals. Refer back to them if implementation starts pulling you toward adjacent work
   - Review any references or links provided in the plan
   - If anything is unclear or ambiguous, ask clarifying questions now
   - Get user approval to proceed
   - **Do not skip this** - better to ask questions now than build the wrong thing

2. **Verify Feature Branch**

   ```bash
   current_branch=$(git branch --show-current)
   default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
   if [ -z "$default_branch" ]; then
     default_branch=$(git rev-parse --verify origin/main >/dev/null 2>&1 && echo "main" || echo "master")
   fi
   ```

   **If on the default branch**, STOP and tell the user:
   > You're on `[default_branch]`. Create a feature branch before running `/work`. Use `/branch-from-issue <number>` to branch from a GitHub issue, or `git checkout -b <branch-name>`.

   **If on a feature branch**, ask: "Continue working on `[current_branch]`?" and proceed to step 3.

3. **Create Todo List**
   - Use your available task tracking tool (e.g., TodoWrite, task lists) to break the plan into actionable tasks
   - Derive tasks from the plan's implementation units, dependencies, and files
   - Carry each unit's `Execution note` into the task when present
   - For each unit, read the `Patterns to follow` field before implementing — these point to specific files or conventions to mirror
   - Use each unit's `Goal` and `Files` as the "done" signal for that task; its `Verification` lines are checked once, by the observer's wrap-up pass (Phase 4)
   - Do not expect the plan to contain implementation code or exact shell commands
   - Include dependencies between tasks
   - Prioritize based on what needs to be done first
   - Include quality check tasks
   - Keep tasks specific and completable

4. **The Dispatch Contract**

   `/work` has one execution mode: **orchestrated dispatch**. The main session is the orchestrator; every implementation unit — including in a single-unit plan — is built by a dispatched subagent. There is no inline mode and no parallel mode.

   **The orchestrator** (this session) briefs workers, reviews their diffs, dispatches the scope observer, commits, stamps, updates plan checkboxes, maintains the digest, and is the sole writer of the work doc. It **never writes code** — no exceptions: a typo or drive-by fix spotted while reviewing a diff rides the next worker's brief as an addendum, or gets a micro-dispatch of its own when no units remain. One absolute rule is followable; "except trivial" invites drift.

   **The worker** — `Agent` with `model: "opus"` and `subagent_type: "general-purpose"` — implements exactly one unit in the shared working tree, runs the System-Wide Check (see Phase 2), and returns its report. It writes no tests — tests come later, from `/test-plan`. Workers never touch git and never post stamps.

   **The observer** — `Agent` with `subagent_type: "forge:workflow:scope-observer"` — audits each unit's diff against its plan fields and returns deviation cards. It flags and never blocks. Its dispatch contract, what it may and may not see, and its failure handling are [the work-protocol spec's](../work-protocol/SKILL.md#the-scope-observer).

   **Strictly serial:** one worker at a time. Dispatch is asynchronous, so serialization is the orchestrator's job: wait for the worker's completion notification, finish reviewing its diff, and wait for the observer to return before dispatching the next unit. Commit-per-unit in a shared tree makes concurrent workers a race; unit N+1's brief needs unit N's digest anyway.

   For genuinely large plans needing persistent inter-agent communication (agents challenging each other's approaches, shared coordination across 10+ tasks), see Swarm Mode below which uses Agent Teams.

5. **Create the Work Doc**

   Once the user has approved the start, create the run's work doc in `docs/work/` per [the work-protocol spec](../work-protocol/SKILL.md#the-document) — its filename, frontmatter (`base:` is `git rev-parse HEAD` now), four sections, and empty-section placeholders are all the spec's. Seed `## Decisions` from the `Deferred to Implementation` questions resolved in step 1. When the input is a spec or todo file with no plan units, the Deviations section takes the spec's no-plan state and no observer runs this run.

   **Resume:** when a doc already exists for this branch and plan, continue it per [the spec's resume rules](../work-protocol/SKILL.md#resume) instead of creating one — committed units lacking an observed marker are observed and recorded first, before any worker is dispatched.

### Phase 2: Execute

1. **The Dispatch Loop**

   For each unit in dependency order:

   ```
   while (units remain):
     - Mark the unit's task in-progress
     - Compose the worker brief (see below)
     - Dispatch the worker; block until it returns
     - Review the actual diff — a returned "done" is a hypothesis
     - Dispatch the observer in `unit` mode (see below)
     - Commit (orchestrator; see Incremental Commits)
     - Mark task completed; check the plan checkbox
     - Append to the digest (see below)
     - Update the work doc and write the unit's observed marker (see below)
     - Stamp the unit on the issue (see below)
   ```

   **The worker brief** must contain, and nothing may be left implicit:
   - The absolute plan file path, for full context.
   - The unit's verbatim fields: Goal, Requirements, Files, Approach, Execution note, Patterns to follow, Verification.
   - The instruction to ignore any `Test scenarios` field left by an older plan; this run writes no tests.
   - Any resolved `Deferred to Implementation` questions bearing on this unit, plus the plan's `Scope Boundaries` as explicit non-goals.
   - The instruction to follow the repo's `CLAUDE.md` conventions and honor the unit's `Execution note` when it carries `Execution target: external-delegate`.
   - The instruction never to edit the plan file; the orchestrator owns it.
   - The instruction to run the System-Wide Check (below) before returning.
   - **The digest** — the orchestrator's accumulated notes from every prior unit, verbatim.
   - **Addenda**, when any — drive-by fixes the orchestrator spotted in earlier diffs. The same list goes to this unit's observer.
   - **The return contract:** what changed per file, with a one-line summary each; any deviation from the unit's Approach with its reason; discoveries bearing on later units; **stale tests** — existing tests the change may have made stale, each as its path (optionally `::<test name>`) plus one sentence on why, found by grepping the test directories for the symbols and modules the unit changed, renamed, or removed and then judging each hit, erring broad; or — if the unit cannot be completed — a blocked report saying exactly what gates it.

   **The orchestrator's review** is conformance-level: the diff does what the unit's Goal says, stays inside the unit's Files and the plan's Scope Boundaries, and matches repo conventions. `Verification` is not checked here — the observer's wrap-up pass owns it. Deviations the worker justified are accepted or sent back with a follow-up dispatch; unjustified drift is a re-dispatch with a corrected brief. Never fix it by hand.

   **The observer dispatch** — after the review, before the commit. Dispatch `forge:workflow:scope-observer` in `unit` mode with the inputs [the spec names](../work-protocol/SKILL.md#unit-mode): the absolute plan path, the unit ordinal, the uncommitted working tree, and this unit's addenda list. The observer brief carries nothing from the worker's return — not its summary, its deviations, or its reasons. A failed dispatch is handled per [the spec](../work-protocol/SKILL.md#failure): the unit commits anyway.

   **The work doc update** — after the commit and the digest, one update per [the spec's lifecycle](../work-protocol/SKILL.md#lifecycle):
   - Rewrite `## Changes` from git and the accumulated per-file summary lines.
   - Merge the worker's stale tests into `## Tests to Revisit`.
   - Rewrite `## Decisions` from the digest.
   - Turn the observer's return into cards: assign each its number and fill its `Reason:` per [the spec's `Reason:` rule](../work-protocol/SKILL.md#reason), and card every deviation the worker reported that the observer missed and that is still in the committed diff.
   - Write the unit's [observed marker](../work-protocol/SKILL.md#the-observed-marker).

   **The digest** — after each review, record 1–3 bullets: decisions made, patterns established, gotchas hit. Cap ~4 lines per unit; when the run grows long, consolidate rather than append. The digest states *constraints on future work* ("auth helpers live in lib/auth, not per-route", "the fixtures assume UTC"), not a change log.

   **Blocked units:** the worker reports; the orchestrator posts the `unit-blocked` stamp (below) and decides — continue with later units that don't depend on it, or stop and surface it.

   **System-Wide Check** — run by the **worker** before it returns (the brief points here). Pause and ask:

   | Question | What to do |
   |----------|------------|
   | **What fires when this runs?** Callbacks, middleware, observers, event handlers — trace two levels out from your change. | Read the actual code (not docs) for callbacks on models you touch, middleware in the request chain, `after_*` hooks. |
   | **Does the real chain hold together?** Reason through the full callback/middleware chain with real objects, not the layers you would have mocked — the interaction is where the breakage lives. | Read the chain end to end and report any layer whose behavior your change depends on but does not control. |
   | **Can failure leave orphaned state?** If your code persists state (DB row, cache, file) before calling an external service, what happens when the service fails? Does retry create duplicates? | Trace the failure path. If state is created before the risky call, confirm failure cleans up or retry is idempotent, and report what you found. |
   | **What other interfaces expose this?** Mixins, DSLs, alternative entry points (Agent vs Chat vs ChatMethods). | Grep for the method/behavior in related classes. If parity is needed, add it now — not as a follow-up. |
   | **Do error strategies align across layers?** Retry middleware + application fallback + framework error handling — do they conflict or create double execution? | List the specific error classes at each layer. Verify your rescue list matches what the lower layer actually raises. |

   **When to skip:** Leaf-node changes with no callbacks, no state persistence, no parallel interfaces. If the change is purely additive (new helper method, new view partial), the check takes 10 seconds and the answer is "nothing fires, skip."

   **When this matters most:** Any change that touches models with callbacks, error handling with fallback/retry, or functionality exposed through multiple interfaces.

   **Issue-Log Stamps** — When a completed task finishes a plan implementation unit, post a `unit-complete` stamp to the tracked issue. Resolve the issue number and post per [the issue-log spec](../issue-log/SKILL.md) (in a worktree the branch-name segment is the common case; when nothing resolves, the spec's skip applies). A skipped or failed stamp never blocks marking the unit complete or continuing the loop.

   Stamps are per plan unit, not per task or per commit: tasks split and merge relative to units, and small related units may land in one commit — post one stamp for each plan unit that reached completion. Compose the `unit` key by re-reading that unit's checkbox heading from the plan file at stamp time (ordinal + title) — never the in-session task title. `paths` carries the plan file path. Keep the body terse: the commit carries the diff; the stamp carries the recall value. Include **Solved:** only when a real problem was solved during the unit; omit the line otherwise.

   Compose the body below, write it to a temp file with the Write tool, and post:

   ```markdown
   <!-- cc-forge-log v1: {"skill":"work","event":"unit-complete","unit":"<ordinal>: <title from plan checkbox heading>","paths":["<plan file path>"]} -->

   ### 🔨 /work — unit <ordinal>: <title>

   **Did:** <one-liner: what the unit delivered>
   **Solved:** <one-liner: the problem solved — omit this line when none>
   ```
   ```bash
   gh issue comment <n> --repo <owner>/<repo> --body-file <temp-file>
   ```

   When a unit stalls and work moves on or stops, post a `unit-blocked` stamp instead — a blocked unit never receives `unit-complete`. Include `blocked_by` in the marker only when concrete refs gate the unit; drop the key otherwise:

   ```markdown
   <!-- cc-forge-log v1: {"skill":"work","event":"unit-blocked","unit":"<ordinal>: <title from plan checkbox heading>","paths":["<plan file path>"],"blocked_by":["<owner>/<repo>#<n>"]} -->

   ### ⚠️ /work — unit <ordinal> blocked: <title>

   **Blocked:** <one-liner: what gates the unit and why work moved on>
   ```
   ```bash
   gh issue comment <n> --repo <owner>/<repo> --body-file <temp-file>
   ```

2. **Incremental Commits**

   After completing each task, evaluate whether to create an incremental commit:

   | Commit when... | Don't commit when... |
   |----------------|---------------------|
   | Logical unit complete (model, service, component) | Small part of a larger unit |
   | Meaningful progress, tree builds | Tree left broken mid-change |
   | About to switch contexts (backend → frontend) | Purely scaffolding with no behavior |
   | About to attempt risky/uncertain changes | Would need a "WIP" commit message |

   **Heuristic:** "Can I write a commit message that describes a complete, valuable change? If yes, commit. If the message would be 'WIP' or 'partial X', wait."

   If the plan has Implementation Units, use them as a starting guide for commit boundaries — but adapt based on what you find during implementation. A unit might need multiple commits if it's larger than expected, or small related units might land together. Use each unit's Goal to inform the commit message.

   **Commit workflow:**
   ```bash
   # 1. Stage only files related to this logical unit (not `git add .`)
   git add <files related to this logical unit>

   # 2. Commit with conventional message using HEREDOC
   git commit -m "$(cat <<'EOF'
   <type>(scope): description of this unit

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```

   Where `<type>` is one of: `feat`, `hotfix`, `bugfix`, `docs` — choose based on the nature of the change. Check `git log --oneline -5` to match the repo's existing commit style.

   **Handling merge conflicts:** If conflicts arise during rebasing or merging, resolve them immediately. Incremental commits make conflict resolution easier since each commit is small and focused.

3. **Follow Existing Patterns**

   - The plan should reference similar code - read those files first
   - Match naming conventions exactly
   - Reuse existing components where possible
   - Follow project coding standards (see CLAUDE.md)
   - When in doubt, grep for similar implementations

4. **Write No Tests, Run No Tests**

   - `/work` writes zero tests and runs no suite. Tests are written afterward by `/test-plan` and `/test-plan-run`, and the suite runs once in CI off `/ship`'s push.
   - Each unit leaves the working tree buildable and lint-clean. That is the bar the worker owns.
   - A change that breaks an existing test is caught in CI after ship, not here.

5. **Track Progress**
   - Keep the task list updated as you complete tasks
   - Note any blockers or unexpected discoveries
   - Create new tasks if scope expands
   - Keep user informed of major milestones

### Phase 3: Quality Check

1. **Run Core Quality Checks**

   Always run before submitting:

   ```bash
   # Run linting (per CLAUDE.md)
   # Use linting-agent before pushing to origin
   ```

   Do not run the test suite here. It runs once, in CI, off `/ship`'s push.

2. **Consider Reviewer Agents** (Optional)

   Use for complex, risky, or large changes. Read agents from `cc-forge.local.md` frontmatter (`review_agents`). If no settings file exists, skip — `/deep-review` will use its default agent set.

   Run configured agents in parallel with Task tool. Present findings and address critical issues.

3. **Final Validation**
   - All tasks marked completed
   - Linting passes
   - Code follows existing patterns
   - No console errors or warnings
   - If the plan has a `Requirements Trace`, verify each requirement is satisfied by the completed work
   - If any `Deferred to Implementation` questions were noted, confirm they were resolved during execution

### Phase 4: Wrap Up

1. **Wrap-Up Observer Pass**

   Dispatch `forge:workflow:scope-observer` once in [`wrap-up` mode](../work-protocol/SKILL.md#wrap-up-mode) with the absolute plan path and the ordinals of every unit this run committed — never a blocked one. This is the run's only check of the plan's `Verification` lines. Record its cards, numbered per the spec, and the wrap-up marker; a failed dispatch is recorded per [the spec](../work-protocol/SKILL.md#failure) and never blocks. When the Deviations section carries the no-plan state, skip the dispatch. Either way, then set the work doc's `status: complete`.

2. **Update Plan Status**

   If the input document has YAML frontmatter with a `status` field, update it to `completed`:
   ```
   status: active  →  status: completed
   ```

3. **Suggest Next Steps**
   - Run [`/test-plan`](../test-plan/SKILL.md) to generate the test plan for this change
   - Run [`/test-plan-run`](../test-plan-run/SKILL.md) to write and verify its tests
   - Run `/ship` to commit, push, and open a PR — the suite runs in CI off that push
   - Review after ship: `/quick-review`, or `/deep-review` if the change is large or risky

4. **Display Work Summary**

   The run's output ends here. Print the work doc's `## Changes` table and its total line — the terminal copy may truncate a long table; the doc never does. Every **File** cell is the full absolute filesystem path shown verbatim in backticks, never a repo-relative path and never a markdown link whose visible text is relative: the terminal renders only a link's visible text, so a relative path there is neither clickable nor resolvable in the user's editor. The columns and their sources are [the spec's](../work-protocol/SKILL.md#changes).

   Close with [the spec's `/work` one-liner](../work-protocol/SKILL.md#terminal-one-liners) as the final line.

5. **Act on Replies**

   The user acts on a card by replying with a verb and its card ID. Which verbs a card takes, what each does, the pre-dispatch warning, and the revert brief's hunk rule are all [the spec's reply verbs](../work-protocol/SKILL.md#reply-verbs). What `/work` adds is the mechanics: a `fix` or `revert` dispatches an Opus worker like any unit, then review → commit → work-doc update, with no observer pass; the card's `Status:` moves once that commit lands. It gets no issue stamp.

---

## Swarm Mode with Agent Teams (Optional)

For genuinely large plans where agents need to communicate with each other, challenge approaches, or coordinate across 10+ tasks with persistent specialized roles, use agent team capabilities if available (e.g., Agent Teams in Claude Code, multi-agent workflows in Codex).

**Agent teams are typically experimental and require opt-in.** Do not attempt to use agent teams unless the user explicitly requests swarm mode or agent teams, and the platform supports it.

### When to Use Agent Teams vs Subagents

| Agent Teams | Subagents (standard mode) |
|-------------|---------------------------|
| Agents need to discuss and challenge each other's approaches | Each task is independent — only the result matters |
| Persistent specialized roles (e.g., dedicated tester running continuously) | Workers report back and finish |
| 10+ tasks with complex cross-cutting coordination | 3-8 tasks with clear dependency chains |
| User explicitly requests "swarm mode" or "agent teams" | Default for most plans |

Most plans should use subagent dispatch from standard mode. Agent teams consume 4-15x more tokens than single-agent execution due to coordination overhead and parallel context windows. Only use them when the inter-agent communication genuinely improves the outcome — weigh the token cost against the complexity of the plan before opting in.

### Agent Teams Workflow

1. **Create team** — use your available team creation mechanism
2. **Create task list** — parse Implementation Units into tasks with dependency relationships
3. **Spawn teammates** — assign specialized roles (implementer, tester, reviewer) based on the plan's needs. Give each teammate the plan file path and their specific task assignments
4. **Coordinate** — the lead monitors task completion, reassigns work if someone gets stuck, and spawns additional workers as phases unblock
5. **Cleanup** — shut down all teammates, then clean up the team resources

---

## Key Principles

### Start Fast, Execute Faster

- Get clarification once at the start, then execute
- Don't wait for perfect understanding - ask questions and move
- The goal is to **finish the feature**, not create perfect process

### The Plan is Your Guide

- Work documents should reference similar code and patterns
- Load those references and follow them
- Don't reinvent - match what exists

### Tests Come After the Code

- `/work` writes no tests and runs no suite
- `/test-plan` and `/test-plan-run` write them once the units have landed
- The suite runs once, in CI, off `/ship`'s push

### Quality is Built In

- Follow existing patterns
- Leave the tree buildable and lint-clean
- Run linting before pushing
- Use reviewer agents for complex/risky changes only

### Ship Complete Features

- Mark all tasks completed before moving on
- Don't leave features 80% done
- A finished feature that ships beats a perfect feature that doesn't

## Quality Checklist

Before creating PR, verify:

- [ ] All clarifying questions asked and answered
- [ ] All tasks marked completed
- [ ] Linting passes (use linting-agent)
- [ ] Code follows existing patterns
- [ ] Commit messages follow conventional format
- [ ] Run `/test-plan`, then `/test-plan-run`, then `/ship` to push branch and create PR

## When to Use Reviewer Agents

**Don't use by default.** Use reviewer agents only when:

- Large refactor affecting many files (10+)
- Security-sensitive changes (authentication, permissions, data access)
- Performance-critical code paths
- Complex algorithms or business logic
- User explicitly requests thorough review

For most features: linting + following patterns is sufficient.

## Common Pitfalls to Avoid

- **Analysis paralysis** - Don't overthink, read the plan and execute
- **Skipping clarifying questions** - Ask now, not after building wrong thing
- **Ignoring plan references** - The plan has links for a reason
- **Writing tests here** - That is `/test-plan`'s job, after the units land
- **Forgetting to track progress** - Update task status as you go or lose track of what's done
- **80% done syndrome** - Finish the feature, don't move on early
- **Over-reviewing simple changes** - Save reviewer agents for complex work
