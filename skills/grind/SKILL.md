---
name: grind
description: "Execute an entire implementation plan autonomously as a sequence of PRs, mirroring the manual skill chain unattended: an Opus subagent builds each slice unit-by-unit (committing, pushing, and stamping the issue per unit) while grind records a per-slice work doc and runs the scope observer over each unit, grind writes and runs the slice's tests through the test-protocol roster and opens the ship-conformant PR itself so CI runs once on code plus tests; the deep-review agent fleet reviews it; grind triages the findings itself, posts every verdict and outcome to the PR, dispatches a second Opus subagent for accepted fixes, and squash-merges on green CI — halting, never self-repairing, on red. A default-on lifetime timer stops the run cleanly before the VM's ~2-hour wall (--no-timer to disable), and every terminal outcome — complete, stopped, or blocked — always fires a push notification and emails when SendGrid is configured, the email always carrying the resume command. Use when the user says 'grind this plan', 'grind it out', 'run the whole plan', 'build all the PRs', or invokes /grind."
argument-hint: "[plan file path] [--no-timer]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Agent, AskUserQuestion, PushNotification, TaskCreate, TaskUpdate, TaskList
---

# Grind — Autonomously Execute a Plan as a Sequence of PRs

**Note: The current year is 2026.**

`/grind` takes a plan document and drives it to fully merged `main`, one PR at a time, without stopping for approval between PRs. For each PR slice it: creates a worktree; dispatches an **Opus** subagent that implements the slice unit-by-unit — committing, **pushing**, and stamping the issue after every unit, and writing no tests; mirrors the **test phase** inline, committing the tests it keeps; opens the ship-conformant PR itself, so exactly one CI run fires on the code and its tests together; runs the **`/deep-review` agent fleet** over the PR and posts the review; **triages the findings itself**, records every verdict durably before acting on it, dispatches a second Opus subagent for accepted fixes and reports each finding's outcome on the PR; then squash-merges once CI is green and moves to the next slice.

Two run-level guards wrap the loop. A **lifetime timer** (default on) stops the run cleanly at a phase boundary before the VM's ~2-hour wall instead of letting the process be killed mid-write — the stop is a healthy, resumable state, not a failure. And every terminal outcome — **complete**, **stopped** (timer), or **blocked** (needs a human) — posts a final issue stamp and notifies on **two independent channels** — a push that always fires, plus an email when SendGrid is configured, always carrying the `claude --resume` command — so an unattended run never ends silently.

The plan document is the durable state. `/grind` writes a `## PR Breakdown` table into it and updates each row as the PR advances; the review doc, worktrees, and unpushed-nothing per-unit cadence mean every checkpoint also exists on GitHub or on disk. An interrupted run — stopped, blocked, or hard-killed — is resumed by re-invoking `/grind` on the same plan.

`/grind` is the autonomous sibling of `/work` → `/deep-review` → `/ship`. It does **not** call those skills (confirm-gated by design, they would deadlock an unattended run) or `/land` (click-free, but per-PR and human-invoked). It mirrors their processes instead — `/work`'s per-unit stamps, commit cadence, and work doc, `/test-plan` and `/test-plan-run auto`'s lenses, writer, and filters, `/deep-review`'s roster and synthesizer, `/review-push`'s outcome reporting, `/ship`'s PR shape — so the issue thread and PR history of a grind run read identically to a manual run.

## Autonomy Contract

`/grind` runs unattended from the moment it starts building. Before it does, it gets **one** confirmation: the PR breakdown. After that it does not ask, and it will commit, push, and merge on its own judgment.

What that means, stated plainly:

