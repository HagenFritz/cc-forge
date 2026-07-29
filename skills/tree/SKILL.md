---
name: tree
description: Create a git worktree for an issue or task on its own branch, in a sibling directory, ready for a dedicated Claude Code session
disable-model-invocation: true
user-invocable: true
argument-hint: "[issue-number]"
allowed-tools: Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

Create a git worktree — a second working directory attached to the same repo, checked out to its own new branch — so this piece of work can be developed without checking out a different branch in the primary checkout (which stays on `main`). One worktree per branch. When the branch is merged, `/land` removes the worktree.

The one exception: if the primary checkout already has the default branch checked out when this runs, step 2 fast-forwards it with `git pull` to keep it current — a benign mutation of already-`main` content, not a branch switch.

Branch naming follows the exact convention as `/branch-from-issue`: `{prefix}/{issue-number}/{short-description}` (or `{prefix}/{short-description}` with no issue number). Worktree storage: `../{repo-name}-worktrees/{branch-name}/`, a sibling of the primary checkout.

## Progress Tracking

Before starting, use `TaskList` to find any lingering tasks and delete them all with `TaskUpdate` (status: `deleted`). Then create fresh tasks upfront using `TaskCreate`. Mark each task `in_progress` when you start it and `completed` when done. Create these tasks:

1. "Sync main" (activeForm: "Syncing main...")
2. "Resolve branch context" (activeForm: "Resolving context...")
3. "Construct branch name" (activeForm: "Building branch name...")
4. "Create worktree" (activeForm: "Creating worktree...")
5. "Symlink docs directory" (activeForm: "Linking docs...")

## Steps

1. **Determine the repository root and name.**
   - Run `git rev-parse --show-toplevel` to get the primary checkout's root. This must be the primary checkout, not an existing worktree — if `git rev-parse --git-common-dir` resolves to a path other than `<toplevel>/.git`, you're already inside a worktree; tell the user: "You're already inside a worktree. Run /tree from the primary checkout." and stop.
   - The repo name is the basename of the toplevel path.

2. **Sync main.**
   - Run `git remote` to check if a remote exists. If none, skip this step.
   - Detect the default branch name (`main` or `master`) from `git rev-parse --abbrev-ref origin/HEAD` (strip the `origin/` prefix), falling back to `main` if that fails.
   - `git fetch origin {default-branch}`. This only updates the `origin/{default-branch}` remote-tracking ref — no `:{default-branch}` destination — so it never touches the local branch and can't collide with any worktree that has `{default-branch}` checked out, including the primary checkout itself. Step 8 branches off `origin/{default-branch}` directly, so this fetch alone is sufficient. If it fails, that's a real error (network, auth, no such remote branch); report it and stop before creating the worktree from a possibly stale ref.
   - Additionally, if the current branch is already `{default-branch}` (`git rev-parse --abbrev-ref HEAD`), also run `git pull` — this refreshes the primary checkout's working files, a benefit the remote-tracking fetch alone doesn't provide. This is additive to the fetch above, not a substitute for it.
   - Sanity check: run `git worktree list` and check whether any entry other than the primary checkout has `{default-branch}` itself checked out (as opposed to its own feature branch). If so, warn the user this is anomalous — normal `/tree` usage never leaves a worktree parked on the default branch — but don't block on it.

