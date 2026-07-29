---
name: grind
description: "Execute an entire implementation plan autonomously as a sequence of PRs. Breaks the plan into PR-sized slices, then for each one in turn: creates a worktree, dispatches a max-effort Opus subagent to build and open the PR, dispatches a Fable subagent to review and post comments, triages that feedback with its own judgment, dispatches a follow-up subagent for accepted fixes, gives the PR a final look, and merges it when CI is green. Updates the plan document with PR status at every stage. Use when the user says 'grind this plan', 'grind it out', 'run the whole plan', 'build all the PRs', or invokes /grind."
argument-hint: "[plan file path]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Agent, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# Grind — Autonomously Execute a Plan as a Sequence of PRs

**Note: The current year is 2026.**

`/grind` takes a plan document and drives it to fully merged `main`, one PR at a time, without stopping for approval between PRs. For each PR slice it: creates a worktree, dispatches a **max-effort Opus** subagent to implement and open the PR, dispatches a **Fable** subagent to review the PR and post its comments to GitHub, triages that feedback itself, dispatches a second max-effort Opus subagent for any accepted changes, gives the final diff a quick correctness look, then merges once CI is green and moves to the next slice.

The plan document is the durable state. `/grind` writes a `## PR Breakdown` table into it and updates each row as the PR advances, so an interrupted run can be resumed by re-invoking `/grind` on the same plan.

`/grind` is the autonomous sibling of `/work` → `/ship` → `/land`. It does **not** call those skills: `/work` asks for approval up front, `/ship` previews the PR body, and `/land` is confirm-gated at every commit and merge by design. `/grind` reimplements the necessary parts of that path unattended, and is explicit about what it gives up (see Autonomy Contract).

## Autonomy Contract

`/grind` runs unattended from the moment it starts building. Before it does, it gets **one** confirmation: the PR breakdown. After that it does not ask, and it will commit, push, and merge on its own judgment.

What that means, stated plainly:

1. **`/grind` merges without you.** Every merge in this skill is an unattended merge. It is gated on green CI and on `/grind`'s own final look — not on a human.
2. **`/grind` fixes CI without you.** Where `/land` confirms each fix commit, `/grind` diagnoses and pushes fixes itself, capped at 3 rounds per PR.
3. **The stop conditions are the safety net.** Because there is no human gate, the halt rules in Phase 6 are load-bearing. When `/grind` cannot make progress on a PR, it **stops the entire run** and leaves the PR open — it never skips a blocked slice and continues, since later slices are built on the assumption that earlier ones merged.
4. **`/grind` never force-pushes, never pushes to `main`, never uses `--no-verify`, and never uses `git add -A`.** These do not become acceptable because the run is autonomous.
5. **Interrupting is always safe.** State lives in the plan doc and on GitHub. Ctrl-C at any point leaves a coherent world: worktrees on disk, PRs open, table rows accurate as of the last completed stage.

If the user has not opted into this by invoking `/grind`, do not run it. Never invoke `/grind` on your own initiative from another skill.

## Input Document

<input_document> #$ARGUMENTS </input_document>

**If the argument is empty**, glob `docs/plans/*.md`, filter to `status: active` in the frontmatter, and present the most recent 4 by date via `AskUserQuestion` for the user to pick. If none exist, stop with: "No active plan found. Write one with `/blueprint` first, then re-run `/grind <plan-path>`."

## Workflow

### Phase 0: Preflight

Run these checks before touching anything. Any failure stops the run — a half-configured environment produces a half-merged plan.

1. **`gh` is available and authenticated** — `gh auth status`. If not: "GitHub CLI (`gh`) must be installed and authenticated for /grind. It merges PRs unattended and cannot proceed without it."
2. **This is the primary checkout** — `git rev-parse --git-common-dir` must resolve to `<toplevel>/.git`. If not: "You're inside a worktree. Run /grind from the primary checkout — it creates one worktree per PR." (Same rule as `/tree`.)
3. **On the default branch with a clean tree** — `git branch --show-current` is `main`/`master` and `git status --porcelain` is empty. If dirty: "Working tree is dirty. Commit or stash before grinding — /grind creates branches off a clean main." If on a feature branch: "You're on `<branch>`. /grind runs from the default branch; each PR gets its own worktree."
4. **Read the plan completely.** Note its `Implementation Units`, `Requirements Trace`, `Scope Boundaries`, `Deferred to Implementation`, and any `Execution note` fields. These are the source material for both the breakdown and every subagent brief.
5. **Resolve the linked issue** per [the issue-log spec](../issue-log/SKILL.md)'s issue-number resolution. Remember it as `<issue>`; it may be empty. Every stamp below skips silently when it is.
6. **Detect the test command** for the repo (`package.json` scripts, `Makefile`, `pytest.ini`, `Cargo.toml`, etc.). Remember it; if none is detectable, note that CI is the only gate and say so in the final report.