1. **`/grind` merges without you.** Every merge in this skill is an unattended merge. It is gated on green CI and on `/grind`'s own final look — not on a human.
2. **`/grind` does not repair CI.** Red CI halts the run with the PR open. Where the old flow pushed up to three unattended fix commits, this one pushes none: an expensive CI suite is never re-triggered by autonomous guesswork, and masking a failure (deleting tests, loosening assertions, adding skips, bumping timeouts) is prohibited outright. **One carve-out, and only one:** a `delete` of a `V-` case recorded in the verified test document before the PR opens (Phase 4) is not masking — it is [the test-protocol spec's revise bucket](../test-protocol/SKILL.md#executing-revise-cases), gated there on a failing original. The prohibition still governs every response to red CI, where no revise case is ever created.
3. **The stop conditions are the safety net.** Because there is no human gate, the halt rules are load-bearing. When `/grind` cannot make progress on a PR, it **stops the entire run** and leaves the PR open — it never skips a blocked slice, since later slices assume earlier ones merged.
4. **The clock is part of the contract.** With the timer on, `/grind` will decline to start a phase it cannot finish before the stop threshold, and will end the run cleanly instead. `--no-timer` removes that guard for unbounded local runs.
5. **`/grind` never force-pushes, never pushes to `main`, never uses `--no-verify`, and never uses `git add -A`.** These do not become acceptable because the run is autonomous — for `/grind` or any subagent it dispatches.
6. **Interrupting is always safe.** State lives in the plan doc, the review doc, and on GitHub. Ctrl-C or a hard kill at any point leaves a world Phase 2's reconciliation can re-enter.

The user has to opt into this. A slash command or a plain-English ask ("grind this plan", "just run the whole thing") both count as opting in; a plan that merely looks ready does not. Never start `/grind` on your own initiative or from inside another skill.

## Input

<input_document> #$ARGUMENTS </input_document>

Split the argument into flags and the plan path: `--no-timer` anywhere in the argument disables the lifetime timer for this run; whatever remains is the plan path.

**If no plan path remains**, glob `docs/plans/*.md`, filter to `status: active` in the frontmatter, and present the most recent 4 by date via `AskUserQuestion` for the user to pick. If none exist, stop with: "No active plan found. Write one with `/blueprint` first, then re-run `/grind <plan-path>`."

## Workflow

### Phase 0: Preflight

Run these checks before touching anything. Any failure stops the run — a half-configured environment produces a half-merged plan.

1. **`gh` is available and authenticated** — `gh auth status`. If not: "GitHub CLI (`gh`) must be installed and authenticated for /grind. It merges PRs unattended and cannot proceed without it."
2. **This is the primary checkout** — `git rev-parse --git-common-dir` must resolve to `<toplevel>/.git`. If not: "You're inside a worktree. Run /grind from the primary checkout — it creates one worktree per PR." (Same rule as `/tree`.)
3. **On the default branch with a clean tree** — `git branch --show-current` is `main`/`master` and `git status --porcelain` is empty. If dirty: "Working tree is dirty. Commit or stash before grinding — /grind creates branches off a clean main." If on a feature branch: "You're on `<branch>`. /grind runs from the default branch; each PR gets its own worktree."
4. **Read the plan completely.** Note its `Implementation Units`, `Requirements Trace`, `Scope Boundaries`, `Deferred to Implementation`, and any `Execution note` fields. These are the source material for both the breakdown and every subagent brief.
5. **Resolve the linked issue** per [the issue-log spec](../issue-log/SKILL.md)'s issue-number resolution. Remember it as `<issue>`; it may be empty. Every stamp below skips silently when it is.
6. **Detect the test command** for the repo (`package.json` scripts, `Makefile`, `pytest.ini`, `Cargo.toml`, etc.). It is used in exactly one place: as the merge gate for a PR that reports **no CI checks** (Phase 8). It is **not** given to the build subagent, which writes no tests and runs no suite. When the repo has CI, `/grind` itself never runs the local suite — CI runs once, off the push that opens the PR in Phase 5, on the code and its tests together.
7. **Detect the email transport** and announce the result. `SENDGRID_API_KEY` set in the environment → email is **on**; unset → warn now, up front: "No SENDGRID_API_KEY — terminal outcomes will be stamped and pushed, but not emailed." Either way `PushNotification` still fires, so a terminal outcome is never silent. The detection is a preflight signal; the send itself re-checks (see Notification).
8. **Record run metadata.** Capture the current time — it goes in the grind-started stamp's `**Started:**` line, and (unless `--no-timer`) is written to the scratchpad as the timer anchor: `date +%s > <scratchpad>/grind-start` (see The Lifetime Timer). Also capture this session's id from the session context (Claude Code exposes it as the `claude.ai/code/session_…` URL in the commit-trailer guidance); the stamp's resume command is `claude --resume <session-id>`, and the same id goes in every email's resume block — capture it now, because it cannot be recovered later in the run. The stamped time is log, not clock: gates read the anchor file and nothing else, and a resumed run writes a fresh anchor.

### The Lifetime Timer

The VM's process lease is ~2 hours; the disk survives, the process does not. The timer's job is to ensure no phase is ever killed mid-write. The run works the **full 90 minutes** — no gate fires before then — and past 90m a phase may start only if its budget fits before the 1h55m mark, so whatever is in flight when the threshold passes still finishes inside the wall.

**Elapsed time is measured, never estimated.** Every reading is a real clock call. Do not infer elapsed time from how much work has happened, how many phases have run, or how long something felt — those judgments are unreliable and are not an input to any gate.

- **Anchor.** In Phase 0 step 8, write the start epoch to the scratchpad: `date +%s > <scratchpad>/grind-start` (the path is this session's scratchpad directory). This anchor is per-invocation — a resume writes a fresh one, and no gate ever reads a time out of a stamp or plan doc.
- **Reading the clock at a gate.** One `Bash` call, arithmetic done by the shell, not by you:

  ```bash
  echo $(( ( $(date +%s) - $(cat <scratchpad>/grind-start) ) / 60 ))
  ```

  That integer is `elapsed` in minutes. Use the number it printed. If the anchor file is missing or unreadable (a compaction lost the scratchpad, say), treat the timer as **expired** and go to the stop flow — never fall back to guessing.
- **Stop threshold:** 90m elapsed. Nothing stops before it.
- **Budget gates:** before starting each phase of each slice, read the clock, then: if `elapsed < 90`, **proceed** — no other check. If `elapsed ≥ 90`, the run may still finish work that fits: proceed only when `elapsed + budget ≤ 115`, otherwise go to the stop flow (Phase 10).

| Phase | Budget to start |
|-------|-----------------|
| Build | 30m |
| Test | 25m |
| Review | 25m |
| Triage + fix | 25m |
| Merge | 25m (the CI watch alone is capped at 20m) |

- Budgets bound the **gate arithmetic**, not the subagents — a dispatched agent is never clocked, interrupted, or cut off mid-phase. The gate's only question is whether there is room to begin.
- **No gate between merge success and the end of cleanup** — that boundary is atomic (Phase 8).
- `--no-timer` disables every gate; nothing else changes — no anchor is written and no clock is read.

### Phase 1: Break the plan into PRs

9. **Slice the implementation units into PR-sized groups.** A PR slice is one or more consecutive implementation units that land together as one reviewable, independently-mergeable change.

   Group units into the same PR when they:
   - Would leave `main` broken if split (a caller and the function it calls; a migration and the code that reads the new column).
   - Are individually too small to review meaningfully (a one-line config change plus the flag that reads it).
   - Share the same test file and would produce conflicting edits to it as separate PRs.

   Split units into separate PRs when they:
   - Touch unrelated areas of the codebase.
   - Have a clean dependency boundary — the later one only needs the earlier one *merged*, not in-flight.
   - Would together exceed roughly 400 changed lines, or span more than ~6 files, without a reason to be atomic.

   **Every slice must leave `main` green and coherent on its own.** This is the hard constraint; the size heuristics bend to it.

10. **Order the slices** by dependency. Serial execution is the contract: slice N is fully merged before slice N+1 starts, so each build subagent branches off a `main` that already contains every prior slice. Where the plan's units have no dependency between them, order by risk — foundational and schema-touching work first, leaf features last.

11. **Name each slice.** Derive a conventional-commit type (`feat`, `fix`, `refactor`, `chore`, `docs`, `test`) and a short kebab-case description. These become the branch name and PR title.

12. **Write the `## PR Breakdown` table into the plan document.** Insert it immediately after the `## Overview` section (create the section if the plan lacks one; never displace `Implementation Units`). If a `## PR Breakdown` table already exists, this is a **resume** — go to Phase 2 instead of overwriting it.

    ```markdown
    ## PR Breakdown

    <!-- maintained by /grind — status values: pending | building | testing | reviewing | addressing | merging | merged | blocked -->

    | # | Slice | Units | Branch | PR | Status | Notes |
    |---|-------|-------|--------|----|--------|-------|
    | 1 | Add token refresh to auth middleware | 1, 2 | `feat/57/token-refresh` | — | pending | — |
    | 2 | Wire refresh into the client SDK | 3 | `feat/57/client-refresh` | — | pending | — |
    ```

    The `PR` column holds the PR number as a link once opened. `Notes` holds one short clause — the review verdict, the reason a slice is blocked, or `stopped by timer at <phase>` when the timer ended the run there (the `Status` value itself stays at the in-flight phase; **stopped is not blocked**).

13. **Confirm the breakdown** with `AskUserQuestion` — the only confirmation in the run. Show the full table in a `preview` on the first option, and state the slice count plainly in the question text.
    - **Grind it** — proceed. Everything after this point is unattended through to merge.
    - **Revise** — the user supplies free-form adjustments (merge slices, split one, reorder). Rewrite the table and re-confirm.
    - **Cancel** — stop. Leave the table in the plan doc so the breakdown isn't lost.

14. **Stamp the breakdown on the issue.** Compose the body, write it to a temp file with the Write tool, and post per [the issue-log spec](../issue-log/SKILL.md):

    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"grind-started","paths":["<plan file path>"],"slices":<count>} -->

    ### ⚙️ /grind — grinding <count> PRs

    **Plan:** <plan file path>
    **Started:** <YYYY-MM-DD HH:MM local>
    **Session:** `claude --resume <session-id>`
    **Slices:** <one line per slice: "N. <slice name> — units <list>">
    ```
    ```bash
    gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>
    ```

### Phase 2: The per-slice loop and resume

For each slice in order, run Phases 3 through 8, checking the timer's budget gate before each phase. Do not start slice N+1 until slice N is **merged**. On any halt condition, stop the whole run per Phase 9; on a failed budget gate, stop per Phase 10.

On a **resume** (a `## PR Breakdown` table already existed), reconcile each row against reality before entering the loop — never trust the table over GitHub or the disk. Read, in order, and re-enter at the deepest completed checkpoint:

- **Row `merged`, or any in-flight row whose PR is `MERGED`** (`gh pr view <N> --json state,mergedAt`): confirm cleanup actually finished — worktree removed, local default branch moved forward, plan checkboxes checked, `pr-merged` stamp posted. Complete whatever is missing (a duplicate stamp is harmless — the reader dedupes), set the row `merged`, move on.
- **Row `blocked`:** re-check only the *objective gate* that blocked it — is CI green now? is the merge conflict gone? If the gate has cleared, continue the slice from the phase that halted; if not, re-halt with the same stamp. A blocked row never silently restarts from scratch.
- **Row `building`:** a building row never has a PR — grind opens it after the test phase, so the PR's absence distinguishes nothing and the unit stamps are the evidence. Check for the worktree on disk, the remote branch, and `unit-complete` stamps on the issue (`gh api repos/{owner}/{repo}/issues/{n}/comments --paginate`) — counting only stamps whose marker `paths` includes **this plan's file path**, per the reader contract in [the issue-log spec](../issue-log/SKILL.md); a stamp from another plan or an earlier run against the same issue is not evidence about this slice. If partial build state exists, dispatch the build subagent to **continue from the first unfinished unit in the existing worktree** — never recreate the worktree, never redo stamped units, and continue the slice's existing work doc per [the work-protocol spec's resume](../work-protocol/SKILL.md#resume) rather than creating a second one. When every unit is already stamped, the build finished and only step 18 remains: run it from the persisted raw return. If nothing exists, build from scratch.
- **Row `testing`:** first look for this slice's work doc — [the work-protocol spec's resume](../work-protocol/SKILL.md#resume) says which doc — at `status: complete`. Missing or still `in-progress` → step 18's work-doc pass never finished: run it first, from `docs/work/.raw/<slug>/build.md` when that file exists. Without it, take each committed unit's range from `git log <base>..origin/<branch>` yourself (never passing messages to the observer), fill every `Reason:` with `none given`, and report no stale tests — the blast-radius lens still finds its own. Then enter the tests per [the spec's resume section](../test-protocol/SKILL.md#where-a-run-enters) — at the lenses when no `docs/tests/*.md` document's `target:` matches this branch, at the writer when one does. A `tests-run` stamp on the issue means the phase completed and the run belongs at the PR open **only when its marker carries both this plan's file path in `paths` and this slice's branch in `branch`** — every slice of one plan writes the same `paths`, so the plan path alone would let slice 1's stamp answer for slice 2 and send it to the PR open with no tests.
- **Row `reviewing` or `addressing`:** walk the checkpoint ladder —
  1. A review doc in `docs/reviews/` passes **step 35's verification for this PR** — frontmatter `target:` matches this PR/branch and `date:` is current, plus the structural greps → the review ran; **never re-dispatch the fleet** (one review pass per PR). A doc that fails any of those checks is a leftover from an earlier attempt, not this slice's review: ignore it.
  2. **Every** `### P<X>-<N>:` heading in the doc carries a non-`open` `Status:` → triage completed. Checking that *some* finding is triaged is not enough: step 40 writes one finding at a time, so a kill mid-loop leaves a mixed doc, and treating it as complete drops every finding the loop never reached — they stay `open`, are never fixed, and never appear in step 44's comment, which is built from terminal statuses only. If any finding is still `open`, triage was interrupted: re-enter step 39 on those findings alone, skipping every finding that already carries a `**Grind:**` signature, then continue down this ladder. Once triage is complete: if **no** finding is accepted (every one `wont-fix` or `deferred`), no fix agent was ever dispatched and none is owed — mirror step 41 and go straight to Phase 8. Otherwise re-derive the fix brief from the accepted (`in-progress`) findings.
  3. The PR shows fix commits after the verdict comment (`gh pr view <N> --json commits,comments`) → fixes landed; proceed to the outcome comment / merge.
  Re-enter at the first checkpoint that is missing.

### Phase 3: Build the PR

15. **Budget gate** (build, 30m), then **update the row** to `building` in the plan doc.

16. **Create the worktree.** Follow the same convention as `/tree` — branch `{prefix}/{issue}/{short-description}` (drop the `{issue}` segment when there's no linked issue), worktree at `../{repo-name}-worktrees/{branch-name}/`:
    ```bash
    git fetch origin <default-branch>
    git worktree add -b <branch-name> ../<repo>-worktrees/<branch-name> origin/<default-branch>
    ```
    Branching off `origin/<default-branch>` is what makes serial execution work: slice N+1's worktree contains slice N's merged code. Then symlink `docs/` from the primary checkout into the worktree (as `/tree` does), since it's gitignored and the plan lives there.

    Then **create the slice's work doc** per [the work-protocol spec](../work-protocol/SKILL.md#the-document) — its filename, frontmatter, four sections, and empty-section placeholders are the spec's. Grind's values: `target:` is this slice's branch, `slice:` is its row number, and `base:` is `git -C <worktree> rev-parse HEAD` now. Seed `## Decisions` per [the spec's lifecycle](../work-protocol/SKILL.md#lifecycle). One doc per slice; a resume continues it and never creates a second.

17. **Dispatch the build subagent** — `Agent` with `model: "opus"` and `subagent_type: "general-purpose"`. Dispatch is asynchronous: wait for the subagent's completion notification before doing anything else, since there is nothing to interleave in a serial run. Subagents are never clocked — the phase budget gated the *start*, and once dispatched the agent runs to completion. The next clock reading happens at the following gate, on real elapsed time, whatever that turns out to be.

    The brief must contain, and nothing may be left implicit:
    - The absolute worktree path, and the instruction to do **all** work there — never in the primary checkout.
    - The absolute plan file path, for full context.
    - The verbatim text of every implementation unit in this slice: Goal, Requirements, Files, Approach, Execution note, Patterns to follow, Verification.
    - The instruction to ignore any `Test scenarios` field left by an older plan; this run writes no tests.
    - Any `Deferred to Implementation` questions bearing on these units, plus the plan's `Scope Boundaries` as explicit non-goals.
    - The instruction never to edit the plan file; grind owns it.
    - The instruction to follow the repo's `CLAUDE.md` conventions.
    - **The per-unit cadence:** implement the slice's units in plan order. After each unit: stage only that unit's files, commit with a scoped conventional message (`/work`'s incremental-commit heuristics), **push**, and post the unit's issue stamp. The push is the point — a killed process must never cost more than the unit in flight.
    - **The embedded stamp templates**, fully filled: the `unit-complete` and `unit-blocked` blocks below with `<issue>`, the repo, and the plan path substituted, plus these three posting rules verbatim (the agent does not read the spec): write the body to a temp file and post with `gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>`; the marker line must never contain `--` — replace every occurrence in serialized titles (`---` → `- - -`); a failed or skipped stamp is one report line, never a stop. Skip all stamps when `<issue>` is empty.

      ```markdown
      <!-- cc-forge-log v1: {"skill":"grind","event":"unit-complete","unit":"<ordinal>: <title from plan checkbox heading>","paths":["<plan file path>"]} -->

      ### 🔨 /grind — unit <ordinal>: <title>

      **Did:** <one-liner: what the unit delivered>
      **Solved:** <one-liner: the problem solved — omit this line when none>
      ```

      ```markdown
      <!-- cc-forge-log v1: {"skill":"grind","event":"unit-blocked","unit":"<ordinal>: <title from plan checkbox heading>","paths":["<plan file path>"]} -->

      ### ⚠️ /grind — unit <ordinal> blocked: <title>

      **Blocked:** <one-liner: what gates the unit>
      ```
      When concrete refs gate the blocked unit, add `"blocked_by":["<owner>/<repo>#<n>"]` to its marker; drop the key otherwise (same rule as `/work`'s stamp).
    - **The blocked-unit rule:** a unit it cannot complete stops the build — post the `unit-blocked` stamp, push what is committed, and return the partial state (which units landed, what blocked, the branch name). A partial-slice PR would violate "every slice leaves `main` green," and grind opens no PR for a slice that halted here.
    - **Its deliverable:** commits on the branch, pushed per unit, and **no PR** — grind opens the PR itself after the test phase, so exactly one `pull_request` CI run fires, on the code and its tests together. It must not open or merge a PR, must not touch `main`, must not `git add -A`, must not `--no-verify`, and must not create a worktree of its own.
    - **Its return value:** the branch name, a one-line summary, and per unit: its status; its commit range as `<base>..<head>` SHAs; what changed per file, one line each; any deviation from the unit's Approach with its reason; decisions made and patterns established; and **stale tests** — existing tests the unit may have made stale, each as its path (optionally `::<test name>`) plus one sentence on why, found by grepping the test directories for the symbols and modules the unit changed, renamed, or removed and then judging each hit, erring broad. A unit it could not complete carries the reason instead of a range.

18. **Persist, verify, and record the slice.** Before reading anything out of the return, write it verbatim to `docs/work/.raw/<slug>/build.md` per [the work-protocol spec's resume](../work-protocol/SKILL.md#resume) (`<slug>` is the doc's).

    **Verify the subagent's claim.** Never take the return value on faith — confirm the remote branch holds the per-unit commits (`git -C <worktree> log origin/<branch> --oneline`), that every returned range resolves in that log, and that the returned per-unit statuses account for every unit in the slice. There is no PR to check yet; grind opens it in Phase 5. If the pushed commits do not cover the slice's units: if the agent reported a blocked unit, mark the row `blocked` with the reason and halt per Phase 9 — after recording its committed units below, with no wrap-up, so the doc stays `in-progress` for the resume; otherwise the build failed regardless of what the agent reported — same halt.

    **Record the slice's work doc**, per [the work-protocol spec](../work-protocol/SKILL.md), recorded one unit at a time in plan order:
    - Dispatch `forge:workflow:scope-observer` in [`unit` mode](../work-protocol/SKILL.md#unit-mode) with the inputs the spec names — the absolute plan path, the ordinal, that unit's verified range, and the absolute worktree path as the working directory; grind's addenda list is always empty. The brief carries nothing from the build return — no summaries, deviations, reasons, or commit messages; [what the observer sees](../work-protocol/SKILL.md#what-the-observer-sees) says where grind's wall is only instructed. The per-unit dispatches may go in one parallel batch; record them in plan order.
    - Update the doc per [the spec's lifecycle](../work-protocol/SKILL.md#lifecycle), from the persisted return: Changes from git and the per-file lines, the stale tests into Tests to Revisit, Decisions from the returned decisions, the observer's cards numbered and their `Reason:` filled per [the spec's `Reason:` rule](../work-protocol/SKILL.md#reason) — including a card for every returned deviation the observer missed — and the unit's [observed marker](../work-protocol/SKILL.md#the-observed-marker). A failed dispatch follows [the spec's failure rule](../work-protocol/SKILL.md#failure); it never blocks the slice.
    - Then dispatch the observer once in [`wrap-up` mode](../work-protocol/SKILL.md#wrap-up-mode) over the slice's committed units, with the same working directory; record its cards and marker, set `status: complete`, and delete `docs/work/.raw/<slug>/`.

    **Every card stays `open`** — grind acts on none of them and never uses [the reply verbs](../work-protocol/SKILL.md#reply-verbs). Its open `D1` cards are input to step 47's final look.

### Phase 4: Write the tests

The build subagent wrote none. This phase mirrors `/test-plan` and `/test-plan-run auto` inline, between the last build unit and the PR open, and it is governed entirely by [the test-protocol spec](../test-protocol/SKILL.md) — the roster, what each lens may see, the keep and drop rules, the revise bucket, the scratch contract, the count check, document verification, the assurance filters, and the receipts all live there and are **cited, never restated**. A rule that reads differently here than it does in the spec is a bug in this file.

**There is no document-review step.** `/test-plan` stops so a human can read the document; an unattended run has no one to stop for, so grind produces the document and consumes it in the same phase. Because of that, it may carry the surface digest, the test conventions, and the live-service markers it derived in step 20 forward into the writer and the filters rather than re-deriving them — the tree has not moved between them.

19. **Budget gate** (test, 25m), then **update the row** to `testing` in the plan doc.

20. **Resolve the run's context, in the worktree.** The branch is the document's `target:` and the unsanitized slug. Resolve the intent by [the spec's spec-lens input ladder](../test-protocol/SKILL.md#spec-lens-input-ladder) over this slice's plan units — bounded to those units per [the brief-is-bounded rule](../test-protocol/SKILL.md#the-brief-is-bounded), never the whole plan. The ladder's last rung is a stop for `/test-plan`; here it is a **skip**: with nothing describing the intended behavior, note it, post no `tests-run` stamp, and go to Phase 5 — an unattended run does not halt a merged-ready slice over a missing intent source.

    Then build the surface digest and discover the test conventions the way `/test-plan` builds them — [its step 3](../test-plan/SKILL.md) owns the per-language extraction and [its step 4](../test-plan/SKILL.md) owns the conventions pass (test directories, runner, live-service markers, existing test file names), with [the spec](../test-protocol/SKILL.md#the-surface-digest) owning what each file class contributes and the empty-digest case. No runner and no test directory → the synthesizer tags zero cases `auto`, so this phase writes nothing; note it and go to Phase 5.

21. **Dispatch the three lenses** in one parallel batch, per [the spec's three lenses](../test-protocol/SKILL.md#the-three-lenses), from [the spec's roster](../test-protocol/SKILL.md#the-roster) — never add, substitute, or skip one, and never re-enumerate them here. The briefs are the three lens `Task forge:test-plan:<agent>(...)` blocks in [`/test-plan`'s step 5](../test-plan/SKILL.md) — the synthesizer's is step 22's; pass exactly the values each lens's `## Inputs` section names. The blast-radius lens's work doc is this slice's, created in step 16 — grind knows its path and needs no discovery; [the work-protocol spec's readers rule](../work-protocol/SKILL.md#readers) says which lens receives it and which never does. Never tell a lens to "read X" in place of putting X in its brief. Handle an empty or failed lens by [the spec's lens-failure posture](../test-protocol/SKILL.md#lens-failure-posture) — partial coverage proceeds and names the lens; all three empty writes no document, which is a note and a jump to Phase 5, not a halt.

22. **Persist and synthesize.** Write each lens's raw output per [the spec's raw scratch contract](../test-protocol/SKILL.md#the-raw-scratch-contract) **before** dispatching, then [dispatch the synthesizer](../test-protocol/SKILL.md#dispatching-the-synthesizer) with the values its `## Inputs` section names. The worktree's `docs/` is a symlink, so `docs/tests/.raw/<slug>/` lands in the primary checkout and survives anything short of disk loss — the same property Phase 6's review scratch relies on. Run [the count check](../test-protocol/SKILL.md#the-count-check) on what comes back, summing the raw total the way [`/test-plan`'s step 6](../test-plan/SKILL.md) does — the blast-radius lens's `Revise:` line included — then follow [the spec's verification section](../test-protocol/SKILL.md#verifying-the-document), which owns the structural and freshness checks and gates the scratch deletion on them. A failed dispatch or a failed check goes to [the spec's inline fallback](../test-protocol/SKILL.md#inline-fallback).

23. **Dispatch the writer** — `forge:test-plan:test-writer` — with exactly the five values its [`## Inputs` section](../../agents/test-plan/test-writer.md) names: the selected `auto` cases verbatim (a within-file `delete` `V-NNN` case with its `**Target test:**`), the surface digest, the repo's test conventions, **the test directories it may read named explicitly**, and the existing fixture names. Select the cases by [the spec's re-run semantics](../test-protocol/SKILL.md#what-a-re-run-does), grepping the test directories for each case's `T-NNN` ID: a `T-NNN` case whose ID is already in a test file on disk is re-verified, never rewritten, and a `V-NNN` case is selected by that section's revise line. Zero `auto` cases is success per [the spec](../test-protocol/SKILL.md#zero-cases-in-a-mode-is-success) — note it and go to step 26.

    **Before the writer, run the revise cases' own steps** per [executing revise cases](../test-protocol/SKILL.md#executing-revise-cases), starting with the unreviewed-run conversion in [the revise bucket](../test-protocol/SKILL.md#the-revise-bucket) — this phase has no doc-review step, so every `delete` whose `**Why:**` cites neither removed code nor a plan Requirement or unit becomes `regression`. Then [the gate](../test-protocol/SKILL.md#the-gate) on every selected `V-NNN` case (a `regression` or a gate pass is recorded then and never reaches the writer), and every whole-file [delete](../test-protocol/SKILL.md#delete) yourself. After the writer returns, confirm each within-file delete — restoring any that fails — per that section.

24. **Run the assurance filters yourself** — [the spec's filters](../test-protocol/SKILL.md#the-assurance-filters) own the three steps, their order, the collect-failure classification and its [one fix round](../test-protocol/SKILL.md#classifying-a-collect-failure-and-the-one-fix-round), and [the live-service rule](../test-protocol/SKILL.md#live-service-tests); the rerun count and the wall clock are the optional `cc-forge.local.md` keys in [the spec's prerequisites](../test-protocol/SKILL.md#prerequisites), which state their defaults. The writer holds no `Bash` and runs nothing; grind runs every command. Only the new tests are run — never the suite. **Re-read the clock between tests**, not only at the phase gate, per [the spec's time limits](../test-protocol/SKILL.md#time-limits); grind's own phase budget running out mid-loop is handled exactly as `test_run_timeout` expiring, and that section owns what happens to every test not yet decided — including the `discarded — slow` and `discarded — timeout` IDs the report names.

    **When a second failure deletes a test and the writer's fix round said it believes the code under test is wrong, carry that sentence verbatim** into the `tests-run` stamp and into the halt or final report. A discarded test whose author thought the code was broken is the most useful line in the run, and an unattended run that swallows it ships the bug.

    Record the outcome per case in the document — a `Status:` from [the spec's five](../test-protocol/SKILL.md#the-five-status-values) and a `**Filter:**` line in [its grammar](../test-protocol/SKILL.md#the-filter-line) directly under it — and append this run's block to `## Receipts` per [the receipts](../test-protocol/SKILL.md#the-receipts). **Append only**, and never the sentence "tests pass" on its own. Once every revise outcome is recorded, delete the snapshot per [delete](../test-protocol/SKILL.md#delete).

25. **Commit the kept tests and push.** Stage by explicit path: one `git add -- <path>` per file carrying a kept new test or a within-file delete, and one `git rm --quiet -- <path>` per whole-file delete. **Check every path — deleted ones included — against the directory list passed to the writer in step 23 before staging it**. A path outside that list is never staged: delete the file (restore it with `git -C <worktree> checkout HEAD -- <path>` when the run deleted it), name it and its case in the report, and halt the phase per Phase 9 — the writer's return is a claim about what it wrote, and this is the only place an unattended run can check it against what it was allowed to write. Then commit with a `test:` conventional message naming the slice, and push to the branch.

    **Verify the push landed**, the way step 18 verifies the build subagent's: `git -C <worktree> log origin/<branch> --oneline -1` must show the test commit. A push failure here is plausibly transient — a network blip, an expired token — so **retry once**. If the second push also fails, **halt per Phase 9 without posting the `tests-run` stamp**: the commits and the worktree are intact, the row stays `testing`, and a resumed run pushes them in seconds. Stamping an unpushed phase is what makes a later resume open the PR on code with no tests in it. Discarded tests are deleted, not committed. This is the push CI fires on once the PR opens in Phase 5 — the manual chain leaves the tests uncommitted for `/ship`, but nobody else will commit them in a grind run. Same prohibitions as everywhere: no `git add -A`, no `--no-verify`, no force-push, no push to `main`.

26. **Stamp the tests on the issue**, per [the spec's `tests-run` section](../test-protocol/SKILL.md#tests-run). Grind's marker carries no `scope` key — this phase runs `auto` only, and [the issue-log spec](../issue-log/SKILL.md) records that omission. Post it inside the phase, so an interruption after the tests are pushed leaves a durable marker to resume from. On partial coverage, name the lens that was empty or failed on the `**Lenses:**` line.
    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"tests-run","paths":["<plan file path>"],"branch":"<branch>"} -->

    ### 🧪 /grind — tests written and run

    **Doc:** `docs/tests/<filename>`
    **Scope:** auto
    **Result:** <n> pass / <n> fail / <n> blocked / <n> skip
    **Revised:** <n> deleted / <n> still valid / <n> regression
    **Receipts:** `<command>` → exit <code>, <n> passed
    **Discarded:** <n> (<case id: filter>, …)
    **Lenses:** <which contributed; any empty or failed>
    ```
    Write the body to a temp file and post with `gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>`; skip silently when `<issue>` is empty. **Every terminal outcome of this phase stamps**, including one that wrote nothing or found zero `auto` cases — except the two skips in step 20, where no run happened.

    **No next-steps block.** [The spec](../test-protocol/SKILL.md#the-next-steps-block) says grind's phase appends nothing; it continues to Phase 5.

### Phase 5: Open the PR

Grind opens the PR itself, after the tests are committed and pushed. Opening it before them would fire `pull_request` on code alone — a CI run that predates the tests it is meant to gate, polluting the check history Phase 8's merge watch reads — and then `synchronize` again when the tests land. Opening it here means **exactly one CI run, on the code and its tests together.** Phase 8's 20-minute CI watch is deliberately unchanged: the payload grew by the tests, the cap did not, and a suite that outgrows 20 minutes is a halt worth seeing.

27. **Open the PR and verify it.** Use the PR body format from [ship's pr-template.md](../ship/pr-template.md), **verbatim** — including the template's `Related to #<issue>` line when there's a linked issue. That line is the **only** issue reference a PR body may carry — never a GitHub closing keyword, which would auto-close the tracking issue mid-run; issue resolution rides the branch name. Then verify rather than trusting the create call: `gh pr view <N> --json number,state,url,headRefName`. **If no PR exists, or its `headRefName` doesn't match the branch, halt per Phase 9** with the row marked `blocked` — the open failed regardless of what the command printed.

28. **Post the `pr-created` stamp** (grind posts this one itself, after verification):
    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"pr-created","pr":<N>,"paths":["<plan file path>"]} -->

    ### 🚀 /grind — PR created

    **PR:** <pr-url>
    **Summary:** <one-line summary of the slice>
    ```

29. **Update the row** — PR number/link, status `reviewing`.

### Phase 6: Review the PR

30. **Budget gate** (review, 25m), then load the roster: read `cc-forge.local.md` in the project root — `review_agents` from its frontmatter, its markdown body as extra review context for every agent. No file → the default set: `forge:review:correctness-auditor`, `forge:review:reliability-engineer`, `forge:review:test-coverage-reviewer`, `forge:research:learnings-researcher`; add `forge:review:adversarial-reviewer` when the diff is ≥50 lines or touches shared state, concurrency, auth, or value-bearing operations; always add `forge:review:code-simplicity-reviewer`.

31. **Dispatch the fleet.** Parallel by default; run serially when 6+ agents are configured (note the switch in the run log — there is no user to inform). Each agent's brief: the PR diff via `gh pr diff <N>` (the review is of the PR, not a working tree), the verbatim plan units this PR implements, the repo's `CLAUDE.md` conventions as the house bar, and the return contract — a structured findings list (severity `P1`/`P2`/`P3`, file:line, one-sentence description) plus an overall verdict; an empty list is a valid result. A roster agent that fails or returns nothing: proceed with partial coverage and name it in the `pr-reviewed` stamp — a missing lens is reportable, not fatal.

32. **Persist raw findings** before synthesis: each agent's returned findings verbatim to `docs/reviews/.raw/<sanitized-slug>/<agent>.md` (slug from the branch name, the review protocol's sanitization: lowercase, non-`[a-z0-9-]` → `-`, collapse repeats). The worktree's `docs/` is a symlink, so these land in the primary checkout and survive anything short of disk loss.

33. **Dispatch `forge:review:review-synthesizer`** with every required input named in [the review-protocol spec](../review-protocol/SKILL.md#dispatching-the-synthesizer): the findings of every agent this run dispatched, PR metadata + the branch slug, the protected-artifacts paths (`docs/brainstorms/*-requirements.md`, `docs/plans/*.md`, `docs/solutions/*.md`), the **absolute path of the primary checkout's** `docs/reviews/` directory, and today's date. Pass the `cc-forge.local.md` review context too when present; that input is optional and its absence never stops the synthesizer. It writes `docs/reviews/YYYY-MM-DD-NNN-<slug>-review.md` and returns the doc path, per-tier counts, and summary rows — or a clean-review marker.

34. **Clean review:** post a one-line PR comment ("Automated review found no issues — <n> agents, 0 findings"), post the `pr-reviewed` stamp with 0/0/0 counts, and jump to Phase 8.

35. **Verify the doc** rather than trusting the return: the path exists; it greps for `## Groups` and at least one `### P<X>-<N>:` with `**Status:**` below it; frontmatter `target:` matches this PR/branch and `date:` is today. On dispatch failure instead: a **model-pin rejection** (the model pinned in `review-synthesizer.md` is not allowlisted) is deterministic — never retry it; any other failure retries once. When no verified doc can be produced, degrade in order, never halting while raw findings exist on disk:
    1. **Inline synthesis:** read the raw findings from `.raw/<slug>/` and produce the review doc yourself, following the synthesizer's own rules file (`agents/review/review-synthesizer.md`, or `${CLAUDE_PLUGIN_ROOT}` copy) — then continue as verified, but flag `synthesized inline` in the stamp.
    2. **Raw fallback:** post the findings grouped by severity as the PR review comment, triage directly from the raw lists, and flag `degraded review — no doc` in the stamp.

36. **Post the review to the PR** — `gh pr review <N> --comment --body-file <temp-file>`: the doc's Summary table and Groups (or the degraded content), with the review-doc path referenced for full detail. Stay under the comment cap by truncating detail, never structure. Never `--approve`, never `--request-changes` — a blocking review state from a subagent can deadlock the unattended merge, and `/grind` owns the triage.

37. **Stamp the review on the issue:**
    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"pr-reviewed","pr":<N>,"paths":["<plan file path>"]} -->

    ### 🔍 /grind — PR #<N> reviewed

    **Findings:** <n> P1, <n> P2, <n> P3
    **Verdict:** <one line>
    **Coverage:** <"full roster" | "did not complete: <agents>" | "synthesized inline" | "degraded review — no doc">
    ```

38. **Delete this slice's scratch** — `rm -rf docs/reviews/.raw/<slug>/` — only after the PR comment posted and only on the verified-doc (or inline-synthesis) path. The raw fallback keeps its scratch; it *is* the record.

### Phase 7: Triage and address

39. **Budget gate** (triage + fix, 25m), then **triage the findings yourself** — from the review doc (from the raw lists only in the degraded case). This is `/grind`'s judgment call and it does not delegate it. For each finding decide **accept**, **reject**, or **defer**:

    **Accept is the default verdict.** A finding that is real and fixable within this slice's files gets accepted, whatever its priority — the fix agent is already being dispatched, and a small P3 costs nothing extra to fold in. Reject and defer are the exceptions and each needs a stated reason.

    | Verdict | Use when |
    |---------|----------|
    | **Accept** | The finding is correct and touchable from this slice's diff. All P1s that survive scrutiny are accepted — a real correctness or security bug is never deferred past merge. P2s and P3s are accepted too unless a reject or defer condition below actually applies. |
    | **Reject** | The reviewer misread the code, the "bug" is intentional per the plan, or the suggestion contradicts the plan's Key Technical Decisions or Scope Boundaries. Not for "low priority" or "nice to have" — those are accepts. |
    | **Defer** | The fix would touch units this slice does not own, or is large enough to need its own plan. "Outside this slice" means the code lives elsewhere — not merely that the finding is minor. |

    Read the actual code before accepting or rejecting a P1. A reviewer agent working from a diff can misjudge context the surrounding file makes obvious; equally, do not reject or defer a finding merely because acting on it is inconvenient. When a verdict is genuinely borderline, accept it.

40. **Record the triage durably, then announce it — both before any fix is dispatched:**
    - Write each verdict into the review doc as its `Status:` line, using `/review-walk`'s vocabulary: accepted → `in-progress`, rejected → `wont-fix` (with a `Skip reason:`), deferred → `deferred` (with a `Defer reason:`). Reason lines follow [`/review-walk`'s Skip reason format](../review-walk/SKILL.md), which owns the `<code> — <free text>` shape, the `Skip reason:` code list, and the neutralization rule — grind restates none of it, so a code added or renamed there applies here without a second edit. The `Defer reason:` codes are grind's own, because grind is their only writer (`/review-walk` files an issue on defer and records a `Tracking:` line instead): `bigger-than-scoped` (the real fix is larger than the finding describes), `blocked-on` (waits on another change, a migration, a release, or an external party), `needs-decision` (someone has to decide something first), `follow-up-pr` (real and wanted, but belongs in its own change). Writing the same codes the user writes is what lets a later analysis read grind's reasons and theirs on one axis.

      **On a P1, grind may use only a subset of those codes** — this restriction is grind's own, not part of the shared vocabulary, because step 39 forbids exactly what most of the codes say. Rejecting a P1 admits `misread` and `by-design` only; deferring one admits `bigger-than-scoped` only. Every other reject code is a cost or scope judgment step 39 reserves for a human, and the remaining defer codes describe waiting on someone an unattended run cannot wait for — a P1 carrying either is a P1 that merged unfixed. **A P1 that fits none of the admissible codes is accepted.** P2 and P3 take the full lists. The doc is now the durable triage record — a killed process resumes from these lines without re-reviewing.
    - **Sign every verdict.** Directly under each triaged finding's `Status:` line, before any reason line, write `**Grind:** <accepted | rejected | deferred | fixed> — <one line why>`. This is grind's counterpart to [`/review-sweep`'s `Sweep:` line](../review-sweep/SKILL.md), which owns the signature convention and why it exists. Triage writes one of the first three values; step 43 rewrites an accepted finding's line to `fixed` when the fix lands. Exactly one per finding, ever — always a rewrite, never a second line.
    - Post the verdicts as a PR comment: each finding as "**P<X>-<N> <title>** — accepted / rejected: <why> / deferred: <why>". A rejection's reason should survive someone reading the PR later.

41. **If nothing was accepted**, the verdict comment already records the outcome — go to Phase 8.

42. **If anything was accepted**, set the row to `addressing` and **dispatch the fix subagent** — `Agent` with `model: "opus"` and `subagent_type: "general-purpose"`. Wait for its completion notification before proceeding.

    The brief:
    - The absolute worktree path — the branch is still checked out there.
    - The accepted findings verbatim, each with its file:line, and explicitly **only** those. Rejected and deferred findings must not appear in the brief at all; a fix agent handed the full list will quietly fix everything.
    - The instruction to commit and push to the PR branch when done, and to leave the test suite green.
    - The same prohibitions as the build agent: no merge, no `main`, no `git add -A`, no `--no-verify`, no force-push.
    - **Its return value:** what it changed per finding, and any finding it could not address with the reason.

43. **Verify the fixes landed** — `git -C <worktree> log origin/<branch>..HEAD` should be empty (everything pushed) and `gh pr view <N> --json commits` should show the new commits. If the agent reported success but nothing was pushed, retry once with a brief noting exactly what was missing; if the retry also fails, mark the row `blocked` and halt. On success, flip each fixed finding's `Status:` to `done` in the review doc **and rewrite its `**Grind:**` line to `**Grind:** fixed — <one line what changed>`** in the same edit — replacing the `accepted` line, not appending to it. A `done` finding still claiming `accepted` records a verdict where it should record an outcome, and says nothing about what landed.

44. **Report the outcomes on the PR** — `/review-push`'s comment shape, built from the doc's `Status:` lines:
    ```markdown
    ## Review pass — <N> fixed, <M> deferred, <K> skipped

    ### Fixed
    - **P1-2 <title>** — <one-line what-changed> (`<file>`)

    ### Deferred
    - **P2-1 <title>** — <defer reason> (`<file>`)

    ### Skipped (won't fix)
    - **P3-4 <title>** — <skip reason> (`<file>`)
    ```
    Omit empty sections. Describe fixes in plain what-changed terms drawn from the fix agent's report and the diff, not the reviewer's problem statement.

45. **Never file a GitHub issue for a deferred finding.** Deferred findings live in the review doc's `Status: deferred` lines and in the PR comment from step 44 — that is the whole record. Do not call `/side-quest`, do not open a tracking issue, do not create one at the end of the run. Surfacing them in the final report (Phase 11, step 46) is how the user learns about them and decides what to file.

46. **Do not re-review.** One review pass per PR. Reviewing the fixes with a fresh fleet invites an unbounded loop; the final look in Phase 8 is the backstop.

### Phase 8: Look, verify, merge

47. **Budget gate** (merge, 25m), then **give the PR a final look.** This is not a review — it's the check a person does before hitting merge. Read `gh pr diff <N>` end to end and confirm:
    - The diff does what the slice's units said it would. Their `Verification` lines were already checked by step 18's wrap-up; what reaches this look is the slice doc's `open` `D1` cards — read each one as input, and a card the diff confirms is a real gap fails the look like any other miss. **Never change a card's `Status:`** — every card stays `open`.
    - Nothing accepted in Phase 7 is still unfixed.
    - No debugging leftovers, no commented-out blocks, no stray files, no secrets.
    - The change is confined to the slice's scope — nothing from a later slice snuck in.

    **If the look fails**, mark the row `blocked` with the reason and halt. Do not dispatch another fix round — two failed passes on the same PR means the slice needs a human.

48. **Set the row to `merging`, then wait on CI** — `gh pr checks <N> --watch`. If `gh` lacks `--watch`, poll every 30s capped at 20 minutes, then halt if unresolved.
    - **"No checks reported"** means the repo has no CI on this branch — the local suite becomes the gate: run the test command detected in Phase 0 in the worktree; red halts. (If Phase 0 found no test command either, note in the final report that this slice merged ungated.)
    - **When checks exist, `/grind` runs nothing locally** — the suite already ran in CI; running it twice buys nothing and, on expensive suites, costs real money.

49. **Red CI halts the run.** No fix rounds, no re-pushes, and never a masked failure — deleting a failing test, loosening an assertion, adding a skip, or bumping a timeout to force green is prohibited; CI is the only automated gate protecting an unattended merge. The Autonomy Contract's one carve-out — a `delete` of a `V-` case recorded in the verified test document before the PR opens is not masking — never reaches this step. Mark the row `blocked` with the failing check named in `Notes`, pull the failing log (`gh run view <run-id> --log-failed`) into the halt report, and halt per Phase 9.

50. **Merge** — `gh pr merge <N> --squash --delete-branch`. **Verify it actually merged** (`gh pr view <N> --json state,mergedAt`); a failed merge (branch protection, required reviews, conflicts) is a halt, not a retry. Required-reviews protection in particular means the repo does not permit unattended merges — say that plainly rather than trying to work around it.

51. **Clean up — atomically with the merge.** No budget gate, no stop, and no interruption point between merge success and the end of this step; a resume that finds a merged PR with any of this missing completes it (Phase 2). From the primary checkout: `git worktree remove ../<repo>-worktrees/<branch-name>`, `git fetch origin <default-branch>:<default-branch>` (the fetch form — other worktrees may hold the branch), check the plan's implementation-unit checkboxes for the slice, update the row to `merged`, and stamp:
    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"pr-merged","pr":<N>,"paths":["<plan file path>"]} -->

    ### ✅ /grind — PR #<N> merged (slice <i> of <count>)

    **Slice:** <slice name>
    **Landed:** <one to two sentences on what shipped>
    ```
    Then move to the next slice.

### Phase 9: Halting (blocked — needs a human)

52. **Halting stops the entire run, not just the slice.** Later slices are built on the assumption that earlier ones merged; continuing past a blocked slice produces PRs that don't apply. Never skip ahead.

    On halt:
    - Set the row to `blocked` with a one-clause reason in `Notes`.
    - Leave the PR (when one was opened) **open** and the worktree **in place** — both are the user's material for taking over.
    - Set every remaining row's `Notes` to `not started`.
    - Stamp the issue. A halt in the build, test, or PR-open phase fires **before any PR exists** — grind opens the PR in Phase 5, after the tests — so the stamp branches on whether there is a PR — never invent a number or url for one that was never opened:
      ```markdown
      <!-- cc-forge-log v1: {"skill":"grind","event":"grind-blocked","pr":<N>,"paths":["<plan file path>"]} -->

      ### 🛑 /grind — halted at slice <i> of <count>

      **Blocked:** <what stopped it>
      **PR:** <url> (open)
      **Worktree:** <absolute path>
      **Remaining:** <count> slices not started
      ```
      With no PR, drop the `pr` key from the marker and the `**PR:**` line from the body, and say where the work actually is:
      ```markdown
      <!-- cc-forge-log v1: {"skill":"grind","event":"grind-blocked","paths":["<plan file path>"]} -->

      ### 🛑 /grind — halted at slice <i> of <count>

      **Blocked:** <what stopped it>
      **Branch:** `<branch-name>` (pushed, no PR — <n> of <m> units built)
      **Worktree:** <absolute path>
      **Remaining:** <count> slices not started
      ```
    - Send the notification (see Notification below).
    - Report to the user: what merged, what's open and where, what the failure was with the real output, and the concrete next step.

    **Blocked is not stopped.** Blocked means the run cannot proceed without a human (red CI, failed look, blocked unit, failed merge). A timer stop (Phase 10) is a healthy run out of clock — resume continues it; a blocked run waits for you.

### Phase 10: Timer stop (healthy — resume continues)

44. When a budget gate fails, end the run cleanly, **durable writes first, email last**:
    1. **Plan table:** the current row keeps its in-flight status; write `stopped by timer at <phase>` into its `Notes`.
    2. **Stamp the issue:**
       ```markdown
       <!-- cc-forge-log v1: {"skill":"grind","event":"grind-stopped","paths":["<plan file path>"]} -->

       ### ⏸️ /grind — stopped by timer at slice <i> of <count>

       **Stopped before:** <phase> of slice <i> (<slice name>)
       **Done so far:** <n> slices merged<, current slice state in one clause>
       **Remaining:** <what remains, one line>
       **Resume:** re-run `/grind <plan path>` — reconciliation picks up from here
       ```
    3. **Send the notification** — push always, email if configured, one attempt per channel (see Notification); never retry on a stop, the buffer is for exiting cleanly.
    4. Report the same summary to the terminal and exit.

### Phase 11: Report (complete)

45. When every slice is merged, set the plan's frontmatter `status: active` → `status: completed`.

46. Print the final table:

    | # | Slice | PR | Review findings | Result |
    |---|-------|----|-----------------|--------|
    | 1 | Add token refresh | [#61](url) | 1 P1, 2 P2 (1 deferred) | merged |

    Follow it with: total PRs merged, total commits, the deviations one-liner (see Notification), every deferred finding listed inline (title, reason, and the review doc it lives in — **not** filed as issues; the user decides what to file), any slice that merged ungated (no CI, no test command), and anything from the plan's `Requirements Trace` that no merged slice covers. That last one matters most — a plan can grind to completion with a requirement quietly unimplemented, and this is the only place it surfaces.

47. Stamp the run's completion, then send the notification:
    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"grind-complete","paths":["<plan file path>"],"merged":<count>} -->

    ### 🏁 /grind — plan complete

    **Plan:** <plan file path>
    **Merged:** <count> PRs — <comma-separated PR links>
    **Deferred findings:** <count, or "none"> — see the review docs; not filed as issues
    ```

### Notification

Every terminal outcome — `grind-complete`, `grind-stopped`, `grind-blocked` — notifies on **two independent channels** after its stamp is posted. The stamp is the durable record; the channels are the reach. They are not fallbacks for each other: push always fires, whether or not the email succeeded, because the two land in different places (terminal and phone vs. inbox) and an unattended run should reach whichever one you're near. A blocked run emails too — the process can be cut off before you ever see the terminal, and the inbox is what survives that.

- **Push — always.** Call `PushNotification` with a one-line message under 200 characters: outcome, plan title, the number that matters, and the deviation count alone — `N deviations across M slices`, no paths, which the email and terminal report carry (`grind complete: auth-refresh — 4 PRs merged, 3 deviations across 4 slices` / `grind stopped: auth-refresh — 2 of 5 slices, resume to continue` / `grind blocked: auth-refresh — red CI on #61`). No markdown. Fire it on every terminal outcome, including one where the email already went out, and including a timer stop. A skipped push (you're at the terminal, so it would be redundant) is a normal result, not a failure.
- **Email — when configured.** `SENDGRID_API_KEY` set → one `POST https://api.sendgrid.com/v3/mail/send` with a hard timeout (`curl --max-time 30`), the key passed only as an `Authorization: Bearer` header and the body via `--data @<file>`, so the key never lands in process listings and the body never lands in shell history. Unset, or the call fails → report one line, "couldn't send notification: <reason>", and continue. Exactly one attempt, never a retry, and never any retry during a timer stop.
- **From:** `hfritz@r-o.com` (name `Hagen Fritz`) — a verified SendGrid sender; an unverified `From:` is rejected with a 403. **Recipient:** hfritz@r-o.com. **Subject:** `[grind] <plan title>: <complete | stopped | blocked>`.
- **Body — the resume block is mandatory.** Every email, on every outcome, ends with both commands on their own lines, verbatim:

  ```
  claude --resume <session-id>
  /grind <plan path>
  ```

  `<session-id>` is the one captured in Phase 0 step 8. **Do not paraphrase, summarize, or drop these lines** — they are the reason the email exists, and an email that arrives without them has failed at its job even if it sent successfully. If Phase 0 exposed no session id, print the `claude --resume` line as `claude --resume <no session id captured>` rather than omitting it, so the gap is visible instead of silent. Above the resume block: the outcome in one sentence, the per-slice table (merged PRs as links), [the work-protocol spec's grind one-liner](../work-protocol/SKILL.md#terminal-one-liners) — `N deviations across M slices — see <paths>.` over every slice doc this run wrote — what remains (for stopped/blocked), and the blocking reason with its PR link (for blocked). The terminal report of every outcome carries the same one-liner. It appears nowhere else: never in a PR body, a PR comment, or a stamp.
- A notification failure on either channel is never fatal, never blocks the other channel, and never blocks the exit path it rides on.

## Rules

- **User-invoked only** — by slash command or plain-English ask ("grind this plan", "run the whole thing"), either one. Never start `/grind` on your own initiative, never from inside another skill, never wired to a git or CI hook, and never because a plan happens to look ready. An ambiguous or implied approval ("looks good to me") is not an ask — when in doubt, ask.
- **One confirmation, then unattended.** The PR breakdown is confirmed; nothing after it is. Do not add prompts mid-run, and do not silently degrade to asking — if the run can't proceed autonomously, halt and say why.
- **Serial.** Slice N is merged before slice N+1 starts. No parallel slices, no starting the next build while a PR is in review.
- **One worktree per PR**, created off `origin/<default-branch>`, removed on merge. `/grind` runs from the primary checkout and never checks out a feature branch there.
- **Halt, don't skip; stop, don't die.** A blocked slice stops the run for a human. A failed budget gate stops it for the clock — cleanly, at a phase boundary, resumable. The two are distinct states with distinct stamps.
- **Red CI halts.** `/grind` pushes no CI-fix commits and never masks a failure — no deleted tests, loosened assertions, skips, or timeout bumps. The one carve-out is the Autonomy Contract's: a `delete` of a `V-` case recorded in the verified test document before the PR opens is not masking; it never answers red CI. With CI present, no local suite runs; with no CI, the local suite is the gate.
- **Every durable write precedes the notification it announces.** Table note, then stamp, then one send attempt per channel.
- **Verify every subagent claim** against `gh` or `git` before acting on it. A returned "done" is a hypothesis.
- **The reviewer fleet posts comments, never `--approve` or `--request-changes`.** `/grind` owns the triage decision; a blocking review state from a subagent can deadlock the merge.
- **Triage is `/grind`'s own judgment**, never delegated, and it is recorded in the review doc's `Status:` lines and on the PR **before** the fix agent is dispatched. The fix agent receives accepted findings only.
- **One review pass per PR.** Synthesis failures degrade (inline synthesis, then raw findings) — they never halt the run while raw findings exist, and they never trigger a second fleet.
- **The test phase cites the spec and owns the tests.** Grind's mirrored phase runs the roster, the filters, and the writer defined in [the test-protocol spec](../test-protocol/SKILL.md) and restates none of them; the build subagent never writes a test or runs the suite, and a discarded test whose writer said the code under test is wrong is carried verbatim into the stamp and the report rather than dropped.
- **One work doc per slice, governed by [the work-protocol spec](../work-protocol/SKILL.md).** `forge:workflow:scope-observer` flags and never blocks; grind records every card `open`, acts on none, and restates none of the spec.
- **The timer is measured, never estimated.** Every gate reads the scratchpad anchor with a real `date` call and lets the shell do the arithmetic. Never judge elapsed time from how much work has happened — that guess is not an input to any gate. The anchor is per-invocation: the grind-started stamp's `**Started:**` line is log, not clock, and a resume writes a fresh anchor. A missing anchor means stop, not guess. No gate sits between merge success and the end of cleanup.
- **No force-push, no pushes to `main`, no `--no-verify`, no `git add -A`** — for `/grind` or any subagent it dispatches.
- **The plan doc is the state; GitHub and the review doc are the checkpoints.** Update the row at every transition; on resume, reconcile against `gh` and the disk rather than trusting the table.
- **Report the real outcome.** Only claim "merged" after `gh pr view` confirms it. Red is red.
