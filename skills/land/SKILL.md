---
name: land
description: "Take an open PR all the way to merged: stamp a CLAUDE.md provenance entry onto its branch, run the local test suite, wait for GitHub Actions, fix failures (one confirmed re-commit at a time, up to 3 rounds), squash-merge the PR, sync main, then post a short resolution summary on the linked issue. The CLAUDE.md stamp rides the same PR. Use when the user says 'land this', 'land the PR', 'merge this PR', 'land and merge', 'stamp the PR', 'update the CLAUDE.md before merge', or invokes /land. Runs on an open PR."
argument-hint: "[optional PR number]"
allowed-tools: Bash, AskUserQuestion, Read, Edit, Write, Grep, Glob
---

# Land — Stamp, Verify, and Merge an Open PR

**Note: The current year is 2026.**

`/land` takes an **open PR** from "ready" to "merged and synced." In order it: fast-forwards the local branch to pick up review-fix commits pushed from another machine (the remote-review flow); stamps the affected directory's `CLAUDE.md` — prepending a capped provenance entry (PR → plan → one-line summary) **and** reconciling the body prose with the merged diff so stale claims are revised and removed, not just appended to — then pushes it onto the PR branch so the doc lands atomically with the code; reads the PR body and runs any unchecked Pre-merge Tests, checking them off as they pass; waits for GitHub Actions; on CI failure, proposes a fix and re-commits **one confirmed fix at a time** (up to 3 rounds); squash-merges the PR; and checks out and pulls `main`.

Typical flow: open the PR with `/ship` → run `/land` → answer the confirm prompts → done: merged, branch deleted, on a fresh `main`, and a ≤3-sentence resolution summary posted to the linked issue.

## Core Principles

1. **The CLAUDE.md is the state.** A botched parse corrupts the only record. Always show the diff and confirm before committing; prefer surgical `Edit` over full `Write`. Never partial-write on a failure path — stop with a clear message instead.
2. **One directory per run.** A PR may touch many directories; you stamp exactly one, chosen deliberately by the user. Changes outside it do not force extra stamps.
3. **The summary is the carried context.** The one-line summary matters more than the links. Draft it from the PR, but let the user edit it before it lands.
4. **The doc rides the PR.** Commit the stamp onto the open PR's branch before merge, so it lands atomically with the code it describes.
5. **No unattended fixes.** When CI fails, you diagnose and propose, but every re-commit is confirmed by the user first. Never push an AI fix to a PR you're about to merge without an explicit OK. A masked failure is worse than a red PR.
6. **Report the real outcome.** Tests red, CI red, push failed, merge blocked — say so plainly with the output. Only claim "merged" after the merge actually succeeds.

## Workflow

### Phase 1: Safety and PR resolution

1. Verify `gh` is available (`gh --version`). If not, stop with: "GitHub CLI (`gh`) is required for /land. Install it and re-run."
2. Run `git rev-parse --show-toplevel` to get the repository root. Scope all git/`gh` operations to this repo.
3. Run `git branch --show-current`. If on `main`/`master`, stop with: "You're on the default branch. /land stamps an open PR's feature branch — check out the branch first."
4. **Resolve the open PR** — `/land` stamps a PR that is still **open**, so the commit it makes lands on that PR before merge.
   - **If a PR number arg was passed** (`/land 42`): `gh pr view <N> --json number,title,url,body,state,headRefName`. If `state` is not `OPEN`, stop with: "PR #<N> is <state>, not open. /land stamps an open PR before merge." Otherwise this is the resolved PR.
   - **Otherwise**: resolve the open PR for the current branch: `gh pr view --json number,title,url,body,state,headRefName` (with no number, `gh` uses the current branch). If it errors or returns no open PR, stop with: "No open PR found for branch `<branch>`. Open one with /ship first, or pass a PR number."
5. **Confirm the PR** with `AskUserQuestion` before any file edit. Put the PR in a `preview` on the Confirm option:
   ```
   PR #<N>: <title>  (open)
   <url>
   ```
   Options: **Confirm** (use this PR) / **Cancel** (abort). On Cancel, stop with "Cancelled — no changes made."