### Phase 1: Break the plan into PRs

7. **Slice the implementation units into PR-sized groups.** A PR slice is one or more consecutive implementation units that land together as one reviewable, independently-mergeable change.

   Group units into the same PR when they:
   - Would leave `main` broken if split (a caller and the function it calls; a migration and the code that reads the new column).
   - Are individually too small to review meaningfully (a one-line config change plus the flag that reads it).
   - Share the same test file and would produce conflicting edits to it as separate PRs.

   Split units into separate PRs when they:
   - Touch unrelated areas of the codebase.
   - Have a clean dependency boundary — the later one only needs the earlier one *merged*, not in-flight.
   - Would together exceed roughly 400 changed lines, or span more than ~6 files, without a reason to be atomic.

   **Every slice must leave `main` green and coherent on its own.** This is the hard constraint; the size heuristics bend to it.

8. **Order the slices** by dependency. Serial execution is the contract: slice N is fully merged before slice N+1 starts, so each build subagent branches off a `main` that already contains every prior slice. Where the plan's units have no dependency between them, order by risk — foundational and schema-touching work first, leaf features last.

9. **Name each slice.** Derive a conventional-commit type (`feat`, `fix`, `refactor`, `chore`, `docs`, `test`) and a short kebab-case description. These become the branch name and PR title.

10. **Write the `## PR Breakdown` table into the plan document.** Insert it immediately after the `## Overview` section (create the section if the plan lacks one; never displace `Implementation Units`). If a `## PR Breakdown` table already exists, this is a **resume** — go to Phase 2 instead of overwriting it.

    ```markdown
    ## PR Breakdown

    <!-- maintained by /grind — status values: pending | building | reviewing | addressing | merging | merged | blocked -->

    | # | Slice | Units | Branch | PR | Status | Notes |
    |---|-------|-------|--------|----|--------|-------|
    | 1 | Add token refresh to auth middleware | 1, 2 | `feat/57/token-refresh` | — | pending | — |
    | 2 | Wire refresh into the client SDK | 3 | `feat/57/client-refresh` | — | pending | — |
    ```

    The `PR` column holds the PR number as a link once opened. `Notes` holds one short clause — the review verdict, the CI-fix count, or the reason a slice is blocked.

11. **Confirm the breakdown** with `AskUserQuestion` — the only confirmation in the run. Show the full table in a `preview` on the first option, and state the slice count plainly in the question text.
    - **Grind it** — proceed. Everything after this point is unattended through to merge.
    - **Revise** — the user supplies free-form adjustments (merge slices, split one, reorder). Rewrite the table and re-confirm.
    - **Cancel** — stop. Leave the table in the plan doc so the breakdown isn't lost.

12. **Stamp the breakdown on the issue.** Compose the body, write it to a temp file with the Write tool, and post per [the issue-log spec](../issue-log/SKILL.md):

    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"grind-started","paths":["<plan file path>"],"slices":<count>} -->

    ### ⚙️ /grind — grinding <count> PRs

    **Plan:** <plan file path>
    **Slices:** <one line per slice: "N. <slice name> — units <list>">
    ```
    ```bash
    gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>
    ```

### Phase 2: The per-slice loop

For each slice in order, run Phases 3 through 7. Do not start slice N+1 until slice N is **merged**. On any halt condition, stop the whole run per Phase 6.

On a **resume** (a `## PR Breakdown` table already existed), first reconcile each row against reality before entering the loop: for rows with a PR number, `gh pr view <N> --json state,mergedAt` and correct the row's status; treat `MERGED` rows as done and pick up at the first row that isn't. Verify that a row claiming `merged` really is merged — never trust the table over GitHub.

### Phase 3: Build the PR

