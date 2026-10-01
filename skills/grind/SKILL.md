---
name: grind
description: "Build one phase of an implementation plan unattended on one branch and end at one ready PR for review: after one confirmation of the build slices, an Opus subagent builds each slice unit-by-unit (committing, pushing, and stamping the issue per unit) while grind records one work doc with the scope observer; then the deep-review fleet reviews the whole branch with tests ignored, grind triages and an Opus subagent fixes the accepted findings, grind writes one test plan, and opens the PR — never writing tests, watching CI, or merging. Any failure stops the run where it is. A plan with Phased Delivery phases builds one phase per run. Use when the user says 'grind this plan', 'grind it out', 'run the whole plan', or invokes /grind."
argument-hint: "[plan file path]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Agent, AskUserQuestion, PushNotification
---

# Grind — Build a Plan Phase into One PR

**Note: The current year is 2026.**

`/grind` builds one phase of a plan — the whole plan when it has no `## Phased Delivery` — on one branch in one worktree, and ends at one ready PR. It asks you once, then runs without prompting: build the slices, review the branch, triage and fix, write a test plan, open the PR, stop. It never merges and never watches CI. You review the PR and its three docs — work, review, test plan — in a new session in the worktree, and land it yourself.

**If anything fails, the run stops.** Grind does not retry, resume, or work around a failure: it says what failed, leaves the branch and worktree as they are, and notifies you. Re-running starts a fresh run.

Never start `/grind` on your own initiative or from inside another skill; the user has to ask for it.

## Input

<input_document> #$ARGUMENTS </input_document>

No path → glob `docs/plans/*.md` with `status: active`, and ask via `AskUserQuestion` which of the newest 4 to grind. None → stop: "No active plan found. Write one with `/blueprint` first."

## Workflow

### 1. Preflight