5b. **Sync the PR branch before touching it.** Review fixes may have been pushed from another machine (the remote-review flow: `/deep-review` + `/review-walk` + `/push-review` run on a separate box push fix commits to the PR branch). `/catch-up` normally does this sync earlier, with a fuller delta report; this step is the safety net for when it was skipped. Run `git fetch origin <headRefName>`, then compare:
   - **Local behind, fast-forwardable** (`git merge-base --is-ancestor HEAD origin/<headRefName>`): run `git pull --ff-only origin <headRefName>` and report how many commits came in. This is the normal case after a remote review pass, not an anomaly. (For a fuller view of what those commits changed, `/catch-up` reports incoming files + review outcomes — run it instead of relying on this bare sync if you want the context.)
   - **Local and remote diverged**: stop with "Local `<headRefName>` and `origin/<headRefName>` have diverged — reconcile manually (`git pull --rebase origin <headRefName>`), then re-run /land." Never auto-rebase or force-push.
   - **Local up to date or ahead**: proceed.

### Phase 2: Choose the target directory

6. Get the files the PR touched: `gh pr diff <N> --name-only`.
7. Bucket files by their containing directory (the leaf directory of each changed file). Rank directories by number of changed files, descending. Files at the repo root (e.g. `README.md`) bucket under the repo root itself — offer it as a candidate (stamping the root `CLAUDE.md`).
8. Present the ranked directories with `AskUserQuestion` (single-select). Show the **full absolute path** of each candidate. Do not pre-apply a default — the user picks one deliberately. If a chosen leaf directory has no natural `CLAUDE.md` home, its parent directory is an acceptable choice; offer parents when useful.
9. The selected directory is the target. Its `CLAUDE.md` path is `<dir>/CLAUDE.md`.

### Phase 3: Build the entry

