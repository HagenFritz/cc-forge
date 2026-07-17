---
name: preview
description: Pull a /tree worktree branch's changes into the primary checkout for live testing, without restarting dev servers or reinstalling dependencies
disable-model-invocation: true
user-invocable: true
argument-hint: "<worktree branch name>"
allowed-tools: Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

Test a `/tree` worktree's changes against the primary checkout's already-running dev server, `node_modules`/`.venv`, and any local tunnels (e.g. a Cloud SQL proxy) — without switching the primary checkout to that branch, and without spinning up a second dev environment in the worktree itself.

Mechanism: create a disposable branch off the current default branch, **inside the primary checkout's own directory** (not a new worktree), merge the worktree branch's changes into it, and leave it checked out there for testing. The running dev server picks up the change on next reload since it's watching this same directory. `/unpreview` discards the disposable branch and returns to the default branch.

## Progress Tracking

Before starting, use `TaskList` to find any lingering tasks and delete them all with `TaskUpdate` (status: `deleted`). Then create fresh tasks upfront using `TaskCreate`. Mark each task `in_progress` when you start it and `completed` when done. Create these tasks:

1. "Resolve worktree branch" (activeForm: "Resolving branch...")
2. "Refresh base and check clean tree" (activeForm: "Checking preconditions...")
3. "Check for dependency/migration drift" (activeForm: "Checking drift...")
4. "Create preview branch and merge" (activeForm: "Merging for preview...")

## Steps

1. **Determine the repository root.** Run `git rev-parse --show-toplevel`. This must be the primary checkout, not a worktree — if `git rev-parse --git-common-dir` resolves to a path other than `<toplevel>/.git`, tell the user: "You're inside a worktree. Run /preview from the primary checkout." and stop.

2. **Resolve the target branch.**
   - `$ARGUMENTS` should name the worktree's branch (e.g. `feat/171/committed-actions`). If empty, run `git worktree list` and ask the user (`AskUserQuestion`) which worktree's branch to preview, listing each worktree's path and branch.
   - Confirm the branch exists: `git branch --list <branch>`. If it doesn't, stop and report — do not guess a similar name.
   - If the current checkout is already on a `preview/*` branch (a prior `/preview` never got `/unpreview`'d), tell the user and ask whether to `/unpreview` first or abort.

3. **Detect the default branch and refresh it.** `git rev-parse --abbrev-ref origin/HEAD` (strip `origin/`), falling back to `main`. Then refresh the base so the preview builds on current origin, not a stale local ref: `git fetch origin <default-branch>`. If the fetch fails for a real reason (network, auth, no `origin`), warn but don't block — note the base may be stale. Branch off `origin/<default-branch>` in step 5 (not the bare local name), so the preview reflects what's actually on origin regardless of how far behind the local ref is.

3b. **Refresh the target branch and pick the merge source.** `git fetch origin <branch>` (ignore failure if the branch was never pushed). If `origin/<branch>` exists and is **ahead of** the local `<branch>` (e.g. review fixes pushed from another machine in the remote-review flow), use `origin/<branch>` as the **merge source** in step 5 and tell the user the preview includes N remotely-pushed commits the local worktree doesn't have yet. The worktree's local ref is never touched — it fast-forwards later (`/land` does this itself). If the refs have diverged, warn and let the user pick which to preview. Otherwise the merge source is the local `<branch>`.

3a. **Require a clean primary checkout.** Run `git status --porcelain`. If non-empty, the primary checkout has uncommitted changes that `git checkout -b` would carry onto the preview branch and commingle into the merge (and the running dev server would live-serve them, indistinguishable from the branch under test). Show the output and use `AskUserQuestion`: **Stash and continue** (description: "git stash the changes, preview clean, restore with git stash pop after /unpreview") / **Cancel** (description: "Let me commit or handle these first"). On Stash, run `git stash push -u` and remember to remind the user to `git stash pop` after `/unpreview`. On Cancel, stop.

4. **Check for dependency/migration drift before merging anything.**
   - Diff the merge source (per step 3b) against the freshly-fetched default branch for manifest and migration files: `git diff origin/<default-branch>...<merge-source> --name-only` and check the result against common patterns — `package.json`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `pyproject.toml`, `uv.lock`, `poetry.lock`, `requirements*.txt`, and any path containing `migrations/` or `alembic/`.
   - **If any matched**: list the matched files and warn explicitly: "This branch changes dependencies or migrations. Testing here won't install/migrate them — the running dev server will use the primary checkout's current environment, not what this branch expects. You may see false-positive successes or unrelated failures." Use `AskUserQuestion`: **Preview anyway** (description: "I'll handle deps/migrations manually if needed") / **Cancel** (description: "Don't preview until I've reviewed the drift").
   - **If none matched**: proceed without asking — pure code change, safe to preview as-is.

5. **Create the preview branch and merge.**
   - Compute `<slug>`: the target branch name with `/` replaced by `-` (e.g. `preview/feat-171-committed-actions`).
   - **Check for a colliding preview branch first**: `git branch --list preview/<slug>`. If it exists (a leftover from an abandoned session, or two source branches that slugify to the same name — `feat/171/committed-actions` and `feat/171-committed-actions` both → `preview/feat-171-committed-actions`), don't let `checkout -b` fail with a bare `fatal:`. Surface it and use `AskUserQuestion`: **Discard the old preview branch** (description: "git branch -D it and recreate — only safe if you have no uncommitted work relying on it") / **Cancel** (description: "Let me /unpreview or inspect it first"). On Cancel, stop.
   - `git checkout -b preview/<slug> origin/<default-branch>` — off the freshly-fetched origin ref from step 3, not the local ref.
   - `git merge --no-ff <merge-source>` (the local branch, or `origin/<branch>` per step 3b). This is a real commit on the disposable `preview/*` branch — never touches `<default-branch>` or the worktree's own branch.
   - **On merge conflict**: report the conflicting files and stop. Do not attempt to auto-resolve. Tell the user: "Resolve the conflict manually, or run `/unpreview` to abort and return to `<default-branch>`."
   - **On any other merge failure** (non-zero exit that isn't a conflict — interrupted, disk full, a pre-existing `MERGE_HEAD`, a refusal over local changes): do not report success. Report the raw git output, run `git merge --abort` to leave the disposable branch in a clean state (safe — it's disposable), and tell the user to re-run `/preview` or `/unpreview`. Never claim "previewing branch X" when the merge did not actually land.

6. **Output next steps:**
   ```
   Previewing `<branch>` on disposable branch `preview/<slug>`.
   Your dev server (already running in this directory) will pick up the change on next reload — no restart needed.

   When done:
     /unpreview     # discards preview/<slug>, returns to <default-branch>

   To go back to editing the worktree, just switch terminals/sessions — the worktree itself was never touched.
   ```
   If step 3a stashed uncommitted changes, add: "Your primary-checkout changes were stashed — run `git stash pop` after `/unpreview` to restore them."

## Rules

- Never run this from inside a worktree — only from the primary checkout.
- Never merge directly onto the default branch — always via a disposable `preview/*` branch.
- Never modify the worktree or its branch — `/preview` only reads from it (via merge).
- Do not install dependencies, run migrations, or restart the dev server — that's the user's call after being warned about drift.
- Do NOT push the `preview/*` branch anywhere.
- If a merge conflict occurs, stop and report — do not auto-resolve.
