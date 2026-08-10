---
name: grind
description: "Execute an entire implementation plan autonomously as a sequence of PRs, mirroring the manual skill chain unattended: a max-effort Opus subagent builds each slice unit-by-unit (committing, pushing, and stamping the issue per unit) and opens a ship-conformant PR; the deep-review agent fleet reviews it; grind triages the findings itself, posts every verdict and outcome to the PR, dispatches a second Opus subagent for accepted fixes, and squash-merges on green CI — halting, never self-repairing, on red. A default-on lifetime timer stops the run cleanly before the VM's ~2-hour wall (--no-timer to disable), and every terminal outcome — complete, stopped, or blocked — always fires a push notification and emails when SendGrid is configured. Use when the user says 'grind this plan', 'grind it out', 'run the whole plan', 'build all the PRs', or invokes /grind."
argument-hint: "[plan file path] [--no-timer]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Agent, AskUserQuestion, PushNotification, TaskCreate, TaskUpdate, TaskList
---

# Grind — Autonomously Execute a Plan as a Sequence of PRs

**Note: The current year is 2026.**

`/grind` takes a plan document and drives it to fully merged `main`, one PR at a time, without stopping for approval between PRs. For each PR slice it: creates a worktree; dispatches a **max-effort Opus** subagent that implements the slice unit-by-unit — committing, **pushing**, and stamping the issue after every unit — and opens a ship-conformant PR; runs the **`/deep-review` agent fleet** over the PR and posts the review; **triages the findings itself**, records every verdict durably before acting on it, dispatches a second max-effort Opus subagent for accepted fixes and reports each finding's outcome on the PR; then squash-merges once CI is green and moves to the next slice.

Two run-level guards wrap the loop. A **lifetime timer** (default on) stops the run cleanly at a phase boundary before the VM's ~2-hour wall instead of letting the process be killed mid-write — the stop is a healthy, resumable state, not a failure. And every terminal outcome — **complete**, **stopped** (timer), or **blocked** (needs a human) — posts a final issue stamp and notifies on **two independent channels** — a push that always fires, plus an email when SendGrid is configured — so an unattended run never ends silently.

The plan document is the durable state. `/grind` writes a `## PR Breakdown` table into it and updates each row as the PR advances; the review doc, worktrees, and unpushed-nothing per-unit cadence mean every checkpoint also exists on GitHub or on disk. An interrupted run — stopped, blocked, or hard-killed — is resumed by re-invoking `/grind` on the same plan.

`/grind` is the autonomous sibling of `/work` → `/deep-review` → `/ship`. It does **not** call those skills (confirm-gated by design, they would deadlock an unattended run) or `/land` (click-free, but per-PR and human-invoked). It mirrors their processes instead — `/work`'s per-unit stamps and commit cadence, `/deep-review`'s roster and synthesizer, `/push-review`'s outcome reporting, `/ship`'s PR shape — so the issue thread and PR history of a grind run read identically to a manual run.

## Autonomy Contract

`/grind` runs unattended from the moment it starts building. Before it does, it gets **one** confirmation: the PR breakdown. After that it does not ask, and it will commit, push, and merge on its own judgment.

What that means, stated plainly:

1. **`/grind` merges without you.** Every merge in this skill is an unattended merge. It is gated on green CI and on `/grind`'s own final look — not on a human.
2. **`/grind` does not repair CI.** Red CI halts the run with the PR open. Where the old flow pushed up to three unattended fix commits, this one pushes none: an expensive CI suite is never re-triggered by autonomous guesswork, and masking a failure (deleting tests, loosening assertions, adding skips, bumping timeouts) is prohibited outright.
3. **The stop conditions are the safety net.** Because there is no human gate, the halt rules are load-bearing. When `/grind` cannot make progress on a PR, it **stops the entire run** and leaves the PR open — it never skips a blocked slice, since later slices assume earlier ones merged.
4. **The clock is part of the contract.** With the timer on, `/grind` will decline to start a phase it cannot finish before the stop threshold, and will end the run cleanly instead. `--no-timer` removes that guard for unbounded local runs.
5. **`/grind` never force-pushes, never pushes to `main`, never uses `--no-verify`, and never uses `git add -A`.** These do not become acceptable because the run is autonomous — for `/grind` or any subagent it dispatches.
6. **Interrupting is always safe.** State lives in the plan doc, the review doc, and on GitHub. Ctrl-C or a hard kill at any point leaves a world Phase 2's reconciliation can re-enter.

