---
name: catch-up
description: >
  Fast-forward a /tree worktree branch to pick up commits pushed from another machine
  (the remote-review flow — review fixes pushed by /push-review from a devbox VM), then
  report what arrived: incoming commits, files changed, and review-doc Status deltas.
  Read-only context rebuild — it pulls and summarizes, it does not commit, edit, or land.
  Run it in the worktree session before /land so the session knows what the VM did.
  Triggers on "catch up", "catch-up", "pull the review fixes", or being run in a worktree
  before /land.
user-invocable: true
disable-model-invocation: true
allowed-tools: Bash, AskUserQuestion, Read, Grep, Glob
---

# Catch Up

Bring a `/tree` worktree's local branch level with the PR branch on origin — picking up review fixes pushed from the review machine (`/push-review` on a devbox VM) — and rebuild this session's mental model of what changed while it was idle. This is the pre-land step in the remote-review flow (Model B): after the VM pushes fixes, run `/catch-up` in the worktree so `/land` operates on the real, current branch and you know what you're about to merge.

Read-only beyond the fast-forward itself: it fetches, fast-forwards, and reports. It never commits, edits the review doc, resolves conflicts, or invokes `/land`.

## Core Principles

1. **Fast-forward only.** The worktree hasn't diverged in the normal flow — it shipped the PR, then went idle while the VM pushed. A clean ff is expected. A divergence means something wrote to the branch from two places; stop and surface it rather than papering over it with a merge.
2. **Report the delta, not just success.** The point is context: what commits landed, what files they touched, which review findings they resolved. "Pulled 3 commits" alone is useless — say what they were.
3. **Don't act on what you find.** This skill ends by handing the user an informed decision (usually "run /land"). It does not chain into landing, verification, or edits.

## Workflow

### Phase 1: Locate and validate

1. `git rev-parse --show-toplevel` for the checkout root. This is expected to be a **worktree**, not the primary checkout — `git rev-parse --git-common-dir` resolving to something other than `<toplevel>/.git` is the normal case here, not an error. (It still works from the primary checkout if that's where the branch lives; don't hard-block on it.)
2. `git branch --show-current`. If on `main`/`master`, stop: "You're on the default branch. /catch-up fast-forwards a feature branch to pick up remotely-pushed fixes — check out the PR branch first." Capture `<branch>`.
3. **Require a clean tree.** `git status --porcelain`. If non-empty, a fast-forward is unsafe (uncommitted work could block the checkout, or you'd conflate local edits with incoming ones). Show the output and stop: "Uncommitted changes in the worktree — commit, stash, or discard them, then re-run /catch-up." Do not stash automatically; the user may be mid-edit deliberately.

### Phase 2: Fetch and assess

4. `git fetch origin <branch>`. If it fails because the branch was never pushed (`origin/<branch>` doesn't exist), stop: "`origin/<branch>` doesn't exist — nothing to catch up to. Did the PR get shipped/pushed?"
5. Compare local `HEAD` to `origin/<branch>`:
   - **Up to date** (`git rev-parse HEAD` == `git rev-parse origin/<branch>`): report "Already current with `origin/<branch>` — nothing to pull." and stop. (Still surface the review doc's Status counts per Phase 4 so the session has that context, then stop.)
   - **Local behind, fast-forwardable** (`git merge-base --is-ancestor HEAD origin/<branch>`): the normal case. Proceed to Phase 3.
   - **Local ahead of remote** (`git merge-base --is-ancestor origin/<branch> HEAD`): the worktree has commits the remote doesn't — nothing to pull, but flag it: "This worktree is ahead of `origin/<branch>` by N commits — the remote didn't advance. If you expected review fixes, they weren't pushed. Nothing to fast-forward." and stop.
   - **Diverged** (neither is an ancestor of the other): stop and surface it — "Local `<branch>` and `origin/<branch>` have diverged (local +A / remote +B commits). Both sides committed. Reconcile manually (`git pull --rebase origin <branch>`) — /catch-up won't auto-merge." Show `git log --oneline --left-right HEAD...origin/<branch>`.

### Phase 3: Fast-forward and capture the delta

6. Before moving `HEAD`, capture the incoming range for the report: `git log --oneline HEAD..origin/<branch>` (the commits about to arrive) and `git diff --stat HEAD..origin/<branch>` (files they touch).
7. `git merge --ff-only origin/<branch>`. On failure (should not happen after the Phase 2 ff-check, but disk/hook issues exist), report the raw output and stop — do not fall back to a non-ff merge.

### Phase 4: Report the context

8. Read the newest review doc for this branch if present (`ls docs/reviews/*.md | sort | tail -1`, or a doc whose `target:` matches the branch/PR). Parse `Status:` lines and count `done` / `deferred` / `wont-fix` / still-`open`. The doc is gitignored and local to whichever machine ran the walk — in the remote-review flow it lives on the **VM**, so it's usually **absent** in the worktree. Absence is expected; note it plainly ("review doc not present in this checkout — it's on the review machine; the PR comment from /push-review has the outcomes") rather than treating it as an error.
9. **Present the catch-up summary:**
   ```markdown
   Caught up `<branch>` → origin (fast-forwarded N commits).

   ### Incoming commits
   - <sha> <subject>
   - ...

   ### Files changed
   <the --stat output, or a tight summary of it>

   ### Review outcomes
   - From the review doc (if present): X fixed, Y deferred, Z skipped.
   - Or: "Review doc not in this checkout — see the PR comment posted by /push-review for the fix summary."
   ```
10. **End with the handoff, not an action:** "Worktree is now current. Next: `/land` to verify CI and merge." Do not invoke `/land` — leave it to the user. (`/land` no longer syncs the branch itself, so this catch-up is the sync in the remote-review flow.)

## Rules

- Fast-forward only — never a non-ff merge, never a rebase, never force anything. Divergence is a hard stop with a manual-reconcile message.
- Read-only apart from moving the branch ref forward: no commits, no edits to the review doc or any file, no `/land` chaining.
- Require a clean working tree before fast-forwarding; never auto-stash.
- Report the actual delta (commits + files + review outcomes), not a bare success line.
- The review doc is usually absent in the worktree (it's on the review machine) — treat absence as normal, point at the PR comment instead.