3. **Resolve branch context.** `$ARGUMENTS` may or may not contain an issue number.
   - **If an issue number is provided:** detect `<owner>/<repo>` from `git remote get-url origin`, then run `gh issue view $ARGUMENTS --repo <owner>/<repo>` to get the issue title and description. **If this fails** (issue doesn't exist, wrong repo, no access), tell the user the issue number couldn't be resolved and ask whether to stop or proceed without an issue link (falling back to the no-argument path below) — never fabricate an issue title. Otherwise use the fetched title/description to determine the **prefix** and **short description**.
   - **If no argument is provided:** derive the **prefix** and **short description** from conversation context (what the user is working on, recent discussion, file changes, etc.). The branch name will use the format `{prefix}/{short-description}` (no issue number segment). Skip step 10 (no issue comment to post).

4. **Determine the prefix** based on the nature of the work:
   - `feat/` — new feature or enhancement
   - `bugfix/` — non-urgent bug fix
   - `hotfix/` — urgent production fix
   - `refactor/` — code restructuring without behavior change
   - `chore/` — maintenance, dependencies, config
   - `test/` — adding or updating tests
   - `docs/` — documentation only

5. **Construct the branch name:**
   - With issue: `{prefix}/{issue-number}/{short-description}` (e.g. `feat/171/committed-actions`)
   - Without issue: `{prefix}/{short-description}` (e.g. `feat/read-issue-auto-repo`)
   - The description must be 2–4 words, lowercase, hyphen-separated
   - The **worktree path** is `../{repo-name}-worktrees/{branch-name}` (relative to the primary checkout's parent directory)

6. **Check for stale branch or worktree.**
   - Run `git branch --list {branch-name}` — if it exists locally, warn the user: "A branch named `{branch-name}` already exists locally."
   - Check if the worktree path already exists on disk (`ls` or equivalent).
   - If either exists, use `AskUserQuestion`:
     - **Use a different name** (description: "Type a new branch name") — allow Other input
     - **Cancel** (description: "Abort without creating anything")
   - If user provides a different name, use that instead and loop back to this check.

7. **Confirm with the user.**
   - Use `AskUserQuestion` to show the proposed branch name and worktree path, and ask:
     > "Ready to create this worktree?"
     - Options:
       - **Create it** (description: "Create the branch and worktree")
       - **Cancel** (description: "Abort without creating anything")
     - Also allow "Other" for the user to type a different branch name
   - If user cancels, stop.
   - If user provides a custom name via Other, use that instead (recompute the worktree path too).

8. **Create the worktree:** `git worktree add {worktree-path} -b {branch-name} origin/{default-branch}`
   - Branches off the fetched remote-tracking ref, not the local `{default-branch}`, so the new worktree always gets the state fetched in step 2 regardless of what the local ref points to or which worktree owns it.
   - This does not touch the primary checkout's working files or currently-checked-out branch.

9. **Symlink `docs/` into the worktree.** Gitignored doc subdirs (brainstorms, plans, reviews, etc.) are not materialized by `git worktree add`, so the brainstorm/blueprint files this work depends on would be invisible from the worktree. Two cases, decided by what `git worktree add` produced:
   - **`docs/` fully gitignored** (no `docs/` in the worktree, or an empty one — `rmdir` the empty one): symlink the whole directory — `ln -s {primary-checkout-root}/docs {worktree-path}/docs`. Verify with `[ -L {worktree-path}/docs ]`.
   - **`docs/` partially tracked** (the worktree's `docs/` has tracked content — a symlink can't replace a real directory, and deleting tracked files would show as deletions on the branch): symlink each missing subdir instead. For every top-level subdirectory of `{primary-checkout-root}/docs/` that does **not** exist in `{worktree-path}/docs/` (absent = gitignored), run `ln -s {primary-checkout-root}/docs/{subdir} {worktree-path}/docs/{subdir}`. Verify each with `[ -L ]`. Tracked subdirs stay branch-local real directories — never symlink over them. The symlinks sit at gitignored paths, so git never sees them.
   - **On any `ln -s` failure** (permissions, disk full, cross-device), do not silently continue: note exactly which links are missing so step 11's output reflects it.
   - Whole-dir case: subdirectories created later (e.g. a new `docs/handoff/` entry) are visible automatically. Per-subdir case: a doc subdir created in the primary **after** this worktree needs its own symlink — note this in step 11's output. Removing the worktree (`git worktree remove`, which `/land` calls on merge) deletes the symlinks and leaves the primary checkout's real `docs/` untouched.

10. **Post an issue-log stamp on the GitHub issue** (only if an issue number was provided). Compose the body below, write it to a temp file with the Write tool, and post per [the issue-log spec](../issue-log/SKILL.md)'s posting rules:
    ```markdown
    <!-- cc-forge-log v1: {"skill":"tree","event":"worktree-created","paths":["{absolute-worktree-path}"]} -->

    ### 🌳 /tree — worktree created

    **Branch:** `{branch-name}`
    **Worktree:** `{absolute-worktree-path}`
    ```
    ```bash
    gh issue comment $ARGUMENTS --repo <owner>/<repo> --body-file <temp-file>
    ```

11. **Output next steps.** If every step-9 symlink was verified present:
    ```
    Worktree created:
      {absolute-worktree-path}

    Next:
      cd {absolute-worktree-path}
      claude
    ```
    Recommend starting a fresh Claude Code session in the new directory rather than continuing in this one — the session's project context (CLAUDE.md, skills, memory) is resolved from cwd, and a dedicated session keeps it matched to this branch alone.

    In the per-subdir case, list which subdirs were symlinked and add: "A doc subdir created in the primary later won't auto-appear here — symlink it the same way if needed."

    If any symlink was **not** verified (step 9 failed), print the same block but replace "Next:" with a warning first: "Worktree created, but the `docs/` symlink(s) failed — these files won't be visible from this worktree until you create the link(s) manually: `<the exact ln -s command(s)>`." Then the same `cd` / `claude` next steps.

## Rules

- Always detect the repository from the current git directory — never hardcode a repo
- Must be run from the primary checkout, never from inside an existing worktree
- Always branch from the up-to-date default branch, never from arbitrary HEAD
- The short description must be 2–4 words, kebab-case
- One worktree per branch — never reuse an existing worktree for a new branch
- Do NOT push the branch (that's what /ship is for)
- Do NOT remove worktrees (that's what /land does on merge)