- `gh auth status` succeeds.
- This is the primary checkout (`git rev-parse --git-common-dir` is `<toplevel>/.git`), on the default branch, with a clean tree.
- Read the plan in full.
- Resolve the linked issue per [the issue-log spec](../issue-log/SKILL.md#issue-number-resolution) as `<issue>`; every stamp below is skipped when it is empty.
- Capture this session's id (the `claude.ai/code/session_…` URL in the commit-trailer guidance) for the notification email.

Any check failing → stop with what failed.

### 2. Pick the units and confirm

- **Units.** With a `## Phased Delivery` section, take the first `### Phase N` whose `**Units:**` line lists an unchecked unit, and build that phase's unchecked units. When the phase has no `**Units:**` line, infer its units from the phase's prose. With no `## Phased Delivery`, build every unchecked unit. Skip units marked `**Reviewed:** retired`.
- **Slices.** Group the units into slices, in plan order: units that only make sense together share a slice; keep a slice under roughly 400 changed lines or ~6 files.
- **Branch.** `/tree` convention — `{prefix}/{issue}/{short-description}`, dropping `{issue}` when there is none — with a `-p<n>` suffix when the plan has more than one phase. The prefix and description also make the PR title.
- **Confirm once** with `AskUserQuestion`: "Grind phase <n> of <m> — <k> slices on `<branch>`, ending at one PR?" Put the slice list (slice, units) in a short `preview`. Options: **Grind it**, **Revise** (take the user's changes and re-confirm), **Cancel**. This is the only question in the run.
- **Stamp the start** per [the issue-log spec](../issue-log/SKILL.md#posting):

  ```markdown
  <!-- cc-forge-log v1: {"skill":"grind","event":"grind-started","paths":["<plan file path>"],"phase":<n>,"phases":<m>,"slices":<k>} -->

  ### ⚙️ /grind — phase <n> of <m>, <k> slices

  **Plan:** <plan file path>
  **Branch:** `<branch>`
  **Slices:** <one line per slice: "N. <slice name> — units <list>">
  ```

### 3. Build the slices

Create the worktree and the run's work doc once:

```bash
git fetch origin <default-branch>
git worktree add --no-track -b <branch> ../<repo>-worktrees/<branch> origin/<default-branch>
```

Symlink `docs/` from the primary checkout into the worktree, as `/tree` does. Create the work doc per [the work-protocol spec](../work-protocol/SKILL.md#the-document) with `target:` the branch and `base:` the worktree's HEAD.

For each slice, in order:

1. **Dispatch the build subagent** — `Agent`, `model: "opus"`, `subagent_type: "general-purpose"` — and wait for it. Its brief:
   - Work only in the absolute worktree path. The absolute plan path, for context; never edit the plan.
   - The verbatim text of every unit in the slice (Goal, Requirements, Files, Approach, Execution note, Patterns to follow, Verification), the relevant `Deferred to Implementation` questions, and the plan's `Scope Boundaries` as non-goals. Ignore any `Test scenarios` field — write no tests, run no suite. Follow the repo's `CLAUDE.md`.
   - **After each unit:** stage only that unit's files, commit with a conventional message, push with exactly `git push -u origin <branch>` — never a bare `git push` or any other refspec — and post the unit's stamp. A stamp that fails is one line in the return, never a stop. Skip stamps when `<issue>` is empty. Post with `gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>`, and never put `--` in a marker line.

     ```markdown
     <!-- cc-forge-log v1: {"skill":"grind","event":"unit-complete","unit":"<ordinal>: <title from plan checkbox heading>","paths":["<plan file path>"],"branch":"<branch>"} -->

     ### 🔨 /grind — unit <ordinal>: <title>

     **Did:** <one line>
     ```

   - **A unit it cannot finish:** post a `unit-blocked` stamp (same marker with `"event":"unit-blocked"`, body `**Blocked:** <one line>`), push what is committed, and return.
   - Never open or merge a PR, touch `main`, use `git add -A`, `--no-verify`, or force-push, create a worktree, or put a closing keyword (`Closes #N`, `Fixes #N`) in a commit message.
   - **Return:** per unit, its status, its commit range as `<base>..<head>`, one line per changed file, any deviation from the Approach with its reason, decisions made, and **stale tests** — existing tests the unit may have made stale, each as a path plus one sentence why.
2. **Check it landed.** `git -C <worktree> log origin/<branch> --oneline` shows a commit range for every unit in the slice. If not — or the agent reported a blocked unit — stop the run (Stopping).
3. **Record it** per [the work-protocol spec](../work-protocol/SKILL.md): dispatch `forge:workflow:scope-observer` in [`unit` mode](../work-protocol/SKILL.md#unit-mode) for each unit (plan path, ordinal, commit range, worktree as working directory, no addenda — and nothing from the build return), then update the work doc from git, the return, and the observer's cards. Every card stays `open`.
4. **Tick** the slice's unit checkboxes in the plan.

After the last slice, dispatch the observer once in [`wrap-up` mode](../work-protocol/SKILL.md#wrap-up-mode) over the units built, record its cards, and set the work doc `status: complete`.

### 4. Review

- **Roster:** `review_agents` from `cc-forge.local.md` when present, else [`/deep-review`'s default set](../deep-review/SKILL.md#load-review-agents) plus [its conditional agents](../deep-review/SKILL.md#conditional-agents-run-if-applicable) and `forge:review:code-simplicity-reviewer`. **Never dispatch `forge:review:test-coverage-reviewer`** — the test plan owns coverage.
- **Each agent's brief:** the branch diff (`git -C <worktree> diff origin/<default-branch>...HEAD`), the units this phase built, the repo's `CLAUDE.md`, this line verbatim — "Ignore test files and test coverage. Report no missing-test, weak-assertion, or test-quality findings — this run's test plan owns them." — and the return contract: findings with severity `P1`/`P2`/`P3`, file:line, one-sentence description, and an overall verdict. Run them in parallel.
- **Synthesize and verify** per [the review-protocol spec](../review-protocol/SKILL.md) — [scratch](../review-protocol/SKILL.md#the-raw-findings-scratch-contract), [synthesizer](../review-protocol/SKILL.md#dispatching-the-synthesizer), [count check](../review-protocol/SKILL.md#sanity-checking-the-returned-counts), [verification](../review-protocol/SKILL.md#verifying-the-review-document). Pass the branch as the target (no PR exists yet) and the primary checkout's absolute `docs/reviews/`. A clean review skips to step 6. A count shortfall or no verified doc → stop the run.
- **Stamp** per [the spec](../review-protocol/SKILL.md#the-review-written-stamp):

  ```markdown
  <!-- cc-forge-log v1: {"skill":"grind","event":"review-written","paths":["docs/reviews/<filename>","<plan file path>"]} -->

  ### 🔍 /grind — review written (test-coverage-reviewer skipped)
  ```

### 5. Triage and fix

**Triage every finding yourself** — read the cited code first — and write each verdict into the review doc before dispatching any fix. **Accept is the default**; reject and defer each need a stated reason.

| Verdict | Use when | Write |
|---------|----------|-------|
| **Accept** | The finding is real and fixable in this phase's files, whatever its priority. | `Status: in-progress` |
| **Reject** | The reviewer misread the code, the behavior is intended by the plan, or the fix contradicts the plan's decisions or scope. Not "low priority". | `Status: wont-fix` + a `Skip reason:` in [`/review-walk`'s format](../review-walk/SKILL.md#skip-reason-format) |
| **Defer** | The fix belongs to code this phase does not own, or needs its own plan. | `Status: deferred` + `Defer reason: <code> — <text>`, code one of `bigger-than-scoped`, `blocked-on`, `needs-decision`, `follow-up-pr` |

A P1 may be rejected only as `misread` or `by-design`, and deferred only as `bigger-than-scoped`; otherwise it is accepted. Directly under each finding's `Status:` line write `**Grind:** <accepted | rejected | deferred> — <one line why>`. Never file an issue for a deferred finding.

**If anything was accepted**, note `git -C <worktree> rev-parse origin/<branch>` as the fix base, then dispatch one fix subagent (`Agent`, `model: "opus"`, `subagent_type: "general-purpose"`) with: the worktree path; the accepted findings verbatim, with file:line, and nothing else; edit only the files those findings cite, and never the plan or the review doc; commit and push with exactly `git push -u origin <branch>`; run no tests; the build agent's prohibitions; and **return** per finding what changed and why the fix was applied, or why it couldn't be. Then confirm `git -C <worktree> log origin/<branch>..HEAD` is empty (everything pushed) — otherwise stop the run. List any file in `git -C <worktree> diff --name-only <fix base>..origin/<branch>` that no accepted finding cites; those go in the report and the PR's `### Grind Docs` as outside the findings. In the review doc:

- **Fixed** → `Status: done`, and rewrite the `Grind:` line to `**Grind:** fixed — <what changed>; why: <why the fix was applied>`.
- **Not fixed** → leave `Status: in-progress`, and rewrite the line to `**Grind:** accepted — not fixed: <reason>`.

One review pass per run — never re-review the fixes.

### 6. Write the test plan

Mirror `/test-plan` in the worktree and stop at its verified document — no writer, no test files, no commit. Follow its [surface digest](../test-plan/SKILL.md#3-build-the-surface-digest), [conventions](../test-plan/SKILL.md#4-discover-the-test-conventions), [lens dispatch](../test-plan/SKILL.md#5-dispatch-the-three-lenses), [persist and synthesize](../test-plan/SKILL.md#6-persist-and-synthesize), and [verify](../test-plan/SKILL.md#7-verify-the-document) steps, under [the test-protocol spec](../test-protocol/SKILL.md). The `target:` is the branch, the intent is this phase's units, the blast-radius lens gets the run's work doc, and the docs go to the primary checkout's `docs/tests/`. No intent source or no cases → no test doc; note it and continue.

Stamp a verified doc per [the spec](../test-protocol/SKILL.md#test-plan-written):

```markdown
<!-- cc-forge-log v1: {"skill":"grind","event":"test-plan-written","paths":["docs/tests/<filename>","<plan file path>"]} -->

### 🧪 /grind — test plan written
```

### 7. Open the PR

Body: [`/ship`'s PR template](../ship/pr-template.md), with its `Related to #<issue>` line when there is an issue — the body's only issue reference, never a closing keyword like `Closes #N` — and one added section after `### Related Changes`:

```markdown
### Grind Docs
- **Work:** `<work doc path>`
- **Review:** `<review doc path>` (or "clean")
- **Test plan:** `<test doc path>` (or "none")
- **Review tally:** <n> findings — <n> fixed, <n> deferred, <n> rejected, <n> not fixed
- **Fix touched outside the findings:** <files> (omit when none)
```

When a test doc exists, add the plain Pre-merge item `Run /test-plan-run <test doc path> and commit the tests`. Write the title and body to temp files, then from the worktree:

```bash
gh pr create --base <default-branch> --head <branch> --title "$(cat <title-file>)" --body-file <body-file>
```

Confirm it with `gh pr view <N> --json number,url,mergeable` — failure stops the run. Grind posts no PR comments. On the plan's final phase, set its frontmatter `status: completed`.

### 8. Report and notify

Print:

- The PR link and its `mergeable` state.
- `/work`'s one-liner per [the work-protocol spec](../work-protocol/SKILL.md#terminal-one-liners).
- Deferred and not-fixed findings, one line each, and any file the fix touched outside the findings.
- Requirements from the plan's `Requirements Trace` that this phase's units claim but nothing built covers.
- Phase <n> of <m>; when phases remain: "After this PR merges, re-run `/grind <plan path>` for phase <n+1>."
- **Next**, with the absolute worktree path:

  ```
  Next — review in a new session in the worktree:
    cd <worktree> && claude
    /review-walk <review doc>  →  /review-push  →  /test-plan-run <test doc>  →  /ship  →  /land
  ```

  Drop the review steps when there is no review doc, and the test steps when there is no test doc.

Then stamp the completion and notify:

```markdown
<!-- cc-forge-log v1: {"skill":"grind","event":"grind-complete","pr":<N>,"phase":<n>,"phases":<m>,"paths":["<plan file path>"]} -->

### 🏁 /grind — phase <n> of <m> ready for review

**PR:** <url>
**Deferred findings:** <count, or "none"> — in the review doc
```

### Stopping

Any failure stops the run on the spot: a blocked unit, commits that did not land, a review with no verified doc, fixes that did not push, a PR that did not open. Leave the branch, worktree, docs, and any PR exactly as they are. Report what failed with its real output and where the work is, stamp, and notify:

```markdown
<!-- cc-forge-log v1: {"skill":"grind","event":"grind-blocked","paths":["<plan file path>"]} -->

### 🛑 /grind — stopped at <step>

**Failed:** <what failed>
**Branch:** `<branch>` · **Worktree:** <absolute path>
```

### Notification

On completion and on a stop, after the stamp:

- **Push:** `PushNotification`, one line under 200 characters, no markdown — `grind complete: <plan> — PR #N ready for review, N deviations` or `grind stopped: <plan> — <what failed>`.
- **Email**, only when `SENDGRID_API_KEY` is set: one `POST https://api.sendgrid.com/v3/mail/send` via `curl -sS --fail --max-time 30`, the `Authorization: Bearer` header read from a `chmod 600` temp file with `-H @<file>` (deleted after the call) so the key never appears on the command line, the body in a file passed with `--data @<file>`. From `hfritz@r-o.com` (Hagen Fritz) to `hfritz@r-o.com`, subject `[grind] <plan title>: <complete | stopped>`. The body is the report, ending with `claude --resume <session-id>` on its own line. One attempt; a failure is one reported line.

## Rules

- One confirmation, then no questions. Never merge, never watch CI, never write or run tests.
- Push only with `git push -u origin <branch>`. Never push to `main`, force-push, use `--no-verify`, or `git add -A` — for grind or any subagent.
- Check every subagent's claim against git before moving on.
- Any failure stops the run. No retries, no recovery, no resume.