13. **Update the row** to `building` in the plan doc.

14. **Create the worktree.** Follow the same convention as `/tree` — branch `{prefix}/{issue}/{short-description}` (drop the `{issue}` segment when there's no linked issue), worktree at `../{repo-name}-worktrees/{branch-name}/`:
    ```bash
    git fetch origin <default-branch>
    git worktree add -b <branch-name> ../<repo>-worktrees/<branch-name> origin/<default-branch>
    ```
    Branching off `origin/<default-branch>` is what makes serial execution work: slice N+1's worktree contains slice N's merged code. Then symlink `docs/` from the primary checkout into the worktree (as `/tree` does), since it's gitignored and the plan lives there.

15. **Dispatch the build subagent** — `Agent` with `model: "opus"`, `effort: "max"`, `subagent_type: "general-purpose"`, `run_in_background: false`. `/grind` blocks on it; there is nothing to interleave in a serial run.

    The brief must contain, and nothing may be left implicit:
    - The absolute worktree path, and the instruction to do **all** work there — never in the primary checkout.
    - The absolute plan file path, for full context.
    - The verbatim text of every implementation unit in this slice: Goal, Requirements, Files, Approach, Execution note, Patterns to follow, Test scenarios, Verification.
    - Any `Deferred to Implementation` questions bearing on these units, plus the plan's `Scope Boundaries` as explicit non-goals.
    - The repo's test command, and the instruction to leave the suite green.
    - The instruction to follow the repo's `CLAUDE.md` conventions.
    - **Its deliverable:** commits on the branch, pushed, with an open PR. It must not merge, must not touch `main`, must not `git add -A`, must not `--no-verify`, and must not create a worktree of its own.
    - The PR body format from [ship's pr-template.md](../ship/pr-template.md), including `Closes #<issue>` when there's a linked issue.
    - **Its return value:** the PR number and URL, a one-line summary, and any unit it could not complete with the reason.

16. **Verify the subagent's claim.** Never take the return value on faith — `gh pr view <N> --json number,state,url,headRefName` in the worktree. If no PR exists, or its `headRefName` doesn't match the branch, the build failed regardless of what the agent reported: mark the row `blocked` with the reason and halt per Phase 6.

17. **Update the row** — PR number/link, status `reviewing`.

### Phase 4: Review the PR

18. **Dispatch the review subagent** — `Agent` with `model: "fable"`, `subagent_type: "general-purpose"`, `run_in_background: false`.

    The brief:
    - The PR number and the repo `<owner>/<repo>`.
    - Read the diff with `gh pr diff <N>` — the review is of the PR, not of a working tree.
    - The absolute plan file path and the verbatim units this PR implements, so the review can judge the change against what it was *supposed* to do, not just against itself.
    - The repo's `CLAUDE.md` conventions as the house style bar.
    - **What to look for:** correctness bugs, broken contracts, missed edge cases from the unit's Test scenarios, unmet Verification criteria, security issues, convention violations, and untested branches. Not style nits an autoformatter would catch.
    - **How to report:** post to the PR with `gh pr review <N> --comment --body-file <temp-file>` — a comment review, never `--approve` and never `--request-changes` (there's no human to satisfy the gate, and a `--request-changes` review can block the unattended merge). Write the body to a temp file; never inline it in shell.
    - **Its return value:** a structured list of findings — each with severity (`P1` blocking / `P2` should-fix / `P3` nit), file:line, and a one-sentence description — plus an overall verdict. An empty list is a valid, expected result.

19. **Stamp the review on the issue:**
    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"pr-reviewed","pr":<N>,"paths":["<plan file path>"]} -->

    ### 🔍 /grind — PR #<N> reviewed

    **Findings:** <n> P1, <n> P2, <n> P3
    **Verdict:** <one line>
    ```

### Phase 5: Triage and address

20. **Triage the findings yourself.** This is `/grind`'s judgment call and it does not delegate it. For each finding decide **accept** (dispatch a fix), **reject** (the reviewer is wrong or it's out of scope), or **defer** (real, but belongs in a follow-up issue).

    | Verdict | Use when |
    |---------|----------|
    | **Accept** | The finding is correct and in scope for this slice. All P1s that survive scrutiny are accepted — a real correctness or security bug is never deferred past merge. |
    | **Reject** | The reviewer misread the code, the "bug" is intentional per the plan, or the suggestion contradicts the plan's Key Technical Decisions or Scope Boundaries. |
    | **Defer** | Real and worth doing, but outside this slice's units — it belongs to a later slice, or to a tracking issue. |

    Read the actual code before accepting or rejecting a P1. A reviewer subagent working from a diff can misjudge context that the surrounding file makes obvious; equally, do not reject a finding merely because acting on it is inconvenient. Where you reject a P1, say why in the PR thread — the rejection should survive someone reading the PR later.

21. **If nothing was accepted**, post a brief reply to the PR recording the triage (what was rejected or deferred, and why), then go to Phase 6.

22. **If anything was accepted**, set the row to `addressing` and **dispatch the fix subagent** — `Agent` with `model: "opus"`, `effort: "max"`, `subagent_type: "general-purpose"`, `run_in_background: false`.

    The brief:
    - The absolute worktree path — the branch is still checked out there.
    - The accepted findings verbatim, each with its file:line, and explicitly **only** those. Rejected and deferred findings must not appear in the brief at all; a fix agent handed the full list will quietly fix everything.
    - The instruction to commit and push to the PR branch when done, and to leave the test suite green.
    - The same prohibitions as the build agent: no merge, no `main`, no `git add -A`, no `--no-verify`, no force-push.
    - **Its return value:** what it changed per finding, and any finding it could not address with the reason.

23. **Verify the fixes landed** — `git -C <worktree> log origin/<branch>..HEAD` should be empty (everything pushed) and `gh pr view <N> --json commits` should show the new commits. If the agent reported success but nothing was pushed, treat it as a failed round: retry once with a brief noting exactly what was missing. If the retry also fails, mark the row `blocked` and halt.

24. **File deferred findings** as tracking issues when any exist, using the same shape as `/side-quest`, and link them in a PR comment so they're discoverable from the merged PR.

25. **Do not re-review.** One review pass per PR. Reviewing the fixes with a fresh Fable agent invites an unbounded loop, and the final look in Phase 6 is the backstop.

### Phase 6: Look, verify, merge

26. **Give the PR a final look.** This is not a review — it's the check a person does before hitting merge. Read `gh pr diff <N>` end to end and confirm:
    - The diff does what the slice's units said it would, and the units' Verification criteria are met.
    - Nothing accepted in Phase 5 is still unfixed.
    - No debugging leftovers, no commented-out blocks, no stray files, no secrets.
    - The change is confined to the slice's scope — nothing from a later slice snuck in.

    **If the look fails**, mark the row `blocked` with the reason and halt. Do not dispatch another fix round — two failed passes on the same PR means the slice needs a human.

27. **Run the test suite locally** in the worktree, if one was detected in Phase 0. Red tests halt the run — never merge past a local failure on the theory that CI might disagree.

28. **Set the row to `merging`, then wait on CI** — `gh pr checks <N> --watch`. If `gh` lacks `--watch`, poll `gh pr checks <N>` every 30s capped at 20 minutes, then halt if unresolved. "No checks reported" means the repo has no CI on this branch: note it and proceed — there's no gate to enforce.

29. **On CI failure, fix it — capped at 3 rounds.** This is where `/grind` departs most sharply from `/land`, which confirms every fix commit with the user. `/grind` does not, so the cap is the only brake:
    - Pull the failing log: `gh run list --branch <branch> --limit 1 --json databaseId,conclusion`, then `gh run view <run-id> --log-failed`.
    - Diagnose and make the minimal fix in the worktree. Stage only the files you changed. Commit with a scoped conventional message and push.
    - Re-run the local suite, then re-enter the CI wait.
    - **Never mask a failure.** Deleting a failing test, loosening an assertion, adding a skip/xfail, or bumping a timeout to make red go green is prohibited — it defeats the only automated gate protecting an unattended merge. If the honest fix isn't clear, halt.
    - **After 3 rounds still red:** mark the row `blocked` and halt.

30. **Merge** — `gh pr merge <N> --squash --delete-branch`. **Verify it actually merged** (`gh pr view <N> --json state,mergedAt`); a failed merge (branch protection, required reviews, conflicts) is a halt, not a retry. Required-reviews protection in particular means the repo does not permit unattended merges — say that plainly rather than trying to work around it.

31. **Clean up.** From the primary checkout: `git worktree remove ../<repo>-worktrees/<branch-name>` and `git fetch origin <default-branch>:<default-branch>` to move the local ref forward. Use the fetch form, not `git checkout main && git pull` — other worktrees may hold the branch.

32. **Update the row** to `merged`, and stamp the issue:
    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"pr-merged","pr":<N>,"paths":["<plan file path>"]} -->

    ### ✅ /grind — PR #<N> merged (slice <i> of <count>)

    **Slice:** <slice name>
    **Landed:** <one to two sentences on what shipped>
    ```

33. **Check the plan's implementation-unit checkboxes** for every unit in the merged slice, then move to the next slice.

### Phase 7: Halting

34. **Halting stops the entire run, not just the slice.** Later slices are built on the assumption that earlier ones merged; continuing past a blocked slice produces PRs that don't apply. Never skip ahead.

    On halt:
    - Set the row to `blocked` with a one-clause reason in `Notes`.
    - Leave the PR **open** and the worktree **in place** — both are the user's material for taking over.
    - Set every remaining row's `Notes` to `not started`.
    - Stamp the issue:
      ```markdown
      <!-- cc-forge-log v1: {"skill":"grind","event":"grind-blocked","pr":<N>,"paths":["<plan file path>"]} -->

      ### 🛑 /grind — halted at slice <i> of <count>

      **Blocked:** <what stopped it>
      **PR:** <url> (open)
      **Worktree:** <absolute path>
      **Remaining:** <count> slices not started
      ```
    - Report to the user: what merged, what's open and where, what the failure was with the real output, and the concrete next step.

### Phase 8: Report

35. When every slice is merged, set the plan's frontmatter `status: active` → `status: completed`.

36. Print the final table:

    | # | Slice | PR | Review findings | CI rounds | Result |
    |---|-------|----|-----------------|-----------|--------|
    | 1 | Add token refresh | [#61](url) | 1 P1, 2 P2 (1 deferred) | 0 | merged |

    Follow it with: total PRs merged, total commits, any deferred findings filed as tracking issues (with links), and anything from the plan's `Requirements Trace` that no merged slice covers. That last one matters most — a plan can grind to completion with a requirement quietly unimplemented, and this is the only place it surfaces.

37. Stamp the run's completion:
    ```markdown
    <!-- cc-forge-log v1: {"skill":"grind","event":"grind-complete","paths":["<plan file path>"],"merged":<count>} -->

    ### 🏁 /grind — plan complete

    **Plan:** <plan file path>
    **Merged:** <count> PRs — <comma-separated PR links>
    **Follow-ups:** <tracking issue links, or "none">
    ```

## Rules

- **User-invoked only.** Never start `/grind` on your own initiative, and never from inside another skill.
- **One confirmation, then unattended.** The PR breakdown is confirmed; nothing after it is. Do not add prompts mid-run, and do not silently degrade to asking — if the run can't proceed autonomously, halt and say why.
- **Serial.** Slice N is merged before slice N+1 starts. No parallel slices, no starting the next build while a PR is in review.
- **One worktree per PR**, created off `origin/<default-branch>`, removed on merge. `/grind` runs from the primary checkout and never checks out a feature branch there.
- **Halt, don't skip.** A blocked slice stops the run. The PR stays open, the worktree stays on disk.
- **Never mask a CI failure.** No deleted tests, loosened assertions, added skips, or timeout bumps to force green. CI is the only automated gate on an unattended merge.
- **Verify every subagent claim** against `gh` or `git` before acting on it. A returned "done" is a hypothesis.
- **The reviewer posts comments, never `--approve` or `--request-changes`.** `/grind` owns the triage decision; a blocking review state from a subagent can also deadlock the merge.
- **Triage is `/grind`'s own judgment**, never delegated. The fix agent receives accepted findings only.
- **One review pass per PR.** The Phase 6 look is the backstop, not a second review.
- **No force-push, no pushes to `main`, no `--no-verify`, no `git add -A`** — for `/grind` or any subagent it dispatches.
- **The plan doc is the state.** Update the row at every stage transition so an interrupted run is resumable; reconcile the table against GitHub on resume rather than trusting it.
- **Report the real outcome.** Only claim "merged" after `gh pr view` confirms it. Red is red.
