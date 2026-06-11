---
name: land
description: "Stamp merged-PR context into a directory-level CLAUDE.md after a PR lands. Manual post-merge step: resolves the merged PR, lets you pick the directory it most affected, prepends a capped provenance entry (PR + plan link + a one-line summary it writes) to that directory's CLAUDE.md Related section, and refreshes the body prose to match the merge. Use when the user says 'land this', 'land the PR', 'stamp this merge', 'update the CLAUDE.md after merge', 'log the merge', or invokes /land. Runs after a PR is merged, not at merge time."
argument-hint: "[optional PR number]"
allowed-tools: Bash, AskUserQuestion, Read, Edit, Write, Grep, Glob
---

# Land — Post-Merge Directory Context Stamper

**Note: The current year is 2026.**

`/land` runs **after** a PR is merged. It records why a directory looks the way it does by stamping a bounded provenance trail (PR → plan → one-line summary) into that directory's `CLAUDE.md` `## Related` section and refreshing the file's body prose to match the merge. All output lands as **uncommitted edits** you review — `/land` never commits, pushes, or writes to GitHub.

This is the post-merge companion to `/ship` (which runs at merge time).

## Core Principles

1. **The CLAUDE.md is the state.** A botched parse corrupts the only record. Always show the full diff before finishing; prefer surgical `Edit` over full `Write`. Never partial-write on a failure path — stop with a clear message instead.
2. **One directory per run.** A PR may touch many directories; you stamp exactly one, chosen deliberately by the user. Changes outside it do not force extra stamps.
3. **The summary is the carried context.** The one-line summary matters more than the links. Draft it from the PR, but let the user edit it before it lands.
4. **Reviewable, revertible.** Everything lands uncommitted so the user can reject the whole change with one `git checkout`.

## Workflow

### Phase 1: Safety and PR resolution

1. Verify `gh` is available (`gh --version`). If not, stop with: "GitHub CLI (`gh`) is required for /land. Install it and re-run."
2. Run `git rev-parse --show-toplevel` to get the repository root. Scope all git/`gh` operations to this repo.
3. Detect `<owner>/<repo>` from `git remote get-url origin`.
4. **Resolve the merged PR.** `/land` only stamps *merged* PRs — that guarantees real provenance and a plan that was built off of. Branches are auto-deleted on merge in these repos, so do **not** rely on the current branch name.
   - **If a PR number arg was passed** (`/land 42`): `gh pr view <N> --json number,title,url,body,mergedAt,headRefName`. If the PR is not merged (`mergedAt` is null), stop with: "PR #<N> is not merged yet. /land only stamps merged PRs." Otherwise this is the resolved PR — go to step 5.
   - **Otherwise**: list the most recently merged PRs:
     `gh pr list --state merged --json number,title,url,body,mergedAt --limit 5` (results come back newest-merged first).
     - If the list is empty, stop with: "No merged PRs found in this repo. Merge a PR first, then run /land."
     - The newest entry is the default candidate (the one you most likely just merged).
5. **Confirm the PR** with `AskUserQuestion` before any file edit — this matters because the candidate comes from recency, not a branch-exact match.
   - When resolved from an arg: a single confirm question with the PR in a `preview`.
   - When resolved from the recents list: a single-select of the recent merged PRs, newest first, each option showing `#<N> — <title>` and its `mergedAt`. The newest is presented first as the natural pick. Selecting one resolves it.
   - Preview format:
     ```
     PR #<N>: <title>
     merged <mergedAt>
     <url>
     ```
   - Always offer **Cancel**. On Cancel, stop with "Cancelled — no changes made."

### Phase 2: Choose the target directory

5. Get the files the PR touched: `gh pr diff <N> --name-only`.
6. Bucket files by their containing directory (the leaf directory of each changed file). Rank directories by number of changed files, descending. Files at the repo root (e.g. `README.md`) bucket under the repo root itself — offer it as a candidate (stamping the root `CLAUDE.md`).
7. Present the ranked directories with `AskUserQuestion` (single-select). Show the **full absolute path** of each candidate. Do not pre-apply a default — the user picks one deliberately. If a chosen leaf directory has no natural `CLAUDE.md` home, its parent directory is an acceptable choice; offer parents when useful.
8. The selected directory is the target. Its `CLAUDE.md` path is `<dir>/CLAUDE.md`.

### Phase 3: Build the entry

9. **Locate the plan**, in order — stop at the first hit:
   - An explicit plan path the user supplied this session.
   - A file under `docs/plans/` whose name matches the PR's issue number or the PR's `headRefName` slug (glob `docs/plans/*<issue-or-slug>*`).
   - A plan path referenced in the PR body.
   - If none found, fall back to the issue link (parse the issue from the PR body's `Closes #N` / `Fixes #N`).
   - Never link a review document.
10. **Draft the one-line summary** from the PR title plus the diff stat (`gh pr diff <N> --stat`). Keep it to one line describing what changed and why.
11. **Compose the entry** as a single Markdown list item, newest-first:
    - With a plan: `- **PR #<N>**: <summary> — [plan](<plan-path>)`
    - Without a plan: `- **PR #<N>**: <summary> — closes #<issue>` (omit the trailing clause entirely if there's no issue either).
12. Show the drafted entry to the user and let them edit the summary inline before it lands.

### Phase 4: Update the CLAUDE.md

13. **If `<dir>/CLAUDE.md` does not exist:** confirm the full path with `AskUserQuestion`, then `Write` a minimal scaffold:
    ```markdown
    # <Directory name>

    ## Related
    ```
14. **Locate the `## Related` heading** in the file. If absent, create it (append it after the title / at the end of the file). The list under it is exactly the contiguous top-level `- ` lines immediately following the heading; it ends at the first blank line or next heading. Treat only those lines as the list.
15. Each entry is a **single-line** list item (no sub-bullets, no notes between entries). **Prepend** the new entry directly under `## Related`, then **truncate the list to the newest 10 entries** (drop the oldest). Use surgical `Edit` on that block only.
16. **Refresh the body prose (R6):** read the rest of the file and apply targeted edits so it reflects the merge. Scope this conservatively — **correct statements the merge contradicts and add facts the diff clearly establishes; do not invent invariants or speculate.** No per-edit confirmation here.

### Phase 5: Review

17. Show the full before/after diff: `git diff -- <dir>/CLAUDE.md`.
18. Tell the user they can revert everything in one step: `git checkout -- <dir>/CLAUDE.md`.
19. **Stop.** Do not commit, push, or run any `gh` write command.

## Rules

- Manual only — `/land` is never wired to a git or CI hook.
- Exactly one target directory per run.
- No review-document links in entries; `## Related` is capped at 10, newest-first.
- Never `git add`, commit, push, or call a `gh` write command.
- Depends on `gh`; if `gh` is unavailable, stop and say so rather than guessing.
- On any failure (no merged PR, no touched dirs, scaffold declined), stop with a clear message — never leave a `CLAUDE.md` partially written.
- Plan links live under `docs/plans/` (gitignored in some repos) and may be local-only; record the path regardless.
