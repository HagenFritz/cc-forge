---
name: grind
description: "Execute one phase of an implementation plan autonomously on one branch and end at one ready PR for review, mirroring the manual skill chain unattended: after one confirmation of the build slices, an Opus subagent builds each slice unit-by-unit (committing, pushing, and stamping the issue per unit) while grind records one run-level work doc and runs the scope observer; after the last slice the deep-review agent fleet reviews the whole branch with tests ignored, grind triages the findings itself and dispatches a second Opus subagent for accepted fixes, writes one test plan over the final branch through the test-protocol lenses, and opens the ship-conformant PR — writing and running no tests, never watching CI, never merging. A plan with Phased Delivery phases builds one phase per run. A default-on lifetime timer stops the run cleanly before the VM's ~2-hour wall (--no-timer to disable), and every terminal outcome — complete, stopped, or blocked — always fires a push notification and emails when SendGrid is configured, the email always carrying the resume command. Use when the user says 'grind this plan', 'grind it out', 'run the whole plan', or invokes /grind."
argument-hint: "[plan file path] [--no-timer]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Agent, AskUserQuestion, PushNotification, TaskCreate, TaskUpdate, TaskList
---

# Grind — Autonomously Build a Plan Phase into One PR

**Note: The current year is 2026.**

`/grind` takes a plan document and builds one phase of it — the whole plan, when it has no `## Phased Delivery` — on one branch in one worktree, without stopping for approval, and ends at one ready PR. It slices the phase's units into build checkpoints. For each slice it dispatches an **Opus** subagent that implements the slice unit-by-unit — committing, **pushing**, and stamping the issue after every unit, and writing no tests — then records the slice in the run's work doc with the scope observer. After the last slice it runs the **`/deep-review` agent fleet** once over the whole branch, **triages the findings itself**, dispatches a second Opus subagent for the accepted fixes, writes **one test plan** over the final branch, opens the PR, and stops. It never watches CI and never merges: you review the PR and its three docs — work, review, test plan — in a new session in the worktree, and land it yourself.

Two run-level guards wrap the run. A **lifetime timer** (default on) stops the run cleanly at a phase boundary before the VM's ~2-hour wall instead of letting the process be killed mid-write — the stop is a healthy, resumable state, not a failure. And every terminal outcome — **complete**, **stopped** (timer), or **blocked** (needs a human) — posts a final issue stamp and notifies on **two independent channels** — a push that always fires, plus an email when SendGrid is configured, always carrying the `claude --resume` command — so an unattended run never ends silently.

The plan document is the durable state. `/grind` writes a `## Grind` section into it, one `### Phase <n> of <m>` subsection per run, and updates it as the run advances; per-unit pushes, the work, review, and test docs, and the issue stamps mean every checkpoint also exists on GitHub or on disk. An interrupted run — stopped, blocked, or hard-killed — is resumed by re-invoking `/grind` on the same plan. Once a phase's PR is merged, re-invoking it builds the next phase.

`/grind` is the autonomous sibling of `/work` → `/deep-review` → `/test-plan` → `/ship`. It does **not** call those skills (confirm-gated by design, they would deadlock an unattended run) or `/land` (merging is yours). It mirrors their processes instead — `/work`'s per-unit stamps, commit cadence, and work doc, `/deep-review`'s roster and synthesizer, `/test-plan`'s lenses and synthesizer, `/ship`'s PR shape — so the issue thread of a grind run reads like a manual run's.

## Autonomy Contract

`/grind` runs unattended from the moment it starts building. Before it does, it gets **one** confirmation: the phase and its slices. After that it does not ask, and it will commit, push, and open a PR on its own judgment.

What that means, stated plainly:

- **`/grind` never merges and never watches CI.** It ends at an open, ready PR. Nothing reaches the default branch until you merge it.
- **The stop conditions are the safety net.** Because there is no human gate, the halt rules are load-bearing. When `/grind` cannot make progress, it **stops the run** and leaves the branch and worktree in place — it never skips a blocked slice, since later slices build on earlier ones.
- **The clock is part of the contract.** With the timer on, `/grind` will decline to start a phase it cannot finish before the stop threshold, and will end the run cleanly instead. `--no-timer` removes that guard for unbounded local runs.
- **`/grind` never force-pushes, never pushes to `main`, never uses `--no-verify`, and never uses `git add -A`.** These do not become acceptable because the run is autonomous — for `/grind` or any subagent it dispatches.
- **Interrupting is always safe.** State lives in the plan's `## Grind` section, the work, review, and test docs, and on GitHub. Ctrl-C or a hard kill at any point leaves a world [Resume](#resume) can re-enter.

The user has to opt into this. A slash command or a plain-English ask ("grind this plan", "just run the whole thing") both count as opting in; a plan that merely looks ready does not. Never start `/grind` on your own initiative or from inside another skill.

## Input

<input_document> #$ARGUMENTS </input_document>

Split the argument into flags and the plan path: `--no-timer` anywhere in the argument disables the lifetime timer for this run; whatever remains is the plan path.

**If no plan path remains**, glob `docs/plans/*.md`, filter to `status: active` in the frontmatter, and present the most recent 4 by date via `AskUserQuestion` for the user to pick. If none exist, stop with: "No active plan found. Write one with `/blueprint` first, then re-run `/grind <plan-path>`."

## Workflow

### Preflight

Run these checks before touching anything. Any failure stops the run.

