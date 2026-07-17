---
name: push-review
description: >
  After /review-walk, commit the applied review fixes, push them onto the PR branch,
  and post a PR comment summarizing what was fixed, deferred, and skipped — sourced from
  the review doc's Status lines. This is the remote-review handoff: it puts the
  review-item context on the PR so the machine that lands it (and any human reviewer)
  can see exactly what each finding turned into. Triggers on "push the review fixes",
  "push-review", or being run right after /review-walk on a PR branch.
user-invocable: true
disable-model-invocation: true
argument-hint: "[path to docs/reviews/*.md]"
allowed-tools: Bash, AskUserQuestion, Read, Grep, Glob
---

# Push Review

Take the fixes `/review-walk` just applied and (1) commit + push them onto the open PR branch, and (2) post a PR comment that maps each review finding to its outcome. Built for the remote-review flow (Model B): `/deep-review` → `/review-walk` → **`/push-review`**, all in one session on the review machine (e.g. a devbox VM). The review doc is local and gitignored; the PR comment is how its context reaches the branch and the landing machine.

This skill **reads** the review doc — it never edits it. `/review-walk` owns the `Status:` lines; `/push-review` only reports them.

## Core Principles

1. **The review doc is the source of truth for outcomes.** What was fixed / deferred / skipped comes from the doc's `Status:` lines, not from guessing at the diff.
2. **One writer per phase.** This runs on the review machine and pushes to the PR branch. The worktree that shipped the PR is untouched; it fast-forwards later (via `/catch-up` or `/land`).
3. **Report the real outcome.** Only claim "pushed" after the push succeeds. If nothing was fixed, say so and don't invent a commit.
4. **The PR comment is the carried context.** It's what a human reviewer and the landing machine read to understand what the review produced — write it for them, not as a log dump.

## Workflow

### Phase 1: Preconditions

1. Verify `gh` is available (`gh --version`). If not, stop: "GitHub CLI (`gh`) is required for /push-review."
2. `git rev-parse --show-toplevel` for the repo root; scope all operations to it.
3. `git branch --show-current`. If on `main`/`master`, stop: "You're on the default branch. /push-review pushes onto a PR's feature branch — check out the PR branch first (or run this on the machine where /review-walk ran)."
4. **Resolve the open PR for this branch:** `gh pr view --json number,title,url,state,headRefName`. If no open PR, stop: "No open PR found for `<branch>`. /push-review pushes review fixes onto an existing PR — open one with /ship first." If `state` isn't `OPEN`, stop with the same shape.

### Phase 2: Resolve the review doc

5. **Find the doc:**
   - If a path arg was passed, use it (verify with `ls`).
   - Else auto-discover the newest: `ls docs/reviews/*.md 2>/dev/null | sort | tail -1` (lexicographic sort on the `YYYY-MM-DD-NNN-` prefix is deterministic).
   - If none exists, stop: "No review doc found. /push-review summarizes a /deep-review doc — run the review first, or pass the path."
6. **Verify it's the right doc for this PR:** read the frontmatter `target:`. If it names a PR number or branch that doesn't match the resolved PR / current branch, warn and ask via `AskUserQuestion`: **Use it anyway** / **Cancel** — a mismatched doc would post a misleading comment.

### Phase 3: Parse outcomes

7. Read the full doc. For every issue heading (`### P<X>-<N>: <title>`), capture its `Status:` and, when present, `Category:`, `File(s):`, `Defer reason:` / `Skip reason:`.
8. Bucket by terminal status:
   - `done` — a fix was applied.
   - `deferred` — carried with a reason.
   - `wont-fix` — skipped with an optional reason.
   - `open` / `in-progress` — **not terminal.** If any remain, the walk isn't finished. Warn: "N issues are still open/in-progress — the walk isn't complete. Push the fixes done so far anyway?" via `AskUserQuestion`: **Push what's done** / **Cancel** (go finish `/review-walk` first).