If the user has not opted into this by invoking `/grind`, do not run it. Never invoke `/grind` on your own initiative from another skill.

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
6. **Detect the test command** for the repo (`package.json` scripts, `Makefile`, `pytest.ini`, `Cargo.toml`, etc.). It is used in exactly one place: as the merge gate for a PR that reports **no CI checks** (Phase 6). When the repo has CI, `/grind` never runs the local suite itself — though build and fix subagents still leave it green.
7. **Detect the email transport** and announce the result. `SENDGRID_API_KEY` set in the environment → email is **on**; unset → warn now, up front: "No SENDGRID_API_KEY — terminal outcomes will be stamped and pushed, but not emailed." Either way `PushNotification` still fires, so a terminal outcome is never silent. The detection is a preflight signal; the send itself re-checks (see Notification).
8. **Start the clock** (unless `--no-timer`): record the current time in this session's working memory. The start time is **never persisted** — not to the plan doc, not to a file — so a resumed run on a fresh process starts a fresh clock.

### The Lifetime Timer

The VM's process lease is ~2 hours; the disk survives, the process does not. The timer's job is to ensure no phase is ever killed mid-write. It stops the run at the last phase boundary that leaves a 30-minute buffer.

- **Stop threshold:** 1h30m elapsed.
- **Budget gates:** before starting each phase of each slice, check elapsed time against that phase's minimum budget. If `elapsed > 1h30m − minimum`, do not start the phase — go to the stop flow (Phase 8).

| Phase | Minimum budget to start |
|-------|------------------------|
| Build | 45m |
| Review | 25m |
| Triage + fix | 25m |
| Merge | 25m (the CI watch alone is capped at 20m) |

- The budgets are directional defaults — tune them against observed runs, conservatively: a wrong-but-low gate costs an early stop, a wrong-but-high gate costs a mid-write kill.
- **No gate between merge success and the end of cleanup** — that boundary is atomic (Phase 6).
- `--no-timer` disables every gate; nothing else changes.

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

    <!-- maintained by /grind — status values: pending | building | reviewing | addressing | merging | merged | blocked -->

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
    **Slices:** <one line per slice: "N. <slice name> — units <list>">
    ```
    ```bash
    gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>
    ```

### Phase 2: The per-slice loop and resume

For each slice in order, run Phases 3 through 6, checking the timer's budget gate before each phase. Do not start slice N+1 until slice N is **merged**. On any halt condition, stop the whole run per Phase 7; on a failed budget gate, stop per Phase 8.

On a **resume** (a `## PR Breakdown` table already existed), reconcile each row against reality before entering the loop — never trust the table over GitHub or the disk. Read, in order, and re-enter at the deepest completed checkpoint:

- **Row `merged`, or any in-flight row whose PR is `MERGED`** (`gh pr view <N> --json state,mergedAt`): confirm cleanup actually finished — worktree removed, local default branch moved forward, plan checkboxes checked, `pr-merged` stamp posted. Complete whatever is missing (a duplicate stamp is harmless — the reader dedupes), set the row `merged`, move on.
- **Row `blocked`:** re-check only the *objective gate* that blocked it — is CI green now? is the merge conflict gone? If the gate has cleared, continue the slice from the phase that halted; if not, re-halt with the same stamp. A blocked row never silently restarts from scratch.
- **Row `building` with no PR:** check for the worktree on disk, the remote branch, and `unit-complete` stamps on the issue (`gh api repos/{owner}/{repo}/issues/{n}/comments --paginate`) — counting only stamps whose marker `paths` includes **this plan's file path**, per the reader contract in [the issue-log spec](../issue-log/SKILL.md); a stamp from another plan or an earlier run against the same issue is not evidence about this slice. If partial build state exists, dispatch the build subagent to **continue from the first unfinished unit in the existing worktree** — never recreate the worktree, never redo stamped units. If nothing exists, build from scratch.
- **Row `reviewing` or `addressing`:** walk the checkpoint ladder —
  1. A review doc in `docs/reviews/` passes **step 26's verification for this PR** — frontmatter `target:` matches this PR/branch and `date:` is current, plus the structural greps → the review ran; **never re-dispatch the fleet** (one review pass per PR). A doc that fails any of those checks is a leftover from an earlier attempt, not this slice's review: ignore it.
  2. The doc's issues carry `Status:` lines → triage happened. If **no** finding is accepted (every one `wont-fix` or `deferred`), no fix agent was ever dispatched and none is owed — mirror step 32 and go straight to Phase 6. Otherwise re-derive the fix brief from the accepted (`in-progress`) findings.
  3. The PR shows fix commits after the verdict comment (`gh pr view <N> --json commits,comments`) → fixes landed; proceed to the outcome comment / merge.
  Re-enter at the first checkpoint that is missing.