10. **Locate the plan**, in order — stop at the first hit:
    - An explicit plan path the user supplied this session.
    - A file under `docs/plans/` whose name matches the PR's issue number or the PR's `headRefName` slug (glob `docs/plans/*<issue-or-slug>*`).
    - A plan path referenced in the PR body.
    - If none found, fall back to the issue link (parse the issue from the PR body's `Closes #N` / `Fixes #N`).
    - Never link a review document.
    - **Capture the linked issue number** here regardless of whether a plan was found — parse `Closes #N` / `Fixes #N` / `Resolves #N` from the PR body (and the `{issue-number}` segment of `headRefName` if the body has none). Remember it as `<issue>` for the post-merge issue comment (Phase 11). If there's no linked issue, `<issue>` is empty and Phase 11 is skipped.
11. **Draft the one-line summary** from the PR title plus the diff stat (`git diff --stat main...HEAD`; `gh pr diff` has no `--stat` flag). Keep it to one line describing what changed and why.
12. **Compose the entry** as a single Markdown list item, newest-first:
    - With a plan: `- **PR #<N>**: <summary> — [plan](<plan-path>)`
    - Without a plan: `- **PR #<N>**: <summary> — #<issue>` (omit the trailing clause entirely if there's no issue either).
13. **Confirm the entry** with `AskUserQuestion`, showing the full drafted entry in a `preview` on the first option. Options: **Use as-is** (lands the drafted summary) / **Edit summary** (the user supplies a revised one-line summary via free-form input; recompose the entry and re-confirm). Do not proceed until the user picks.

### Phase 4: Update the CLAUDE.md

14. **If `<dir>/CLAUDE.md` does not exist:** confirm the full path with `AskUserQuestion`, then `Write` a minimal scaffold:
    ```markdown
    # <Directory name>

    ## Related
    ```
15. **Locate the `## Related` heading** in the file. If absent, create it (append it after the title / at the end of the file). The list under it is exactly the contiguous top-level `- ` lines immediately following the heading; it ends at the first blank line or next heading. Treat only those lines as the list.
16. Each entry is a **single-line** list item (no sub-bullets, no notes between entries). **Prepend** the new entry directly under `## Related`, then **truncate the list to the newest 10 entries** (drop the oldest). Use surgical `Edit` on that block only.
17. **Reconcile the body prose — not just append.** The `## Related` entry is a log line; the rest of the file is the *current* description of the directory, and the PR may have made parts of it stale. Read the whole file and the PR diff, then bring the prose into agreement with the merged code:
    - **Revise** statements the change makes inaccurate (a renamed flag, a moved file, a changed default, a reworded behavior).
    - **Remove** descriptions of behavior, files, or options the PR deleted — do not leave dangling references to things that no longer exist.
    - **Add** facts the diff clearly establishes (a new subcommand, a new required arg, a new phase).
    - Leave unrelated prose untouched. **Do not invent invariants, guess at intent, or document behavior the diff doesn't show.** When a statement is ambiguous rather than clearly wrong, leave it.
    The bar: after this step, someone reading the `CLAUDE.md` body (ignoring the `## Related` log) should see an accurate description of the directory as it stands *after* this PR — no stale claims, no references to removed things.

### Phase 5: Commit and push to the PR

18. Show the full diff of the edited file: `git diff -- <dir>/CLAUDE.md`.
19. **Confirm before committing** with `AskUserQuestion`: **Commit & push** (lands on the PR) / **Leave uncommitted** (stops here, edits stay in the working tree) / **Cancel** (revert via `git checkout -- <dir>/CLAUDE.md`).
20. On **Commit & push**:
    - **Pre-flight the push.** Fetch the PR branch (`git fetch origin <headRefName>`) and check the local branch isn't behind it. If it is behind (the remote advanced — e.g. a suggestion committed in the GitHub UI or a push from another machine), stop **before committing** with: "The PR branch advanced on the remote. Run `git pull --rebase origin <headRefName>`, re-check the diff, then re-run /land." Do not auto-rebase or force-push.
    - Stage only the CLAUDE.md: `git add <dir>/CLAUDE.md`.
    - Commit (HEREDOC message). Use the **leaf** directory name as the conventional-commit scope (e.g. `land` for `skills/land`; `root` for the repo root):
      ```
      git commit -m "$(cat <<'EOF'
      docs(<leaf-dir>): stamp PR #<N> context into CLAUDE.md

      Co-Authored-By: Claude <noreply@anthropic.com>
      EOF
      )"
      ```
    - Push to the PR's branch: `git push origin HEAD`.
    - **Report the actual outcome.** Only on a successful push: "Stamped CLAUDE.md and pushed to PR #<N>." If the push fails, do **not** claim success — report: "Committed locally but the push failed — the stamp is NOT on PR #<N> yet. Resolve the push (e.g. `git pull --rebase origin <headRefName>`) and `git push`, or `git reset --soft HEAD~1` to undo the commit." **Stop here on a failed push** — nothing downstream runs.
21. On a successful push, **proceed to Phase 6**.

### Phase 6: Run PR Pre-merge Tests

22. **Extract Pre-merge Tests**: Read the resolved PR's body (`gh pr view <N> --json body`). Locate the "Pre-merge Tests" section under "Test Plan".
23. **If there are no unchecked pre-merge tests** (or the section is missing): Proceed to Phase 7.
24. **Run and check off tests**: For each unchecked test (`- [ ]`) in the Pre-merge Tests list:
    - Identify the CLI command to run from the checklist item text.
    - Run the command locally.
    - **Green** → Update the PR body to check off this specific box (`- [x]`) using `gh pr edit <N> --body "$UPDATED_BODY"`. Proceed to the next test.
    - **Red** → **stop** and report the failing output. Do not touch CI or merge. The user fixes locally and re-runs `/land`.

### Phase 7: Wait on GitHub Actions

25. **Block-poll CI** for the resolved PR `<N>` (from Phase 1): `gh pr checks <N> --watch`, streaming status to the user as checks resolve. (If the installed `gh` lacks `--watch`, fall back to a clear message and poll `gh pr checks <N>` on a fixed interval — e.g. every 30s, capped at ~20 minutes — then stop and report if still unresolved; never silently busy-loop.)
26. When checks resolve:
    - **No checks reported** (`gh pr checks <N>` exits non-zero with "no checks reported" — the repo has no CI on this branch): note "No CI checks on this PR — nothing to wait on." and proceed to Phase 9 (merge). There is no gate to enforce.
    - **All green** → proceed to Phase 9 (merge).
    - **Any failed** → proceed to Phase 8 (fix loop).

### Phase 8: CI fix loop (max 3 rounds)

27. This loop is **human-gated** — never commit a fix without explicit confirmation.
28. For each round (cap at **3**):
    - **Surface the failure:** find the failing run id — `gh run list --branch <headRefName> --limit 1 --json databaseId,conclusion` (or take the run id from the failing check's URL in the Phase 7 output) — then pull the log: `gh run view <run-id> --log-failed`. Show the user the failing check and the relevant log excerpt.
    - **Propose a fix** in plain English plus the concrete edit you intend to make.
    - **Confirm with `AskUserQuestion`** before any commit. Options: **Apply fix** (edit + commit + push) / **Skip this round** (re-watch CI without changes — e.g. a flaky check the user wants to re-run) / **Abort** (stop `/land`, leave the PR open and unmerged).
    - **On Apply fix:**
      - **Pre-flight the push** exactly as the stamp push does: `git fetch origin <headRefName>`; if the local branch is behind, **stop before committing** with "The PR branch advanced on the remote. Run `git pull --rebase origin <headRefName>`, then re-run /land." Never force-push.
      - Make the edit, stage only the changed files (never `git add -A` blindly; never `--no-verify`), commit with a HEREDOC message scoped to the fix, and `git push origin HEAD`.
      - **Re-run the Pre-merge Tests** from the PR body on the fixed tree. If any are now **red**, that's another failure for **this same round** — surface it and loop back to the start of this round's confirm step; do **not** fall through to Phase 6's hard-stop (that only applies to the initial pre-CI run, not to in-loop re-runs). If **green** (or no tests found), **re-enter Phase 7** to re-watch CI.
    - **On Skip this round:** re-enter Phase 7 without committing.
29. **If CI is still red after 3 rounds:** stop and report the remaining failures. Do **not** merge. The PR stays open for the user to take over.

### Phase 9: Merge the PR

30. **Confirm the merge** with `AskUserQuestion`, defaulting to **squash + delete branch**. Options: **Squash & delete branch** (default) / **Override** (let the user pick merge / rebase, and whether to keep the branch) / **Cancel** (leave the PR open, stop).
31. On confirm: `gh pr merge <N> --squash --delete-branch` (or the chosen method / `--delete-branch` omitted if the user keeps the branch).
32. **Verify the merge actually happened.** Only on success: report "Merged PR #<N> (squash) and deleted the branch." If `gh pr merge` fails — branch protection, required reviews, conflicts, not mergeable — do **not** claim success; report the exact reason and stop. The PR stays open.

### Phase 10: Sync main

33. **Sync the default branch.** Attempt `git checkout main && git pull` (use `master` if that's the repo's default). If the checkout fails with `fatal: 'main' is already used by worktree at ...` (running from a linked worktree while another checkout holds `main`), fall back to updating the local ref without checking it out: `git fetch origin main:main`. Any other failure (network, auth, no `origin`) is a real error — report it and stop; do not claim the ref is current.
34. If the user opted to delete the branch in Phase 9: `gh pr merge --delete-branch` already deleted the remote branch. For the local branch and any worktree holding it:
    - Run `git worktree list` and check whether `<headRefName>` is checked out in any linked worktree.
    - **If found**: ask before removing it — **worktree removal is not the default-and-forget step branch deletion is, since a removed worktree can't be resumed** (e.g. a follow-up fix, or a Claude Code session still pointed at that directory). Use `AskUserQuestion`: **Remove the worktree** (description: "Done with this branch's directory — clean it up now") / **Keep it** (description: "I may want to resume work here — just clean up the branch reference, leave the directory"). Default the question's recommended option to **Remove**, but always ask.
      - **On Remove**: first check whether the directory still exists on disk (`test -d <that-path>`). **If it's gone** (deleted with `rm -rf` instead of `git worktree remove`, leaving stale `.git/worktrees/` metadata), skip the state check entirely — there's nothing to inspect — and run `git worktree remove <that-path>` then `git worktree prune` to clear the stale metadata. **If it still exists**, check its state — `git -C <that-path> status --short`. If non-empty, or if `<that-path>/.git/MERGE_HEAD` or `<that-path>/.git/rebase-merge` exists (an in-progress merge/rebase), show the status output to the user via a second `AskUserQuestion` and ask whether to force-remove (data loss) or abort cleanup and leave both the branch and worktree in place — refuse `--force` outright on an in-progress merge/rebase rather than offering it. Only pass `--force` to `git worktree remove` after this explicit, informed confirmation.
        - Then `git branch -D <headRefName>`. **If this fails** (e.g. the branch is checked out somewhere the agent didn't enumerate), report the exact error and the actual state (worktree removed, branch still present locally) plus the literal manual command (`git branch -D <headRefName>`) so the user can finish the cleanup — do not fold this into a generic success report; re-running `/land` is a dead end once the PR is merged.
      - **On Keep**: leave the worktree directory and its branch entirely alone — do not run `git branch -D` either, since the branch is still checked out there. Report that the worktree at `<that-path>` remains, still on `<headRefName>`, for whenever the user wants to resume or clean it up manually (`git worktree remove <path>` when ready).
    - **If not found in any worktree**: just `git branch -D <headRefName>` as before.
35. Report the final state: merged, remote branch deleted, local branch/worktree cleaned up (or intentionally kept — say which) if applicable, and whether the local `main` ref ended up checked out or just fetched.

### Phase 11: Comment the resolution on the linked issue

36. **Skip entirely if** there's no `<issue>` from step 10, or the merge in Phase 9 did not succeed (never comment "resolved" on an issue whose PR isn't merged). A squash-merge with `Closes #<issue>` in the PR body auto-closes the issue; this comment adds the human-readable *what-shipped*, it does not close anything itself.
37. **Verify the issue is real and open-or-just-closed:** `gh issue view <issue> --json number,state,title`. If it errors (wrong number, no access), skip with a one-line note — don't fabricate. If `state` is already `CLOSED` from before this PR, still comment (the resolution context is useful) but don't imply this PR closed it.
38. **Draft a ≤3-sentence summary** of what shipped, aimed at someone who filed or is watching the issue — plain language, no diff stats or file lists. Source it from the PR title, the `## Related` summary you just composed, and the merged diff. Say what changed and, if not obvious, the effect. Keep it to at most three sentences.
39. **Compose the comment** — the whole body, marker line first (a recompose after Edit summary produces this same shape):
    ```markdown
    <!-- cc-forge-log v1: {"skill":"land","event":"pr-merged","pr":<N>} -->

    ### ✅ /land — PR #<N> merged

    <2-3 sentence summary of what landed, from step 38>

    **Follow-ups:**
    - <known follow-up: deferred review items, side-quests, or debt discovered during this branch>
    ```
    Omit the **Follow-ups** section when none are known. If the issue was already closed before this PR, say so in the summary wording rather than implying this PR closed it.
40. **Confirm before posting** via `AskUserQuestion`, showing the composed comment in a `preview`: **Post to issue** (default) / **Edit summary** (free-form revised summary, recompose per step 39, re-confirm) / **Skip** (don't comment). On Post: write the composed comment to a temp file with the Write tool, then
    ```bash
    gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>
    ```
41. Report whether the issue comment posted, was edited, or was skipped. A failed `gh issue comment` is not fatal — the PR is already merged; report the failure and the manual command, don't roll anything back.

## Rules

- Manual only — `/land` is never wired to a git or CI hook.
- Operates on an **open** PR; refuse closed/merged PRs.
- Exactly one target directory per run.
- No review-document links in entries; `## Related` is capped at 10, newest-first.
- The stamp is **two parts**: prepend the capped log entry **and** reconcile the body prose with the merged diff (revise stale statements, drop references to removed things, add facts the diff establishes) — not a blind append. Never invent invariants the diff doesn't show.
- The **stamp** commit contains only the single CLAUDE.md file — never `git add -A`/`.`, never `--no-verify`. CI-fix commits stage only the files they change. Push to the feature branch only.
- Do not push to `main`/`master`; only ever push the feature branch. The only `main` operation is the final `git checkout main && git pull` after merge.
- **No unattended fixes** — every CI-fix commit is confirmed by the user first. The fix loop is capped at 3 rounds; still-red after 3 means stop without merging.
- **Merge is squash + delete branch by default**; only ask to override. Only claim "merged" after `gh pr merge` succeeds; on a blocked/failed merge, report the reason and leave the PR open.
- Pre-merge tests: extract from PR body and run them; update PR body to check them off on success; **stop** when tests are red.
- Issue comment: post a ≤3-sentence resolution summary to the linked issue **only after a successful merge**, user-confirmed, never fabricated; a missing linked issue or a failed comment is skip-and-note, never a rollback.
- Depends on `gh`; if `gh` is unavailable, stop and say so rather than guessing.
- On any failure (no open PR, no touched dirs, scaffold declined, red tests, CI red after 3 rounds, blocked merge, failed push), stop with a clear message — never leave a `CLAUDE.md` partially written, a half-made commit, or a false "merged" claim.
- Plan links live under `docs/plans/` (gitignored in some repos) and may be local-only; record the path regardless.