9. **If zero `done` issues:** there are no fixes to commit. Skip Phase 4 (no commit/push); still offer to post a comment recording what was deferred/skipped so the PR reflects the review outcome. If there's also nothing deferred/skipped, stop: "The review produced no changes — nothing to push or report."

### Phase 4: Commit and push the fixes

10. `git status --porcelain`. Reconcile against the `done` issues' `File(s):`:
    - **Uncommitted changes present** (the walk applied fixes but didn't commit them): stage only the files the `done` issues touched — never `git add -A` blindly. If changed files fall outside every `done` issue's `File(s):`, list them and ask via `AskUserQuestion`: **Include them** (they're part of the fix) / **Stage only cited files** / **Cancel** (let me look first). Never silently commit unrelated working-tree changes.
    - **Clean tree** (the walk already committed each fix — review-walk's implement path may have): skip staging/commit, go to the push step. Confirm there are local commits ahead of the PR's remote tip before pushing (`git fetch origin <headRefName>` then `git log origin/<headRefName>..HEAD --oneline`); if none, there's nothing to push — go to Phase 5 to post the comment only.
11. **Commit** (only when staging happened). Message body lists the fixed findings so the commit log carries the same context as the comment:
    ```
    git commit -m "$(cat <<'EOF'
    fix: address review findings (P<X>-<N>, P<Y>-<M>)

    <one line per done issue: P<X>-<N> <title>>

    Co-Authored-By: Claude <noreply@anthropic.com>
    EOF
    )"
    ```
    Keep the subject's ID list short; if more than ~4 findings, use `fix: address N review findings` and let the body carry the list.
12. **Pre-flight and push:** `git fetch origin <headRefName>`. If the local branch is behind the remote (someone else pushed), stop **before pushing** — do not force: "The PR branch advanced on the remote. `git pull --rebase origin <headRefName>`, re-check, then re-run /push-review." Otherwise `git push origin HEAD`. Only on success proceed; on failure report that the fixes are committed locally but NOT on the PR, with the recovery command.

### Phase 5: Post the PR comment

13. Compose the comment from the parsed outcomes — this is the deliverable, so make it scannable:
    ```markdown
    ## Review pass — <N> fixed, <M> deferred, <K> skipped

    Applied from `<review-doc-basename>` (via /review-walk).

    ### Fixed
    - **P1-2 <title>** — <one-line what-changed, drawn from the issue's Fix: intent> (`<file>`)
    - ...

    ### Deferred
    - **P2-1 <title>** — <defer reason> (`<file>`)
    - ...

    ### Skipped (won't fix)
    - **P3-4 <title>** — <skip reason, or "reviewer noise"> (`<file>`)
    - ...
    ```
    Omit any section with no members. For "Fixed", describe what changed in plain terms — derive it from the issue's `Fix:` field and the actual diff hunk for that file, not a verbatim paste of the reviewer's problem statement.
14. **Confirm before posting** via `AskUserQuestion`, showing the composed comment in a `preview`: **Post comment** / **Edit** (free-form revised body, then re-confirm) / **Skip comment** (fixes are already pushed; just don't comment). On Post: `gh pr comment <N> --body "<comment>"`.
15. **Report the final state:** commits pushed (or "already pushed"), comment posted (or skipped), and the reminder: "The worktree that shipped this PR is now behind — run `/catch-up` there before `/land`."

## Rules

- Read-only on the review doc — never edit `Status:` or any field. That's `/review-walk`'s job.
- Push onto the PR feature branch only — never `main`, never force-push, never `--no-verify`.
- Stage only files the `done` issues touched (plus explicitly-confirmed extras); never `git add -A`.
- Outcomes come from the doc's `Status:` lines — do not reclassify a finding or infer a status the doc doesn't state.
- Only claim "pushed" / "commented" after the operation actually succeeds; on failure, report the true state and the recovery command.
- Depends on `gh`; if unavailable, stop and say so.