### Phase 3: Build the PR

15. **Budget gate** (build, 45m), then **update the row** to `building` in the plan doc.

16. **Create the worktree.** Follow the same convention as `/tree` — branch `{prefix}/{issue}/{short-description}` (drop the `{issue}` segment when there's no linked issue), worktree at `../{repo-name}-worktrees/{branch-name}/`:
    ```bash
    git fetch origin <default-branch>
    git worktree add -b <branch-name> ../<repo>-worktrees/<branch-name> origin/<default-branch>
    ```
    Branching off `origin/<default-branch>` is what makes serial execution work: slice N+1's worktree contains slice N's merged code. Then symlink `docs/` from the primary checkout into the worktree (as `/tree` does), since it's gitignored and the plan lives there.

17. **Dispatch the build subagent** — `Agent` with `model: "opus"`, `effort: "max"`, `subagent_type: "general-purpose"`, `run_in_background: false`. `/grind` blocks on it; there is nothing to interleave in a serial run. Budget gates cannot fire while it blocks, so the 30-minute buffer is what covers a dispatched agent overrunning its phase budget — an agent that outlasts that is malfunctioning, not slow.

    The brief must contain, and nothing may be left implicit:
    - The absolute worktree path, and the instruction to do **all** work there — never in the primary checkout.
    - The absolute plan file path, for full context.
    - The verbatim text of every implementation unit in this slice: Goal, Requirements, Files, Approach, Execution note, Patterns to follow, Test scenarios, Verification.
    - Any `Deferred to Implementation` questions bearing on these units, plus the plan's `Scope Boundaries` as explicit non-goals.
    - The repo's test command, and the instruction to leave the suite green.
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
    - **The blocked-unit rule:** a unit it cannot complete stops the build — post the `unit-blocked` stamp, push what is committed, open **no PR**, and return the partial state (which units landed, what blocked, the branch name). A partial-slice PR would violate "every slice leaves `main` green."
    - **Its deliverable:** commits on the branch, pushed per unit, with an open PR. It must not merge, must not touch `main`, must not `git add -A`, must not `--no-verify`, and must not create a worktree of its own.
    - The PR body format from [ship's pr-template.md](../ship/pr-template.md), used **verbatim** — including the template's `Related to #<issue>` line when there's a linked issue (never `Closes`: a multi-PR run must not auto-close the tracking issue mid-run; issue resolution rides the branch name).
    - **Its return value:** the PR number and URL, a one-line summary, per-unit status, and any unit it could not complete with the reason.

18. **Verify the subagent's claim.** Never take the return value on faith — `gh pr view <N> --json number,state,url,headRefName` in the worktree, and confirm the remote branch holds the per-unit commits (`git -C <worktree> log origin/<branch> --oneline`). If no PR exists, or its `headRefName` doesn't match the branch: if the agent reported a blocked unit, mark the row `blocked` with the reason and halt per Phase 7; otherwise the build failed regardless of what the agent reported — same halt.

19. **Post the `pr-created` stamp** (grind posts this one itself, after verification):
    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"pr-created","pr":<N>,"paths":["<plan file path>"]} -->

    ### 🚀 /grind — PR created

    **PR:** <pr-url>
    **Summary:** <one-line summary of the slice>
    ```

20. **Update the row** — PR number/link, status `reviewing`.

### Phase 4: Review the PR

21. **Budget gate** (review, 25m), then load the roster: read `cc-forge.local.md` in the project root — `review_agents` from its frontmatter, its markdown body as extra review context for every agent. No file → the default set: `cc-forge:review:correctness-auditor`, `cc-forge:review:reliability-engineer`, `cc-forge:review:test-coverage-reviewer`, `cc-forge:research:learnings-researcher`; add `cc-forge:review:adversarial-reviewer` when the diff is ≥50 lines or touches shared state, concurrency, auth, or value-bearing operations; always add `cc-forge:review:code-simplicity-reviewer`.

22. **Dispatch the fleet.** Parallel by default; run serially when 6+ agents are configured (note the switch in the run log — there is no user to inform). Each agent's brief: the PR diff via `gh pr diff <N>` (the review is of the PR, not a working tree), the verbatim plan units this PR implements, the repo's `CLAUDE.md` conventions as the house bar, and the return contract — a structured findings list (severity `P1`/`P2`/`P3`, file:line, one-sentence description) plus an overall verdict; an empty list is a valid result. A roster agent that fails or returns nothing: proceed with partial coverage and name it in the `pr-reviewed` stamp — a missing lens is reportable, not fatal.

23. **Persist raw findings** before synthesis: each agent's returned findings verbatim to `docs/reviews/.raw/<sanitized-slug>/<agent>.md` (slug from the branch name, deep-review's sanitization: lowercase, non-`[a-z0-9-]` → `-`, collapse repeats). The worktree's `docs/` is a symlink, so these land in the primary checkout and survive anything short of disk loss.

24. **Dispatch `cc-forge:review:review-synthesizer`** with all seven of its required inputs: every agent's findings verbatim (including code-simplicity-reviewer), the learnings-researcher report, PR metadata + the branch slug, the protected-artifacts paths (`docs/brainstorms/*-requirements.md`, `docs/plans/*.md`, `docs/solutions/*.md`), the `cc-forge.local.md` review context when present, the **absolute path of the primary checkout's** `docs/reviews/` directory, and today's date. It writes `docs/reviews/YYYY-MM-DD-NNN-<slug>-review.md` and returns the doc path, per-tier counts, and summary rows — or a clean-review marker.

25. **Clean review:** post a one-line PR comment ("Automated review found no issues — <n> agents, 0 findings"), post the `pr-reviewed` stamp with 0/0/0 counts, and jump to Phase 6.

26. **Verify the doc** rather than trusting the return: the path exists; it greps for `## Groups` and at least one `### P<X>-<N>:` with `**Status:**` below it; frontmatter `target:` matches this PR/branch and `date:` is today. On dispatch failure instead: a **model-pin rejection** (the model pinned in `review-synthesizer.md` is not allowlisted) is deterministic — never retry it; any other failure retries once. When no verified doc can be produced, degrade in order, never halting while raw findings exist on disk:
    1. **Inline synthesis:** read the raw findings from `.raw/<slug>/` and produce the review doc yourself, following the synthesizer's own rules file (`agents/review/review-synthesizer.md`, or `${CLAUDE_PLUGIN_ROOT}` copy) — then continue as verified, but flag `synthesized inline` in the stamp.
    2. **Raw fallback:** post the findings grouped by severity as the PR review comment, triage directly from the raw lists, and flag `degraded review — no doc` in the stamp.

27. **Post the review to the PR** — `gh pr review <N> --comment --body-file <temp-file>`: the doc's Summary table and Groups (or the degraded content), with the review-doc path referenced for full detail. Stay under the comment cap by truncating detail, never structure. Never `--approve`, never `--request-changes` — a blocking review state from a subagent can deadlock the unattended merge, and `/grind` owns the triage.

28. **Stamp the review on the issue:**
    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"pr-reviewed","pr":<N>,"paths":["<plan file path>"]} -->

    ### 🔍 /grind — PR #<N> reviewed

    **Findings:** <n> P1, <n> P2, <n> P3
    **Verdict:** <one line>
    **Coverage:** <"full roster" | "did not complete: <agents>" | "synthesized inline" | "degraded review — no doc">
    ```

29. **Delete this slice's scratch** — `rm -rf docs/reviews/.raw/<slug>/` — only after the PR comment posted and only on the verified-doc (or inline-synthesis) path. The raw fallback keeps its scratch; it *is* the record.

### Phase 5: Triage and address

30. **Budget gate** (triage + fix, 25m), then **triage the findings yourself** — from the review doc (from the raw lists only in the degraded case). This is `/grind`'s judgment call and it does not delegate it. For each finding decide **accept**, **reject**, or **defer**:

    | Verdict | Use when |
    |---------|----------|
    | **Accept** | The finding is correct and in scope for this slice. All P1s that survive scrutiny are accepted — a real correctness or security bug is never deferred past merge. |
    | **Reject** | The reviewer misread the code, the "bug" is intentional per the plan, or the suggestion contradicts the plan's Key Technical Decisions or Scope Boundaries. |
    | **Defer** | Real and worth doing, but outside this slice's units — it belongs to a later slice, or to a tracking issue. |

    Read the actual code before accepting or rejecting a P1. A reviewer agent working from a diff can misjudge context the surrounding file makes obvious; equally, do not reject a finding merely because acting on it is inconvenient.

31. **Record the triage durably, then announce it — both before any fix is dispatched:**
    - Write each verdict into the review doc as its `Status:` line, using `/review-walk`'s vocabulary: accepted → `in-progress`, rejected → `wont-fix` (with a `Skip reason:`), deferred → `deferred` (with a `Defer reason:`). The doc is now the durable triage record — a killed process resumes from these lines without re-reviewing.
    - Post the verdicts as a PR comment: each finding as "**P<X>-<N> <title>** — accepted / rejected: <why> / deferred: <why>". A rejection's reason should survive someone reading the PR later.

32. **If nothing was accepted**, the verdict comment already records the outcome — go to Phase 6.

33. **If anything was accepted**, set the row to `addressing` and **dispatch the fix subagent** — `Agent` with `model: "opus"`, `effort: "max"`, `subagent_type: "general-purpose"`, `run_in_background: false`.

    The brief:
    - The absolute worktree path — the branch is still checked out there.
    - The accepted findings verbatim, each with its file:line, and explicitly **only** those. Rejected and deferred findings must not appear in the brief at all; a fix agent handed the full list will quietly fix everything.
    - The instruction to commit and push to the PR branch when done, and to leave the test suite green.
    - The same prohibitions as the build agent: no merge, no `main`, no `git add -A`, no `--no-verify`, no force-push.
    - **Its return value:** what it changed per finding, and any finding it could not address with the reason.

34. **Verify the fixes landed** — `git -C <worktree> log origin/<branch>..HEAD` should be empty (everything pushed) and `gh pr view <N> --json commits` should show the new commits. If the agent reported success but nothing was pushed, retry once with a brief noting exactly what was missing; if the retry also fails, mark the row `blocked` and halt. On success, flip each fixed finding's `Status:` to `done` in the review doc.

35. **Report the outcomes on the PR** — `/push-review`'s comment shape, built from the doc's `Status:` lines:
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

36. **File deferred findings** as tracking issues when any exist, using the same shape as `/side-quest`, and link them in a PR comment so they're discoverable from the merged PR.

37. **Do not re-review.** One review pass per PR. Reviewing the fixes with a fresh fleet invites an unbounded loop; the final look in Phase 6 is the backstop.

### Phase 6: Look, verify, merge

38. **Budget gate** (merge, 25m), then **give the PR a final look.** This is not a review — it's the check a person does before hitting merge. Read `gh pr diff <N>` end to end and confirm:
    - The diff does what the slice's units said it would, and the units' Verification criteria are met.
    - Nothing accepted in Phase 5 is still unfixed.
    - No debugging leftovers, no commented-out blocks, no stray files, no secrets.
    - The change is confined to the slice's scope — nothing from a later slice snuck in.

    **If the look fails**, mark the row `blocked` with the reason and halt. Do not dispatch another fix round — two failed passes on the same PR means the slice needs a human.

39. **Set the row to `merging`, then wait on CI** — `gh pr checks <N> --watch`. If `gh` lacks `--watch`, poll every 30s capped at 20 minutes, then halt if unresolved.
    - **"No checks reported"** means the repo has no CI on this branch — the local suite becomes the gate: run the test command detected in Phase 0 in the worktree; red halts. (If Phase 0 found no test command either, note in the final report that this slice merged ungated.)
    - **When checks exist, `/grind` runs nothing locally** — the suite already ran in CI; running it twice buys nothing and, on expensive suites, costs real money.

40. **Red CI halts the run.** No fix rounds, no re-pushes, and never a masked failure — deleting a failing test, loosening an assertion, adding a skip, or bumping a timeout to force green is prohibited; CI is the only automated gate protecting an unattended merge. Mark the row `blocked` with the failing check named in `Notes`, pull the failing log (`gh run view <run-id> --log-failed`) into the halt report, and halt per Phase 7.

41. **Merge** — `gh pr merge <N> --squash --delete-branch`. **Verify it actually merged** (`gh pr view <N> --json state,mergedAt`); a failed merge (branch protection, required reviews, conflicts) is a halt, not a retry. Required-reviews protection in particular means the repo does not permit unattended merges — say that plainly rather than trying to work around it.

42. **Clean up — atomically with the merge.** No budget gate, no stop, and no interruption point between merge success and the end of this step; a resume that finds a merged PR with any of this missing completes it (Phase 2). From the primary checkout: `git worktree remove ../<repo>-worktrees/<branch-name>`, `git fetch origin <default-branch>:<default-branch>` (the fetch form — other worktrees may hold the branch), check the plan's implementation-unit checkboxes for the slice, update the row to `merged`, and stamp:
    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"pr-merged","pr":<N>,"paths":["<plan file path>"]} -->

    ### ✅ /grind — PR #<N> merged (slice <i> of <count>)

    **Slice:** <slice name>
    **Landed:** <one to two sentences on what shipped>
    ```
    Then move to the next slice.

### Phase 7: Halting (blocked — needs a human)

43. **Halting stops the entire run, not just the slice.** Later slices are built on the assumption that earlier ones merged; continuing past a blocked slice produces PRs that don't apply. Never skip ahead.

    On halt:
    - Set the row to `blocked` with a one-clause reason in `Notes`.
    - Leave the PR (when one was opened) **open** and the worktree **in place** — both are the user's material for taking over.
    - Set every remaining row's `Notes` to `not started`.
    - Stamp the issue. A build-phase halt fires **before any PR exists** (the blocked-unit rule opens none), so the stamp branches on whether there is a PR — never invent a number or url for one that was never opened:
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

    **Blocked is not stopped.** Blocked means the run cannot proceed without a human (red CI, failed look, blocked unit, failed merge). A timer stop (Phase 8) is a healthy run out of clock — resume continues it; a blocked run waits for you.

### Phase 8: Timer stop (healthy — resume continues)

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

### Phase 9: Report (complete)

45. When every slice is merged, set the plan's frontmatter `status: active` → `status: completed`.

46. Print the final table:

    | # | Slice | PR | Review findings | Result |
    |---|-------|----|-----------------|--------|
    | 1 | Add token refresh | [#61](url) | 1 P1, 2 P2 (1 deferred) | merged |

    Follow it with: total PRs merged, total commits, any deferred findings filed as tracking issues (with links), any slice that merged ungated (no CI, no test command), and anything from the plan's `Requirements Trace` that no merged slice covers. That last one matters most — a plan can grind to completion with a requirement quietly unimplemented, and this is the only place it surfaces.

47. Stamp the run's completion, then send the notification:
    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"grind-complete","paths":["<plan file path>"],"merged":<count>} -->

    ### 🏁 /grind — plan complete

    **Plan:** <plan file path>
    **Merged:** <count> PRs — <comma-separated PR links>
    **Follow-ups:** <tracking issue links, or "none">
    ```

### Notification

Every terminal outcome — `grind-complete`, `grind-stopped`, `grind-blocked` — notifies on **two independent channels** after its stamp is posted. The stamp is the durable record; the channels are the reach. They are not fallbacks for each other: push always fires, whether or not the email succeeded, because the two land in different places (terminal and phone vs. inbox) and an unattended run should reach whichever one you're near.

- **Push — always.** Call `PushNotification` with a one-line message under 200 characters: outcome, plan title, and the number that matters (`grind complete: auth-refresh — 4 PRs merged` / `grind stopped: auth-refresh — 2 of 5 slices, resume to continue` / `grind blocked: auth-refresh — red CI on #61`). No markdown. Fire it on every terminal outcome, including one where the email already went out, and including a timer stop. A skipped push (you're at the terminal, so it would be redundant) is a normal result, not a failure.
- **Email — when configured.** `SENDGRID_API_KEY` set → one `POST https://api.sendgrid.com/v3/mail/send` with a hard timeout (`curl --max-time 30`), the key passed only as an `Authorization: Bearer` header and the body via `--data @<file>`, so the key never lands in process listings and the body never lands in shell history. Unset, or the call fails → report one line, "couldn't send notification: <reason>", and continue. Exactly one attempt, never a retry, and never any retry during a timer stop.
- **From:** `hfritz@r-o.com` (name `Hagen Fritz`) — a verified SendGrid sender; an unverified `From:` is rejected with a 403. **Recipient:** hfritz@r-o.com. **Subject:** `[grind] <plan title>: <complete | stopped | blocked>`.
- **Body:** the outcome in one sentence, the per-slice table (merged PRs as links), what remains (for stopped/blocked), the blocking reason and PR link (for blocked), and the resume command.
- A notification failure on either channel is never fatal, never blocks the other channel, and never blocks the exit path it rides on.

## Rules

- **User-invoked only.** Never start `/grind` on your own initiative, and never from inside another skill.
- **One confirmation, then unattended.** The PR breakdown is confirmed; nothing after it is. Do not add prompts mid-run, and do not silently degrade to asking — if the run can't proceed autonomously, halt and say why.
- **Serial.** Slice N is merged before slice N+1 starts. No parallel slices, no starting the next build while a PR is in review.
- **One worktree per PR**, created off `origin/<default-branch>`, removed on merge. `/grind` runs from the primary checkout and never checks out a feature branch there.
- **Halt, don't skip; stop, don't die.** A blocked slice stops the run for a human. A failed budget gate stops it for the clock — cleanly, at a phase boundary, resumable. The two are distinct states with distinct stamps.
- **Red CI halts.** `/grind` pushes no CI-fix commits and never masks a failure — no deleted tests, loosened assertions, skips, or timeout bumps. With CI present, no local suite runs; with no CI, the local suite is the gate.
- **Every durable write precedes the notification it announces.** Table note, then stamp, then one send attempt per channel.
- **Verify every subagent claim** against `gh` or `git` before acting on it. A returned "done" is a hypothesis.
- **The reviewer fleet posts comments, never `--approve` or `--request-changes`.** `/grind` owns the triage decision; a blocking review state from a subagent can deadlock the merge.
- **Triage is `/grind`'s own judgment**, never delegated, and it is recorded in the review doc's `Status:` lines and on the PR **before** the fix agent is dispatched. The fix agent receives accepted findings only.
- **One review pass per PR.** Synthesis failures degrade (inline synthesis, then raw findings) — they never halt the run while raw findings exist, and they never trigger a second fleet.
- **The timer is in-memory and per-invocation.** Never persist the start time; a resume starts a fresh clock. No gate sits between merge success and the end of cleanup.
- **No force-push, no pushes to `main`, no `--no-verify`, no `git add -A`** — for `/grind` or any subagent it dispatches.
- **The plan doc is the state; GitHub and the review doc are the checkpoints.** Update the row at every transition; on resume, reconcile against `gh` and the disk rather than trusting the table.
- **Report the real outcome.** Only claim "merged" after `gh pr view` confirms it. Red is red.