1. **`gh` is available and authenticated** — `gh auth status`. If not: "GitHub CLI (`gh`) must be installed and authenticated for /grind. It pushes a branch and opens a PR unattended and cannot proceed without it."
2. **This is the primary checkout** — `git rev-parse --git-common-dir` must resolve to `<toplevel>/.git`. If not: "You're inside a worktree. Run /grind from the primary checkout — it creates the run's worktree." (Same rule as `/tree`.)
3. **On the default branch with a clean tree** — `git branch --show-current` is `main`/`master` and `git status --porcelain` is empty. If dirty: "Working tree is dirty. Commit or stash before grinding — /grind creates its branch off a clean main." If on a feature branch: "You're on `<branch>`. /grind runs from the default branch; the run gets its own worktree."
4. **Read the plan completely.** Note its `## Phased Delivery`, `## Grind`, `Implementation Units`, `Requirements Trace`, `Scope Boundaries`, `Deferred to Implementation`, and any `Execution note` fields. These are the source material for phase selection, the slices, and every subagent brief.
5. **Resolve the linked issue** per [the issue-log spec](../issue-log/SKILL.md#issue-number-resolution). Remember it as `<issue>`; it may be empty. Every stamp below skips silently when it is.
6. **Detect the email transport** and announce the result. `SENDGRID_API_KEY` set in the environment → email is **on**; unset → warn now, up front: "No SENDGRID_API_KEY — terminal outcomes will be stamped and pushed, but not emailed." Either way `PushNotification` still fires, so a terminal outcome is never silent. The detection is a preflight signal; the send itself re-checks (see Notification).
7. **Record run metadata.** Capture the current time — it goes in the grind-started stamp's `**Started:**` line, and (unless `--no-timer`) is written to the scratchpad as the timer anchor: `date +%s > <scratchpad>/grind-start` (see The Lifetime Timer). Also capture this session's id from the session context (Claude Code exposes it as the `claude.ai/code/session_…` URL in the commit-trailer guidance); the stamp's resume command is `claude --resume <session-id>`, and the same id goes in every email's resume block — capture it now, because it cannot be recovered later in the run. The stamped time is log, not clock: gates read the anchor file and nothing else, and a resumed run writes a fresh anchor.

### The Lifetime Timer

The VM's process lease is ~2 hours; the disk survives, the process does not. The timer's job is to ensure no phase is ever killed mid-write. The run works the **full 90 minutes** — no gate fires before then — and past 90m a phase may start only if its budget fits before the 1h55m mark, so whatever is in flight when the threshold passes still finishes inside the wall.

**Elapsed time is measured, never estimated.** Every reading is a real clock call. Do not infer elapsed time from how much work has happened, how many phases have run, or how long something felt — those judgments are unreliable and are not an input to any gate.

- **Anchor.** In Preflight's run-metadata step, write the start epoch to the scratchpad: `date +%s > <scratchpad>/grind-start` (the path is this session's scratchpad directory). This anchor is per-invocation — a resume writes a fresh one, and no gate ever reads a time out of a stamp or plan doc.
- **Reading the clock at a gate.** One `Bash` call, arithmetic done by the shell, not by you:

  ```bash
  echo $(( ( $(date +%s) - $(cat <scratchpad>/grind-start) ) / 60 ))
  ```

  That integer is `elapsed` in minutes. Use the number it printed. If the anchor file is missing or unreadable (a compaction lost the scratchpad, say), treat the timer as **expired** and go to the stop flow — never fall back to guessing.
