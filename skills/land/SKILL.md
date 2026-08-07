---
name: land
description: "Take an open PR to merged with zero prompts: watch its existing CI checks (running the local test suite only when the PR reports no checks at all), squash-merge and delete the branch, remove the /tree worktree when one holds it, sync local main, and post a pr-merged stamp on the linked issue. Never pushes a commit, never triggers a CI run, halts on any red. Use when the user says 'land this', 'land the PR', 'merge this PR', 'land and merge', or invokes /land. Runs on an open PR."
argument-hint: "[optional PR number]"
allowed-tools: Bash, Read, Write, Grep, Glob
---

# Land — Merge an Open PR, Click-Free

**Note: The current year is 2026.**

`/land` takes an **open PR** from "ready" to "merged and synced" with zero prompts — invoking it is the confirmation. In order it: resolves the PR, waits on its **existing** CI checks (with the local test suite as the gate only when the repo reports no checks), squash-merges and deletes the branch, removes the `/tree` worktree when one holds it, syncs local `main`, and posts the `pr-merged` stamp on the linked issue. It never pushes a commit and never triggers a CI run that wasn't already running. Red — CI or local — halts the run with the failing output; `/land` proposes no fixes.

Typical flow: open the PR with `/ship` → (remote-review flow: run `/catch-up` in the worktree first) → run `/land` → done: merged, branch deleted, worktree removed, on a fresh `main`, issue stamped.

## Core Principles

1. **Invocation is the confirmation.** No prompts, previews, or confirm gates — a run either completes or halts with a clear report.
2. **`/land` writes nothing to the PR.** No commits, no pushes, no body edits. The only GitHub writes are the merge itself and the issue stamp.
3. **CI is the gate.** With checks present, nothing runs locally. With no checks reported, the local suite is the only gate. Red of either kind halts — no fix commits, ever.
4. **Never destroy user state.** A dirty worktree or in-progress merge/rebase is left in place and reported — never `--force`, never a prompt.
5. **Report the real outcome.** CI red, merge blocked, cleanup incomplete — say so plainly with the output. Only claim "merged" after the merge actually succeeds.

## Workflow

### Phase 1: Resolve the PR

1. Verify `gh` is available (`gh --version`). If not, stop: "GitHub CLI (`gh`) is required for /land. Install it and re-run."
2. Run `git rev-parse --show-toplevel` for the repository root; scope all git/`gh` operations to it.
3. **Resolve the PR:**
   - **With a PR number arg** (`/land 42`): `gh pr view <N> --json number,title,url,body,state,headRefName`. If `state` is not `OPEN`, stop: "PR #<N> is <state>, not open."
   - **Without:** resolve the open PR for the current branch (`gh pr view --json ...`). If none, stop: "No open PR found for branch `<branch>`. Open one with /ship first, or pass a PR number."
4. **Capture the linked issue** as `<issue>`: parse `Closes #N` / `Fixes #N` / `Resolves #N` / `Related to #N` from the PR body; fall back to the numeric second segment of `headRefName`. Verify it exists (`gh issue view <issue>`); unresolvable or missing → `<issue>` is empty and the Phase 5 stamp skips silently, per [the issue-log spec](../issue-log/SKILL.md).

### Phase 2: The CI gate

5. **Wait on the PR's existing checks** — `gh pr checks <N> --watch`, streaming status. (If the installed `gh` lacks `--watch`, poll `gh pr checks <N>` every 30s, capped at ~20 minutes, then halt and report if still unresolved; never silently busy-loop.)
6. Resolve the gate:
   - **All green** → Phase 3.
   - **No checks reported** → the local suite is the only gate: detect the repo's test command (`package.json` scripts, `Makefile`, `pytest.ini`, `Cargo.toml`, etc.) and run it. Green → Phase 3, noting "no CI on this PR — local suite gated." No test command detectable → Phase 3, noting the merge is ungated. **Red → halt** with the failing output.
   - **Any check failed** → **halt.** Pull the failing log (`gh run list --branch <headRefName> --limit 1 --json databaseId,conclusion`, then `gh run view <run-id> --log-failed`) and report it. `/land` pushes no fix commits — fix locally, push, and re-run `/land`.

### Phase 3: Merge

7. `gh pr merge <N> --squash --delete-branch`.
8. **Verify the merge actually happened** — `gh pr view <N> --json state,mergedAt`. On failure (branch protection, required reviews, conflicts): report the exact reason and stop; the PR stays open. Never claim "merged" on faith.

### Phase 4: Clean up and sync

9. **Worktree and local branch** (`gh pr merge --delete-branch` already removed the remote branch):
   - `git worktree list` — is `<headRefName>` checked out in a linked worktree?
   - **Worktree found, clean** (`git -C <path> status --short` empty, no `.git/MERGE_HEAD` or `.git/rebase-merge`): `git worktree remove <path>`, then `git branch -D <headRefName>`. If the directory is already gone from disk (stale metadata), `git worktree remove <path>` then `git worktree prune`.
   - **Worktree found, dirty or mid-merge/rebase:** leave the worktree **and** the branch exactly as they are and report both, with the manual commands (`git worktree remove <path>`, `git branch -D <headRefName>`) for when the user is done. Never `--force`.
   - **No worktree:** `git branch -D <headRefName>` (skip if the branch doesn't exist locally). If deletion fails, report the exact error and the manual command — don't fold it into a success report.
10. **Sync the default branch:** `git checkout main && git pull` (or `master`). If the checkout fails because another worktree holds `main`, fall back to `git fetch origin main:main`. Any other failure (network, auth) is a real error — report it; don't claim the ref is current.

### Phase 5: Stamp the issue

11. **Skip silently** when `<issue>` is empty; never stamp when the merge didn't succeed. Compose the body — 2-3 plain-language sentences on what shipped, drawn from the PR title and diff — write it to a temp file with the Write tool, and post per [the issue-log spec](../issue-log/SKILL.md)'s posting rules:
    ```markdown
    <!-- cc-forge-log v1: {"skill":"land","event":"pr-merged","pr":<N>} -->

    ### ✅ /land — PR #<N> merged

    <2-3 sentence summary of what landed>

    **Follow-ups:**
    - <known follow-up from this branch — omit the section when none>
    ```
12. **Report the final state:** merged, remote branch deleted, worktree removed or intentionally left (say which and why), `main` checked out or fetched, stamp posted or skipped. A failed stamp is one report line plus the manual command — the merge already succeeded; roll nothing back.

## Rules

- Manual only — `/land` is never wired to a git or CI hook, and never invoked by another skill.
- Operates on an **open** PR; refuse closed/merged PRs.
- **Zero prompts, zero pushes:** `/land` never commits, never pushes, never edits the PR, and never asks. The merge and the issue stamp are its only writes.
- **Red halts.** CI red or local-suite red stops the run with the real output; no fix commits, no masked failures, no retries.
- With CI present, no local tests run — the suite already ran in CI; with no checks reported, the local suite is the only gate.
- Merge is squash + delete branch, verified via `gh pr view` before any "merged" claim; a blocked merge reports its reason and leaves the PR open.
- Worktree cleanup is skip-never-force: a dirty or mid-operation worktree (and its branch) is left in place and reported.
- Depends on `gh`; if unavailable, stop and say so.
- On any failure, stop with a clear message and the true state — never a half-done cleanup reported as complete, never a false "merged" claim.
