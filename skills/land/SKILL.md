---
name: land
description: "Stamp PR context into a directory-level CLAUDE.md and commit it onto the open PR's branch — run just before you merge, so the doc update rides the same PR. Resolves the open PR for the current branch, lets you pick the directory it most affected, prepends a capped provenance entry (PR + plan link + a one-line summary it writes) to that directory's CLAUDE.md Related section, refreshes the body prose, then commits and pushes to the branch. Use when the user says 'land this', 'land the docs', 'stamp the PR', 'update the CLAUDE.md before merge', 'land the CLAUDE.md', or invokes /land. Runs on an open PR before merge, not after."
argument-hint: "[optional PR number]"
allowed-tools: Bash, AskUserQuestion, Read, Edit, Write, Grep, Glob
---

# Land — Pre-Merge Directory Context Stamper

**Note: The current year is 2026.**

`/land` runs on an **open PR, just before you merge it**. It records why a directory looks the way it does by stamping a bounded provenance trail (PR → plan → one-line summary) into that directory's `CLAUDE.md` `## Related` section, refreshing the file's body prose to match the change, then **committing and pushing the update to the PR's branch** so the doc change merges as part of the same PR — no orphaned follow-up PR.

Typical flow: open the PR with `/ship` → run tests, push fixes → when you're ready to merge, run `/land` to fold the CLAUDE.md update into the PR → merge in the GitHub UI.

## Core Principles

1. **The CLAUDE.md is the state.** A botched parse corrupts the only record. Always show the diff and confirm before committing; prefer surgical `Edit` over full `Write`. Never partial-write on a failure path — stop with a clear message instead.
2. **One directory per run.** A PR may touch many directories; you stamp exactly one, chosen deliberately by the user. Changes outside it do not force extra stamps.
3. **The summary is the carried context.** The one-line summary matters more than the links. Draft it from the PR, but let the user edit it before it lands.
4. **The doc rides the PR.** The whole point is to commit the update onto the open PR's branch before merge, so it lands atomically with the code it describes.

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
11. **Draft the one-line summary** from the PR title plus the diff stat (`gh pr diff <N> --stat`). Keep it to one line describing what changed and why.
12. **Compose the entry** as a single Markdown list item, newest-first:
    - With a plan: `- **PR #<N>**: <summary> — [plan](<plan-path>)`
    - Without a plan: `- **PR #<N>**: <summary> — closes #<issue>` (omit the trailing clause entirely if there's no issue either).
13. Show the drafted entry to the user and let them edit the summary inline before it lands.

### Phase 4: Update the CLAUDE.md

14. **If `<dir>/CLAUDE.md` does not exist:** confirm the full path with `AskUserQuestion`, then `Write` a minimal scaffold:
    ```markdown
    # <Directory name>

    ## Related
    ```
15. **Locate the `## Related` heading** in the file. If absent, create it (append it after the title / at the end of the file). The list under it is exactly the contiguous top-level `- ` lines immediately following the heading; it ends at the first blank line or next heading. Treat only those lines as the list.
16. Each entry is a **single-line** list item (no sub-bullets, no notes between entries). **Prepend** the new entry directly under `## Related`, then **truncate the list to the newest 10 entries** (drop the oldest). Use surgical `Edit` on that block only.
17. **Refresh the body prose:** read the rest of the file and apply targeted edits so it reflects the change. Scope this conservatively — **correct statements the change contradicts and add facts the diff clearly establishes; do not invent invariants or speculate.**

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
    - **Report the actual outcome.** Only on a successful push: "Stamped CLAUDE.md and pushed to PR #<N>. Merge when ready." If the push fails, do **not** claim success — report: "Committed locally but the push failed — the stamp is NOT on PR #<N> yet. Resolve the push (e.g. `git pull --rebase origin <headRefName>`) and `git push`, or `git reset --soft HEAD~1` to undo the commit."
21. **Stop.** Do not merge the PR — the user merges in the UI when ready.

## Rules

- Manual only — `/land` is never wired to a git or CI hook.
- Stamps an **open** PR before merge; refuse closed/merged PRs (those would orphan into a follow-up PR — the exact problem this avoids).
- Exactly one target directory per run.
- No review-document links in entries; `## Related` is capped at 10, newest-first.
- Commit only the single CLAUDE.md file — never `git add -A`/`.`, never `--no-verify`. Push to the current branch only; never merge.
- Do not push to `main`/`master`; only ever push the feature branch.
- Depends on `gh`; if `gh` is unavailable, stop and say so rather than guessing.
- On any failure (no open PR, no touched dirs, scaffold declined), stop with a clear message — never leave a `CLAUDE.md` partially written or a half-made commit.
- Plan links live under `docs/plans/` (gitignored in some repos) and may be local-only; record the path regardless.