- **Stop threshold:** 90m elapsed. Nothing stops before it.
- **Budget gates:** before each slice and each run-level phase, read the clock, then: if `elapsed < 90`, **proceed** — no other check. If `elapsed ≥ 90`, the run may still finish work that fits: proceed only when `elapsed + budget ≤ 115`, otherwise go to the stop flow ([Timer stop](#timer-stop-healthy--resume-continues)).

| Phase | Budget to start |
|-------|-----------------|
| Build | 30m per slice (the last slice's covers the wrap-up) |
| Review | 25m |
| Triage + fix | 25m |
| Test plan | 15m |
| PR open | 5m |

- Budgets bound the **gate arithmetic**, not the subagents — a dispatched agent is never clocked, interrupted, or cut off mid-phase. The gate's only question is whether there is room to begin.
- `--no-timer` disables every gate; nothing else changes — no anchor is written and no clock is read.

### Select the phase

Everything in this section runs before the confirmation and writes nothing to the plan. A stop here is a message and an exit — no stamp, no notification.

8. **Refuse the old format.** A `## PR Breakdown` table was written by the multi-PR `/grind` this skill replaced, and there is no path that continues it. Stop with: "This plan carries a `## PR Breakdown` table from the old multi-PR /grind. Land or close its open PRs, delete the `## PR Breakdown` section, untick every unit no merged PR built, then re-run `/grind <plan path>`."

9. **Map phases to units.** A phase is a `### Phase N` heading under `## Phased Delivery`, and its units are the ordinals on the `**Units:**` line directly beneath that heading — read the label only there, since blueprint's `plan-written` stamp template uses it too. A plan without `## Phased Delivery` is one phase holding every unit: `Phase 1 of 1`. Units marked `**Reviewed:** retired` are excluded everywhere. Then validate:
   - A unit listed under two phases → stop, naming the unit and both phases.
   - An ordinal that names no unit → stop, naming it.
   - A phase with no `**Units:**` line → propose a set for it: the consecutive unclaimed units its prose describes. The proposal is shown in the confirmation and written back on **Grind it**, so the next run reads the same mapping.
   - A non-retired unit in no phase, after any proposals → stop, naming it.

   Every stop here ends with: "Fix the `**Units:**` lines under `## Phased Delivery`, then re-run `/grind <plan path>`."

10. **Pick the phase** — from `## Grind` first, checkboxes second. Checkboxes are ticked as each slice is built, so a run stopped before its PR opened would look finished by checkboxes alone; the run line is what says a phase is done.
    - **A recorded run that is not `complete`** — a `### Phase <n> of <m>` subsection whose `**Run:**` is any other value → that phase resumes: go to [Resume](#resume). No confirmation; its slices were confirmed when the run started.
    - **Every recorded run is `complete`** → gate on the latest one's PR. `git fetch origin <default-branch>`, then `gh pr list --head <branch> --state all --json number,state,url` with the branch from its run line:
      - `OPEN` → print "Phase <n> of <m>: PR #<N> open — `/land` it." and exit. No stamp, no notification. Re-running is also how to recover a run whose notification never arrived. The final phase set `status: completed` when its PR opened; if that PR is later closed unmerged, the plan stays `completed` until you flip it back by hand.
      - `MERGED` → move on to the first phase holding an unchecked unit. When none does, print "Every phase of <plan> is built and merged." and exit.
      - Closed unmerged, or no PR at all → the phase was abandoned and needs a human reset. Stop with: "Phase <n>'s PR <#N | was never opened> did not merge. To rebuild it: delete the `### Phase <n> of <m>` subsection under `## Grind`, untick units <list>, remove the worktree `<path>` and the branch `<branch>` (local and remote)<, and set `status: active` — on the final phase>, then re-run `/grind <plan path>`."
    - **No `## Grind` section** → the first phase holding an unchecked unit. When any unit is already ticked, it was built outside grind (likely by `/work`): accept it, carry the warning "Units <list> are ticked with no `## Grind` record — built outside /grind. Confirm they are merged before grinding." into the confirmation, and leave ticked units out of the slices.

    The run's branch follows the `/tree` convention — `{prefix}/{issue}/{short-description}`, dropping the `{issue}` segment when there is no linked issue — with a `-p<n>` suffix when the plan has more than one phase, so a leftover worktree from phase 1 never collides with phase 2. The conventional-commit prefix and description come from the phase's units; they also become the PR title.

### Slice the phase

11. **Slice the phase's unbuilt units into build checkpoints.** A slice is one or more consecutive units one build subagent implements together; after it, the run verifies and records what landed before the next slice starts.

    Group units into the same slice when they:
    - Would leave the branch incoherent if split (a caller and the function it calls; a migration and the code that reads the new column).
    - Are individually too small to build and observe meaningfully (a one-line config change plus the flag that reads it).
    - Edit the same files heavily enough that separate builds would churn them.

    Split units into separate slices when they:
    - Touch unrelated areas of the codebase.
    - Have a clean dependency boundary — the later one only needs the earlier one *committed*.
    - Would together exceed roughly 400 changed lines, or span more than ~6 files, without a reason to be atomic.

    **Every slice must leave the branch coherent on its own.** This is the hard constraint; the size heuristics bend to it. Order the slices by dependency, and where there is none, by risk — foundational and schema-touching work first, leaf features last. Give each a short name.

12. **Confirm once** with `AskUserQuestion` — the only confirmation in the run. The question text announces the phase and the count: "Grind phase <n> of <m> — <k> slices on `<branch>`, ending at one PR?" Show the slice table in a `preview` on the first option, with any proposed `**Units:**` lines and the built-outside-grind warning above it.
    - **Grind it** — proceed. Everything after this point is unattended through to the open PR.
    - **Revise** — the user supplies free-form adjustments (merge slices, split one, reorder, change a proposed `**Units:**` set). Revise and re-confirm.
    - **Cancel** — stop. Nothing has been written.

13. **Write the plan state.** Write each confirmed proposed `**Units:**` line under its `### Phase N` heading. Then write this run's subsection: create `## Grind` immediately after `## Overview` when it does not exist (create `## Overview` if the plan lacks one; never displace `Implementation Units`), and append `### Phase <n> of <m>` at the end of `## Grind`:

    ```markdown
    ## Grind

    <!-- maintained by /grind — run: building | reviewing | addressing | test-plan | pr-open | complete | blocked | stopped; slice status: pending | building | built | blocked -->

    ### Phase 1 of 2

    **Run:** building · branch `feat/57/token-refresh-p1` · PR —

    | # | Slice | Units | Status | Notes |
    |---|-------|-------|--------|-------|
    | 1 | Add token refresh to auth middleware | 1, 2 | pending | — |
    | 2 | Wire refresh into the client SDK | 3 | pending | — |
    ```

    Later steps add three lines under the run line, each when it is decided: `**Reviewed at:** <sha>` (written before triage), `**Review:**` and `**Test plan:**` (each a doc path, `clean`, or `none — <reason>`). The run line's `PR` holds the PR number as a link once opened. `Notes` holds one short clause — the reason a slice is blocked, or `stopped by timer at <phase>` when the timer ended the run there (the status stays at the in-flight value; **stopped is not blocked**).

14. **Stamp the start on the issue.** Compose the body, write it to a temp file with the Write tool, and post per [the issue-log spec](../issue-log/SKILL.md#posting):

    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"grind-started","paths":["<plan file path>"],"phase":<n>,"phases":<m>,"slices":<count>} -->

    ### ⚙️ /grind — phase <n> of <m>, <count> slices

    **Plan:** <plan file path>
    **Phase:** <n> of <m> — branch `<branch>`
    **Started:** <YYYY-MM-DD HH:MM local>
    **Session:** `claude --resume <session-id>`
    **Slices:** <one line per slice: "N. <slice name> — units <list>">
    ```
    ```bash
    gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>
    ```

    Then build the slices.

### Resume

A recorded run that is not `complete` re-enters here, whatever its run value — `blocked` and `stopped` included. Reconcile against reality before doing anything; the subsection's table and run line say what was attempted, never what landed. Read the rungs in order and re-enter at the **first missing checkpoint**, reusing the run's worktree and its work doc per [the work-protocol spec's resume](../work-protocol/SKILL.md#resume) — never recreate either. A blocked gate that has not cleared re-blocks at the same place.

- **Rung 1 — slices built.** The evidence per slice is `git log origin/<branch>` plus `unit-complete` stamps on the issue, fetched per [the issue-log reader contract](../issue-log/SKILL.md#reader-contract) and counted only when the marker's `paths` holds this plan's file path **and** its `branch` is this run's branch; a grind event the spec lists as [retired](../issue-log/SKILL.md#event-registry) never counts. A slice whose units are all committed and stamped is built — if its row is not `built`, run its verify-and-record step from `docs/work/.raw/<slug>/build-<n>.md`; without that file, take each committed unit's range from `git log <base>..origin/<branch>` yourself (never passing messages to the observer), fill every `Reason:` with `none given`, and record no stale tests. A slice with partial state → the build subagent continues from the first unfinished unit, never redoing a stamped one. Nothing → build it from scratch.
- **Rung 2 — work doc complete.** The run's work doc is at `status: complete`. Otherwise the wrap-up never finished: run it.
- **Rung 3 — review ran.** A review doc in `docs/reviews/` passes the Review section's verification — `target:` is this branch, `date:` is current, and the structural greps hold — or the subsection carries a `**Review:**` line starting `clean` or `none — `. Then **never re-dispatch the fleet**. A doc that fails any check is a leftover from an earlier attempt: ignore it. A `clean` review has nothing to triage; skip to rung 6.
- **Rung 4 — triage done.** **Every** `### P<X>-<N>:` heading carries a non-`open` `Status:`. Some is not enough: triage writes one finding at a time, so a kill mid-loop leaves a mixed doc. Any `open` finding → re-enter triage on the `open` findings alone, skipping every finding that already carries a `**Grind:**` line. When no finding is accepted — every one `wont-fix` or `deferred` — no fix agent was dispatched and none is owed: skip to rung 6.
- **Rung 5 — fixes landed.** No finding is `in-progress`, or `git log <reviewed-at>..origin/<branch>` shows commits past the subsection's `**Reviewed at:**` SHA. In the second case the fixes landed but their record did not: rebuild each accepted finding's `done` status and its `**Grind:** fixed — <what changed>; why: <why the fix was applied>` line from those commits, skipping any finding already signed `**Grind:** accepted — not fixed` — **never re-dispatch the fix agent**. Otherwise re-derive the fix brief from the `in-progress` findings.
- **Rung 6 — test plan written.** A `docs/tests/*.md` document verifies for this branch per [the test-protocol spec's resume](../test-protocol/SKILL.md#resume), or the subsection carries a `**Test plan:** none — <reason>` line.
- **Rung 7 — PR open.** `gh pr list --head <branch> --state all --json number,state,url`. A PR exists → only the bookkeeping after the open remains: verify it, post the `pr-created` stamp (a duplicate is harmless — the reader dedupes), and finish the run. None → open it.

### Build the slices

15. **Create the worktree and the work doc** — once per run; a resume reuses both. The branch is the one Select the phase named, and the worktree follows `/tree`'s convention at `../{repo-name}-worktrees/{branch-name}/`:
    ```bash
    git fetch origin <default-branch>
    git worktree add -b <branch-name> ../<repo>-worktrees/<branch-name> origin/<default-branch>
    ```
    Then symlink `docs/` from the primary checkout into the worktree (as `/tree` does), since it's gitignored and the plan lives there.

    Then **create the run's work doc** per [the work-protocol spec](../work-protocol/SKILL.md#the-document) — its filename, frontmatter, four sections, and empty-section placeholders are the spec's. Grind's values: `target:` is the run's branch and `base:` is `git -C <worktree> rev-parse HEAD` now. Seed `## Decisions` per [the spec's lifecycle](../work-protocol/SKILL.md#lifecycle). Set the run line to `building`.

    Then run the budget gate, the dispatch, and the verify-and-record below for each slice in table order, and the wrap-up once after the last.

16. **Budget gate** (build, 30m — one per slice), then **update the row** to `building` in the plan doc.

17. **Dispatch the build subagent** — `Agent` with `model: "opus"` and `subagent_type: "general-purpose"`. Dispatch is asynchronous: wait for the subagent's completion notification before doing anything else, since there is nothing to interleave in a serial run. Subagents are never clocked — the slice's budget gated the *start*, and once dispatched the agent runs to completion. The next clock reading happens at the following gate, on real elapsed time, whatever that turns out to be.

    The brief must contain, and nothing may be left implicit:
    - The absolute worktree path, and the instruction to do **all** work there — never in the primary checkout.
    - The absolute plan file path, for full context.
    - The verbatim text of every implementation unit in this slice: Goal, Requirements, Files, Approach, Execution note, Patterns to follow, Verification.
    - The instruction to ignore any `Test scenarios` field left by an older plan; this run writes no tests.
    - Any `Deferred to Implementation` questions bearing on these units, plus the plan's `Scope Boundaries` as explicit non-goals.
    - The instruction never to edit the plan file; grind owns it.
    - The instruction to follow the repo's `CLAUDE.md` conventions.
    - **The per-unit cadence:** implement the slice's units in plan order. After each unit: stage only that unit's files, commit with a scoped conventional message (`/work`'s incremental-commit heuristics), **push**, and post the unit's issue stamp. The push is the point — a killed process must never cost more than the unit in flight.
    - **The embedded stamp templates**, fully filled: the `unit-complete` and `unit-blocked` blocks below with `<issue>`, the repo, the plan path, and the branch substituted, plus these three posting rules verbatim (the agent does not read the spec): write the body to a temp file and post with `gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>`; the marker line must never contain `--` — replace every occurrence in serialized titles (`---` → `- - -`); a failed or skipped stamp is one report line, never a stop. Skip all stamps when `<issue>` is empty.

      ```markdown
      <!-- cc-forge-log v1: {"skill":"grind","event":"unit-complete","unit":"<ordinal>: <title from plan checkbox heading>","paths":["<plan file path>"],"branch":"<branch>"} -->

      ### 🔨 /grind — unit <ordinal>: <title>

      **Did:** <one-liner: what the unit delivered>
      **Solved:** <one-liner: the problem solved — omit this line when none>
      ```

      ```markdown
      <!-- cc-forge-log v1: {"skill":"grind","event":"unit-blocked","unit":"<ordinal>: <title from plan checkbox heading>","paths":["<plan file path>"],"branch":"<branch>"} -->

      ### ⚠️ /grind — unit <ordinal> blocked: <title>

      **Blocked:** <one-liner: what gates the unit>
      ```
      When concrete refs gate the blocked unit, add `"blocked_by":["<owner>/<repo>#<n>"]` to its marker; drop the key otherwise (same rule as `/work`'s stamp).
    - **The blocked-unit rule:** a unit it cannot complete stops the build — post the `unit-blocked` stamp, push what is committed, and return the partial state (which units landed, what blocked, the branch name). Later units and slices build on it, so nothing continues past it.
    - **Its deliverable:** commits on the branch, pushed per unit, and **no PR** — grind opens the run's one PR itself, after the last slice, the review, and the test plan. It must not open or merge a PR, must not touch `main`, must not `git add -A`, must not `--no-verify`, and must not create a worktree of its own.
    - **Its return value:** the branch name, a one-line summary, and per unit: its status; its commit range as `<base>..<head>` SHAs; what changed per file, one line each; any deviation from the unit's Approach with its reason; decisions made and patterns established; and **stale tests** — existing tests the unit may have made stale, each as its path (optionally `::<test name>`) plus one sentence on why, found by grepping the test directories for the symbols and modules the unit changed, renamed, or removed and then judging each hit, erring broad. A unit it could not complete carries the reason instead of a range.

18. **Verify and record the slice.** This is the step [Resume](#resume) re-runs for a slice whose units all landed. Before reading anything out of the return, write it verbatim to `docs/work/.raw/<slug>/build-<n>.md` per [the work-protocol spec's resume](../work-protocol/SKILL.md#resume) (`<slug>` is the doc's, `<n>` the slice number).

    **Verify the subagent's claim.** Never take the return value on faith — confirm the remote branch holds the per-unit commits (`git -C <worktree> log origin/<branch> --oneline`), that every returned range resolves in that log, and that the returned per-unit statuses account for every unit in the slice. If the pushed commits do not cover the slice's units: if the agent reported a blocked unit, mark the row `blocked` with the reason and halt per Halting — after recording its committed units below, with no wrap-up, so the doc stays `in-progress` for the resume; otherwise the build failed regardless of what the agent reported — same halt.

    **Record the slice in the run's work doc**, per [the work-protocol spec](../work-protocol/SKILL.md), one unit at a time in plan order:
    - Dispatch `forge:workflow:scope-observer` in [`unit` mode](../work-protocol/SKILL.md#unit-mode) with the inputs the spec names — the absolute plan path, the ordinal, that unit's verified range, and the absolute worktree path as the working directory; grind's addenda list is always empty. The brief carries nothing from the build return — no summaries, deviations, reasons, or commit messages; [what the observer sees](../work-protocol/SKILL.md#what-the-observer-sees) says where grind's wall is only instructed. The per-unit dispatches may go in one parallel batch; record them in plan order.
    - Update the doc per [the spec's lifecycle](../work-protocol/SKILL.md#lifecycle), from the persisted return: Changes from git and the per-file lines, the stale tests into Tests to Revisit, Decisions from the returned decisions, the observer's cards numbered and their `Reason:` filled per [the spec's `Reason:` rule](../work-protocol/SKILL.md#reason) — including a card for every returned deviation the observer missed — and the unit's [observed marker](../work-protocol/SKILL.md#the-observed-marker). A failed dispatch follows [the spec's failure rule](../work-protocol/SKILL.md#failure); it never blocks the slice.

    Then tick the slice's unit checkboxes in the plan and mark the row `built`.

19. **Wrap up after the last slice** — inside the last slice's build budget, with no gate of its own. Dispatch the observer once in [`wrap-up` mode](../work-protocol/SKILL.md#wrap-up-mode) over the phase's committed units, with the worktree as the working directory; record its cards and marker, set `status: complete`, and delete `docs/work/.raw/<slug>/`. Then continue to Review.

**Every card stays `open`** — grind acts on none of them and never uses [the reply verbs](../work-protocol/SKILL.md#reply-verbs).

### Review

20. **Budget gate** (review, 25m), then set the run line to `reviewing` and load the roster. `cc-forge.local.md` in the project root → `review_agents` from its frontmatter, and its markdown body as the local review context. No file → [`/deep-review`'s default set](../deep-review/SKILL.md#load-review-agents) plus [its conditional agents](../deep-review/SKILL.md#conditional-agents-run-if-applicable), and always `forge:review:code-simplicity-reviewer`. Either way, **never dispatch `forge:review:test-coverage-reviewer`**, even when `cc-forge.local.md` names it: the run's test plan owns coverage, and the stamp says it was skipped.

21. **Dispatch the fleet.** Parallel by default; serially when 6+ agents are configured. Each agent's brief:
    - The branch diff, `git -C <worktree> diff origin/<default-branch>...HEAD` — no PR exists yet.
    - The verbatim plan units this phase owns, and only those.
    - The repo's `CLAUDE.md` conventions as the house bar, plus the local review context when present.
    - Verbatim: "Ignore test files and test coverage. Report no missing-test, weak-assertion, or test-quality findings — this run's test plan owns them."
    - The return contract: a structured findings list (severity `P1`/`P2`/`P3`, file:line, one-sentence description) plus an overall verdict; an empty list is a valid result.

    A roster agent that fails or returns nothing: proceed with partial coverage and name it in the report — a missing lens is reportable, not fatal.

22. **Synthesize** per [the review-protocol spec](../review-protocol/SKILL.md): persist every agent's findings to [the scratch path](../review-protocol/SKILL.md#the-raw-findings-scratch-contract), [dispatch the synthesizer](../review-protocol/SKILL.md#dispatching-the-synthesizer), and run [its count check](../review-protocol/SKILL.md#sanity-checking-the-returned-counts). Grind's values: the PR metadata is the branch form — the branch name, the base SHA (`git -C <worktree> merge-base origin/<default-branch> HEAD`), and the PR title from Select the phase, with no PR number — so the doc's `target:` is the branch; the slug is the branch; the reviews directory is the **primary checkout's** absolute `docs/reviews/` (the worktree's `docs/` is a symlink to it).

23. **Verify the doc** per [the spec](../review-protocol/SKILL.md#verifying-the-review-document), falling through to [its inline fallback](../review-protocol/SKILL.md#inline-fallback); the spec owns the retry split and the scratch deletion. Record the outcome as the `**Review:**` line under the run line:
    - **Clean review** → `**Review:** clean (<n> agents)`. Nothing to triage: continue to Write the test plan.
    - **A verified doc** — the synthesizer's or the inline one → `**Review:** <doc path>`.
    - **Raw fallback** (no rules file resolved, so no doc) → there is no user to present to and no PR to comment on: keep `docs/reviews/.raw/<slug>/` as the record, write `**Review:** none — degraded review, raw findings at docs/reviews/.raw/<slug>/`, and triage from the raw lists, carrying every verdict and its reason into the report since there is no doc to hold them.

24. **Stamp the review on the issue** when the synthesizer's doc verified — [the spec](../review-protocol/SKILL.md#the-review-written-stamp) owns when it fires, the body below the heading, and the posting. Grind's filled template:

    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"review-written","paths":["docs/reviews/<filename>","<plan file path>"]} -->

    ### 🔍 /grind — review written (test-coverage-reviewer skipped)
    ```

### Triage and fix

25. **Budget gate** (triage + fix, 25m), then **record the fix checkpoint** — `git -C <worktree> rev-parse origin/<branch>` written as `**Reviewed at:** <sha>` under the run line, before any verdict. [Resume](#resume) reads commits past it as fixes that landed.

    Then **triage the findings yourself** — from the review doc, or the raw lists in the degraded case. This is `/grind`'s judgment call and it does not delegate it. For each finding decide **accept**, **reject**, or **defer**:

    **Accept is the default verdict.** A finding that is real and fixable within this phase's files gets accepted, whatever its priority — the fix agent is already being dispatched, and a small P3 costs nothing extra to fold in. Reject and defer are the exceptions and each needs a stated reason.

    | Verdict | Use when |
    |---------|----------|
    | **Accept** | The finding is correct and touchable from this phase's diff. All P1s that survive scrutiny are accepted — a real correctness or security bug is never deferred past the PR. P2s and P3s are accepted too unless a reject or defer condition below actually applies. |
    | **Reject** | The reviewer misread the code, the "bug" is intentional per the plan, or the suggestion contradicts the plan's Key Technical Decisions or Scope Boundaries. Not for "low priority" or "nice to have" — those are accepts. |
    | **Defer** | The fix would touch units this phase does not own, or is large enough to need its own plan. "Outside this phase" means the code lives elsewhere — not merely that the finding is minor. |

    Read the actual code before accepting or rejecting a P1. A reviewer agent working from a diff can misjudge context the surrounding file makes obvious; equally, do not reject or defer a finding merely because acting on it is inconvenient. When a verdict is genuinely borderline, accept it.

26. **Record the triage durably — before any fix is dispatched:**
    - Write each verdict into the review doc as its `Status:` line, using `/review-walk`'s vocabulary: accepted → `in-progress`, rejected → `wont-fix` (with a `Skip reason:`), deferred → `deferred` (with a `Defer reason:`). Reason lines follow [`/review-walk`'s Skip reason format](../review-walk/SKILL.md#skip-reason-format), which owns the `<code> — <free text>` shape, the `Skip reason:` code list, and the neutralization rule — grind restates none of it, so a code added or renamed there applies here without a second edit. The `Defer reason:` codes are grind's own, because grind is their only writer (`/review-walk` files an issue on defer and records a `Tracking:` line instead): `bigger-than-scoped` (the real fix is larger than the finding describes), `blocked-on` (waits on another change, a migration, a release, or an external party), `needs-decision` (someone has to decide something first), `follow-up-pr` (real and wanted, but belongs in its own change). Writing the same codes the user writes is what lets a later analysis read grind's reasons and theirs on one axis.

      **On a P1, grind may use only a subset of those codes** — this restriction is grind's own, not part of the shared vocabulary, because the triage table forbids exactly what most of the codes say. Rejecting a P1 admits `misread` and `by-design` only; deferring one admits `bigger-than-scoped` only. Every other reject code is a cost or scope judgment the triage table reserves for a human, and the remaining defer codes describe waiting on someone an unattended run cannot wait for — a P1 carrying either is a P1 that ships unfixed. **A P1 that fits none of the admissible codes is accepted.** P2 and P3 take the full lists. The doc is now the durable triage record — a killed process resumes from these lines without re-reviewing.
    - **Sign every verdict.** Directly under each triaged finding's `Status:` line, before any reason line, write `**Grind:** <accepted | rejected | deferred | fixed> — <one line why>`. This is grind's counterpart to [`/review-sweep`'s `Sweep:` line](../review-sweep/SKILL.md), which owns the signature convention and why it exists. Triage writes one of the first three values; verifying the fixes rewrites an accepted finding's line when the fix lands. Exactly one per finding, ever — always a rewrite, never a second line.

27. **If nothing was accepted**, continue to Write the test plan.

28. **If anything was accepted**, set the run line to `addressing` and **dispatch the fix subagent** — `Agent` with `model: "opus"` and `subagent_type: "general-purpose"`. Wait for its completion notification before proceeding.

    The brief:
    - The absolute worktree path — the branch is still checked out there.
    - The accepted findings verbatim, each with its file:line, and explicitly **only** those. Rejected and deferred findings must not appear in the brief at all; a fix agent handed the full list will quietly fix everything.
    - The instruction to commit and push to the branch when done, and to run no test suite — a regression surfaces in CI when you land the PR.
    - The same prohibitions as the build agent: no merge, no PR, no `main`, no `git add -A`, no `--no-verify`, no force-push.
    - **Its return value:** per finding, what it changed and why the fix was applied — the reasoning, not a restatement of the finding — and any finding it could not address with the reason.

29. **Verify the fixes landed** — `git -C <worktree> log origin/<branch>..HEAD` is empty (everything pushed) and `git -C <worktree> log <reviewed-at>..origin/<branch>` shows the new commits. If the agent reported success but nothing was pushed, retry once with a brief noting exactly what was missing; if the retry also fails, halt per Halting. On success, in one edit per finding:
    - **Fixed** → flip `Status:` to `done` and rewrite its `**Grind:**` line to `**Grind:** fixed — <what changed>; why: <why the fix was applied>`, replacing the `accepted` line. A `done` finding still claiming `accepted` records a verdict where it should record an outcome.
    - **Not addressed** → leave `Status:` at `in-progress` and rewrite its line to `**Grind:** accepted — not fixed: <reason>`, so `/review-walk` presents it as left by an unattended run. The report lists it.

30. **Never file a GitHub issue for a deferred finding.** Deferred findings live in the review doc's `Status: deferred` lines — that is the whole record. Do not call `/side-quest`, do not open a tracking issue, do not create one at the end of the run. Surfacing them in the report is how the user learns about them and decides what to file.

31. **Do not re-review.** One review pass per run; reviewing the fixes with a fresh fleet invites an unbounded loop. Continue to Write the test plan.

### Write the test plan

This mirrors `/test-plan` from its context through its verified document, in the worktree, and stops there: no writer, no assurance filters, no test file, no commit. Writing and running the tests is `/test-plan-run`, your step after review.

32. **Budget gate** (test plan, 15m), then set the run line to `test-plan`.

33. **Resolve the intent.** The document's `target:` and slug are the run's branch, the diff base is `origin/<default-branch>`, and the origin documents are this plan and the brainstorm its `origin:` names. Descend [the spec-lens input ladder](../test-protocol/SKILL.md#spec-lens-input-ladder), bounded to the phase's units per [the brief-is-bounded rule](../test-protocol/SKILL.md#the-brief-is-bounded). The ladder's last rung is not a halt here: write `**Test plan:** none — no intent source` under the run line and continue to Open the PR.

34. **Build the surface digest and the conventions** in the worktree, as `/test-plan`'s [Build the surface digest](../test-plan/SKILL.md#3-build-the-surface-digest) and [Discover the test conventions](../test-plan/SKILL.md#4-discover-the-test-conventions) do, per [the spec's surface digest](../test-protocol/SKILL.md#the-surface-digest).

35. **Dispatch the three lenses** in one parallel batch — [the spec's roster](../test-protocol/SKILL.md#the-roster) and [three lenses](../test-protocol/SKILL.md#the-three-lenses), briefed as `/test-plan`'s [Dispatch the three lenses](../test-plan/SKILL.md#5-dispatch-the-three-lenses) briefs them. The blast-radius lens gets the run's work doc, per [the work-protocol readers rule](../work-protocol/SKILL.md#readers). Empty or failed lenses follow [the lens-failure posture](../test-protocol/SKILL.md#lens-failure-posture); when all three come back empty or failed, write `**Test plan:** none — lenses returned nothing` and continue to Open the PR.

36. **Persist, synthesize, and verify** as `/test-plan`'s [Persist and synthesize](../test-plan/SKILL.md#6-persist-and-synthesize) and [Verify the document](../test-plan/SKILL.md#7-verify-the-document) do: [the raw scratch contract](../test-protocol/SKILL.md#the-raw-scratch-contract), [the synthesizer dispatch](../test-protocol/SKILL.md#dispatching-the-synthesizer), [the count check](../test-protocol/SKILL.md#the-count-check), [verification](../test-protocol/SKILL.md#verifying-the-document), and [the inline fallback](../test-protocol/SKILL.md#inline-fallback). The tests directory is the **primary checkout's** absolute `docs/tests/`. Record `**Test plan:** <doc path>` under the run line. No completion report prints here — the run's Report carries the doc.

37. **Stamp the test plan on the issue** when the synthesizer's doc verified — [the spec's `test-plan-written`](../test-protocol/SKILL.md#test-plan-written) owns when it fires and the body below the heading. Grind's filled template:

    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"test-plan-written","paths":["docs/tests/<filename>","<plan file path>"]} -->

    ### 🧪 /grind — test plan written
    ```

### Open the PR

38. **Budget gate** (PR open, 5m), then set the run line to `pr-open`.

39. **Compose the body** from [`/ship`'s PR template](../ship/pr-template.md), verbatim in structure, with exactly two grind-specific fills:
    - **`Related to #<issue>`** at the top when `<issue>` is set — never a closing keyword. Merging is yours, and the issue may span later phases.
    - **`### Grind Docs`**, appended after `### Related Changes` (after `### Primary Changes` when there are none) — the template's only addition:

      ```markdown
      ### Grind Docs
      - **Work:** `<work doc path>`
      - **Review:** `<review doc path>` | clean | degraded — raw findings at `docs/reviews/.raw/<slug>/`
      - **Test plan:** `<test doc path>` | none — <reason>
      - **Review tally:** <n> findings — <n> fixed, <n> deferred, <n> rejected<, <n> not fixed>
      ```

    Under **Pre-merge Tests**, when a test doc exists, add the plain item `Run /test-plan-run <test doc path> and commit the tests` — no backticks, so `/land` reports it as manual rather than running it. Deviations never appear in the body, per [the work-protocol spec's terminal one-liners](../work-protocol/SKILL.md#terminal-one-liners). The title is the conventional-commit title from Select the phase.

40. **Open it ready, not draft** — write the body to a temp file with the Write tool, then from the worktree:

    ```bash
    gh pr create --base <default-branch> --head <branch> --title "<title>" --body-file <temp-file>
    ```

    **Verify it** with `gh pr view <N> --json number,state,url,headRefName,mergeable`: `state` is `OPEN` and `headRefName` is the run's branch, or halt per Halting. Keep `mergeable` for the report. Grind posts no PR comment, ever — the per-finding outcome comment is `/review-push`'s, after your walk.

41. **Stamp the PR on the issue:**

    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"pr-created","pr":<N>,"paths":["<plan file path>"]} -->

    ### 🚀 /grind — PR #<N> opened (phase <n> of <m>)

    **PR:** <url>
    **Summary:** <one line on what the PR delivers>
    ```

42. **Close the run.** Set the run line to `complete` with the PR number as a link. When this is the plan's final phase, set the frontmatter `status: active` → `status: completed`; an earlier phase leaves it `active` so the next run finds it. Then Report.

### Halting (blocked — needs a human)

43. **Halting stops the entire run.** Later slices build on earlier ones, so a blocked slice is never skipped. On halt:
    - Set the run line to `blocked`, and the row — when the halt is in a slice — to `blocked`, with a one-clause reason in `Notes`.
    - Leave the branch, the worktree, and any PR **in place** — they are your material for taking over. Set every remaining row's `Notes` to `not started`.
    - Stamp the issue. A halt almost always fires before the PR exists, so the default form carries no `pr` and says where the work is:
      ```markdown
      <!-- cc-forge-log v1: {"skill":"grind","event":"grind-blocked","paths":["<plan file path>"]} -->

      ### 🛑 /grind — halted at <slice i of count | review | triage/fix | test plan | PR open>

      **Blocked:** <what stopped it>
      **Branch:** `<branch>` (pushed, no PR — <n> of <m> units built)
      **Worktree:** <absolute path>
      **Remaining:** <count> slices not started
      ```
      Only when the PR is already open does the marker gain `"pr":<N>` and the body a `**PR:** <url> (open)` line in place of `**Branch:**`. Never invent a number or url.
    - Notify, then report: what was built, where the branch and worktree are, the failure with its real output, and the concrete next step.

    **Blocked is not stopped.** Blocked waits for you (a blocked unit, a build or fix that did not push, a PR that did not verify). A timer stop is a healthy run out of clock, and a resume continues it.

### Timer stop (healthy — resume continues)

44. When a budget gate fails, end the run cleanly, **durable writes first, email last**:
    1. **Plan state:** set the run line to `stopped`. In a slice, the row keeps its in-flight status and its `Notes` reads `stopped by timer at <phase>`.
    2. **Stamp the issue:**
       ```markdown
       <!-- cc-forge-log v1: {"skill":"grind","event":"grind-stopped","paths":["<plan file path>"]} -->

       ### ⏸️ /grind — stopped by timer before <slice i of count | review | triage/fix | test plan | PR open>

       **Done so far:** <n> of <count> slices built<, review/fix/test-plan state in one clause>
       **Remaining:** <what remains, one line>
       **Resume:** re-run `/grind <plan path>` — reconciliation picks up from here
       ```
    3. **Notify** — one attempt per channel, never a retry; the buffer is for exiting cleanly.
    4. Report the same summary to the terminal and exit.

### Report

45. When the PR is open, print the final summary:
    - The PR link and its `mergeable` state.
    - The three doc paths — work, review (or `clean` / the raw path), test plan (or `none — <reason>`).
    - `/work`'s deviation one-liner, per [the work-protocol spec](../work-protocol/SKILL.md#terminal-one-liners).
    - Phase <n> of <m> built; when phases remain: "After this PR merges, re-run `/grind <plan path>` for phase <n+1>."
    - Every deferred finding inline — title, `Defer reason:`, and the review doc — **not** filed as issues; you decide what to file. Then every `**Grind:** accepted — not fixed` finding, every verdict from a degraded review (no doc holds them), and every roster agent or lens that did not complete.
    - Every `Requirements Trace` item this phase's units claim that nothing built covers. This matters most — a phase can grind to completion with a requirement quietly unimplemented, and this is the only place it surfaces.
    - The **Next** block, verbatim with the absolute worktree path filled in:

      ```
      Next — review in a new session in the worktree:
        cd <worktree> && claude
        /review-walk  →  /review-push  →  /test-plan-run <test doc>  →  /ship  →  /land
      Run these from the worktree; from the primary checkout they act on main.
      ```

      `/ship` is there because it commits the tests `/test-plan-run` leaves uncommitted and pushes them to the open PR. With no test doc, drop `/test-plan-run` and `/ship` from the chain.

46. **Stamp the completion**, then notify:
    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"grind-complete","pr":<N>,"phase":<n>,"phases":<m>,"paths":["<plan file path>","<work doc path>","<review doc path>","<test doc path>"]} -->

    ### 🏁 /grind — phase <n> of <m> ready for review

    **PR:** <url>
    **Docs:** work `<path>` · review `<path | clean | raw path>` · test plan `<path | none>`
    **Deferred findings:** <count, or "none"> — in the review doc; not filed as issues
    ```
    `paths` holds only the docs that exist.

### Notification

Every terminal outcome — `grind-complete`, `grind-stopped`, `grind-blocked` — notifies on **two independent channels** after its stamp is posted. The stamp is the durable record; the channels are the reach. Neither is a fallback for the other: push always fires, whether or not the email succeeded, because they land in different places (terminal and phone vs. inbox). A blocked run emails too — the process can be cut off before you ever see the terminal.

- **Push — always.** `PushNotification` with one line under 200 characters, no markdown: outcome, plan title, the number that matters, and the deviation count alone — no paths (`grind complete: auth-refresh — PR #61 ready for review, 3 deviations` / `grind stopped: auth-refresh — 2 of 5 slices, resume to continue` / `grind blocked: auth-refresh — unit 4 blocked`). Fire it on every terminal outcome, including a timer stop. A skipped push (you're at the terminal) is a normal result, not a failure.
- **Email — when configured.** `SENDGRID_API_KEY` set → one `POST https://api.sendgrid.com/v3/mail/send` with a hard timeout (`curl --max-time 30`), the key passed only as an `Authorization: Bearer` header and the body via `--data @<file>`, so the key never lands in process listings and the body never lands in shell history. Unset, or the call fails → report one line, "couldn't send notification: <reason>", and continue. Exactly one attempt, never a retry.
- **From:** `hfritz@r-o.com` (name `Hagen Fritz`) — a verified SendGrid sender; an unverified `From:` is rejected with a 403. **Recipient:** hfritz@r-o.com. **Subject:** `[grind] <plan title>: <complete | stopped | blocked>`.
- **Body — the resume block is mandatory.** Every email, on every outcome, ends with both commands on their own lines, verbatim:

  ```
  claude --resume <session-id>
  /grind <plan path>
  ```

  `<session-id>` is the one captured in Preflight's run-metadata step. **Do not paraphrase, summarize, or drop these lines** — they are the reason the email exists, and an email that arrives without them has failed at its job even if it sent successfully. If Preflight captured no session id, print `claude --resume <no session id captured>` rather than omitting it. Above the resume block: the outcome in one sentence, the slice table, [the work-protocol spec's one-liner](../work-protocol/SKILL.md#terminal-one-liners), what remains (stopped/blocked), the blocking reason (blocked), and the Next block (complete).
- A notification failure on either channel is never fatal, never blocks the other channel, and never blocks the exit path it rides on.

## Rules

- **User-invoked only** — by slash command or plain-English ask ("grind this plan", "run the whole thing"). Never on your own initiative, never from inside another skill, never wired to a git or CI hook, and never because a plan looks ready. An implied approval ("looks good to me") is not an ask — when in doubt, ask.
- **One confirmation, then unattended.** The phase and its slices are confirmed; nothing after is. Never add prompts mid-run or silently degrade to asking — if the run can't proceed autonomously, halt and say why.
- **One phase, one branch, one worktree, one PR per run.** The worktree is created off `origin/<default-branch>` and left in place for your review; `/grind` runs from the primary checkout and never checks out a feature branch there.
- **Halt, don't skip; stop, don't die.** A blocked slice stops the run for a human. A failed budget gate stops it for the clock — cleanly, at a phase boundary, resumable. The two are distinct states with distinct stamps.
- **Never merges, never watches CI, never repairs CI.** The run ends at an open, ready PR; landing it is yours.
- **Every durable write precedes the notification it announces.** Plan state, then stamp, then one send attempt per channel.
- **Verify every subagent claim** against `gh` or `git` before acting on it. A returned "done" is a hypothesis.
- **The reviewer fleet returns findings only** — it never posts comments, `--approve`, or `--request-changes`, and grind posts no PR comment of its own.
- **Triage is `/grind`'s own judgment**, never delegated, recorded in the review doc's `Status:` and `Grind:` lines **before** the fix agent is dispatched. The fix agent receives accepted findings only.
- **One review pass per run.** Synthesis failures degrade (inline synthesis, then raw findings) — they never halt the run while raw findings exist, and they never trigger a second fleet.
- **The test plan cites [the test-protocol spec](../test-protocol/SKILL.md)** and restates none of it. Grind writes no test and runs no suite — not in the build, the fix, or the test plan.
- **One work doc per run, governed by [the work-protocol spec](../work-protocol/SKILL.md).** The scope observer flags and never blocks; grind records every card `open`, acts on none, and restates none of the spec.
- **The timer is measured, never estimated.** Every gate reads the scratchpad anchor with a real `date` call and lets the shell do the arithmetic. A missing anchor means stop, not guess.
- **No force-push, no pushes to `main`, no `--no-verify`, no `git add -A`** — for `/grind` or any subagent it dispatches.
- **The plan's `## Grind` section is the state; git, GitHub, and the docs are the checkpoints.** Update it at every transition; on resume, reconcile against them rather than trusting the table.
- **Report the real outcome.** Only claim the PR is open after `gh pr view` confirms it.
