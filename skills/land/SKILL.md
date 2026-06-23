---
name: land
description: "Take an open PR all the way to merged: stamp a CLAUDE.md provenance entry onto its branch, run the local test suite, wait for GitHub Actions, fix failures (one confirmed re-commit at a time, up to 3 rounds), squash-merge the PR, then sync main. The CLAUDE.md stamp rides the same PR. Use when the user says 'land this', 'land the PR', 'merge this PR', 'land and merge', 'stamp the PR', 'update the CLAUDE.md before merge', or invokes /land. Runs on an open PR."
argument-hint: "[optional PR number]"
allowed-tools: Bash, AskUserQuestion, Read, Edit, Write, Grep, Glob
---

# Land — Stamp, Verify, and Merge an Open PR

**Note: The current year is 2026.**

`/land` takes an **open PR** from "ready" to "merged and synced." In order it: stamps the affected directory's `CLAUDE.md` — prepending a capped provenance entry (PR → plan → one-line summary) **and** reconciling the body prose with the merged diff so stale claims are revised and removed, not just appended to — then pushes it onto the PR branch so the doc lands atomically with the code; reads the PR body and runs any unchecked Pre-merge Tests, checking them off as they pass; waits for GitHub Actions; on CI failure, proposes a fix and re-commits **one confirmed fix at a time** (up to 3 rounds); squash-merges the PR; and checks out and pulls `main`.

Typical flow: open the PR with `/ship` → run `/land` → answer the confirm prompts → done: merged, branch deleted, on a fresh `main`.

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
11. **Draft the one-line summary** from the PR title plus the diff stat (`git diff --stat main...HEAD`; `gh pr diff` has no `--stat` flag). Keep it to one line describing what changed and why.
12. **Compose the entry** as a single Markdown list item, newest-first:
    - With a plan: `- **PR #<N>**: <summary> — [plan](<plan-path>)`
    - Without a plan: `- **PR #<N>**: <summary> — closes #<issue>` (omit the trailing clause entirely if there's no issue either).
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

33. After a successful merge, return to the default branch and pull: `git checkout main && git pull` (use `master` if that's the repo's default).
34. If the user opted to delete the branch in Phase 9, delete the local copy: `git branch -D <headRefName>`.
35. Report the final state: merged, remote and local branches deleted, now on a fresh `main`.

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
- Depends on `gh`; if `gh` is unavailable, stop and say so rather than guessing.
- On any failure (no open PR, no touched dirs, scaffold declined, red tests, CI red after 3 rounds, blocked merge, failed push), stop with a clear message — never leave a `CLAUDE.md` partially written, a half-made commit, or a false "merged" claim.
- Plan links live under `docs/plans/` (gitignored in some repos) and may be local-only; record the path regardless.
