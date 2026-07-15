---
name: unpreview
description: Discard a /preview session's disposable branch and return the primary checkout to the default branch
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

Clean up after `/preview`: return the primary checkout to the default branch and delete the disposable `preview/*` branch that held the merged-in changes. The worktree and its branch are untouched by this — they were never part of the preview branch's lifecycle.

## Progress Tracking

Before starting, use `TaskList` to find any lingering tasks and delete them all with `TaskUpdate` (status: `deleted`). Then create fresh tasks upfront using `TaskCreate`. Mark each task `in_progress` when you start it and `completed` when done. Create these tasks:

1. "Confirm preview branch" (activeForm: "Confirming...")
2. "Check for committed work to lose" (activeForm: "Checking commits...")
3. "Return to default branch" (activeForm: "Switching back...")
4. "Delete preview branch" (activeForm: "Cleaning up...")

## Steps

1. **Determine the repository root.** Run `git rev-parse --show-toplevel`. Must be the primary checkout — if `git rev-parse --git-common-dir` resolves to a path other than `<toplevel>/.git`, stop and tell the user to run this from the primary checkout.

2. **Confirm there's a preview branch to clean up.**
   - `git branch --show-current`. If it does not start with `preview/`, tell the user: "Not currently on a preview branch (`<current>`). Nothing to unpreview." and stop.
   - If it does, capture the branch name as `<preview-branch>`.

3. **Check for uncommitted changes on the preview branch.**
   - `git status --porcelain`. If non-empty, show the output and ask via `AskUserQuestion`: **Discard and continue** (description: "Lose these uncommitted changes — they only exist on the disposable preview branch anyway") / **Cancel** (description: "Stop here so I can commit or stash first").
   - On Cancel, stop without switching branches.

4. **Detect the default branch.** `git rev-parse --abbrev-ref origin/HEAD` (strip `origin/`), falling back to `main`.

5. **Check for committed work on the preview branch that isn't on the default branch.** `git log <default-branch>..<preview-branch> --oneline`. If non-empty, the preview branch carries commits beyond the disposable `--no-ff` merge — most likely a quick fix you committed directly here while testing. `git branch -D` in step 6 would force-delete them (recoverable only via reflog). Show the commit list and ask via `AskUserQuestion`: **Discard these commits** (description: "Force-delete the branch — these commits are lost unless recovered from reflog") / **Cancel** (description: "Stop so I can cherry-pick or move these commits somewhere first"). On Cancel, stop without switching branches. (The merged-in worktree branch's own commits are safe regardless — they live on the worktree branch, not here.)

6. **Return and clean up.**
   - `git checkout <default-branch>` (add `-f` only if step 3 confirmed discarding uncommitted changes).
   - `git branch -D <preview-branch>`.

7. **Report:** "Back on `<default-branch>`, deleted `<preview-branch>`. The worktree this preview came from is untouched — switch back to it whenever you're ready to keep editing."

## Rules

- Only ever deletes branches under `preview/*` — never touches the default branch's history or any `/tree` worktree branch.
- Never force-checkout without explicit confirmation when there are uncommitted changes.
- If not currently on a `preview/*` branch, this is a no-op — report and stop, don't guess what to clean up.
